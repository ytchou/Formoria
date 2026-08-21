"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { dispatchCurationJobAction } from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/button";

export function DispatchJobButton({
  jobId,
  label = "Run this job now",
}: {
  jobId: string;
  label?: string;
}) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();
  const t = useTranslations("admin.jobs");
  async function handleDispatch() {
    setIsPending(true);
    try {
      const result = await dispatchCurationJobAction(jobId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      if (result.dispatchStatus === "failed") toast.error(result.message);
      else toast.success(result.message);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button
      onClick={handleDispatch}
      disabled={isPending}
      size="chip"
      variant="secondary"
    >
      <Play aria-hidden="true" />
      {isPending ? t("actions.dispatching") : label}
    </Button>
  );
}
