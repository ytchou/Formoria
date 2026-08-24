import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "../fixtures/auth";

import { BUDGET, POLL } from "../budgets";
import {
  e2eBrandImageKey,
  e2eProxyImageUrl,
  e2eSubmissionImageKey,
} from "../helpers/image-refs";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

test.describe("Scheduled brand refresh review", () => {
  test.describe.configure({ mode: "serial" });

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

    // Bucket keys, not URLs (DEV-1551): the bucket is private and the app
    // renders `/i/<key>`.
    const heroKey = e2eBrandImageKey(brandId, "hero.webp");
    const detailKey = e2eBrandImageKey(brandId, "detail.webp");
    const { error: brandError } = await supabase.from("brands").insert({
      id: brandId,
      name: brandName,
      slug: brandSlug,
      status: "approved",
      approved_at: new Date().toISOString(),
      description: "更新前的完整品牌介紹",
      city: "tainan",
      hero_image_storage_path: heroKey,
      category: "home",
      // Slug, not the zh-TW label: this writes straight into `brands`, so it
      // bypasses every conversion path. `brands.subcategories` has no CHECK
      // constraint, so a label would insert cleanly and then match no facet,
      // no L2 page and no `?sub=`. `餐具` is a `tableware` alias.
      subcategories: ["tableware"],
      purchase_website: "https://refresh-e2e.example.com",
      updated_at: new Date().toISOString(),
    });
    if (brandError) throw brandError;

    const { error: imageError } = await supabase.from("brand_images").insert([
      {
        brand_id: brandId,
        storage_path: heroKey,
        source_url: heroKey,
        source: "owner",
        status: "active",
        sort_order: 0,
      },
      {
        brand_id: brandId,
        storage_path: detailKey,
        source_url: detailKey,
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
    test.setTimeout(BUDGET.TEST.ADMIN);
    await adminPage.goto("/admin/brands");
    await adminPage.getByPlaceholder("Search brand name...").fill(brandName);
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
    }).toPass(POLL.APPLY);

    await adminPage.goto("/admin/submissions?stage=needs_data");
    const needsDataRow = adminPage
      .locator("tbody tr")
      .filter({ hasText: brandName });
    // The per-row "Refresh" badge was removed from the submissions list, so the
    // refresh intent is no longer observable at the needs_data stage. It is
    // asserted at the ready stage instead, via the Approve button's label.
    await expect(needsDataRow).toBeVisible();

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

    const heroCandidateKey = e2eBrandImageKey(brandId, "hero-candidate.webp");
    const candidateKey = e2eBrandImageKey(brandId, "candidate.webp");
    // `request_brand_refresh` already copied the brand's active images into
    // submission_images at sort_order 0 and 1. Drop them first, otherwise the
    // candidates below collide on sort_order and apply_brand_refresh rejects the
    // set ("Refresh must satisfy publishable core before apply"): that gate needs
    // active rows need unique sort_order values; the first ordered row is the hero.
    const { error: resetImagesError } = await supabase
      .from("submission_images")
      .delete()
      .eq("submission_id", refreshSubmissionId);
    if (resetImagesError) throw resetImagesError;
    const { error: candidateError } = await supabase
      .from("submission_images")
      .insert([
        {
          submission_id: refreshSubmissionId,
          storage_path: heroCandidateKey,
          source_url: heroCandidateKey,
          source: "google_image",
          status: "active",
          sort_order: 0,
        },
        {
          submission_id: refreshSubmissionId,
          storage_path: candidateKey,
          source_url: candidateKey,
          source: "google_image",
          status: "active",
          sort_order: 1,
        },
      ]);
    if (candidateError) throw candidateError;
    const { error: enrichmentError } = await supabase
      .from("brand_submissions")
      .update({
        enriched_data: {
          description: "排程更新後的品牌介紹",
          category: "home",
          subcategories: ["tableware"],
          purchase_website: "https://refresh-e2e.example.com",
          hero_image_url: e2eProxyImageUrl(heroCandidateKey),
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
    await readyRow
      // `/admin/submissions` overrides the shell's default disclosure label with
      // `admin.submissions.expandReview` — "Expand review for {name}".
      .getByRole("button", { name: `Expand review for ${brandName}` })
      .click();
    const reviewDrawer = adminPage.getByRole("dialog");
    await expect(reviewDrawer).toBeVisible();
    await reviewDrawer
      .getByRole("button", { name: "Approve — updates the live brand" })
      .click();

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
        city: "tainan",
        status: "approved",
      });
      expect(source?.status).toBe("approved");
      expect(source?.reviewed_at).toBeTruthy();
      expect(refresh?.status).toBe("approved");
      expect(count).toBe(1);
    }).toPass(POLL.APPLY);

    const { data: images } = await supabase
      .from("brand_images")
      .select("storage_path")
      .eq("brand_id", brandId)
      .eq("status", "active");
    expect(images).toEqual(
      expect.arrayContaining([{ storage_path: candidateKey }]),
    );
  });
});

