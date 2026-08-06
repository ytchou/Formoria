import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import * as supabaseServer from "@/lib/supabase/server";
import { auditedCall } from "@/lib/audit";
import {
  buildReviewUpdate,
  type ReviewDecision,
  type ReviewAttribution,
} from "./review-status";

const SUSPICIOUS_TLDS = [".tk", ".ml", ".ga", ".cf", ".gq"];
const MAX_URLS_IN_TEXT = 3;
const MAX_EMOJI_COUNT = 10;
const MIN_CJK_DESCRIPTION_CHARS = 10;
const ENGLISH_SPAM_PHRASES = [
  "click here",
  "buy now",
  "free offer",
  "limited time",
  "act now",
];

export interface ContentViolation {
  field: string;
  rule: string;
  userMessage: string;
}

export interface ScanResult {
  violations: ContentViolation[];
}

type SupabaseServerModule = typeof supabaseServer & {
  createServerClient?: () => SupabaseClient<Database>;
};

type ModerationFlagInsert =
  Database["public"]["Tables"]["moderation_flags"]["Insert"];
type ModerationFlagUpdate =
  Database["public"]["Tables"]["moderation_flags"]["Update"];

const URL_REGEX = /https?:\/\/[^\s]+/gi;
const TAIWAN_PHONE_REGEX = /09\d{2}[-.]?\d{3}[-.]?\d{3}/;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const EMOJI_REGEX = /\p{Emoji_Presentation}/gu;
const CJK_REGEX = /[\u4E00-\u9FFF]/g;

