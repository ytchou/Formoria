import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export type FrozenFailureTuple = {
  file: string | null;
  title: string;
  project: string;
  reason?: string;
};

type ValidatedFrozenFailureTuple = Omit<FrozenFailureTuple, 'file'> & { file: string };

export type ListedTestRecord = {
  file: string;
  title: string;
  project: string;
};

export type ExactSelector = {
  file: string;
  title: string;
  project: string;
  grep: string;
};

type FrozenFailurePayload = {
  failures?: FrozenFailureTuple[];
};

const ALLOWED_PROJECTS = new Set(['deep', 'mobile']);

export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function validateFrozenFailureTuples(
  failures: readonly FrozenFailureTuple[],
): ValidatedFrozenFailureTuple[] {
  if (failures.length === 0) {
    throw new Error('Frozen exact failure set is empty');
  }
  const normalized = failures.map((failure) => {
    const file = failure.file?.trim() ?? '';
    const title = failure.title.trim();
    const project = failure.project.trim();
    if (!file || !title || !project) {
      throw new Error('Every exact failure requires a file, title, and project');
    }
    if (!file.startsWith('e2e/') || !file.endsWith('.spec.ts')) {
      throw new Error(`Exact failure file is outside e2e specs: ${file}`);
    }
    if (!ALLOWED_PROJECTS.has(project)) {
      throw new Error(`Exact failure project is not enabled: ${project}`);
    }
    return {
      file,
      title,
      project,
      ...(failure.reason?.trim() ? { reason: failure.reason.trim() } : {}),
    };
  });
  const keys = normalized.map(({ file, title, project }) => `${project}|${file}|${title}`);
  if (new Set(keys).size !== keys.length) {
    throw new Error('Frozen exact failure set contains duplicate tuples');
  }
  return normalized;
}

export function buildExactSelectors(
  failures: readonly FrozenFailureTuple[],
): ExactSelector[] {
  return validateFrozenFailureTuples(failures).map(({ file, title, project }) => ({
    file,
    title,
    project,
    // Each tuple gets its own escaped, end-anchored selector. Titles are never
    // joined into one caller-controlled regex; the boundary also handles
    // frozen reports that store the leaf title without its describe prefix.
    grep: `(?:^| › )${escapeRegexLiteral(title)}$`,
  }));
}

export function buildPlaywrightArgs(selector: ExactSelector, listOnly = false): string[] {
  return [
    'exec',
    'playwright',
    'test',
    selector.file,
    '--project',
    selector.project,
    '--grep',
    selector.grep,
    ...(listOnly ? ['--list'] : ['--reporter=html,json']),
  ];
}

export function parseListedTestRecords(output: string): ListedTestRecord[] {
  const records: ListedTestRecord[] = [];
  const linePattern = /^\s*\[([^\]]+)\]\s+›\s+(.+?):\d+:\d+\s+›\s+(.+)$/;
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(linePattern);
    if (!match) continue;
    const [, project, file, title] = match;
    records.push({ project: project.trim(), file: file.trim(), title: title.trim() });
  }
  return records;
}

function tupleKey(tuple: FrozenFailureTuple | ListedTestRecord): string {
  return `${tuple.project}|${tuple.file}|${tuple.title}`;
}

export function assertListedRecords(
  failures: readonly FrozenFailureTuple[],
  listed: readonly ListedTestRecord[],
): void {
  const expected = validateFrozenFailureTuples(failures);
  const expectedKeys = expected.map(tupleKey);
  const actual = listed.filter((record) => expected.some((tuple) =>
    record.project === tuple.project &&
    record.file.endsWith(tuple.file ?? '') &&
    (record.title === tuple.title || record.title.endsWith(` › ${tuple.title}`)),
  ));
  if (listed.length !== expected.length || actual.length !== expected.length || new Set(actual.map(tupleKey)).size !== expected.length) {
    throw new Error(
      `Playwright --list selection did not prove the frozen set (expected ${expectedKeys.join(', ')}, got ${actual.map(tupleKey).join(', ')})`,
    );
  }
}

function mergeReports(reports: Record<string, unknown>[]): Record<string, unknown> {
  const suites = reports.flatMap((report) => Array.isArray(report.suites) ? report.suites : []);
  const stats = reports.reduce<Record<string, number>>((merged, report) => {
    if (!report.stats || typeof report.stats !== 'object') return merged;
    for (const [key, value] of Object.entries(report.stats)) {
      if (typeof value === 'number') merged[key] = (merged[key] ?? 0) + value;
    }
    return merged;
  }, {});
  return { suites, stats };
}

function run(commandArgs: readonly string[], env: NodeJS.ProcessEnv): { status: number; output: string } {
  const result = spawnSync('pnpm', commandArgs, {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { status: result.status ?? 1, output };
}

export async function runExactFailureSet(
  failures: readonly FrozenFailureTuple[],
  options: { listOnly?: boolean; outputPath?: string } = {},
): Promise<void> {
  const selectors = buildExactSelectors(failures);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'formoria-e2e-exact-'));
  const reports: Record<string, unknown>[] = [];
  try {
    for (const [index, selector] of selectors.entries()) {
      const listed = run(buildPlaywrightArgs(selector, true), process.env);
      if (listed.status !== 0) {
        throw new Error(`Playwright could not list exact failure ${selector.title}:\n${listed.output}`);
      }
      assertListedRecords([selector], parseListedTestRecords(listed.output));
      if (options.listOnly) continue;

      const reportPath = resolve(temporaryDirectory, `result-${index}.json`);
      const executed = run(
        buildPlaywrightArgs(selector).map((argument) => argument === '--reporter=html,json'
          ? '--reporter=html,json'
          : argument),
        { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
      );
      if (executed.status !== 0) {
        throw new Error(`Exact staging validation failed for ${selector.title}:\n${executed.output}`);
      }
      reports.push(JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>);
    }
    if (!options.listOnly && options.outputPath) {
      await writeFile(options.outputPath, `${JSON.stringify(mergeReports(reports), null, 2)}\n`, 'utf8');
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const [frozenPath = 'frozen-failures.json', outputPath = 'playwright-results-exact.json', ...flags] = args;
  const payload = JSON.parse(await readFile(frozenPath, 'utf8')) as FrozenFailurePayload | FrozenFailureTuple[];
  const failures = Array.isArray(payload) ? payload : payload.failures ?? [];
  await runExactFailureSet(failures, { listOnly: flags.includes('--list-only'), outputPath });
  console.log(`Exact frozen staging failure set proved and validated: ${failures.length} tuple(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
