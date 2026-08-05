/**
 * Single source of truth for the brand purchase channels.
 *
 * The channels are otherwise spelled out as literals across roughly fifty
 * files — column names, camelCase field names, host lists, URL patterns, and
 * i18n message keys all restated by hand. Consumers should derive from this
 * registry instead of re-listing.
 *
 * This module is shared client/server code: it imports nothing from
 * `@/lib/services/**` and nothing server-only, matching the precedent set by
 * `src/lib/brands/link-fallback.ts`.
 *
 * ORDER INVARIANT — the array order below is load-bearing, not cosmetic.
 * `website` MUST stay first. Two dependants read the order as priority:
 *   - `src/lib/json-ld.ts` — the canonical URL `??` chain falls back in exactly
 *     this order, so reordering changes which link a brand publishes as its
 *     canonical destination.
 *   - `src/lib/brands/link-fallback.ts` — the visit-link candidate list is
 *     evaluated in this order, so reordering changes which link the brand card
 *     and detail CTA point at.
 * Adding a channel at the end is safe; reordering the existing channels is not.
 *
 * NOTE: this file must contain zero Han characters, including in comments — the
 * project's CJK guard test scans comments. The registry stores i18n message
 * *keys*, never the labels themselves.
 */

/** Named i18n message keys per surface, as full dot paths from the message root. */
export interface PurchaseChannelMessageKeys {
  /** Link label on the brand detail page. */
  readonly brandDetailLink: string
  /** Outbound CTA label / aria label on the brand detail page. */
  readonly brandDetailAction: string
  /** Channel phrase used inside the generated brand FAQ answers. */
  readonly brandFaqChannel: string
  /** Outbound-destination row label in the owner dashboard analytics. */
  readonly analyticsOutboundDestination: string
  /** Field label in the owner brand-edit wizard. */
  readonly dashboardEditField: string
  /** Field label in the admin corrections queue (keyed by DB column). */
  readonly adminCorrectionField: string
}

export interface PurchaseChannelDescriptor {
  /** Stable channel identifier. */
  readonly key: string
  /** camelCase field name on the `Brand` type. */
  readonly camel: string
  /** snake_case database column. */
  readonly column: string
  /**
   * Hostnames owned by the channel, lifted verbatim from `HOST_KINDS` in
   * `src/lib/brands/link-fallback.ts`. Matching there is `host === h ||
   * host.endsWith('.' + h)`. `website` owns no host by design.
   */
  readonly hosts: readonly string[]
  /**
   * URL pattern lifted verbatim from `URL_TO_LINK_COLUMN` in
   * `src/lib/services/link-enrichment.ts`. `website` is pattern-less by design:
   * it is the fallback bucket, not a recognizable host.
   */
  readonly urlPattern: RegExp | null
  /**
   * Whether a bare origin is an acceptable value. Derived from
   * `BARE_ROOT_REJECTING_FIELDS` in `src/lib/services/link-enrichment.ts`: a
   * channel listed there gets `false`. `website` is exempt because a brand's
   * own site legitimately is a bare origin.
   */
  readonly allowBareRoot: boolean
  /**
   * Lowercase platform slug used when matching submission / brand
   * `purchaseLinks[].platform` entries (see `src/lib/services/brands.ts` and
   * `src/lib/services/submission-pipeline.ts`).
   */
  readonly platformSlug: string
  readonly messageKeys: PurchaseChannelMessageKeys
}

