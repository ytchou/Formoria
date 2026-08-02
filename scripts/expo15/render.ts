/**
 * Renders the expo-15 production before/after from two snapshots.
 *
 * Both sides are real `brands` rows, so unlike the submission-based benchmark
 * there is no `enriched_data` indirection — every value on both sides is read
 * straight off the column the site renders from.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/expo15/render.ts
 */
import { readFile, writeFile } from 'node:fs/promises'
import { EXPO15_SLUGS, EXPO15_LABELS } from './brands'

type Img = Record<string, unknown> & {
  url: string
  brand_id: string
  source: string | null
  provider_metadata: Record<string, unknown> | null
  source_url: string | null
  status: string | null
  score: number | null
  tags: string[] | null
  width: number | null
  height: number | null
  sort_order: number | null
  alt_zh: string | null
  rejection_reasons: string[] | null
}
type Brand = Record<string, unknown> & { id: string; slug: string; name: string }
type Snapshot = { capturedAt: string; brands: Brand[]; children: Record<string, Img[]> }

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const hostOf = (u: string | null | undefined): string => {
  if (!u) return '—'
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return '?'
  }
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return value.map((v) => String(v)).join('、')
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.text === 'string') return record.text
    return JSON.stringify(value)
  }
  return String(value)
}

const LINK_FIELDS = [
  'purchase_website',
  'social_instagram',
  'social_threads',
  'social_facebook',
  'purchase_pinkoi',
  'purchase_shopee',
] as const

const IDENTITY_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['name', 'Name'],
  ['slug', 'Slug'],
  ['product_type', 'Category'],
  ['product_tags', 'Product tags'],
  ['city', 'City'],
  ['founding_year', 'Founded'],
  ['price_range', 'Price range'],
]

const CONTENT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ['blurb', 'Blurb (zh)'],
  ['blurb_en', 'Blurb (en)'],
  ['description', 'Description (zh)'],
  ['description_en', 'Description (en)'],
  ['reputation_summary', 'Reputation'],
]

function cmpRow(label: string, before: unknown, after: unknown): string {
  const b = show(before)
  const a = show(after)
  const cls = b === a ? 'same' : !b && a ? 'gained' : b && !a ? 'lost' : 'changed'
  return `<tr>
    <th>${esc(label)}</th>
    <td class="same">${b ? esc(b) : '<span class="muted">—</span>'}</td>
    <td class="${cls}">${a ? esc(a) : '<span class="muted">—</span>'}</td>
  </tr>`
}

function tile(i: Img, published: boolean): string {
  const meta = (i.provider_metadata ?? {}) as Record<string, unknown>
  const method = (meta.method as string) ?? i.source ?? '?'
  const label =
    i.status === 'rejected'
      ? `reject: ${(i.rejection_reasons ?? []).join(', ') || '—'}`
      : i.score === null && i.status === 'candidate'
        ? 'never classified'
        : ''
  return `<figure class="tile${published ? '' : ' dropped'}">
    ${published ? `<span class="rank">${i.sort_order === 0 ? 'hero' : i.sort_order}</span>` : ''}
    <img src="${esc(i.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">
    <figcaption>
      <div class="l"><span>${esc(hostOf(i.source_url ?? i.url))}</span><span class="d">${i.width || '?'}×${i.height || '?'}</span></div>
      <div class="l"><span class="m">${esc(String(method))}</span><span class="s">${i.score ?? '—'}</span></div>
      ${(i.tags ?? []).map((t) => `<b>${esc(t)}</b>`).join('')}
      ${label ? `<div class="bad">${esc(label)}</div>` : ''}
      ${i.alt_zh ? `<div class="alt">${esc(i.alt_zh)}</div>` : ''}
    </figcaption>
  </figure>`
}

const byBrand = (imgs: Img[]): Map<string, Img[]> => {
  const map = new Map<string, Img[]>()
  for (const i of imgs) {
    const list = map.get(i.brand_id) ?? []
    list.push(i)
    map.set(i.brand_id, list)
  }
  return map
}

const sortImgs = (imgs: Img[]): Img[] =>
  imgs.slice().sort((l, r) => (l.sort_order ?? 99) - (r.sort_order ?? 99))

