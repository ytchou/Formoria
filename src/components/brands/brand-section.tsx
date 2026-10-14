import { useId, type ReactNode } from "react";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

type BrandSectionRhythm = "content" | "utility";

// Every section is a section-nav target: the offset clears the sticky main nav
// (100px) plus the mobile section-nav strip (48px). From md up there is no strip.
const SECTION_SCROLL_CLASS_NAME = "scroll-mt-40 md:scroll-mt-28";

const RHYTHM_CLASS_NAME: Record<BrandSectionRhythm, string> = {
  // Content sections (story, selected products, where-to-buy) are separated
  // by the section rhythm.
  content: "mt-section first:mt-0",
  // Utility sections (featured-in, FAQ, social, other links) keep the hairline
  // rhythm, and their headings step down to the card-title size (BD-12).
  utility: "mt-stack border-t border-rule pt-stack",
};

type BrandSectionProps = {
  /** The section-nav anchor. A section the nav never lists may omit it. */
  id?: string;
  /**
   * The section's h2. Omit it only when the body renders its own h2 (the
   * selected-products shelf sets its heading beside the carousel arrows).
   */
  heading?: ReactNode;
  rhythm: BrandSectionRhythm;
  /** Set on the heading's row, opposite the heading. */
  headingAction?: ReactNode;
  className?: string;
  children: ReactNode;
} & { [dataAttribute: `data-${string}`]: string | boolean | undefined };

/**
 * The one shell for every brand detail section (BD-17): the landmark, its
 * scroll offset, the rhythm against the previous section, and the heading.
 * Section components render only their body inside it.
 */
export function BrandSection({
  id,
  heading,
  rhythm,
  headingAction,
  className,
  children,
  ...dataAttributes
}: BrandSectionProps) {
  const generatedId = useId();
  const headingId = heading ? (id ? `${id}-heading` : generatedId) : undefined;
  const headingNode = heading ? (
    <Typography
      as="h2"
      id={headingId}
      variant={rhythm === "content" ? "sectionTitleLarge" : "cardTitle"}
      balance={rhythm === "utility"}
    >
      {heading}
    </Typography>
  ) : null;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        SECTION_SCROLL_CLASS_NAME,
        RHYTHM_CLASS_NAME[rhythm],
        className,
      )}
      {...dataAttributes}
    >
      {headingNode && headingAction ? (
        <div className="flex items-center justify-between gap-4">
          {headingNode}
          {headingAction}
        </div>
      ) : (
        headingNode
      )}
      {children}
    </section>
  );
}
