"use client";

import { type ReactNode, type ToggleEvent } from "react";
import { useTranslations } from "next-intl";
import { trackFaqItemExpanded } from "@/lib/analytics";

import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Typography } from "@/components/ui/typography";
import { OpenTargetDetails } from "@/components/shared/open-target-details";
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
    <>
      {/* The <section id="faq"> landmark and its scroll offset belong to the
          brand page, which already wraps this component in one. */}
      <Typography as="h2" className="mb-4" variant="sectionTitleLarge">
        {t("faq")}
      </Typography>
      <OpenTargetDetails />
      <Accordion>
        {items.map((item) => (
          <AccordionItem
            key={item.id}
            id={`faq-${item.id}`}
            className="scroll-mt-24"
            onToggle={(event) => handleToggle(event, item.id)}
            title={item.question}
          >
            <p>{renderLinkedText(item.answer)}</p>
          </AccordionItem>
        ))}
      </Accordion>
    </>
  );
}
