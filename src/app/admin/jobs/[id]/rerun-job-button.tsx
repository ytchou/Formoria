"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { rerunCurationJobAction } from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/button";

export function RerunJobButton({
  jobId,
  label,
}: {
  jobId: string;
  label: string;
}) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

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
      className="min-h-12"
    >
      <RotateCcw aria-hidden="true" />
      {isPending ? "Queuing…" : label}
    </Button>
  );
}
