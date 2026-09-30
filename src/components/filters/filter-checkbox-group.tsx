"use client";

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  FilterOptionCount,
  filterOptionRowClassName,
  FilterOptionLabel,
} from "./filter-option-row";

type FilterCheckboxOption = {
  value: string;
  label: string;
  count: number;
};

type FilterCheckboxGroupProps = {
  options: FilterCheckboxOption[];
  activeValues: ReadonlySet<string>;
  onToggle: (value: string, checked: boolean) => void;
  /** Options shown before "show more". Checked options are never hidden. */
  limit?: number;
  showMoreLabel: (count: number) => string;
  showLessLabel: string;
};

export function FilterCheckboxGroup({
  options,
  activeValues,
  onToggle,
  limit = 10,
  showMoreLabel,
  showLessLabel,
}: FilterCheckboxGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const overflows = (option: FilterCheckboxOption, index: number) =>
    index >= limit && !activeValues.has(option.value);
  const overflowCount = options.filter(overflows).length;
  // Never truncate a single value: a toggle that reveals one row costs as much
  // space as the row itself.
  const truncates = overflowCount >= 2;

  return (
    <div>
      <div id={listId}>
        {options.map((option, index) => {
          const checked = activeValues.has(option.value);
          return (
            // Hidden rows stay rendered: the options must be in the server
            // HTML (DESIGN.md §7), so truncation is the `hidden` attribute,
            // never a slice.
            <Label
              key={option.value}
              hidden={truncates && !expanded && overflows(option, index)}
              className={filterOptionRowClassName}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(value: boolean) =>
                  onToggle(option.value, value)
                }
                data-ph-no-autocapture
              />
              <FilterOptionLabel selected={checked}>
                {option.label}
              </FilterOptionLabel>
              <FilterOptionCount count={option.count} />
            </Label>
          );
        })}
      </div>
      {truncates && (
        <Button
          type="button"
          variant="ghost"
          size="compact"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
          className="justify-start gap-2 px-2 type-nav"
        >
          {expanded ? (
            <Minus className="size-4" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
          {expanded ? showLessLabel : showMoreLabel(overflowCount)}
        </Button>
      )}
    </div>
  );
}
