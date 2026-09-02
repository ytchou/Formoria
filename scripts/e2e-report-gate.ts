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

export type SkippedCase = {
  file: string | null;
  title: string;
  project: string | null;
  reason: string;
};

export type ExpectedSkip = {
  file?: string;
  title?: string;
  reason?: string;
};

export type ExpectedSkipManifest = {
  version: 1;
  allowed: ExpectedSkip[];
};

export type ActionableReportFailure = {
  file: string | null;
  title: string;
  project: string;
  reason?: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function reasonFrom(value: Record<string, unknown>): string {
  const annotations = Array.isArray(value.annotations) ? value.annotations : [];
  const annotationText = annotations
    .map((annotation) => (annotation && typeof annotation === 'object'
      ? `${text((annotation as Record<string, unknown>).type)} ${text((annotation as Record<string, unknown>).description)}`.trim()
      : ''))
    .filter(Boolean)
    .join('; ');
  const error = value.error;
  const errorText = error && typeof error === 'object'
    ? text((error as Record<string, unknown>).message)
    : text(error);
  return [annotationText, errorText].filter(Boolean).join('; ');
}

function isSkipped(value: Record<string, unknown>): boolean {
  if (value.status === 'skipped') return true;
  const results = Array.isArray(value.results) ? value.results : [];
  return results.length > 0 && results.every((result) =>
    Boolean(result && typeof result === 'object' && (result as Record<string, unknown>).status === 'skipped'),
  );
}

export function collectSkipped(report: unknown): SkippedCase[] {
  const skipped: SkippedCase[] = [];
  const seen = new Set<string>();

  function visitSuite(suite: Record<string, unknown>, inheritedFile: string | null, parents: string[]) {
    const file = text(suite.file) || inheritedFile;
    const suites = Array.isArray(suite.suites) ? suite.suites : [];
    const nextParents = text(suite.title) ? [...parents, text(suite.title)] : parents;
    const specs = Array.isArray(suite.specs) ? suite.specs : [];
    for (const rawSpec of specs) {
      if (!rawSpec || typeof rawSpec !== 'object') continue;
      const spec = rawSpec as Record<string, unknown>;
      const title = [...nextParents, text(spec.title)].filter(Boolean).join(' › ');
      const tests = Array.isArray(spec.tests) ? spec.tests : [];
      let found = false;
      for (const rawTest of tests) {
        if (!rawTest || typeof rawTest !== 'object') continue;
        const test = rawTest as Record<string, unknown>;
        if (!isSkipped(test)) continue;
        found = true;
        const project = text(test.projectName) || null;
        const key = `${file ?? ''}|${title}|${project ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          skipped.push({ file, title, project, reason: reasonFrom(test) });
        }
      }
      if (!found && spec.status === 'skipped') {
        const key = `${file ?? ''}|${title}|`;
        if (!seen.has(key)) {
          seen.add(key);
          skipped.push({ file, title, project: null, reason: reasonFrom(spec) });
        }
      }
    }
    for (const rawChild of suites) {
      if (rawChild && typeof rawChild === 'object') {
        visitSuite(rawChild as Record<string, unknown>, file, nextParents);
      }
    }
  }

  if (!report || typeof report !== 'object') return skipped;
  const root = report as Record<string, unknown>;
  const suites = Array.isArray(root.suites) ? root.suites : [];
  for (const rawSuite of suites) {
    if (rawSuite && typeof rawSuite === 'object') {
      visitSuite(rawSuite as Record<string, unknown>, null, []);
    }
  }

  const stats = root.stats;
  const skippedCount = stats && typeof stats === 'object'
    ? Number((stats as Record<string, unknown>).skipped ?? 0)
    : 0;
  while (Number.isFinite(skippedCount) && skipped.length < skippedCount) {
    skipped.push({
      file: null,
      title: `Unknown skipped test ${skipped.length + 1}`,
      project: null,
      reason: 'Playwright stats reported a skip without test detail',
    });
  }
  return skipped;
}

function matches(expected: ExpectedSkip, actual: SkippedCase): boolean {
  return (!expected.file || Boolean(actual.file?.endsWith(expected.file))) &&
    (!expected.title || actual.title.includes(expected.title)) &&
    (!expected.reason || actual.reason.includes(expected.reason));
}

export function unexpectedSkips(
  report: unknown,
  manifest: ExpectedSkipManifest,
): SkippedCase[] {
  if (manifest.version !== 1 || !Array.isArray(manifest.allowed)) {
    throw new Error('E2E expected-skip manifest must use version 1 with an allowed array');
  }
  return collectSkipped(report).filter((actual) => {
    // Auth email quota is never an intentional skip. A project-wide 429 must
    // fail the release gate so signup coverage cannot silently disappear.
    const quota = `${actual.title} ${actual.reason}`;
    if (/rate\s*limit|too many requests|email quota|\b429\b/i.test(quota)) return true;
    return !manifest.allowed.some((expected) => matches(expected, actual));
  });
}

/**
 * Converts report-gate failures into incident records. A skipped test is an
 * actionable failure, not an empty Playwright failure set, so self-heal can
 * diagnose the missing journey instead of silently recovering.
 */
export function unexpectedSkipFailures(
  report: unknown,
  manifest: ExpectedSkipManifest,
): ActionableReportFailure[] {
  return unexpectedSkips(report, manifest).map((entry) => ({
    file: entry.file,
    title: entry.title,
    project: entry.project ?? 'deep',
    ...(entry.reason ? { reason: entry.reason } : {}),
  }));
}

export function assertE2EReport(
  report: unknown,
  manifest: ExpectedSkipManifest,
): void {
  if (!report || typeof report !== 'object') {
    throw new Error('Playwright JSON report is not an object');
  }
  const unexpected = unexpectedSkips(report, manifest);
  if (unexpected.length === 0) return;
  const details = unexpected
    .map((entry) => `${entry.file ?? 'workflow'} :: ${entry.title}${entry.reason ? ` (${entry.reason})` : ''}`)
    .join('\n');
  throw new Error(`Unexpected skipped E2E tests (${unexpected.length}):\n${details}`);
}

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
