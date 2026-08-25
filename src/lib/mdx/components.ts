import {
  createElement,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import { BrandCardMdx } from "@/components/stories/brand-card-mdx";
import { BrandGallery } from "@/components/stories/brand-gallery";
import { BrandGrid } from "@/components/stories/brand-grid";
import { BrandLine, BrandList } from "@/components/stories/brand-list";
import { BrandRow } from "@/components/stories/brand-row";
import { FaqBlock } from "@/components/stories/faq-block";
import { PullQuote } from "@/components/stories/pull-quote";
import { StatsCallout } from "@/components/stories/stats-callout";
import { StoryFigure } from "@/components/stories/story-figure";
import { TrailProducts } from "@/components/trails/trail-products";
import { cn } from "@/lib/utils";

/**
 * One declared section of a trail, in authoring order. Only `title` is read —
 * it is what the markdown `##` heading resolves against.
 */
export type TrailSectionRef = { key: string; title: string };

function visibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return visibleText(node.props.children);
  return "";
}

/**
 * Story MDX shortcodes plus element-level typography for the prose itself.
 *
 * The Tailwind typography plugin is deliberately NOT installed — the project already
 * defines its own `type-*` scale in globals.css and the plugin would ship a
 * second, competing type system. Every markdown element therefore carries an
 * explicit class from that scale, which is also why the story page no longer
 * wraps the body in inert `prose` classes.
 *
 * That makes this map the *only* styling layer under the body: an element with
 * no entry here renders through Tailwind preflight with no fallback at all.
 * Anything markdown can emit must have a row — h1–h4, p, lists, links, quotes,
 * rules, images, tables, and code. Add the row when you add the syntax.
 *
 * Every override composes `props.className` through `cn()` rather than
 * overwriting it. Hard-setting `className` after the spread silently dropped
 * author classes (`<h2 className="text-center">`) and anything a remark/rehype
 * plugin attached.
 *
 * `scroll-mt-24` on headings keeps anchor targets clear of the sticky header.
 */
