#!/usr/bin/env node
// CI guard: committed Supabase types must match the linked database.
//
// Local runs without Supabase credentials are intentionally skipped. Set
// DB_TYPES_STRICT=1 (CI does) to turn every skip into a failure, so a missing
// token or an unlinked project is loud instead of a permanently green gate.
//
// The committed file is Prettier-formatted and the Supabase CLI emits
// unformatted output, so the generated types are run through Prettier before
// the comparison — without that, the guard can never pass.
//
// Two outcomes are NOT failures and must stay distinct from each other:
//   skip()   — cannot verify (no token, CLI broke). Fails under STRICT.
//   exempt() — nothing to verify against. Passes even under STRICT.
// The comparison target is the *remote* database, so a branch that adds a
// migration is legitimately ahead of it and can never match. That is exempt,
// not a failure: without this the gate would be red on precisely the PRs it
// exists to guard, and the standing fix would be to disable it.

import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMITTED_TYPES = join(ROOT, 'src', 'lib', 'supabase', 'database.types.ts');
const TEMP_TYPES = join(tmpdir(), `formoria-database-types-${process.pid}.ts`);
const AUTH_OR_LINK_ERROR = /(?:not found|missing|not linked|link(?:ed)? project|not logged in|unauthori[sz]ed|authentication|auth)/i;

function normalize(source) {
  return source
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n+$/, '')
    .concat('\n');
}

const STRICT = process.env.DB_TYPES_STRICT === '1';

function skip(reason) {
  if (STRICT) {
    console.error(`✖ database types guard: cannot verify (${reason})`);
    console.error('  DB_TYPES_STRICT=1 refuses to pass an unverified guard.');
    console.error('  CI needs the SUPABASE_ACCESS_TOKEN secret and the SUPABASE_PROJECT_ID variable.');
    process.exit(1);
  }
  console.log(`- skipped: ${reason}`);
  process.exit(0);
}

function exempt(reason) {
  console.log(`- not applicable: ${reason}`);
  process.exit(0);
}

function git(...args) {
  const run = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  if (run.error || run.status !== 0) return null;
  return (run.stdout ?? '').trim();
}

// Where this branch left the base. `origin/main` is the honest answer and the
// only one that works with more than one commit on the branch; CI checks out
// `refs/pull/N/merge` at fetch-depth 2, where origin/main is unfetched but
// HEAD~1 *is* the base tip (the same assumption the `unit-changed` leg
// documents). Neither resolving means no diff to consult — run the guard.
const base =
  (git('rev-parse', '--verify', '--quiet', 'origin/main') &&
    git('merge-base', 'HEAD', 'origin/main')) ||
  git('rev-parse', '--verify', '--quiet', 'HEAD~1');

if (base) {
  const pending = git('diff', '--name-only', base, 'HEAD', '--', 'supabase/migrations');
  if (pending) {
    const files = pending.split('\n');
    console.log(
      `  ${files.length} migration(s) on this branch are not applied to the remote database yet:`,
    );
    for (const file of files) console.log(`    ${file}`);
    exempt(
      'branch carries unapplied migrations, so the remote schema is behind it by design',
    );
  }
}

// `--project-id` needs only an access token, so CI does not have to link the
// project (linking also wants the database password).
const projectId = process.env.SUPABASE_PROJECT_ID;
const target = projectId ? ['--project-id', projectId] : ['--linked'];

const result = spawnSync('npx', ['supabase', 'gen', 'types', 'typescript', ...target], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 120000,
});

if (result.error) {
  skip(`Supabase types could not be generated (${result.error.message})`);
}

const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';
if (result.status !== 0) {
  skip(stderr.trim() || 'Supabase CLI exited without generating types');
}
if (AUTH_OR_LINK_ERROR.test(stderr)) {
  skip(stderr.trim());
}
if (!stdout.trim()) {
  skip('Supabase CLI produced empty type output');
}

let firstDifferentLine = 0;

try {
  writeFileSync(TEMP_TYPES, stdout);
  const formatted = spawnSync('npx', ['prettier', '--write', TEMP_TYPES], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
  if (formatted.error || formatted.status !== 0) {
    skip(`Prettier could not format the generated types (${formatted.error?.message ?? formatted.stderr?.trim()})`);
  }

  const committed = existsSync(COMMITTED_TYPES) ? readFileSync(COMMITTED_TYPES, 'utf8') : '';
  const generatedNormalized = normalize(readFileSync(TEMP_TYPES, 'utf8'));
  const committedNormalized = normalize(committed);

  if (generatedNormalized !== committedNormalized) {
    const generatedLines = generatedNormalized.split('\n');
    const committedLines = committedNormalized.split('\n');
    const maxLines = Math.max(generatedLines.length, committedLines.length);
    firstDifferentLine = 1;
    while (
      firstDifferentLine <= maxLines &&
      generatedLines[firstDifferentLine - 1] === committedLines[firstDifferentLine - 1]
    ) {
      firstDifferentLine++;
    }
  }
} finally {
  if (existsSync(TEMP_TYPES)) unlinkSync(TEMP_TYPES);
}

if (firstDifferentLine > 0) {
  console.error('✖ database types guard: generated types differ from the committed file');
  console.error(`  first differing line numbers: generated ${firstDifferentLine}, committed ${firstDifferentLine}`);
  console.error('  Run: pnpm db:types');
  process.exit(1);
}

console.log('✓ database types guard: committed types are fresh');
