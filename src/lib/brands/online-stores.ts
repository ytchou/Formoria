/**
 * Single source of truth for the brand online stores.
 *
 * An online store is a platform a brand sells through on the web: its own
 * official site, plus the marketplaces. Physical retail is a separate concept
 * with a separate module and must not be folded in here.
 *
 * The stores are otherwise spelled out as literals across roughly fifty
 * files — column names, camelCase field names, host lists, URL patterns, and
 * i18n message keys all restated by hand. Consumers should derive from this
 * registry instead of re-listing.
 *
 * This module is shared client/server code: it imports nothing from
 * `@/lib/services/**` and nothing server-only, matching the precedent set by
 * `src/lib/brands/link-fallback.ts`.
 *
 * ORDER INVARIANT — the array order below is load-bearing, not cosmetic.
 * `website` MUST stay first. Three dependants read the order as priority:
 *   - `src/lib/json-ld.ts` — the canonical URL `??` chain falls back in exactly
 *     this order, so reordering changes which link a brand publishes as its
 *     canonical destination.
 *   - `src/lib/brands/link-fallback.ts` — the visit-link candidate list is
 *     evaluated in this order, so reordering changes which link the brand card
 *     and detail CTA point at.
 *   - `src/lib/services/link-enrichment.ts` — `URL_TO_LINK_COLUMN` spreads this
 *     registry in order, so reordering changes which column a submitted URL is
 *     classified into when two patterns could both match.
 * Adding a store at the end is safe; reordering the existing stores is not.
 *
 * NOTE: this file must contain zero Han characters, including in comments — the
 * project's CJK guard test scans comments. The registry stores i18n message
 * *keys*, never the labels themselves.
 */

/** Named i18n message keys per surface, as full dot paths from the message root. */
interface OnlineStoreMessageKeys {
  /** Link label on the brand detail page. */
  readonly brandDetailLink: string
  /** Outbound CTA label / aria label on the brand detail page. */
  readonly brandDetailAction: string
  /** Store phrase used inside the generated brand FAQ answers. */
  readonly brandFaqChannel: string
  /** Outbound-destination row label in the owner dashboard analytics. */
  readonly analyticsOutboundDestination: string
  /** Field label in the owner brand-edit wizard. */
  readonly dashboardEditField: string
  /** Field label in the admin corrections queue (keyed by DB column). */
  readonly adminCorrectionField: string
}

/**
 * A registry message key rendered relative to the namespace a consumer's `t`
 * is already scoped to. The registry stores full dot paths from the message
 * root; `useTranslations('brandDetail')` wants the leaf.
 */
export function onlineStoreMessageKey(fullKey: string, namespace: string): string {
  const prefix = `${namespace}.`
  return fullKey.startsWith(prefix) ? fullKey.slice(prefix.length) : fullKey
}

export interface OnlineStoreDescriptor {
  /** Stable store identifier. Persisted in analytics as `link_type` — frozen. */
  readonly key: string
  /** camelCase field name on the `Brand` type. */
  readonly camel: string
  /** snake_case database column. */
  readonly column: string
  /**
   * Hostnames owned by the store. `HOST_KINDS` in
   * `src/lib/brands/link-fallback.ts` is built from this list, not the other
   * way round. Matching there is `host === h || host.endsWith('.' + h)`.
   * `website` owns no host by design.
   */
  readonly hosts: readonly string[]
  /**
   * URL pattern used to classify a submitted URL. `URL_TO_LINK_COLUMN` in
   * `src/lib/services/link-enrichment.ts` spreads these patterns in registry
   * order rather than re-listing them. `website` is pattern-less by design: it
   * is the fallback bucket, not a recognizable host.
   */
  readonly urlPattern: RegExp | null
  /**
   * Whether a bare origin is an acceptable value.
   * `BARE_ROOT_REJECTING_FIELDS` in `src/lib/services/link-enrichment.ts` is
   * derived from this flag — a store with `false` is added there. `website` is
   * exempt because a brand's own site legitimately is a bare origin.
   */
  readonly allowBareRoot: boolean
  /**
   * Lowercase platform slug used when matching submission / brand
   * `purchaseLinks[].platform` entries (see `src/lib/services/brands.ts` and
   * `src/lib/services/submission-pipeline.ts`). Matched against inbound
   * payloads — frozen.
   */
  readonly platformSlug: string
  readonly messageKeys: OnlineStoreMessageKeys
}

export const ONLINE_STORES = [
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
] as const satisfies readonly OnlineStoreDescriptor[]

export type OnlineStore = (typeof ONLINE_STORES)[number]
export type OnlineStoreKey = OnlineStore['key']
export type OnlineStoreColumn = OnlineStore['column']
export type OnlineStoreCamelField = OnlineStore['camel']
export type OnlineStorePlatformSlug = OnlineStore['platformSlug']

/** DB columns, in registry order. Derived — never re-list. */
export const ONLINE_STORE_COLUMNS: readonly OnlineStoreColumn[] = ONLINE_STORES.map(
  (store) => store.column
)

/**
 * camelCase `Brand` fields, in registry order. Index-aligned with
 * ONLINE_STORE_COLUMNS.
 */
export const ONLINE_STORE_CAMEL_FIELDS: readonly OnlineStoreCamelField[] = ONLINE_STORES.map(
  (store) => store.camel
)

function indexBy<K extends string>(pick: (store: OnlineStore) => K): Record<K, OnlineStore> {
  return Object.fromEntries(
    ONLINE_STORES.map((store): [K, OnlineStore] => [pick(store), store])
  ) as Record<K, OnlineStore>
}

export const onlineStoreByColumn = indexBy<OnlineStoreColumn>((store) => store.column)

export const onlineStoreByPlatformSlug = indexBy<OnlineStorePlatformSlug>(
  (store) => store.platformSlug
)

export const onlineStoreByKey = indexBy<OnlineStoreKey>((store) => store.key)

/**
 * The store whose `urlPattern` matches the URL, or null.
 *
 * `website` has no pattern and is therefore never returned: it is the fallback
 * bucket a caller falls into when this returns null, mirroring how
 * `classifySubmittedUrl` treats an unmatched URL today.
 */
export function onlineStoreForUrl(url: string): OnlineStore | null {
  for (const store of ONLINE_STORES) {
    if (store.urlPattern && store.urlPattern.test(url)) {
      return store
    }
  }
  return null
}
