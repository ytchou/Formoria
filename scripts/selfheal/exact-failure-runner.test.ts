import { describe, expect, it } from 'vitest';
import {
  assertListedRecords,
  buildExactSelectors,
  buildPlaywrightArgs,
  parseListedTestRecords,
  validateFrozenFailureTuples,
} from './exact-failure-runner';

const failures = [
  {
    file: 'e2e/tests/search-edge-cases.spec.ts',
    project: 'deep',
    title: 'search title (台灣) [owner]?',
  },
  {
    file: 'e2e/tests/mobile.spec.ts',
    project: 'mobile',
    title: 'mobile returns to the same slice',
  },
] as const;

describe('self-heal exact failure runner', () => {
  it('builds one escaped, project-specific selector per frozen tuple', () => {
    const selectors = buildExactSelectors(failures);
    expect(selectors[0]).toMatchObject({
      project: 'deep',
      grep: '(?:^| › )search title \\(台灣\\) \\[owner\\]\\?$',
    });
    const args = buildPlaywrightArgs(selectors[1]);
    expect(args).toEqual(expect.arrayContaining(['--project', 'mobile', '--grep', '(?:^| › )mobile returns to the same slice$']));
    expect(args.filter((argument) => argument === '--grep')).toHaveLength(1);
  });

  it('rejects malformed or duplicate frozen tuples before Playwright runs', () => {
    expect(() => validateFrozenFailureTuples([])).toThrow('empty');
    expect(() => validateFrozenFailureTuples([{ ...failures[0], project: 'chromium' }])).toThrow('not enabled');
    expect(() => validateFrozenFailureTuples([failures[0], failures[0]])).toThrow('duplicate');
  });

  it('proves listed records match the frozen file, title, and project set', () => {
    const listed = parseListedTestRecords([
      '[deep] › e2e/tests/search-edge-cases.spec.ts:10:3 › Search edge cases › search title (台灣) [owner]? ',
      '[mobile] › e2e/tests/mobile.spec.ts:12:5 › mobile returns to the same slice',
    ].join('\n'));
    expect(() => assertListedRecords(failures, listed)).not.toThrow();
    expect(() => assertListedRecords(failures, listed.slice(0, 1))).toThrow('did not prove');
    expect(() => assertListedRecords(failures, listed.map((record) => ({ ...record, project: 'deep' })))).toThrow('did not prove');
  });
});
