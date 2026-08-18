"use client";

import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { trackCuratedProductClicked } from "@/lib/analytics";

type SelectedProductTileLinkProps = {
  href: string;
  className: string;
  productKey: string;
  brandSlug: string;
  position: number;
  surface: string;
  prefetch?: boolean;
  children: ReactNode;
};

/** Client boundary limited to the click handler; tile content stays server-rendered. */
export function SelectedProductTileLink({
  href,
  className,
  productKey,
  brandSlug,
  position,
  surface,
  prefetch,
  children,
}: SelectedProductTileLinkProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={className}
      data-ph-no-autocapture
      onClick={() =>
        trackCuratedProductClicked(productKey, brandSlug, position, surface)
      }
    >
      {children}
    </Link>
  );
}