export function createStoryComponentMap({
  trailSections,
}: {
  /**
   * A trail's declared sections, in order. Passing them turns the `h2` rule
   * into the trail archetype's numbered section header.
   *
   * Matched by TITLE, not by DOM position, because the `<section id="…">`
   * wrapper in the MDX is explicit JSX and MDX never routes explicit JSX
   * through this map (`recma-jsx-rewrite`: "Do not turn explicit JSX into
   * components from `_components`"). The `##` heading inside it IS
   * markdown-generated, so it is the only element here that can carry the
   * number. A heading the frontmatter never declared stays unnumbered — a
   * degradation, not a crash.
   */
  trailSections?: readonly TrailSectionRef[];
} = {}) {
  const titleCounts = new Map<string, number>();
  for (const section of trailSections ?? []) {
    const title = section.title.trim();
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  const sectionNumbers = new Map(
    (trailSections ?? [])
      .map(
        (section, index) =>
          [section.title.trim(), String(index + 1).padStart(2, "0")] as const,
      )
      .filter(([title]) => title.length > 0 && titleCounts.get(title) === 1),
  );

  return {
    BrandCard: (props: { slug: string; note?: string; eyebrow?: string }) =>
      createElement(BrandCardMdx, props),
    BrandGrid: (props: { slugs: string[]; notes?: Record<string, string> }) =>
      createElement(BrandGrid, props),
    // Images come from the brand listing rather than hard-coded storage URLs,
    // so the story stays in sync with the directory.
    BrandGallery: (props: { slug: string; caption?: string }) =>
      createElement(BrandGallery, props),
    TrailProducts: (props: { section: string }) =>
      createElement(TrailProducts, props),
    // Children, not a `slugs` array — MDX expression attributes are dropped
    // (DEV-1302), so the row's cards are authored as nested `<BrandCard>`.
    BrandRow: (props: { children?: ReactNode }) =>
      createElement(BrandRow, null, props.children),
    // The compact alternative to `BrandRow`: stacked hairline-ruled rows instead
    // of a 3-up card grid, for sections that list brands rather than feature
    // them. Children for the same DEV-1302 reason as `BrandRow`.
    BrandList: (props: { children?: ReactNode }) =>
      createElement(BrandList, null, props.children),
    // One row of a `BrandList`. All-string props, all optional except `slug` —
    // anything authored as `prop={…}` would be dropped before it got here.
    BrandLine: (props: { slug: string; booth?: string; note?: string }) =>
      createElement(BrandLine, props),
    // A large statement line that breaks up body copy. Distinct on purpose from
    // the markdown `>` blockquote styled further down this map: that one quotes
    // someone else, this one re-states the article's own argument.
    PullQuote: (props: { children?: ReactNode; attribution?: string }) =>
      createElement(
        PullQuote,
        { attribution: props.attribution },
        props.children,
      ),
    StatsCallout: (props: { stat: string; label: string }) =>
      createElement(StatsCallout, { stat: props.stat, label: props.label }),
    // Editorial fine print (image rights, sponsorship status, data caveats).
    // Muted rather than a `>` blockquote: a blockquote's rule reads as "someone
    // else said this", which is the opposite of a statement the site is making
    // about itself.
    Disclaimer: (props: { children?: ReactNode }) =>
      createElement(
        "aside",
        { className: "my-4 [&>p]:type-body-sm" },
        props.children,
      ),
    // A credited photo. Literal `<figure>`/`<figcaption>` JSX does NOT resolve
    // against this map — only markdown-generated elements and capitalized
    // shortcodes do — so an authored `<figure>` renders unstyled.
    Figure: (props: { src: string; alt: string; caption?: string }) =>
      createElement(StoryFigure, props),
    // `emitJsonLd: false` is load-bearing. The detail page already renders a
    // FaqBlock from `frontmatter.faq`, and that render is the single source of
    // FAQPage structured data for the URL. An in-body `<FaqBlock>` emitting its
    // own `ld+json` would put two FAQPage entities on one page, which can
    // invalidate the rich result outright. In-body blocks are visual only.
    FaqBlock: (props: { questions: Array<{ q: string; a: string }> }) =>
      createElement(FaqBlock, {
        questions: props.questions,
        emitJsonLd: false,
      }),

    h1: (props: ComponentPropsWithoutRef<"h1">) =>
      createElement("h1", {
        ...props,
        className: cn(
          "mt-10 mb-4 scroll-mt-24 type-page-title",
          props.className,
        ),
      }),
    h2: (props: ComponentPropsWithoutRef<"h2">) => {
      const label = visibleText(props.children).trim();
      const sectionNumber = sectionNumbers.get(label);

      if (!sectionNumber) {
        return createElement("h2", {
          ...props,
          className: cn(
            "mt-10 mb-3 scroll-mt-24 type-section",
            props.className,
          ),
        });
      }

      // The trail archetype's section header: a small interface-face ordinal in
      // a left gutter, the content-face title beside it. `aria-hidden` on it is
      // load-bearing — the section nav resolves this heading by its ACCESSIBLE
      // NAME (`discovery-trail.spec.ts`), and a number joined to it would break
      // that as well as read "zero two" aloud before every section.
      //
      // Children go through `createElement`'s variadic arguments, not a
      // `children` prop: the extra arguments win over the spread `props.children`
      // above, and `react/no-children-prop` forbids the prop form.
      return createElement(
        "h2",
        {
          ...props,
          className: cn(
            "mt-16 mb-4 grid scroll-mt-24 grid-cols-[1.75rem_minmax(0,1fr)] items-baseline gap-x-4 type-section md:mt-24 md:grid-cols-[3rem_minmax(0,1fr)]",
            props.className,
          ),
        },
        createElement(
          "span",
          { "aria-hidden": "true", className: "tabular-nums type-metadata" },
          sectionNumber,
        ),
        createElement("span", { className: "min-w-0" }, props.children),
      );
    },
    h3: (props: ComponentPropsWithoutRef<"h3">) =>
      createElement("h3", {
        ...props,
        className: cn(
          "mt-8 mb-2 scroll-mt-24 type-card-title",
          props.className,
        ),
      }),
    h4: (props: ComponentPropsWithoutRef<"h4">) =>
      createElement("h4", {
        ...props,
        className: cn("mt-6 mb-2 scroll-mt-24 type-label", props.className),
      }),
    // `prose-measure` on the block rules (`p`, `ul`, `ol`, `blockquote`) rather
    // than on the container: the same map renders inside a story's
    // `prose-measure` shell and inside a discovery trail's much wider one, and
    // only these rules know that body copy should be read at one width on both.
    // `li` is deliberately left out — it sits inside an already-capped list, so
    // a cap there could only subtract the list indent a second time.
    p: (props: ComponentPropsWithoutRef<"p">) =>
      createElement("p", {
        ...props,
        className: cn(
          "prose-measure my-4 type-body",
          props.className,
        ),
      }),
    ul: (props: ComponentPropsWithoutRef<"ul">) =>
      createElement("ul", {
        ...props,
        className: cn(
          "prose-measure my-4 list-disc space-y-2 pl-5 type-body",
          props.className,
        ),
      }),
    ol: (props: ComponentPropsWithoutRef<"ol">) =>
      createElement("ol", {
        ...props,
        className: cn(
          "prose-measure my-4 list-decimal space-y-2 pl-5 type-body",
          props.className,
        ),
      }),
    li: (props: ComponentPropsWithoutRef<"li">) =>
      createElement("li", {
        ...props,
        className: cn("type-body", props.className),
      }),
    a: (props: ComponentPropsWithoutRef<"a">) =>
      createElement("a", {
        ...props,
        className: cn(
          "rounded-control break-words text-accent underline underline-offset-4 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground",
          props.className,
        ),
      }),
    blockquote: (props: ComponentPropsWithoutRef<"blockquote">) =>
      createElement("blockquote", {
        ...props,
        className: cn(
          "prose-measure my-6 border-l-2 border-accent pl-5 type-body text-ink-soft",
          props.className,
        ),
      }),
    hr: (props: ComponentPropsWithoutRef<"hr">) =>
      createElement("hr", {
        ...props,
        className: cn("my-10 h-px border-0 bg-rule", props.className),
      }),

    // Markdown images are raw `<img>`, not `next/image`: authors write arbitrary
    // remote URLs and there is no intrinsic size to hand the optimizer. 4:3 with
    // `object-cover` matches every other image surface in the product.
    //
    // Capped and centred rather than `w-full`, because this map serves two
    // surfaces of different widths. On a story the shell is already
    // `prose-measure`, so the cap is inert and the photo fills the reading
    // column. On a discovery trail the shell is the wide page measure, where an
    // uncapped 4:3 image renders taller than a laptop viewport — one photo
    // becoming a full-screen interruption mid-paragraph. The same class does
    // nothing on the first surface and the whole job on the second.
    img: (props: ComponentPropsWithoutRef<"img">) =>
      createElement("img", {
        loading: "lazy",
        decoding: "async",
        ...props,
        className: cn(
          "mx-auto my-6 aspect-media w-full prose-measure rounded-surface border border-rule bg-surface-deep object-cover",
          props.className,
        ),
      }),

    // Wrapped so a wide table scrolls inside the column instead of widening the
    // page on mobile. `border-collapse` plus a border on the table *and* the
    // cells is what produces real rules — a bare `<table>` has none.
    table: (props: ComponentPropsWithoutRef<"table">) =>
      createElement(
        "div",
        { className: "my-6 w-full overflow-x-auto" },
        createElement("table", {
          ...props,
          className: cn(
            "w-full border-collapse border border-rule text-left type-body-sm text-ink-soft",
            props.className,
          ),
        }),
      ),
    th: (props: ComponentPropsWithoutRef<"th">) =>
      createElement("th", {
        ...props,
        className: cn(
          "border border-rule bg-surface px-3 py-2 type-label",
          props.className,
        ),
      }),
    td: (props: ComponentPropsWithoutRef<"td">) =>
      createElement("td", {
        ...props,
        className: cn(
          "border border-rule px-3 py-2 align-top type-body-sm text-ink-soft",
          props.className,
        ),
      }),

    /*
     * Inline code. Inside a `<pre>` the chrome would double up, so `pre` strips
     * it back off its direct `code` child rather than this needing to know its
     * parent.
     *
     * `font-mono` HERE AND ONLY HERE. DESIGN.md says no monospace face ships,
     * and v2 deleted Geist Mono rather than carry an undocumented third face —
     * admin renders field identifiers in the interface face (`--font-hei`)
     * for exactly that reason. Code is
     * the one place the rule does not survive contact: character alignment is
     * what a code block is FOR, and proportional code is a legibility
     * regression a reader notices immediately. This is a deliberate amendment
     * with a Code row in DESIGN.md section 8, not a leftover — no monospace
     * face is loaded, so this resolves to the reader's own monospace stack.
     */
    code: (props: ComponentPropsWithoutRef<"code">) =>
      createElement("code", {
        ...props,
        className: cn(
          "rounded-surface border border-rule bg-surface px-1.5 py-0.5 font-mono text-[0.85em]",
          props.className,
        ),
      }),
    pre: (props: ComponentPropsWithoutRef<"pre">) =>
      createElement("pre", {
        ...props,
        className: cn(
          "my-6 overflow-x-auto rounded-surface border border-rule bg-surface p-4 font-mono text-[0.8125rem] leading-[1.7] text-ink",
          "[&>code]:rounded-none [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit",
          props.className,
        ),
      }),
  };
}
