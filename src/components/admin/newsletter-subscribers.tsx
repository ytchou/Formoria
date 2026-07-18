"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MailCheck, UserMinus } from "lucide-react";
import { toast } from "sonner";
import {
  resendNewsletterConfirmationAction,
  unsubscribeNewsletterSubscriberAction,
} from "@/app/admin/newsletter/actions";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { surfaceCardStyles } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminNewsletterSubscriber } from "@/lib/services/newsletter";

const INTEREST_LABELS: Record<string, string> = {
  "brand-stories": "Brand stories",
  "new-brands": "New brands",
  "curated-picks": "Curated picks",
  "mit-trends": "MIT trends",
};

export function NewsletterSubscribersList({
  subscribers,
}: {
  subscribers: AdminNewsletterSubscriber[];
}) {
  const [unsubscribeId, setUnsubscribeId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function resend(subscriberId: string) {
    startTransition(async () => {
      const result = await resendNewsletterConfirmationAction(subscriberId);
      if ("error" in result) toast.error(result.error);
      else toast.success("Confirmation email sent");
    });
  }

  function unsubscribe() {
    if (!unsubscribeId) return;
    startTransition(async () => {
      const result = await unsubscribeNewsletterSubscriberAction(unsubscribeId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setUnsubscribeId(null);
      toast.success("Subscriber unsubscribed");
      router.refresh();
    });
  }

  return (
    <>
      <div className={surfaceCardStyles({ padding: "none", className: "overflow-x-auto" })}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subscriber</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Interests</TableHead>
              <TableHead>Locale</TableHead>
              <TableHead>Subscribed</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subscribers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No subscribers match these filters.
                </TableCell>
              </TableRow>
            ) : (
              subscribers.map((subscriber) => (
                <TableRow key={subscriber.id}>
                  <TableCell>
                    <p className="font-medium">{subscriber.email}</p>
                    {subscriber.name ? <p className="text-sm text-muted-foreground">{subscriber.name}</p> : null}
                  </TableCell>
                  <TableCell><StatusBadge status={subscriber.status} /></TableCell>
                  <TableCell>
                    <div className="flex max-w-72 flex-wrap gap-1.5">
                      {(subscriber.interests ?? []).map((interest) => (
                        <Badge key={interest} variant="outline">{INTEREST_LABELS[interest] ?? interest}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{subscriber.locale}</TableCell>
                  <TableCell>{formatDate(subscriber.subscribed_at)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {subscriber.status === "pending" ? (
                        <Button
                          variant="secondary"
                          className="min-h-12"
                          disabled={isPending}
                          onClick={() => resend(subscriber.id)}
                        >
                          <MailCheck aria-hidden="true" />
                          Resend confirmation
                        </Button>
                      ) : null}
                      {subscriber.status !== "unsubscribed" ? (
                        <Button
                          variant="secondary"
                          className="min-h-12"
                          disabled={isPending}
                          onClick={() => setUnsubscribeId(subscriber.id)}
                        >
                          <UserMinus aria-hidden="true" />
                          Unsubscribe
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog
        open={unsubscribeId !== null}
        onOpenChange={(open) => { if (!open) setUnsubscribeId(null); }}
        title="Unsubscribe this address?"
        description="This immediately opts the subscriber out and rotates their email tokens. Reactivation is not available from admin."
        onConfirm={unsubscribe}
        confirmLabel="Confirm unsubscribe"
        variant="destructive"
        isPending={isPending}
      />
    </>
  );
}

function StatusBadge({ status }: { status: AdminNewsletterSubscriber["status"] }) {
  const label = status === "active" ? "Active" : status === "unsubscribed" ? "Unsubscribed" : "Pending";
  return <Badge variant={status === "active" ? "verified" : status === "unsubscribed" ? "outline" : "secondary"}>{label}</Badge>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}
