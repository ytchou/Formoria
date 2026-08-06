"use client";

import { useCallback, useState, useTransition } from "react";

import {
  normalizeActionResult,
  type QueueActionResult,
} from "./normalize-action-result";

type QueueActionOptions = {
  getFailureId?: (failure: Record<string, unknown>) => string | undefined;
  onResult?: (result: QueueActionResult) => void;
};

export function useQueueAction(): {
  isPending: boolean;
  pendingIds: Set<string>;
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
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (
      ids: string[],
      fn: () => Promise<unknown>,
      opts?: QueueActionOptions,
    ): Promise<QueueActionResult> => {
      setPendingIds((current) => {
        const next = new Set(current);
        for (const id of ids) next.add(id);
        return next;
      });
      setError(null);

      try {
        let result: QueueActionResult;
        try {
          result = normalizeActionResult(await fn(), {
            getFailureId: opts?.getFailureId,
          });
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
        setPendingIds((current) => {
          const next = new Set(current);
          for (const id of ids) next.delete(id);
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
    (id: string) => pendingIds.has(id),
    [pendingIds],
  );
  const clearError = useCallback(() => setError(null), []);

  return {
    isPending,
    pendingIds,
    isRowPending,
    error,
    setError,
    clearError,
    run,
    runBulk,
  };
}
