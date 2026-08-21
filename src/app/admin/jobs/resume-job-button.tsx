"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { resumeCurationJobAction } from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/button";
import { inkActionClassName } from "@/components/admin/ink-action";

export function ResumeJobButton({ jobId }: { jobId: string }) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();
  const t = useTranslations("admin.jobs");

  async function handleResume() {
    setIsPending(true);
    try {
      const result = await resumeCurationJobAction(jobId);
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
      onClick={handleResume}
      disabled={isPending}
      size="large"
      variant="secondary"
      className={inkActionClassName}
    >
      <PlayCircle aria-hidden="true" />
      {isPending ? t("actions.queuing") : t("actions.resumeFailedTargets")}
    </Button>
  );
}
