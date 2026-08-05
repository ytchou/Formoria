#!/usr/bin/env node
// CI guard: external calls in src must stay inside the audit envelope.
//
// This guard scans src/**/*.{ts,tsx}. The scripts/ directory is excluded because
// it contains dev-only tsx entrypoints that run outside any request context and
// have no audit sink.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const REGISTRY = join(SRC, 'lib', 'audit', 'providers.ts');

/**
 * Files with external fetch() calls that are deliberately outside the audit
 * envelope. Every entry needs a stated reason. This list should shrink, never
 * grow casually.
 *
 * The largest group is the provider/adapter layer: per the file-ownership rule
 * the adapter owns the raw SDK call and the service layer owns the audit
 * envelope, so the fetch and its auditedCall wrapper live in different modules
 * by design. Each entry below names the module that wraps it, so the claim is
 * checkable by hand.
 */
export const ALLOWED_UNAUDITED_FETCH = [
  // Admin liveness probes: reachability HEAD/GET pings with no request payload and
  // no business effect. Auditing them would write a row per provider on every admin
  // dashboard load, drowning the real call record in noise.
  'src/lib/services/executive-health.ts',
  // Same-origin cache revalidation ping back into this app's own /api route. The
  // absolute base URL is assembled from env, so it cannot be proven relative
  // statically, but no third party is involved.
  'src/lib/cache/revalidate-client.ts',
  // Resend HTTP adapter. Wrapped by src/lib/email/send.ts as resend.send_email.
  'src/lib/email/resend-adapter.ts',
  // OpenAI HTTP adapter. Wrapped by src/lib/services/llm-audit.ts as
  // openai.chat_completions.
  'src/lib/services/openai-client.ts',
  // DeepSeek HTTP adapter. Wrapped by src/lib/services/llm-audit.ts as
  // deepseek.chat_completions and deepseek.balance.
  'src/lib/services/deepseek-client.ts',
];

/** Import of the envelope helper, in either quote style. */
const IMPORTS_AUDITED_CALL =
  /import\s*\{[^}]*\bauditedCall\b[^}]*\}\s*from\s*['"]@\/lib\/audit['"]/;

/**
 * A client module can never be on the envelope: the audit path reaches
 * AsyncLocalStorage (node:async_hooks), which does not exist in the browser and
 * hard-fails the Turbopack build if it is pulled into a client bundle. Client
 * fetches are same-origin calls into this app's own API routes, and the route
 * handler on the other side is where the envelope belongs.
 */
const CLIENT_DIRECTIVE = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*|\s)*['"]use client['"]/;

function normalizePath(path) {
  return path.replaceAll('\\', '/');
}

export function isExemptPath(relativePath) {
  const normalizedPath = normalizePath(relativePath);
  const pathSegments = normalizedPath.split('/');

  if (
    pathSegments.includes('__tests__') ||
    /\.(test|spec)\.tsx?$/.test(normalizedPath)
  ) {
    return true;
  }

  if (normalizedPath.startsWith('src/lib/audit/')) return true;

  return ALLOWED_UNAUDITED_FETCH.includes(normalizedPath);
}

export function parseProviderRegistry(source) {
  const registry = {};
  const literal = /(?:export\s+)?const\s+PROVIDERS\s*=\s*\{([\s\S]*?)\}\s*as\s+const/.exec(source);
  if (!literal) return registry;

  const entries = /(?:"([^"\n]+)"|([A-Za-z_$][\w$]*))\s*:\s*\[([^\]]*)\]/g;
  for (const match of literal[1].matchAll(entries)) {
    const provider = match[1] ?? match[2];
    registry[provider] = [...match[3].matchAll(/"([^"\n]*)"/g)].map(
      (operation) => operation[1],
    );
  }

  return registry;
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

