import { cva } from 'class-variance-authority'

/**
 * 28 variant names over 12 v2 type roles.
 *
 * The names are kept as an ALIAS layer, not as a second type system: 45 call
 * sites name a variant, and renaming them in the same pass as the 838 raw-class
 * sites would have made one indivisible change out of two independent ones.
 * Several names are now synonyms — `sectionTitle` and `cardTitle` both resolve
 * to `type-card-title` — which is the point: the collapse happens here, once,
 * instead of at every call site.
 *
 * When a surface is redesigned in a later wave, prefer the role name over the
 * alias, and delete the alias when its last caller goes. Do not add a variant.
 * Seven callerless aliases went that way already (`cardTitleSmall`,
 * `bodyMuted`, `bodyInverse`, `eyebrowMuted`, `eyebrowForeground`,
 * `navItemActive`, `successPanel`); three of them had become pure synonyms of a
 * live variant in the v2 remap, so they could only ever have drifted.
 */
export const textStyles = cva('', {
  variants: {
    variant: {
      display: 'type-section',
      // Long Latin brand names (WENWENWORKS) overflowed 320px at 46px: break
      // anywhere, and step down to the page-title role below 400px (BD2-02).
      // Below 400px the size also tracks the viewport (10vw, never above the
      // page-title 2.5rem), so an 11-letter name still fits the 272px column
      // at 320 instead of splitting mid-word. Shortcut: a fluid step DESIGN.md
      // has not named yet; promote it to a `type-*` role if a second h1 needs it.
      hero: 'type-display [overflow-wrap:anywhere] max-[400px]:type-page-title max-[400px]:text-[length:min(2.5rem,10vw)]',
      pageTitle: 'type-section',
      pageTitleLarge: 'type-page-title',
      pageSubtitle: 'type-body',
      sectionTitle: 'type-card-title',
      sectionTitleLarge: 'type-section',
      sectionDescription: 'type-body-sm',
      cardTitle: 'type-card-title',
      cardDescription: 'type-body-sm',
      subsectionTitle: 'type-body-sm font-semibold text-ink',
      fieldLabel: 'type-metadata',
      fieldValue: 'type-body-sm text-ink',
      formLabel: 'type-body-sm font-semibold text-ink',
      formHint: 'type-metadata',
      body: 'type-body-sm text-ink-soft',
      bodyEmphasis: 'type-body-sm font-medium text-ink',
      metadata: 'type-metadata',
      caption: 'type-metadata',
      micro: 'type-micro',
      eyebrow: 'type-eyebrow',
      stat: 'type-section tabular-nums',
      navItem: 'type-nav hover:text-ink transition-colors',
      link: 'type-nav font-semibold text-accent underline-offset-4 hover:underline',
      error: 'type-metadata text-danger',
      success: 'type-body-sm font-medium text-verified-green',
      emptyTitle: 'type-card-title text-ink-muted',
      emptyBody: 'type-body-sm',
    },
  },
  defaultVariants: {
    variant: 'body',
  },
})

export const fieldTextStyles = {
  label: textStyles({ variant: 'fieldLabel' }),
  value: textStyles({ variant: 'fieldValue' }),
  formLabel: textStyles({ variant: 'formLabel' }),
  hint: textStyles({ variant: 'formHint' }),
  error: textStyles({ variant: 'error' }),
} as const

export const statusStyles = {
  successBadge:
    'bg-verified-green-bg text-verified-green border-transparent',
  neutralBadge: 'bg-surface text-ink-muted border-transparent',
  dangerBadge:
    'bg-danger/10 text-danger border-transparent',
  demoBadge: 'bg-surface text-ink border-transparent',
} as const
