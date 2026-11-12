import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  generateCircuit,
  type GenerationDiagnostics,
} from '../src/shared/circuit-generator.ts';
import {
  generateValidatedCircuit,
  type QualityAssessment,
} from '../src/shared/circuit-quality.ts';
import { SIMULATION_HZ } from '../src/shared/simulation.ts';
import { hashTrack, sampleTrack, type Track } from '../src/shared/track.ts';

type Options = {
  count: number;
  prefix: string;
  report?: string;
  structural: boolean;
};
type ReportResult = {
  track: Track;
  diagnostics: GenerationDiagnostics;
  quality: QualityAssessment | null;
  qualityAttempts: number;
  totalQualityAssessments: number;
  qualityRejections: { attempt: number; codes: string[] }[];
};

function parseOptions(args: string[]): Options {
  const options: Options = {
    count: 200,
    prefix: 'regression',
    structural: false,
  };
  if (process.env.RACER_TRACK_REPORT)
    options.report = resolve(process.env.RACER_TRACK_REPORT);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--structural') {
      options.structural = true;
      continue;
    }
    const value = args[index + 1];
    if (argument === '--count') {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1 || count > 1000)
        throw new Error('--count must be 1–1000');
      options.count = count;
    } else if (argument === '--prefix') {
      if (!value || value.length > 72)
        throw new Error('--prefix must contain 1–72 characters');
      options.prefix = value;
    } else if (argument === '--report') {
      if (!value) throw new Error('--report requires a JSON path');
      options.report = resolve(value);
    } else
      throw new Error(
        `Unknown argument: ${argument ?? ''}. Use --count, --prefix, --report or --structural.`
      );
    index++;
  }
  return options;
}

function generateForReport(seed: string, structural: boolean): ReportResult {
  if (structural)
    return {
      ...generateCircuit(seed),
      quality: null,
      qualityAttempts: 0,
      totalQualityAssessments: 0,
      qualityRejections: [],
    };
  const result = generateValidatedCircuit(seed);
  if (!result.quality.valid || !result.quality.metrics)
    throw new Error(`Unapproved circuit returned for ${seed}`);
  return {
    ...result,
    qualityAttempts: result.diagnostics.qualityAttempts,
    totalQualityAssessments:
      result.diagnostics.validationWork.qualityAssessments,
    qualityRejections: result.diagnostics.qualityRejections,
  };
}

function distribution(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const rounded = (value: number) => Math.round(value * 1000) / 1000;
  return {
    min: rounded(ordered[0] ?? 0),
    p10: rounded(ordered[Math.floor((ordered.length - 1) * 0.1)] ?? 0),
    median: rounded(ordered[Math.floor((ordered.length - 1) * 0.5)] ?? 0),
    p90: rounded(ordered[Math.floor((ordered.length - 1) * 0.9)] ?? 0),
    max: rounded(ordered.at(-1) ?? 0),
    mean: rounded(
      values.reduce((sum, value) => sum + value, 0) / values.length
    ),
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const records = [];
  const failures: { seed: string; error: string }[] = [];
  const started = performance.now();
  for (let index = 0; index < options.count; index++) {
    const seed = `${options.prefix}-${index}`;
    try {
      const generated = generateForReport(seed, options.structural);
      const curvatureSignature = Array.from(
        { length: 64 },
        (_, bin) =>
          Math.round(
            Math.abs(
              sampleTrack(
                generated.track,
                (generated.track.totalLength * bin) / 64
              ).curvature
            ) *
              generated.track.totalLength *
              2
          ) / 2
      ).join(',');
      records.push({
        curvatureSignature,
        seed,
        hash: await hashTrack(generated.track),
        length: generated.track.totalLength,
        diagnostics: generated.diagnostics,
        quality: generated.quality,
        qualityAttempts: generated.qualityAttempts,
        totalQualityAssessments: generated.totalQualityAssessments,
        qualityRejections: generated.qualityRejections,
      });
    } catch (error) {
      failures.push({
        seed,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const rejectionHistogram: Record<string, number> = {};
  const qualityRejectionHistogram: Record<string, number> = {};
  for (const record of records) {
    for (const rejection of record.diagnostics.rejections)
      for (const code of rejection.codes)
        rejectionHistogram[code] = (rejectionHistogram[code] ?? 0) + 1;
    for (const rejection of record.qualityRejections)
      for (const code of rejection.codes)
        qualityRejectionHistogram[code] =
          (qualityRejectionHistogram[code] ?? 0) + 1;
  }
  const fallbackCount = records.filter(
    (record) => record.diagnostics.fallbackUsed
  ).length;
  const metrics = records.flatMap((record) =>
    record.quality?.metrics ? [record.quality.metrics] : []
  );
  const seconds = (values: (number | null)[]) =>
    distribution(values.filter((value): value is number => value !== null));
  const summary = {
    scope: options.structural
      ? 'Structural geometry only.'
      : 'Structural geometry and authoritative simulation quality.',
    prefix: options.prefix,
    count: options.count,
    acceptedCount: records.length,
    failedCount: failures.length,
    failedSeedPreview: failures.slice(0, 10),
    fallbackCount,
    fallbackRate: records.length ? fallbackCount / records.length : 0,
    meanAttempts:
      records.reduce((sum, record) => sum + record.diagnostics.attempts, 0) /
      Math.max(1, records.length),
    meanRequestedQualityAssessments:
      records.reduce((sum, record) => sum + record.qualityAttempts, 0) /
      Math.max(1, records.length),
    meanQualityAssessments:
      records.reduce((sum, record) => sum + record.totalQualityAssessments, 0) /
      Math.max(1, records.length),
    rejectionHistogram,
    qualityRejectionHistogram,
    distinctCurvatureProfiles: new Set(
      records.map((record) => record.curvatureSignature)
    ).size,
    uniqueHashes: new Set(records.map((record) => record.hash)).size,
    lengthMetres: distribution(records.map((record) => record.length)),
    holdSeconds: seconds(metrics.map((metric) => metric.hold.seconds)),
    cautiousSeconds: seconds(metrics.map((metric) => metric.cautious.seconds)),
    fastSeconds: seconds(metrics.map((metric) => metric.fast.seconds)),
    gainSeconds: distribution(
      metrics.map((metric) => metric.gainTicks / SIMULATION_HZ)
    ),
    meaningfulLifts: distribution(
      metrics.map((metric) => metric.meaningfulLifts)
    ),
    elapsedMilliseconds: Math.round(performance.now() - started),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (options.report) {
    await mkdir(dirname(options.report), { recursive: true });
    await writeFile(
      options.report,
      JSON.stringify({ summary, records, failures }, null, 2) + '\n'
    );
    console.log(`Saved report: ${options.report}`);
  }
  if (failures.length) process.exitCode = 1;
}

await main();
