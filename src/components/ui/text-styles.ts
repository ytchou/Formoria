import { cva } from 'class-variance-authority'

export const textStyles = cva('', {
  variants: {
    variant: {
      display: 'type-display',
      hero: 'type-hero',
      heroInverse: 'type-hero-inverse',
      pageTitle: 'type-page-title',
      pageTitleLarge: 'type-page-title-large',
      pageSubtitle: 'type-page-subtitle',
      sectionTitle: 'type-section-title',
      sectionTitleLarge: 'type-section-title-large',
      sectionDescription: 'type-section-description',
      cardTitle: 'type-card-title',
      cardTitleSmall: 'type-card-title-small',
      cardDescription: 'type-card-description',
      subsectionTitle: 'type-subsection-title',
      fieldLabel: 'type-field-label',
      fieldValue: 'type-field-value',
      formLabel: 'type-form-label',
      formHint: 'type-form-hint',
      body: 'type-body',
      bodyMuted: 'type-body-muted',
      bodyInverse: 'type-body-inverse',
      bodyEmphasis: 'type-body-emphasis',
      bodyEmphasisInverse: 'type-body-emphasis-inverse',
      metadata: 'type-metadata',
      caption: 'type-caption',
      micro: 'type-micro',
      eyebrow: 'type-eyebrow',
      eyebrowMuted: 'type-eyebrow-muted',
      eyebrowCta: 'type-eyebrow-cta',
      eyebrowForeground: 'type-eyebrow-foreground',
      stat: 'type-stat',
      statLarge: 'type-stat-large',
      navItem: 'type-nav-item',
      navItemActive: 'type-nav-item-active',
      link: 'type-link',
      error: 'type-error',
      success: 'type-success',
      successPanel: 'type-success-panel',
      emptyTitle: 'type-empty-title',
      emptyBody: 'type-empty-body',
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
  neutralBadge: 'bg-secondary text-muted-foreground border-transparent',
  warningBadge:
    'bg-mit-verified-bg text-mit-verified border-transparent',
  dangerBadge:
    'bg-destructive/10 text-destructive border-transparent',
  demoBadge: 'bg-secondary text-foreground border-transparent',
} as const
