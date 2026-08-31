import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { artifactPath } from "../shared/artifact";
import { createServiceClient } from "@/lib/supabase/service";
import {
  evaluateFoundingFact,
  type FoundingFactField,
} from "@/lib/services/founding-facts";
import {
  buildAutoHighApplyPlan,
  buildDecisionApplyPlan,
  validateDecisionBundle,
  type FoundingFactsApplyItem,
  type FoundingFactsAuditArtifact,
  type FoundingFactsDecisionBundle,
} from "./core";

type CurrentBrand = {
  id: string;
  status: string;
  city: string | null;
  founding_year: number | null;
  seo_promoted: boolean | null;
};

type CurrentFieldState = {
  brand_id: string;
  field: string;
  source: string;
  updated_by: string | null;
};

type GuardedPatchRpc = {
  rpc: (
    name: "apply_founding_fact_audit_patch",
    args: {
      p_brand_id: string;
      p_patch: Record<string, unknown>;
      p_expected: Record<string, unknown>;
      p_expected_protection: Record<string, unknown>;
      p_source: "enriched" | "admin";
      p_actor: string | null;
      p_allow_protected: boolean;
    },
  ) => Promise<{ data: boolean | null; error: { message?: string } | null }>;
};

function valueOf(brand: CurrentBrand, field: FoundingFactField) {
  return field === "city" ? brand.city : brand.founding_year;
}

function protectionOf(
  rows: readonly CurrentFieldState[],
  brandId: string,
  field: FoundingFactField,
): "protected:owner" | "protected:admin" | null {
  const row = rows.find(
    (candidate) => candidate.brand_id === brandId && candidate.field === field,
  );
  if (row?.source === "owner") return "protected:owner";
  if (row?.source === "admin" && row.updated_by) return "protected:admin";
  return null;
}

async function currentState(brandIds: string[]): Promise<{
  brands: CurrentBrand[];
  fields: CurrentFieldState[];
}> {
  const supabase = createServiceClient();
  const [brandResult, fieldResult] = await Promise.all([
    supabase
      .from("brands")
      .select("id, status, city, founding_year, seo_promoted")
      .in("id", brandIds),
    supabase
      .from("brand_field_state")
      .select("brand_id, field, source, updated_by")
      .in("brand_id", brandIds)
      .in("field", ["city", "founding_year"]),
  ]);
  if (brandResult.error) throw brandResult.error;
  if (fieldResult.error) throw fieldResult.error;
  return {
    brands: (brandResult.data ?? []) as CurrentBrand[],
    fields: (fieldResult.data ?? []) as CurrentFieldState[],
  };
}

function assertAutoEvidence(artifact: FoundingFactsAuditArtifact): void {
  const auditYear = new Date(artifact.createdAt).getUTCFullYear();
  for (const brand of artifact.brands) {
    for (const field of ["city", "founding_year"] as const) {
      const proposal = brand.fields[field].proposal;
      if (proposal.confidence !== "high") continue;
      const recomputed = evaluateFoundingFact(
        field,
        proposal.evidence,
        auditYear,
      );
      if (
        recomputed.confidence !== "high" ||
        recomputed.value !== proposal.value ||
        recomputed.evidenceHash !== proposal.evidenceHash
      ) {
        throw new Error(
          `${brand.snapshot.id}.${field} no longer reproduces its high-confidence evidence hash`,
        );
      }
    }
  }
}

async function resolveReviewerId(): Promise<string> {
  const email = process.env.ADMIN_EMAILS?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  if (!email) throw new Error("ADMIN_EMAILS must contain an admin account");
  const supabase = createServiceClient();
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1_000,
    });
    if (error) throw error;
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) return match.id;
    if (data.users.length < 1_000) break;
  }
  throw new Error(`Admin user not found: ${email}`);
}

function preflight(input: {
  artifact: FoundingFactsAuditArtifact;
  plan: readonly FoundingFactsApplyItem[];
  brands: readonly CurrentBrand[];
  fields: readonly CurrentFieldState[];
  autoHigh: boolean;
  decisionBundle?: FoundingFactsDecisionBundle;
}): void {
  const currentById = new Map(input.brands.map((brand) => [brand.id, brand]));
  const checkKeys = new Set(
    input.plan.map((item) => `${item.brandId}\u0000${item.field}`),
  );
  if (input.decisionBundle) {
    for (const decision of input.decisionBundle.decisions) {
      checkKeys.add(`${decision.brandId}\u0000${decision.field}`);
    }
  }
  if (input.autoHigh) {
    for (const brand of input.artifact.brands) {
      for (const field of ["city", "founding_year"] as const) {
        if (brand.fields[field].action === "verify")
          checkKeys.add(`${brand.snapshot.id}\u0000${field}`);
      }
    }
  }

  for (const key of checkKeys) {
    const [brandId, rawField] = key.split("\u0000");
    const field = rawField as FoundingFactField;
    if (field !== "city" && field !== "founding_year")
      throw new Error(
        `${brandId}.${rawField} is not an allowed founding field`,
      );
    const brand = currentById.get(brandId!);
    if (!brand) throw new Error(`${brandId}.${field} brand no longer exists`);
    if (brand.status !== "approved")
      throw new Error(`${brandId}.${field} brand is no longer approved`);
    const auditedBrand = input.artifact.brands.find(
      (candidate) => candidate.snapshot.id === brandId,
    );
    if (!auditedBrand) throw new Error(`${brandId}.${field} was not audited`);
    const audited = auditedBrand.fields[field];
    if (valueOf(brand, field) !== audited.expectedCurrent)
      throw new Error(`${brandId}.${field} changed since the audit snapshot`);
    if (protectionOf(input.fields, brandId!, field) !== audited.protection)
      throw new Error(`${brandId}.${field} protection changed since the audit`);
  }
}

