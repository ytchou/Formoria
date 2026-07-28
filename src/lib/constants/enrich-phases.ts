export const ENRICH_PHASES = [
  'clean',
  'detect',
  'slugs',
  'tags',
  'discover',
  'links',
  'images',
  'classify_images',
  'descriptions',
  'locations',
  'expansion',
] as const

export const IMAGE_ENRICH_PHASES = [
  'images',
  'classify_images',
] as const satisfies readonly (typeof ENRICH_PHASES)[number][]

export const TEXT_ENRICH_PHASES = ENRICH_PHASES.filter(
  (phase) => !(IMAGE_ENRICH_PHASES as readonly string[]).includes(phase),
)
