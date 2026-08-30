"use client";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const filterOptionClassName =
  "flex min-h-12 cursor-pointer items-center gap-2 rounded-control px-2 type-body-sm transition-colors hover:bg-surface hover:text-ink";

type FilterCheckboxOption = {
  value: string;
  label: string;
  count: number;
};

type FilterCheckboxGroupProps = {
  options: FilterCheckboxOption[];
  activeValues: ReadonlySet<string>;
  onToggle: (value: string, checked: boolean) => void;
};

export function FilterCheckboxGroup({
  options,
  activeValues,
  onToggle,
}: FilterCheckboxGroupProps) {
  return (
    <div className="space-y-1">
      {options.map((option) => {
        const checked = activeValues.has(option.value);
        return (
          <Label
            key={option.value}
            className={cn(
              filterOptionClassName,
              checked && "bg-accent/10 font-medium text-accent",
            )}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={(value: boolean) =>
                onToggle(option.value, value)
              }
              data-ph-no-autocapture
            />
            <span>{option.label}</span>
            <span className="ml-auto type-metadata text-ink-muted">
              {option.count}
            </span>
          </Label>
        );
      })}
    </div>
  );
}
