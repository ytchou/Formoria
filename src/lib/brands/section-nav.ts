// The strip is mobile-only (BD-27) and earns its chrome only once the page is
// long enough to need orientation: three short sections are skimmable unaided.
export const BRAND_SECTION_NAV_MIN_SECTIONS = 4

export function shouldShowBrandSectionNav(sectionCount: number) {
  return sectionCount >= BRAND_SECTION_NAV_MIN_SECTIONS
}
