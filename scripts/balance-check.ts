import { readFile } from 'node:fs/promises';
import {
  assertBalanceReportOutput,
  compareBalanceReports,
  evaluateBalanceKit,
  loadBalanceKit,
  parseBalanceOptions,
  writeBalanceReport,
} from './balance-kit.ts';

async function main(): Promise<void> {
  const options = parseBalanceOptions(process.argv.slice(2));
  if (options.report)
    await assertBalanceReportOutput(options.report, options.compare);
  const baseline: unknown = options.compare
    ? JSON.parse(await readFile(options.compare, 'utf8'))
    : undefined;
  const kit = await loadBalanceKit();
  const report = evaluateBalanceKit(kit);
  const comparison =
    baseline === undefined
      ? undefined
      : compareBalanceReports(report, baseline);
  console.table(
    report.records.map((record) => ({
      course: record.id,
      role: record.role,
      pins: `hold=${record.expectedFinishTicks.hold}; cautious=${record.expectedFinishTicks.cautious ?? 'unpinned'}; fast=${record.expectedFinishTicks.fast ?? 'unpinned'}`,
      hold: record.hold.seconds?.toFixed(3),
      cautious: record.cautious.seconds?.toFixed(3),
      boundedFast: record.boundedFast.seconds?.toFixed(3),
      lifts: record.boundedFast.meaningfulLifts,
      offRoadTicks: record.boundedFast.offRoadTicks,
      recoveries: record.boundedFast.recoveryCount,
    }))
  );
  console.log(
    JSON.stringify(
      {
        scope: report.scope,
        selection: report.selection,
        work: report.work,
        workAccounting: report.workAccounting,
        limits: report.limits,
        failures: report.failures,
        ...(comparison ? { comparison } : {}),
      },
      null,
      2
    )
  );
  if (options.report) {
    await writeBalanceReport(
      options.report,
      report,
      comparison,
      options.compare
    );
    console.log(`Saved new evaluation report: ${options.report}`);
  }
  if (report.failures.length) process.exitCode = 1;
}
await main();
