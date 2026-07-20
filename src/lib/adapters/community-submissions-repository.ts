import type {
  CommunitySubmissionRepository,
  ExistingCommunitySubmissionRecords,
} from "@/lib/services/community-submissions";
import { createServiceClient } from "@/lib/supabase/server";

const PAGE_SIZE = 1_000;

type CatalogRow = { name: string; purchase_website: string | null };
type SubmissionRow = {
  brand_name: string;
  website_url: string | null;
  purchase_website: string | null;
  status: string;
};

async function loadAll<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: { message?: string } | null;
    count: number | null;
  }>,
): Promise<T[]> {
  const first = await fetchPage(0, PAGE_SIZE - 1);
  if (first.error)
    throw new Error(first.error.message ?? "Duplicate lookup failed");
  const total = first.count ?? first.data?.length ?? 0;
  const remaining = await Promise.all(
    Array.from(
      { length: Math.max(0, Math.ceil(total / PAGE_SIZE) - 1) },
      (_, index) =>
        fetchPage((index + 1) * PAGE_SIZE, (index + 2) * PAGE_SIZE - 1),
    ),
  );
  for (const page of remaining) {
    if (page.error)
      throw new Error(page.error.message ?? "Duplicate lookup failed");
  }
  return [first, ...remaining].flatMap((page) => page.data ?? []);
}

export const communitySubmissionsRepository: CommunitySubmissionRepository = {
  async loadExistingRecords(
    names,
  ): Promise<ExistingCommunitySubmissionRecords> {
    const supabase = createServiceClient();
    const [catalog, submissions, similarResult] = await Promise.all([
      loadAll<CatalogRow>((from, to) =>
        supabase
          .from("brands")
          .select("name, purchase_website", { count: "exact" })
          .range(from, to),
      ),
      loadAll<SubmissionRow>((from, to) =>
        supabase
          .from("brand_submissions")
          .select("brand_name, website_url, purchase_website, status", {
            count: "exact",
          })
          .in("status", ["pending", "approved"])
          .range(from, to),
      ),
      names.length === 0
        ? Promise.resolve({ data: [], error: null })
        : supabase.rpc("find_similar_brands", {
            p_names: names,
            p_threshold: 0.3,
          }),
    ]);

    if (similarResult.error) {
      throw new Error(
        similarResult.error.message ?? "Similarity lookup failed",
      );
    }
    return {
      catalog: catalog.map((row) => ({
        name: row.name,
        website: row.purchase_website,
      })),
      submissions: submissions.flatMap((row) =>
        [...new Set([row.purchase_website, row.website_url])].map(
          (website) => ({
            name: row.brand_name,
            website,
            status: row.status as "pending" | "approved",
          }),
        ),
      ),
      similar: (similarResult.data ?? []).map(
        (row: {
          input_name: string;
          brand_name: string;
          brand_slug: string;
          similarity_score: number;
        }) => ({
          inputName: row.input_name,
          brandName: row.brand_name,
          brandSlug: row.brand_slug,
          score: row.similarity_score,
        }),
      ),
    };
  },
};
