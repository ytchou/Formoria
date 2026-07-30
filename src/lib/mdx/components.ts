import { createElement, type ComponentPropsWithoutRef, type ReactNode } from 'react'

import { BrandCardMdx } from '@/components/stories/brand-card-mdx'
import { BrandGrid } from '@/components/stories/brand-grid'
import { BrandSpotlight } from '@/components/stories/brand-spotlight'
import { FaqBlock } from '@/components/stories/faq-block'
import { StatsCallout } from '@/components/stories/stats-callout'

/**
 * Story MDX shortcodes plus element-level typography for the prose itself.
 *
 * The Tailwind typography plugin is deliberately NOT installed — the project already
 * defines its own `type-*` scale in globals.css and the plugin would ship a
 * second, competing type system. Every markdown element therefore carries an
 * explicit class from that scale, which is also why the story page no longer
 * wraps the body in inert `prose` classes.
 *
 * `scroll-mt-24` on headings keeps anchor targets clear of the sticky header.
 */
export const storyComponentMap = {
  BrandCard: (props: { slug: string; note?: string; eyebrow?: string }) =>
    createElement(BrandCardMdx, props),
  BrandGrid: (props: { slugs: string[]; notes?: Record<string, string> }) =>
    createElement(BrandGrid, props),
  BrandSpotlight: (props: { slug: string; children?: ReactNode }) =>
    createElement(BrandSpotlight, { slug: props.slug }, props.children),
  StatsCallout: (props: { stat: string; label: string }) =>
    createElement(StatsCallout, { stat: props.stat, label: props.label }),
  FaqBlock: (props: { questions: Array<{ q: string; a: string }> }) =>
    createElement(FaqBlock, { questions: props.questions }),

  h2: (props: ComponentPropsWithoutRef<'h2'>) =>
    createElement('h2', { ...props, className: 'mt-10 mb-3 scroll-mt-24 type-section-title-large' }),
  h3: (props: ComponentPropsWithoutRef<'h3'>) =>
    createElement('h3', { ...props, className: 'mt-8 mb-2 scroll-mt-24 type-subsection-title' }),
  p: (props: ComponentPropsWithoutRef<'p'>) =>
    createElement('p', { ...props, className: 'my-4 type-body' }),
  ul: (props: ComponentPropsWithoutRef<'ul'>) =>
    createElement('ul', { ...props, className: 'my-4 list-disc space-y-2 pl-5 type-body' }),
  ol: (props: ComponentPropsWithoutRef<'ol'>) =>
    createElement('ol', { ...props, className: 'my-4 list-decimal space-y-2 pl-5 type-body' }),
  li: (props: ComponentPropsWithoutRef<'li'>) =>
    createElement('li', { ...props, className: 'type-body' }),
  a: (props: ComponentPropsWithoutRef<'a'>) =>
    createElement('a', {
      ...props,
      className:
        'rounded-xs break-words text-primary underline underline-offset-4 hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    }),
  blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) =>
    createElement('blockquote', {
      ...props,
      className: 'my-6 border-l border-border pl-4 type-body-muted',
    }),
  hr: (props: ComponentPropsWithoutRef<'hr'>) =>
    createElement('hr', { ...props, className: 'my-10 h-px border-0 bg-border' }),
}
