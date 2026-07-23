import type {
  SubmitBrandForReviewParams,
  SubmitBrandForReviewResult,
} from "@/lib/services/submission-pipeline";

export const MAX_COMMUNITY_SUBMISSIONS = 500;
const EXECUTION_CONCURRENCY = 5;

export type CommunitySubmissionDraft = {
  id: string;
  name: string;
  website: string;
};

type CommunitySubmissionPreviewStatus =
  "ready" | "similar" | "duplicate" | "invalid";

export type CommunitySubmissionPreview = CommunitySubmissionDraft & {
  normalizedName: string | null;
  normalizedWebsite: string | null;
  status: CommunitySubmissionPreviewStatus;
  message?: string;
  similarBrands: Array<{ name: string; slug: string; score: number }>;
};

export type CommunitySubmissionResult =
  | { id: string; status: "created"; submissionId: string }
  | { id: string; status: "skipped_duplicate"; message: string }
  | { id: string; status: "failed"; message: string };

export type ExistingCommunitySubmissionRecords = {
  catalog: Array<{ name: string; website: string | null }>;
  submissions: Array<{
    name: string;
    website: string | null;
    status: "pending" | "approved";
  }>;
  similar: Array<{
    inputName: string;
    brandName: string;
    brandSlug: string;
    score: number;
  }>;
};

export interface CommunitySubmissionRepository {
  loadExistingRecords(
    names: string[],
  ): Promise<ExistingCommunitySubmissionRecords>;
}

export type CommunitySubmissionPreviewDependencies = {
  repository: CommunitySubmissionRepository;
};

export type CommunitySubmissionDependencies =
  CommunitySubmissionPreviewDependencies & {
    submit(
      params: SubmitBrandForReviewParams,
    ): Promise<SubmitBrandForReviewResult>;
    buildSubmitter(): Pick<
      SubmitBrandForReviewParams,
      "submitterEmail" | "submitterName"
    >;
  };

type ValidatedDraft = CommunitySubmissionDraft & {
  normalizedName: string;
  normalizedWebsite: string;
  nameKey: string;
  websiteKey: string;
};

export function parseCommunitySubmissionsCsv(
  input: string,
  createId: () => string = () => crypto.randomUUID(),
): CommunitySubmissionDraft[] {
  const rows = parseCsvRecords(input.replace(/^\uFEFF/, ""));
  const header = rows.shift();
  if (
    !header ||
    header.length !== 2 ||
    header[0] !== "name" ||
    header[1] !== "website"
  ) {
    throw new Error("CSV header must be exactly name,website");
  }

  const entries = rows.filter((row) =>
    row.some((value) => value.trim().length > 0),
  );
  const malformedIndex = entries.findIndex((row) => row.length !== 2);
  if (malformedIndex >= 0) {
    const originalIndex = rows.indexOf(entries[malformedIndex]!);
    throw new Error(
      `CSV row ${originalIndex + 2} must contain exactly two columns`,
    );
  }
  if (entries.length > MAX_COMMUNITY_SUBMISSIONS) {
    throw new Error(
      `CSV cannot contain more than ${MAX_COMMUNITY_SUBMISSIONS} entries`,
    );
  }

  return entries.map(([name = "", website = ""]) => ({
    id: createId(),
    name: normalizeDisplayName(name),
    website: normalizeCommunityWebsite(website)?.url ?? website.trim(),
  }));
}

function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      if (character === "\r" && input[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function normalizeCommunityWebsite(
  input: string | null | undefined,
): { url: string; key: string } | null {
  const trimmed = input?.trim();
  if (!trimmed || trimmed.length > 2_000) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname.includes(".")
    ) {
      return null;
    }
    parsed.search = "";
    parsed.hash = "";
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : "";
    const pathname =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    const url = `${parsed.protocol}//${hostname}${port}${pathname}`;
    const duplicateHostname = hostname.replace(/^www\./, "");
    return { url, key: `${duplicateHostname}${port}${pathname}` };
  } catch {
    return null;
  }
}

