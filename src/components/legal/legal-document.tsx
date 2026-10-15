import type { ReactNode } from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageToc, type PageTocItem } from "@/components/ui/page-toc";

/**
 * The legal-page shell, shared by /privacy and /terms (DS-11).
 *
 * Header (title, intro, last-updated, on-page TOC) then a ruled list of
 * sections. Sections are passed as children because terms renders a second
 * paragraph for some of them; `LegalSection` owns the per-section markup.
 */

/** Inline link inside legal body copy (mailto links). One definition. */
export const legalInlineLinkClassName =
  "rounded-control break-words text-accent underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground";

type LegalDocumentProps = {
  title: string;
  intro: string;
  lastUpdated: string;
  /** Accessible name and visible heading of the TOC (本頁內容). */
  tocLabel: string;
  tocItems: ReadonlyArray<PageTocItem>;
  children: ReactNode;
};

export function LegalDocument({
  title,
  intro,
  lastUpdated,
  tocLabel,
  tocItems,
  children,
}: LegalDocumentProps) {
  return (
    // A page that is read, so it takes the prose measure (DESIGN.md §4).
    <PageShell as="main" measure="prose" className="py-10">
      <header className="space-y-4 border-b border-rule pb-8">
        <h1 className="type-page-title">{title}</h1>
        <p className="type-body">{intro}</p>
        <p className="type-body-sm text-ink-muted">{lastUpdated}</p>
        <PageToc
          variant="inline"
          label={tocLabel}
          labelVisible
          items={tocItems}
        />
      </header>
      <div className="divide-y divide-rule">{children}</div>
    </PageShell>
  );
}

type LegalSectionProps = {
  id: string;
  heading: string;
  children: ReactNode;
};

export function LegalSection({ id, heading, children }: LegalSectionProps) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3 py-8">
      <h2 className="type-section">{heading}</h2>
      {children}
    </section>
  );
}
