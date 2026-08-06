"use client";

import { useCallback, useMemo, useState } from "react";

import type { IsoDateRange } from "@/lib/date-range";
import type {
  ReviewFilter,
  ReviewFilterValue,
  ReviewQueueState,
  ReviewTab,
} from "./types";

const DEFAULT_PAGE_SIZE = 10;
// Module-level so the `?? ` fallbacks below keep a stable identity across
// renders instead of minting a fresh array/function each time.
const EMPTY_LIST: never[] = [];
const NEVER_SELECTABLE = () => false;

export function useReviewQueue<T>(opts: {
  items: T[];
  getId: (item: T) => string;
  tabs?: ReviewTab<T>[];
  filters?: ReviewFilter<T>[];
  isSelectable?: (item: T) => boolean;
  pageSize?: number | null;
  initialTab?: string;
  /**
   * Release condition for an optimistically hidden row. `hideIds` is a
   * self-releasing latch, not a permanent removal: a hidden id drops out of
   * `hiddenIds` the moment the INCOMING `items` say the server caught up.
   *
   * Submissions passes `(s) => s.status !== "pending"`, mirroring
   * `!completedApprovalIds.has(id) || status !== "pending"`. This matters
   * because `bulkApprove` does not call `router.refresh()` — it waits on
   * `revalidatePath` pushing new props. Without a release condition, approved
   * rows stay hidden for the life of the mount and the Approved tab undercounts.
   *
   * The release is DERIVED during render from `items`. It is deliberately not a
   * prop-mirroring effect that calls `showIds`: a client copy of a server object
   * goes blind to `router.refresh()` (admin/brands, 2026-08-01), and six queues
   * would inherit that.
   */
  releaseHidden?: (item: T) => boolean;
  /** Fired inside `setActiveTab`, so a consumer can sync `?stage=` via `router.replace`. */
  onTabChange?: (value: string) => void;
  /** Fired inside `resetView` (and therefore on tab, filter, and page-size changes). */
  onViewReset?: () => void;
}): ReviewQueueState<T> {
  // Destructured so react-hooks/exhaustive-deps can track these as plain
  // identifiers; it cannot follow member expressions on a parameter, and the
  // `?? []` fallbacks would otherwise mint a new identity on every render.
  const { items, getId, releaseHidden, isSelectable } = opts;
  const tabs = useMemo(
    () => opts.tabs ?? (EMPTY_LIST as ReviewTab<T>[]),
    [opts.tabs],
  );
  const filters = useMemo(
    () => opts.filters ?? (EMPTY_LIST as ReviewFilter<T>[]),
    [opts.filters],
  );
  const selectionEnabled = isSelectable !== undefined;
  const selectablePredicate = useMemo(
    () => isSelectable ?? NEVER_SELECTABLE,
    [isSelectable],
  );

  const [activeTab, setActiveTabState] = useState(
    () => opts.initialTab ?? tabs[0]?.value ?? "",
  );
  const [filterValues, setFilterValues] = useState<
    Record<string, ReviewFilterValue>
  >(() =>
    filters.reduce<Record<string, ReviewFilterValue>>((values, filter) => {
      values[filter.id] = filter.defaultValue ?? null;
      return values;
    }, {}),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [hiddenLatch, setHiddenLatch] = useState<Set<string>>(() => new Set());
  const [pageState, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState<number | null>(() =>
    opts.pageSize === undefined ? DEFAULT_PAGE_SIZE : opts.pageSize,
  );

  const { onTabChange, onViewReset } = opts;

  const resetView = useCallback(() => {
    setPageState(1);
    setSelectedIds(new Set());
    setOpenId(null);
    onViewReset?.();
  }, [onViewReset]);

  const setActiveTab = useCallback(
    (value: string) => {
      setActiveTabState(value);
      resetView();
      onTabChange?.(value);
    },
    [onTabChange, resetView],
  );

  const setFilterValue = useCallback(
    (id: string, value: ReviewFilterValue) => {
      setFilterValues((current) => ({ ...current, [id]: value }));
      // Full reset, not just page+selection: a partial reset leaves the drawer
      // open on a row the new filter has just removed from the result set.
      resetView();
    },
    [resetView],
  );

  const setPage = useCallback((nextPage: number) => {
    setPageState(Math.max(1, nextPage));
  }, []);

  const setPageSize = useCallback(
    (size: number) => {
      setPageSizeState(Math.max(1, size));
      resetView();
    },
    [resetView],
  );

  // The latch releases itself, derived from the incoming `items` on every
  // render. `hiddenIds` therefore reports only ids that are STILL suppressed —
  // an id whose item has caught up server-side has already dropped out.
  const hiddenIds = useMemo(() => {
    if (hiddenLatch.size === 0) return hiddenLatch;
    if (releaseHidden === undefined) return hiddenLatch;

    const released = new Set<string>();
    for (const item of items) {
      const id = getId(item);
      if (hiddenLatch.has(id) && releaseHidden(item)) released.add(id);
    }
    if (released.size === 0) return hiddenLatch;

    return new Set([...hiddenLatch].filter((id) => !released.has(id)));
  }, [hiddenLatch, getId, items, releaseHidden]);

  // A release must be PERMANENT. Deriving `hiddenIds` alone left the latch
  // itself growing forever, so a row that had already been released got
  // re-hidden the moment it legitimately returned to the un-released state —
  // e.g. reject X (latched), props catch up (released), an admin reopens X to
  // `pending`, and X vanishes from the table AND from every `tabCounts` entry
  // with no way back short of a reload. Pruning it out of the latch closes that.
  //
  // Adjusted during render on a detected transition, deliberately not in an
  // effect: a prop-mirroring effect keeps a client copy of server state and goes
  // blind to `router.refresh()` (admin/brands, 2026-08-01). `hiddenIds` is
  // memoized, so after this assignment the next pass returns `hiddenLatch`
  // by identity and the adjustment does not repeat.
  if (hiddenIds !== hiddenLatch) setHiddenLatch(hiddenIds);

  const postHidden = useMemo(
    () => items.filter((item) => !hiddenIds.has(getId(item))),
    [hiddenIds, getId, items],
  );

  const tabCounts = useMemo(
    () =>
      tabs.reduce<Record<string, number>>((counts, tab) => {
        counts[tab.value] = postHidden.filter(tab.match).length;
        return counts;
      }, {}),
    [postHidden, tabs],
  );

  const activeTabDefinition = useMemo(
    () => tabs.find((tab) => tab.value === activeTab),
    [activeTab, tabs],
  );

  const visibleFilters = useMemo(
    () =>
      filters.filter((filter) => filter.visibleOn?.(activeTab) ?? true),
    [activeTab, filters],
  );

  const filtered = useMemo(() => {
    let next = activeTabDefinition
      ? postHidden.filter(activeTabDefinition.match)
      : postHidden;

    for (const filter of visibleFilters) {
      const value = filterValues[filter.id] ?? null;
      if (isEmptyFilterValue(filter, value)) continue;
      next = next.filter((item) => filter.predicate(item, value));
    }

    return next;
  }, [
    activeTabDefinition,
    filterValues,
    postHidden,
    visibleFilters,
  ]);

  const pageCount =
    pageSize === null
      ? 1
      : Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.max(1, Math.min(pageState, pageCount));
  const visible =
    pageSize === null
      ? filtered
      : filtered.slice((page - 1) * pageSize, page * pageSize);

  const selectableVisible = useMemo(
    () => visible.filter(selectablePredicate),
    [selectablePredicate, visible],
  );
  const selectedVisible = useMemo(
    () =>
      selectableVisible.filter((item) =>
        selectedIds.has(getId(item)),
      ),
    [getId, selectableVisible, selectedIds],
  );
  const allSelected =
    selectableVisible.length > 0 &&
    selectedVisible.length === selectableVisible.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;

  const toggleSelection = useCallback(
    (id: string) => {
      if (!selectableVisible.some((item) => getId(item) === id)) return;

      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [getId, selectableVisible],
  );

  const toggleSelectAll = useCallback(() => {
    const visibleIds = selectableVisible.map((item) => getId(item));

    setSelectedIds((current) => {
      const next = new Set(current);
      const allVisibleSelected =
        visibleIds.length > 0 && visibleIds.every((id) => next.has(id));

      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }

      return next;
    });
  }, [getId, selectableVisible]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleOpen = useCallback((id: string) => {
    setOpenId((current) => (current === id ? null : id));
  }, []);

  const hideIds = useCallback((ids: string[]) => {
    setHiddenLatch((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const showIds = useCallback((ids: string[]) => {
    setHiddenLatch((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  return {
    items: items,
    getId: getId,
    activeTab,
    setActiveTab,
    tabs,
    tabCounts,
    visibleFilters,
    filterValues,
    setFilterValue,
    filtered,
    visible,
    total: filtered.length,
    selectionEnabled,
    isSelectable: selectablePredicate,
    selectableVisible,
    selectedIds,
    setSelectedIds,
    selectedVisible,
    allSelected,
    someSelected,
    toggleSelection,
    toggleSelectAll,
    clearSelection,
    openId,
    setOpenId,
    toggleOpen,
    hiddenIds,
    hideIds,
    showIds,
    page,
    pageCount,
    setPage,
    pageSize,
    setPageSize,
    resetView,
  };
}

function isEmptyFilterValue<T>(
  filter: ReviewFilter<T>,
  value: ReviewFilterValue,
) {
  if (value === null || value === "") return true;
  if (filter.defaultValue === undefined) return false;

  return areFilterValuesEqual(value, filter.defaultValue);
}

function areFilterValuesEqual(
  left: ReviewFilterValue,
  right: ReviewFilterValue | undefined,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (typeof left === "string" || typeof right === "string") return false;

  return (
    (left as IsoDateRange).start === (right as IsoDateRange).start &&
    (left as IsoDateRange).end === (right as IsoDateRange).end
  );
}
