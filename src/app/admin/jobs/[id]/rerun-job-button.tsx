"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { rerunCurationJobAction } from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/button";
import { inkActionClassName } from "@/components/admin/ink-action";

export function RerunJobButton({
  jobId,
  label,
}: {
  jobId: string;
  label: string;
}) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();
  const t = useTranslations("admin.jobs");

  async function handleRerun() {
    setIsPending(true);
    try {
      const result = await rerunCurationJobAction(jobId);
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
    <Button
      onClick={handleRerun}
      disabled={isPending}
      size="large"
      variant="secondary"
      className={inkActionClassName}
    >
      <RotateCcw aria-hidden="true" />
      {isPending ? t("actions.queuing") : label}
    </Button>
  );
}
