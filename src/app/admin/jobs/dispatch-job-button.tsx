"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  dispatchCurationJobAction,
  retryCurationDispatchAction,
} from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/button";

export function DispatchJobButton({
  jobId,
  label = "Run now",
  retry = false,
}: {
  jobId: string;
  label?: string;
  retry?: boolean;
}) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();
  const isRetry = label.toLowerCase().includes("retry");

  async function handleDispatch() {
    setIsPending(true);
    try {
      const action = retry
        ? retryCurationDispatchAction
        : dispatchCurationJobAction;
      const result = await action(jobId);
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
      {isRetry ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
      {isPending ? "Dispatching…" : label}
    </Button>
  );
}
