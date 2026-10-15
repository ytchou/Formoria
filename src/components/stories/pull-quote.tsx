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
 * Styling is type alone (EL-11): `type-page-title` 明體 in `ink`, a step above
 * any `h2` in the body, inside hanging corner brackets, with `my-section` above
 * and below so it breaks the reading rhythm on purpose. No accent — the accent
 * is interaction only (DESIGN §2) and a quote is not interactive; the 藍染 bar
 * it used to carry was the one static use of the accent on /about. No tint, no
 * card, no border box either — a pull quote that looks like a widget reads as
 * an ad and gets scrolled past, which is the exact opposite of why it exists.
 *
 * The opening 「 hangs: from `md` it sits 1em left of the column, so the text
 * edge stays on the line the body copy starts on. Below `md` there is no
 * margin to hang into, and it sets inline. Both brackets are `aria-hidden`:
 * they are typographic ornament, and the accessible text stays the statement
 * alone. Ceiling: they are corner brackets on every locale, including an
 * English line on /en; switch to per-`lang` glyphs if that reads wrong.
 *
 * Semantics follow the attribution, because that is what actually decides them:
 * with a source it is a quotation, so `<blockquote>` + `<cite>`; without one it
 * is the article restating itself in its own voice, and marking that up as a
 * quotation would tell a screen reader something untrue. So an unattributed
 * pull quote is a plain `<p>`.
 */
export function PullQuote({ children, attribution }: PullQuoteProps) {
  const line = (
    <>
      <span aria-hidden="true" className="md:-ml-[1em]">
        「
      </span>
      {children}
      <span aria-hidden="true">」</span>
    </>
  )

  if (!attribution) {
    return <p className="my-section type-page-title text-ink">{line}</p>
  }

  return (
    <blockquote className="my-section">
      <p className="type-page-title text-ink">{line}</p>
      {/* `<cite>` is italic by default in every UA stylesheet and this scale is
          already distinct enough; `not-italic` keeps the credit reading as a
          byline rather than as emphasis. */}
      <cite className="mt-3 block not-italic type-metadata">{attribution}</cite>
    </blockquote>
  )
}
