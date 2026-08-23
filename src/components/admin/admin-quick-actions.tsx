"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DatabaseZap } from "lucide-react";
import { toast } from "sonner";
import { startNeedsDataSubmissionEnrichmentAction } from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/button";

export function AdminQuickActions({ needsDataCount }: { needsDataCount: number | null }) {
  const t = useTranslations("admin.dashboard");
  const [isEnriching, startEnrichment] = useTransition();
  const router = useRouter();

  function enrichNeedsData() {
    startEnrichment(async () => {
      const result = await startNeedsDataSubmissionEnrichmentAction();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const notify = result.dispatchStatus === "failed" ? toast.error : toast.info;
      notify(result.message, {
        action: { label: "View job", onClick: () => router.push(result.detailPath) },
      });
      router.refresh();
    });
  }

  return (
    <div className="max-w-md">
      <Button
        onClick={enrichNeedsData}
        disabled={needsDataCount === null || needsDataCount === 0 || isEnriching}
        className="justify-start"
        size="large"
        variant="secondary"
      >
        <DatabaseZap aria-hidden="true" />
        {isEnriching
          ? t("quickActions.enriching")
          : t("quickActions.enrichNeedsData")}
      </Button>
    </div>
  );
}
