/**
 * A Supabase client that reads production and silently drops every write.
 *
 * The model A/B harness runs the real enrichment pipeline against live brand
 * rows. `dryRun` already guards the *intentional* writes, but it is a flag
 * threaded through two thousand lines by hand — trusting it is trusting that
 * every one of those branches is correct, forever. This wrapper makes the
 * guarantee structural instead: a write cannot reach Postgres because the
 * method that would issue it never returns a real builder.
 *
 * Dropped writes are counted, not swallowed. A run that would have written is
 * a run whose `dryRun` coverage has a hole, and the harness prints the tally so
 * the hole is visible rather than inferred.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const MUTATING_METHODS = new Set(["insert", "update", "upsert", "delete"]);

/**
 * Every storage-js bucket method this wrapper will let through. An ALLOW-list,
 * deliberately: this client points at PRODUCTION, so a storage-js release that
 * adds a new writing method must fail closed rather than pass through unnamed.
 * A deny-list gets that backwards — it is safe only until the SDK grows a verb
 * nobody updated it for.
 *
 * `createSignedUploadUrl` is absent for the same reason it would head a
 * deny-list: handing out an upload token is a write with a delay, not a read.
 * Add a method here only after confirming it cannot mutate an object.
 */
const READABLE_STORAGE_METHODS = new Set([
  "download",
  "list",
  "info",
  "exists",
  "getPublicUrl",
  "createSignedUrl",
  "createSignedUrls",
]);

export type BlockedWrite = { table: string; method: string };

/**
 * A builder that is thenable, infinitely chainable, and resolves to one
 * synthetic row.
 *
 * It carries an `id` because callers legitimately depend on getting one back:
 * `startSearchAudit` inserts, reads the new id, and *throws* if it is missing —
 * deliberately, since an un-auditable provider call is a real failure in
 * production. Returning null there would fail the run for a reason that has
 * nothing to do with the models under test.
 */
function inertBuilder(): unknown {
  const row = { id: randomUUID() };
  const resolved = {
    data: [row],
    error: null,
    count: 1,
    status: 201,
    statusText: "Created",
  };
  const target = function () {} as unknown as Record<string, unknown>;
  return new Proxy(target, {
    get(_t, prop) {
      // `await builder` — PostgREST builders are thenables, so this is what
      // makes a dropped write indistinguishable from a successful one.
      if (prop === "then") {
        return (resolve: (value: unknown) => unknown) =>
          Promise.resolve(resolve(resolved));
      }
      if (prop === "catch" || prop === "finally") {
        return () => inertBuilder();
      }
      if (prop === "single" || prop === "maybeSingle") {
        return () => Promise.resolve({ ...resolved, data: row });
      }
      if (prop === Symbol.toStringTag) return "InertPostgrestBuilder";
      return () => inertBuilder();
    },
    apply() {
      return inertBuilder();
    },
  });
}

/** A builder whose every chained filter is ignored and which resolves to `rows`. */
function shimBuilder(rows: unknown[]): unknown {
  const resolved = {
    data: rows,
    error: null,
    count: rows.length,
    status: 200,
    statusText: "OK",
  };
  const target = function () {} as unknown as Record<string, unknown>;
  return new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (value: unknown) => unknown) =>
          Promise.resolve(resolve(resolved));
      }
      if (prop === "catch" || prop === "finally")
        return () => shimBuilder(rows);
      // `.single()` collapses to the first row, matching PostgREST's contract.
      if (prop === "single" || prop === "maybeSingle") {
        return () => Promise.resolve({ ...resolved, data: rows.at(0) ?? null });
      }
      return () => shimBuilder(rows);
    },
    apply() {
      return shimBuilder(rows);
    },
  });
}

export function createWriteBlockingClient(
  url: string,
  serviceKey: string,
  /**
   * Tables whose SELECT is answered from memory instead of Postgres. Used to
   * hand `runEnrich` a set of submission rows that were never inserted —
   * brand-target enrichment is retired, so a refresh submission is the only
   * shape the pipeline accepts, and creating a real one would be a write.
   */
  readShims: Map<string, unknown[]> = new Map(),
): {
  client: SupabaseClient;
  blocked: BlockedWrite[];
} {
  const real = createClient(url, serviceKey);
  const blocked: BlockedWrite[] = [];

  const client = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => {
          const shim = readShims.get(table);
          if (shim) {
            return new Proxy(
              function () {} as unknown as Record<string, unknown>,
              {
                get(_t, builderProp) {
                  if (
                    typeof builderProp === "string" &&
                    MUTATING_METHODS.has(builderProp)
                  ) {
                    return (..._args: unknown[]) => {
                      blocked.push({ table, method: builderProp });
                      return inertBuilder();
                    };
                  }
                  return () => shimBuilder(shim);
                },
              },
            );
          }
          const builder = target.from(table);
          return new Proxy(builder, {
            get(builderTarget, builderProp, builderReceiver) {
              if (
                typeof builderProp === "string" &&
                MUTATING_METHODS.has(builderProp)
              ) {
                return (..._args: unknown[]) => {
                  blocked.push({ table, method: builderProp });
                  return inertBuilder();
                };
              }
              const value = Reflect.get(
                builderTarget,
                builderProp,
                builderReceiver,
              );
              return typeof value === "function"
                ? value.bind(builderTarget)
                : value;
            },
          });
        };
      }

      // Storage mutations and RPCs are writes we cannot inspect
      // argument-by-argument, so they are refused outright rather than
      // approximated. Named storage READS pass through to the real bucket:
      // copying production objects into staging (`sync-staging-from-prod.ts`)
      // has to download from a client that structurally cannot write, and a
      // read is exactly what this wrapper exists to allow.
      if (prop === "storage") {
        const realStorage = target.storage;
        return {
          from: (bucket: string) => {
            const realBucket = realStorage.from(bucket);
            return new Proxy(realBucket, {
              get(bucketTarget, bucketProp, bucketReceiver) {
                const value = Reflect.get(
                  bucketTarget,
                  bucketProp,
                  bucketReceiver,
                );
                // Non-methods carry no write, and letting them through keeps
                // the bucket object introspectable.
                if (typeof value !== "function") {
                  return value;
                }
                if (
                  typeof bucketProp !== "string" ||
                  !READABLE_STORAGE_METHODS.has(bucketProp)
                ) {
                  return async (..._args: unknown[]) => {
                    blocked.push({
                      table: "storage",
                      method: String(bucketProp),
                    });
                    return { data: null, error: null };
                  };
                }
                return value.bind(bucketTarget);
              },
            });
          },
        };
      }
      if (prop === "rpc") {
        return (name: string) => {
          blocked.push({ table: `rpc:${name}`, method: "rpc" });
          return inertBuilder();
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return { client: client as SupabaseClient, blocked };
}
