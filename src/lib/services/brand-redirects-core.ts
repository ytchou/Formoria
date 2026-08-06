export interface BrandRedirectRepository {
  hasApprovedBrandSlug(slug: string): Promise<boolean>
  resolveApprovedBrandRedirect(oldSlug: string): Promise<string | null>
}
