import { createHash } from 'node:crypto'

const ENRICHMENT_CONFIG_VERSION = 'v2.1'

function shortHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8)
}

export function buildEnrichmentConfig(phase: string, systemPrompt: string, params: Record<string, unknown>) {
  return {
    version: ENRICHMENT_CONFIG_VERSION,
    phase,
    promptHash: shortHash(systemPrompt),
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