export const PURCHASE_CHANNELS = [
  {
    key: 'website',
    camel: 'purchaseWebsite',
    column: 'purchase_website',
    hosts: [],
    urlPattern: null,
    allowBareRoot: true,
    platformSlug: 'website',
    messageKeys: {
      brandDetailLink: 'brandDetail.links.website',
      brandDetailAction: 'brandDetail.actions.visitWebsite',
      brandFaqChannel: 'brandDetail.brandFaq.channels.website',
      analyticsOutboundDestination: 'dashboard.analytics.outboundDestinationWebsite',
      dashboardEditField: 'dashboard.edit.fieldOfficialWebsite',
      adminCorrectionField: 'admin.corrections.fields.purchase_website',
    },
  },
  {
    key: 'pinkoi',
    camel: 'purchasePinkoi',
    column: 'purchase_pinkoi',
    hosts: ['pinkoi.com'],
    urlPattern: /pinkoi\.com\/store\/[^/?#]+/i,
    allowBareRoot: false,
    platformSlug: 'pinkoi',
    messageKeys: {
      brandDetailLink: 'brandDetail.links.pinkoi',
      brandDetailAction: 'brandDetail.actions.visitPinkoi',
      brandFaqChannel: 'brandDetail.brandFaq.channels.pinkoi',
      analyticsOutboundDestination: 'dashboard.analytics.outboundDestinationPinkoi',
      dashboardEditField: 'dashboard.edit.fieldPinkoi',
      adminCorrectionField: 'admin.corrections.fields.purchase_pinkoi',
    },
  },
  {
    key: 'shopee',
    camel: 'purchaseShopee',
    column: 'purchase_shopee',
    hosts: ['shopee.tw', 'shopee.com.tw'],
    urlPattern: /shopee\.tw\/[^/?#]+$/i,
    allowBareRoot: false,
    platformSlug: 'shopee',
    messageKeys: {
      brandDetailLink: 'brandDetail.links.shopee',
      brandDetailAction: 'brandDetail.actions.visitShopee',
      brandFaqChannel: 'brandDetail.brandFaq.channels.shopee',
      analyticsOutboundDestination: 'dashboard.analytics.outboundDestinationShopee',
      dashboardEditField: 'dashboard.edit.fieldShopee',
      adminCorrectionField: 'admin.corrections.fields.purchase_shopee',
    },
  },
  // Discovery is passive URL-pattern classification only; no per-brand SERP
  // probe runs. If passive yield is too low, upgrade behind a gate with a
  // site:myship.7-11.com.tw Serper probe in enrich-phases/links.ts.
  {
    key: 'myship',
    camel: 'purchaseMyship',
    column: 'purchase_myship',
    hosts: ['myship.7-11.com.tw'],
    urlPattern: /myship\.7-11\.com\.tw\/general\/detail\/GM\d+/i,
    allowBareRoot: false,
    platformSlug: 'myship',
    messageKeys: {
      brandDetailLink: 'brandDetail.links.myship',
      brandDetailAction: 'brandDetail.actions.visitMyship',
      brandFaqChannel: 'brandDetail.brandFaq.channels.myship',
      analyticsOutboundDestination: 'dashboard.analytics.outboundDestinationMyship',
      dashboardEditField: 'dashboard.edit.fieldMyship',
      adminCorrectionField: 'admin.corrections.fields.purchase_myship',
    },
  },
] as const satisfies readonly PurchaseChannelDescriptor[]

export type PurchaseChannel = (typeof PURCHASE_CHANNELS)[number]
export type PurchaseChannelKey = PurchaseChannel['key']
export type PurchaseChannelColumn = PurchaseChannel['column']
export type PurchaseChannelCamelField = PurchaseChannel['camel']
export type PurchaseChannelPlatformSlug = PurchaseChannel['platformSlug']

/** DB columns, in registry order. Derived — never re-list. */
export const PURCHASE_COLUMNS: readonly PurchaseChannelColumn[] = PURCHASE_CHANNELS.map(
  (channel) => channel.column
)

/** camelCase `Brand` fields, in registry order. Index-aligned with PURCHASE_COLUMNS. */
export const PURCHASE_CAMEL_FIELDS: readonly PurchaseChannelCamelField[] = PURCHASE_CHANNELS.map(
  (channel) => channel.camel
)

function indexBy<K extends string>(
  pick: (channel: PurchaseChannel) => K
): Record<K, PurchaseChannel> {
  return Object.fromEntries(
    PURCHASE_CHANNELS.map((channel): [K, PurchaseChannel] => [pick(channel), channel])
  ) as Record<K, PurchaseChannel>
}

export const purchaseChannelByColumn = indexBy<PurchaseChannelColumn>(
  (channel) => channel.column
)

export const purchaseChannelByPlatformSlug = indexBy<PurchaseChannelPlatformSlug>(
  (channel) => channel.platformSlug
)

export const purchaseChannelByKey = indexBy<PurchaseChannelKey>((channel) => channel.key)

/**
 * The channel whose `urlPattern` matches the URL, or null.
 *
 * `website` has no pattern and is therefore never returned: it is the fallback
 * bucket a caller falls into when this returns null, mirroring how
 * `classifySubmittedUrl` treats an unmatched URL today.
 */
export function purchaseChannelForUrl(url: string): PurchaseChannel | null {
  for (const channel of PURCHASE_CHANNELS) {
    if (channel.urlPattern && channel.urlPattern.test(url)) {
      return channel
    }
  }
  return null
}
