"use client";

import { type ReactNode, type ToggleEvent } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { trackFaqItemExpanded } from "@/lib/analytics";

import { OpenTargetDetails } from "@/components/shared/open-target-details";
import { FaqSection } from "@/components/shared/faq-section";
import { sanitizeHref } from "@/lib/url";
import { useBrandEngagement } from "./brand-engagement-tracker";

const LINK_RE = /(\[[^\]]+\]\([^)]+\))/g;
const LINK_PARTS_RE = /^\[([^\]]+)\]\(([^)]+)\)$/;

function renderLinkedText(text: string): ReactNode {
  const parts = text.split(LINK_RE);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    const match = part.match(LINK_PARTS_RE);
    if (match) {
      const href = sanitizeHref(match[2]);
      if (!href) return match[1];
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline hover:text-accent/80"
        >
          {match[1]}
        </a>
      );
    }
    return part;
  });
}

interface BrandFaqAccordionProps {
  items: Array<{ id: string; question: string; answer: string }>;
  brandSlug: string;
}

export function BrandFaqAccordion({
  items,
  brandSlug,
}: BrandFaqAccordionProps) {
  const t = useTranslations("brandDetail.sections");
  const { reportEngagement } = useBrandEngagement();

  if (items.length === 0) return null;

  function handleToggle(event: ToggleEvent<HTMLDetailsElement>, id: string) {
    // Native <details> fires toggle on both open and close; only expansion counts.
    if (!event.currentTarget.open) return;
    trackFaqItemExpanded(brandSlug, id);
    reportEngagement("faq");
  }

  return (
    <FaqSection title={t("faq")} headerClassName="mb-4">
      <OpenTargetDetails />
      <div className="divide-y divide-rule">
        {items.map((item) => (
          <details
            key={item.id}
            id={`faq-${item.id}`}
            className="group scroll-mt-24"
            onToggle={(event) => handleToggle(event, item.id)}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between py-5 type-body-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronDown className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:duration-[0.01ms]" />
            </summary>
            {/* The row's vertical padding lives on <summary>, the interactive
                element, so the whole visual row is the hit target (~62px, over
                the 44px minimum) and the focus ring wraps it. The answer
                carries the closing padding the <details> used to. */}
            <p className="pb-5 type-body-sm">
              {renderLinkedText(item.answer)}
            </p>
          </details>
        ))}
      </div>
    </FaqSection>
  );
}
