import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { cache } from "react";

export type AuditContext = {
  correlationId: string | null;
  actor?: string;
  requestId?: string;
};

export type AuditContextSeed = Partial<AuditContext>;

const auditContextStorage = new AsyncLocalStorage<AuditContext>();

/**
 * React `cache()` memoizes per request. Outside a React request context it does
 * NOT throw — it silently calls through un-memoized, returning a fresh object
 * (and a fresh id) on every call. That failure mode is invisible, so we never
 * trust `getRequestScope()` directly; `readRequestScope()` below proves a cache
 * is actually active before using its value.
 */
const getRequestScope = cache((): AuditContext => ({
  correlationId: newCorrelationId(),
}));

/**
 * Returns the per-request scope only when React's request cache is genuinely
 * active. Detection uses the public API only: under a live request both calls
 * return the SAME memoized object; with no dispatcher each call constructs a
 * new one. Reference identity is therefore the presence check.
 */
function readRequestScope(): AuditContext | null {
  try {
    const probeA = getRequestScope();
    const probeB = getRequestScope();
    return probeA === probeB ? probeA : null;
  } catch {
    return null;
  }
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function runWithAuditContext<T>(
  seed: AuditContextSeed,
  fn: () => T,
): T {
  const context: AuditContext = {
    ...seed,
    correlationId: seed.correlationId ?? newCorrelationId(),
  };

  return auditContextStorage.run(context, fn);
}

export function getAuditContext(): AuditContext {
  try {
    const asyncContext = auditContextStorage.getStore();
    if (asyncContext) {
      return asyncContext;
    }

    return readRequestScope() ?? { correlationId: null };
  } catch {
    return { correlationId: null };
  }
}

/** Spike-only: raw, unguarded access to the React cache() scope for gate diagnostics. */
export function __rawRequestScope(): AuditContext {
  return getRequestScope();
}
