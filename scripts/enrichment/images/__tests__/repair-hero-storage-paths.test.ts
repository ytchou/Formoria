import { describe, expect, it } from "vitest";

import {
  planHeroChange,
  planHeroRepairs,
  type HeroRow,
} from "../repair-hero-storage-paths";

const row = (key: string | null, slug = "yuwu-design"): HeroRow => ({
  id: `id-${slug}`,
  slug,
  hero_image_storage_path: key,
});

describe("planHeroRepairs", () => {
  it("selects only heroes whose key cannot be served publicly", () => {
    const plan = planHeroRepairs([
      row("submissions/sub-1/a.webp", "stale"),
      row("brands/brand-1/a.webp", "fine"),
      row(null, "none"),
      row("  ", "blank"),
    ]);
    expect(plan.stale.map((entry) => entry.slug)).toEqual(["stale"]);
  });
});

describe("planHeroChange", () => {
  it("repoints the hero to the first active public image", () => {
    expect(
      planHeroChange(row("submissions/sub-1/a.webp"), [
        "brands/brand-1/a.webp",
        "brands/brand-1/b.webp",
      ]),
    ).toEqual({
      id: "id-yuwu-design",
      slug: "yuwu-design",
      before: "submissions/sub-1/a.webp",
      after: "brands/brand-1/a.webp",
    });
  });

  it("leaves a brand alone when its first active image is not public", () => {
    expect(
      planHeroChange(row("submissions/sub-1/a.webp"), [
        "submissions/sub-1/a.webp",
      ]),
    ).toBeNull();
    expect(planHeroChange(row("submissions/sub-1/a.webp"), [])).toBeNull();
  });
});
