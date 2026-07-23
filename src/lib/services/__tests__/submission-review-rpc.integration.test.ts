import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
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
const untypedSupabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : null;

describeWithDb("trusted submission review RPCs", () => {
  const submissionIds: string[] = [];
  const brandIds: string[] = [];
  const jobIds: string[] = [];
  let reviewerId = "";

  beforeAll(async () => {
    const { data, error } = await supabase!.auth.admin.createUser({
      email: `refresh-reviewer-${randomUUID()}@example.com`,
      password: `Refresh-reviewer-${randomUUID()}`,
      email_confirm: true,
    });
    if (error || !data.user)
      throw error ?? new Error("Reviewer creation failed");
    reviewerId = data.user.id;
  });

  afterEach(async () => {
    if (submissionIds.length > 0) {
      await supabase!
        .from("brand_submissions")
        .delete()
        .in("id", submissionIds);
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

  afterAll(async () => {
    if (!reviewerId) return;
    await untypedSupabase!
      .from("admin_audit_log")
      .delete()
      .eq("admin_user_id", reviewerId);
    await supabase!.auth.admin.deleteUser(reviewerId);
  });

  it("atomically saves synchronized review fields and image state", async () => {
    const submissionId = await seedSubmission("save");
    const images = await seedImages(submissionId);
    await seedSuccessfulTarget(submissionId, "save");

    await saveSubmissionReview(submissionId, completeReviewInput(images));

    const { data: submission } = await supabase!
      .from("brand_submissions")
      .select(
        "brand_name, description, website_url, hero_image_url, purchase_website, suggested_tags, enriched_data, review_overrides",
      )
      .eq("id", submissionId)
      .single();
    expect(submission).toMatchObject({
      brand_name: "Trusted Save Brand",
      description: "原始介紹",
      website_url: "https://original.example.com",
      purchase_website: null,
      hero_image_url: null,
      suggested_tags: null,
      enriched_data: null,
      review_overrides: expect.objectContaining({
        description: "完整中文介紹",
        product_type: "crafts",
        product_tags: ["木工"],
        price_range: 2,
        purchase_website: "https://trusted.example.com",
        hero_image_url: images.hero.url,
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

    const { data: promoted } = await untypedSupabase!
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

  it("persists the owner MIT story on the approved brand", async () => {
    const submissionId = await seedSubmission("mit-story");
    const images = await seedImages(submissionId);
    const mitStory = "我們在台灣設計並製造每一件作品。";
    const { error: ownerDataError } = await supabase!
      .from("brand_submissions")
      .update({ owner_data: { mitStory } })
      .eq("id", submissionId);
    expect(ownerDataError).toBeNull();
    await seedSuccessfulTarget(submissionId, "mit-story");
    await saveSubmissionReview(submissionId, completeReviewInput(images));

    const result = await approveSubmission(supabase!, submissionId, reviewerId);
    brandIds.push(result.brandId);

    const { data: brand, error: brandError } = await supabase!
      .from("brands")
      .select("mit_story")
      .eq("id", result.brandId)
      .single();
    expect(brandError).toBeNull();
    expect(brand?.mit_story).toBe(mitStory);
  });

  it("records matching community suggested tags as submitted provenance", async () => {
    const submissionId = await seedSubmission("submitted-provenance");
    const images = await seedImages(submissionId);
    const { error: candidateError } = await supabase!
      .from("brand_submissions")
      .update({
        social_instagram: "https://instagram.com/community-submitted",
        suggested_tags: { values: ["木工"], productType: "crafts" },
        enriched_data: { product_tags: ["木工"], product_type: "crafts" },
      })
      .eq("id", submissionId);
    expect(candidateError).toBeNull();
    await seedSuccessfulTarget(submissionId, "submitted-provenance");
    await saveSubmissionReview(submissionId, completeReviewInput(images));

    const result = await approveSubmission(supabase!, submissionId, reviewerId);
    brandIds.push(result.brandId);
    const { data: states, error: stateError } = await supabase!
      .from("brand_field_state")
      .select("field, source")
      .eq("brand_id", result.brandId)
      .in("field", ["product_tags", "product_type", "social_instagram"]);
    expect(stateError).toBeNull();
    expect(
      Object.fromEntries(
        (states ?? []).map((state) => [state.field, state.source]),
      ),
    ).toEqual({
      product_tags: "submitted",
      product_type: "submitted",
      social_instagram: "admin",
    });
  });

  it("requests and applies a refresh to exactly one existing hidden brand", async () => {
    const brand = await seedRefreshBrand("apply", "hidden");
    const requestArgs = {
      p_brand_id: brand.id,
      p_requested_by: reviewerId,
      p_requester_email: "admin@formoria.com",
    };
    const requests = await Promise.all([
      supabase!.rpc("request_brand_refresh", requestArgs),
      supabase!.rpc("request_brand_refresh", requestArgs),
    ]);
    const successfulRequest = requests.find(
      (request) => request.error === null,
    );
    const duplicateRequest = requests.find((request) => request.error !== null);
    const submissionId = successfulRequest?.data;
    expect(requests.filter((request) => request.error === null)).toHaveLength(
      1,
    );
    expect(duplicateRequest?.error?.message).toContain("already pending");
    expect(submissionId).toBeTruthy();
    submissionIds.push(submissionId!);

    const { data: references } = await supabase!
      .from("submission_images")
      .select("origin_brand_image_id, storage_path")
      .eq("submission_id", submissionId!);
    expect(references).toHaveLength(2);
    expect(references?.every((image) => image.origin_brand_image_id)).toBe(
      true,
    );
    expect(references?.every((image) => image.storage_path === null)).toBe(
      true,
    );

    await supabase!
      .from("brand_submissions")
      .update({ enriched_data: { description: "排程更新後的品牌介紹" } })
      .eq("id", submissionId!);
    await seedSuccessfulTarget(submissionId!, "refresh-apply");

    const { error: applyError } = await supabase!.rpc("apply_brand_refresh", {
      p_submission_id: submissionId!,
      p_reviewer_id: reviewerId,
    });
    expect(applyError).toBeNull();

    const { data: refreshed } = await supabase!
      .from("brands")
      .select("id, description, status")
      .eq("id", brand.id)
      .single();
    expect(refreshed).toEqual({
      id: brand.id,
      description: "排程更新後的品牌介紹",
      status: "hidden",
    });
    const { count } = await supabase!
      .from("brands")
      .select("*", { count: "exact", head: true })
      .eq("slug", brand.slug);
    expect(count).toBe(1);
    const { data: state } = await supabase!
      .from("brand_field_state")
      .select("source")
      .eq("brand_id", brand.id)
      .eq("field", "description")
      .single();
    expect(state?.source).toBe("enriched");
  });

  it("continues to reject protected non-location enrichment", async () => {
    const brand = await seedRefreshBrand("protected-description", "approved");
    const { error: stateError } = await untypedSupabase!
      .from("brand_field_state")
      .update({ source: "owner", admin_locked: true, updated_by: reviewerId })
      .eq("brand_id", brand.id)
      .eq("field", "description");
    expect(stateError).toBeNull();
    const { data: submissionId, error: requestError } = await supabase!.rpc(
      "request_brand_refresh",
      {
        p_brand_id: brand.id,
        p_requested_by: reviewerId,
        p_requester_email: "admin@formoria.com",
      },
    );
    expect(requestError).toBeNull();
    submissionIds.push(submissionId!);
    await supabase!
      .from("brand_submissions")
      .update({ enriched_data: { description: "不應覆蓋的介紹" } })
      .eq("id", submissionId!);
    await seedSuccessfulTarget(submissionId!, "refresh-protected-description");

    const { error } = await supabase!.rpc("apply_brand_refresh", {
      p_submission_id: submissionId!,
      p_reviewer_id: reviewerId,
    });
    expect(error?.message).toContain("field protection changed");

    const { data: state } = await untypedSupabase!
      .from("brand_field_state")
      .select("source, admin_locked, updated_by")
      .eq("brand_id", brand.id)
      .eq("field", "description")
      .single();
    expect(state).toEqual({
      source: "owner",
      admin_locked: true,
      updated_by: reviewerId,
    });
  });

  it("retires an enrichment image, preserves the owner image, and promotes a candidate", async () => {
    const brand = await seedRefreshBrand("image-reconcile", "approved");
    const { data: submissionId, error: requestError } = await supabase!.rpc(
      "request_brand_refresh",
      {
        p_brand_id: brand.id,
        p_requested_by: reviewerId,
        p_requester_email: "admin@formoria.com",
      },
    );
    expect(requestError).toBeNull();
    submissionIds.push(submissionId!);
    const { data: references, error: referenceError } = await supabase!
      .from("submission_images")
      .select("id, url, source, origin_brand_image_id")
      .eq("submission_id", submissionId!);
    expect(referenceError).toBeNull();
    const ownerReference = references?.find(
      (image) => image.source === "owner",
    );
    const enrichmentReference = references?.find(
      (image) => image.source === "legacy",
    );
    expect(ownerReference).toBeDefined();
    expect(enrichmentReference).toBeDefined();

    const candidateId = randomUUID();
    const candidatePath = `submissions/${submissionId}/candidate.webp`;
    const candidateUrl = `https://cdn.example.com/${submissionId}/candidate.webp`;
    const { error: candidateError } = await supabase!
      .from("submission_images")
      .insert({
        id: candidateId,
        submission_id: submissionId!,
        storage_path: candidatePath,
        url: candidateUrl,
        source_url: `https://source.example.com/${submissionId}/candidate.webp`,
        source: "google_image",
        status: "draft",
        sort_order: 2,
      });
    expect(candidateError).toBeNull();
    await seedSuccessfulTarget(submissionId!, "refresh-image-reconcile");
    const { error: saveError } = await supabase!.rpc("save_submission_review", {
      p_submission_id: submissionId!,
      p_review_data: {},
      p_images: [
        { id: ownerReference!.id, is_hero: true, sort_order: 0 },
        { id: candidateId, is_hero: false, sort_order: 1 },
      ],
    });
    expect(saveError).toBeNull();

    const { data: retiredPaths, error: applyError } = await supabase!.rpc(
      "apply_brand_refresh",
      {
        p_submission_id: submissionId!,
        p_reviewer_id: reviewerId,
      },
    );
    expect(applyError).toBeNull();
    expect(retiredPaths).toContain(`brands/${brand.id}/detail.webp`);
    expect(retiredPaths).not.toContain(`brands/${brand.id}/hero.webp`);

    const { data: liveImages } = await untypedSupabase!
      .from("brand_images")
      .select("url, source, storage_path, sort_order")
      .eq("brand_id", brand.id)
      .order("sort_order");
    expect(liveImages).toEqual([
      expect.objectContaining({ source: "owner", sort_order: 0 }),
      expect.objectContaining({
        url: candidateUrl,
        storage_path: candidatePath,
        sort_order: 1,
      }),
    ]);
  });

  it("rejects a refresh without deleting referenced live image storage", async () => {
    const brand = await seedRefreshBrand("reject-cleanup", "approved");
    const { data: submissionId, error: requestError } = await supabase!.rpc(
      "request_brand_refresh",
      {
        p_brand_id: brand.id,
        p_requested_by: reviewerId,
        p_requester_email: "admin@formoria.com",
      },
    );
    expect(requestError).toBeNull();
    submissionIds.push(submissionId!);
    const candidatePath = `submissions/${submissionId}/rejected.webp`;
    const { error: candidateError } = await supabase!
      .from("submission_images")
      .insert({
        submission_id: submissionId!,
        storage_path: candidatePath,
        url: `https://cdn.example.com/${submissionId}/rejected.webp`,
        source_url: `https://source.example.com/${submissionId}/rejected.webp`,
        source: "google_image",
        status: "draft",
        sort_order: 2,
      });
    expect(candidateError).toBeNull();

    const { data: cleanupPaths, error: rejectError } = await supabase!.rpc(
      "reject_submission",
      {
        p_submission_id: submissionId!,
        p_reviewer_id: reviewerId,
        p_denial_reason: "admin_reject",
        p_reviewer_notes: "Replace with a newer snapshot",
      },
    );
    expect(rejectError).toBeNull();
    expect(cleanupPaths).toEqual([candidatePath]);
    const { data: liveImages } = await untypedSupabase!
      .from("brand_images")
      .select("storage_path")
      .eq("brand_id", brand.id)
      .order("sort_order");
    expect(liveImages?.map((image) => image.storage_path)).toEqual([
      `brands/${brand.id}/hero.webp`,
      `brands/${brand.id}/detail.webp`,
    ]);
  });

  it("blocks a stale refresh when the brand changes after its snapshot", async () => {
    const brand = await seedRefreshBrand("stale", "approved");
    const { data: submissionId, error: requestError } = await supabase!.rpc(
      "request_brand_refresh",
      {
        p_brand_id: brand.id,
        p_requested_by: reviewerId,
        p_requester_email: "admin@formoria.com",
      },
    );
    expect(requestError).toBeNull();
    submissionIds.push(submissionId!);
    await supabase!
      .from("brand_submissions")
      .update({ enriched_data: { description: "不應套用的介紹" } })
      .eq("id", submissionId!);
    await seedSuccessfulTarget(submissionId!, "refresh-stale");
    await supabase!.from("brands").update({ city: "台北" }).eq("id", brand.id);

    const { error } = await supabase!.rpc("apply_brand_refresh", {
      p_submission_id: submissionId!,
      p_reviewer_id: reviewerId,
    });
    expect(error?.message).toContain("Refresh is stale");

    const { data: submission } = await supabase!
      .from("brand_submissions")
      .select("status")
      .eq("id", submissionId!)
      .single();
    expect(submission?.status).toBe("pending");
  });

  it("blocks a stale refresh when referenced image metadata changes", async () => {
    const brand = await seedRefreshBrand("stale-image", "approved");
    const { data: submissionId, error: requestError } = await supabase!.rpc(
      "request_brand_refresh",
      {
        p_brand_id: brand.id,
        p_requested_by: reviewerId,
        p_requester_email: "admin@formoria.com",
      },
    );
    expect(requestError).toBeNull();
    submissionIds.push(submissionId!);
    await seedSuccessfulTarget(submissionId!, "refresh-stale-image");

    const { error: imageUpdateError } = await untypedSupabase!
      .from("brand_images")
      .update({ alt_zh: "品牌圖片已由其他管理員修改" })
      .eq("brand_id", brand.id)
      .eq("sort_order", 1);
    expect(imageUpdateError).toBeNull();

    const { error } = await supabase!.rpc("apply_brand_refresh", {
      p_submission_id: submissionId!,
      p_reviewer_id: reviewerId,
    });
    expect(error?.message).toContain("brand images changed");
  });

  it("enforces the seven-image limit even when review was never saved", async () => {
    const brand = await seedRefreshBrand("image-limit", "approved");
    const { data: submissionId, error: requestError } = await supabase!.rpc(
      "request_brand_refresh",
      {
        p_brand_id: brand.id,
        p_requested_by: reviewerId,
        p_requester_email: "admin@formoria.com",
      },
    );
    expect(requestError).toBeNull();
    submissionIds.push(submissionId!);
    await seedSuccessfulTarget(submissionId!, "refresh-image-limit");
    const { error: imageError } = await supabase!
      .from("submission_images")
      .insert(
        Array.from({ length: 6 }, (_, index) => ({
          submission_id: submissionId!,
          storage_path: `submissions/${submissionId}/candidate-${index}.webp`,
          url: `https://cdn.example.com/${submissionId}/candidate-${index}.webp`,
          source_url: `https://source.example.com/candidate-${index}.webp`,
          source: "google_image",
          status: "active",
          sort_order: index + 2,
        })),
      );
    expect(imageError).toBeNull();

    const { error } = await supabase!.rpc("apply_brand_refresh", {
      p_submission_id: submissionId!,
      p_reviewer_id: reviewerId,
    });
    expect(error?.message).toContain("publishable core");
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
      p_run_after: new Date().toISOString(),
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

  async function seedRefreshBrand(
    suffix: string,
    status: "approved" | "hidden",
  ): Promise<{ id: string; slug: string }> {
    const id = randomUUID();
    const slug = `refresh-${suffix}-${id.slice(0, 8)}`;
    const heroUrl = `https://cdn.example.com/${id}/hero.webp`;
    const detailUrl = `https://cdn.example.com/${id}/detail.webp`;
    const { error } = await supabase!.from("brands").insert({
      id,
      name: `Refresh ${suffix} Brand`,
      slug,
      status,
      description: "原本完整的品牌介紹",
      hero_image_url: heroUrl,
      product_type: "crafts",
      product_tags: ["木工"],
      price_range: 2,
      purchase_website: "https://refresh.example.com",
      updated_at: new Date().toISOString(),
    });
    expect(error).toBeNull();
    brandIds.push(id);
    const { error: stateError } = await supabase!
      .from("brand_field_state")
      .insert({
        brand_id: id,
        field: "description",
        source: "enriched",
      });
    expect(stateError).toBeNull();
    const { error: imageError } = await untypedSupabase!
      .from("brand_images")
      .insert([
        {
          brand_id: id,
          storage_path: `brands/${id}/hero.webp`,
          url: heroUrl,
          source_url: heroUrl,
          source: "owner",
          status: "active",
          sort_order: 0,
        },
        {
          brand_id: id,
          storage_path: `brands/${id}/detail.webp`,
          url: detailUrl,
          source_url: detailUrl,
          source: "legacy",
          status: "active",
          sort_order: 1,
        },
      ]);
    expect(imageError).toBeNull();
    return { id, slug };
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
      channels: [],
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
