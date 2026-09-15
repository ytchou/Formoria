"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { retryPhaseAction } from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { inkActionClassName } from "@/components/admin/ink-action";
import {
  BLOCK_OF_PHASE,
  type BlockName,
  type RetryParams,
} from "@/lib/constants/enrich-phases";

const BLOCK_OF_PHASE_MAP = BLOCK_OF_PHASE as Record<string, BlockName>;

export function RetryPhaseMenu({
  jobId,
  targetId,
  phase,
}: {
  jobId: string;
  targetId: string;
  phase: string;
}) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();
  const t = useTranslations("admin.jobs");

  const block = BLOCK_OF_PHASE_MAP[phase];
  if (!block) return null;

  const subPhase =
    block === "editorial"
      ? (phase as "descriptions" | "stockists" | "faq")
      : undefined;

  async function handleRetry(mode: "only" | "with_upstream") {
    setIsPending(true);
    try {
      const retry: RetryParams = { block, mode, subPhase };
      const result = await retryPhaseAction(jobId, targetId, retry);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      if (result.dispatchStatus === "failed") toast.error(result.message);
      else toast.success(result.message);
      router.push(result.detailPath);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="compact"
            variant="secondary"
            className={inkActionClassName}
            disabled={isPending}
          />
        }
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {isPending ? t("actions.queuing") : t("actions.retryPhase")}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => handleRetry("only")}>
          {t("actions.retryOnly")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleRetry("with_upstream")}>
          {t("actions.retryWithUpstream")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
