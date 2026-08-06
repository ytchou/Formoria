"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { IsoDateRange } from "@/lib/date-range";
import type { ReviewQueueState } from "./types";

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
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
              <DateRangePicker
                key={filter.id}
                ariaLabel={filter.label}
                locale="en"
                value={value as IsoDateRange | null}
                placeholder={filter.placeholder}
                clearLabel={`Clear ${filter.label}`}
                className={filter.className}
                onChange={(range) => queue.setFilterValue(filter.id, range)}
                onClear={() => queue.setFilterValue(filter.id, null)}
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
        <p className="mt-3 type-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

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
  const pageSize = queue.pageSize;
  if (pageSize === null) return null;

  const pageSizeOptions = props.pageSizeOptions ?? [10, 25, 50];
  const from = queue.total === 0 ? 0 : (queue.page - 1) * pageSize + 1;
  const to = Math.min(queue.page * pageSize, queue.total);
  const summary =
    labels?.summary?.({ from, to, total: queue.total }) ??
    `Showing ${from}-${to} of ${queue.total}`;
  const pageSizeLabel = labels?.pageSize ?? "Rows per page";
  const previousLabel = labels?.previous ?? "Previous page";
  const nextLabel = labels?.next ?? "Next page";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="type-card-description">{summary}</p>
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
          className="h-12 w-12 p-0"
          onClick={() => queue.setPage(queue.page - 1)}
          disabled={queue.page === 1}
          aria-label={previousLabel}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="min-w-16 text-center type-card-description">
          {queue.page} / {queue.pageCount}
        </span>
        <Button
          type="button"
          shape="pill"
          variant="secondary"
          className="h-12 w-12 p-0"
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
