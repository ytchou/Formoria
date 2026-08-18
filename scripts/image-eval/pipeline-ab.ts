/**
 * Runs this worktree's curation pipeline for a fixed brand set, end to end
 * through image classification, and writes nothing.
 *
 * Every decision below comes from the production modules — query construction,
 * scraping and adapters, the candidate pool, the classifier prompt and parser,
 * the ranker. Only the two steps that persist are replaced: images are gated in
 * memory rather than uploaded, and OpenAI/serper are called directly rather
 * than through the audited clients, so no audit rows land either.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/image-eval/pipeline-ab.ts
 */
import { writeFile, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import { buildImageQueryVariants } from '@/lib/services/enrich-phases/scraper/search'
import { scrapeBrandUrls, MAX_SCRAPE_URLS_PER_BRAND } from '@/lib/services/enrich-phases/scraper'
import { classifyByDomain, isNonBrandSiteHost } from '@/lib/services/enrich-phases/scraper/input-detector'
import { buildCandidatePool, type CandidateImage } from '@/lib/services/enrich-phases/candidate-pool'
import {
  buildBrandContext,
  parseClassificationBatch,
  applyClassifications,
} from '@/lib/services/enrich-phases/classify-images'
import { IMAGE_CLASSIFY_SYSTEM_PROMPT } from '@/lib/prompts'
import { computeDHash, isNonImageContentType } from '@/lib/services/image-download'
import { categoryLabelZh } from '@/lib/taxonomy/ontology'
import { cleanBrandName } from '@/lib/services/brand-cleanup'

const TRACKED_SLUGS = [
  'jiayun-store',
  'venturezac',
  'handmadeship',
  'yuanxing-theoriental',
  'major-pleasure',
  'nu-dream-jewelry',
]

/** Mirrors the production gates in image-download.ts. */
const MIN_SHORT_EDGE = 480
const MAX_ASPECT = 3.0
const MIN_ENTROPY = 0.5
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp'])
const PHASH_HAMMING_THRESHOLD = 5
/** Mirrors BATCH_SIZE in classify-images.ts. */
const BATCH_SIZE = 5

type GateResult = 'kept' | 'fetch failed' | 'content-type' | 'too small' | 'aspect' | 'entropy' | 'format' | 'duplicate'

type AfterImage = {
  url: string
  host: string
  source: string
  method: string
  w: number
  h: number
  gate: GateResult
  dataUri?: string
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
  categorySlug: string | null
  categoryZh: string | null
  linksBefore: Record<string, string | null>
  linksAfter: Record<string, string | null>
  routingBranch: string
  imageQuery: string
  scrapedUrls: string[]
  candidateCount: number
  bySource: Record<string, number>
  images: AfterImage[]
  error?: string
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return '?'
  }
}

function hamming(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++
  return d
}

