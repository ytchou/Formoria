import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isLogoImageTags } from '@/lib/constants/brand-images'
import { CROP_DAMAGE_WEIGHT } from '@/lib/services/enrich-phases/classify-images'
// esc / artifactPath / ARTIFACT_ROOT are shared with
// scripts/curation-rerun/render.ts; see scripts/shared/artifact.ts.
import { ARTIFACT_ROOT, artifactPath, esc } from '../shared/artifact'
import { PREVIEW_PATH, type PreviewBrand, type PreviewFile } from './shared'
import { loadScriptTarget } from '../shared/target'

function ratio(
  image: { width: number | null; height: number | null } | null,
): number | null {
  return image?.width && image.height ? image.width / image.height : null
}

function shape(value: number | null): string {
  if (value === null) return 'unknown'
  if (value < 0.95) return 'portrait'
  if (value > 1.45) return 'landscape'
  return 'square'
}

function frame(image: PreviewBrand['oldHero'], label: string): string {
  if (!image) return `<div class="missing">${esc(label)}: no image</div>`
  return `<figure><div class="hero-frame"><img src="${esc(image.url)}" alt="" referrerpolicy="no-referrer"></div><figcaption>${esc(label)} · ${image.width ?? '?'} × ${image.height ?? '?'}</figcaption><img class="raw" src="${esc(image.url)}" alt="raw thumbnail" loading="lazy"></figure>`
}

