import { createElement, type ComponentPropsWithoutRef, type ReactNode } from 'react'

import { BrandCardMdx } from '@/components/stories/brand-card-mdx'
import { BrandGrid } from '@/components/stories/brand-grid'
import { BrandRow } from '@/components/stories/brand-row'
import { FaqBlock } from '@/components/stories/faq-block'
import { StatsCallout } from '@/components/stories/stats-callout'
import { cn } from '@/lib/utils'

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
export const storyComponentMap = {
  BrandCard: (props: { slug: string; note?: string; eyebrow?: string }) =>
    createElement(BrandCardMdx, props),
  BrandGrid: (props: { slugs: string[]; notes?: Record<string, string> }) =>
    createElement(BrandGrid, props),
  // Children, not a `slugs` array — MDX expression attributes are dropped
  // (DEV-1302), so the row's cards are authored as nested `<BrandCard>`.
  BrandRow: (props: { children?: ReactNode }) => createElement(BrandRow, null, props.children),
  StatsCallout: (props: { stat: string; label: string }) =>
    createElement(StatsCallout, { stat: props.stat, label: props.label }),
  // `emitJsonLd: false` is load-bearing. The detail page already renders a
  // FaqBlock from `frontmatter.faq`, and that render is the single source of
  // FAQPage structured data for the URL. An in-body `<FaqBlock>` emitting its
  // own `ld+json` would put two FAQPage entities on one page, which can
  // invalidate the rich result outright. In-body blocks are visual only.
  FaqBlock: (props: { questions: Array<{ q: string; a: string }> }) =>
    createElement(FaqBlock, { questions: props.questions, emitJsonLd: false }),

  h1: (props: ComponentPropsWithoutRef<'h1'>) =>
    createElement('h1', {
      ...props,
      className: cn('mt-10 mb-4 scroll-mt-24 type-page-title-large', props.className),
    }),
  h2: (props: ComponentPropsWithoutRef<'h2'>) =>
    createElement('h2', {
      ...props,
      className: cn('mt-10 mb-3 scroll-mt-24 type-section-title-large', props.className),
    }),
  h3: (props: ComponentPropsWithoutRef<'h3'>) =>
    createElement('h3', {
      ...props,
      className: cn('mt-8 mb-2 scroll-mt-24 type-subsection-title', props.className),
    }),
  h4: (props: ComponentPropsWithoutRef<'h4'>) =>
    createElement('h4', {
      ...props,
      className: cn('mt-6 mb-2 scroll-mt-24 type-label', props.className),
    }),
  p: (props: ComponentPropsWithoutRef<'p'>) =>
    createElement('p', { ...props, className: cn('my-4 type-body', props.className) }),
  ul: (props: ComponentPropsWithoutRef<'ul'>) =>
    createElement('ul', {
      ...props,
      className: cn('my-4 list-disc space-y-2 pl-5 type-body', props.className),
    }),
  ol: (props: ComponentPropsWithoutRef<'ol'>) =>
    createElement('ol', {
      ...props,
      className: cn('my-4 list-decimal space-y-2 pl-5 type-body', props.className),
    }),
  li: (props: ComponentPropsWithoutRef<'li'>) =>
    createElement('li', { ...props, className: cn('type-body', props.className) }),
  a: (props: ComponentPropsWithoutRef<'a'>) =>
    createElement('a', {
      ...props,
      className: cn(
        'rounded-sm break-words text-primary underline underline-offset-4 hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        props.className,
      ),
    }),
  blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) =>
    createElement('blockquote', {
      ...props,
      className: cn('my-6 border-l border-border pl-4 type-body-muted', props.className),
    }),
  hr: (props: ComponentPropsWithoutRef<'hr'>) =>
    createElement('hr', { ...props, className: cn('my-10 h-px border-0 bg-border', props.className) }),

  // Markdown images are raw `<img>`, not `next/image`: authors write arbitrary
  // remote URLs and there is no intrinsic size to hand the optimizer. 4:3 with
  // `object-cover` matches every other image surface in the product.
  img: (props: ComponentPropsWithoutRef<'img'>) =>
    createElement('img', {
      loading: 'lazy',
      decoding: 'async',
      ...props,
      className: cn(
        'my-6 aspect-[4/3] w-full rounded-lg border border-border bg-muted object-cover',
        props.className,
      ),
    }),

  // Wrapped so a wide table scrolls inside the column instead of widening the
  // page on mobile. `border-collapse` plus a border on the table *and* the
  // cells is what produces real rules — a bare `<table>` has none.
  table: (props: ComponentPropsWithoutRef<'table'>) =>
    createElement(
      'div',
      { className: 'my-6 w-full overflow-x-auto' },
      createElement('table', {
        ...props,
        className: cn(
          'w-full border-collapse border border-border text-left type-body',
          props.className,
        ),
      }),
    ),
  th: (props: ComponentPropsWithoutRef<'th'>) =>
    createElement('th', {
      ...props,
      className: cn('border border-border bg-secondary px-3 py-2 type-label', props.className),
    }),
  td: (props: ComponentPropsWithoutRef<'td'>) =>
    createElement('td', {
      ...props,
      className: cn('border border-border px-3 py-2 align-top type-body', props.className),
    }),

  // Inline code. Inside a `<pre>` the chrome would double up, so `pre` strips it
  // back off its direct `code` child rather than this needing to know its parent.
  code: (props: ComponentPropsWithoutRef<'code'>) =>
    createElement('code', {
      ...props,
      className: cn(
        'rounded-sm border border-border bg-secondary px-1.5 py-0.5 font-mono text-[0.85em]',
        props.className,
      ),
    }),
  pre: (props: ComponentPropsWithoutRef<'pre'>) =>
    createElement('pre', {
      ...props,
      className: cn(
        'my-6 overflow-x-auto rounded-lg border border-border bg-secondary p-4 font-mono text-[0.8125rem] leading-[1.7] text-foreground',
        '[&>code]:rounded-none [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit',
        props.className,
      ),
    }),
}
