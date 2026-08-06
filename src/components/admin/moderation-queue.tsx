"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  ReviewQueueDrawer,
  ReviewQueueTable,
  ReviewQueueToolbar,
  type ReviewColumn,
  useQueueAction,
  useReviewQueue,
} from "./queue";
import type { FlaggedContentItem } from "@/lib/services/moderation";

export type DecideAction = (
  id: string,
  decision: "reviewed" | "dismissed",
) => Promise<{ error?: string } | undefined>;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Taipei",
  });
}

export function ModerationQueue({
  items,
  decideAction,
}: {
  items: FlaggedContentItem[];
  decideAction?: DecideAction;
}) {
  const t = useTranslations("admin.moderation");
  const queueT = useTranslations("admin.queue");
  const queueAction = useQueueAction();
  const queue = useReviewQueue({
    items,
    getId: (item) => item.id,
    pageSize: null,
  });
  const openItemValue =
    queue.items.find((item) => item.id === queue.openId) ?? null;

  function openItem(item: FlaggedContentItem) {
    queueAction.clearError();
    queue.toggleOpen(item.id);
  }
  function decide(
    item: FlaggedContentItem,
    decision: "reviewed" | "dismissed",
  ) {
    void queueAction.run([item.id], async () => {
      try {
        const result = await decideAction?.(item.id, decision);
        return result?.error ? { error: result.error } : undefined;
      } catch (e) {
        return { error: e instanceof Error ? e.message : t("errors.generic") };
      }
    });
  }

  const columns: ReviewColumn<FlaggedContentItem>[] = [
    {
      id: "brand",
      header: t("columnBrand"),
      cell: (item) => item.brandName,
      cellClassName: "font-medium min-w-56",
    },
    { id: "field", header: t("columnField"), cell: (item) => item.fieldName },
    {
      id: "rule",
      header: t("columnRule"),
      cell: (item) =>
        t.has(`rules.${item.reason}`) ? t(`rules.${item.reason}`) : item.reason,
      cellClassName: "type-metadata",
    },
    {
      id: "explanation",
      header: t("columnExplanation"),
      cell: (item) =>
        item.flaggedContent.length > 120
          ? `${item.flaggedContent.slice(0, 120)}...`
          : item.flaggedContent,
      cellClassName: "max-w-lg min-w-64",
    },
    {
      id: "detected",
      header: t("columnDetected"),
      cell: (item) => formatDate(item.createdAt),
    },
    {
      id: "actions",
      header: t("columnActions"),
      cell: (item) => (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="compact"
            className="min-h-12"
            disabled={queueAction.isRowPending(item.id)}
            onClick={() => decide(item, "reviewed")}
          >
            {t("markReviewed")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="compact"
            className="min-h-12"
            disabled={queueAction.isRowPending(item.id)}
            onClick={() => decide(item, "dismissed")}
          >
            {t("dismiss")}
          </Button>
        </div>
      ),
      cellClassName: "min-w-56",
    },
  ];

  return (
    <div>
      <ReviewQueueToolbar queue={queue} />
      <ReviewQueueTable
        queue={queue}
        columns={columns}
        emptyMessage={t("noBlockedContent")}
        getRowName={(item) => item.brandName}
        onRowActivate={openItem}
        isRowPending={(item) => queueAction.isRowPending(item.id)}
        error={openItemValue === null ? queueAction.error : null}
        disclosureControlsId={(item) => `moderation-details-${item.id}`}
        disclosureLabel={(item, expanded) =>
          queueT(expanded ? "hideDetails" : "showDetails", {
            name: item.brandName,
          })
        }
      />
      {/* ReviewQueueTable always renders a disclosure button per row; the drawer gives it something to open while decisions stay in the row. */}
      <ReviewQueueDrawer
        item={openItemValue}
        open={openItemValue !== null}
        onClose={() => queue.setOpenId(null)}
        title={(item) => item.brandName}
        metadata={(item) => (
          <p className="type-metadata">
            {item.fieldName} · {formatDate(item.createdAt)}
          </p>
        )}
        bodyId={(item) => `moderation-details-${item.id}`}
      >
        {(item) => (
          <div className="space-y-4">
            <div>
              <p className="type-metadata">{t("columnField")}</p>
              <p>{item.fieldName}</p>
            </div>
            <div>
              <p className="type-metadata">{t("columnRule")}</p>
              <p>
                {t.has(`rules.${item.reason}`)
                  ? t(`rules.${item.reason}`)
                  : item.reason}
              </p>
            </div>
            <div>
              <p className="type-metadata">{t("columnExplanation")}</p>
              <p className="whitespace-pre-wrap">{item.flaggedContent}</p>
            </div>
          </div>
        )}
      </ReviewQueueDrawer>
    </div>
  );
}
