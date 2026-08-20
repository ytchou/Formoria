import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures/auth";

import { BUDGET, POLL } from "../budgets";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// Same shape the enrichment scraper produces for 7-ELEVEN 賣貨便 (DEV-1307).
const MYSHIP_URL = "https://myship.7-11.com.tw/general/detail/GM2410161234567";

const PUBLISHABLE_CORE_ERROR =
  "Submission must satisfy publishable core before approval";

type EnrichedLinks = Record<string, string>;

type SeededSubmission = {
  id: string;
  brandName: string;
  slug: string;
  storagePath: string;
  imageUrl: string;
  jobId: string;
};

/**
 * Seeds a submission parked in the `ready` review stage: one active image, a
 * succeeded curation target, and enriched data that satisfies every publishable
 * -core requirement except the purchase/social links, which the caller supplies.
 * The curation job is queued with a far-future `run_after` so no worker can pick
 * it up and overwrite the seeded enrichment.
 */
async function seedReadySubmission(
  supabase: AnySupabaseClient,
  label: string,
  enrichedLinks: EnrichedLinks,
): Promise<SeededSubmission> {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const id = randomUUID();
  const brandName = `[E2E-TEST] Publishable core ${label} ${suffix}`;
  const slug = `e2e-publishable-core-${label}-${suffix}`;
  const storagePath = `submissions/${id}/hero.png`;

  const { error: uploadError } = await supabase.storage
    .from("brand-images")
    .upload(storagePath, PNG_1X1, { contentType: "image/png" });
  if (uploadError) throw new Error(`image seed failed: ${uploadError.message}`);
  const imageUrl = supabase.storage.from("brand-images").getPublicUrl(storagePath)
    .data.publicUrl;

  const { error: submissionError } = await supabase
    .from("brand_submissions")
    .insert({
      id,
      brand_id: null,
      brand_name: brandName,
      submitter_email: `e2e-publishable-core-${suffix}@example.com`,
      description: null,
      hero_image_url: null,
      status: "pending",
      intent: "recommend",
      is_brand_owner: false,
    });
  if (submissionError) {
    throw new Error(`submission seed failed: ${submissionError.message}`);
  }

  const { data: jobId, error: enqueueError } = await supabase.rpc(
    "enqueue_curation_job",
    {
      p_operation: "enrich",
      p_params: { target: "submissions", submissionIds: [id] },
      p_dry_run: false,
      p_started_by: "e2e-publishable-core",
      p_trigger: "admin",
      p_parent_job_id: null,
      p_attempt: 1,
      p_scheduled_for: null,
      p_run_after: "2099-01-01T00:00:00.000Z",
      p_dedupe_key: `e2e-publishable-core:${randomUUID()}`,
      p_targets: [
        {
          target_type: "submission",
          target_id: id,
          brand_name: brandName,
          brand_slug: null,
        },
      ],
    },
  );
  if (enqueueError || !jobId) {
    throw new Error(
      `curation job seed failed: ${enqueueError?.message ?? "missing id"}`,
    );
  }

  const { error: imageError } = await supabase.from("submission_images").insert({
    submission_id: id,
    storage_path: storagePath,
    url: imageUrl,
    source_url: imageUrl,
    source: "admin",
    status: "active",
    sort_order: 0,
  });
  if (imageError) {
    throw new Error(`submission image seed failed: ${imageError.message}`);
  }

  const { error: enrichmentError } = await supabase
    .from("brand_submissions")
    .update({
      enriched_data: {
        description: "台灣本地手工木器，以榫接工法製作日常餐廚用品。",
        description_en: "Taiwanese handmade wooden tableware.",
        blurb: "手工木器品牌",
        hero_image_url: imageUrl,
        category: "home",
        // Slug, not the zh-TW label: DEV-1510 closed the vocabulary and
        // `approve_submission` raises on any string that resolves to no slug,
        // alias or recorded removal. `tableware` is home-native, matching
        // `category` above — DEV-1507 deleted `woodcraft` with the rest of the
        // crafts L1.
        subcategories: ["tableware"],
        subcategories_en: ["Tableware"],
        price_range: 2,
        ...enrichedLinks,
      },
    })
    .eq("id", id);
  if (enrichmentError) {
    throw new Error(`enrichment seed failed: ${enrichmentError.message}`);
  }

  const completedAt = new Date().toISOString();
  const { error: targetError } = await supabase
    .from("curation_job_targets")
    .update({ status: "succeeded", completed_at: completedAt })
    .eq("job_id", jobId)
    .eq("target_id", id);
  if (targetError) {
    throw new Error(`target completion failed: ${targetError.message}`);
  }

  const { error: jobError } = await supabase
    .from("curation_jobs")
    .update({ status: "completed", completed_at: completedAt, succeeded_count: 1 })
    .eq("id", jobId);
  if (jobError) throw new Error(`job completion failed: ${jobError.message}`);

  return { id, brandName, slug, storagePath, imageUrl, jobId };
}

