"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  PROOF_TYPE_I18N_KEYS,
  type ProofEvidence,
} from "@/lib/services/claim-proofs";
import type { ClaimRequest } from "@/lib/services/claim-requests";
import {
  formatReviewDate,
  ReviewDecisionPanel,
  ReviewQueueDrawer,
  ReviewQueuePagination,
  ReviewQueueTable,
  ReviewQueueToolbar,
  reviewStatusVariant,
  type ReviewColumn,
  type ReviewTab,
  useQueueAction,
  useReviewQueue,
} from "./queue";
import { routes } from "@/lib/routes";

type SignedProofEvidence = ProofEvidence & { signedUrl?: string };
export type ClaimRequestWithSignedProof = Omit<
  ClaimRequest,
  "proofEvidence"
> & { proofEvidence: SignedProofEvidence[] };
type ApproveAction = (
  id: string,
) => Promise<{ error?: string; warning?: string } | undefined>;
type RejectAction = (
  id: string,
  notes: string,
) => Promise<{ error?: string; warning?: string } | undefined>;
type RejectReasonKey =
  | "insufficientProof"
  | "proofMismatch"
  | "emailUnverified"
  | "alreadyClaimed"
  | "screenshotInsufficient"
  | "docMismatch"
  | "proofInauthentic"
  | "needMoreEvidence";
const REJECT_REASON_KEYS: RejectReasonKey[] = [
  "insufficientProof",
  "proofMismatch",
  "emailUnverified",
  "alreadyClaimed",
  "screenshotInsufficient",
  "docMismatch",
  "proofInauthentic",
  "needMoreEvidence",
];

function isClickableProofUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function ClaimRequestsList({
  claimRequests,
  approveAction,
  rejectAction,
}: {
  claimRequests: ClaimRequestWithSignedProof[];
  approveAction?: ApproveAction;
  rejectAction?: RejectAction;
}) {
  const t = useTranslations("admin.claimRequests");
  const proofTypesT = useTranslations("brands.claimCta.proofTypes");
  const queueT = useTranslations("admin.queue");
  const queueAction = useQueueAction();
  const [rejectArmedId, setRejectArmedId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const tabs = useMemo<ReviewTab<ClaimRequestWithSignedProof>[]>(
    () =>
      ["all", "pending", "approved", "rejected"].map((value) => ({
        value,
        label: t(`tabs.${value}`),
        match: (item) => value === "all" || item.status === value,
      })),
    [t],
  );
  const queue = useReviewQueue({
    items: claimRequests,
    getId: (item) => item.id,
    tabs,
    initialTab: "pending",
  });
  const openItemValue =
    claimRequests.find((item) => item.id === queue.openId) ?? null;
  const getRowName = (item: ClaimRequestWithSignedProof) =>
    item.brandName ?? t("unknownBrand");
  function resetReject() {
    setRejectArmedId(null);
    setRejectNotes("");
  }
  function onResult(result: { ok: boolean; warning?: string }) {
    if (result.ok) {
      setWarning(result.warning ? t("cleanupWarning") : null);
      resetReject();
      queue.setOpenId(null);
    }
  }
  function runApprove(item: ClaimRequestWithSignedProof) {
    void queueAction.run(
      [item.id],
      async () => {
        try {
          const result = await approveAction?.(item.id);
          if (result?.error) return { error: result.error };
          return result?.warning ? { warning: result.warning } : undefined;
        } catch (e) {
          return {
            error: e instanceof Error ? e.message : t("errors.generic"),
          };
        }
      },
      { onResult },
    );
  }
  // Claims owns this two-step so the preset picker and notes UI can appear after the first click.
  function runReject(item: ClaimRequestWithSignedProof) {
    if (rejectArmedId !== item.id) {
      setRejectArmedId(item.id);
      setRejectNotes("");
      queueAction.clearError();
      return;
    }
    const notes = rejectNotes.trim();
    if (!notes) {
      queueAction.setError(t("errors.rejectNotesRequired"));
      return;
    }
    void queueAction.run(
      [item.id],
      async () => {
        try {
          const result = await rejectAction?.(item.id, notes);
          if (result?.error) return { error: result.error };
          return result?.warning ? { warning: result.warning } : undefined;
        } catch (e) {
          return {
            error: e instanceof Error ? e.message : t("errors.generic"),
          };
        }
      },
      { onResult },
    );
  }
  function openItem(item: ClaimRequestWithSignedProof) {
    queueAction.clearError();
    resetReject();
    setWarning(null);
    queue.toggleOpen(item.id);
  }
  const columns: ReviewColumn<ClaimRequestWithSignedProof>[] = [
    {
      id: "brand",
      header: t("table.brand"),
      cell: getRowName,
      cellClassName: "font-medium",
    },
    {
      id: "requester",
      header: t("table.requester"),
      cell: (item) => (
        <div>
          <span>{item.requesterEmail ?? t("unknownRequester")}</span>
          {item.existingOwnedBrand ? (
            <span className="mt-1 block type-label text-danger">
              {t("ownerAlreadyManagesShort")}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "proof",
      header: t("table.proof"),
      cell: (item) => item.proofEvidence.length,
    },
    {
      id: "date",
      header: t("table.date"),
      cell: (item) => formatReviewDate(item.createdAt),
    },
    {
      id: "status",
      header: t("table.status"),
      cell: (item) => (
        <Badge variant={reviewStatusVariant(item.status)}>
          {t(`tabs.${item.status}`)}
        </Badge>
      ),
    },
  ];
  function renderBody(item: ClaimRequestWithSignedProof): ReactNode {
    return (
      <div className="space-y-4">
        {item.existingOwnedBrand ? (
          <div className="rounded-surface border border-danger/30 bg-danger/5 p-4">
            <p className="type-body-sm font-semibold text-danger">
              {t("ownerAlreadyManagesTitle")}
            </p>
            <p className="mt-1 type-body-sm">
              {t("ownerAlreadyManagesBody", {
                brandName: item.existingOwnedBrand.brandName,
              })}
            </p>
            <a
              href={routes.brand(item.existingOwnedBrand.brandSlug)}
              className="mt-2 inline-block type-nav font-semibold text-accent underline-offset-4 hover:underline underline"
            >
              {item.existingOwnedBrand.brandName}
            </a>
          </div>
        ) : null}
        <div className="space-y-3">
          <p className="type-metadata">{t("proofEvidence")}</p>
          {item.proofEvidence.length ? (
            <div className="space-y-3">
              {item.proofEvidence.map((proof, index) => (
                <div
                  key={`${proof.type}-${proof.url ?? proof.imageKey ?? index}`}
                  className="rounded-surface border border-rule bg-surface p-4"
                >
                  <div className="space-y-3">
                    <p className="type-body-sm font-medium text-ink">
                      {proofTypesT(`${PROOF_TYPE_I18N_KEYS[proof.type]}.label`)}
                    </p>
                    {proof.type === "domain_email" ? (
                      <span
                        className={
                          proof.verified
                            ? "inline-flex rounded-full bg-verified-green-bg px-2 py-0.5 type-metadata text-verified-green"
                            : "inline-flex rounded-full bg-surface px-2 py-0.5 type-metadata"
                        }
                      >
                        {proof.verified
                          ? t("domainEmailVerified")
                          : t("domainEmailPending")}
                      </span>
                    ) : null}
                    {proof.url && isClickableProofUrl(proof.url) ? (
                      <a
                        href={proof.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-block break-all type-body-sm text-accent underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {proof.url}
                      </a>
                    ) : null}
                    {proof.url && !isClickableProofUrl(proof.url) ? (
                      <p className="break-all type-body-sm">
                        {proof.url}
                      </p>
                    ) : null}
                    {proof.signedUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element -- Private signed proof URLs are short-lived review thumbnails. */}
                        <img
                          src={proof.signedUrl}
                          alt={proofTypesT(
                            `${PROOF_TYPE_I18N_KEYS[proof.type]}.label`,
                          )}
                          className="h-20 w-20 rounded-surface border border-rule object-cover"
                        />
                      </>
                    ) : null}
                    {proof.note ? (
                      <p className="type-body-sm">{proof.note}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="type-body-sm">{t("noProofEvidence")}</p>
          )}
        </div>
        {item.mitSmileCert ? (
          <div>
            <p className="type-metadata">{t("mitCertApprovalLabel")}</p>
            <p className="mt-1 type-body-sm text-ink-soft">{item.mitSmileCert}</p>
            {item.mitRegistryCompanyName ? (
              <p className="mt-1 type-body-sm">
                {t("mitRegistryCompanyLabel")}: {item.mitRegistryCompanyName}
              </p>
            ) : null}
          </div>
        ) : null}
        {item.reviewerNotes ? (
          <div>
            <p className="type-metadata">{t("reviewerNotes")}</p>
            <p className="mt-1 type-body-sm text-ink-soft">{item.reviewerNotes}</p>
          </div>
        ) : null}
        {item.status !== "pending" && item.proofCleanupStatus ? (
          <div className="space-y-1 rounded-surface border border-rule bg-surface p-4">
            <p className="type-metadata">{t("cleanupStatus.label")}</p>
            <Badge
              variant={
                item.proofCleanupStatus === "completed"
                  ? "success"
                  : item.proofCleanupStatus === "failed"
                    ? "destructive"
                    : "warning"
              }
            >
              {t(`cleanupStatus.${item.proofCleanupStatus}.label`)}
            </Badge>
            <p className="type-body-sm">
              {t(`cleanupStatus.${item.proofCleanupStatus}.description`)}{" "}
            </p>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      <ReviewQueueToolbar queue={queue}>
        {warning ? (
          <p
            className="rounded-surface border border-warning/30 bg-warning/10 px-4 py-3 type-body-sm text-warning"
            role="status"
          >
            {warning}
          </p>
        ) : null}
      </ReviewQueueToolbar>
      <ReviewQueueTable
        queue={queue}
        columns={columns}
        emptyMessage={t("empty")}
        getRowName={getRowName}
        onRowActivate={openItem}
        isRowPending={(item) => queueAction.isRowPending(item.id)}
        error={openItemValue === null ? queueAction.error : null}
        disclosureControlsId={(item) => `claim-details-${item.id}`}
        disclosureLabel={(item, expanded) =>
          queueT(expanded ? "hideDetails" : "showDetails", {
            name: getRowName(item),
          })
        }
      />
      <ReviewQueuePagination queue={queue} />
      <ReviewQueueDrawer
        item={openItemValue}
        open={openItemValue !== null}
        onClose={() => queue.setOpenId(null)}
        title={getRowName}
        bodyId={(item) => `claim-details-${item.id}`}
        footer={(item) =>
          item.status === "pending" ? (
            <div className="space-y-4 pt-5">
              {rejectArmedId === item.id ? (
                <div className="space-y-2">
                  <NativeSelect
                    aria-label={t("rejectReasons.label")}
                    // Pinned to the placeholder: this select is a one-shot
                    // template picker that writes into the notes textarea, not
                    // a field with a value of its own.
                    value=""
                    onChange={(e) => {
                      setRejectNotes(
                        t(`rejectReasons.${e.currentTarget.value}`),
                      );
                    }}
                  >
                    <option value="" disabled>
                      {t("rejectReasons.placeholder")}
                    </option>
                    {REJECT_REASON_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {t(`rejectReasons.${key}`)}
                      </option>
                    ))}
                  </NativeSelect>
                  <Textarea
                    autoFocus
                    aria-label={t("rejectNotesLabel")}
                    placeholder={t("rejectNotesPlaceholder")}
                    value={rejectNotes}
                    onChange={(e) => setRejectNotes(e.target.value)}
                  />
                </div>
              ) : null}
              <ReviewDecisionPanel
                onApprove={() => runApprove(item)}
                onReject={() => runReject(item)}
                notesPolicy="none"
                approveLabel={t("actions.approve")}
                rejectLabel={
                  rejectArmedId === item.id
                    ? t("actions.confirmReject")
                    : t("actions.reject")
                }
                eligible={!item.existingOwnedBrand}
                isPending={queueAction.isRowPending(item.id)}
                error={queueAction.error}
              />
            </div>
          ) : undefined
        }
      >
        {renderBody}
      </ReviewQueueDrawer>
    </div>
  );
}
