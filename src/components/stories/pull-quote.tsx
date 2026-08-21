import type { ReactNode } from 'react'

type PullQuoteProps = {
  /** The statement itself, authored as the shortcode's children. */
  children?: ReactNode
  /**
   * Who or what the line is credited to. Optional, and a plain string: MDX
   * drops expression attributes (`prop={…}`) in this setup (DEV-1302), so a
   * shortcode prop that is not a string or children arrives `undefined`.
   */
  attribution?: string
}

/**
 * `<PullQuote>…the line…</PullQuote>` inside story MDX, optionally
 * `<PullQuote attribution="Ziliaoshi, founder">…the line…</PullQuote>`.
 *
 * A pull quote in the magazine sense: it lifts the article's own argument out
 * of the body copy at a size the eye lands on while scrolling, so a long
 * section is not one undifferentiated wall of paragraphs. It is deliberately
 * NOT the same thing as a markdown `>` blockquote — that element already has a
 * row in `storyComponentMap` (muted body text behind a neutral left rule) and
 * means "someone else said this". These two must stay visually distinct or the
 * reader learns nothing from seeing either.
 *
 * Styling stays inside the article's own type scale and the single accent:
 * `type-section` (the same step as an `h2`) plus a `border-accent`
 * left rule. No tint, no card, no border box — a pull quote that looks like a
 * widget reads as an ad and gets scrolled past, which is the exact opposite of
 * why it exists.
 *
 * Semantics follow the attribution, because that is what actually decides them:
 * with a source it is a quotation, so `<blockquote>` + `<cite>`; without one it
 * is the article restating itself in its own voice, and marking that up as a
 * quotation would tell a screen reader something untrue. So an unattributed
 * pull quote is a plain `<p>`.
 */
export function PullQuote({ children, attribution }: PullQuoteProps) {
  // `border-l-2` rather than the `border-l` used by the markdown blockquote:
  // the two live in the same body copy and the weight is part of telling them
  // apart at a glance.
  const frame = 'my-10 border-l-2 border-accent pl-5'

  if (!attribution) {
    return <p className={`${frame} type-section`}>{children}</p>
  }

  return (
    <blockquote className={frame}>
      <p className="type-section">{children}</p>
      {/* `<cite>` is italic by default in every UA stylesheet and this scale is
          already distinct enough; `not-italic` keeps the credit reading as a
          byline rather than as emphasis. */}
      <cite className="mt-3 block not-italic type-metadata">{attribution}</cite>
    </blockquote>
  )
}