/** The download gates, applied to bytes held in memory. Nothing is uploaded. */
async function gateCandidate(
  candidate: CandidateImage,
  claimed: string[]
): Promise<AfterImage> {
  const base = {
    url: candidate.url,
    host: hostOf(candidate.url),
    source: candidate.source,
    method: candidate.method ?? candidate.source,
    w: 0,
    h: 0,
  }
  try {
    const res = await fetch(candidate.url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { ...base, gate: 'fetch failed' }
    const contentType = res.headers.get('content-type') ?? ''
    if (isNonImageContentType(contentType)) return { ...base, gate: 'content-type' }

    const buffer = Buffer.from(await res.arrayBuffer())
    const meta = await sharp(buffer).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    const sized = { ...base, w, h }

    if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) return { ...sized, gate: 'format' }
    if (Math.min(w, h) < MIN_SHORT_EDGE) return { ...sized, gate: 'too small' }
    if (Math.max(w, h) / Math.max(1, Math.min(w, h)) > MAX_ASPECT) return { ...sized, gate: 'aspect' }

    const stats = await sharp(buffer).stats()
    if (typeof stats.entropy === 'number' && stats.entropy < MIN_ENTROPY) {
      return { ...sized, gate: 'entropy' }
    }

    const phash = await computeDHash(buffer)
    if (claimed.some((known) => hamming(known, phash) < PHASH_HAMMING_THRESHOLD)) {
      return { ...sized, gate: 'duplicate' }
    }
    claimed.push(phash)

    // What production sends the classifier: a 512px render. Here it becomes a
    // data URI instead of a signed storage URL, because nothing is uploaded.
    const webp = await sharp(buffer).resize({ width: 512, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
    return { ...sized, gate: 'kept', dataUri: `data:image/webp;base64,${webp.toString('base64')}` }
  } catch {
    return { ...base, gate: 'fetch failed' }
  }
}

async function classifyBatch(
  brandContext: string,
  images: AfterImage[]
): Promise<Map<string, { disposition: string; tag: string | null; score: number; reasons: string[]; altZh: string }>> {
  const ordinals = images.map((_, i) => String(i + 1))
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 250 * images.length,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: IMAGE_CLASSIFY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${brandContext}Classify the ${images.length} brand images that follow, numbered ${ordinals.join(', ')} in order. Return a JSON object with a "classifications" array holding exactly ${images.length} objects, whose "id" values are the image numbers as strings. Do not omit any image.`,
            },
            ...images.map((i) => ({ type: 'image_url', image_url: { url: i.dataUri, detail: 'low' } })),
          ],
        },
      ],
    }),
  })
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
  if (!res.ok) {
    console.log(`      classify failed: ${String(json.error?.message).slice(0, 120)}`)
    return new Map()
  }
  const out = new Map<string, { disposition: string; tag: string | null; score: number; reasons: string[]; altZh: string }>()
  for (const [ord, v] of parseClassificationBatch(json.choices?.[0]?.message?.content ?? '')) {
    out.set(ord, { disposition: v.disposition, tag: v.tag, score: v.score, reasons: v.reasons, altZh: v.altZh })
  }
  return out
}

async function serperImages(query: string): Promise<CandidateImage[]> {
  const res = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: query,
      num: 10,
      gl: 'tw',
      hl: 'zh-TW',
      // Mirrors buildImageSearchBody: one floor, matched to our own 480px gate.
      tbs: 'isz:lt,islt:vga',
      autocorrect: false,
    }),
  })
  if (!res.ok) return []
  const imgs = (((await res.json()) as { images?: unknown[] }).images ?? []) as Array<{
    imageUrl: string
    imageWidth?: number
    imageHeight?: number
    title?: string
    link?: string
  }>
  return imgs.map((i) => ({
    url: i.imageUrl,
    source: 'google_image' as const,
    sourceUrl: i.imageUrl,
    ...(i.link ? { pageUrl: i.link } : {}),
    ...(i.title ? { title: i.title } : {}),
    query,
    ...(i.imageWidth ? { imageWidth: i.imageWidth } : {}),
    ...(i.imageHeight ? { imageHeight: i.imageHeight } : {}),
  }))
}

/** Mirrors prioritizeScrapeUrls in links.ts: round-robin by kind. */
function prioritize(urls: string[]): string[] {
  const official: string[] = []
  const social: string[] = []
  const marketplace: string[] = []
  for (const url of urls) {
    const c = classifyByDomain(url)
    if (c === null) official.push(url)
    else if (c === 'social') social.push(url)
    else marketplace.push(url)
  }
  const buckets = [official, social, marketplace]
  const deepest = Math.max(...buckets.map((b) => b.length), 0)
  const ordered: string[] = []
  for (let i = 0; i < deepest; i++) for (const b of buckets) {
    const u = b.at(i)
    if (u) ordered.push(u)
  }
  return ordered
}

async function main(): Promise<void> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: brands, error } = await supabase
    .from('brands')
    .select('id, slug, name, category, purchase_website, social_instagram, social_threads, social_facebook, purchase_pinkoi, purchase_shopee')
    .in('slug', TRACKED_SLUGS)
  if (error) throw error

  const results: AfterBrand[] = []

  for (const b of (brands ?? []) as Array<Record<string, string | null>>) {
    const slug = String(b.slug)
    console.log(`\n=== ${b.name} (${slug})`)

    const linksBefore = {
      purchase_website: b.purchase_website,
      social_instagram: b.social_instagram,
      social_threads: b.social_threads,
      social_facebook: b.social_facebook,
      purchase_pinkoi: b.purchase_pinkoi,
      purchase_shopee: b.purchase_shopee,
    }

    // --- clean: name normalisation (production helper) ---
    const nameAfter = cleanBrandName(String(b.name ?? slug)).cleanedName.trim() || String(b.name ?? slug)

    // --- links: scrape known URLs, then one bounded second pass ---
    const knownUrls = Object.values(linksBefore).filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    const scrapeSet = prioritize(knownUrls).slice(0, MAX_SCRAPE_URLS_PER_BRAND)
    let scraped: Record<string, unknown> = {}
    try {
      if (scrapeSet.length > 0) {
        const first = await scrapeBrandUrls(scrapeSet)
        scraped = first.data as unknown as Record<string, unknown>
      }
    } catch (e) {
      console.log(`   scrape failed: ${String(e).slice(0, 80)}`)
    }
    console.log(`   scraped ${scrapeSet.length} url(s)`)

    // Production refuses a platform host for the website column.
    const rawWebsite = (scraped.purchaseWebsite as string) ?? b.purchase_website ?? null
    const websiteAfter = rawWebsite && !isNonBrandSiteHost(rawWebsite) ? rawWebsite : null

    const linksAfter = {
      purchase_website: websiteAfter,
      social_instagram: (scraped.socialInstagram as string) ?? b.social_instagram ?? null,
      social_threads: (scraped.socialThreads as string) ?? b.social_threads ?? null,
      social_facebook: (scraped.socialFacebook as string) ?? b.social_facebook ?? null,
      purchase_pinkoi: (scraped.purchasePinkoi as string) ?? b.purchase_pinkoi ?? null,
      purchase_shopee: (scraped.purchaseShopee as string) ?? b.purchase_shopee ?? null,
    }

    // --- image query: the real branch logic ---
    const queries = buildImageQueryVariants({
      brandName: nameAfter,
      categorySlug: b.category,
      purchaseWebsite: websiteAfter,
    })
    const imageQuery = queries.at(0) ?? ''
    const routingBranch = websiteAfter
      ? linksAfter.social_instagram ? 'Website + Instagram' : 'Website only'
      : linksAfter.social_instagram ? 'Instagram only' : 'Neither'
    console.log(`   branch: ${routingBranch}\n   query:  ${imageQuery}`)

    // --- image search + candidate pool (production helper) ---
    const googleImages = imageQuery ? await serperImages(imageQuery) : []
    const pool = buildCandidatePool({
      scraped: ((scraped.imageSources as Array<{ url: string; method: string; pageUrl: string; position: number }>) ?? []).map((s) => ({
        url: s.url,
        method: s.method,
        pageUrl: s.pageUrl,
        position: s.position,
      })),
      jsonLdImages: (scraped.jsonLdImageUrls as string[]) ?? [],
      googleImages,
    })
    const bySource: Record<string, number> = {}
    for (const c of pool) bySource[c.source] = (bySource[c.source] ?? 0) + 1
    console.log(`   candidates: ${pool.length} (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`)

    // --- download gates, in memory ---
    const claimed: string[] = []
    const gated: AfterImage[] = []
    for (const c of pool) gated.push(await gateCandidate(c, claimed))
    const kept = gated.filter((g) => g.gate === 'kept')
    console.log(`   passed gates: ${kept.length}/${gated.length}`)

    // --- classification, batched exactly as production batches ---
    for (let i = 0; i < kept.length; i += BATCH_SIZE) {
      const chunk = kept.slice(i, i + BATCH_SIZE)
      const verdicts = await classifyBatch(
        // pinkoi/instagram must mirror runClassifyImagesPhase: the prompt
        // withholds wrong_brand when no identifier is present, so omitting them
        // would make the harness measure a weaker prompt than production.
        buildBrandContext({
          name: nameAfter,
          categorySlug: b.category,
          website: websiteAfter,
          pinkoi: b.purchase_pinkoi ?? null,
          instagram: b.social_instagram ?? null,
        }),
        chunk
      )
      for (const [ord, v] of verdicts) {
        const image = chunk.at(Number(ord) - 1)
        if (!image) continue
        image.disposition = v.disposition
        image.tag = v.tag
        image.score = v.score
        image.reasons = v.reasons
        image.altZh = v.altZh
      }
    }

    // --- rank + cap, using the production ranker ---
    const classifiedForRanker = kept
      .filter((k) => k.disposition)
      .map((k, index) => ({
        id: String(index),
        tag: (k.tag ?? 'product') as 'product' | 'logo',
        score: k.score ?? 0,
        storage_path: null,
        disposition: k.disposition as 'keep' | 'reject',
        ...(k.reasons?.length ? { rejectionReasons: k.reasons as never } : {}),
        width: k.w,
        height: k.h,
      }))
    const { ordered } = applyClassifications(classifiedForRanker as never)
    ordered.forEach((row, rank) => {
      const image = kept.at(Number(row.id))
      if (!image) return
      image.rank = rank
      image.published = rank < 10
    })
    console.log(`   classified keep: ${ordered.length}, published: ${Math.min(ordered.length, 10)}`)

    results.push({
      slug,
      name: String(b.name ?? slug),
      nameAfter,
      categorySlug: b.category,
      categoryZh: categoryLabelZh(b.category),
      linksBefore,
      linksAfter,
      routingBranch,
      imageQuery,
      scrapedUrls: scrapeSet,
      candidateCount: pool.length,
      bySource,
      images: gated,
    })
  }

  await writeFile('scripts/image-eval/runs/_track/after.json', JSON.stringify(results, null, 2))
  console.log('\nwrote scripts/image-eval/runs/_track/after.json')

  const before = JSON.parse(await readFile('scripts/image-eval/runs/_track/tracker.json', 'utf8')) as {
    capturedAt: string
    rows: Array<Record<string, unknown>>
  }
  console.log(`baseline captured ${before.capturedAt} — ${before.rows.length} brands`)
}

void main()

export {}
