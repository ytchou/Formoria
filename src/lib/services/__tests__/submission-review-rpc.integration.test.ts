import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { approveSubmission, saveSubmissionReview } from "../submissions";
import { describeWithDb } from "@/test/setup";

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : null;

describeWithDb("trusted submission review RPCs", () => {
  const submissionIds: string[] = [];
  const brandIds: string[] = [];
  const jobIds: string[] = [];
  const reviewerId = "00000000-0000-4000-8000-000000000001";

  afterEach(async () => {
    if (submissionIds.length > 0) {
      await supabase!.from("brand_submissions").delete().in("id", submissionIds);
      submissionIds.length = 0;
    }
    if (brandIds.length > 0) {
      await supabase!.from("brands").delete().in("id", brandIds);
      brandIds.length = 0;
    }
    if (jobIds.length > 0) {
      await supabase!.from("curation_jobs").delete().in("id", jobIds);
      jobIds.length = 0;
    }
  });

  it("atomically saves synchronized review fields and image state", async () => {
    const submissionId = await seedSubmission("save");
    const images = await seedImages(submissionId);
    await seedSuccessfulTarget(submissionId, "save");

    await saveSubmissionReview(submissionId, completeReviewInput(images));

    const { data: submission } = await supabase!
      .from("brand_submissions")
      .select(
        "brand_name, description, website_url, hero_image_url, purchase_website, suggested_tags, enriched_data",
      )
      .eq("id", submissionId)
      .single();
    expect(submission).toMatchObject({
      brand_name: "Trusted Save Brand",
      description: "完整中文介紹",
      website_url: "https://trusted.example.com",
      purchase_website: "https://trusted.example.com",
      hero_image_url: images.hero.url,
      suggested_tags: { values: ["木工"], productType: "crafts" },
      enriched_data: expect.objectContaining({
        description: "完整中文介紹",
        product_type: "crafts",
        product_tags: ["木工"],
        price_range: 2,
      }),
    });

    const { data: savedImages } = await supabase!
      .from("submission_images")
      .select("id, status, sort_order")
      .eq("submission_id", submissionId)
      .order("sort_order");
    expect(savedImages).toEqual(
      expect.arrayContaining([
        { id: images.hero.id, status: "active", sort_order: 0 },
        { id: images.detail.id, status: "active", sort_order: 1 },
        { id: images.removed.id, status: "rejected", sort_order: 2 },
      ]),
    );
  });

  it("rejects incomplete approval and promotes active images only", async () => {
    const incompleteId = await seedSubmission("incomplete");
    await seedSuccessfulTarget(incompleteId, "incomplete");
    await expect(
      approveSubmission(supabase!, incompleteId, reviewerId),
    ).rejects.toThrow("publishable core");

    const submissionId = await seedSubmission("approval");
    const images = await seedImages(submissionId);
    await seedSuccessfulTarget(submissionId, "approval");
    await saveSubmissionReview(submissionId, completeReviewInput(images));

    const result = await approveSubmission(supabase!, submissionId, reviewerId);
    brandIds.push(result.brandId);

    const { data: promoted } = await supabase!
      .from("brand_images")
      .select("url, status, sort_order")
      .eq("brand_id", result.brandId)
      .order("sort_order");
    expect(promoted).toEqual([
      { url: images.hero.url, status: "active", sort_order: 0 },
      { url: images.detail.url, status: "active", sort_order: 1 },
    ]);

    const { data: unpromoted } = await supabase!
      .from("submission_images")
      .select("url, status")
      .eq("submission_id", submissionId);
    expect(unpromoted).toEqual([
      { url: images.removed.url, status: "rejected" },
    ]);
  });

  async function seedSubmission(suffix: string): Promise<string> {
    const id = randomUUID();
    const { error } = await supabase!.from("brand_submissions").insert({
      id,
      brand_name: `Trusted ${suffix} Brand`,
      submitter_email: `${suffix}@example.com`,
      description: "原始介紹",
      website_url: "https://original.example.com",
      status: "pending",
    });
    expect(error).toBeNull();
    submissionIds.push(id);
    return id;
  }

  async function seedSuccessfulTarget(
    submissionId: string,
    suffix: string,
  ): Promise<void> {
    const { data: jobId, error } = await supabase!.rpc("enqueue_curation_job", {
      p_operation: "enrich",
      p_params: { target: "submissions", submissionIds: [submissionId] },
      p_dry_run: false,
      p_started_by: "trusted-review-test",
      p_trigger: "admin",
      p_parent_job_id: null,
      p_attempt: 1,
      p_scheduled_for: null,
      p_run_after: null,
      p_dedupe_key: `trusted-review:${suffix}:${randomUUID()}`,
      p_targets: [
        {
          target_type: "submission",
          target_id: submissionId,
          brand_name: `Trusted ${suffix} Brand`,
          brand_slug: null,
        },
      ],
    });
    expect(error).toBeNull();
    expect(jobId).toBeTruthy();
    jobIds.push(jobId!);

    const completedAt = new Date().toISOString();
    await supabase!
      .from("curation_job_targets")
      .update({ status: "succeeded", completed_at: completedAt })
      .eq("job_id", jobId!);
    await supabase!
      .from("curation_jobs")
      .update({ status: "completed", completed_at: completedAt })
      .eq("id", jobId!);
  }

  async function seedImages(submissionId: string) {
    const hero = {
      id: randomUUID(),
      url: `https://cdn.example.com/${submissionId}/hero.webp`,
    };
    const detail = {
      id: randomUUID(),
      url: `https://cdn.example.com/${submissionId}/detail.webp`,
    };
    const removed = {
      id: randomUUID(),
      url: `https://cdn.example.com/${submissionId}/removed.webp`,
    };
    const { error } = await supabase!.from("submission_images").insert([
      {
        ...hero,
        submission_id: submissionId,
        source: "admin",
        status: "active",
        sort_order: 0,
      },
      {
        ...detail,
        submission_id: submissionId,
        source: "admin",
        status: "draft",
        sort_order: 1,
      },
      {
        ...removed,
        submission_id: submissionId,
        source: "admin",
        status: "active",
        sort_order: 2,
      },
    ]);
    expect(error).toBeNull();
    return { hero, detail, removed };
  }

  function completeReviewInput(images: Awaited<ReturnType<typeof seedImages>>) {
    return {
      name: "Trusted Save Brand",
      description: "完整中文介紹",
      descriptionEn: "Complete English description",
      blurb: "品牌摘要",
      blurbEn: "Brand summary",
      city: "台中",
      categoryAttributes: null,
      reputationSummary: null,
      retailLocations: null,
      mitEvidence: null,
      siteContent: null,
      foundingYear: 2018,
      heroImageUrl: images.hero.url,
      productType: "crafts",
      priceRange: 2,
      productTags: ["木工"],
      productTagsEn: ["Woodwork"],
      websiteUrl: "https://trusted.example.com",
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: "https://trusted.example.com",
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [],
      images: [
        { id: images.hero.id, isHero: true, sortOrder: 0 },
        { id: images.detail.id, isHero: false, sortOrder: 1 },
      ],
    };
  }
});
