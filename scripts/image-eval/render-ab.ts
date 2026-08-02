/**
 * Renders the before/after comparison: live production data (tracker.json)
 * against the output of the REAL worker run (worker-after.json), produced by
 * bench-worker.ts running `runEnrich` over scratch submissions.
 */
import { readFile, writeFile } from 'node:fs/promises'

type BeforeImage = {
  url: string
  source: string
  method: string | null
  source_url: string | null
  score: number | null
  tags: string[] | null
  w: number | null
  h: number | null
  sort_order: number | null
  alt_zh: string | null
}
type BeforeBrand = {
  slug: string
  name: string
  product_type: string | null
  purchase_website: string | null
  social_instagram: string | null
  social_threads: string | null
  social_facebook: string | null
  purchase_pinkoi: string | null
  purchase_shopee: string | null
  images: BeforeImage[] | null
  rejected_count: number
  total_images: number
}
type WorkerImage = {
  url: string
  source: string
  provider_metadata: Record<string, unknown> | null
  source_url: string | null
  status: string
  score: number | null
  tags: string[] | null
  width: number | null
  height: number | null
  sort_order: number | null
  alt_zh: string | null
  rejection_reasons: string[] | null
}
type WorkerBrand = {
  slug: string
  liveName: string
  submission: Record<string, string | null> | null
  images: WorkerImage[]
}
type AfterImage = {
  url: string
  host: string
  source: string
  method: string
  w: number
  h: number
  gate: string
  disposition?: string
  tag?: string | null
  score?: number
  reasons?: string[]
  altZh?: string
  rank?: number
  published?: boolean
}
type AfterBrand = {
  slug: string
  name: string
  nameAfter: string
  productType: string | null
  categoryZh: string | null
  linksBefore: Record<string, string | null>
  linksAfter: Record<string, string | null>
  routingBranch: string
  imageQuery: string
  scrapedUrls: string[]
  candidateCount: number
  bySource: Record<string, number>
  images: AfterImage[]
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const hostOf = (u: string | null): string => {
  if (!u) return '—'
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return '?'
  }
}

const LINK_FIELDS = [
  'purchase_website',
  'social_instagram',
  'social_threads',
  'social_facebook',
  'purchase_pinkoi',
  'purchase_shopee',
] as const

function beforeBranch(b: BeforeBrand): string {
  if (b.purchase_website && b.social_instagram) return 'Website + Instagram'
  if (b.purchase_website) return 'Website only'
  if (b.social_instagram) return 'Instagram only'
  return 'Neither'
}

/** The query the OLD pipeline would have issued: always name + category + 商品. */
function beforeQuery(b: BeforeBrand, categoryZh: string | null): string {
  return `"${b.name}"${categoryZh ? ` ${categoryZh}` : ''} 商品`
}

function beforeFlags(b: BeforeBrand): string[] {
  const flags: string[] = []
  const imgs = b.images ?? []
  if (b.purchase_website && /(instagram|facebook|threads|linktr|bio\.site|shopee|pinkoi)/i.test(b.purchase_website)) {
    flags.push(`purchase_website is a platform root (${hostOf(b.purchase_website)})`)
  }
  const unjudged = imgs.filter((i) => i.score === null || i.tags === null)
  if (unjudged.length) flags.push(`${unjudged.length} active image(s) never classified`)
  const small = imgs.filter((i) => i.w && i.h && Math.min(i.w, i.h) < 480)
  if (small.length) flags.push(`${small.length} of ${imgs.length} under the 480px gate`)
  const legacy = imgs.filter((i) => (i.tags ?? []).some((t) => t !== 'product' && t !== 'logo'))
  if (legacy.length) {
    const names = [...new Set(legacy.flatMap((i) => (i.tags ?? []).filter((t) => t !== 'product' && t !== 'logo')))]
    flags.push(`${legacy.length} carry legacy tags (${names.join(', ')})`)
  }
  if (imgs.length < 5) flags.push(`only ${imgs.length} active image(s) against 10 slots`)
  return flags
}

