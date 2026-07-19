import { requireAdminAction } from "@/lib/auth/require-admin";
import { getRequestOrigin } from "@/lib/auth/site-url";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getAdminNewsletterExport,
  parseAdminNewsletterFilters,
  type AdminNewsletterSubscriber,
} from "@/lib/services/newsletter";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const auth = await requireAdminAction();
  if ("error" in auth) {
    if (auth.code === "unauthenticated") {
      const signInUrl = new URL("/auth/sign-in", await getRequestOrigin());
      signInUrl.searchParams.set("next", "/admin/newsletter");
      return Response.redirect(signInUrl, 307);
    }
    return new Response(auth.error, { status: 403 });
  }

  const url = new URL(request.url);
  const filters = parseAdminNewsletterFilters({
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    interest: url.searchParams.get("interest") ?? undefined,
  });
  const subscribers = await getAdminNewsletterExport(createServiceClient(), filters);
  const date = new Date().toISOString().slice(0, 10);

  return new Response(`\uFEFF${toNewsletterCsv(subscribers)}`, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="newsletter-subscribers-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}

export function toNewsletterCsv(subscribers: AdminNewsletterSubscriber[]): string {
  const headers = [
    "email", "name", "status", "interests", "locale", "subscribed_at",
    "confirmed_at", "unsubscribed_at", "consent_source", "consent_version",
    "consent_recorded_at",
  ];
  const rows = subscribers.map((subscriber) => [
    subscriber.email,
    subscriber.name ?? "",
    subscriber.status,
    (subscriber.interests ?? []).join("|"),
    subscriber.locale,
    subscriber.subscribed_at,
    subscriber.confirmed_at ?? "",
    subscriber.unsubscribed_at ?? "",
    subscriber.consent_source ?? "",
    subscriber.consent_version ?? "",
    subscriber.consent_recorded_at ?? "",
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
