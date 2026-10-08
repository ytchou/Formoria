"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
  type TransitionStartFunction,
} from "react";
import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** DESIGN.md §7b: no spinner unless the pending state outlasts this. */
export const PENDING_SPINNER_DELAY_MS = 300;

type ResultsTransitionValue = {
  isPending: boolean;
  startTransition: TransitionStartFunction;
  reportLinkPending: (pending: boolean) => void;
};

const ResultsTransitionContext = createContext<ResultsTransitionValue | null>(
  null,
);

/**
 * One pending state for a listing's filters and sort (DESIGN.md §7b). Every
 * router navigation started through `useResultsTransition`, and every filter
 * `<Link>` carrying a `ResultsLinkPendingReporter`, marks the results pending.
 * Renders no DOM.
 */
export function ResultsTransitionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isTransitionPending, startTransition] = useTransition();
  const [pendingLinks, setPendingLinks] = useState(0);

  const reportLinkPending = useCallback((pending: boolean) => {
    setPendingLinks((count) => Math.max(0, count + (pending ? 1 : -1)));
  }, []);

  const isPending = isTransitionPending || pendingLinks > 0;
  const value = useMemo(
    () => ({ isPending, startTransition, reportLinkPending }),
    [isPending, startTransition, reportLinkPending],
  );

  return (
    <ResultsTransitionContext.Provider value={value}>
      {children}
    </ResultsTransitionContext.Provider>
  );
}

/**
 * The listing's shared transition, or a local one when no
 * `ResultsTransitionProvider` is mounted.
 */
export function useResultsTransition(): [boolean, TransitionStartFunction] {
  const local = useTransition();
  const context = useContext(ResultsTransitionContext);
  return context ? [context.isPending, context.startTransition] : local;
}

/**
 * Render inside a filter `<Link>`: reports the link's pending navigation to
 * the provider. A no-op without a provider; renders nothing.
 */
export function ResultsLinkPendingReporter() {
  const { pending } = useLinkStatus();
  const report = useContext(ResultsTransitionContext)?.reportLinkPending;

  useEffect(() => {
    if (!pending || !report) return;
    report(true);
    return () => report(false);
  }, [pending, report]);

  return null;
}

/**
 * The results region: stays in place at 60% opacity while pending, carries
 * aria-busy, and shows a spinner only past `PENDING_SPINNER_DELAY_MS`.
 */
export function PendingResults({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [isPending] = useResultsTransition();
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (!isPending) return;
    const timer = setTimeout(
      () => setShowSpinner(true),
      PENDING_SPINNER_DELAY_MS,
    );
    return () => {
      clearTimeout(timer);
      setShowSpinner(false);
    };
  }, [isPending]);

  return (
    <div className={cn("relative", className)}>
      <div
        aria-busy={isPending || undefined}
        data-pending={isPending || undefined}
        className={cn(
          "motion-safe:transition-opacity motion-safe:duration-150",
          isPending && "opacity-60",
        )}
      >
        {children}
      </div>
      {isPending && showSpinner && (
        <Loader2
          aria-hidden="true"
          data-testid="results-pending-spinner"
          className="pointer-events-none absolute left-1/2 top-4 size-5 -translate-x-1/2 text-ink-muted motion-safe:animate-spin"
        />
      )}
    </div>
  );
}