async function main(): Promise<void> {
  const before = JSON.parse(
    await readFile('scripts/expo15/snapshots/before.json', 'utf8')
  ) as Snapshot
  const afterIndex = process.argv.indexOf('--after')
  const afterFile = afterIndex === -1
    ? 'scripts/expo15/snapshots/after.json'
    : `scripts/expo15/snapshots/${process.argv.at(afterIndex + 1)}`
  const after = JSON.parse(await readFile(afterFile, 'utf8')) as Snapshot

  const bBrand = new Map(before.brands.map((b) => [b.slug, b]))
  const aBrandById = new Map(after.brands.map((b) => [b.id, b]))
  const bImgs = byBrand(before.children.brand_images ?? [])
  const aImgs = byBrand(after.children.brand_images ?? [])

  // Pair on brand ID, not slug: the slug is one of the fields under comparison,
  // and pairing on a field that can change would silently drop any brand whose
  // slug moved — exactly the case most worth seeing.
  const pairs = EXPO15_SLUGS.flatMap((slug) => {
    const b = bBrand.get(slug)
    if (!b) return []
    const a = aBrandById.get(b.id)
    return a ? [{ slug, before: b, after: a }] : []
  })

  const totalBefore = pairs.reduce(
    (n, p) => n + (bImgs.get(p.before.id) ?? []).filter((i) => i.status === 'active').length,
    0
  )
  const totalAfter = pairs.reduce(
    (n, p) => n + (aImgs.get(p.after.id) ?? []).filter((i) => i.status === 'active').length,
    0
  )

  const summary = pairs
    .map(({ slug, before: b, after: a }) => {
      const nb = (bImgs.get(b.id) ?? []).filter((i) => i.status === 'active').length
      const na = (aImgs.get(a.id) ?? []).filter((i) => i.status === 'active').length
      const total = (aImgs.get(a.id) ?? []).length
      const delta = na - nb
      const cls = na === 0 ? 'bad' : delta > 0 ? 'good' : delta < 0 ? 'warn' : ''
      const catChanged = show(b.product_type) !== show(a.product_type)
      return `<tr>
      <td><a href="#${esc(slug)}"><b>${esc(EXPO15_LABELS[slug] ?? String(b.name))}</b></a></td>
      <td${catChanged ? ' class="changed"' : ''}>${esc(show(b.product_type) || '—')} → <b>${esc(show(a.product_type) || '—')}</b></td>
      <td class="num">${nb}</td>
      <td class="num">${total}</td>
      <td class="num ${cls}">${na}</td>
      <td class="num ${cls}">${delta > 0 ? `+${delta}` : delta}</td>
    </tr>`
    })
    .join('')

  const sections = pairs
    .map(({ slug, before: b, after: a }) => {
      const beforeImgs = sortImgs((bImgs.get(b.id) ?? []).filter((i) => i.status === 'active'))
      const afterAll = sortImgs(aImgs.get(a.id) ?? [])
      const afterPub = afterAll.filter((i) => i.status === 'active')
      const afterRest = afterAll.filter((i) => i.status !== 'active')

      return `<section class="brand" id="${esc(slug)}">
  <h2>${esc(EXPO15_LABELS[slug] ?? String(a.name))} <span class="slug">${esc(slug)}</span>
    <a class="live" href="https://formoria.com/brands/${esc(String(a.slug))}" target="_blank" rel="noreferrer">view live ↗</a></h2>

  <h3>Identity &amp; category</h3>
  <div class="scroll"><table class="cmp"><thead><tr><th>Field</th><th>Before — was live</th><th>After — now live</th></tr></thead><tbody>
    ${IDENTITY_FIELDS.map(([f, label]) => cmpRow(label, b[f], a[f])).join('')}
  </tbody></table></div>

  <h3>Links</h3>
  <div class="scroll"><table class="cmp"><thead><tr><th>Field</th><th>Before — was live</th><th>After — now live</th></tr></thead><tbody>
    ${LINK_FIELDS.map((f) => cmpRow(f, b[f], a[f])).join('')}
  </tbody></table></div>

  <h3>Generated content</h3>
  <div class="scroll"><table class="cmp"><thead><tr><th>Field</th><th>Before — was live</th><th>After — now live</th></tr></thead><tbody>
    ${CONTENT_FIELDS.map(([f, label]) => cmpRow(label, b[f], a[f])).join('')}
  </tbody></table></div>

  <h3>Images <span class="meta">${beforeImgs.length} published → ${afterPub.length} published, from ${afterAll.length} candidates</span></h3>
  <div class="lbl">Before — what was published</div>
  <div class="grid">${beforeImgs.map((i) => tile(i, true)).join('') || '<p class="muted">None.</p>'}</div>
  <div class="lbl">After — what is published now</div>
  <div class="grid">${afterPub.map((i) => tile(i, true)).join('') || '<p class="muted">None.</p>'}</div>
  ${afterRest.length ? `<details><summary>${afterRest.length} candidate(s) not published — rejected or unclassified</summary><div class="grid">${afterRest.map((i) => tile(i, false)).join('')}</div></details>` : ''}
</section>`
    })
    .join('')

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Formoria — Expo 15 production refresh, before / after</title>
<style>
:root{--bg:#faf8f5;--surface:#fff;--ink:#1c1a17;--muted:#6b6560;--line:#e5dfd7;--accent:#8a5a2b;--good:#2f6b4f;--warn:#8a6d2b;--bad:#a33a2a;--radius:10px}
@media(prefers-color-scheme:dark){:root{--bg:#16150f;--surface:#201e18;--ink:#f0ebe3;--muted:#a29a90;--line:#35322a;--accent:#d9a066;--good:#6fb894;--warn:#d0aa5e;--bad:#e08472}}
:root[data-theme="dark"]{--bg:#16150f;--surface:#201e18;--ink:#f0ebe3;--muted:#a29a90;--line:#35322a;--accent:#d9a066;--good:#6fb894;--warn:#d0aa5e;--bad:#e08472}
:root[data-theme="light"]{--bg:#faf8f5;--surface:#fff;--ink:#1c1a17;--muted:#6b6560;--line:#e5dfd7;--accent:#8a5a2b;--good:#2f6b4f;--warn:#8a6d2b;--bad:#a33a2a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,-apple-system,"Helvetica Neue","PingFang TC",sans-serif}
.wrap{max-width:1280px;margin:0 auto;padding:0 24px 90px}
header{border-bottom:1px solid var(--line);padding:40px 0 20px;margin-bottom:20px}
h1{margin:0 0 8px;font-size:30px;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0;max-width:74ch}
nav{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0;margin-bottom:24px;z-index:5;display:flex;gap:14px;flex-wrap:wrap;font-size:13px}
nav a{color:var(--muted);text-decoration:none}nav a:hover{color:var(--accent)}
h2{font-size:22px;margin:0 0 14px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:26px 0 8px}
.slug{font-size:13px;color:var(--muted);font-weight:400}
.live{font-size:12px;font-weight:400;color:var(--accent);text-decoration:none}
.meta{font-size:12px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400}
.lbl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:12px 0 6px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:720px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top;font-size:13px}
td{width:42%;word-break:break-word}
thead th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
table.cmp th:first-child{width:16%;color:var(--muted);font-weight:500}
td.same{color:var(--muted)}
td.changed{background:color-mix(in oklab,var(--accent) 13%,transparent)}
td.gained{background:color-mix(in oklab,var(--good) 15%,transparent)}
td.lost{background:color-mix(in oklab,var(--bad) 13%,transparent)}
td.num{text-align:right;font-variant-numeric:tabular-nums;width:auto}
.good{color:var(--good);font-weight:700}.warn{color:var(--warn);font-weight:700}.bad{color:var(--bad);font-weight:700}
.muted{color:var(--muted)}
.brand{padding-top:30px;border-top:1px solid var(--line);margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(152px,1fr));gap:10px;margin-bottom:6px}
.tile{position:relative;margin:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.tile img{display:block;width:100%;height:142px;object-fit:cover;background:var(--line)}
.tile figcaption{padding:6px 8px;font-size:10px;color:var(--muted)}
.tile .l{display:flex;justify-content:space-between;gap:6px}
.tile .l span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile .d,.tile .s{font-variant-numeric:tabular-nums;flex-shrink:0}
.tile .s{color:var(--ink);font-weight:700}
.tile .m{color:var(--accent)}
.tile b{display:inline-block;font-size:9px;background:var(--line);border-radius:99px;padding:0 6px;margin:3px 3px 0 0}
.tile .bad{margin-top:3px}
.tile .alt{margin-top:4px;line-height:1.4}
.tile.dropped{opacity:.5;border-color:var(--bad)}
.rank{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.66);color:#fff;font-size:9px;padding:1px 7px;border-radius:99px}
details{margin-top:8px}summary{cursor:pointer;font-size:13px;color:var(--muted)}
.callout{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:var(--radius);padding:16px 20px;margin-bottom:22px;font-size:14px}
.callout.warn{border-left-color:var(--warn)}
.key{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:22px}
.key span{display:flex;align-items:center;gap:6px}
.sw{width:14px;height:14px;border-radius:3px;display:inline-block}
.hl{display:flex;gap:28px;flex-wrap:wrap;margin:0 0 22px}
.hl div{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:12px 18px}
.hl b{display:block;font-size:26px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.hl span{font-size:12px;color:var(--muted)}
</style></head><body><div class="wrap">
<header>
<h1>Expo 15 — production refresh, before / after</h1>
<p class="sub">The 15 brands from the 2026 Taiwan Creative Expo editorial shortlist. <b>Before</b> is production as captured ${esc(before.capturedAt.replace('T', ' ').slice(0, 16))} UTC, immediately prior to the refresh. <b>After</b> is production as it stands now, captured ${esc(after.capturedAt.replace('T', ' ').slice(0, 16))} UTC. Both columns are live <code>brands</code> rows — this change is already applied.</p>
</header>
<nav><a href="#summary">Summary</a>${pairs.map((p) => `<a href="#${esc(p.slug)}">${esc((EXPO15_LABELS[p.slug] ?? String(p.before.name)).split(' ')[0])}</a>`).join('')}</nav>

<div class="hl">
  <div><b>${pairs.length}</b><span>brands refreshed</span></div>
  <div><b>${totalBefore} → ${totalAfter}</b><span>published images</span></div>
  <div><b>${pairs.filter((p) => show(p.before.product_type) !== show(p.after.product_type)).length}</b><span>category changes</span></div>
  <div><b>${pairs.filter((p) => p.before.slug !== p.after.slug).length}</b><span>slug changes</span></div>
</div>

<div class="callout">
<b>This ran the real pipeline against production.</b> Each brand was snapshotted into a refresh submission via <code>request_brand_refresh</code>, enriched by a genuine curation job (<code>enqueueAdminCurationJob</code> → <code>runJob</code> → <code>runEnrich</code>, steps <b>context, image, detail</b>), then written back with <code>apply_brand_refresh</code> — the same three RPCs the admin UI uses. Nothing here was hand-written into the database.
</div>

<div class="callout warn">
<b>Slugs were protected.</b> Three brands carry mangled slugs from the DEV-1301 defect — <code>y</code> for 郁郁 YùYù, <code>ng</code> for 雱 PĀNG, <code>610-asteroid-b</code> for 小行星 B-610. The refresh flow classifies <code>slug</code> as an identity field and refused every write to it, so no live URL changed and no inbound link broke. Fixing those slugs remains DEV-1301's job, and needs redirects.
</div>

<div class="key">
  <span><i class="sw" style="background:color-mix(in oklab,var(--good) 40%,transparent)"></i> newly filled</span>
  <span><i class="sw" style="background:color-mix(in oklab,var(--accent) 40%,transparent)"></i> changed</span>
  <span><i class="sw" style="background:color-mix(in oklab,var(--bad) 40%,transparent)"></i> lost</span>
  <span>unhighlighted = unchanged</span>
</div>

<h2 id="summary">Summary</h2>
<div class="scroll"><table>
<thead><tr><th>Brand</th><th>Category before → after</th><th class="num">Published before</th><th class="num">Candidates</th><th class="num">Published now</th><th class="num">Δ</th></tr></thead>
<tbody>${summary}</tbody>
</table></div>

${sections}
</div></body></html>`

  await writeFile('scripts/expo15/snapshots/before-after.html', html)
  console.log('wrote scripts/expo15/snapshots/before-after.html')
  console.log(`  ${pairs.length} brands, images ${totalBefore} -> ${totalAfter}`)
}

void main()

export {}
