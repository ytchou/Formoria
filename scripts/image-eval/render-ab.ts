/**
 * Renders the full before/after: live production brands (tracker.json) against
 * the output of a real `runEnrich` run over scratch submissions
 * (worker-after.json, produced by bench-worker.ts).
 *
 * For submissions the pipeline stages its proposals in `enriched_data` rather
 * than writing the flat columns, so the "after" value for a field is the
 * enriched value when present, falling back to the submission column.
 */
import { readFile, writeFile } from 'node:fs/promises'

type Img = {
  url: string
  source: string
  provider_metadata: Record<string, unknown> | null
  source_url: string | null
  status?: string
  score: number | null
  tags: string[] | null
  width?: number | null
  height?: number | null
  w?: number | null
  h?: number | null
  sort_order: number | null
  alt_zh: string | null
  rejection_reasons?: string[] | null
  method?: string | null
}
type BeforeBrand = Record<string, unknown> & { slug: string; name: string; images: Img[] | null }
type WorkerBrand = {
  slug: string
  liveName: string
  submission: Record<string, unknown> | null
  images: Img[]
}

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
  ['category', 'Category'],
  ['subcategories', 'Product subcategories'],
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

/** After-value for a field: the staged proposal wins, then the submission column. */
/**
 * Brand columns whose name differs on `brand_submissions`. Without this the
 * `name` row read `sub['name']`, which does not exist on a submission — so
 * every brand the pipeline left correctly unrenamed (no `enriched_data.name`
 * patch, because nothing changed) rendered as a LOST name. Four of six brands
 * looked like the run had wiped their names when it had not touched them.
 */
const SUBMISSION_COLUMN_ALIASES: Record<string, string> = {
  name: 'brand_name',
}

function afterValue(w: WorkerBrand, field: string): unknown {
  const enriched = (w.submission?.enriched_data ?? {}) as Record<string, unknown>
  if (enriched[field] !== null && enriched[field] !== undefined) return enriched[field]
  const sub = (w.submission ?? {}) as Record<string, unknown>
  return sub[field] ?? sub[SUBMISSION_COLUMN_ALIASES[field] ?? field] ?? null
}

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
  const w = i.width ?? i.w ?? 0
  const h = i.height ?? i.h ?? 0
  const meta = (i.provider_metadata ?? {}) as Record<string, unknown>
  const method = (meta.method as string) ?? i.method ?? i.source
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
      <div class="l"><span>${esc(hostOf(i.source_url ?? i.url))}</span><span class="d">${w || '?'}×${h || '?'}</span></div>
      <div class="l"><span class="m">${esc(String(method))}</span><span class="s">${i.score ?? '—'}</span></div>
      ${(i.tags ?? []).map((t) => `<b>${esc(t)}</b>`).join('')}
      ${label ? `<div class="bad">${esc(label)}</div>` : ''}
      ${i.alt_zh ? `<div class="alt">${esc(i.alt_zh)}</div>` : ''}
    </figcaption>
  </figure>`
}

async function main(): Promise<void> {
  const beforeFile = JSON.parse(
    await readFile('scripts/image-eval/runs/_track/tracker.json', 'utf8')
  ) as { capturedAt: string; rows: BeforeBrand[] }
  const worker = JSON.parse(
    await readFile('scripts/image-eval/runs/_track/worker-after.json', 'utf8')
  ) as { ranAt: string; steps: string[]; brands: WorkerBrand[] }

  const pairs = beforeFile.rows
    .map((b) => ({ before: b, after: worker.brands.find((w) => w.slug === b.slug) }))
    .filter((p): p is { before: BeforeBrand; after: WorkerBrand } => Boolean(p.after))

  const summary = pairs
    .map(({ before: b, after: w }) => {
      const now = (b.images ?? []).length
      const pub = w.images.filter((i) => i.status === 'active').length
      const delta = pub - now
      const cls = pub === 0 ? 'bad' : delta > 0 ? 'good' : delta < 0 ? 'warn' : ''
      return `<tr>
      <td><a href="#${esc(b.slug)}"><b>${esc(b.name)}</b></a></td>
      <td>${esc(show(b.category) || '—')} → <b>${esc(show(afterValue(w, 'category')) || '—')}</b></td>
      <td class="num">${now}</td>
      <td class="num">${w.images.length}</td>
      <td class="num ${cls}">${pub}</td>
      <td class="num ${cls}">${delta > 0 ? `+${delta}` : delta}</td>
    </tr>`
    })
    .join('')

  const sections = pairs
    .map(({ before: b, after: w }) => {
      const bImgs = (b.images ?? []).slice().sort((l, r) => (l.sort_order ?? 99) - (r.sort_order ?? 99))
      const aAll = w.images.slice().sort((l, r) => (l.sort_order ?? 99) - (r.sort_order ?? 99))
      const aPub = aAll.filter((i) => i.status === 'active')
      const aRest = aAll.filter((i) => i.status !== 'active')

      return `<section class="brand" id="${esc(b.slug)}">
  <h2>${esc(b.name)} <span class="slug">${esc(b.slug)}</span></h2>

  <h3>Identity &amp; category</h3>
  <div class="scroll"><table class="cmp"><thead><tr><th>Field</th><th>Before — live</th><th>After — this branch</th></tr></thead><tbody>
    ${IDENTITY_FIELDS.map(([f, label]) => cmpRow(label, b[f], afterValue(w, f))).join('')}
  </tbody></table></div>

  <h3>Links</h3>
  <div class="scroll"><table class="cmp"><thead><tr><th>Field</th><th>Before — live</th><th>After — this branch</th></tr></thead><tbody>
    ${LINK_FIELDS.map((f) => cmpRow(f, b[f], afterValue(w, f))).join('')}
  </tbody></table></div>

  <h3>Generated content</h3>
  <div class="scroll"><table class="cmp"><thead><tr><th>Field</th><th>Before — live</th><th>After — this branch</th></tr></thead><tbody>
    ${CONTENT_FIELDS.map(([f, label]) => cmpRow(label, b[f], afterValue(w, f))).join('')}
  </tbody></table></div>

  <h3>Images <span class="meta">${bImgs.length} live → ${aPub.length} would publish, from ${aAll.length} candidates</span></h3>
  <div class="lbl">Before — currently published</div>
  <div class="grid">${bImgs.map((i) => tile(i, true)).join('') || '<p class="muted">None.</p>'}</div>
  <div class="lbl">After — would publish</div>
  <div class="grid">${aPub.map((i) => tile(i, true)).join('') || '<p class="muted">Nothing survives.</p>'}</div>
  ${aRest.length ? `<details><summary>${aRest.length} candidate(s) not published — rejected or unclassified</summary><div class="grid">${aRest.map((i) => tile(i, false)).join('')}</div></details>` : ''}
