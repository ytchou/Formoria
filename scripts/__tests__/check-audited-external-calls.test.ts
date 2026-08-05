import { describe, expect, it } from 'vitest';
import {
  ALLOWED_UNAUDITED_FETCH,
  analyzeSource,
  isExemptPath,
  parseProviderRegistry,
} from '../check-audited-external-calls.mjs';

const REGISTRY_SOURCE = `export const PROVIDERS = {
  serper: ["search"],
  "mit-registry": ["lookup_cert_number"],
} as const;`;
const REGISTRY = parseProviderRegistry(REGISTRY_SOURCE);

describe('check audited external calls', () => {
  it('fails on a fetch to an external host outside the envelope', () => {
    const source = `export async function run() {
  await fetch("https://example.com/data");
}`;
    const violations = analyzeSource('src/lib/services/example.ts', source, REGISTRY);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ kind: 'unaudited-fetch', line: 2 });

    const auditedSource = `import { auditedCall } from '@/lib/audit';

export async function run() {
  return auditedCall(
    { provider: "serper", operation: "search", kind: "external" },
    () => fetch("https://example.com/data"),
  );
}`;
    expect(analyzeSource('src/lib/services/example.ts', auditedSource, REGISTRY)).toEqual([]);

    // A module that imports auditedCall is on the envelope even when the raw
    // fetch sits in a helper the wrapper calls, which is how serper.ts is built.
    const helperSource = `import { auditedCall } from '@/lib/audit';

async function callProvider(endpoint: string) {
  return fetch(endpoint, { method: 'POST' });
}

export async function run() {
  return auditedCall(
    { provider: "serper", operation: "search", kind: "external" },
    () => callProvider('https://example.com/data'),
  );
}`;
    expect(analyzeSource('src/lib/services/example.ts', helperSource, REGISTRY)).toEqual([]);

    // A client module cannot reach the envelope at all: node:async_hooks is not
    // available in the browser bundle.
    const clientSource = `'use client'

export async function upload(endpoint: string) {
  return fetch(endpoint, { method: 'POST' });
}`;
    expect(analyzeSource('src/components/upload/example.ts', clientSource, REGISTRY)).toEqual([]);
  });

  it('passes on a relative fetch', () => {
    const source = `export async function run() {
  await fetch('/api/search?q=1');
}`;

    expect(analyzeSource('src/lib/services/example.ts', source, REGISTRY)).toEqual([]);
  });

  it('catches global fetch references but skips unrelated member methods', () => {
    const source = `export async function run() {
  await globalThis.fetch("https://example.com/global-this");
  await global.fetch("https://example.com/global");
  await window.fetch("https://example.com/window");
  await client.fetch("https://example.com/client");
}`;

    expect(analyzeSource('src/lib/services/example.ts', source, REGISTRY)).toEqual([
      expect.objectContaining({ kind: 'unaudited-fetch', line: 2 }),
      expect.objectContaining({ kind: 'unaudited-fetch', line: 3 }),
      expect.objectContaining({ kind: 'unaudited-fetch', line: 4 }),
    ]);
  });

  it('passes on a fetch inside src/lib/audit/', () => {
    expect(isExemptPath('src/lib/audit/envelope.ts')).toBe(true);
  });

  it('fails on an unregistered provider or operation string', () => {
    const unregisteredSource = `auditedCall({ provider: "serper", operation: "not_registered", kind: "external" }, async () => "ok");`;
    const unregisteredViolations = analyzeSource(
      'src/lib/services/example.ts',
      unregisteredSource,
      REGISTRY,
    );
    expect(unregisteredViolations).toEqual([
      expect.objectContaining({
        kind: 'unregistered-audit-spec',
        detail: 'serper.not_registered',
      }),
    ]);

    const registeredSource = `auditedCall({ provider: "serper", operation: "search", kind: "external" }, async () => "ok");`;
    expect(analyzeSource('src/lib/services/example.ts', registeredSource, REGISTRY)).toEqual([]);
  });

  it('passes on an allowlisted adapter', () => {
    const allowlistedPath = ALLOWED_UNAUDITED_FETCH.find(Boolean);
    if (!allowlistedPath) throw new Error('The allowlist must contain an adapter path.');

    expect(isExemptPath(allowlistedPath)).toBe(true);
  });
});
