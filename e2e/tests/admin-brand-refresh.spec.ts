import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe("Scheduled brand refresh review", () => {
  let supabase: AnySupabaseClient;
  let brandId: string;
  let brandName: string;
  let brandSlug: string;
  let sourceSubmissionId: string;
  let refreshSubmissionId: string | undefined;
  let jobId: string | undefined;
  let adminUserId: string;

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

  test.beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    brandId = randomUUID();
    sourceSubmissionId = randomUUID();
    brandName = `[E2E-TEST] Brand refresh ${suffix}`;
    brandSlug = `e2e-brand-refresh-${suffix}`;

    const { data: users, error: usersError } =
      await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1_000,
      });
    if (usersError) throw usersError;
    const admin = users.users.find(
      (user) => user.email === process.env.E2E_ADMIN_EMAIL,
    );
    if (!admin) throw new Error("E2E admin user not found");
    adminUserId = admin.id;

    const heroUrl = `https://cdn.example.com/${brandId}/hero.webp`;
    const detailUrl = `https://cdn.example.com/${brandId}/detail.webp`;
    const { error: brandError } = await supabase.from("brands").insert({
      id: brandId,
      name: brandName,
      slug: brandSlug,
      status: "approved",
      description: "更新前的完整品牌介紹",
      city: "台南",
      hero_image_url: heroUrl,
      product_type: "crafts",
      product_tags: ["木工"],
      price_range: 2,
      purchase_website: "https://refresh-e2e.example.com",
      updated_at: new Date().toISOString(),
    });
    if (brandError) throw brandError;

    const { error: imageError } = await supabase.from("brand_images").insert([
      {
        brand_id: brandId,
        url: heroUrl,
        source_url: heroUrl,
        source: "owner",
        status: "active",
        sort_order: 0,
      },
      {
        brand_id: brandId,
        url: detailUrl,
        source_url: detailUrl,
        source: "legacy",
        status: "active",
        sort_order: 1,
      },
    ]);
    if (imageError) throw imageError;

    const { error: stateError } = await supabase
      .from("brand_field_state")
      .insert([
        { brand_id: brandId, field: "description", source: "enriched" },
        { brand_id: brandId, field: "city", source: "owner" },
      ]);
    if (stateError) throw stateError;

    const { error: submissionError } = await supabase
      .from("brand_submissions")
      .insert({
        id: sourceSubmissionId,
        brand_id: brandId,
        brand_name: brandName,
        submitter_email: `e2e-refresh-${suffix}@example.com`,
        status: "approved",
        intent: "recommend",
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminUserId,
      });
    if (submissionError) throw submissionError;
  });

  test.afterAll(async () => {
    if (!supabase) return;
    if (jobId) await supabase.from("curation_jobs").delete().eq("id", jobId);
    if (refreshSubmissionId) {
      await supabase
        .from("brand_submissions")
        .delete()
        .eq("id", refreshSubmissionId);
    }
    if (sourceSubmissionId) {
      await supabase
        .from("brand_submissions")
        .delete()
        .eq("id", sourceSubmissionId);
    }
    if (brandId) await supabase.from("brands").delete().eq("id", brandId);
  });

  test("requests, stages, and applies a refresh to the existing brand", async ({
    adminPage,
  }) => {
    test.setTimeout(120_000);

    await adminPage.goto("/admin/brands");
    const brandRow = adminPage
      .locator("tbody tr")
      .filter({ hasText: brandName });
    await brandRow
      .getByRole("button", { name: `Open brand actions for ${brandName}` })
      .click();
    await adminPage
      .getByRole("menuitem", { name: "Request re-enrichment" })
      .click();
    await adminPage
      .getByRole("button", { name: "Request re-enrichment", exact: true })
      .click();
    await expect(
      adminPage.getByText("Re-enrichment requested for the next scheduled run"),
    ).toBeVisible();

    await expect(async () => {
      const { data, error } = await supabase
        .from("brand_submissions")
        .select("id")
        .eq("brand_id", brandId)
        .eq("intent", "refresh")
        .eq("status", "pending")
        .single();
      expect(error).toBeNull();
      refreshSubmissionId = data?.id;
      expect(refreshSubmissionId).toBeTruthy();
    }).toPass({ timeout: 15_000 });

    await adminPage.goto("/admin/submissions?stage=needs_data");
    const needsDataRow = adminPage
      .locator("tbody tr")
      .filter({ hasText: brandName });
    await expect(
      needsDataRow.getByText("Refresh", { exact: true }),
    ).toBeVisible();

    const { data: queuedJobId, error: enqueueError } = await supabase.rpc(
      "enqueue_curation_job",
      {
        p_operation: "enrich",
        p_params: { target: "submissions" },
        p_dry_run: false,
        p_started_by: "railway-cron",
        p_trigger: "cron",
        p_parent_job_id: null,
        p_attempt: 1,
        p_scheduled_for: new Date().toISOString(),
        p_run_after: "2099-01-01T00:00:00.000Z",
        p_dedupe_key: `e2e-brand-refresh:${randomUUID()}`,
        p_targets: [
          {
            target_type: "submission",
            target_id: refreshSubmissionId,
            brand_name: brandName,
            brand_slug: null,
          },
        ],
      },
    );
    if (enqueueError || !queuedJobId)
      throw enqueueError ?? new Error("missing job id");
    jobId = queuedJobId;

    await adminPage.goto("/admin/submissions?stage=enriching");
    await expect(adminPage.getByText(brandName, { exact: true })).toBeVisible();

    const heroSubmissionUrl = `https://cdn.example.com/${brandId}/hero-candidate.webp`;
    const candidateUrl = `https://cdn.example.com/${brandId}/candidate.webp`;
    const { error: candidateError } = await supabase
      .from("submission_images")
      .insert([
        {
          submission_id: refreshSubmissionId,
          url: heroSubmissionUrl,
          source_url: heroSubmissionUrl,
          source: "google_image",
          status: "active",
          sort_order: 0,
        },
        {
          submission_id: refreshSubmissionId,
          url: candidateUrl,
          source_url: candidateUrl,
          source: "google_image",
          status: "active",
          sort_order: 2,
        },
      ]);
    if (candidateError) throw candidateError;
    const { error: enrichmentError } = await supabase
      .from("brand_submissions")
      .update({
        enriched_data: {
          description: "排程更新後的品牌介紹",
          product_type: "crafts",
          product_tags: ["木工"],
          price_range: 2,
          purchase_website: "https://refresh-e2e.example.com",
          hero_image_url: heroSubmissionUrl,
        },
      })
      .eq("id", refreshSubmissionId);
    if (enrichmentError) throw enrichmentError;
    const completedAt = new Date().toISOString();
    await supabase
      .from("curation_job_targets")
      .update({ status: "succeeded", completed_at: completedAt })
      .eq("job_id", jobId);
    await supabase
      .from("curation_jobs")
      .update({
        status: "completed",
        completed_at: completedAt,
        succeeded_count: 1,
      })
      .eq("id", jobId);

    await adminPage.goto("/admin/submissions?stage=ready");
    const readyRow = adminPage
      .locator("tbody tr")
      .filter({ hasText: brandName });
    await expect(readyRow.getByText("Refresh", { exact: true })).toBeVisible();
    await readyRow.getByRole("button", { name: "Apply refresh" }).click();

    await expect(async () => {
      const [{ data: brand }, { data: source }, { data: refresh }, { count }] =
        await Promise.all([
          supabase
            .from("brands")
            .select("description, city, status")
            .eq("id", brandId)
            .single(),
          supabase
            .from("brand_submissions")
            .select("status, reviewed_at")
            .eq("id", sourceSubmissionId)
            .single(),
          supabase
            .from("brand_submissions")
            .select("status")
            .eq("id", refreshSubmissionId)
            .single(),
          supabase
            .from("brands")
            .select("id", { count: "exact", head: true })
            .eq("slug", brandSlug),
        ]);
      expect(brand).toEqual({
        description: "排程更新後的品牌介紹",
        city: "台南",
        status: "approved",
      });
      expect(source?.status).toBe("approved");
      expect(source?.reviewed_at).toBeTruthy();
      expect(refresh?.status).toBe("approved");
      expect(count).toBe(1);
    }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 5_000] });

    const { data: images } = await supabase
      .from("brand_images")
      .select("url")
      .eq("brand_id", brandId)
      .eq("status", "active");
    expect(images).toEqual(expect.arrayContaining([{ url: candidateUrl }]));
  });
});
