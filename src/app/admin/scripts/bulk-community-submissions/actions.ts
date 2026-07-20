"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { communitySubmissionsRepository } from "@/lib/adapters/community-submissions-repository";
import { requireAdminAction } from "@/lib/auth/require-admin";
import {
  executeCommunitySubmissions,
  MAX_COMMUNITY_SUBMISSIONS,
  parseCommunitySubmissionsCsv,
  previewCommunitySubmissions,
  type CommunitySubmissionDraft,
  type CommunitySubmissionPreview,
  type CommunitySubmissionResult,
} from "@/lib/services/community-submissions";
import { submitBrandForReview } from "@/lib/services/submission-pipeline";
import { buildGuestSubmissionEmail } from "@/lib/services/submissions";

const draftSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(10_000),
  website: z.string().max(10_000),
});
const draftsSchema = z
  .array(draftSchema)
  .max(MAX_COMMUNITY_SUBMISSIONS)
  .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length);

type RowsResult<T> = { rows: T[] } | { error: string };

export async function loadCommunitySubmissionsCsvAction(
  input: unknown,
): Promise<RowsResult<CommunitySubmissionDraft>> {
  const auth = await requireAdminAction();
  if ("error" in auth) return { error: auth.error };
  const parsed = z.string().max(1_000_000).safeParse(input);
  if (!parsed.success) return { error: "Invalid CSV file" };

  try {
    return { rows: parseCommunitySubmissionsCsv(parsed.data) };
  } catch (error) {
    return { error: errorMessage(error, "Unable to parse CSV") };
  }
}

export async function previewCommunitySubmissionsAction(
  input: unknown,
): Promise<RowsResult<CommunitySubmissionPreview>> {
  const auth = await requireAdminAction();
  if ("error" in auth) return { error: auth.error };
  const parsed = draftsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid community submission rows" };

  try {
    return {
      rows: await previewCommunitySubmissions(parsed.data, {
        repository: communitySubmissionsRepository,
      }),
    };
  } catch (error) {
    return { error: errorMessage(error, "Unable to preview submissions") };
  }
}

export async function executeCommunitySubmissionsAction(
  input: unknown,
): Promise<{ results: CommunitySubmissionResult[] } | { error: string }> {
  const auth = await requireAdminAction();
  if ("error" in auth) return { error: auth.error };
  const parsed = draftsSchema.safeParse(input);
  if (!parsed.success || parsed.data.length === 0) {
    return { error: "Invalid community submission rows" };
  }

  try {
    const results = await executeCommunitySubmissions(parsed.data, {
      repository: communitySubmissionsRepository,
      submit: (params) =>
        submitBrandForReview(params, { useServiceRole: true }),
      buildGuestEmail: buildGuestSubmissionEmail,
    });
    if (results.some((result) => result.status === "created")) {
      revalidatePath("/admin/submissions");
      revalidatePath("/admin");
    }
    return { results };
  } catch (error) {
    return { error: errorMessage(error, "Unable to import submissions") };
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
