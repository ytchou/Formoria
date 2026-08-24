import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { getTranslations } from "next-intl/server";
import { auditedCall } from "@/lib/audit";
import { DataCard, SurfaceCard } from "@/components/ui/card";
import {
  ONLINE_STORES,
  type OnlineStoreCamelField,
  type OnlineStoreKey,
} from "@/lib/brands/online-stores";
import { getQualityMetrics } from "@/lib/services/brand-quality";
import { loadZhVocabularyReport } from "@/lib/services/zh-vocabulary-report";

export const metadata: Metadata = {
  title: "Quality Dashboard | Admin",
};

export const revalidate = 0;

const getCachedMetrics = unstable_cache(
  () =>
    auditedCall(
      { provider: "cache", operation: "getCachedMetrics", kind: "service" },
      () => getQualityMetrics(),
      { summary: { cached: true } },
    ),
  ["quality-metrics"],
  { tags: ["quality-metrics"] },
);

/**
 * The reader for the zh-TW vocabulary audit trail (DEV-1547 E3).
 *
 * The write-path guard has recorded every mainland-Chinese term it found in
 * text about to be stored since DEV-1546, and until now nothing displayed it:
 * a term that reached a published FAQ answer left its only trace in an
 * `external_call_audit` row nobody queries. This is the surface that ends that.
 *
 * It lives on the quality dashboard rather than in its own page because it is
 * the same question every other card here answers — what is wrong with the text
 * we have stored — and REPORT ONLY, like all of them: nothing is rewritten, and
 * a hit is a queue for a human, not a gate.
 *
 * Cached beside the metrics with the same idiom, so the added read is one
 * query per revalidation rather than one per page view.
 */
const getCachedVocabulary = unstable_cache(
  () =>
    auditedCall(
      {
        provider: "cache",
        operation: "getCachedZhVocabularyReport",
        kind: "service",
      },
      () => loadZhVocabularyReport(),
      { summary: { cached: true } },
    ),
  ["zh-vocabulary-report"],
  { tags: ["zh-vocabulary-report"] },
);

const PURCHASE_LINK_PRESENTATION = {
  website: { label: "Website" },
  pinkoi: { label: "Pinkoi" },
  shopee: { label: "Shopee" },
  myship: { label: "MyShip" },
} satisfies Record<OnlineStoreKey, { label: string }>;

type LinkRow = {
  label: string;
  key:
    | "socialInstagram"
    | "socialThreads"
    | "socialFacebook"
    | OnlineStoreCamelField;
};

const linkRows: LinkRow[] = [
  { label: "Instagram", key: "socialInstagram" },
  { label: "Threads", key: "socialThreads" },
  { label: "Facebook", key: "socialFacebook" },
  ...ONLINE_STORES.map((channel) => ({
    ...PURCHASE_LINK_PRESENTATION[channel.key],
    key: channel.camel,
  })),
];

const distributionRows = [
  { label: "Excellent >=80%", key: "excellent" },
  { label: "Good 60-79%", key: "good" },
  { label: "Fair 40-59%", key: "fair" },
  { label: "Poor <40%", key: "poor" },
] as const;

const enrichmentRows = [
  { label: "ZH language purity", key: "languagePurityPct" },
  { label: "Hero classified", key: "heroClassifiedPct" },
  { label: "ZH description coverage", key: "descriptionCoveragePct" },
  { label: "EN description coverage", key: "descriptionEnCoveragePct" },
] as const;

type ProgressBarProps = {
  value: number;
  label: string;
};

function formatPercentage(value: number): string {
  return `${Math.round(value)}%`;
}

function ProgressBar({ value, label }: ProgressBarProps) {
  const boundedValue = Math.min(100, Math.max(0, value));

  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(boundedValue)}
      className="h-2 w-full overflow-hidden rounded-full bg-surface"
      role="progressbar"
    >
      <div
        className="h-full rounded-full bg-ink"
        style={{ width: `${boundedValue}%` }}
      />
    </div>
  );
}

