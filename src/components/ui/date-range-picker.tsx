"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { I18nProvider, RangeCalendar } from "@heroui/react";
import { parseDate } from "@internationalized/date";
import { CalendarRange, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIsoDate, type IsoDateRange } from "@/lib/date-range";
import { cn } from "@/lib/utils";

type DateRangePickerProps = {
  ariaLabel: string;
  value: IsoDateRange | null;
  locale: string;
  placeholder?: string;
  clearLabel?: string;
  maxValue?: string;
  isReadOnly?: boolean;
  showYear?: boolean;
  className?: string;
  onChange?: (value: IsoDateRange) => void;
  onClear?: () => void;
};

export function DateRangePicker({
  ariaLabel,
  value,
  locale,
  placeholder = ariaLabel,
  clearLabel,
  maxValue,
  isReadOnly = false,
  showYear = true,
  className,
  onChange,
  onClear,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const calendarValue = useMemo(
    () =>
      value
        ? { start: parseDate(value.start), end: parseDate(value.end) }
        : null,
    [value],
  );
  const label = value
    ? `${formatIsoDate(value.start, locale, showYear)} – ${formatIsoDate(value.end, locale, showYear)}`
    : placeholder;

  return (
    <I18nProvider locale={locale}>
      <div className={cn("flex min-w-0 items-center gap-1", className)}>
        <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
          <PopoverPrimitive.Trigger
            render={
              <Button
                type="button"
                variant="secondary"
                className="min-w-0 flex-1 justify-start px-3.5"
              />
            }
            aria-label={ariaLabel}
          >
            <CalendarRange
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span
              className={cn(
                "min-w-0 truncate",
                value ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner
              side="bottom"
              align="end"
              sideOffset={8}
              className="isolate z-50"
            >
              <PopoverPrimitive.Popup className="rounded-xl bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
                <div
                  data-theme="default"
                  style={{ "--accent": "var(--primary)" } as CSSProperties}
                >
                  <RangeCalendar
                    aria-label={ariaLabel}
                    value={calendarValue}
                    maxValue={maxValue ? parseDate(maxValue) : undefined}
                    isReadOnly={isReadOnly}
                    onChange={(nextValue) => {
                      onChange?.({
                        start: nextValue.start.toString(),
                        end: nextValue.end.toString(),
                      });
                      setOpen(false);
                    }}
                  >
                    <RangeCalendar.Header>
                      <RangeCalendar.Heading />
                      <RangeCalendar.NavButton slot="previous" />
                      <RangeCalendar.NavButton slot="next" />
                    </RangeCalendar.Header>
                    <RangeCalendar.Grid>
                      <RangeCalendar.GridHeader>
                        {(day) => (
                          <RangeCalendar.HeaderCell>
                            {day}
                          </RangeCalendar.HeaderCell>
                        )}
                      </RangeCalendar.GridHeader>
                      <RangeCalendar.GridBody>
                        {(date) => <RangeCalendar.Cell date={date} />}
                      </RangeCalendar.GridBody>
                    </RangeCalendar.Grid>
                  </RangeCalendar>
                </div>
              </PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
        {value && onClear && clearLabel && (
          <Button
            type="button"
            variant="ghost"
            shape="square"
            size="icon"
            className="size-12"
            aria-label={clearLabel}
            onClick={onClear}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </I18nProvider>
  );
}
