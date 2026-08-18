/**
 * Baseline tracker for the DEV-1279 image-pipeline review.
 *
 * Re-runnable: reads the live state of a fixed brand set — links, category,
 * and every active image with its provenance — and renders a tracking page.
 * Read-only; it writes nothing back. Re-run it after each pipeline change to
 * see what actually moved.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/image-eval/track-brands.ts
 */
import { writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const TRACKED_SLUGS = [
  'jiayun-store',
  'venturezac',
  'handmadeship',
  'yuanxing-theoriental',
  'major-pleasure',
  'nu-dream-jewelry',
]

/** Our download gate, restated so the tracker can show what would fail today. */
const MIN_SHORT_EDGE = 480
const MAX_ASPECT = 2.0

/** Keep-tags after the DEV-1279 collapse; anything else on a live row is legacy. */
const CURRENT_TAGS = new Set(['product', 'logo'])

/** Hosts that are a platform root, not a brand's own site. */
const PLATFORM_HOSTS =
  /(instagram|facebook|threads|tiktok|twitter|x\.com|linktr|lin\.ee|line\.me|shopee|momoshop|ruten|pchome|pinkoi|etsy|amazon|yahoo|carousell|youtube)/i

type ImageRow = {
  url: string
  source: string
  method: string | null
  page: string | null
  query: string | null
  source_url: string | null
  score: number | null
  tags: string[] | null
  w: number | null
  h: number | null
  sort_order: number | null
  alt_zh: string | null
  created_at: string
}

type BrandRow = {
  slug: string
  name: string
  category: string | null
  subcategories: string[] | null
  city: string | null
  mit_status: string | null
  purchase_website: string | null
  social_instagram: string | null
  social_threads: string | null
  social_facebook: string | null
  purchase_pinkoi: string | null
  purchase_shopee: string | null
  other_urls: string[] | null
  images: ImageRow[] | null
  rejected_count: number
  total_images: number
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

/** Which of the four routing branches this brand falls into. */
function routingBranch(b: BrandRow): { id: string; label: string; query: string } {
  const site = b.purchase_website?.trim()
  let host: string | null = null
  try {
    host = site ? new URL(site).hostname.toLowerCase().replace(/^www\./, '') : null
  } catch {
    host = null
  }
  const category = b.category ?? '—'
  if (host && b.social_instagram) {
    return { id: 'web+ig', label: 'Website + Instagram', query: `site:${host} ${b.name}` }
  }
  if (host) return { id: 'web', label: 'Website only', query: `site:${host} ${b.name}` }
  if (b.social_instagram) {
    return { id: 'ig', label: 'Instagram only', query: `"${b.name}" ${category} 商品` }
  }
  return { id: 'none', label: 'Neither', query: `"${b.name}" ${category} 商品` }
}

type Flag = { level: 'bad' | 'warn'; text: string }

function flagsFor(b: BrandRow): Flag[] {
  const flags: Flag[] = []
  const imgs = b.images ?? []

  if (b.purchase_website && PLATFORM_HOSTS.test(b.purchase_website)) {
    flags.push({
      level: 'bad',
      text: `purchase_website is a platform root (${hostOf(b.purchase_website)}), not the brand's own site — the site: query would search the whole platform`,
    })
  }
  const unjudged = imgs.filter((i) => i.score === null || i.tags === null)
  if (unjudged.length) {
    flags.push({
      level: 'bad',
      text: `${unjudged.length} active image(s) never classified — they hold a publish slot on no merit`,
    })
  }
  const small = imgs.filter((i) => i.w && i.h && Math.min(i.w, i.h) < MIN_SHORT_EDGE)
  if (small.length) {
    flags.push({
      level: 'warn',
      text: `${small.length} of ${imgs.length} active image(s) are under the ${MIN_SHORT_EDGE}px short-edge gate — they would not be re-acquired today`,
    })
  }
  const wide = imgs.filter((i) => i.w && i.h && Math.max(i.w, i.h) / Math.min(i.w, i.h) > MAX_ASPECT)
  if (wide.length) {
    flags.push({ level: 'warn', text: `${wide.length} image(s) exceed the ${MAX_ASPECT}:1 aspect cap` })
  }
  const legacy = imgs.filter((i) => (i.tags ?? []).some((t) => !CURRENT_TAGS.has(t)))
  if (legacy.length) {
    const names = [...new Set(legacy.flatMap((i) => (i.tags ?? []).filter((t) => !CURRENT_TAGS.has(t))))]
    flags.push({ level: 'warn', text: `${legacy.length} image(s) carry legacy tags (${names.join(', ')})` })
  }
  if (imgs.length < 5) {
    flags.push({ level: 'warn', text: `only ${imgs.length} active image(s) against 10 slots` })
  }
  // A marketplace URL we hold but which produced nothing means its adapter is inert.
  for (const [field, url] of [
    ['Pinkoi', b.purchase_pinkoi],
    ['Shopee', b.purchase_shopee],
  ] as const) {
    if (!url) continue
    const fromHost = imgs.filter((i) => (i.source_url ?? '').includes(field.toLowerCase()))
    if (fromHost.length === 0) {
      flags.push({ level: 'bad', text: `${field} store is known but contributed zero images — adapter inert` })
    }
  }
  return flags
}

function linkRow(label: string, url: string | null): string {
  if (!url) return `<tr><th>${esc(label)}</th><td class="muted">—</td></tr>`
  return `<tr><th>${esc(label)}</th><td><a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a></td></tr>`
}

function imageTile(i: ImageRow, index: number): string {
  const short = i.w && i.h ? Math.min(i.w, i.h) : 0
  const aspect = i.w && i.h ? Math.max(i.w, i.h) / Math.min(i.w, i.h) : 1
  const bad: string[] = []
  if (short && short < MIN_SHORT_EDGE) bad.push(`&lt;${MIN_SHORT_EDGE}px`)
  if (aspect > MAX_ASPECT) bad.push(`${aspect.toFixed(1)}:1`)
  if (i.score === null) bad.push('unclassified')
  const legacyTags = (i.tags ?? []).filter((t) => !CURRENT_TAGS.has(t))

  return `<figure class="tile${bad.length ? ' flagged' : ''}">
    <span class="rank">${index === 0 ? 'hero' : index}</span>
    <img src="${esc(i.url)}" alt="${esc(i.alt_zh ?? '')}" loading="lazy" referrerpolicy="no-referrer">
    <figcaption>
      <div class="line"><span>${esc(hostOf(i.source_url))}</span><span class="dim">${i.w ?? '?'}×${i.h ?? '?'}</span></div>
      <div class="line"><span class="method">${esc(i.method ?? i.source)}</span><span class="score">${i.score ?? '—'}</span></div>
      ${(i.tags ?? []).length ? `<div class="tags">${(i.tags ?? []).map((t) => `<b class="${legacyTags.includes(t) ? 'legacy' : ''}">${esc(t)}</b>`).join('')}</div>` : ''}
      ${bad.length ? `<div class="bad">${bad.join(' · ')}</div>` : ''}
      ${i.alt_zh ? `<div class="alt">${esc(i.alt_zh)}</div>` : '<div class="alt muted">no alt text</div>'}
    </figcaption>
  </figure>`
}

async function main(): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: brands, error } = await supabase
    .from('brands')
    .select('*')
    .in('slug', TRACKED_SLUGS)
  if (error) throw error

  const rows: BrandRow[] = []
  for (const b of (brands ?? []) as Array<BrandRow & { id: string }>) {
    const { data: imgs } = await supabase
      .from('brand_images')
      .select('url, source, provider_metadata, source_url, status, score, tags, width, height, sort_order, alt_zh, created_at')
      .eq('brand_id', b.id)
    const all = (imgs ?? []) as Array<Record<string, unknown>>
    const active = all
      .filter((i) => i.status === 'active')
      .map((i): ImageRow => {
        const meta = (i.provider_metadata ?? {}) as Record<string, unknown>
        return {
          url: String(i.url),
          source: String(i.source),
          method: (meta.method as string) ?? String(i.source),
          page: (meta.pageUrl as string) ?? null,
          query: (meta.query as string) ?? null,
          source_url: (i.source_url as string) ?? null,
          score: i.score === null ? null : Number(i.score),
          tags: (i.tags as string[]) ?? null,
          w: (i.width as number) ?? null,
          h: (i.height as number) ?? null,
          sort_order: (i.sort_order as number) ?? null,
          alt_zh: (i.alt_zh as string) ?? null,
          created_at: String(i.created_at),
        }
      })
      .sort((l, r) => (l.sort_order ?? 99) - (r.sort_order ?? 99))

    rows.push({
      ...b,
      images: active,
      rejected_count: all.filter((i) => i.status === 'rejected').length,
      total_images: all.length,
    })
  }
  rows.sort((a, b) => TRACKED_SLUGS.indexOf(a.slug) - TRACKED_SLUGS.indexOf(b.slug))

  const capturedAt = new Date().toISOString().replace('T', ' ').slice(0, 16)

  const summaryRows = rows
    .map((b) => {
      const br = routingBranch(b)
      const f = flagsFor(b)
      const bad = f.filter((x) => x.level === 'bad').length
      return `<tr>
      <td><a href="#${esc(b.slug)}"><b>${esc(b.name)}</b></a><br><code>${esc(b.slug)}</code></td>
      <td>${esc(br.label)}</td>
      <td><code>${esc(b.category ?? '—')}</code></td>
      <td class="num">${(b.images ?? []).length}</td>
      <td class="num">${b.rejected_count}</td>
      <td class="num ${bad ? 'bad' : f.length ? 'warn' : 'good'}">${bad ? `${bad} blocking` : f.length ? `${f.length} minor` : 'clean'}</td>
    </tr>`
    })
    .join('')

  const sections = rows
    .map((b) => {
      const br = routingBranch(b)
      const f = flagsFor(b)
      return `<section class="brand" id="${esc(b.slug)}">
    <h2>${esc(b.name)} <span class="slug">${esc(b.slug)}</span></h2>

    <div class="cols">
      <div class="col">
        <h3>Identity &amp; category</h3>
        <table class="kv">
          <tr><th>Category</th><td><code>${esc(b.category ?? '—')}</code></td></tr>
          <tr><th>Product subcategories</th><td>${(b.subcategories ?? []).length ? (b.subcategories ?? []).map((t) => `<span class="chip">${esc(t)}</span>`).join('') : '<span class="muted">—</span>'}</td></tr>
          <tr><th>City</th><td>${esc(b.city ?? '—')}</td></tr>
          <tr><th>MIT status</th><td>${esc(b.mit_status ?? '—')}</td></tr>
        </table>
      </div>
      <div class="col">
        <h3>Links</h3>
        <table class="kv">
          ${linkRow('purchase_website', b.purchase_website)}
          ${linkRow('social_instagram', b.social_instagram)}
          ${linkRow('social_threads', b.social_threads)}
          ${linkRow('social_facebook', b.social_facebook)}
          ${linkRow('purchase_pinkoi', b.purchase_pinkoi)}
          ${linkRow('purchase_shopee', b.purchase_shopee)}
        </table>
      </div>
    </div>

    <h3>Routing</h3>
    <p class="routing"><span class="chip strong">${esc(br.label)}</span> would issue <code>${esc(br.query)}</code></p>

    ${
      f.length
        ? `<h3>Flags</h3><ul class="flags">${f.map((x) => `<li class="${x.level}">${esc(x.text)}</li>`).join('')}</ul>`
        : '<h3>Flags</h3><p class="muted">None.</p>'
    }

    <h3>Active images <span class="meta">${(b.images ?? []).length} active · ${b.rejected_count} rejected · ${b.total_images} total</span></h3>
    <div class="grid">${(b.images ?? []).map((i, n) => imageTile(i, n)).join('') || '<p class="muted">No active images.</p>'}</div>
  </section>`
    })
    .join('')

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Formoria — Image pipeline brand tracker</title>
<style>
:root{--bg:#faf8f5;--surface:#fff;--ink:#1c1a17;--muted:#6b6560;--line:#e5dfd7;--accent:#8a5a2b;--good:#2f6b4f;--warn:#8a6d2b;--bad:#a33a2a;--radius:10px}
@media(prefers-color-scheme:dark){:root{--bg:#16150f;--surface:#201e18;--ink:#f0ebe3;--muted:#a29a90;--line:#35322a;--accent:#d9a066;--good:#6fb894;--warn:#d0aa5e;--bad:#e08472}}
:root[data-theme="dark"]{--bg:#16150f;--surface:#201e18;--ink:#f0ebe3;--muted:#a29a90;--line:#35322a;--accent:#d9a066;--good:#6fb894;--warn:#d0aa5e;--bad:#e08472}
:root[data-theme="light"]{--bg:#faf8f5;--surface:#fff;--ink:#1c1a17;--muted:#6b6560;--line:#e5dfd7;--accent:#8a5a2b;--good:#2f6b4f;--warn:#8a6d2b;--bad:#a33a2a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,-apple-system,"Helvetica Neue","PingFang TC",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px 90px}
header{border-bottom:1px solid var(--line);padding:40px 0 20px;margin-bottom:20px}
h1{margin:0 0 8px;font-size:30px;letter-spacing:-.02em;text-wrap:balance}
.sub{color:var(--muted);margin:0;max-width:68ch}
.stamp{color:var(--muted);font-size:13px;margin-top:10px}
nav{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0;margin-bottom:26px;z-index:5;display:flex;gap:16px;flex-wrap:wrap;font-size:13px}
nav a{color:var(--muted);text-decoration:none}nav a:hover,nav a:focus-visible{color:var(--accent)}
h2{font-size:22px;margin:0 0 14px}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:22px 0 8px}
.slug{font-size:13px;color:var(--muted);font-weight:400}
.meta{font-size:12px;color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400}
.table-scroll{overflow-x:auto;margin-bottom:34px}
table{border-collapse:collapse;width:100%}
table.summary{min-width:640px}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
thead th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
table.kv th{width:150px;font-size:12px;color:var(--muted);font-weight:500}
table.kv td{word-break:break-all;font-size:13px}
a{color:var(--accent)}
code{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.muted{color:var(--muted)}
.good{color:var(--good);font-weight:600}.warn{color:var(--warn);font-weight:600}.bad{color:var(--bad);font-weight:600}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:22px}
.brand{padding-top:26px;border-top:1px solid var(--line);margin-bottom:12px}
.chip{display:inline-block;background:var(--surface);border:1px solid var(--line);border-radius:99px;padding:1px 9px;font-size:12px;margin:0 4px 4px 0}
.chip.strong{border-color:var(--accent);color:var(--accent)}
.routing{margin:0}
ul.flags{margin:0;padding-left:18px}
ul.flags li{margin-bottom:4px}
ul.flags li.bad{color:var(--bad)}
ul.flags li.warn{color:var(--warn)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:12px}
.tile{position:relative;margin:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
.tile.flagged{border-color:var(--bad)}
.tile img{display:block;width:100%;height:150px;object-fit:cover;background:var(--line)}
.tile figcaption{padding:7px 9px;font-size:10px;color:var(--muted)}
.tile .line{display:flex;justify-content:space-between;gap:6px}
.tile .line span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile .dim,.tile .score{font-variant-numeric:tabular-nums;flex-shrink:0}
.tile .score{color:var(--ink);font-weight:600}
.tile .method{color:var(--accent)}
.tile .tags b{display:inline-block;font-size:9px;background:var(--line);border-radius:99px;padding:0 6px;margin:3px 3px 0 0;font-weight:600}
.tile .tags b.legacy{background:var(--warn);color:#16150f}
.tile .bad{color:var(--bad);font-weight:600;margin-top:3px}
.tile .alt{margin-top:4px;line-height:1.4}
.rank{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.66);color:#fff;font-size:9px;padding:1px 7px;border-radius:99px}
</style></head><body><div class="wrap">
<header>
<h1>Image pipeline — brand tracker</h1>
<p class="sub">Live state of six brands spanning all four routing branches, captured before the DEV-1279 pipeline changes ship. Re-run <code>scripts/image-eval/track-brands.ts</code> after each change to see what actually moved.</p>
<p class="stamp">Captured ${esc(capturedAt)} UTC · read-only, nothing written back</p>
</header>

<nav><a href="#summary">Summary</a>${rows.map((b) => `<a href="#${esc(b.slug)}">${esc(b.name.split(' ')[0])}</a>`).join('')}</nav>

<h2 id="summary">Summary</h2>
<div class="table-scroll"><table class="summary">
<thead><tr><th>Brand</th><th>Routing branch</th><th>Category</th><th class="num">Active</th><th class="num">Rejected</th><th class="num">Flags</th></tr></thead>
<tbody>${summaryRows}</tbody>
</table></div>

${sections}
</div></body></html>`

  await writeFile('scripts/image-eval/runs/_track/tracker.html', html)
  await writeFile('scripts/image-eval/runs/_track/tracker.json', JSON.stringify({ capturedAt, rows }, null, 2))

  console.log(`captured ${rows.length} brands`)
  for (const b of rows) {
    const f = flagsFor(b)
    console.log(`  ${b.slug.padEnd(22)} ${String((b.images ?? []).length).padStart(2)} active · ${f.filter((x) => x.level === 'bad').length} blocking, ${f.filter((x) => x.level === 'warn').length} minor`)
  }
  console.log('\nwrote scripts/image-eval/runs/_track/tracker.html')
}

void main()

export {}
