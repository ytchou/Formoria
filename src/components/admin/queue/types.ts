import type { ReactNode } from "react";

import type { IsoDateRange } from "@/lib/date-range";

export type ReviewFilterValue = string | IsoDateRange | null;

export type ReviewTab<T> = {
  value: string;
  label: ReactNode;
  /** A predicate keeps tab matching independent of a domain field name. */
  match: (item: T) => boolean;
};

type ReviewFilterOption = { value: string; label: string };

export type ReviewFilter<T> = {
  id: string;
  kind: "search" | "select" | "dateRange";
  label: string;
  placeholder?: string;
  options?: ReviewFilterOption[];
  /**
   * `dateRange` renders TWO native date inputs, and each one needs its own
   * visible label — `label` describes the pair, so it cannot serve as either.
   * The fallback below is deliberately clumsy: it is meant to be replaced by a
   * real pair of strings, not to read well.
   */
  rangeLabels?: { from: string; to: string };
  /** Accessible name for a `dateRange` filter's clear control. */
  clearLabel?: string;
  defaultValue?: ReviewFilterValue;
  predicate: (item: T, value: ReviewFilterValue) => boolean;
  visibleOn?: (activeTab: string) => boolean;
  className?: string;
};

export type ReviewColumn<T> = {
  id: string;
  header: ReactNode;
  cell: (item: T) => ReactNode;
  align?: "start" | "end";
  headClassName?: string;
  cellClassName?: string;
  visibleOn?: (activeTab: string) => boolean;
  srOnlyHeader?: boolean;
};

export type ReviewBulkAction<T> = {
  id: string;
  label: (count: number) => string;
  variant?: "primary" | "secondary" | "destructive" | "ghost";
  eligible?: (item: T) => boolean;
  visibleOn?: (activeTab: string) => boolean;
  pending?: boolean;
  disabled?: boolean;
  title?: string;
  onRun: (items: T[]) => void;
};

export type ReviewQueueState<T> = {
  items: T[];
  getId: (item: T) => string;
  activeTab: string;
  setActiveTab: (value: string) => void;
  tabs: ReviewTab<T>[];
  tabCounts: Record<string, number>;
  visibleFilters: ReviewFilter<T>[];
  filterValues: Record<string, ReviewFilterValue>;
  setFilterValue: (id: string, value: ReviewFilterValue) => void;
  filtered: T[];
  visible: T[];
  total: number;
  selectionEnabled: boolean;
  isSelectable: (item: T) => boolean;
  selectableVisible: T[];
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  selectedVisible: T[];
  allSelected: boolean;
  someSelected: boolean;
  toggleSelection: (id: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  toggleOpen: (id: string) => void;
  hiddenIds: Set<string>;
  hideIds: (ids: string[]) => void;
  showIds: (ids: string[]) => void;
  page: number;
  pageCount: number;
  setPage: (page: number) => void;
  pageSize: number | null;
  setPageSize: (size: number) => void;
  resetView: () => void;
};