function candidateTable(entry: PreviewBrand): string {
  const images = new Map(entry.rankedImages.map((image) => [image.id, image]))
  const rows = entry.ranked.slice(0, 3).map((candidate) => {
    const image = images.get(candidate.id)
    return `<tr><td>${esc(candidate.id)}</td><td>${candidate.score}</td><td>${image?.width ?? '?'} × ${image?.height ?? '?'}</td><td>${image && ratio(image) ? ratio(image)!.toFixed(2) : '?'}</td><td>${candidate.cropDamage.toFixed(1)}</td><td>${candidate.heroQuality.toFixed(1)}</td></tr>`
  })
  return `<table><thead><tr><th>id</th><th>score</th><th>w × h</th><th>ratio</th><th>cropDamage</th><th>heroQuality</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
}

function renderChanged(entry: PreviewBrand): string {
  // Absolute, matching scripts/curation-rerun/render.ts: the artifact is opened
  // from disk over file://, where a root-relative href resolves to nothing.
  return `<article><h3>${esc(entry.name)} — <a href="https://formoria.com/admin/brands/${esc(entry.slug)}" target="_blank" rel="noreferrer">${esc(entry.slug)} ↗</a></h3><div class="side-by-side">${frame(entry.oldHero, 'old hero')}${frame(entry.newHero, 'new hero')}</div>${candidateTable(entry)}</article>`
}

async function main(): Promise<void> {
  loadScriptTarget()
  const preview = JSON.parse(
    await readFile(PREVIEW_PATH, 'utf8'),
  ) as PreviewFile
  const changed = preview.brands.filter(
    (entry) =>
      entry.oldHero?.id !== entry.newHero?.id && entry.skipReason === null,
  )
  const gallery = preview.brands.filter(
    (entry) =>
      entry.skipReason === null &&
      entry.oldHero?.id === entry.newHero?.id &&
      entry.assignments.some(
        ({ id, sortOrder }) =>
          entry.currentSortOrders.find((row) => row.id === id)?.sortOrder !==
          sortOrder,
      ),
  )
  const unchanged =
    preview.brands.length -
    changed.length -
    gallery.length -
    preview.brands.filter((entry) => entry.skipReason !== null).length
  const skipped = new Map<string, number>()
  for (const entry of preview.brands.filter((item) => item.skipReason !== null))
    skipped.set(entry.skipReason!, (skipped.get(entry.skipReason!) ?? 0) + 1)
  const logoPromotions = changed.filter(
    (entry) =>
      isLogoImageTags(entry.newHero?.tags) &&
      !isLogoImageTags(entry.oldHero?.tags),
  )
  // A brand whose hero row carries no score cannot answer this question, so it is
  // excluded rather than defaulted — a defaulted 0 would manufacture alarms.
  const scoreAlarms = changed.filter((entry) => {
    const oldScore = entry.oldHero?.score
    const newScore = entry.newHero?.score
    if (typeof oldScore !== 'number' || typeof newScore !== 'number') return false
    return newScore < oldScore - CROP_DAMAGE_WEIGHT
  })
  const noHero = preview.brands.filter(
    (entry) => entry.skipReason === null && !entry.newHero,
  )
  const transitions = new Map<string, number>()
  for (const entry of changed) {
    const key = `${shape(ratio(entry.oldHero))}->${shape(ratio(entry.newHero))}`
    transitions.set(key, (transitions.get(key) ?? 0) + 1)
  }
  const crop = (entry: PreviewBrand): { old: number; next: number } | null => {
    const old = entry.ranked.find(
      (candidate) => candidate.id === entry.oldHero?.id,
    )?.cropDamage
    const next = entry.ranked.find(
      (candidate) => candidate.id === entry.newHero?.id,
    )?.cropDamage
    return old === undefined || next === undefined ? null : { old, next }
  }
  const cropPairs = changed
    .map(crop)
    .filter((value): value is { old: number; next: number } => value !== null)
  const mean = (values: number[]): string =>
    values.length
      ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)
      : '—'
  const html = `<!doctype html><meta charset="utf-8"><title>Hero resort review</title><style>
body{font:14px system-ui;margin:32px;color:#202124}article{border-top:1px solid #ddd;padding:20px 0}.alarm{background:#fff3cd;padding:14px;margin:8px 0}.side-by-side{display:flex;gap:20px}.hero-frame{width:360px;aspect-ratio:4/3;overflow:hidden;background:#eee}.hero-frame img{width:100%;height:100%;object-fit:cover}.raw{max-width:180px;max-height:120px;display:block;margin-top:8px}figure{margin:0}table{border-collapse:collapse;margin-top:16px}td,th{border:1px solid #ddd;padding:6px;text-align:left}.missing{width:360px;aspect-ratio:4/3;background:#eee;padding:12px;box-sizing:border-box}.muted{color:#666}
</style><h1>Hero resort review</h1><p>${preview.brands.length} brands · generated ${esc(preview.generatedAt)}</p><section><h2>Go/no-go alarms</h2><div class="alarm">Logo promotions: ${logoPromotions.length} ${logoPromotions.map((e) => esc(e.slug)).join(', ')}</div><div class="alarm">Raw-score drops greater than ${CROP_DAMAGE_WEIGHT}: ${scoreAlarms.length}</div><div class="alarm">Brands with no active hero: ${noHero.length}</div><p>Mean cropDamage, old → new: ${mean(cropPairs.map((v) => v.old))} → ${mean(cropPairs.map((v) => v.next))}</p><p>Shape transitions: ${[...transitions].map(([key, count]) => `${esc(key)} (${count})`).join(', ') || '—'}</p></section><section><h2>Summary</h2><p>A no change: ${unchanged}</p><details><summary>B gallery reorder, hero unchanged: ${gallery.length}</summary><ul>${gallery.map((e) => `<li>${esc(e.slug)}</li>`).join('')}</ul></details><h2>C hero changed: ${changed.length}</h2>${changed.map(renderChanged).join('')}<h2>D skipped</h2><ul>${[...skipped].map(([reason, count]) => `<li>${esc(reason)}: ${count}</li>`).join('')}</ul></section>`
  const out = artifactPath('resort-heroes')
  await mkdir(ARTIFACT_ROOT, { recursive: true })
  await writeFile(out, html, 'utf8')
  console.log(`wrote ${out}`)
}

void main().catch((error: unknown) => {
  console.error(
    '\nFAILED:',
    error instanceof Error ? error.message : JSON.stringify(error),
  )
  process.exitCode = 1
})

export {}
