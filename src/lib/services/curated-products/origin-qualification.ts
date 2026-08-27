export const MIT_REGISTRY_SYNC_MAX_AGE_HOURS = 192;
export const MAX_ORIGIN_EXCERPTS = 4;
export const MAX_ORIGIN_EXCERPT_LENGTH = 320;

export type OriginExcerpt = {
  id: string;
  text: string;
};

export type DeterministicOriginAssessment = {
  madeInTaiwan: boolean;
  materialsFromTaiwan: boolean;
  excerptIds: string[];
};

export type LlmOriginAssessment = DeterministicOriginAssessment;

export type RegistryOriginAssessment = {
  matched: boolean;
  recordId: string | number | null;
  reason: "matched" | "no_exact_match" | "expired" | "stale" | "invalid_expiry";
};

export type OriginQualificationMethod = "registry" | "consensus";

export type RegistryOriginRecord = {
  id: string | number;
  certNumber: string;
  normalizedBrand: string;
  normalizedProduct: string;
  normalizedModel: string;
  validUntil: string | null;
  syncedAt: string | null;
};

const TARGET_ORIGIN_TERMS =
  /台灣|臺灣|taiwan|製造|生產|製作|加工|made|manufactur(?:e|ed|ing)|produc(?:e|ed|tion)|原料|材料|材質|material|ingredient/giu;

const TAIWAN_MANUFACTURE_PATTERNS = [
  /(?:台灣|臺灣)(?:製造|生產|製作|加工)/u,
  /(?:於|在)(?:台灣|臺灣)(?:製造|生產|製作|加工)/u,
  /(?:製造|生產|製作|加工)(?:地|地點|基地)?(?:為|是|位於|於|在)?(?:台灣|臺灣)/u,
  /made\s+in\s+taiwan/iu,
  /manufactur(?:e|ed|ing)\s+in\s+taiwan/iu,
  /produc(?:e|ed|tion)\s+in\s+taiwan/iu,
] as const;

const COMPLETE_TAIWAN_MATERIAL_PATTERNS = [
  /(?:所有|全部|全數|全體|百分之百|100\s*%)(?:主要)?(?:原料|材料|材質)[^。！？.!?]{0,80}(?:來自|產自|生產於|取自|均為|皆為)?(?:台灣|臺灣)/u,
  /(?:所有|全部|全數|全體|百分之百|100\s*%)[^。！？.!?]{0,80}(?:原料|材料|材質)[^。！？.!?]{0,80}(?:台灣|臺灣)/u,
  /(?:all|every|100\s*%)\s+(?:primary\s+)?(?:materials?|ingredients?)[^.!?]{0,100}(?:sourced|grown|produced|made)\s+in\s+taiwan/iu,
  /(?:materials?|ingredients?)[^.!?]{0,100}(?:all|entirely|exclusively)[^.!?]{0,100}(?:from|in)\s+taiwan/iu,
] as const;

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

/**
 * Extracts only origin-adjacent windows from the complete rendered main text.
 * The model receives these stable IDs rather than being allowed to cite prose
 * that was never supplied to it.
 */
export function buildOriginExcerpts(
  candidateId: string,
  renderedMainText: string,
): OriginExcerpt[] {
  const text = normalizeEvidenceText(renderedMainText);
  if (!text) return [];

  const matches = [...text.matchAll(TARGET_ORIGIN_TERMS)];
  const excerpts: OriginExcerpt[] = [];
  let previousEnd = -1;

  for (const match of matches) {
    const index = match.index;
    if (index === undefined) continue;
    const start = Math.max(0, index - Math.floor(MAX_ORIGIN_EXCERPT_LENGTH / 2));
    const end = Math.min(text.length, start + MAX_ORIGIN_EXCERPT_LENGTH);
    if (start < previousEnd) continue;

    excerpts.push({
      id: `${candidateId}:origin:${excerpts.length + 1}`,
      text: text.slice(start, end),
    });
    previousEnd = end;
    if (excerpts.length === MAX_ORIGIN_EXCERPTS) break;
  }

  return excerpts;
}

