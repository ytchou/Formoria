"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { dismissCurationJobAction } from "@/app/admin/operations/actions";
import { Button } from "@/components/ui/button";

export function DismissJobButton({ jobId }: { jobId: string }) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  async function handleDismiss() {
    if (!confirm("Dismiss this job?")) return;
    setIsPending(true);
    try {
      const result = await dismissCurationJobAction(jobId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Job dismissed");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button
      onClick={handleDismiss}
      disabled={isPending}
      size="chip"
      variant="secondary"
    >
      <X aria-hidden="true" />
      {isPending ? "Dismissing…" : "Dismiss"}
    </Button>
  );
}
