# Search Console scorecard definitions

## Metric definitions

The scorecard is built from Google Search Console query and landing-page rows for one
property and one complete reporting window. Query metrics are calculated from query rows;
landing-page metrics are calculated from page rows.

### Query totals and branded split

- **Total impressions** are the number of Google Search results impressions across all query
  rows. **Total clicks** are the corresponding Search Console clicks.
- **CTR** is `clicks / impressions`. It is `0` when impressions are `0`.
- **`nonBrand`** contains every query that does not classify as `branded`. **`branded`**
  contains queries whose normalized text matches `formoria`. The two sets are disjoint, and
  their impressions and clicks sum to **`total`**.

### Query clusters

Every query is assigned to the first matching ordered pattern. Evaluation order is
`branded` → `design` → `core-taiwan-brand` → `cultural-creative` → `craft-handmade` →
`product-category` → `english`: `branded` wins over any topic cluster, and `design` is
evaluated before `core-taiwan-brand` because every design literal ends in 品牌, which the
broader core pattern also matches. The `clusters` field reports the seven named clusters plus
the explicit unclassified marker:

- **branded** — contains `formoria`.
- **core-taiwan-brand** — a Taiwan query containing brand, directory, platform, or select-shop
  language.
- **cultural-creative** — a Taiwan query containing cultural-creative language.
- **craft-handmade** — a Taiwan query containing craft, handmade, handwork, or artisan language.
- **design** — a Taiwan query containing design-brand, original-brand, or independent-brand
  language.
- **product-category** — a Taiwan query containing a tracked product category such as bags,
  furniture, home goods, accessories, stationery, apparel, ceramics, tableware, bedding, or
  storage.
- **english** — an English-language query beginning with the Taiwanese-brand intent vocabulary
  represented by the extraction pattern.

Queries matching none of the patterns are assigned the explicit **unclassified** cluster; they
are never silently assigned to another cluster. Each cluster reports impressions, clicks, CTR,
and average position.

Average position per cluster is impression-weighted: `sum(position * impressions) /
sum(impressions)`. When every row in that cluster has zero impressions, the scorecard uses the
plain arithmetic mean of the row positions instead.

### Position buckets

`positionBuckets` counts query rows by average Search Console position. The boundaries are
inclusive on the upper end and each valid position belongs to exactly one bucket:

- **1-3**: `1 <= p <= 3`
- **4-10**: `3 < p <= 10`
- **11-20**: `10 < p <= 20`
- **21-50**: `20 < p <= 50`
- **50+**: `p > 50` or another out-of-range value

A row with **no reported position** (Search Console omits the field, or reports a
non-positive value) is **absent**, not zero: it is excluded from the buckets entirely and from
the impression-weighted average position, while its impressions and clicks still count toward
the cluster and the totals. Position 1 is the best possible ranking, so a `0` would otherwise
be scored as better than every real result.

### Landing pages and page types

- **landingPages** preserves each raw landing-page URL with summed impressions and clicks and
  sorts the array by impressions descending.
- **pageTypes** aggregates landing-page impressions, clicks, and CTR by the canonical landing
  page type. Locale prefixes such as `/en` and `/zh-TW` are removed for classification, so
  `/brands` and `/en/brands` both contribute to `directory`. Only the `category` and `sub`
  query parameters affect classification; `page`, `sort`, `q`, UTM parameters, and other
  non-indexable parameters do not.
- **l1Pages** and **l2Pages** map each **canonical page** to its summed impressions — not the
  raw URL. The canonical page strips the locale prefix, normalizes the trailing slash, and
  retains only the indexable parameters in a fixed order (`?category=<value>`, then
  `&sub=<value>`). `/brands?category=bags`, `/en/brands?category=bags` and
  `/brands?category=bags&page=2` are therefore one entry, `/brands?category=bags`, rather than
  three. `landingPages` above continues to list raw URLs exactly as Search Console reports
  them.

The landing-page types are the keyword map's page types plus the two reporting-only types:

- `homepage`
- `directory`
- `l1-category`
- `l2-category`
- `topic-hub`
- `story`
- `glossary`
- `stats`
- `brand-detail`
- `event`
- `other/static`

## Review cadence

The baseline date is **2026-08-06**.

- **Weekly:** check indexing anomalies, traffic changes, new queries, and technical errors.
- **Every 28 days:** review query clusters and landing pages, then refresh the optimization
  queue. The first 28-day review is **2026-09-03**.
- **Every 90 days:** revise the keyword map, rollout plan, and content roadmap. The first
  90-day review is **2026-11-04**.

## PostHog reconciliation caveat

GSC clicks and PostHog organic sessions are expected to differ. GSC counts clicks from a
search-engine-results page, while PostHog counts pageviews that survived the visit and reached
the instrumented page. Consent gating means PostHog only fires post-consent, so some visits are
absent from its data.

**Window timezone basis.** The exported windows (28d, 90d, and their previous periods) are
anchored on the **Asia/Taipei** calendar day, matching `src/lib/date-range.ts` and the PostHog
project timezone, and end `SEARCH_CONSOLE_DATA_LAG_DAYS` (3) days before it. Search Console
itself buckets each day in the **property's own timezone** (Pacific for most properties), so
the two systems can still disagree at the edges of a window by up to one day; the export does
not attempt to reconcile that residual offset. A GSC click on a URL that redirects can land in PostHog on a different path.
Finally, GSC is a per-click measure, while PostHog sessions use a 30-minute inactivity window
and can combine multiple pageviews.

The join is **LANDING-PAGE LEVEL ONLY**. There is no user-level or session-level join because
the two systems have no shared identifier.

## Dependency gap

Downstream-action metrics—organic landing to official purchase-link click, save brand, and
newsletter signup—depend on the DEV-1297/1298 instrumentation. If those events are absent,
record the instrumentation gap here rather than blocking the Search Console scorecard or its
review cadence.

## Recommended-action vocabulary

The recommended-action field is a fixed, closed list. Use only:

`rewrite title/description` · `improve visible answer` · `add internal links` · `create dedicated landing page` · `consolidate competing pages` · `improve brand data` · `observe — insufficient data`
