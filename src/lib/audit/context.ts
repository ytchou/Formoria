import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import type { AuditContext } from "./types";

export type AuditContextSeed = Partial<AuditContext>;

const auditContextStorage = new AsyncLocalStorage<AuditContext>();

/**
 * `AsyncLocalStorage` above is the PRIMARY mechanism. This React `cache()`
 * layer is a best-effort fallback and is deliberately UNTRUSTED.
 *
 * Wave-1 spike result, measured on Next 16.2.10: inside a Route Handler,
 * `cache()` returned a DIFFERENT object and a DIFFERENT uuid on every read
 * within one request -- it does not give one stable identity per request, and
 * it fails SILENTLY (it never throws). So the request scope is only ever read
 * through the identity check below.
 */
const getRequestScope = cache((): AuditContext => ({
  correlationId: newCorrelationId(),
}));

/**
 * LOAD-BEARING -- do not "simplify" this away, and do not replace it with a
 * try/catch. `cache()` does not throw when no request cache is active; it
 * silently calls through un-memoized, so an exception is never the signal.
 * The only usable presence check is reference identity: the value is accepted
 * only when two consecutive calls return the SAME object. On the runtimes
 * measured so far that check fails and this returns null, which is correct --
 * a fresh uuid per read is noise, not correlation.
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

/**
 * A nested scope INHERITS the ambient correlation id. Minting a fresh id on
 * every entry fragmented one logical request across several ids as soon as a
 * scoped server action called anything that opened its own scope -- which is
 * the whole failure this correlation trail exists to prevent. An explicit
 * `seed.correlationId` still wins, and two sibling (non-nested) scopes still
 * get distinct ids because neither sees the other's store.
 */
export function runWithAuditContext<T>(seed: AuditContextSeed, fn: () => T): T {
  const context: AuditContext = {
    ...seed,
    correlationId:
      seed.correlationId ?? getAuditContext().correlationId ?? newCorrelationId(),
  };

  return auditContextStorage.run(context, fn);
}

export function getAuditContext(): AuditContext {
  try {
    const asyncContext = auditContextStorage.getStore();
    if (asyncContext) return asyncContext;

    return readRequestScope() ?? { correlationId: null };
  } catch {
    return { correlationId: null };
  }
}