function afterFlags(a: AfterBrand): string[] {
  const flags: string[] = []
  const published = a.images.filter((i) => i.published)
  const gateCounts: Record<string, number> = {}
  for (const i of a.images) if (i.gate !== 'kept') gateCounts[i.gate] = (gateCounts[i.gate] ?? 0) + 1

  if (published.length === 0) flags.push('produces ZERO publishable images')
  else if (published.length < 5) flags.push(`only ${published.length} publishable image(s) against 10 slots`)

  if (gateCounts['fetch failed']) flags.push(`${gateCounts['fetch failed']} candidate(s) unreachable — host refuses the download`)
  if (gateCounts['too small']) flags.push(`${gateCounts['too small']} under the 480px gate`)
  if (gateCounts['content-type']) {
    flags.push(`${gateCounts['content-type']} lookaside URL(s) unresolved — HARNESS GAP, production resolves up to 3`)
  }
  if (gateCounts['aspect']) flags.push(`${gateCounts['aspect']} exceed the 3.0:1 aspect cap`)
  if (gateCounts['duplicate']) flags.push(`${gateCounts['duplicate']} perceptual duplicate(s) removed`)
  return flags
}

function beforeTile(i: BeforeImage, n: number): string {
  const legacy = (i.tags ?? []).filter((t) => t !== 'product' && t !== 'logo')
  const small = i.w && i.h && Math.min(i.w, i.h) < 480
  return `<figure class="tile${small || i.score === null ? ' warn' : ''}">
    <span class="rank">${n === 0 ? 'hero' : n}</span>
    <img src="${esc(i.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">
    <figcaption>
      <div class="l"><span>${esc(hostOf(i.source_url))}</span><span class="d">${i.w ?? '?'}×${i.h ?? '?'}</span></div>
      <div class="l"><span class="m">${esc(i.method ?? i.source)}</span><span class="s">${i.score ?? '—'}</span></div>
      ${(i.tags ?? []).map((t) => `<b class="${legacy.includes(t) ? 'lg' : ''}">${esc(t)}</b>`).join('')}
      ${small ? '<div class="bad">&lt;480px</div>' : ''}
      ${i.score === null ? '<div class="bad">unclassified</div>' : ''}
    </figcaption>
  </figure>`
}