</section>`
    })
    .join('')

  const ranAt = worker.ranAt.replace('T', ' ').slice(0, 16)
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Formoria — Curation pipeline, full before / after</title>
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
nav{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0;margin-bottom:24px;z-index:5;display:flex;gap:16px;flex-wrap:wrap;font-size:13px}
nav a{color:var(--muted);text-decoration:none}nav a:hover{color:var(--accent)}
h2{font-size:22px;margin:0 0 14px}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:26px 0 8px}
.slug{font-size:13px;color:var(--muted);font-weight:400}
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
.key{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-bottom:22px}
.key span{display:flex;align-items:center;gap:6px}
.sw{width:14px;height:14px;border-radius:3px;display:inline-block}
</style></head><body><div class="wrap">
<header>
<h1>Curation pipeline — full before / after</h1>
<p class="sub"><b>Before</b> is live production data, captured ${esc(beforeFile.capturedAt)} UTC. <b>After</b> is the real worker — <code>runEnrich</code> with steps <b>${esc(worker.steps.join(', '))}</b> — run at ${esc(ranAt)} UTC against temporary submission rows built from the same brands. Live brands and their images were never touched; the scratch rows were deleted and the deletion verified.</p>
</header>
<nav><a href="#summary">Summary</a>${pairs.map((p) => `<a href="#${esc(p.before.slug)}">${esc(p.before.name.split(' ')[0])}</a>`).join('')}</nav>

<div class="callout">
<b>This is the production entry point, not a reimplementation.</b> <code>runEnrich</code> is the same function the Railway worker and the admin UI call. The only difference from a live run is the target: scratch <code>brand_submissions</code> rows rather than the brands themselves, so the baseline survives to compare against. For submissions the pipeline stages its proposals in <code>enriched_data</code> instead of writing columns directly, which is what the After column reads.
</div>

<div class="key">
  <span><i class="sw" style="background:color-mix(in oklab,var(--good) 40%,transparent)"></i> newly filled</span>
  <span><i class="sw" style="background:color-mix(in oklab,var(--accent) 40%,transparent)"></i> changed</span>
  <span><i class="sw" style="background:color-mix(in oklab,var(--bad) 40%,transparent)"></i> lost</span>
  <span>unhighlighted = unchanged</span>
</div>

<h2 id="summary">Summary</h2>
<div class="scroll"><table>
<thead><tr><th>Brand</th><th>Category before → after</th><th class="num">Live images</th><th class="num">Candidates</th><th class="num">Would publish</th><th class="num">Δ</th></tr></thead>
<tbody>${summary}</tbody>
</table></div>

${sections}
</div></body></html>`

  await writeFile('scripts/image-eval/runs/_track/before-after.html', html)
  console.log('wrote scripts/image-eval/runs/_track/before-after.html')
  for (const { before: b, after: w } of pairs) {
    console.log(
      `  ${b.slug.padEnd(22)} images ${String((b.images ?? []).length).padStart(2)} -> ${String(w.images.filter((i) => i.status === 'active').length).padStart(2)}   category ${show(b.category) || '—'} -> ${show(afterValue(w, 'category')) || '—'}`
    )
  }
}

void main()

export {}
