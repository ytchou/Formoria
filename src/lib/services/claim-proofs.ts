export const CLAIM_PROOF_TYPES = [
  'domain_email',
  'backend_screenshot',
  'business_doc',
] as const
export type ClaimProofType = (typeof CLAIM_PROOF_TYPES)[number]
export type ProofEvidence = {
  type: ClaimProofType
  url?: string
  imageKey?: string
  note?: string
}
export const PROOF_TYPE_I18N_KEYS: Record<ClaimProofType, string> = {
  domain_email: 'domainEmail',
  backend_screenshot: 'backendScreenshot',
  business_doc: 'businessDoc',
}
