"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { resumeCurationJobAction } from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/button";
import { inkActionClassName } from "@/components/admin/ink-action";
import { cn } from "@/lib/utils";

export function ResumeJobButton({ jobId }: { jobId: string }) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

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
      className={cn("min-h-12", inkActionClassName)}
    >
      <PlayCircle aria-hidden="true" />
      {isPending ? "Queuing…" : "Resume failed targets"}
    </Button>
  );
}
