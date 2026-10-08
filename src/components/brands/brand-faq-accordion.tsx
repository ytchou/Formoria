import { type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { Typography } from "@/components/ui/typography";
import { sanitizeHref } from "@/lib/url";

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
}

export function BrandFaqAccordion({ items }: BrandFaqAccordionProps) {
  const t = useTranslations("brandDetail.sections");

  if (items.length === 0) return null;

  return (
    <>
      {/* The <section id="faq"> landmark and its scroll offset belong to the
          brand page, which already wraps this component in one. */}
      <Typography as="h2" className="mb-4" variant="cardTitle" balance>
        {t("faq")}
      </Typography>
      {/* An open definition list, never a collapsed panel: an answer to a
          question ships visible in the server HTML (DESIGN.md §7). */}
      <dl className="space-y-stack">
        {items.map((item) => (
          <div key={item.id} id={`faq-${item.id}`} className="scroll-mt-24">
            {/* Questions step below the brandDetail.sections.faq heading (DESIGN.md §8). */}
            <dt className="type-body font-semibold text-ink">
              {item.question}
            </dt>
            <dd className="mt-2 type-body">{renderLinkedText(item.answer)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
