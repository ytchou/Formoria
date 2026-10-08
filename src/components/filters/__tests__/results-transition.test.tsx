/**
 * @vitest-environment jsdom
 */
import { useEffect, type TransitionStartFunction } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const link = vi.hoisted(() => ({ pending: false }));

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: link.pending }),
}));

const {
  PENDING_SPINNER_DELAY_MS,
  PendingResults,
  ResultsLinkPendingReporter,
  ResultsTransitionProvider,
  useResultsTransition,
} = await import("../results-transition");

const SPINNER = "results-pending-spinner";

let start: TransitionStartFunction | undefined;

function TransitionProbe() {
  const [isPending, startTransition] = useResultsTransition();
  useEffect(() => {
    start = startTransition;
  }, [startTransition]);
  return <span data-testid="probe" data-pending={String(isPending)} />;
}

function probePending() {
  return screen.getByTestId("probe").getAttribute("data-pending");
}

function region() {
  return screen.getByText("results").parentElement as HTMLElement;
}

function Listing({ withReporter = false }: { withReporter?: boolean }) {
  return (
    <ResultsTransitionProvider>
      <TransitionProbe />
      {withReporter && <ResultsLinkPendingReporter />}
      <PendingResults>
        <p>results</p>
      </PendingResults>
    </ResultsTransitionProvider>
  );
}

afterEach(() => {
  link.pending = false;
  start = undefined;
  vi.useRealTimers();
});

describe("PendingResults", () => {
  it("is neither busy nor dimmed while idle", () => {
    render(<Listing />);
    expect(region().getAttribute("aria-busy")).toBeNull();
    expect(region().className).not.toContain("opacity-60");
    expect(screen.queryByTestId(SPINNER)).toBeNull();
  });

  it("dims and marks busy while a shared transition is pending", async () => {
    render(<Listing />);
    let resolve!: () => void;
    const navigation = new Promise<void>((r) => {
      resolve = r;
    });

    await act(async () => {
      start!(async () => {
        await navigation;
      });
    });
    expect(region().getAttribute("aria-busy")).toBe("true");
    expect(region().className).toContain("opacity-60");
    // The content stays in place while pending.
    expect(screen.getByText("results")).toBeTruthy();

    await act(async () => {
      resolve();
      await navigation;
    });
    expect(region().getAttribute("aria-busy")).toBeNull();
    expect(region().className).not.toContain("opacity-60");
  });

  it("shows the spinner only after the pending state outlasts the delay", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Listing withReporter />);

    link.pending = true;
    rerender(<Listing withReporter />);
    expect(region().getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId(SPINNER)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(PENDING_SPINNER_DELAY_MS - 1);
    });
    expect(screen.queryByTestId(SPINNER)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    const spinner = screen.getByTestId(SPINNER);
    expect(spinner.getAttribute("aria-hidden")).toBe("true");
    // The dim belongs to the results, never the spinner.
    expect(region().contains(spinner)).toBe(false);

    link.pending = false;
    rerender(<Listing withReporter />);
    expect(screen.queryByTestId(SPINNER)).toBeNull();
    expect(region().getAttribute("aria-busy")).toBeNull();
  });
});

describe("ResultsLinkPendingReporter", () => {
  it("marks the results busy while its link is pending", () => {
    const { rerender } = render(<Listing withReporter />);
    expect(region().getAttribute("aria-busy")).toBeNull();

    link.pending = true;
    rerender(<Listing withReporter />);
    expect(region().getAttribute("aria-busy")).toBe("true");
    expect(probePending()).toBe("true");

    link.pending = false;
    rerender(<Listing withReporter />);
    expect(region().getAttribute("aria-busy")).toBeNull();
  });

  it("releases the pending state when unmounted mid-navigation", () => {
    link.pending = true;
    const { rerender } = render(<Listing withReporter />);
    expect(region().getAttribute("aria-busy")).toBe("true");

    rerender(<Listing />);
    expect(region().getAttribute("aria-busy")).toBeNull();
  });

  it("renders nothing and is a no-op without a provider", () => {
    link.pending = true;
    const { container } = render(<ResultsLinkPendingReporter />);
    expect(container.innerHTML).toBe("");
  });
});

describe("useResultsTransition", () => {
  it("falls back to a local transition without a provider", async () => {
    render(<TransitionProbe />);
    expect(probePending()).toBe("false");
    expect(typeof start).toBe("function");

    await act(async () => {
      start!(async () => {
        await new Promise<void>(() => {});
      });
    });
    expect(probePending()).toBe("true");
  });
});
