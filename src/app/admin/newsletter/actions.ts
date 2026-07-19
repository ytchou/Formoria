"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/require-admin";
import { createServiceClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/services/admin-audit";
import {
  adminUnsubscribeNewsletterSubscriber,
  resendNewsletterConfirmation,
} from "@/lib/services/newsletter";

export async function resendNewsletterConfirmationAction(
  subscriberId: string,
): Promise<{ resent: true } | { error: string }> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;
    if (!isUuid(subscriberId)) return { error: "Invalid subscriber ID" };
    await resendNewsletterConfirmation(createServiceClient(), subscriberId);
    void logAdminAction({
      adminUserId: auth.user.id,
      adminEmail: auth.user.email ?? auth.user.id,
      action: "newsletter_confirmation_resent",
      metadata: { subscriberId },
    });
    revalidatePath("/admin/newsletter");
    return { resent: true };
  } catch (error) {
    console.error("[admin:newsletter:resend]", error);
    return { error: error instanceof Error ? error.message : "An unexpected error occurred" };
  }
}

export async function unsubscribeNewsletterSubscriberAction(
  subscriberId: string,
): Promise<{ unsubscribed: true } | { error: string }> {
  try {
    const auth = await requireAdminAction();
    if ("error" in auth) return auth;
    if (!isUuid(subscriberId)) return { error: "Invalid subscriber ID" };
    await adminUnsubscribeNewsletterSubscriber(createServiceClient(), subscriberId);
    void logAdminAction({
      adminUserId: auth.user.id,
      adminEmail: auth.user.email ?? auth.user.id,
      action: "newsletter_unsubscribed",
      metadata: { subscriberId },
    });
    revalidatePath("/admin");
    revalidatePath("/admin/newsletter");
    return { unsubscribed: true };
  } catch (error) {
    console.error("[admin:newsletter:unsubscribe]", error);
    return { error: error instanceof Error ? error.message : "An unexpected error occurred" };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
