import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Admin submission enrichment lifecycle", () => {
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
  let submissionId: string;
  let jobId: string | undefined;
  let approvedBrandId: string | undefined;
  let brandName: string;
  let storagePath: string;
  let heroUrl: string;

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    submissionId = randomUUID();
    brandName = `[E2E-TEST] Submission lifecycle ${suffix}`;
    storagePath = `submissions/${submissionId}/hero.png`;

    const { error: uploadError } = await supabase.storage
      .from("brand-images")
      .upload(storagePath, PNG_1X1, { contentType: "image/png" });
    if (uploadError)
      throw new Error(`image seed failed: ${uploadError.message}`);

    const { data: publicImage } = supabase.storage
      .from("brand-images")
      .getPublicUrl(storagePath);
    heroUrl = publicImage.publicUrl;

    const { error: submissionError } = await supabase
      .from("brand_submissions")
      .insert({
        id: submissionId,
        brand_id: null,
        brand_name: brandName,
        submitter_email: `e2e-submission-${suffix}@example.com`,
        description: null,
        hero_image_url: null,
        status: "pending",
        intent: "recommend",
        is_brand_owner: false,
      });
    if (submissionError) {
      throw new Error(`submission seed failed: ${submissionError.message}`);
    }
  });

  test.afterAll(async () => {
    if (!supabase) return;

    if (approvedBrandId) {
      await supabase.from("brands").delete().eq("id", approvedBrandId);
    }
    if (jobId) {
      await supabase.from("curation_jobs").delete().eq("id", jobId);
    }
    if (submissionId) {
      await supabase.from("brand_submissions").delete().eq("id", submissionId);
    }
    if (storagePath) {
      await supabase.storage.from("brand-images").remove([storagePath]);
    }
  });

  test("moves from needs data to enriching to ready, then creates the brand on approval", async ({
    adminPage,
  }) => {
    test.setTimeout(120_000);

    await adminPage.goto("/admin/submissions?stage=needs_data");
    await expect(adminPage.getByText(brandName, { exact: true })).toBeVisible();
    await expectBrandCount(0);

    const { data: queuedJobId, error: enqueueError } = await supabase.rpc(
      "enqueue_curation_job",
      {
        p_operation: "enrich",
        p_params: { target: "submissions", submissionIds: [submissionId] },
        p_dry_run: false,
        p_started_by: "e2e-submission-lifecycle",
        p_trigger: "admin",
        p_parent_job_id: null,
        p_attempt: 1,
        p_scheduled_for: null,
        p_run_after: "2099-01-01T00:00:00.000Z",
        p_dedupe_key: `e2e-submission-lifecycle:${randomUUID()}`,
        p_targets: [
          {
            target_type: "submission",
            target_id: submissionId,
            brand_name: brandName,
            brand_slug: null,
          },
        ],
      },
    );
    if (enqueueError || !queuedJobId) {
      throw new Error(
        `curation job seed failed: ${enqueueError?.message ?? "missing id"}`,
      );
    }
    jobId = queuedJobId;

    await adminPage.goto("/admin/submissions?stage=enriching");
    await expect(adminPage.getByText(brandName, { exact: true })).toBeVisible();
    await expectBrandCount(0);

    const { error: imageError } = await supabase
      .from("submission_images")
      .insert({
        submission_id: submissionId,
        storage_path: storagePath,
        url: heroUrl,
        source_url: heroUrl,
        source: "admin",
        status: "active",
        sort_order: 0,
      });
    if (imageError)
      throw new Error(`submission image seed failed: ${imageError.message}`);

    const { error: enrichmentError } = await supabase
      .from("brand_submissions")
      .update({
        enriched_data: {
          description: "完整的品牌資料抓取結果。",
          hero_image_url: heroUrl,
          product_type: "accessories",
        },
      })
      .eq("id", submissionId);
    if (enrichmentError)
      throw new Error(`enrichment seed failed: ${enrichmentError.message}`);

    const completedAt = new Date().toISOString();
    const { error: targetError } = await supabase
      .from("curation_job_targets")
      .update({ status: "succeeded", completed_at: completedAt })
      .eq("job_id", jobId)
      .eq("target_id", submissionId);
    if (targetError)
      throw new Error(`target completion failed: ${targetError.message}`);

    const { error: jobError } = await supabase
      .from("curation_jobs")
      .update({
        status: "completed",
        completed_at: completedAt,
        succeeded_count: 1,
      })
      .eq("id", jobId);
    if (jobError) throw new Error(`job completion failed: ${jobError.message}`);

    await adminPage.goto("/admin/submissions?stage=ready");
    const readyRow = adminPage
      .locator("tbody tr")
      .filter({ hasText: brandName });
    await expect(readyRow).toBeVisible();
    await expectBrandCount(0);

    await readyRow.getByRole("checkbox").click();
    adminPage.once("dialog", (dialog) => dialog.accept());
    await adminPage.getByRole("button", { name: "核准", exact: true }).click();

    await expect(async () => {
      const { data: submission, error } = await supabase
        .from("brand_submissions")
        .select("brand_id, status")
        .eq("id", submissionId)
        .single();
      expect(error).toBeNull();
      expect(submission?.status).toBe("approved");
      expect(submission?.brand_id).toBeTruthy();
      approvedBrandId = submission?.brand_id;
    }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 5_000] });

    const { data: brand, error: brandError } = await supabase
      .from("brands")
      .select("id, status")
      .eq("id", approvedBrandId!)
      .single();
    expect(brandError).toBeNull();
    expect(brand?.status).toBe("approved");

    const [{ count: stagedCount }, { data: promotedImages }] =
      await Promise.all([
        supabase
          .from("submission_images")
          .select("id", { count: "exact", head: true })
          .eq("submission_id", submissionId),
        supabase
          .from("brand_images")
          .select("url")
          .eq("brand_id", approvedBrandId!),
      ]);
    expect(stagedCount).toBe(0);
    expect(promotedImages).toEqual(expect.arrayContaining([{ url: heroUrl }]));
  });

  async function expectBrandCount(expected: number) {
    const { count, error } = await supabase
      .from("brands")
      .select("id", { count: "exact", head: true })
      .eq("name", brandName);
    expect(error).toBeNull();
    expect(count).toBe(expected);
  }
});