function afterTile(i: AfterImage): string {
  const dropped = !i.published
  const label = i.gate !== 'kept' ? i.gate : i.disposition === 'reject' ? `reject: ${(i.reasons ?? []).join(',')}` : ''
  return `<figure class="tile${dropped ? ' dropped' : ''}">
    ${i.published ? `<span class="rank">${i.rank === 0 ? 'hero' : i.rank}</span>` : ''}
    ${i.gate === 'kept' ? `<img src="${esc(i.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="none">${esc(i.gate)}</div>`}
    <figcaption>
      <div class="l"><span>${esc(i.host)}</span><span class="d">${i.w || '?'}×${i.h || '?'}</span></div>
      <div class="l"><span class="m">${esc(i.method)}</span><span class="s">${i.score ?? '—'}</span></div>
      ${i.tag ? `<b>${esc(i.tag)}</b>` : ''}
      ${label ? `<div class="bad">${esc(label)}</div>` : ''}
    </figcaption>
  </figure>`
}

function diffCell(before: string | null, after: string | null): string {
  const same = (before ?? '') === (after ?? '')
  if (same) return `<td class="same">${before ? esc(before) : '<span class="muted">—</span>'}</td>`
  return `<td class="changed">${after ? esc(after) : '<span class="muted">— removed</span>'}</td>`
}

async function main(): Promise<void> {
  const beforeFile = JSON.parse(
    await readFile('scripts/image-eval/runs/_track/tracker.json', 'utf8')
  ) as { capturedAt: string; rows: BeforeBrand[] }
  const worker = JSON.parse(
    await readFile('scripts/image-eval/runs/_track/worker-after.json', 'utf8')
  ) as { ranAt: string; phases: string[]; brands: WorkerBrand[] }

  // Map the worker's stored rows onto the shape the renderer already speaks.
  // `status` carries the verdict: `active` was published, `rejected` was judged
  // and cut, `candidate` was stored but never classified.
  const after: AfterBrand[] = worker.brands.map((w) => {
    const site = w.submission?.purchase_website ?? null
    const ig = w.submission?.social_instagram ?? null
    const usableSite = site && !/(instagram|facebook|threads|linktr|bio\.site|shopee|pinkoi)/i.test(site) ? site : null
    const images: AfterImage[] = w.images
      .slice()
      .sort((l, r) => (l.sort_order ?? 99) - (r.sort_order ?? 99))
      .map((i) => {
        const meta = (i.provider_metadata ?? {}) as Record<string, unknown>
        return {
          url: i.url,
          host: hostOf(i.source_url ?? i.url),
          source: i.source,
          method: (meta.method as string) ?? i.source,
          w: i.width ?? 0,
          h: i.height ?? 0,
          gate: i.status === 'candidate' ? 'never classified' : 'kept',
          ...(i.status === 'rejected' ? { disposition: 'reject' } : {}),
          ...(i.tags?.length ? { tag: i.tags[0] } : {}),
          ...(i.score !== null ? { score: i.score } : {}),
          ...(i.rejection_reasons?.length ? { reasons: i.rejection_reasons } : {}),
          ...(i.alt_zh ? { altZh: i.alt_zh } : {}),
          ...(i.status === 'active' ? { rank: i.sort_order ?? 0, published: true } : {}),
        }
      })
    return {
      slug: w.slug,
      name: w.liveName,
      nameAfter: w.submission?.brand_name ?? w.liveName,
      productType: null,
      categoryZh: null,
      linksBefore: {},
      linksAfter: {
        purchase_website: site,
        social_instagram: ig,
        social_threads: w.submission?.social_threads ?? null,
        social_facebook: w.submission?.social_facebook ?? null,
        purchase_pinkoi: w.submission?.purchase_pinkoi ?? null,
        purchase_shopee: w.submission?.purchase_shopee ?? null,
      },
      routingBranch: usableSite ? (ig ? 'Website + Instagram' : 'Website only') : ig ? 'Instagram only' : 'Neither',
      imageQuery: '',
      scrapedUrls: [],
      candidateCount: w.images.length,
      bySource: w.images.reduce<Record<string, number>>((acc, i) => {
        const key = ((i.provider_metadata ?? {}) as Record<string, unknown>).method as string ?? i.source
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {}),
      images,
    }
  })

  const pairs = beforeFile.rows
    .map((b) => ({ before: b, after: after.find((a) => a.slug === b.slug) }))
    .filter((p): p is { before: BeforeBrand; after: AfterBrand } => Boolean(p.after))

  const summary = pairs
    .map(({ before: b, after: a }) => {
      const pub = a.images.filter((i) => i.published).length
      const now = (b.images ?? []).length
      const delta = pub - now
      const cls = pub === 0 ? 'bad' : delta > 0 ? 'good' : delta < 0 ? 'warn' : ''
      return `<tr>
      <td><a href="#${esc(b.slug)}"><b>${esc(b.name)}</b></a></td>
      <td>${esc(beforeBranch(b))} → <b>${esc(a.routingBranch)}</b></td>
      <td class="num">${now}</td>
      <td class="num">${a.candidateCount}</td>
      <td class="num">${a.images.filter((i) => i.gate === 'kept').length}</td>
      <td class="num ${cls}">${pub}</td>
      <td class="num ${cls}">${delta > 0 ? `+${delta}` : delta}</td>
    </tr>`
    })
    .join('')

  const sections = pairs
    .map(({ before: b, after: a }) => {
      const bImgs = b.images ?? []
      const aPublished = a.images.filter((i) => i.published)
      const aDropped = a.images.filter((i) => !i.published)
      const bf = beforeFlags(b)
      const af = afterFlags(a)

      return `<section class="brand" id="${esc(b.slug)}">
  <h2>${esc(b.name)} <span class="slug">${esc(b.slug)}</span></h2>

  <h3>Identity &amp; category</h3>
  <div class="scroll"><table class="cmp">
    <thead><tr><th>Field</th><th>Before (live)</th><th>After (this branch)</th></tr></thead>
    <tbody>
      <tr><th>Name</th><td class="same">${esc(b.name)}</td>${diffCell(b.name, a.nameAfter)}</tr>
      <tr><th>Category</th><td class="same">${esc(b.product_type ?? '—')}</td>${diffCell(b.product_type, a.productType)}</tr>
      <tr><th>Category (zh)</th><td class="same">${esc(a.categoryZh ?? '—')}</td><td class="same"><span class="muted">assigned by detect</span></td></tr>
    </tbody>
  </table></div>

  <h3>Links</h3>
  <div class="scroll"><table class="cmp">
    <thead><tr><th>Field</th><th>Before (live)</th><th>After (this branch)</th></tr></thead>
    <tbody>
      ${LINK_FIELDS.map((f) => {
        const beforeValue = (b as unknown as Record<string, string | null>)[f] ?? null
        return `<tr><th>${esc(f)}</th><td class="same">${beforeValue ? esc(beforeValue) : '<span class="muted">—</span>'}</td>${diffCell(beforeValue, a.linksAfter[f])}</tr>`
      }).join('')}
    </tbody>
  </table></div>

  <h3>Routing &amp; query</h3>
  <div class="scroll"><table class="cmp">
    <thead><tr><th></th><th>Before (live)</th><th>After (this branch)</th></tr></thead>
    <tbody>
      <tr><th>Branch</th><td class="same">${esc(beforeBranch(b))}</td>${diffCell(beforeBranch(b), a.routingBranch)}</tr>
      <tr><th>Images stored</th><td class="same">${(b.images ?? []).length} active</td><td class="changed">${a.candidateCount} stored — ${Object.entries(a.bySource).map(([k, v]) => `${esc(k)} ${v}`).join(', ') || 'none'}</td></tr>
    </tbody>
  </table></div>

  <h3>Flags</h3>
  <div class="cols">
    <div class="col">
      <div class="lbl">Before</div>
      ${bf.length ? `<ul class="flags">${bf.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}
    </div>
    <div class="col">
      <div class="lbl">After</div>
      ${af.length ? `<ul class="flags">${af.map((f) => `<li class="${f.includes('HARNESS GAP') ? 'note' : ''}">${esc(f)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}
    </div>
  </div>

  <h3>Active images <span class="meta">${bImgs.length} live → ${aPublished.length} would publish</span></h3>
  <div class="lbl">Before — currently published</div>
  <div class="grid">${bImgs.map((i, n) => beforeTile(i, n)).join('') || '<p class="muted">None.</p>'}</div>
  <div class="lbl">After — would publish</div>
  <div class="grid">${aPublished.map(afterTile).join('') || '<p class="muted">Nothing survives.</p>'}</div>
  <details>
    <summary>${aDropped.length} candidate(s) dropped — where each one died</summary>
    <div class="grid">${aDropped.map(afterTile).join('')}</div>
  </details>
</section>`
    })
    .join('')

  const ranAt = worker.ranAt.replace('T', ' ').slice(0, 16)
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Formoria — Curation pipeline before / after</title>
<style>
:root{--bg:#faf8f5;--surface:#fff;--ink:#1c1a17;--muted:#6b6560;--line:#e5dfd7;--accent:#8a5a2b;--good:#2f6b4f;--warn:#8a6d2b;--bad:#a33a2a;--radius:10px}
@media(prefers-color-scheme:dark){:root{--bg:#16150f;--surface:#201e18;--ink:#f0ebe3;--muted:#a29a90;--line:#35322a;--accent:#d9a066;--good:#6fb894;--warn:#d0aa5e;--bad:#e08472}}
:root[data-theme="dark"]{--bg:#16150f;--surface:#201e18;--ink:#f0ebe3;--muted:#a29a90;--line:#35322a;--accent:#d9a066;--good:#6fb894;--warn:#d0aa5e;--bad:#e08472}
:root[data-theme="light"]{--bg:#faf8f5;--surface:#fff;--ink:#1c1a17;--muted:#6b6560;--line:#e5dfd7;--accent:#8a5a2b;--good:#2f6b4f;--warn:#8a6d2b;--bad:#a33a2a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,-apple-system,"Helvetica Neue","PingFang TC",sans-serif}
.wrap{max-width:1240px;margin:0 auto;padding:0 24px 90px}
header{border-bottom:1px solid var(--line);padding:40px 0 20px;margin-bottom:20px}
h1{margin:0 0 8px;font-size:30px;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0;max-width:70ch}
nav{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0;margin-bottom:24px;z-index:5;display:flex;gap:16px;flex-wrap:wrap;font-size:13px}
nav a{color:var(--muted);text-decoration:none}nav a:hover{color:var(--accent)}
h2{font-size:22px;margin:0 0 14px}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:24px 0 8px}
.slug{font-size:13px;color:var(--muted);font-weight:400}
.meta{font-size:12px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400}
.lbl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:12px 0 6px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:560px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top;font-size:13px;word-break:break-all}
thead th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
table.cmp th:first-child{width:150px;color:var(--muted);font-weight:500}
td.same{color:var(--muted)}
td.changed{background:color-mix(in oklab,var(--accent) 12%,transparent);font-weight:500}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.good{color:var(--good);font-weight:700}.warn{color:var(--warn);font-weight:700}.bad{color:var(--bad);font-weight:700}
.muted{color:var(--muted)}
code{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.brand{padding-top:28px;border-top:1px solid var(--line);margin-bottom:16px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
ul.flags{margin:0;padding-left:18px;font-size:13px}
ul.flags li{margin-bottom:3px;color:var(--bad)}
ul.flags li.note{color:var(--muted);font-style:italic}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:6px}
.tile{position:relative;margin:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.tile img{display:block;width:100%;height:140px;object-fit:cover;background:var(--line)}
.tile .none{height:140px;display:flex;align-items:center;justify-content:center;background:var(--line);color:var(--bad);font-size:11px;text-align:center;padding:8px}
.tile figcaption{padding:6px 8px;font-size:10px;color:var(--muted)}
.tile .l{display:flex;justify-content:space-between;gap:6px}
.tile .l span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile .d,.tile .s{font-variant-numeric:tabular-nums;flex-shrink:0}
.tile .s{color:var(--ink);font-weight:700}
.tile .m{color:var(--accent)}
.tile b{display:inline-block;font-size:9px;background:var(--line);border-radius:99px;padding:0 6px;margin:3px 3px 0 0}
.tile b.lg{background:var(--warn);color:#16150f}
.tile .bad{margin-top:3px}
.tile.warn{border-color:var(--warn)}
.tile.dropped{opacity:.55;border-color:var(--bad)}
.rank{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.66);color:#fff;font-size:9px;padding:1px 7px;border-radius:99px}
details{margin-top:8px}
summary{cursor:pointer;font-size:13px;color:var(--muted)}
.callout{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:var(--radius);padding:16px 20px;margin-bottom:26px;font-size:14px}
.callout.red{border-left-color:var(--bad)}
.callout b{color:var(--ink)}
</style></head><body><div class="wrap">
<header>
<h1>Curation pipeline — before / after</h1>
<p class="sub"><b>Before</b> is live production data, captured ${esc(beforeFile.capturedAt)} UTC. <b>After</b> is the real worker — <code>runEnrich</code>, phases ${esc(worker.phases.join(', '))} — run at ${esc(ranAt)} UTC against temporary submission rows built from the same brands. Live brands and their images were never touched; the scratch rows were deleted after capture.</p>
</header>
<nav><a href="#summary">Summary</a>${pairs.map((p) => `<a href="#${esc(p.before.slug)}">${esc(p.before.name.split(' ')[0])}</a>`).join('')}</nav>

<div class="callout red" id="summary">
<b>Read the two zero-image brands first.</b> They are the finding, and they have different causes — one is a real external change, the other is an adapter defect. Both are detailed in their sections below.
</div>

<div class="scroll"><table>
<thead><tr><th>Brand</th><th>Routing before → after</th><th class="num">Live now</th><th class="num">Candidates</th><th class="num">Passed gates</th><th class="num">Would publish</th><th class="num">Δ</th></tr></thead>
<tbody>${summary}</tbody>
</table></div>

<div class="callout">
<b>This is the real pipeline, not a reimplementation.</b> Every phase ran through <code>runEnrich</code> — the same entry point the worker and admin UI call. The only difference from a production run is the target: scratch <code>brand_submissions</code> rows rather than the live brands, so the baseline survives for comparison. Rejected images are shown with the reason the classifier gave; <code>never classified</code> means the row was stored but its batch failed.
</div>

${sections}
</div></body></html>`

  await writeFile('scripts/image-eval/runs/_track/before-after.html', html)
  console.log('wrote scripts/image-eval/runs/_track/before-after.html')
  for (const { before: b, after: a } of pairs) {
    console.log(`  ${b.slug.padEnd(22)} ${String((b.images ?? []).length).padStart(2)} -> ${String(a.images.filter((i) => i.published).length).padStart(2)}`)
  }
}

void main()

export {}
