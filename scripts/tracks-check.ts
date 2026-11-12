import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { generateCircuit } from '../src/shared/circuit-generator.ts';
import { hashTrack, sampleTrack } from '../src/shared/track.ts';

type Options = { count: number; prefix: string; report?: string };

function parseOptions(args: string[]): Options {
  const options: Options = { count: 200, prefix: 'regression' };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
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
    } else {
      throw new Error(
        `Unknown argument: ${argument ?? ''}. Use --count, --prefix or --report.`
      );
    }
    index++;
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const records = [];
  const started = performance.now();
  for (let index = 0; index < options.count; index++) {
    const seed = `${options.prefix}-${index}`;
    const generated = generateCircuit(seed);
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
    });
  }
  const lengths = records.map((record) => record.length);
  const rejectionHistogram: Record<string, number> = {};
  for (const record of records) {
    for (const rejection of record.diagnostics.rejections) {
      for (const code of rejection.codes)
        rejectionHistogram[code] = (rejectionHistogram[code] ?? 0) + 1;
    }
  }
  const fallbackCount = records.filter(
    (record) => record.diagnostics.fallbackUsed
  ).length;
  const summary = {
    scope:
      'Generator structural checks only; simulation playability gates follow in issue #7.',
    prefix: options.prefix,
    count: records.length,
    fallbackCount,
    fallbackRate: fallbackCount / records.length,
    meanAttempts:
      records.reduce((sum, record) => sum + record.diagnostics.attempts, 0) /
      records.length,
    rejectionHistogram,
    distinctCurvatureProfiles: new Set(
      records.map((record) => record.curvatureSignature)
    ).size,
    uniqueHashes: new Set(records.map((record) => record.hash)).size,
    lengthMetres: {
      min: Math.min(...lengths),
      max: Math.max(...lengths),
      mean: lengths.reduce((sum, length) => sum + length, 0) / lengths.length,
    },
    elapsedMilliseconds: Math.round(performance.now() - started),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (options.report) {
    await mkdir(dirname(options.report), { recursive: true });
    await writeFile(
      options.report,
      JSON.stringify({ summary, records }, null, 2) + '\n'
    );
    console.log(`Saved report: ${options.report}`);
  }
}

await main();
