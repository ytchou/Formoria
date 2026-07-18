"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { cancelCurationJobAction } from "@/app/admin/operations/actions";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";

export function CancelJobButton({ jobId }: { jobId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  async function handleCancel() {
    setIsPending(true);
    try {
      const result = await cancelCurationJobAction(jobId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setIsOpen(false);
      toast.success("Job cancelled");
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        disabled={isPending}
        className="min-h-12"
        variant="secondary"
      >
        <X aria-hidden="true" />
        Cancel job
      </Button>
      <ConfirmDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title="Cancel this job?"
        description="The worker will stop before the next canonical write. A provider request already in progress may still finish, but its result will not be applied."
        onConfirm={handleCancel}
        confirmLabel="Cancel job"
        variant="destructive"
        isPending={isPending}
      />
    </>
  );
}
