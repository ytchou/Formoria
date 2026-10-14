import {
  Children,
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
 * One declared section of a trail, in authoring order. The component map reads
 * only `title` — it is what the markdown `##` heading resolves against. `notes`
 * (one pick note per product, keyed `brandSlug/productKey`) is read by the
 * trail page.
 */
export type TrailSectionRef = {
  key: string;
  title: string;
  notes?: Readonly<Record<string, string>>;
};

function visibleText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return visibleText(node.props.children);
  return "";
}

/** The slice of an MDX syntax-tree node `remarkTrailSections` reads. */
type MdxTreeNode = {
  type: string;
  name?: string | null;
  children?: MdxTreeNode[];
};

/**
 * Remark plugin: routes a trail's authored `<section id="…">` through the
 * component map as `TrailSection`.
 *
 * The rename is the only way in. `<section>` is explicit lowercase JSX, and MDX
 * never turns explicit JSX into a component from the map (`recma-jsx-rewrite`:
 * "Do not turn explicit JSX into components from `_components`"), so a
 * `section` row there could never fire. A capitalized name DOES resolve, the
 * same way `<TrailProducts>` does, and this runs on the syntax tree after
 * parsing, so the section's markdown children are already parsed and nothing
 * about the authored file changes.
 *
 * Applied only by the trail page (`trail-content.tsx`). A story keeps its
 * literal `<section>`s, if it ever authors one.
 */