function createViolation(
  field: string,
  rule: string,
  userMessage: string,
): ContentViolation {
  return {
    field,
    rule,
    userMessage,
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function extractUrls(value: string): string[] {
  return value.match(URL_REGEX) ?? [];
}

function createModerationClient(): SupabaseClient<Database> {
  const serverModule = supabaseServer as SupabaseServerModule;
  return (
    serverModule.createServerClient?.() ?? supabaseServer.createServiceClient()
  );
}

function checkSuspiciousTlds(
  fields: Record<string, string | undefined>,
): ContentViolation[] {
  const violations: ContentViolation[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    if (!value?.includes("http")) {
      continue;
    }

    for (const urlText of extractUrls(value)) {
      try {
        const hostname = new URL(urlText).hostname.toLowerCase();
        const suspiciousTld = SUSPICIOUS_TLDS.find((tld) =>
          hostname.endsWith(tld),
        );

        if (suspiciousTld) {
          violations.push(
            createViolation(
              fieldName,
              "suspicious_tld",
              `Suspicious URL — ${suspiciousTld} domains are not allowed`,
            ),
          );
          break;
        }
      } catch {
        continue;
      }
    }
  }

  return violations;
}

function checkExcessiveUrls(
  fields: Record<string, string | undefined>,
): ContentViolation[] {
  const violations: ContentViolation[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    if (!value) {
      continue;
    }

    const urls = extractUrls(value);

    if (urls.length > MAX_URLS_IN_TEXT) {
      violations.push(
        createViolation(
          fieldName,
          "excessive_urls",
          `Too many URLs — maximum ${MAX_URLS_IN_TEXT} links allowed`,
        ),
      );
    }
  }

  return violations;
}

function checkEnglishSpam(
  fields: Record<string, string | undefined>,
): ContentViolation[] {
  const violations: ContentViolation[] = [];

  for (const fieldName of ["name", "website", "purchaseUrl"]) {
    const value = fields[fieldName];

    if (!value) {
      continue;
    }

    const lowerValue = value.toLowerCase();
    const spamPhrase = ENGLISH_SPAM_PHRASES.find((phrase) =>
      lowerValue.includes(phrase),
    );

    if (spamPhrase) {
      violations.push(
        createViolation(
          fieldName,
          "english_spam",
          `Spam phrase detected: ${spamPhrase}`,
        ),
      );
    }
  }

  return violations;
}

function checkContactInjection(
  fields: Record<string, string | undefined>,
): ContentViolation[] {
  const violations: ContentViolation[] = [];

  for (const fieldName of ["description", "mitStory"]) {
    const value = fields[fieldName];

    if (!value) {
      continue;
    }

    if (TAIWAN_PHONE_REGEX.test(value)) {
      violations.push(
        createViolation(
          fieldName,
          "contact_injection_phone",
          "Phone numbers are not allowed in this field",
        ),
      );
    }

    if (EMAIL_REGEX.test(value)) {
      violations.push(
        createViolation(
          fieldName,
          "contact_injection_email",
          "Email addresses are not allowed in this field",
        ),
      );
    }
  }

  return violations;
}

function checkExcessiveEmoji(
  fields: Record<string, string | undefined>,
): ContentViolation[] {
  const violations: ContentViolation[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    if (!value) {
      continue;
    }

    const emojiCount = value.match(EMOJI_REGEX)?.length ?? 0;

    if (emojiCount > MAX_EMOJI_COUNT) {
      violations.push(
        createViolation(
          fieldName,
          "excessive_emoji",
          `Too many emoji — maximum ${MAX_EMOJI_COUNT} allowed`,
        ),
      );
    }
  }

  return violations;
}

function checkShortOrIdenticalDescription(
  fields: Record<string, string | undefined>,
  brandName: string,
): ContentViolation[] {
  const description = fields.description;

  if (!description) {
    return [];
  }

  const violations: ContentViolation[] = [];
  const cjkCount = description.match(CJK_REGEX)?.length ?? 0;

  if (cjkCount >= 3 && cjkCount < MIN_CJK_DESCRIPTION_CHARS) {
    violations.push(
      createViolation(
        "description",
        "short_description",
        "Description is too short",
      ),
    );
  }

  if (description.trim() === brandName.trim()) {
    violations.push(
      createViolation(
        "description",
        "identical_description",
        "Description cannot be the same as the brand name",
      ),
    );
  }

  return violations;
}

export function scanContent(
  brandName: string,
  fields: Record<string, string | undefined>,
): ScanResult {
  const violations = [
    ...checkSuspiciousTlds(fields),
    ...checkExcessiveUrls(fields),
    ...checkEnglishSpam(fields),
    ...checkContactInjection(fields),
    ...checkExcessiveEmoji(fields),
    ...checkShortOrIdenticalDescription(fields, brandName),
  ];
  return { violations };
}

export async function saveModerationFlags(
  brandId: string,
  userId: string,
  violations: ContentViolation[],
  status: string = "pending",
): Promise<void> {
  return auditedCall(
    { provider: "submissions", operation: "saveModerationFlags", kind: "service" },
    async () => {
  const supabase = createModerationClient();
  const rows: ModerationFlagInsert[] = violations.map((violation) => ({
    brand_id: brandId,
    user_id: userId,
    field_name: violation.field,
    flag_reason: violation.rule,
    flagged_content: violation.userMessage,
    status,
  }));
  const { error } = await supabase.from("moderation_flags").insert(rows);
  if (error) throw error;
    },
  );
}

export interface FlaggedContentFilters {
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface FlaggedContentItem {
  id: string;
  brandId: string;
  brandName: string;
  fieldName: string;
  reason: string;
  flaggedContent: string;
  status: string;
  createdAt: string;
}

type FlaggedContentRow = Database["public"]["Tables"]["moderation_flags"]["Row"] & {
  brands: { name: string | null } | { name: string | null }[] | null;
};

function getJoinedBrandName(brands: FlaggedContentRow["brands"]): string {
  const brand = Array.isArray(brands) ? brands[0] : brands;
  return brand?.name ?? "";
}

export async function getFlaggedContent(
  filters: FlaggedContentFilters = {},
): Promise<{
  items: FlaggedContentItem[];
  nextCursor: string | null;
}> {
  const supabase = createModerationClient();
  const limit = filters.limit ?? 20;
  let query = supabase
    .from("moderation_flags")
    .select("*, brands(name)")
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.cursor) query = query.lt("created_at", filters.cursor);

  const { data, error } = await query;
  if (error || !data) return { items: [], nextCursor: null };

  const hasMore = data.length > limit;
  const rows = (hasMore ? data.slice(0, limit) : data) as FlaggedContentRow[];
  const items: FlaggedContentItem[] = rows.map((row) => ({
    id: row.id,
    brandId: row.brand_id,
    brandName: getJoinedBrandName(row.brands),
    fieldName: row.field_name,
    reason: row.flag_reason,
    flaggedContent: row.flagged_content,
    status: row.status,
    createdAt: row.created_at,
  }));
  return {
    items,
    nextCursor: hasMore ? rows[rows.length - 1].created_at : null,
  };
}

export async function markFlagsReviewed(brandId: string): Promise<void> {
  return auditedCall(
    { provider: "submissions", operation: "markFlagsReviewed", kind: "service" },
    async () => {
  const supabase = createModerationClient();
  const { error } = await supabase
    .from("moderation_flags")
    .update({ status: "reviewed", reviewed_at: new Date().toISOString() })
    .eq("brand_id", brandId)
    .eq("status", "pending");

  if (error) console.error("[moderation] markFlagsReviewed failed:", error);
    },
  );
}

/**
 * Injectable claim seam, mirroring `updateReportStatus` in `./reports`. Tests may
 * not mock `@/lib/services/*` (scripts/check-test-boundaries.mjs), so the write
 * is reachable only through this parameter.
 */
export type UpdateModerationFlagStatusDeps = {
  claim: (
    flagId: string,
    update: Record<string, unknown>,
  ) => Promise<{ data: { id: string } | null; error: unknown }>;
};

export const defaultUpdateModerationFlagStatusDeps: UpdateModerationFlagStatusDeps = {
  async claim(flagId, update) {
    const supabase = createModerationClient();
    const { data, error } = await supabase
      .from("moderation_flags")
      .update(update as ModerationFlagUpdate)
      .eq("id", flagId)
      // The pending guard keeps a re-decided flag from silently overwriting a
      // settled review.
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    return { data, error };
  },
};

/**
 * Mirrors `UpdateReportStatusResult` in `./reports`. The decision is reported as
 * a machine-readable code rather than a thrown message so the action layer has
 * something stable to translate — a raw `Error.message` reached the admin UI
 * verbatim, untranslated, and carried PostgREST diagnostics with it.
 */
export type UpdateModerationFlagStatusResult =
  | { ok: true }
  | { ok: false; code: "already_reviewed" | "database_error" };

export async function updateModerationFlagStatus(
  flagId: string,
  decision: ReviewDecision,
  attribution?: ReviewAttribution,
  deps: UpdateModerationFlagStatusDeps = defaultUpdateModerationFlagStatusDeps,
): Promise<UpdateModerationFlagStatusResult> {
  return auditedCall<UpdateModerationFlagStatusResult>(
    { provider: "submissions", operation: "updateModerationFlagStatus", kind: "service" },
    async (ctx) => {
      try {
        const { data, error } = await deps.claim(
          flagId,
          buildReviewUpdate(decision, attribution),
        );

        if (error) {
          // The envelope classifies on the RETURNED value, so the underlying
          // error has to be carried out by hand or it is lost entirely.
          console.error(
            "[moderation] updateModerationFlagStatus claim failed:",
            error,
          );
          ctx.summary.claimError = describeError(error);
          return { ok: false, code: "database_error" };
        }
        // A returned row is the only proof the pending guard matched.
        if (!data) return { ok: false, code: "already_reviewed" };
        return { ok: true };
      } catch (error) {
        console.error("[moderation] updateModerationFlagStatus threw:", error);
        ctx.summary.claimError = describeError(error);
        return { ok: false, code: "database_error" };
      }
    },
    {
      // Without this a swallowed failure is audited as `succeeded` with normal
      // latency. `already_reviewed` is not a fault — no row was claimed.
      classify: (result) => {
        if (result.ok) return "succeeded";
        return result.code === "already_reviewed" ? "empty" : "failed";
      },
    },
  );
}
