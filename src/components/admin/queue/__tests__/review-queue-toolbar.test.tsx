// @vitest-environment jsdom
import { useMemo } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ReviewQueueToolbar } from "../review-queue-toolbar";
import { useReviewQueue } from "../use-review-queue";
import type { ReviewFilter } from "../types";
import {
  isDateInRange,
  isoDateInTimeZone,
  type IsoDateRange,
} from "@/lib/date-range";

type Submission = { id: string; submittedAt: string };

/**
 * Taipei is UTC+8, so an instant late in a UTC day already belongs to the NEXT
 * Taipei day. `lateOnEndDay` and `justAfterEndDay` are 60 minutes apart and
 * straddle Taipei midnight: under a UTC comparison both fall on 2026-08-20 and
 * both would pass. Only the Taipei conversion separates them, which is the
 * whole reason the predicate names a time zone.
 */
const ITEMS: Submission[] = [
  { id: "beforeRange", submittedAt: "2026-08-01T04:00:00.000Z" },
  { id: "insideRange", submittedAt: "2026-08-15T04:00:00.000Z" },
  { id: "lateOnEndDay", submittedAt: "2026-08-20T15:30:00.000Z" },
  { id: "justAfterEndDay", submittedAt: "2026-08-20T16:30:00.000Z" },
];

const FROM_LABEL = "Submitted from";
const TO_LABEL = "Submitted through";
const CLEAR_LABEL = "Clear submitted date range";

function Harness({ items = ITEMS }: { items?: Submission[] } = {}) {
  const filters = useMemo<ReviewFilter<Submission>[]>(
    () => [
      {
        id: "submittedRange",
        kind: "dateRange",
        label: "Submitted date",
        rangeLabels: { from: FROM_LABEL, to: TO_LABEL },
        clearLabel: CLEAR_LABEL,
        predicate: (submission, value) =>
          isDateInRange(
            isoDateInTimeZone(submission.submittedAt, "Asia/Taipei"),
            value as IsoDateRange | null,
          ),
      },
    ],
    [],
  );

  const queue = useReviewQueue<Submission>({
    items,
    getId: (submission) => submission.id,
    filters,
    pageSize: null,
  });

  return (
    <div>
      <ReviewQueueToolbar queue={queue} />
      <ul>
        {queue.filtered.map((submission) => (
          <li key={submission.id}>{submission.id}</li>
        ))}
      </ul>
    </div>
  );
}

function visibleIds() {
  return screen.getAllByRole("listitem").map((node) => node.textContent);
}

describe("ReviewQueueToolbar date range", () => {
  it("gives both date inputs a visible label", () => {
    render(<Harness />);

    const from = screen.getByLabelText(FROM_LABEL);
    const to = screen.getByLabelText(TO_LABEL);

    expect(from).toHaveAttribute("type", "date");
    expect(to).toHaveAttribute("type", "date");
    // A placeholder is not a label — it disappears the moment the field is
    // focused, which is exactly when the user needs it.
    expect(from).not.toHaveAttribute("placeholder");
    expect(to).not.toHaveAttribute("placeholder");
    expect(from.id).toBeTruthy();
    expect(document.querySelector(`label[for="${from.id}"]`)).toHaveTextContent(
      FROM_LABEL,
    );
    expect(document.querySelector(`label[for="${to.id}"]`)).toHaveTextContent(
      TO_LABEL,
    );
  });

  it("filters by an inclusive Taipei date range", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText(FROM_LABEL), {
      target: { value: "2026-08-10" },
    });
    fireEvent.change(screen.getByLabelText(TO_LABEL), {
      target: { value: "2026-08-20" },
    });

    // `lateOnEndDay` is 2026-08-20 23:30 in Taipei: the end day is included.
    // `justAfterEndDay` is 2026-08-21 00:30 in Taipei, so it is not.
    expect(visibleIds()).toEqual(["insideRange", "lateOnEndDay"]);
  });

  it("filters on one bound when only one is entered", () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText(FROM_LABEL), {
      target: { value: "2026-08-10" },
    });

    expect(visibleIds()).toEqual([
      "insideRange",
      "lateOnEndDay",
      "justAfterEndDay",
    ]);
  });

  it("clears the range", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    fireEvent.change(screen.getByLabelText(FROM_LABEL), {
      target: { value: "2026-08-10" },
    });
    fireEvent.change(screen.getByLabelText(TO_LABEL), {
      target: { value: "2026-08-20" },
    });
    expect(visibleIds()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: CLEAR_LABEL }));

    expect(visibleIds()).toEqual(ITEMS.map((item) => item.id));
    expect(screen.getByLabelText(FROM_LABEL)).toHaveValue("");
    expect(screen.getByLabelText(TO_LABEL)).toHaveValue("");
  });

  it("offers no clear control until a bound is set", () => {
    render(<Harness />);

    expect(
      screen.queryByRole("button", { name: CLEAR_LABEL }),
    ).not.toBeInTheDocument();
  });
});