export function assessDeterministicOrigin(
  excerpts: readonly OriginExcerpt[],
): DeterministicOriginAssessment {
  const madeExcerptIds = excerpts
    .filter((excerpt) => matchesAny(excerpt.text, TAIWAN_MANUFACTURE_PATTERNS))
    .map((excerpt) => excerpt.id);
  const materialExcerptIds = excerpts
    .filter((excerpt) =>
      matchesAny(excerpt.text, COMPLETE_TAIWAN_MATERIAL_PATTERNS),
    )
    .map((excerpt) => excerpt.id);

  return {
    madeInTaiwan: madeExcerptIds.length > 0,
    materialsFromTaiwan: materialExcerptIds.length > 0,
    excerptIds: [...new Set([...madeExcerptIds, ...materialExcerptIds])],
  };
}

export function decideOriginQualification(input: {
  deterministic: DeterministicOriginAssessment;
  llm: LlmOriginAssessment;
  registry: RegistryOriginAssessment;
}): { qualified: boolean; method: OriginQualificationMethod | null } {
  if (input.registry.matched) return { qualified: true, method: "registry" };

  const consensus =
    input.deterministic.madeInTaiwan &&
    input.deterministic.materialsFromTaiwan &&
    input.llm.madeInTaiwan &&
    input.llm.materialsFromTaiwan;

  return consensus
    ? { qualified: true, method: "consensus" }
    : { qualified: false, method: null };
}

export function normalizeRegistryValue(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function parseRegistryExpiry(value: string | null): number | null {
  if (!value || !/^\d{8}$/u.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed.getTime();
}

export function classifyRegistryRecord(
  record: Pick<RegistryOriginRecord, "validUntil" | "syncedAt">,
  now: Date = new Date(),
): RegistryOriginAssessment["reason"] {
  const expiry = parseRegistryExpiry(record.validUntil);
  if (expiry === null) return "invalid_expiry";
  if (expiry < now.getTime()) return "expired";

  const syncedAt = record.syncedAt ? Date.parse(record.syncedAt) : Number.NaN;
  if (!Number.isFinite(syncedAt)) return "stale";
  const ageHours = (now.getTime() - syncedAt) / 3_600_000;
  return ageHours >= 0 && ageHours <= MIT_REGISTRY_SYNC_MAX_AGE_HOURS
    ? "matched"
    : "stale";
}

export function isRegistryRecordActive(
  record: Pick<RegistryOriginRecord, "validUntil" | "syncedAt">,
  now: Date = new Date(),
): boolean {
  return classifyRegistryRecord(record, now) === "matched";
}

export function selectExactRegistryMatch(
  records: readonly RegistryOriginRecord[],
  input: { brand: string; product: string; model?: string | null },
  now: Date = new Date(),
): RegistryOriginRecord | null {
  const brand = normalizeRegistryValue(input.brand);
  const product = normalizeRegistryValue(input.product);
  const model = normalizeRegistryValue(input.model);
  if (!brand || !product) return null;

  return (
    records.find(
      (record) =>
        record.normalizedBrand === brand &&
        record.normalizedProduct === product &&
        record.normalizedModel === model &&
        isRegistryRecordActive(record, now),
    ) ?? null
  );
}

export function rankOriginCandidates<
  Candidate extends {
    editorialScore: number;
    mitQualified: boolean;
    searchPosition?: number | null;
  },
>(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort((left, right) => {
    const score = right.editorialScore - left.editorialScore;
    if (score !== 0) return score;
    if (left.mitQualified !== right.mitQualified) {
      return left.mitQualified ? -1 : 1;
    }
    return (
      (left.searchPosition ?? Number.MAX_SAFE_INTEGER) -
      (right.searchPosition ?? Number.MAX_SAFE_INTEGER)
    );
  });
}