function auditedCallArgumentSpans(source) {
  const spans = [];
  const callSites = /\bauditedCall\s*\(/g;
  let match;

  while ((match = callSites.exec(source)) !== null) {
    const openIndex = match.index + match[0].length - 1;
    const argumentsSource = callArguments(source, openIndex);
    spans.push({
      start: openIndex + 1,
      end: openIndex + 1 + argumentsSource.length,
    });
  }

  return spans;
}

function firstArgument(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = openIndex + 1; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(' || ch === '{' || ch === '[') {
      depth++;
    } else if (ch === ')' || ch === '}' || ch === ']') {
      if (depth === 0) return source.slice(openIndex + 1, i);
      depth--;
    } else if (ch === ',' && depth === 0) {
      return source.slice(openIndex + 1, i);
    }
  }

  return source.slice(openIndex + 1);
}

function isExternalFetchArgument(argument) {
  const trimmed = argument.trim();
  if (!trimmed) return true;

  const firstCharacter = trimmed[0];
  if (firstCharacter !== "'" && firstCharacter !== '"' && firstCharacter !== '`') {
    return true;
  }

  const content = trimmed.slice(1);
  return !content.startsWith('/');
}

function excerpt(argument) {
  const compact = argument.trim().replace(/\s+/g, ' ');
  return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact;
}

function addAuditSpecViolations(relativePath, source, registry, violations) {
  const pairs = [
    /provider\s*:\s*(['"])([^'"\n]+)\1\s*,\s*operation\s*:\s*(['"])([^'"\n]+)\3/g,
    /operation\s*:\s*(['"])([^'"\n]+)\1\s*,\s*provider\s*:\s*(['"])([^'"\n]+)\3/g,
  ];

  for (const [order, pattern] of pairs.entries()) {
    for (const match of source.matchAll(pattern)) {
      const provider = order === 0 ? match[2] : match[4];
      const operation = order === 0 ? match[4] : match[2];
      if (provider.includes('${') || operation.includes('${')) continue;

      const operations = registry[provider];
      if (operations && operations.includes(operation)) continue;

      violations.push({
        file: normalizePath(relativePath),
        line: lineOf(source, match.index),
        kind: 'unregistered-audit-spec',
        detail: `${provider}.${operation}`,
      });
    }
  }
}

export function analyzeSource(relativePath, source, registry) {
  if (isExemptPath(relativePath)) return [];

  const violations = [];
  const auditedSpans = auditedCallArgumentSpans(source);
  const fetchCalls = /(?<!\.)\bfetch\s*\(/g;

  // Module-level escape hatch. Lexical containment inside auditedCall(...) is the
  // primary signal, but a module often puts the raw fetch in a small helper and
  // wraps the helper's caller (serper.ts does exactly this). Proving that the
  // enclosing function is only ever reached through an envelope is beyond a
  // regex, so a module that imports auditedCall is treated as on the envelope.
  // Known limit: a second, genuinely unaudited fetch added to such a module
  // passes this gate. Registration (rule B) still applies there.
  const onEnvelope = IMPORTS_AUDITED_CALL.test(source);
  const isClientModule = CLIENT_DIRECTIVE.test(source);

  for (const match of onEnvelope || isClientModule ? [] : source.matchAll(fetchCalls)) {
    const openIndex = match.index + match[0].length - 1;
    const argument = firstArgument(source, openIndex);
    if (!isExternalFetchArgument(argument)) continue;
    if (auditedSpans.some((span) => match.index >= span.start && match.index < span.end)) continue;

    violations.push({
      file: normalizePath(relativePath),
      line: lineOf(source, match.index),
      kind: 'unaudited-fetch',
      detail: excerpt(argument),
    });
  }

  addAuditSpecViolations(relativePath, source, registry, violations);
  return violations;
}

function listSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const registry = parseProviderRegistry(readFileSync(REGISTRY, 'utf8'));
  const violations = [];

  for (const file of listSourceFiles(SRC)) {
    const relativePath = relative(ROOT, file);
    if (isExemptPath(relativePath)) continue;
    const source = readFileSync(file, 'utf8');
    violations.push(...analyzeSource(relativePath, source, registry));
  }

  if (violations.length > 0) {
    console.error('\n✖ audited external calls guard:');
    for (const kind of ['unaudited-fetch', 'unregistered-audit-spec']) {
      for (const violation of violations.filter((item) => item.kind === kind)) {
        console.error(`  ${violation.file}:${violation.line}  ${violation.detail}`);
      }
    }
    console.error('');
    console.error('  Wrap external calls with auditedCall from @/lib/audit and register');
    console.error('  every provider and operation in src/lib/audit/providers.ts. See');
    console.error('  docs/patterns/audited-external-calls.md for the required pattern.');
    console.error('');
    process.exit(1);
  }

  console.log('✓ audited external calls guard: all external fetches are inside the audit envelope');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
