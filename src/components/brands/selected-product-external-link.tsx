"use client";

import type { ReactNode } from "react";

import {
  trackExternalLinkClicked,
  type ExternalLinkSurface,
} from "@/lib/analytics";

export function SelectedProductExternalLink({
  href,
  brandSlug,
  linkType,
  referrerPage,
  surface,
  brandId,
  productKey,
  className,
  children,
}: {
  href: string;
  brandSlug: string;
  linkType: string;
  referrerPage: string;
  surface: ExternalLinkSurface;
  brandId?: string;
  /** The curated product behind the link, so a click names the product too. */
  productKey?: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      data-ph-no-autocapture
      data-brand-slug={brandSlug}
      data-link-type={linkType}
      data-link-surface={surface}
      onClick={() =>
        trackExternalLinkClicked(
          brandSlug,
          linkType,
          referrerPage,
          surface,
          brandId,
          productKey,
        )
      }
    >
      {children}
    </a>
  );
}