export default async function AdminQualityPage() {
  const t = await getTranslations("admin.quality");
  const [metrics, vocabulary] = await Promise.all([
    getCachedMetrics(),
    getCachedVocabulary(),
  ]);
  const distributionTotal = Object.values(metrics.completeness).reduce(
    (total, count) => total + count,
    0,
  );
  const distributionMax = Math.max(...Object.values(metrics.completeness), 0);

  return (
    <div>
      <h1 className="type-tool-heading">{t("title")}</h1>
      <p className="mt-2 text-ink-muted">{t("description")}</p>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <DataCard
          label="Hero Image Coverage"
          value={formatPercentage(metrics.heroImage.percentage)}
          description={t("heroImageCoverageDescription", {
            count: metrics.heroImage.withCount,
            total: metrics.totalBrands,
          })}
          padding="sm"
        >
          <ProgressBar
            label="Hero image coverage"
            value={metrics.heroImage.percentage}
          />
        </DataCard>

        <SurfaceCard padding="sm">
          <h2 className="type-tool-heading">{t("linkCoverage")}</h2>
          <div className="mt-4 space-y-4">
            {linkRows.map((row) => {
              const metric = metrics.links[row.key];

              return (
                <div key={row.key} className="space-y-2">
                  <div className="flex min-h-6 items-center justify-between gap-4 type-body-sm">
                    <span className="font-medium text-ink">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-ink-muted">
                      {metric.count} / {metrics.totalBrands}
                    </span>
                  </div>
                  <ProgressBar
                    label={`${row.label} link coverage`}
                    value={metric.percentage}
                  />
                </div>
              );
            })}
          </div>
        </SurfaceCard>

        <DataCard
          label="Description Completeness"
          value={formatPercentage(metrics.description.percentage)}
          description={t("descriptionCompletenessDescription", {
            length: metrics.description.avgLength,
          })}
          padding="sm"
        >
          <ProgressBar
            label="Description completeness"
            value={metrics.description.percentage}
          />
        </DataCard>

        <SurfaceCard padding="sm">
          <h2 className="type-tool-heading">{t("completenessDistribution")}</h2>
          <div className="mt-4 space-y-4">
            {distributionRows.map((row) => {
              const count = metrics.completeness[row.key];
              const percentage =
                distributionTotal > 0 ? (count / distributionTotal) * 100 : 0;
              const relativePercentage =
                distributionMax > 0 ? (count / distributionMax) * 100 : 0;

              return (
                <div key={row.key} className="space-y-2">
                  <div className="flex min-h-6 items-center justify-between gap-4 type-body-sm">
                    <span className="font-medium text-ink">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-ink-muted">
                      {count} ({formatPercentage(percentage)})
                    </span>
                  </div>
                  <ProgressBar
                    label={`${row.label} completeness distribution`}
                    value={relativePercentage}
                  />
                </div>
              );
            })}
          </div>
        </SurfaceCard>

        <SurfaceCard padding="sm" className="md:col-span-2">
          <h2 className="type-tool-heading">{t("enrichmentQuality")}</h2>
          <div className="mt-4 space-y-4">
            {enrichmentRows.map((row) => {
              const value = metrics.enrichment[row.key];

              return (
                <div key={row.key} className="space-y-2">
                  <div className="flex min-h-6 items-center justify-between gap-4 type-body-sm">
                    <span className="font-medium text-ink">{row.label}</span>
                    <span className="shrink-0 tabular-nums text-ink-muted">
                      {formatPercentage(value)}
                    </span>
                  </div>
                  <ProgressBar
                    label={`${row.label} enrichment quality`}
                    value={value}
                  />
                </div>
              );
            })}

            <div className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-2">
              <div>
                <p className="type-body-sm font-medium text-ink">
                  {t("promoHeroImages")}
                </p>
                <p className="mt-1 type-section tabular-nums">
                  {metrics.enrichment.promoHeroCount}
                </p>
              </div>
              <div>
                <p className="type-body-sm font-medium text-ink">
                  {t("validationFailures")}
                </p>
                <p className="mt-1 type-section tabular-nums">
                  {metrics.enrichment.validationFailures}
                </p>
              </div>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard padding="sm" className="md:col-span-2">
          <h2 className="type-tool-heading">{t("vocabularyTitle")}</h2>
          <p className="mt-2 type-body-sm text-ink-muted">
            {t("vocabularyDescription", { days: vocabulary.windowDays })}
          </p>

          {vocabulary.readUnavailable ? (
            // Never presented as clean: this says the query did not run.
            <p className="mt-4 type-body-sm">
              {t("vocabularyUnavailable")}
            </p>
          ) : vocabulary.byField.length === 0 ? (
            <p className="mt-4 type-body-sm">
              {t("vocabularyClean", { spans: vocabulary.spansObserved })}
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <p className="type-body-sm">
                {t("vocabularyFound", {
                  hits: vocabulary.totalHits,
                  spans: vocabulary.spansObserved,
                })}
              </p>
              <ul className="space-y-2">
                {vocabulary.byField.map((hit) => (
                  <li
                    key={`${hit.field} ${hit.term}`}
                    className="flex min-h-6 items-center justify-between gap-4 type-body-sm"
                  >
                    <span className="font-medium text-ink">
                      {hit.field} — {hit.term}
                      {hit.replacement ? ` \u2192 ${hit.replacement}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-muted">
                      {hit.count}
                    </span>
                  </li>
                ))}
              </ul>
              {vocabulary.recentSpans.length > 0 && (
                <ul className="space-y-1 border-t border-rule pt-4">
                  {vocabulary.recentSpans.map((entry) => (
                    <li
                      key={`${entry.observedAt} ${entry.subjectId ?? ""} ${entry.operation}`}
                      className="flex min-h-6 items-center justify-between gap-4 type-body-sm text-ink-muted"
                    >
                      <span>
                        {entry.operation} —{" "}
                        {entry.subjectId ?? t("vocabularyNoSubject")}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {entry.hits}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
