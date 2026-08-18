"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SubcategoryFieldProps = {
  initialSubcategories?: string[];
  value?: string[];
  onChange?: (subcategories: string[]) => void;
  suggestions?: string[];
  inputLabel: string;
  placeholder: string;
  removeLabel: string;
  maxLabel?: string;
};

const MAX_SUBCATEGORIES = 5;

function normalizeSubcategory(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function SubcategoryField({
  initialSubcategories,
  value: controlledSubcategories,
  onChange,
  suggestions = [],
  inputLabel,
  placeholder,
  removeLabel,
  maxLabel,
}: SubcategoryFieldProps) {
  const [internalSubcategories, setInternalSubcategories] = useState(() =>
    (initialSubcategories ?? []).slice(0, MAX_SUBCATEGORIES),
  );
  const [value, setValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const subcategories = controlledSubcategories ?? internalSubcategories;
  const normalizedValue = normalizeSubcategory(value).toLocaleLowerCase("en");
  const filteredSuggestions = normalizedValue
    ? suggestions
        .filter((suggestion) =>
          suggestion.toLocaleLowerCase("en").includes(normalizedValue),
        )
        .filter(
          (suggestion) =>
            !subcategories.some(
              (subcategory) =>
                subcategory.toLocaleLowerCase("en") ===
                suggestion.toLocaleLowerCase("en"),
            ),
        )
        .slice(0, 6)
    : [];

  function updateSubcategories(nextSubcategories: string[]) {
    if (controlledSubcategories === undefined) {
      setInternalSubcategories(nextSubcategories);
    }
    onChange?.(nextSubcategories);
  }

  function addSubcategory(rawValue: string) {
    const subcategory = normalizeSubcategory(rawValue);
    if (
      !subcategory ||
      subcategory.length > 40 ||
      subcategories.length >= MAX_SUBCATEGORIES
    ) {
      setValue("");
      setShowSuggestions(false);
      return;
    }
    if (
      subcategories.some(
        (current) => current.toLowerCase() === subcategory.toLowerCase(),
      )
    ) {
      setValue("");
      setShowSuggestions(false);
      return;
    }
    updateSubcategories([...subcategories, subcategory]);
    setValue("");
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }

  const listboxId = "subcategories-listbox";
  const isExpanded = showSuggestions && filteredSuggestions.length > 0;

  return (
    <div className="space-y-2">
      <input
        type="hidden"
        name="subcategories"
        value={subcategories.join(",")}
      />
      <div className="relative flex min-h-11 flex-wrap gap-2 rounded-lg border border-border bg-background p-2">
        {subcategories.map((subcategory) => (
          <span
            key={subcategory.toLowerCase()}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 type-body-emphasis text-primary"
          >
            {subcategory}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              shape="pill"
              aria-label={`${removeLabel}: ${subcategory}`}
              className="size-6 min-h-0 min-w-0 p-0 text-primary hover:bg-primary/10"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                updateSubcategories(
                  subcategories.filter((item) => item !== subcategory),
                )
              }
            >
              <X className="size-3.5" />
            </Button>
          </span>
        ))}
        {subcategories.length < MAX_SUBCATEGORIES ? (
          <Input
            id="subcategories"
            role="combobox"
            aria-label={inputLabel}
            aria-expanded={isExpanded}
            aria-controls={isExpanded ? listboxId : undefined}
            aria-autocomplete="list"
            className="h-8 min-w-40 flex-1 border-0 px-1 shadow-none focus-visible:ring-0"
            placeholder={placeholder}
            value={value}
            maxLength={40}
            aria-activedescendant={
              isExpanded &&
              selectedIndex >= 0 &&
              filteredSuggestions[selectedIndex]
                ? `subcategory-suggestion-${selectedIndex}`
                : undefined
            }
            onChange={(event) => {
              setValue(event.target.value);
              setShowSuggestions(true);
              setSelectedIndex(-1);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => addSubcategory(value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                if (isExpanded) {
                  setSelectedIndex((prev) =>
                    Math.min(prev + 1, filteredSuggestions.length - 1),
                  );
                }
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, -1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (selectedIndex >= 0 && filteredSuggestions[selectedIndex]) {
                  addSubcategory(filteredSuggestions[selectedIndex]);
                } else {
                  addSubcategory(value);
                }
              } else if (event.key === ",") {
                event.preventDefault();
                addSubcategory(value);
              } else if (event.key === "Escape") {
                setShowSuggestions(false);
                setSelectedIndex(-1);
              }
            }}
          />
        ) : null}
        {isExpanded ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label={inputLabel}
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-md"
          >
            {filteredSuggestions.map((suggestion, index) => (
              <div
                key={suggestion.toLocaleLowerCase("en")}
                id={`subcategory-suggestion-${index}`}
                role="option"
                aria-selected={selectedIndex === index}
                className={cn(
                  "block w-full cursor-pointer px-3 py-2 text-left type-body",
                  selectedIndex === index
                    ? "bg-secondary"
                    : "hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => addSubcategory(suggestion)}
              >
                {suggestion}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {maxLabel ? <p className="type-caption">{maxLabel}</p> : null}
    </div>
  );
}
