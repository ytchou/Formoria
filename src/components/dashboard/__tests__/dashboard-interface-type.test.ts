import { describe, expect, it } from "vitest";
import { statSync } from "node:fs";
import { join } from "node:path";

import {
  collectHeadings,
  collectSources,
  mingTitleRoleIn,
} from "@/test/source-scan";

/**
 * D3 INVERTS INSIDE THE OWNER DASHBOARD.
 *
 * The house rule is 明體 for content and 黑體 for interface. A dashboard is
 * almost entirely interface: its headings name a panel, they do not open a
 * document — and most of them repeat a tab label that is already on screen. Set
 * in 明體 the whole surface reads as a printed report rather than a tool.
 *
 * Scoped to HEADINGS on purpose. `type-section` also carries the big numbers on
 * an analytics card, and a numeral is data, not chrome; forbidding the role
 * outright would have forced those into a smaller step to satisfy a rule about
 * titles.
 */
const DASHBOARD_ROOTS = [
  "src/components/dashboard",
  "src/app/[locale]/(site)/(protected)/dashboard",
];

/**
 * The 明體 headings the dashboard keeps, and why. Two render the brand's own
 * name, which `DESIGN.md` §7 sets in 明體 wherever it appears — a brand name is
 * the one piece of genuine content on an otherwise operational screen. The
 * third is a zero-state, which is a page a person arrives at rather than a
 * panel inside a tool: there is no brand and no dashboard shell above it.
 *
 * The existence case below is not ceremony: an allowlist with no existence
 * check is exactly how the frontend token guard ended up holding an exemption
 * open for a file that had been deleted months earlier.
 */
const MING_HEADING_ALLOWLIST = [
  // `<h1>` is the brand's name, above its own dashboard.
  "src/components/dashboard/dashboard-hero-card.tsx",
  // `pageHeading` interpolates the brand's name.
  "src/app/[locale]/(site)/(protected)/dashboard/brands/[slug]/edit/page.tsx",
  // The "you have no brand yet" page. No shell, no panel — a page.
  "src/components/dashboard/dashboard-empty-state.tsx",
];

const dashboardSources = DASHBOARD_ROOTS.flatMap(collectSources);

describe("dashboard chrome reads as interface", () => {
  it("sets every dashboard heading in 黑體, not 明體", () => {
    const offenders = collectHeadings(dashboardSources)
      .filter((heading) => !MING_HEADING_ALLOWLIST.includes(heading.file))
      .map((heading) => ({ heading, role: mingTitleRoleIn(heading.attributes) }))
      .filter(({ role }) => role !== undefined)
      .map(({ heading, role }) => `${heading.file}:${heading.line} — ${role}`);

    expect(offenders).toEqual([]);
  });

  it("keeps every allowlisted file on disk", () => {
    for (const entry of MING_HEADING_ALLOWLIST) {
      expect(() => statSync(join(process.cwd(), entry))).not.toThrow();
    }
  });

  it("still finds headings to judge, so the gate cannot pass by scanning nothing", () => {
    expect(collectHeadings(dashboardSources).length).toBeGreaterThan(10);
  });
});
