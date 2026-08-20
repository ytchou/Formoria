# MDX contract — what a story file may contain

The publishing surface has almost no validation: `parseStoryFile`
(`src/lib/services/stories.ts`) defaults every frontmatter field, so a malformed
story renders degraded rather than failing. That makes this file the contract.
`scripts/checks/story-frontmatter.mjs` enforces the parts that can be checked
mechanically; the rest is here because nothing else will catch it.

## Frontmatter

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Drives `<h1>`, `<title>`, and Article JSON-LD. The body must NOT repeat it as an `# h1` |
| `description` | yes | Meta description, `og:description`, JSON-LD |
| `slug` | yes | **Must equal the whole filename stem, date prefix included.** See below — this is the field that has already broken in production |
| `locale` | yes | `zh-TW` or `en`. Anything else makes the story invisible to every list query |
| `publishedAt` | yes | `YYYY-MM-DD`. Missing sinks it to the end of the sort and drops `datePublished` from JSON-LD |
| `updatedAt` | no | Drives `dateModified` and sitemap `lastmod` |
| `draft` | yes | **Write `true`.** A human flips it after reading the draft — that flag, not a mid-run approval stop, is what keeps an unreviewed draft off the site |
| `tags` | yes | Closed vocabulary, see below. An unknown tag **fails CI** |
| `heroImage` | yes | `/images/stories/<slug>.webp`. A remote URL needs its host in `ALLOWED_IMAGE_HOSTS` or CSP blocks it. Doubles as `og:image` |
| `heroImageAlt` | yes | Absent renders `alt=""`. Describe the image, do not echo the title |
| `sources` | yes | Absolute URLs, one per first-party source. Parsed but not rendered — surface attribution to readers in a `<Disclaimer>` too |
| `faq` | yes, 4–6 | **The only source of FAQPage JSON-LD.** See the trap below |
| `series`, `seriesTitle`, `seriesOrder` | if part of a series | Groups the story on the hub and enables the series nav |
| `author` | no | Falls back to the i18n byline |
| `voiceCanonical` | yes | **Write `false`.** A human sets it true once the voice is approved; `/formoria-voice-refresh` only quotes exemplars from canonical stories, so a self-declared `true` would let a draft teach the next draft its own mistakes |

### The slug trap

The route param resolves against the **filename** — `getPublishedStoryBySlug`
reads `content/stories/<param>.mdx`. The canonical URL, the sitemap entry, and
the Article JSON-LD are all built from **`frontmatter.slug`**. Nothing reconciles
them.

Both published stories shipped with the date stripped out of `slug`. The result:
the live page at `/stories/2026-08-06-…` returned 200 and declared a canonical of
`/stories/2026-…`, which 404s — and the sitemap submitted that same 404. Every
indexing signal pointed at a URL that does not exist, so neither story could be
indexed. Nothing failed, nothing logged, and Lighthouse scored it fine.

Write `slug` as the entire filename stem. A self-referencing canonical is the
only safe state.

### The FaqBlock trap

`frontmatter.faq` renders the FAQ **and** emits FAQPage JSON-LD. An in-body
`<FaqBlock questions={[…]} />` is hard-wired `emitJsonLd: false`, so it renders
the same accordion and emits nothing — a second entity on one URL would be
invalid.

Put the FAQ in **frontmatter**. Reaching for the shortcode looks equivalent and
silently costs the rich result, which is most of why the FAQ is worth writing.

### `tags` — closed vocabulary

Twelve L1 category slugs, derived from `L1_CATEGORIES`
(`src/lib/taxonomy/ontology.ts`):

`fashion` `bags-accessories` `jewelry` `beauty` `home` `food-drink`
`stationery` `tech` `outdoor` `fitness` `kids` `pets`

Plus two editorial tags (`STORY_EDITORIAL_TAGS`): `event` `creative-expo`

Tag what the story is *about* (L1 categories) and what it *is* (editorial). Never
invent a slug — `src/lib/taxonomy/__tests__/story-tags.test.ts` reads the real
files off disk and fails CI on any tag outside this list.

## Shortcodes

The complete set (`createStoryComponentMap`, `src/lib/mdx/components.ts`).
Anything else renders as literal text.

| Shortcode | Props | Renders |
|---|---|---|
| `BrandCard` | `slug`, `note?`, `eyebrow?` | One brand card with a save button |
| `BrandRow` | children | 3-up row; children are `<BrandCard>` |
| `BrandList` | children | Hairline-ruled compact list; children are `<BrandLine>` |
| `BrandLine` | `slug`, `booth?`, `note?` | One list row |
| `BrandGrid` | `slugs`, `notes?` | Multi-brand grid; the one shortcode taking an array |
| `BrandGallery` | `slug`, `caption?` | Photo strip. **No click path** — excluded from the GA4 impression count on purpose |
| `EventInfo` | `slug` | DB-sourced event block. Also suppresses the bottom `SeriesNav` |
| `Figure` | `src`, `alt`, `caption?` | Credited photo. Literal `<figure>` JSX does **not** resolve |
| `PullQuote` | children, `attribution?` | Restates the article's own argument |
| `StatsCallout` | `stat`, `label` | Big-number callout |
| `Disclaimer` | children | Muted aside — sponsorship, caveats, image rights |
| `FaqBlock` | `questions` | In-body FAQ, visual only. Prefer frontmatter `faq` |

### Prop syntax

Expression attributes (`prop={…}`) are unreliable for most shortcodes (DEV-1302),
which is why `BrandRow`/`BrandList` take children and `BrandLine` is all-string.
**Use plain string props everywhere** except `BrandGrid`'s `slugs`/`notes`, which
have no string form.

### Brand references

Both forms must name a brand that actually exists:

- **Shortcodes** resolve through `getBrandsBySlugs` and degrade to a visible
  placeholder when a slug is dead.
- **Prose links** — `[名字](/brands/<slug>)` — have no runtime fallback. A typo is
  a plain `<a>` that 404s in production with nothing logged.

`extractProseBrandSlugs` exists so CI checks both. Verify every slug against the
fact sheet before writing it; a dashed placeholder in the rendered page is a
failure, not an acceptable fallback.

### Category naming

Two vocabularies that must not be mixed:

- **Headings** may use an editorial gloss — 個人風格, 紙品文具.
- **Link text** uses the canonical label from `categoryLabelZh()` — 服飾鞋履,
  文具設計, 居家生活, 美妝保養, 包袋配件. A reader clicking
  「瀏覽本站全部居家生活品牌」 must land on a page whose heading says the same words.
- **Craft coverage has no L1 any more.** 工藝文創 was retired; a story about
  makers and materials links to the material facet instead —
  `/brands?material=ceramic,wood,metal,bamboo,glass,textile` — and its link text
  names the materials, never a category.

## Hero image

Lives under `public/images/stories/`, 16:9, rendered `priority` as the LCP
element. The filename is not derived from anything — `heroImage` carries the full
path — so name it after the story and keep it stable once published. A missing
file does not break the build (it 404s at request time), which is why the
frontmatter gate checks it exists on disk.

This skill does not generate hero images. Write the expected path and report the
missing file as a hand-off item, the same as a `[待確認]` marker.
