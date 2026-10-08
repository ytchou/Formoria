import type { ComponentProps } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChipRow } from "@/components/ui/toggle-chip";
import { FilterToken } from "./filter-token";
import { ResultsLinkPendingReporter } from "./results-transition";

export type ActiveFilterChip = Omit<
  ComponentProps<typeof FilterToken>,
  "variant"
> & {
  /** React key; unique within the row. */
  id: string;
};

type ActiveFilterChipsProps = {
  chips: ActiveFilterChip[];
  /** Locale-prefixed href: rendered by `next/link`, as the chips are. */
  clearAllHref: string;
  clearAllLabel: string;
};

/**
 * The active-filter row shared by /brands and /discover: one removable chip per
 * filter, then 清除全部. Shown with any chip — one rule on both listings.
 */
export function ActiveFilterChips({
  chips,
  clearAllHref,
  clearAllLabel,
}: ActiveFilterChipsProps) {
  return (
    <ChipRow className="items-center">
      {chips.map(({ id, ...chip }) => (
        <FilterToken key={id} {...chip} variant="chip" />
      ))}
      <Link
        href={clearAllHref}
        prefetch={false}
        replace
        scroll={false}
        className={buttonVariants({ variant: "ghost", size: "compact" })}
      >
        {clearAllLabel}
        <ResultsLinkPendingReporter />
      </Link>
    </ChipRow>
  );
}