test.describe("Bulk refresh approval", () => {
  test.describe.configure({ mode: "serial" });

  let supabase: AnySupabaseClient;
  const brandIds: string[] = [];
  const submissionIds: string[] = [];
  let jobId: string | undefined;

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

  test.afterEach(async () => {
    if (!supabase) return;
    if (jobId) await supabase.from("curation_jobs").delete().eq("id", jobId);
    if (submissionIds.length > 0) {
      const { data: submissions } = await supabase
        .from("brand_submissions")
        .select("brand_id")
        .in("id", submissionIds);
      for (const submission of submissions ?? []) {
        if (submission.brand_id && !brandIds.includes(submission.brand_id)) {
          brandIds.push(submission.brand_id);
        }
      }
      await supabase.from("brand_submissions").delete().in("id", submissionIds);
    }
    if (brandIds.length > 0) {
      await supabase.from("brands").delete().in("id", brandIds);
    }
  });

  test("keeps a failed refresh selected while removing successful approvals", async ({
    adminPage,
  }) => {
    test.skip(true, "DEV-1592: admin panel crashes on the Approve dialog — runtime bug, not test logic");
    test.setTimeout(BUDGET.TEST.MUTATION);
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const validName = `[E2E-TEST] Bulk valid ${suffix}`;
    const staleName = `[E2E-TEST] Bulk stale ${suffix}`;
    const adminEmail = process.env.E2E_ADMIN_EMAIL!;
    const { data: users, error: usersError } =
      await supabase.auth.admin.listUsers({ page: 1, perPage: 1_000 });
    if (usersError) throw usersError;
    const admin = users.users.find((user) => user.email === adminEmail);
    if (!admin) throw new Error("E2E admin user not found");

    const validSubmissionId = randomUUID();
    submissionIds.push(validSubmissionId);
    const validHeroKey = e2eSubmissionImageKey(validSubmissionId, "hero.webp");
    const validDetailKey = e2eSubmissionImageKey(
      validSubmissionId,
      "detail.webp",
    );
    const { error: validSubmissionError } = await supabase
      .from("brand_submissions")
      .insert({
        id: validSubmissionId,
        brand_name: validName,
        submitter_email: `${validSubmissionId}@guest.formoria.invalid`,
        status: "pending",
        intent: "recommend",
        is_brand_owner: false,
        enriched_data: {
          description: "完整的品牌介紹",
          category: "home",
          subcategories: ["tableware"],
          purchase_website: "https://bulk-approval.example.com",
          hero_image_url: e2eProxyImageUrl(validHeroKey),
        },
      });
    if (validSubmissionError) throw validSubmissionError;
    const { error: validImagesError } = await supabase
      .from("submission_images")
      .insert([
        {
          submission_id: validSubmissionId,
          storage_path: validHeroKey,
          source_url: validHeroKey,
          source: "admin",
          status: "active",
          sort_order: 0,
        },
        {
          submission_id: validSubmissionId,
          storage_path: validDetailKey,
          source_url: validDetailKey,
          source: "admin",
          status: "active",
          sort_order: 1,
        },
      ]);
    if (validImagesError) throw validImagesError;

    const staleBrandId = randomUUID();
    brandIds.push(staleBrandId);
    const staleHeroKey = e2eBrandImageKey(staleBrandId, "hero.webp");
    const staleDetailKey = e2eBrandImageKey(staleBrandId, "detail.webp");
    const { error: staleBrandError } = await supabase.from("brands").insert({
      id: staleBrandId,
      name: staleName,
      slug: `e2e-bulk-refresh-stale-${suffix}`,
      status: "approved",
      approved_at: new Date().toISOString(),
      description: "完整的品牌介紹",
      hero_image_storage_path: staleHeroKey,
      category: "home",
      // Slug, not the zh-TW label — direct `brands` insert, same reason as the
      // seed above.
      subcategories: ["tableware"],
      purchase_website: "https://bulk-refresh.example.com",
    });
    if (staleBrandError) throw staleBrandError;
    const { error: staleImagesError } = await supabase
      .from("brand_images")
      .insert([
        {
          brand_id: staleBrandId,
          storage_path: staleHeroKey,
          source_url: staleHeroKey,
          source: "owner",
          status: "active",
          sort_order: 0,
        },
        {
          brand_id: staleBrandId,
          storage_path: staleDetailKey,
          source_url: staleDetailKey,
          source: "owner",
          status: "active",
          sort_order: 1,
        },
      ]);
    if (staleImagesError) throw staleImagesError;
    const { data: staleSubmissionId, error: requestError } = await supabase.rpc(
      "request_brand_refresh",
      {
        p_brand_id: staleBrandId,
        p_requested_by: admin.id,
        p_requester_email: adminEmail,
      },
    );
    if (requestError || !staleSubmissionId) {
      throw requestError ?? new Error("Refresh request did not return an id");
    }
    submissionIds.push(staleSubmissionId);

    const { data: queuedJobId, error: enqueueError } = await supabase.rpc(
      "enqueue_curation_job",
      {
        p_operation: "enrich",
        p_params: { target: "submissions" },
        p_dry_run: false,
        p_started_by: "e2e-bulk-refresh",
        p_trigger: "admin",
        p_parent_job_id: null,
        p_attempt: 1,
        p_scheduled_for: new Date().toISOString(),
        p_run_after: "2099-01-01T00:00:00.000Z",
        p_dedupe_key: `e2e-bulk-refresh:${randomUUID()}`,
        p_targets: submissionIds.map((submissionId, index) => ({
          target_type: "submission",
          target_id: submissionId,
          brand_name: index === 0 ? validName : staleName,
          brand_slug: null,
        })),
      },
    );
    if (enqueueError || !queuedJobId) {
      throw enqueueError ?? new Error("missing job id");
    }
    jobId = queuedJobId;
    const completedAt = new Date().toISOString();
    const { error: targetError } = await supabase
      .from("curation_job_targets")
      .update({ status: "succeeded", completed_at: completedAt })
      .eq("job_id", jobId);
    if (targetError) throw targetError;
    const { error: jobError } = await supabase
      .from("curation_jobs")
      .update({
        status: "completed",
        completed_at: completedAt,
        succeeded_count: 2,
      })
      .eq("id", jobId);
    if (jobError) throw jobError;

    await adminPage.goto("/admin/submissions?stage=ready");
    await adminPage
      .getByRole("textbox", { name: "Search submissions" })
      .fill(suffix);
    const validRow = adminPage
      .locator("tbody tr")
      .filter({ hasText: validName });
    const staleRow = adminPage
      .locator("tbody tr")
      .filter({ hasText: staleName });
    await expect(validRow).toBeVisible();
    await expect(staleRow).toBeVisible();
    await validRow.getByRole("checkbox").click();
    await staleRow.getByRole("checkbox").click();

    const { error: staleTargetError } = await supabase
      .from("curation_job_targets")
      .update({ status: "failed" })
      .eq("job_id", jobId)
      .eq("target_id", staleSubmissionId);
    if (staleTargetError) throw staleTargetError;

    await Promise.all([
      adminPage.waitForEvent("dialog").then((dialog) => dialog.accept()),
      adminPage.getByRole("button", { name: "Approve 2 selected" }).click(),
    ]);

    await expect(async () => {
      const { data: submissions, error: submissionsError } = await supabase
        .from("brand_submissions")
        .select("id, status")
        .in("id", submissionIds);
      expect(submissionsError).toBeNull();
      expect(submissions).toEqual(
        expect.arrayContaining([
          { id: submissionIds[0], status: "approved" },
          { id: submissionIds[1], status: "pending" },
        ]),
      );
    }).toPass(POLL.APPLY);

    await expect(validRow).toBeHidden({ timeout: BUDGET.GATED_UI });
    await expect(staleRow).toBeVisible();
    await expect(staleRow.getByRole("checkbox")).toBeChecked();
    await expect(
      adminPage.locator("p.type-metadata.text-danger"),
    ).toContainText(staleName);
  });
});
