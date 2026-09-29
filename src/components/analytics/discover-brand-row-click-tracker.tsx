"use client";

import type { ReactNode, MouseEvent } from "react";
import { trackProductSearchBrandClicked } from "@/lib/analytics";

export function DiscoverBrandRowClickTracker({
  searchId,
  query,
  children,
}: {
  searchId: string;
  query: string;
  children: ReactNode;
}) {
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest("a");
    const item = link?.closest<HTMLLIElement>("li[data-brand-slug]");
    const brandSlug = item?.dataset.brandSlug;
    if (!item || !brandSlug || !event.currentTarget.contains(item)) return;
    const position = item.parentElement
      ? Array.from(item.parentElement.children).indexOf(item)
      : 0;
    trackProductSearchBrandClicked({ searchId, query, brandSlug, position });
  }
  return <div onClick={handleClick}>{children}</div>;
}
