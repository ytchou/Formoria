"use client";

import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import { trackStoryCardClicked } from "@/lib/analytics";

type RelatedStoryLinkProps = {
  href: string;
  storySlug: string;
  position: number;
  storySurface: string;
  className: string;
  children: ReactNode;
};

/** Client boundary limited to the click handler; the related-link list stays server-rendered. */
export function RelatedStoryLink({
  href,
  storySlug,
  position,
  storySurface,
  className,
  children,
}: RelatedStoryLinkProps) {
  return (
    <Link
      href={href}
      className={className}
      data-ph-no-autocapture
      onClick={() => trackStoryCardClicked(storySlug, position, storySurface)}
    >
      {children}
    </Link>
  );
}
