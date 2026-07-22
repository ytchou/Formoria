import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import * as supabaseServer from "@/lib/supabase/server";
import { buildReviewUpdate, type ReviewDecision } from "./review-status";

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

type ModerationFlagRow =
  Database["public"]["Tables"]["moderation_flags"]["Row"];
type ModerationFlagInsert =
  Database["public"]["Tables"]["moderation_flags"]["Insert"];
type ModerationFlagUpdate =
  Database["public"]["Tables"]["moderation_flags"]["Update"];
export type ModerationTier = "block" | "flag";
export type RiskLevel = "clean" | "medium" | "high";

export interface ModerationFlag {
  fieldName: string;
  tier: ModerationTier;
  reason: string;
  flaggedContent: string;
}

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
  const supabase = createModerationClient();
  const rows: ModerationFlagInsert[] = violations.map((violation) => ({
    brand_id: brandId,
    user_id: userId,
    field_name: violation.field,
    flag_reason: violation.rule,
    flagged_content: violation.userMessage,
    tier: "block",
    status,
  }));
  const { error } = await supabase.from("moderation_flags").insert(rows);
  if (error) throw error;
}

export async function getModerationFlagsBatch(
  brandIds: string[],
): Promise<Map<string, ModerationFlag[]>> {
  const uniqueBrandIds = Array.from(new Set(brandIds.filter(Boolean)));
  const flagsByBrandId = new Map<string, ModerationFlag[]>();

  for (const brandId of uniqueBrandIds) {
    flagsByBrandId.set(brandId, []);
  }

  if (uniqueBrandIds.length === 0) {
    return flagsByBrandId;
  }

  const supabase = createModerationClient();
  const { data, error } = await supabase
    .from("moderation_flags")
    .select("*")
    .in("brand_id", uniqueBrandIds)
    .neq("status", "reviewed")
    .order("created_at", { ascending: false });

  if (error || !data) return flagsByBrandId;

  for (const row of data) {
    const flags = flagsByBrandId.get(row.brand_id) ?? [];
    flags.push({
      fieldName: row.field_name,
      tier: row.tier as ModerationTier,
      reason: row.flag_reason,
      flaggedContent: row.flagged_content,
    });
    flagsByBrandId.set(row.brand_id, flags);
  }

  return flagsByBrandId;
}

export interface FlaggedContentFilters {
  riskLevel?: string;
  tier?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface FlaggedContentItem {
  id: string;
  brandId: string;
  brandName: string;
  fieldName: string;
  tier: ModerationTier;
  reason: string;
  flaggedContent: string;
  status: string;
  createdAt: string;
}

type FlaggedContentRow = ModerationFlagRow & {
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
  if (filters.tier) query = query.eq("tier", filters.tier);
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
    tier: row.tier as ModerationTier,
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
  const supabase = createModerationClient();
  const { error } = await supabase
    .from("moderation_flags")
    .update({ status: "reviewed", reviewed_at: new Date().toISOString() })
    .eq("brand_id", brandId)
    .eq("status", "pending");

  if (error) console.error("[moderation] markFlagsReviewed failed:", error);
}

export async function updateModerationFlagStatus(
  flagId: string,
  decision: ReviewDecision,
): Promise<void> {
  const supabase = createModerationClient();
  const { data, error } = await supabase
    .from("moderation_flags")
    .update(buildReviewUpdate(decision) as ModerationFlagUpdate)
    .eq("id", flagId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Moderation flag is no longer pending");
}