async function cleanupSubmission(
  supabase: AnySupabaseClient,
  seeded: SeededSubmission | undefined,
  brandId: string | undefined,
): Promise<void> {
  if (!supabase || !seeded) return;
  if (brandId) await supabase.from("brands").delete().eq("id", brandId);
  await supabase.from("submission_images").delete().eq("submission_id", seeded.id);
  await supabase.from("brand_submissions").delete().eq("id", seeded.id);
  await supabase.from("curation_jobs").delete().eq("id", seeded.jobId);
  await supabase.storage.from("brand-images").remove([seeded.storagePath]);
}

/**
 * DEV-1345 — covers `approve_submission`'s publishable-core link guard, a
 * hand-maintained SQL allow-list with no compile-time tie to the TypeScript
 * purchase-channel registry. `seedBrand({ purchaseChannel: 'myship' })` cannot
 * reach it: that fixture inserts straight into `brands`, while the guard only
 * runs on `brand_submissions` during admin approval.
 */
test.describe("Submission publishable-core link guard", () => {
  test.beforeEach(() => {
    const adminEmail = process.env.E2E_ADMIN_EMAIL;
    const admins = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim());
    test.skip(
      !adminEmail || !admins.includes(adminEmail),
      "E2E_ADMIN_EMAIL not in ADMIN_EMAILS — admin tests require matching env",
    );
  });

  let supabase: AnySupabaseClient;

  test.beforeAll(() => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  });

  test("a myship-only submission is approvable and publishes the channel", async ({
    adminPage,
  }) => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    let seeded: SeededSubmission | undefined;
    let approvedBrandId: string | undefined;

    try {
      seeded = await seedReadySubmission(supabase, "myship", {
        purchase_myship: MYSHIP_URL,
      });

      await adminPage.goto("/admin/submissions?stage=ready");
      const readyRow = adminPage
        .locator("tbody tr")
        .filter({ hasText: seeded.brandName });
      await expect(readyRow).toBeVisible({ timeout: BUDGET.GATED_UI });

      await readyRow
        .getByRole("button", { name: `Expand review for ${seeded.brandName}` })
        .click();
      // Approve lives in the drawer FOOTER, which is a sibling of the
      // `#submission-review-…` body node — scope it to the dialog, not to the
      // table row.
      const reviewDrawer = adminPage.getByRole("dialog");
      // Enabled only when the client completeness mirror also counts myship as a
      // link; a regression there disables the button before the SQL guard runs.
      const approve = reviewDrawer.getByRole("button", { name: "Approve", exact: true });
      await expect(approve).toBeEnabled();
      await approve.click();
      // The row leaves the `ready` filter only after the server action has
      // finished and refreshed; waiting here keeps the teardown below from
      // deleting the brand while post-approval image sync is still running.
      await expect(readyRow).toHaveCount(0, { timeout: BUDGET.NAVIGATION });

      await expect(async () => {
        const { data: submission, error } = await supabase
          .from("brand_submissions")
          .select("brand_id, status")
          .eq("id", seeded!.id)
          .single();
        expect(error).toBeNull();
        expect(submission?.status).toBe("approved");
        expect(submission?.brand_id).toBeTruthy();
        approvedBrandId = submission?.brand_id;
      }).toPass(POLL.APPLY);

      const { data: brand, error: brandError } = await supabase
        .from("brands")
        .select("status, purchase_myship, purchase_website")
        .eq("id", approvedBrandId!)
        .single();
      expect(brandError).toBeNull();
      expect(brand?.status).toBe("approved");
      expect(brand?.purchase_myship).toBe(MYSHIP_URL);
      expect(brand?.purchase_website).toBeNull();
    } finally {
      await cleanupSubmission(supabase, seeded, approvedBrandId);
    }
  });

  test("a submission with no purchase link and no social account is rejected", async () => {
    test.setTimeout(BUDGET.TEST.ADMIN);
    let seeded: SeededSubmission | undefined;

    try {
      seeded = await seedReadySubmission(supabase, "no-links", {});

      // Driven through the RPC rather than the admin UI on purpose: with no link
      // at all the client completeness check disables the Approve button, so the
      // browser can never reach the SQL guard. This asserts the guard itself
      // still rejects — without it the positive case above cannot distinguish
      // "myship counts as a link" from "the guard stopped running".
      const { error } = await supabase.rpc(
        "approve_submission_with_romanized_name",
        {
          p_submission_id: seeded.id,
          p_reviewer_id: randomUUID(),
          p_brand_data: {
            name: seeded.brandName,
            slug: seeded.slug,
            status: "approved",
            approved_at: new Date().toISOString(),
            description: "台灣本地手工木器，以榫接工法製作日常餐廚用品。",
            category: "home",
            subcategories: ["tableware"],
            price_range: 2,
          },
        },
      );
      expect(error?.message).toBe(PUBLISHABLE_CORE_ERROR);

      const { data: submission, error: readError } = await supabase
        .from("brand_submissions")
        .select("brand_id, status")
        .eq("id", seeded.id)
        .single();
      expect(readError).toBeNull();
      expect(submission?.status).toBe("pending");
      expect(submission?.brand_id).toBeNull();

      const { count, error: countError } = await supabase
        .from("brands")
        .select("id", { count: "exact", head: true })
        .eq("name", seeded.brandName);
      expect(countError).toBeNull();
      expect(count).toBe(0);
    } finally {
      await cleanupSubmission(supabase, seeded, undefined);
    }
  });
});
