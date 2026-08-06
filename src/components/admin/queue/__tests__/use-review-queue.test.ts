// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useReviewQueue } from "../use-review-queue";

type QueueItem = {
  id: string;
  status: string;
  stage: string;
  selectable?: boolean;
};

const items: QueueItem[] = [
  { id: "item-1", status: "pending", stage: "ready", selectable: true },
  { id: "item-2", status: "pending", stage: "needs_data", selectable: false },
  { id: "item-3", status: "approved", stage: "ready", selectable: true },
  { id: "item-4", status: "rejected", stage: "skipped", selectable: false },
  { id: "item-5", status: "pending", stage: "enriching", selectable: true },
];

describe("useReviewQueue", () => {
  it("scopes select-all to visible and selectable rows only", () => {
    const { result } = renderHook(() =>
      useReviewQueue({
        items,
        getId: (item) => item.id,
        isSelectable: (item) => Boolean(item.selectable),
        pageSize: 3,
      }),
    );

    act(() => result.current.toggleSelectAll());

    expect([...result.current.selectedIds]).toEqual(["item-1", "item-3"]);
  });

  it("reports indeterminate when some but not all visible selectable rows are chosen", () => {
    const { result } = renderHook(() =>
      useReviewQueue({
        items: items.slice(0, 3),
        getId: (item) => item.id,
        isSelectable: () => true,
        pageSize: null,
      }),
    );

    act(() => result.current.setSelectedIds(new Set(["item-1"])));

    expect(result.current.someSelected).toBe(true);
    expect(result.current.allSelected).toBe(false);

    act(() => result.current.toggleSelectAll());

    expect(result.current.someSelected).toBe(false);
    expect(result.current.allSelected).toBe(true);
  });

  it("derives tab counts from match predicates, not a single field", () => {
    const { result } = renderHook(() =>
      useReviewQueue({
        items,
        getId: (item) => item.id,
        tabs: [
          {
            value: "approved",
            label: "Approved",
            match: (item) => item.status === "approved",
          },
          {
            value: "needs-data",
            label: "Needs data",
            match: (item) => item.stage === "needs_data",
          },
        ],
        pageSize: null,
      }),
    );

    expect(result.current.tabCounts).toEqual({
      approved: 1,
      "needs-data": 1,
    });
  });

  it("resetView clears selection, page, and open row", () => {
    const { result } = renderHook(() =>
      useReviewQueue({
        items,
        getId: (item) => item.id,
        isSelectable: () => true,
        pageSize: 2,
      }),
    );

    act(() => {
      result.current.setPage(2);
      result.current.setSelectedIds(new Set(["item-1"]));
      result.current.setOpenId("item-1");
    });

    act(() => result.current.resetView());

    expect(result.current.page).toBe(1);
    expect(result.current.selectedIds).toEqual(new Set());
    expect(result.current.openId).toBeNull();
  });

  it("hiddenIds removes rows from visible without refetching", () => {
    const sourceItems = items.slice(0, 3);
    const { result } = renderHook(() =>
      useReviewQueue({
        items: sourceItems,
        getId: (item) => item.id,
        tabs: [
          {
            value: "all",
            label: "All",
            match: () => true,
          },
          {
            value: "ready",
            label: "Ready",
            match: (item) => item.stage === "ready",
          },
        ],
        initialTab: "all",
        pageSize: null,
      }),
    );

    act(() => result.current.hideIds(["item-1"]));

    expect(result.current.visible.map((item) => item.id)).toEqual([
      "item-2",
      "item-3",
    ]);
    expect(result.current.tabCounts.ready).toBe(1);
  });

  it("releases a hidden id once the incoming item satisfies releaseHidden", () => {
    const pendingItems: QueueItem[] = [
      { id: "item-1", status: "pending", stage: "ready" },
      { id: "item-2", status: "pending", stage: "ready" },
    ];
    const { result, rerender } = renderHook(
      (props: { items: QueueItem[] }) =>
        useReviewQueue({
          items: props.items,
          getId: (item) => item.id,
          releaseHidden: (item) => item.status !== "pending",
          tabs: [
            { value: "all", label: "All", match: () => true },
            {
              value: "approved",
              label: "Approved",
              match: (item) => item.status === "approved",
            },
          ],
          initialTab: "all",
          pageSize: null,
        }),
      { initialProps: { items: pendingItems } },
    );

    act(() => result.current.hideIds(["item-1"]));

    expect(result.current.visible.map((item) => item.id)).toEqual(["item-2"]);
    expect(result.current.hiddenIds.has("item-1")).toBe(true);
    expect(result.current.tabCounts.approved).toBe(0);

    // The server catches up and pushes new props. No refetch, no showIds call,
    // no effect — the latch releases purely from the incoming items.
    rerender({
      items: [
        { id: "item-1", status: "approved", stage: "ready" },
        { id: "item-2", status: "pending", stage: "ready" },
      ],
    });

    expect(result.current.visible.map((item) => item.id)).toEqual([
      "item-1",
      "item-2",
    ]);
    expect(result.current.hiddenIds.has("item-1")).toBe(false);
    expect(result.current.tabCounts.approved).toBe(1);
  });

  it("never re-hides a released id when it returns to the un-released state", () => {
    // Regression: the latch only ever grew, so a release was not permanent.
    // Reject item-1 (latched) → props catch up (released) → an admin reopens
    // item-1 back to `pending`, and it vanished from the table AND from every
    // tab count with no way back short of a full reload.
    const pendingItems: QueueItem[] = [
      { id: "item-1", status: "pending", stage: "ready" },
      { id: "item-2", status: "pending", stage: "ready" },
    ];
    const { result, rerender } = renderHook(
      (props: { items: QueueItem[] }) =>
        useReviewQueue({
          items: props.items,
          getId: (item) => item.id,
          releaseHidden: (item) => item.status !== "pending",
          tabs: [
            { value: "all", label: "All", match: () => true },
            {
              value: "pending",
              label: "Pending",
              match: (item) => item.status === "pending",
            },
          ],
          initialTab: "all",
          pageSize: null,
        }),
      { initialProps: { items: pendingItems } },
    );

    act(() => result.current.hideIds(["item-1"]));
    expect(result.current.visible.map((item) => item.id)).toEqual(["item-2"]);

    // The server catches up: item-1 is rejected, so the latch releases it.
    rerender({
      items: [
        { id: "item-1", status: "rejected", stage: "ready" },
        { id: "item-2", status: "pending", stage: "ready" },
      ],
    });
    expect(result.current.hiddenIds.has("item-1")).toBe(false);

    // The admin reopens item-1, so `releaseHidden` is false for it again. A
    // released id must stay released.
    rerender({ items: [...pendingItems] });

    expect(result.current.hiddenIds.has("item-1")).toBe(false);
    expect(result.current.visible.map((item) => item.id)).toEqual([
      "item-1",
      "item-2",
    ]);
    expect(result.current.tabCounts.pending).toBe(2);
  });

  it("keeps a row hidden while releaseHidden is still unsatisfied", () => {
    const pendingItems: QueueItem[] = [
      { id: "item-1", status: "pending", stage: "ready" },
      { id: "item-2", status: "pending", stage: "ready" },
    ];
    const { result, rerender } = renderHook(
      (props: { items: QueueItem[] }) =>
        useReviewQueue({
          items: props.items,
          getId: (item) => item.id,
          releaseHidden: (item) => item.status !== "pending",
          pageSize: null,
        }),
      { initialProps: { items: pendingItems } },
    );

    act(() => result.current.hideIds(["item-1"]));
    rerender({ items: [...pendingItems] });

    expect(result.current.visible.map((item) => item.id)).toEqual(["item-2"]);
  });

  it("fires onTabChange and onViewReset when the tab changes", () => {
    const onTabChange = vi.fn();
    const onViewReset = vi.fn();
    const { result } = renderHook(() =>
      useReviewQueue({
        items,
        getId: (item) => item.id,
        tabs: [
          { value: "all", label: "All", match: () => true },
          {
            value: "ready",
            label: "Ready",
            match: (item) => item.stage === "ready",
          },
        ],
        initialTab: "all",
        onTabChange,
        onViewReset,
        pageSize: null,
      }),
    );

    act(() => result.current.setActiveTab("ready"));

    expect(onTabChange).toHaveBeenCalledWith("ready");
    expect(onViewReset).toHaveBeenCalledTimes(1);
    expect(result.current.activeTab).toBe("ready");
  });

  it("clears the open row when a filter value changes", () => {
    const { result } = renderHook(() =>
      useReviewQueue({
        items,
        getId: (item) => item.id,
        filters: [
          {
            id: "search",
            kind: "search",
            label: "Search",
            predicate: (item, value) =>
              item.id.includes(String(value ?? "")),
          },
        ],
        pageSize: null,
      }),
    );

    act(() => result.current.setOpenId("item-1"));
    expect(result.current.openId).toBe("item-1");

    act(() => result.current.setFilterValue("search", "item-5"));

    expect(result.current.openId).toBeNull();
    expect(result.current.visible.map((item) => item.id)).toEqual(["item-5"]);
  });

  it("pageSize null disables pagination", () => {
    const { result } = renderHook(() =>
      useReviewQueue({
        items,
        getId: (item) => item.id,
        pageSize: null,
      }),
    );

    expect(result.current.visible.length).toBe(result.current.filtered.length);
    expect(result.current.pageCount).toBe(1);
  });
});
