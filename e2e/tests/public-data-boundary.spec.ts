import { BUDGET, POLL } from "../budgets";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { publishedStories } from "../utils/published-stories";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe.serial("Public brand data boundary", () => {
  test.skip(
    process.env.PREVIEW_MODE === "true",
    "PREVIEW_MODE active — skipping DB-write test",
  );

  let supabase: AnySupabaseClient | undefined;
  let brandId: string;
  let brandName: string;
  let brandSlug: string;
  let searchToken: string;
  let actorUserId: string;
  let canaries: string[] = [];

  test.beforeAll(async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Public data boundary E2E requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }

    supabase = createClient(url, key);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    searchToken = `boundary${suffix}`;
    brandName = `[E2E-TEST] Public Boundary ${searchToken}`;
    brandSlug = `e2e-public-boundary-${suffix}`;
    const privateContact = `private-contact-${suffix}@example.invalid`;
    const privateDraft = `private-draft-${suffix}`;
    const privateEvidence = `private-evidence-${suffix}`;
    const privateSource = `private-source-${suffix}`;
    const { data: actor, error: actorError } = await supabase.auth.admin.createUser({
      email: `public-boundary-${suffix}@example.com`,
      password: `Public-boundary-${suffix}`,
      email_confirm: true,
    });
    if (actorError || !actor.user) {
      throw new Error(
        `Public data boundary actor seed failed: ${actorError?.message ?? "missing user"}`,
      );
    }
    actorUserId = actor.user.id;

    const privateActor = actorUserId;
    const privateTimestamp = new Date().toISOString();
    canaries = [
      privateContact,
      privateDraft,
      privateEvidence,
      privateSource,
      privateActor,
      privateTimestamp,
    ];

    const { data: brand, error: brandError } = await supabase
      .from("brands")
      .insert({
        name: brandName,
        slug: brandSlug,
        status: "approved",
        approved_at: new Date().toISOString(),
        category: "home",
        description: "A public description for the data-boundary journey.",
        contact_email: privateContact,
        draft_data: { canary: privateDraft },
        draft_updated_at: privateTimestamp,
        mit_evidence: { private_note: privateEvidence },
        mit_declared_by: privateActor,
        source: privateSource,
        reputation_summary: {
          text: "Public reputation summary.",
          sources: [privateSource],
        },
        brand_enriched_at: privateTimestamp,
        updated_at: privateTimestamp,
        is_demo: false,
      })
      .select("id")
      .single();

    if (brandError || !brand) {
      throw new Error(
        `Public data boundary brand seed failed: ${brandError?.message ?? "missing row"}`,
      );
    }
    brandId = brand.id;

  });

  test.afterAll(async () => {
    if (!supabase) return;
    const cleanupErrors: string[] = [];
    if (brandId) {
      const { error } = await supabase.from("brands").delete().eq("id", brandId);
      if (error) cleanupErrors.push(`brand deletion failed: ${error.message}`);
    }
    if (actorUserId) {
      const { error } = await supabase.auth.admin.deleteUser(actorUserId);
      if (error) cleanupErrors.push(`actor deletion failed: ${error.message}`);
    }
    if (cleanupErrors.length > 0) {
      throw new Error(`[e2e-cleanup] public data boundary cleanup failed — ${cleanupErrors.join("; ")}`);
    }
  });

  test("anonymous public surfaces omit private brand data from HTML, RSC, and JSON-LD", async ({
    page,
  }) => {
    const rscBodies: Promise<string>[] = [];
    page.on("response", (response) => {
      if (response.headers()["content-type"]?.includes("text/x-component")) {
        rscBodies.push(response.text().catch(() => ""));
      }
    });

    const rootResponse = await page.goto("/brands");
    if (rootResponse?.status() === 503) {
      test.skip(true, "PREVIEW_MODE active");
      return;
    }
    const searchbox = page.locator(
      'main form[aria-label="依品牌或產品關鍵字篩選"] input[role="searchbox"]',
    );
    await searchbox.fill(searchToken);
    await searchbox.press("Enter");
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === "/brands" &&
        url.searchParams.get("search") === searchToken
      );
    });
    await expect(page.getByRole("link", { name: brandName })).toBeVisible({
      timeout: BUDGET.GATED_UI,
    });
    await auditCurrentDocument(page, canaries, "directory card");

    await page.getByRole("link", { name: brandName }).click();
    await expect(page).toHaveURL(new RegExp(`/brands/${brandSlug}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: brandName }),
    ).toBeVisible({
      timeout: BUDGET.GATED_UI,
    });
    await auditCurrentDocument(page, canaries, "brand detail");

    const story = publishedStories("zh-TW").at(0);
    if (story) {
      const response = await page.goto(`/stories/${story.slug}`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { level: 1, name: story.title }),
      ).toBeVisible({
        timeout: BUDGET.GATED_UI,
      });
    } else {
      const response = await page.goto("/stories");
      expect(response?.status()).toBe(200);
      // `exact` on a two-character name: "專題" is a substring of several story
      // and nav labels, so an unanchored match resolves to more than one node
      // the moment any of them is also a heading (DEV-1414).
      await expect(
        page.getByRole("heading", { level: 1, name: "專題", exact: true }),
      ).toBeVisible();
    }
    await auditCurrentDocument(page, canaries, "story surface");

    await expect
      .poll(() => rscBodies.length, POLL.UI)
      .toBeGreaterThan(0);
    const capturedRsc = (await Promise.all(rscBodies)).join("\n");
    assertCanariesAbsent(capturedRsc, canaries, "captured RSC responses");
  });
});

async function auditCurrentDocument(
  page: Page,
  canaries: string[],
  label: string,
): Promise<void> {
  const documentHtml = await page.content();
  const jsonLd = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  assertCanariesAbsent(
    `${documentHtml}\n${jsonLd.join("\n")}`,
    canaries,
    label,
  );
}

function assertCanariesAbsent(
  payload: string,
  canaries: string[],
  label: string,
): void {
  for (const canary of canaries) {
    expect(payload, `${label} exposed private canary ${canary}`).not.toContain(
      canary,
    );
  }
}