export async function previewCommunitySubmissions(
  drafts: CommunitySubmissionDraft[],
  dependencies: CommunitySubmissionPreviewDependencies,
): Promise<CommunitySubmissionPreview[]> {
  if (drafts.length > MAX_COMMUNITY_SUBMISSIONS) {
    throw new Error(
      `Cannot preview more than ${MAX_COMMUNITY_SUBMISSIONS} entries`,
    );
  }

  const validated = drafts.map(validateDraft);
  const valid = validated.flatMap((entry) =>
    entry.valid ? [entry.value] : [],
  );
  if (valid.length === 0) {
    return validated.map((entry) => {
      if (entry.valid) throw new Error("Unexpected valid row");
      return {
        ...entry.draft,
        normalizedName: null,
        normalizedWebsite: null,
        status: "invalid",
        message: entry.message,
        similarBrands: [],
      };
    });
  }
  const existing = await dependencies.repository.loadExistingRecords(
    valid.map((entry) => entry.normalizedName),
  );
  const duplicateNameCounts = countKeys(valid.map((entry) => entry.nameKey));
  const duplicateWebsiteCounts = countKeys(
    valid.map((entry) => entry.websiteKey),
  );
  const existingNames = new Set<string>();
  const existingWebsites = new Set<string>();

  for (const record of [...existing.catalog, ...existing.submissions]) {
    existingNames.add(normalizeNameKey(record.name));
    const website = normalizeCommunityWebsite(record.website);
    if (website) existingWebsites.add(website.key);
  }

  const similarByInput = new Map<
    string,
    CommunitySubmissionPreview["similarBrands"]
  >();
  for (const match of existing.similar) {
    const matches = similarByInput.get(normalizeNameKey(match.inputName)) ?? [];
    matches.push({
      name: match.brandName,
      slug: match.brandSlug,
      score: match.score,
    });
    similarByInput.set(normalizeNameKey(match.inputName), matches);
  }

  return validated.map((entry) => {
    if (!entry.valid) {
      return {
        ...entry.draft,
        normalizedName: null,
        normalizedWebsite: null,
        status: "invalid",
        message: entry.message,
        similarBrands: [],
      };
    }

    const value = entry.value;
    const batchDuplicate =
      (duplicateNameCounts.get(value.nameKey) ?? 0) > 1 ||
      (duplicateWebsiteCounts.get(value.websiteKey) ?? 0) > 1;
    const storedDuplicate =
      existingNames.has(value.nameKey) ||
      existingWebsites.has(value.websiteKey);
    const similarBrands = similarByInput.get(value.nameKey) ?? [];
    const status: CommunitySubmissionPreviewStatus =
      batchDuplicate || storedDuplicate
        ? "duplicate"
        : similarBrands.length > 0
          ? "similar"
          : "ready";

    return {
      id: value.id,
      name: value.normalizedName,
      website: value.normalizedWebsite,
      normalizedName: value.normalizedName,
      normalizedWebsite: value.normalizedWebsite,
      status,
      message: batchDuplicate
        ? "Exact duplicate in this batch"
        : storedDuplicate
          ? "Exact duplicate already exists"
          : similarBrands.length > 0
            ? `Similar to ${similarBrands.map((brand) => brand.name).join(", ")}`
            : undefined,
      similarBrands,
    };
  });
}

export async function executeCommunitySubmissions(
  drafts: CommunitySubmissionDraft[],
  dependencies: CommunitySubmissionDependencies,
): Promise<CommunitySubmissionResult[]> {
  const preview = await previewCommunitySubmissions(drafts, dependencies);
  const results: Array<CommunitySubmissionResult | undefined> = preview.map(
    (row) => {
      if (row.status === "duplicate") {
        return {
          id: row.id,
          status: "skipped_duplicate",
          message: row.message ?? "Exact duplicate",
        };
      }
      if (row.status === "invalid") {
        return {
          id: row.id,
          status: "failed",
          message: row.message ?? "Invalid row",
        };
      }
      return undefined;
    },
  );
  const eligibleIndexes = preview.flatMap((row, index) =>
    row.status === "ready" || row.status === "similar" ? [index] : [],
  );

  await mapWithConcurrency(
    eligibleIndexes,
    EXECUTION_CONCURRENCY,
    async (index) => {
      const row = preview[index]!;
      try {
        const created = await dependencies.submit({
          intent: "recommend",
          brandName: row.normalizedName!,
          websiteUrl: row.normalizedWebsite!,
          ...dependencies.buildSubmitter(),
          isBrandOwner: false,
          pdpaConsent: false,
          sourceAttribution: "found_online",
        });
        results[index] = {
          id: row.id,
          status: "created",
          submissionId: created.submissionId,
        };
      } catch (error) {
        results[index] = {
          id: row.id,
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "Submission could not be created",
        };
      }
    },
  );

  return results.map(
    (result, index) =>
      result ?? {
        id: drafts[index]!.id,
        status: "failed",
        message: "Submission did not complete",
      },
  );
}

function validateDraft(
  draft: CommunitySubmissionDraft,
):
  | { valid: true; value: ValidatedDraft }
  | { valid: false; draft: CommunitySubmissionDraft; message: string } {
  const name = normalizeDisplayName(draft.name);
  const website = normalizeCommunityWebsite(draft.website);
  const errors: string[] = [];
  if (!name) errors.push("Brand name is required");
  else if (name.length > 200)
    errors.push("Brand name must be 200 characters or fewer");
  if (!draft.website.trim()) errors.push("Official website is required");
  else if (!website)
    errors.push("Official website must be a valid HTTP(S) URL");

  if (errors.length > 0 || !website || !name) {
    return { valid: false, draft, message: errors.join(". ") };
  }
  return {
    valid: true,
    value: {
      ...draft,
      normalizedName: name,
      normalizedWebsite: website.url,
      nameKey: normalizeNameKey(name),
      websiteKey: website.key,
    },
  };
}

function normalizeDisplayName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function normalizeNameKey(value: string): string {
  return normalizeDisplayName(value).toLocaleLowerCase("en-US");
}

function countKeys(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await callback(items[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}
