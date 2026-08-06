"use client";

import { useCallback, useState, useTransition } from "react";

import {
  normalizeActionResult,
  type QueueActionResult,
} from "./normalize-action-result";

type QueueActionOptions = {
  onResult?: (result: QueueActionResult) => void;
};

export function useQueueAction(): {
  isPending: boolean;
  isRowPending: (id: string) => boolean;
  error: string | null;
  setError: (message: string | null) => void;
  clearError: () => void;
  run: (
    ids: string[],
    fn: () => Promise<unknown>,
    opts?: QueueActionOptions,
  ) => Promise<QueueActionResult>;
  runBulk: (
    ids: string[],
    fn: () => Promise<unknown>,
    opts?: QueueActionOptions,
  ) => void;
} {
  const [isPending, startTransition] = useTransition();
  // Occupancy count, not a membership Set: two overlapping runs touching the
  // same id used to have the FIRST one to settle clear the flag, so
  // `isRowPending` went false, `aria-busy` dropped, and the decision buttons
  // re-enabled while a request was still in flight — reopening the very
  // double-submit the flag exists to prevent. A row stays pending until every
  // run holding it has settled.
  const [pendingCounts, setPendingCounts] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      ids: string[],
      fn: () => Promise<unknown>,
      opts?: QueueActionOptions,
    ): Promise<QueueActionResult> => {
      // De-duped so acquire and release stay symmetric even if a caller passes
      // the same id twice in one batch.
      const heldIds = [...new Set(ids)];

      setPendingCounts((current) => {
        const next = new Map(current);
        for (const id of heldIds) next.set(id, (next.get(id) ?? 0) + 1);
        return next;
      });
      setError(null);

      try {
        let result: QueueActionResult;
        try {
          result = normalizeActionResult(await fn());
        } catch (caught) {
          result = {
            ok: false,
            error:
              caught instanceof Error && caught.message.length > 0
                ? caught.message
                : typeof caught === "string" && caught.length > 0
                  ? caught
                : "Action failed",
            raw: caught,
          };
        }

        if (!result.ok) setError(result.error);
        opts?.onResult?.(result);
        return result;
      } finally {
        setPendingCounts((current) => {
          const next = new Map(current);
          for (const id of heldIds) {
            const remaining = (next.get(id) ?? 0) - 1;
            if (remaining > 0) next.set(id, remaining);
            else next.delete(id);
          }
          return next;
        });
      }
    },
    [],
  );

  const runBulk = useCallback(
    (ids: string[], fn: () => Promise<unknown>, opts?: QueueActionOptions) => {
      startTransition(async () => {
        await run(ids, fn, opts);
      });
    },
    [run, startTransition],
  );

  const isRowPending = useCallback(
    (id: string) => pendingCounts.has(id),
    [pendingCounts],
  );
  const clearError = useCallback(() => setError(null), []);

  return {
    isPending,
    isRowPending,
    error,
    setError,
    clearError,
    run,
    runBulk,
  };
}
