const ENRICHMENT_CONFIG_VERSION = 'v2.4'

export function buildEnrichmentConfig(phase: string, params: Record<string, unknown>) {
  return {
    version: ENRICHMENT_CONFIG_VERSION,
    phase,
    params,
  }
}

export function buildSerpConfig() {
  return {
    version: ENRICHMENT_CONFIG_VERSION,
    queryVariant: 'E',
    params: { num: 10, gl: 'tw', hl: 'zh-TW' },
  }
}
