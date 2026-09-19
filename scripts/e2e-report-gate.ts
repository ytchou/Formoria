/**
 * @formoria-script
 * purpose: Fails CI when the Playwright report contains a skip that the expected-skips manifest does not allow.
 * class: ci-gate
 * invoke: pnpm check:e2e-report
 * target: ci
 * safety: read-only
 * owner: engineering
 */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export {
  assertE2EReport,
  collectSkipped,
  unexpectedSkipFailures,
  unexpectedSkips,
  type ActionableReportFailure,
  type ExpectedSkip,
  type ExpectedSkipManifest,
  type SkippedCase,
} from '@/lib/services/e2e-report/gate';

import {
  assertE2EReport,
  collectSkipped,
  unexpectedSkipFailures,
  type ExpectedSkipManifest,
} from '@/lib/services/e2e-report/gate';

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [
    reportPath = 'playwright-results.json',
    manifestPath = 'scripts/e2e-expected-skips.json',
    failureOutputPath,
  ] = args;
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as unknown;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ExpectedSkipManifest;
  if (failureOutputPath) {
    await writeFile(
      failureOutputPath,
      `${JSON.stringify(unexpectedSkipFailures(report, manifest), null, 2)}\n`,
      'utf8',
    );
  }
  assertE2EReport(report, manifest);
  console.log(`E2E report gate passed: ${collectSkipped(report).length} expected skip(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