export function remarkTrailSections() {
  return (tree: MdxTreeNode) => {
    const visit = (node: MdxTreeNode) => {
      if (node.type === "mdxJsxFlowElement" && node.name === "section") {
        node.name = "TrailSection";
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/**
 * The story material marker (EL-10): 「陶｜這一窯…」 splits at the full-width bar
 * into the marker 「陶」 and the title after it. Only a plain-string heading is
 * split — one carrying inline markup has no safe place to cut, so it renders
 * as an ordinary heading.
 */
function splitMaterialMarker(
  children: ReactNode,
): { marker: string; rest: string } | null {
  if (typeof children !== "string") return null;
  const bar = children.indexOf("｜");
  if (bar <= 0) return null;
  const marker = children.slice(0, bar).trim();
  const rest = children.slice(bar + 1).trimStart();
  if (!marker || !rest) return null;
  return { marker, rest };
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
   * components from `_components`"); `remarkTrailSections` renames it for
   * the rail layout, which still says nothing about its position among the
   * declared sections. The `##` heading inside it IS
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

  const TrailProductsShortcode = (props: { section: string }) =>
    createElement(TrailProducts, props);

  const h2 = (props: ComponentPropsWithoutRef<"h2">) => {
    const label = visibleText(props.children).trim();
    const sectionNumber = sectionNumbers.get(label);

    if (!sectionNumber) {
      const split = trailSections ? null : splitMaterialMarker(props.children);
      if (!split) {
        return createElement("h2", {
          ...props,
          className: cn(
            "mt-10 mb-3 scroll-mt-24 type-section",
            props.className,
          ),
        });
      }

      // A story's material section (EL-10). The marker hangs in the left
      // margin from `xl`, right-aligned 2.5rem off the column so the title
      // keeps the column edge; below `xl` there is no margin and it sits
      // above the title. 明體 because it is content (DESIGN §1), `text-rule`
      // because it is structure the eye registers, not something to read —
      // and never the accent, which is interaction only (§2).
      //
      // `aria-hidden` on the marker plus an `sr-only` copy of 「陶｜」 keeps the
      // accessible name the full authored text, so a screen reader still hears
      // 陶｜這一窯… and an in-page link resolving the heading by name still
      // matches. Stories only: a trail heading never splits.
      return createElement(
        "h2",
        {
          ...props,
          className: cn(
            "relative mt-10 mb-3 scroll-mt-24 type-section",
            props.className,
          ),
        },
        createElement(
          "span",
          {
            "aria-hidden": "true",
            className:
              "mb-3 block whitespace-nowrap type-display leading-none text-rule xl:absolute xl:top-0 xl:right-[calc(100%+2.5rem)] xl:mb-0 xl:text-right",
          },
          split.marker,
        ),
        createElement("span", { className: "sr-only" }, `${split.marker}｜`),
        split.rest,
      );
    }

    // The trail archetype's section header: an ordinal beside the
    // content-face title below `lg`, and from `lg` a 明體 display numeral
    // stacked above it in the section's rail (EL-09, see `TrailSection`).
    // The numeral is `ink-muted`, never the accent: it is structure, not
    // interaction (DESIGN §2). `aria-hidden` on it is load-bearing — the
    // section nav resolves this heading by its ACCESSIBLE NAME
    // (`discovery-trail.spec.ts`), and a number joined to it would break that
    // as well as read "zero two" aloud before every section.
    //
    // `lg:mt-0`: at `lg` the section is a grid, its items do not collapse
    // margins, and the section itself carries the top spacing so the rail
    // and the prose start on one line.
    //
    // Children go through `createElement`'s variadic arguments, not a
    // `children` prop: the extra arguments win over the spread `props.children`
    // above, and `react/no-children-prop` forbids the prop form.
    return createElement(
      "h2",
      {
        ...props,
        className: cn(
          "mt-16 mb-4 grid scroll-mt-24 grid-cols-[1.75rem_minmax(0,1fr)] items-baseline gap-x-4 type-section md:mt-24 md:grid-cols-[3rem_minmax(0,1fr)] lg:mt-0 lg:mb-0 lg:block",
          props.className,
        ),
      },
      createElement(
        "span",
        {
          "aria-hidden": "true",
          className:
            "tabular-nums type-metadata lg:mb-4 lg:block lg:type-display lg:text-ink-muted",
        },
        sectionNumber,
      ),
      createElement("span", { className: "min-w-0 lg:block" }, props.children),
    );
  };

  /*
   * One authored trail `<section>`, renamed by `remarkTrailSections` (EL-09).
   *
   * Below `lg` it renders the children in authoring order, as before — the
   * wrappers are plain blocks, and their margins collapse through them. From
   * `lg` it is a two-track grid: a sticky rail holding the numbered heading,
   * the prose in the second track (still capped by `prose-measure` on each
   * block rule), and the product shelf spanning both. Without that the prose
   * hugged the left 768px of a 1312px page while the shelves ran full width.
   *
   * The children are PARTITIONED, not placed by CSS: a rail that sticks while
   * the prose scrolls needs a grid area as tall as the prose, and the only CSS
   * way to give a lone `h2` one is a row-span over every sibling — a guessed
   * span that creates implicit rows for nothing. Partitioning compares element TYPES against this
   * map's own `h2` and `TrailProducts`, which are exactly what MDX passes for a
   * `##` and a `<TrailProducts>`. Runs keep authoring order: the rail sits
   * beside the first prose run, and a shelf followed by more prose yields a
   * second run in the prose track below it.
   *
   * A section with no `##` renders unchanged — nothing to put in a rail.
   */
  const TrailSection = ({
    children,
    ...props
  }: ComponentPropsWithoutRef<"section">) => {
    const nodes = Children.toArray(children);
    const headingIndex = nodes.findIndex(
      (node) => isValidElement(node) && node.type === h2,
    );
    if (headingIndex < 0) return createElement("section", props, children);

    const rows: ReactNode[] = [
      createElement(
        "div",
        {
          key: "rail",
          "data-slot": "trail-rail",
          className:
            "lg:sticky lg:top-[calc(var(--nav-height)+2rem)] lg:self-start",
        },
        nodes[headingIndex],
      ),
    ];
    let run: ReactNode[] = [];
    const flushRun = () => {
      if (run.length === 0) return;
      rows.push(
        createElement(
          "div",
          {
            key: `prose-${rows.length}`,
            "data-slot": "trail-prose",
            // Grid items keep their children's margins, so the run's outer
            // ones are zeroed at `lg`: the first so the prose starts level
            // with the rail, the last so the shelf's own `mt-8` is the gap.
            className:
              "min-w-0 lg:col-start-2 lg:[&>:first-child]:mt-0 lg:[&>:last-child]:mb-0",
          },
          run,
        ),
      );
      run = [];
    };
    nodes.forEach((node, index) => {
      if (index === headingIndex) return;
      if (isValidElement(node) && node.type === TrailProductsShortcode) {
        flushRun();
        rows.push(
          createElement(
            "div",
            {
              key: `shelf-${index}`,
              "data-slot": "trail-shelf",
              className: "lg:col-span-2",
            },
            node,
          ),
        );
        return;
      }
      run.push(node);
    });
    flushRun();

    return createElement(
      "section",
      {
        ...props,
        className: cn(
          "lg:mt-24 lg:grid lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-x-gutter",
          props.className,
        ),
      },
      rows,
    );
  };

  return {
    BrandCard: (props: { slug: string; note?: string; eyebrow?: string }) =>
      createElement(BrandCardMdx, props),
    BrandGrid: (props: { slugs: string[]; notes?: Record<string, string> }) =>
      createElement(BrandGrid, props),
    // Images come from the brand listing rather than hard-coded storage URLs,
    // so the story stays in sync with the directory.
    BrandGallery: (props: { slug: string; caption?: string }) =>
      createElement(BrandGallery, props),
    TrailProducts: TrailProductsShortcode,
    TrailSection,
    // Children, not a `slugs` array — MDX expression attributes are dropped
    // (DEV-1302), so the row's cards are authored as nested `<BrandCard>`.
    BrandRow: (props: { children?: ReactNode }) =>
      createElement(BrandRow, null, props.children),
    // The compact alternative to `BrandRow`: stacked hairline-ruled rows instead
    // of a 3-up card grid, for sections that list brands rather than feature
    // them. Children for the same DEV-1302 reason as `BrandRow`.
    BrandList: (props: { children?: ReactNode }) =>
      createElement(BrandList, null, props.children),
    // One row of a `BrandList`. All-string props, all optional — `name` alone
    // renders an unlinked row. Anything authored as `prop={…}` would be dropped
    // before it got here.
    BrandLine: (props: {
      slug?: string;
      name?: string;
      booth?: string;
      note?: string;
    }) =>
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
    FaqBlock: (props: { questions: Array<{ q: string; a: string }> }) =>
      createElement(FaqBlock, { questions: props.questions }),

    h1: (props: ComponentPropsWithoutRef<"h1">) =>
      createElement("h1", {
        ...props,
        className: cn(
          "mt-10 mb-4 scroll-mt-24 type-page-title",
          props.className,
        ),
      }),
    h2,
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
    // A 1px `border-rule` hairline, never the accent (EL-11): the accent is
    // interaction only (DESIGN §2). The rule still marks "someone else said
    // this", which keeps it apart from `PullQuote`'s bracketed display line.
    blockquote: (props: ComponentPropsWithoutRef<"blockquote">) =>
      createElement("blockquote", {
        ...props,
        className: cn(
          "prose-measure my-6 border-l border-rule pl-5 type-body text-ink-soft",
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