function groupedPlan(plan: readonly FoundingFactsApplyItem[]) {
  const grouped = new Map<string, FoundingFactsApplyItem[]>();
  for (const item of plan) {
    const values = grouped.get(item.brandId) ?? [];
    values.push(item);
    grouped.set(item.brandId, values);
  }
  return grouped;
}

export async function applyAudit(options: {
  artifactFile: string;
  autoHigh: boolean;
  decisionsFile?: string;
  confirm: boolean;
}): Promise<string> {
  const artifact = JSON.parse(
    await readFile(options.artifactFile, "utf8"),
  ) as FoundingFactsAuditArtifact;
  if (
    artifact.version !== 1 ||
    !artifact.runId ||
    !Array.isArray(artifact.brands)
  )
    throw new Error("invalid founding-facts audit artifact");
  if (options.autoHigh === Boolean(options.decisionsFile))
    throw new Error("choose exactly one of --auto-high or --decisions");

  let decisions: FoundingFactsDecisionBundle | undefined;
  let plan: FoundingFactsApplyItem[];
  if (options.autoHigh) {
    assertAutoEvidence(artifact);
    plan = buildAutoHighApplyPlan(artifact);
  } else {
    decisions = JSON.parse(
      await readFile(options.decisionsFile!, "utf8"),
    ) as FoundingFactsDecisionBundle;
    const errors = validateDecisionBundle(artifact, decisions);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    plan = buildDecisionApplyPlan(artifact, decisions);
  }

  const brandIds = artifact.brands.map((brand) => brand.snapshot.id);
  const before = await currentState(brandIds);
  preflight({
    artifact,
    plan,
    brands: before.brands,
    fields: before.fields,
    autoHigh: options.autoHigh,
    ...(decisions ? { decisionBundle: decisions } : {}),
  });

  const actorSource = options.autoHigh ? "enriched" : "admin";
  const actorId =
    options.confirm && !options.autoHigh ? await resolveReviewerId() : null;
  const outcomes: Array<{
    brandId: string;
    fields: FoundingFactField[];
    outcome: "applied" | "would-apply";
  }> = [];
  const auditedById = new Map(
    artifact.brands.map((brand) => [brand.snapshot.id, brand]),
  );
  for (const [brandId, items] of groupedPlan(plan)) {
    if (options.confirm) {
      const { data, error } = await (
        createServiceClient() as unknown as GuardedPatchRpc
      ).rpc("apply_founding_fact_audit_patch", {
        p_brand_id: brandId,
        p_patch: Object.fromEntries(
          items.map((item) => [item.field, item.value]),
        ),
        p_expected: Object.fromEntries(
          items.map((item) => [item.field, item.expectedCurrent]),
        ),
        p_expected_protection: Object.fromEntries(
          items.map((item) => [
            item.field,
            auditedById.get(brandId)!.fields[item.field].protection,
          ]),
        ),
        p_source: actorSource,
        p_actor: actorId,
        p_allow_protected: !options.autoHigh,
      });
      if (error) throw error;
      if (data !== true)
        throw new Error(
          `${brandId} failed the atomic status/value/protection guard`,
        );
    }
    outcomes.push({
      brandId,
      fields: items.map((item) => item.field),
      outcome: options.confirm ? "applied" : "would-apply",
    });
  }

  const after = options.confirm ? await currentState(brandIds) : before;
  const report = {
    version: 1,
    runId: artifact.runId,
    createdAt: new Date().toISOString(),
    confirmed: options.confirm,
    mode: options.autoHigh ? "auto-high" : "decisions",
    outcomes,
    verifiedWithoutBrandWrite: options.autoHigh
      ? artifact.brands.reduce(
          (sum, brand) =>
            sum +
            [brand.fields.city, brand.fields.founding_year].filter(
              (field) => field.action === "verify",
            ).length,
          0,
        )
      : 0,
    metrics: {
      cityPopulatedBefore: before.brands.filter((brand) => brand.city != null)
        .length,
      cityPopulatedAfter: after.brands.filter((brand) => brand.city != null)
        .length,
      foundingYearPopulatedBefore: before.brands.filter(
        (brand) => brand.founding_year != null,
      ).length,
      foundingYearPopulatedAfter: after.brands.filter(
        (brand) => brand.founding_year != null,
      ).length,
      cityUnresolvedAfter: after.brands.filter((brand) => brand.city == null)
        .length,
      foundingYearUnresolvedAfter: after.brands.filter(
        (brand) => brand.founding_year == null,
      ).length,
      fetchFailures: artifact.metrics.fetchFailures,
      searchFailures: artifact.metrics.searchFailures,
      serperCredits: artifact.metrics.serperCredits,
      llmCalls: artifact.metrics.llmCalls,
      llmCostUsd: artifact.metrics.llmCostUsd,
      seoPromotedBefore: before.brands.filter(
        (brand) => brand.seo_promoted === true,
      ).length,
      seoPromotedAfter: after.brands.filter(
        (brand) => brand.seo_promoted === true,
      ).length,
      seoPromotedDelta:
        after.brands.filter((brand) => brand.seo_promoted === true).length -
        before.brands.filter((brand) => brand.seo_promoted === true).length,
    },
  };
  const output = artifactPath("founding-facts", {
    prefix: options.confirm ? "apply-report" : "dry-run-apply",
    ext: "json",
    suffix: process.pid,
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return output;
}
