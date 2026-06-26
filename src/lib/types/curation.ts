import type { BrandStatus } from './brand'

export interface CurationConfig {
  dryRun: boolean
  overwrite?: boolean
  slugs?: string[]
  status?: BrandStatus
  limit?: number
  onProgress?: (msg: string) => void
}

export interface BrandOutcome {
  slug: string
  name: string
  status: 'changed' | 'skipped' | 'failed'
  error?: string
}

export interface OperationResult {
  processed: number
  updated: number
  skipped: number
  errors: string[]
  brandOutcomes: BrandOutcome[]
}
