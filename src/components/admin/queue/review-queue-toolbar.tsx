"use client";

import { useId, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { IsoDateRange } from "@/lib/date-range";
import { cn } from "@/lib/utils";
import type { ReviewFilter, ReviewFilterValue, ReviewQueueState } from "./types";

/**
 * An unset bound, encoded rather than absent.
 *
 * `IsoDateRange` has two required bounds and `isDateInRange` compares them with
 * plain string `>=` / `<=`, which is exactly right for ISO calendar dates. Two
 * independent inputs, though, can leave one side empty — and holding a partial
 * range in component state is what makes a filter forget the half the user
 * already typed on the next parent render.
 *
 * So a missing bound becomes an unreachable date instead. The comparison stays
 * a string comparison, the filter state stays complete and parent-owned, and a
 * one-sided range filters correctly. These values are an internal encoding and
 * are never rendered: the inputs show `""` for either sentinel.
 */
const OPEN_START = "0001-01-01";
const OPEN_END = "9999-12-31";

function DateRangeFilter<T>({
  filter,
  value,
  onChange,
}: {
  filter: ReviewFilter<T>;
  value: ReviewFilterValue;
  onChange: (next: ReviewFilterValue) => void;
}) {
  const fieldId = useId();
  const fromId = `${fieldId}-from`;
  const toId = `${fieldId}-to`;

  const range = (value ?? null) as IsoDateRange | null;
  const start = range && range.start !== OPEN_START ? range.start : "";
  const end = range && range.end !== OPEN_END ? range.end : "";

  const labels = filter.rangeLabels ?? {
    from: `${filter.label} — from`,
    to: `${filter.label} — to`,
  };

  const commit = (nextStart: string, nextEnd: string) => {
    if (!nextStart && !nextEnd) {
      onChange(null);
      return;
    }
    onChange({
      start: nextStart || OPEN_START,
      end: nextEnd || OPEN_END,
    });
  };

  return (
    <div className={cn("flex flex-wrap items-end gap-3", filter.className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={fromId}>{labels.from}</Label>
        <Input
          id={fromId}
          type="date"
          value={start}
          max={end || undefined}
          onChange={(event) => commit(event.target.value, end)}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={toId}>{labels.to}</Label>
        <Input
          id={toId}
          type="date"
          value={end}
          min={start || undefined}
          onChange={(event) => commit(start, event.target.value)}
        />
      </div>
      {start || end ? (
        <Button
          type="button"
          variant="ghost"
          shape="square"
          size="icon"
          className=""
          aria-label={filter.clearLabel ?? `Clear ${filter.label}`}
          onClick={() => onChange(null)}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}

export function ReviewQueueToolbar<T>(props: {
  queue: ReviewQueueState<T>;
  actions?: ReactNode;
  children?: ReactNode;
  error?: string | null;
}): React.JSX.Element {
  const { queue, actions, children, error } = props;

  return (
    <div className="space-y-3">
      {queue.tabs.length > 0 ? (
        <Tabs value={queue.activeTab} onValueChange={queue.setActiveTab}>
          <TabsList className="max-w-full overflow-x-auto">
            {queue.tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label} ({queue.tabCounts[tab.value] ?? 0})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {queue.visibleFilters.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {queue.visibleFilters.map((filter) => {
            const value = queue.filterValues[filter.id] ?? null;

            if (filter.kind === "search") {
              return (
                <div
                  className={`relative ${filter.className ?? ""}`}
                  key={filter.id}
                >
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                    aria-hidden="true"
                  />
                  <Input
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) =>
                      queue.setFilterValue(filter.id, event.target.value)
                    }
                    placeholder={filter.placeholder}
                    aria-label={filter.label}
                    className="pl-9"
                  />
                </div>
              );
            }

            if (filter.kind === "select") {
              return (
                <NativeSelect
                  key={filter.id}
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) =>
                    queue.setFilterValue(filter.id, event.currentTarget.value)
                  }
                  aria-label={filter.label}
                  className={filter.className}
                >
                  {(filter.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              );
            }

            return (
              <DateRangeFilter
                key={filter.id}
                filter={filter}
                value={value}
                onChange={(next) => queue.setFilterValue(filter.id, next)}
              />
            );
          })}
        </div>
      ) : null}

      {actions ? (
        <div className="flex flex-wrap justify-end gap-2">{actions}</div>
      ) : null}

      {children}

      {error ? (
        <p className="mt-3 type-metadata text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Reads its own chrome copy from `admin.queue.*`. Every consumer used to pass a
 * character-for-character identical `labels` block (and submissions a duplicate
 * of it under a second namespace), which is the exact duplication this shared
 * shell exists to collapse. `labels` survives only as a per-consumer override.
 */
export function ReviewQueuePagination<T>(props: {
  queue: ReviewQueueState<T>;
  pageSizeOptions?: number[];
  labels?: {
    summary?: (range: { from: number; to: number; total: number }) => string;
    pageSize?: string;
    previous?: string;
    next?: string;
  };
}): React.JSX.Element | null {
  const { queue, labels } = props;
  const t = useTranslations("admin.queue");
  const pageSize = queue.pageSize;
  if (pageSize === null) return null;

  const pageSizeOptions = props.pageSizeOptions ?? [10, 25, 50];
  const from = queue.total === 0 ? 0 : (queue.page - 1) * pageSize + 1;
  const to = Math.min(queue.page * pageSize, queue.total);
  const summary =
    labels?.summary?.({ from, to, total: queue.total }) ??
    t("paginationSummary", { from, to, total: queue.total });
  const pageSizeLabel = labels?.pageSize ?? t("pageSize");
  const previousLabel = labels?.previous ?? t("previousPage");
  const nextLabel = labels?.next ?? t("nextPage");

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="type-body-sm">{summary}</p>
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label={pageSizeLabel}
          value={pageSize.toString()}
          className="w-24"
          onChange={(event) =>
            queue.setPageSize(Number(event.currentTarget.value))
          }
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </NativeSelect>
        <Button
          type="button"
          shape="pill"
          variant="secondary"
          size="icon"
          onClick={() => queue.setPage(queue.page - 1)}
          disabled={queue.page === 1}
          aria-label={previousLabel}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="min-w-16 text-center type-body-sm">
          {queue.page} / {queue.pageCount}
        </span>
        <Button
          type="button"
          shape="pill"
          variant="secondary"
          size="icon"
          onClick={() => queue.setPage(queue.page + 1)}
          disabled={queue.page === queue.pageCount}
          aria-label={nextLabel}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
