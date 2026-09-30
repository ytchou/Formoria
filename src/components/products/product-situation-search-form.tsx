"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SearchFieldShell } from "@/components/search/search-field-shell";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { routes } from "@/lib/routes";

type ProductSituationSearchFormProps = {
  locale: string;
  query: string | null;
  labels: {
    label: string;
    placeholder: string;
    submit: string;
    clear: string;
  };
};

/**
 * A GET form for situation search on /discover.
 *
 * Submits as a plain GET so the URL is
 * shareable and the page re-renders server-side with the `q` param.
 *
 * A submit starts a fresh search: earlier filters are not carried over, and
 * `infer=1` asks the page to run the intent parse once for this query.
 */
export function ProductSituationSearchForm({
  locale,
  query,
  labels,
}: ProductSituationSearchFormProps) {
  const inputId = useId();
  const [value, setValue] = useState(query ?? "");
  // Follow the URL when it changes under a mounted form (a dismissed query
  // chip or clear-all is a client navigation, not a reload).
  const [lastQuery, setLastQuery] = useState(query);
  if (query !== lastQuery) {
    setLastQuery(query);
    setValue(query ?? "");
  }
  return (
    <form
      method="get"
      action={`/${locale}${routes.discover()}`}
      className="space-y-2"
    >
      <input type="hidden" name="infer" value="1" />

      <Label htmlFor={inputId} className="type-label">
        {labels.label}
      </Label>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchFieldShell
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onClear={() => setValue("")}
            clearLabel={labels.clear}
            inputProps={{
              id: inputId,
              type: "search",
              name: "q",
              placeholder: labels.placeholder,
              autoComplete: "off",
            }}
          />
        </div>
        <Button type="submit" variant="primary">
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}

export function ProductSearchBoxCompact({
  src,
  query = "",
  label,
  placeholder,
  className,
}: {
  src: "nav" | "hero";
  query?: string;
  label: string;
  placeholder: string;
  className?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("brands");
  const inputId = useId();
  const [value, setValue] = useState(query);
  return (
    <form
      method="get"
      action={`/${locale}${routes.discover()}`}
      role="search"
      aria-label={label}
      className={cn("w-full max-w-md", className)}
      data-ph-no-autocapture
    >
      <Label htmlFor={inputId} className="sr-only">
        {label}
      </Label>
      <input type="hidden" name="infer" value="1" />
      <input type="hidden" name="src" value={src} />
      <SearchFieldShell
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onClear={() => setValue("")}
        clearLabel={t("search.clear")}
        inputProps={{
          id: inputId,
          name: "q",
          type: "search",
          placeholder,
          maxLength: 100,
          autoComplete: "off",
        }}
      />
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  );
}
