import {
  canonicalizeBilingualBrandName,
  isTaiwanFirstBilingualBrandName,
  isValidBrandName,
} from "@/lib/services/brand-cleanup";
import {
  isBrandNameProposal,
  type BrandNameProposal,
} from "@/lib/types/enriched-data";

export type NameBackfillBrand = {
  id: string;
  slug: string;
  name: string;
  status: string;
  purchase_website?: string | null;
  social_instagram?: string | null;
  social_threads?: string | null;
  social_facebook?: string | null;
};

export type NameBackfillEligibility =
  | { eligible: true; proposal: BrandNameProposal }
  | { eligible: false; reason: string };

export type NameBackfillMode = "dry-run" | "confirm";

export type NameBackfillWriteEvent = {
  brand_id: string;
  field: string;
  source: string;
  job_id: string | null;
  old_value: unknown;
  new_value: unknown;
};

export type NameBackfillJob = {
  id: string;
  status: string;
  operation: string;
  dry_run: boolean;
  params: unknown;
};

export function parseNameBackfillMode(
  args: readonly string[],
): NameBackfillMode {
  const dryRun = args.includes("--dry-run");
  const confirm = args.includes("--confirm");
  if (dryRun === confirm) {
    throw new Error("Pass exactly one of --dry-run or --confirm");
  }
  return dryRun ? "dry-run" : "confirm";
}

export function isIdentityBackfillJobForSubmission(
  job: NameBackfillJob,
  submissionId: string,
): boolean {
  if (
    job.status !== "completed" ||
    job.operation !== "enrich" ||
    job.dry_run ||
    typeof job.params !== "object" ||
    job.params === null ||
    Array.isArray(job.params)
  ) {
    return false;
  }
  const params = job.params as Record<string, unknown>;
  return (
    params.target === "submissions" &&
    params.task === "identity" &&
    Array.isArray(params.submissionIds) &&
    params.submissionIds.includes(submissionId)
  );
}

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function storedEvidenceUrls(
  brand: NameBackfillBrand,
): Map<string, "official_website" | "official_social"> {
  const urls = new Map<string, "official_website" | "official_social">();
  const add = (
    source: "official_website" | "official_social",
    value: string | null | undefined,
  ) => {
    if (!value) return;
    const normalized = normalizedUrl(value);
    if (normalized) urls.set(normalized, source);
  };
  add("official_website", brand.purchase_website);
  add("official_social", brand.social_instagram);
  add("official_social", brand.social_threads);
  add("official_social", brand.social_facebook);
  return urls;
}

export function evaluateNameBackfillEligibility(input: {
  current: NameBackfillBrand;
  snapshot: NameBackfillBrand;
  proposal: unknown;
}): NameBackfillEligibility {
  const { current, snapshot } = input;
  if (snapshot.status !== "approved" || current.status !== "approved") {
    return { eligible: false, reason: "brand is no longer approved" };
  }
  if (current.id !== snapshot.id || current.slug !== snapshot.slug) {
    return {
      eligible: false,
      reason: "brand identity no longer matches snapshot",
    };
  }
  if (current.name !== snapshot.name) {
    return {
      eligible: false,
      reason: "current name no longer matches snapshot",
    };
  }
  if (
    !/\p{Script=Latin}/u.test(snapshot.name) ||
    /\p{Script=Han}/u.test(snapshot.name)
  ) {
    return { eligible: false, reason: "snapshot name is not Latin-only" };
  }
  if (!isBrandNameProposal(input.proposal)) {
    return { eligible: false, reason: "proposal contract is invalid" };
  }

  const proposal = input.proposal;
  if (
    proposal.value.length > 100 ||
    !isTaiwanFirstBilingualBrandName(proposal.value) ||
    !isValidBrandName(proposal.value, snapshot.name)
  ) {
    return {
      eligible: false,
      reason: "proposal is not a valid Taiwan-first bilingual name",
    };
  }

  const snapshotUrls = storedEvidenceUrls(snapshot);
  const currentUrls = storedEvidenceUrls(current);
  const evidenceMatches = proposal.evidence.every((evidence) => {
    const normalized = normalizedUrl(evidence.url);
    return (
      normalized !== null &&
      snapshotUrls.get(normalized) === evidence.source &&
      currentUrls.get(normalized) === evidence.source &&
      canonicalizeBilingualBrandName(snapshot.name, evidence.observedName) ===
        proposal.value
    );
  });
  if (!evidenceMatches) {
    return {
      eligible: false,
      reason: "proposal evidence is not a stored official channel",
    };
  }

  return { eligible: true, proposal };
}

export function isResumableNameBackfillWrite(input: {
  current: NameBackfillBrand;
  snapshot: NameBackfillBrand;
  proposal: unknown;
  event: NameBackfillWriteEvent | undefined;
  jobId: string;
}): boolean {
  if (!isBrandNameProposal(input.proposal) || !input.event) return false;
  const eligibility = evaluateNameBackfillEligibility({
    current: { ...input.current, name: input.snapshot.name },
    snapshot: input.snapshot,
    proposal: input.proposal,
  });
  return (
    eligibility.eligible &&
    input.current.name === input.proposal.value &&
    input.event.brand_id === input.current.id &&
    input.event.field === "name" &&
    input.event.source === "admin" &&
    input.event.job_id === input.jobId &&
    input.event.old_value === input.snapshot.name &&
    input.event.new_value === input.proposal.value
  );
}
