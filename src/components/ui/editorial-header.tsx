import { Fragment, type ReactNode } from "react";

import {
  Breadcrumb,
  type BreadcrumbItem,
} from "@/components/brands/brand-breadcrumb";
import {
  editorialScrim,
  editorialScrimLayer,
} from "@/components/ui/editorial-scrim";
import { SurfaceImage } from "@/components/ui/image";
import { PageShell } from "@/components/ui/page-shell";
import { phraseBreaks } from "@/components/ui/phrase-breaks";
import { cn } from "@/lib/utils";

export type MetaItem = {
  label: string;
  value: ReactNode;
  /** The value's language when it is content, not UI (see `contentLangFor`). */
  lang?: string;
};

/**
 * The editorial frame — who chose this, when, how much of it there is — as ONE
 * interface-face line under the header (DS2-35): editorLabel · updatedLabel · selectionLabel + selectionSummary.
 * It replaced a three-row `<dl>` table that sat beside the title and stood as
 * tall as the hero. A `<p>` of label/value spans, because a `<dl>` cannot hold
 * the separators; the `·` between items is decoration and is hidden from
 * assistive tech, which reads each label straight into its value.
 */
function MetaLine({ items }: { items: MetaItem[] }) {
  if (items.length === 0) return null;
  return (
    <p className="type-metadata flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <span>
            {item.label}{" "}
            <span lang={item.lang} className="text-ink">
              {item.value}
            </span>
          </span>
        </Fragment>
      ))}
    </p>
  );
}

export type EditorialHeaderHero = {
  /** Already resolved by `editorialHeroSrc`: only an image the page can display. */
  src: string;
  /**
   * Empty for decorative. Both routes pass `heroImageAlt ?? ""`: the `<h1>` on
   * the scrim already says what the image is.
   */
  alt: string;
  /** Route-specific Next image quality for an oversized source photograph. */
  quality?: number;
};

export type EditorialHeaderProps = {
  breadcrumbAriaLabel: string;
  breadcrumbItems: BreadcrumbItem[];
  /**
   * Page-locale UI copy (the untranslated notice), so it renders OUTSIDE the
   * `lang` wrapper that marks the authored title and lede.
   */
  notice?: ReactNode;
  /** `null` takes the imageless path: title and lede on the surface band. */
  hero: EditorialHeaderHero | null;
  title: string;
  lede?: string | null;
  /** Set only when the content's language is not the page's (`contentLangFor`). */
  contentLang?: string;
  metaItems: MetaItem[];
};

/**
 * The one opening frame of a long-form editorial route — trail detail and
 * story detail (DS-08). Breadcrumb, scene, title, lede, one meta line. It used
 * to be the trail page's own header while stories kept an inset 16:9 image
 * and a five-row label table, so the two editorial surfaces opened in two
 * different ways.
 *
 * THE HEADER BAND. `surface` is the second material, not a tint: the band is
 * what separates the editorial frame — who chose this, when, how much of it
 * there is — from the objects below, and it does that with tone and a rule
 * rather than with a box around the title.
 *
 * With a displayable hero the scene image opens the page as a full-bleed band
 * (DS2-35, DESIGN.md §6 scene layer): 3:4 below md, 21:9 from md, the title
 * and lede on ONE eased ink scrim over its foot (EL-07, `editorial-scrim.ts`)
 * — the two-part block-plus-fade it replaced showed its joins as band seams.
 * No fixed min-height: the copy grows the band instead of clipping. Without
 * one, the title and lede sit directly on the surface band.
 */
export function EditorialHeader({
  breadcrumbAriaLabel,
  breadcrumbItems,
  notice,
  hero,
  title,
  lede,
  contentLang,
  metaItems,
}: EditorialHeaderProps) {
  return (
    <header className="border-b border-rule bg-surface">
      <PageShell measure="page" className="space-y-6 pt-8">
        <Breadcrumb ariaLabel={breadcrumbAriaLabel} items={breadcrumbItems} />
        {/* UI copy in the page's language, so outside the `lang` wrapper. */}
        {notice ? (
          <p className="type-body-sm text-ink-muted">{notice}</p>
        ) : null}
      </PageShell>
      {hero ? (
        <div className="relative mt-6 flex aspect-[3/4] flex-col justify-end overflow-clip bg-ink md:aspect-[21/9]">
          {/*
            `priority` and `fetchPriority="high"`, never lazy: this is the
            route's LCP element, so deferring it defers the metric itself.
            `surface="hero"` (100vw) because the band is full-bleed on every
            route that opens with it.
          */}
          <SurfaceImage
            src={hero.src}
            alt={hero.alt}
            fill
            priority
            fetchPriority="high"
            surface="hero"
            quality={hero.quality}
            className="object-cover"
          />
          {/*
            The copy block sits above the image; the scrim is one absolutely
            positioned layer inside it that starts above the copy, so the fade
            has its runway without padding the band taller.
          */}
          <div className="relative z-10">
            <span
              aria-hidden="true"
              className={cn(editorialScrimLayer, editorialScrim)}
            />
            <PageShell measure="page" className="relative z-10 pt-1 pb-8 md:pb-12">
              <div lang={contentLang} className="space-y-4">
                <h1 className="type-page-title break-keep text-ground">
                  {phraseBreaks(title)}
                </h1>
                {lede ? <p className="type-lede text-on-ink">{lede}</p> : null}
              </div>
            </PageShell>
          </div>
        </div>
      ) : (
        <PageShell measure="page" className="pt-6">
          <div lang={contentLang} className="space-y-4">
            <h1 className="type-page-title break-keep">
              {phraseBreaks(title)}
            </h1>
            {lede ? <p className="type-lede">{lede}</p> : null}
          </div>
        </PageShell>
      )}
      <PageShell measure="page" className="pt-6 pb-8 md:pb-10">
        <MetaLine items={metaItems} />
      </PageShell>
    </header>
  );
}
