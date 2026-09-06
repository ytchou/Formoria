#!/usr/bin/env node
/**
 * @formoria-script
 * purpose: Fails CI when an analytics event name is a bare literal instead of a registry constant.
 * class: ci-gate
 * invoke: node scripts/check-event-registry.mjs
 * target: ci
 * safety: read-only
 * owner: engineering
 */
// CI guard: analytics event names may only come from the registry.
//
// PostHog cannot rename an event and cannot selectively delete one, so every
// event-name string that reaches production is permanent. A bare literal at a
// call site is how a typo, a near-duplicate, or a silent rename gets shipped —
// and once shipped it can never be cleaned up, only bridged with an action.
//
// This guard scans src/**/*.{ts,tsx} and rejects a string literal passed as the
// event name to `capturePostHogEvent(...)` or `posthog.capture(...)`. Identifiers
// and member expressions (`ANALYTICS_EVENTS.FOO`) are allowed. Regex-based on
// purpose: no AST dependency, same posture as check-favicon-rgba.mjs.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const REGISTRY = join(SRC, 'lib', 'analytics', 'events.ts');

/** The registry itself, and tests, are allowed to hold literals. */
function isExcluded(path) {
  if (path === REGISTRY) return true;
  if (/\.test\.tsx?$/.test(path)) return true;
  return path.split(/[/\\]/).includes('__tests__');
}

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !isExcluded(full)) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** Text of the argument list of a call whose `(` sits at `openIndex`. */
function callArguments(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return source.slice(openIndex + 1);
}

const LEADING_LITERAL = /^\s*(['"`])([^'"`\n]*)\1/;
const EVENT_KEY_LITERAL = /(?:^|[\s{,])event\s*:\s*(['"`])([^'"`\n]*)\1/;
const CALL_SITES = /\b(capturePostHogEvent|[A-Za-z_$][\w$]*\.capture)\s*\(/g;

const violations = [];

for (const file of listSourceFiles(SRC)) {
  const source = readFileSync(file, 'utf8');
  CALL_SITES.lastIndex = 0;
  let match;
  while ((match = CALL_SITES.exec(source)) !== null) {
    const callee = match[1];
    // `posthog.capture` and `capturePostHogEvent` are the two analytics sinks.
    // Any other `.capture(` (Sentry.captureException etc.) is not ours.
    if (callee !== 'capturePostHogEvent' && !/^posthog\.capture$/i.test(callee)) continue;

    const args = callArguments(source, match.index + match[0].length - 1);
    const literal = LEADING_LITERAL.exec(args) ?? EVENT_KEY_LITERAL.exec(args);
    if (!literal) continue;

    violations.push({
      file: relative(ROOT, file),
      line: lineOf(source, match.index),
      callee,
      event: literal[2],
    });
  }
}

if (violations.length > 0) {
  console.error('\n✖ event registry guard: bare analytics event literals found\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.callee}(… '${v.event}' …)`);
  }
  console.error('');
  console.error('  Analytics event names must come from the canonical registry —');
  console.error('  PostHog can never rename or selectively delete an event, so a literal');
  console.error('  typo at a call site is permanent. Add the event to');
  console.error('  src/lib/analytics/events.ts and reference it as ANALYTICS_EVENTS.<KEY>:');
  console.error('');
  console.error("    capturePostHogEvent(ANALYTICS_EVENTS.BRAND_DETAIL_VIEWED, { … })");
  console.error("    posthog.capture({ distinctId, event: ANALYTICS_EVENTS.ASSET_UPLOADED, … })");
  console.error('');
  process.exit(1);
}

console.log('✓ event registry guard: no bare analytics event literals in src/');
