"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { resumeCurationJobAction } from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/button";

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
      className="min-h-12"
    >
      <PlayCircle aria-hidden="true" />
      {isPending ? "Queuing…" : "Resume failed targets"}
    </Button>
  );
}
