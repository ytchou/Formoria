// Temporary kill switch shared by the page and its Server Actions. Setting this
// to true restores the nav entry, section fetch, rendered section, and mutations.
// Keep it in lockstep with the skipped locations block in brand-detail.spec.ts;
// DEV-1400 owns re-enabling both after the stockist data has been rebuilt.
// The annotation keeps the enabled branches reachable to TypeScript.
export const LOCATIONS_SECTION_ENABLED: boolean = false;
