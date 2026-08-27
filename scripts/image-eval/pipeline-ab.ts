/**
 * Runs this worktree's curation pipeline for a fixed brand set, end to end
 * through image classification, and writes nothing.
 *
 * Every decision below comes from the production modules — query construction,
 * scraping and adapters, the candidate pool, the classifier prompt and parser,
 * the ranker. Only the two steps that persist are replaced: images are gated in
 * memory rather than uploaded, and OpenAI/serper are called directly. Scraper
 * audit spans are expected; no submissions, images, or brands are written.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/image-eval/pipeline-ab.ts
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import { buildImageQueryVariants } from '@/lib/services/enrich-phases/scraper/search'
import {
  scrapeBrandUrls,
  MAX_SCRAPE_URLS_PER_BRAND,
} from '@/lib/services/enrich-phases/scraper'
import {
  classifyByDomain,
  isNonBrandSiteHost,
} from '@/lib/services/enrich-phases/scraper/input-detector'
import {
  buildCandidatePool,
  type CandidateImage,
} from '@/lib/services/enrich-phases/candidate-pool'
import {
  buildBrandContext,
  parseClassificationBatch,
  applyClassifications,
  IMAGE_CLASSIFY_BATCH_SIZE,
} from '@/lib/services/enrich-phases/classify-images'
import { IMAGE_CLASSIFY_SYSTEM_PROMPT } from '@/lib/prompts'
import {
  applyProductionImageGates,
  imageRejectionCode,
  isPerceptualDuplicate,
  type ImageRejectionCode,
} from '@/lib/services/image-download'
import { categoryLabelZh } from '@/lib/taxonomy/ontology'
import { cleanBrandName } from '@/lib/services/brand-cleanup'
import { createLocalPlaywrightProvider } from '@/lib/services/enrich-phases/scraper/render/local-playwright-provider'
import { createOpenAIClient } from '@/lib/services/openai-client'
import { profileChatParams } from '@/lib/services/llm-audit'
import { auditedCall } from '@/lib/audit'
import { batchSearchBrandImages } from '@/lib/services/enrich-phases/scraper/serper'
import { resolveProfileModel } from '@/lib/constants/llm-models'

const TRACKED_SLUGS = [
  'jiayun-store',
  'venturezac',
  'handmadeship',
  'yuanxing-theoriental',
  'major-pleasure',
  'nu-dream-jewelry',
]

const ADAPTER_COHORTS = {
  instagram: ['seeseamylove', 'yarn-ball', 'memedo', 'quoin', 'tings-aroma'],
  pinkoi: ['seeseamylove', 'memedo', 'guaguaforest', 'tings-aroma', 'zenu'],
  shopee: [
    'yun-clean',
    'man-man-soap',
    'nsou',
    'yi-fan-canvas-bags',
    'my-beast',
  ],
  myship: ['an-ma', 'billnogates', 'lumirona', 'honestea', 'scent-forest'],
  shopline: ['zenu', 'satana', 'addable', 'inblooom', 'goodglas'],
  '91app': ['clany', '74ounce', 'a-mour', 'solis', 'erss'],
  cyberbiz: [
    'chih-tsui-fang',
    'fluffystar',
    '糖果屋幼教用品社',
    'anta-pottery',
    'buwu',
  ],
} as const

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv.at(index + 1) : undefined
}

function targetSlugs(): { label: string; slugs: readonly string[] } {
  const adapter = argValue('--adapter')
  if (!adapter) return { label: 'track', slugs: TRACKED_SLUGS }
  if (!(adapter in ADAPTER_COHORTS)) {
    throw new Error(
      `unknown --adapter ${adapter}; expected ${Object.keys(ADAPTER_COHORTS).join(', ')}`,
    )
  }
  return {
    label: adapter,
    slugs: ADAPTER_COHORTS[adapter as keyof typeof ADAPTER_COHORTS],
  }
}

type GateResult = 'kept' | ImageRejectionCode

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

/** The download gates, applied to bytes held in memory. Nothing is uploaded. */
async function gateCandidate(
  candidate: CandidateImage,
  claimed: string[],
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
    if (!res.ok) return { ...base, gate: 'fetch_failed' }
    const contentType = res.headers.get('content-type') ?? ''
    const buffer = Buffer.from(await res.arrayBuffer())
    const result = await applyProductionImageGates(buffer, contentType)
    const w = result.width
    const h = result.height
    const sized = { ...base, w, h }
    const phash = result.phash
    if (isPerceptualDuplicate(phash, claimed)) {
      return { ...sized, gate: 'duplicate' }
    }
    claimed.push(phash)

    // What production sends the classifier: a 512px render. Here it becomes a
    // data URI instead of a signed storage URL, because nothing is uploaded.
    const webp = await sharp(buffer)
      .resize({ width: 512, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
    return {
      ...sized,
      gate: 'kept',
      dataUri: `data:image/webp;base64,${webp.toString('base64')}`,
    }
  } catch (error) {
    return { ...base, gate: imageRejectionCode(error) ?? 'fetch_failed' }
  }
}

async function classifyBatch(
  brandContext: string,
  images: AfterImage[],
): Promise<
  Map<
    string,
    {
      disposition: string
      tag: string | null
      score: number
      reasons: string[]
    }
  >
> {
  const ordinals = images.map((_, i) => String(i + 1))
  const response = await auditedCall(
    { provider: 'openai', operation: 'image_eval_classify', kind: 'external' },
    async (ctx) => {
      const client = createOpenAIClient({
        model: resolveProfileModel('classifyImages'),
        onChatComplete: (event) => {
          Object.assign(ctx.summary, {
            request: {
              system: event.request.system.slice(0, 2_000),
              user: event.request.user.slice(0, 2_000),
              imageCount: event.request.imageCount,
            },
            response: JSON.stringify(event.data).slice(0, 2_000),
            model: event.model,
            latencyMs: event.latencyMs,
          })
        },
      })
      const result = await client.chat({
        system: IMAGE_CLASSIFY_SYSTEM_PROMPT,
        user: `${brandContext}Classify the ${images.length} brand images that follow, numbered ${ordinals.join(', ')} in order. Return a JSON object with a "classifications" array holding exactly ${images.length} objects, whose "id" values are the image numbers as strings. Do not omit any image.`,
        images: images.map((image) => image.dataUri ?? ''),
        imageDetail: 'low',
        json: true,
        ...profileChatParams('classifyImages', {
          maxTokens: 250 * images.length,
        }),
      })
      Object.assign(ctx.summary, {
        imageCount: images.length,
        httpStatus: result.status,
        ok: result.ok,
      })
      return result
    },
  )
  if (!response.ok) return new Map()
  const out = new Map<
    string,
    {
      disposition: string
      tag: string | null
      score: number
      reasons: string[]
    }
  >()
  for (const [ord, v] of parseClassificationBatch(
    response.content ?? '',
  )) {
    out.set(ord, {
      disposition: v.disposition,
      tag: v.tag,
      score: v.score,
      reasons: v.reasons,
    })
  }
  return out
}

async function serperImages(query: string): Promise<CandidateImage[]> {
  const outcome = (
    await batchSearchBrandImages([query], 1, () => query)
  ).get(query)
  return (outcome?.rows ?? []).map((image) => ({
    ...image,
    url: image.url,
    source: 'google_image' as const,
    sourceUrl: image.sourceUrl ?? image.url,
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
  for (let i = 0; i < deepest; i++)
    for (const b of buckets) {
      const u = b.at(i)
      if (u) ordered.push(u)
    }
  return ordered
}

async function main(): Promise<void> {
  const target = targetSlugs()
  const renderProvider = process.argv.includes('--local-render')
    ? createLocalPlaywrightProvider()
    : undefined
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data: brands, error } = await supabase
    .from('brands')
    .select(
      'id, slug, name, category, purchase_website, social_instagram, social_threads, social_facebook, purchase_pinkoi, purchase_shopee, purchase_myship',
    )
    .in('slug', [...target.slugs])
  if (error) throw error
  const returnedSlugs = new Set((brands ?? []).map((brand) => brand.slug))
  const missingSlugs = target.slugs.filter((slug) => !returnedSlugs.has(slug))
  if (missingSlugs.length > 0) {
    throw new Error(`missing cohort brands: ${missingSlugs.join(', ')}`)
  }

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
      purchase_myship: b.purchase_myship,
    }

    // --- clean: name normalisation (production helper) ---
    const nameAfter =
      cleanBrandName(String(b.name ?? slug)).cleanedName.trim() ||
      String(b.name ?? slug)

    // --- links: scrape known URLs, then one bounded second pass ---
    const knownUrls = Object.values(linksBefore).filter(
      (u): u is string => typeof u === 'string' && u.trim().length > 0,
    )
    const scrapeSet = prioritize(knownUrls).slice(0, MAX_SCRAPE_URLS_PER_BRAND)
    let scraped: Record<string, unknown> = {}
    try {
      if (scrapeSet.length > 0) {
        const first = await scrapeBrandUrls(scrapeSet, { renderProvider })
        scraped = first.data as unknown as Record<string, unknown>
      }
    } catch (e) {
      console.log(`   scrape failed: ${String(e).slice(0, 80)}`)
    }
    console.log(`   scraped ${scrapeSet.length} url(s)`)

    // Production refuses a platform host for the website column.
    const rawWebsite =
      (scraped.purchaseWebsite as string) ?? b.purchase_website ?? null
    const websiteAfter =
      rawWebsite && !isNonBrandSiteHost(rawWebsite) ? rawWebsite : null

    const linksAfter = {
      purchase_website: websiteAfter,
      social_instagram:
        (scraped.socialInstagram as string) ?? b.social_instagram ?? null,
      social_threads:
        (scraped.socialThreads as string) ?? b.social_threads ?? null,
      social_facebook:
        (scraped.socialFacebook as string) ?? b.social_facebook ?? null,
      purchase_pinkoi:
        (scraped.purchasePinkoi as string) ?? b.purchase_pinkoi ?? null,
      purchase_shopee:
        (scraped.purchaseShopee as string) ?? b.purchase_shopee ?? null,
      purchase_myship:
        (scraped.purchaseMyship as string) ?? b.purchase_myship ?? null,
    }

    // --- image query: the real branch logic ---
    const queries = buildImageQueryVariants({
      brandName: nameAfter,
      categorySlug: b.category,
      purchaseWebsite: websiteAfter,
    })
    const imageQuery = queries.at(0) ?? ''
    const routingBranch = websiteAfter
      ? linksAfter.social_instagram
        ? 'Website + Instagram'
        : 'Website only'
      : linksAfter.social_instagram
        ? 'Instagram only'
        : 'Neither'
    console.log(`   branch: ${routingBranch}\n   query:  ${imageQuery}`)

    // --- image search + candidate pool (production helper) ---
    const googleImages = imageQuery ? await serperImages(imageQuery) : []
    const pool = buildCandidatePool({
      scraped: (
        (scraped.imageSources as Array<{
          url: string
          method: string
          pageUrl: string
          position: number
        }>) ?? []
      ).map((s) => ({
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
    console.log(
      `   candidates: ${pool.length} (${
        Object.entries(bySource)
          .map(([k, v]) => `${k} ${v}`)
          .join(', ') || 'none'
      })`,
    )

    // --- download gates, in memory ---
    const claimed: string[] = []
    const gated: AfterImage[] = []
    for (const c of pool) gated.push(await gateCandidate(c, claimed))
    const kept = gated.filter((g) => g.gate === 'kept')
    console.log(`   passed gates: ${kept.length}/${gated.length}`)

    // --- classification, batched exactly as production batches ---
    for (let i = 0; i < kept.length; i += IMAGE_CLASSIFY_BATCH_SIZE) {
      const chunk = kept.slice(i, i + IMAGE_CLASSIFY_BATCH_SIZE)
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
        chunk,
      )
      for (const [ord, v] of verdicts) {
        const image = chunk.at(Number(ord) - 1)
        if (!image) continue
        image.disposition = v.disposition
        image.tag = v.tag
        image.score = v.score
        image.reasons = v.reasons
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
    console.log(
      `   classified keep: ${ordered.length}, published: ${Math.min(ordered.length, 10)}`,
    )

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

  const adapterImages = results.flatMap((brand) =>
    brand.images.filter((item) =>
      target.label === 'track'
        ? item.method.endsWith('_adapter')
        : item.method === `${target.label}_adapter`,
    ),
  )
  const gatePassing = adapterImages.filter((item) => item.gate === 'kept')
  const classifierKept = gatePassing.filter(
    (item) => item.disposition === 'keep',
  )
  const rejectionCounts = Object.fromEntries(
    [
      ...new Set(
        adapterImages
          .filter((item) => item.gate !== 'kept')
          .map((item) => item.gate),
      ),
    ].map((code) => [
      code,
      adapterImages.filter((item) => item.gate === code).length,
    ]),
  )
  const metrics = {
    cohort: target.label,
    returned: adapterImages.length,
    gatePassing: gatePassing.length,
    classifierKept: classifierKept.length,
    imageGatePass:
      adapterImages.length > 0 ? gatePassing.length / adapterImages.length : 0,
    classifierKeep:
      gatePassing.length > 0 ? classifierKept.length / gatePassing.length : 0,
    endToEndImageYield:
      adapterImages.length > 0
        ? classifierKept.length / adapterImages.length
        : 0,
    rejectionCounts,
  }
  const outputDir = `scripts/image-eval/runs/_${target.label}`
  await mkdir(outputDir, { recursive: true })
  await writeFile(`${outputDir}/after.json`, JSON.stringify(results, null, 2))
  await writeFile(`${outputDir}/metrics.json`, JSON.stringify(metrics, null, 2))
  console.log(`\nwrote ${outputDir}/after.json and metrics.json`)

  if (target.label === 'track') {
    const before = JSON.parse(
      await readFile('scripts/image-eval/runs/_track/tracker.json', 'utf8'),
    ) as {
      capturedAt: string
      rows: Array<Record<string, unknown>>
    }
    console.log(
      `baseline captured ${before.capturedAt} — ${before.rows.length} brands`,
    )
  }
}

void main()

export {}
