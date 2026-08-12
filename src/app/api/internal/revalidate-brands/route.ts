import { withAuditScope } from "@/lib/audit/scope";
import { NextResponse } from "next/server";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import {
  revalidatePublicBrands,
  revalidatePublicEvents,
} from "@/lib/cache/public-brand-cache";

export const runtime = "nodejs";

/**
 * Cap on `revalidatePath` calls per request, applied to `slugs` and `events`
 * COMBINED — a per-key cap let one request carry 200 of each and do twice the
 * documented work.
 */
const MAX_SLUGS = 200;

function readSlugKey(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" && key in payload
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

function isInvalidSlugList(value: unknown): boolean {
  return (
    !Array.isArray(value) ||
    value.some((slug) => typeof slug !== "string" || slug.trim() === "")
  );
}

export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload: unknown = await req.json();
    const slugs = readSlugKey(payload, "slugs");
    const events = readSlugKey(payload, "events");

    // A payload carrying neither key keeps the original contract: "Invalid slugs".
    // Each key is only validated when present, so a brand-only or an event-only
    // caller never has to send the other one.
    if (slugs === undefined && events === undefined) {
      return NextResponse.json({ error: "Invalid slugs" }, { status: 400 });
    }
    if (slugs !== undefined && isInvalidSlugList(slugs)) {
      return NextResponse.json({ error: "Invalid slugs" }, { status: 400 });
    }
    if (events !== undefined && isInvalidSlugList(events)) {
      return NextResponse.json({ error: "Invalid events" }, { status: 400 });
    }

    const brandSlugs = (slugs ?? []) as string[];
    const eventSlugs = (events ?? []) as string[];

    if (brandSlugs.length + eventSlugs.length > MAX_SLUGS) {
      return NextResponse.json({ error: "Too many slugs" }, { status: 400 });
    }

    if (events !== undefined) {
      revalidatePublicEvents(eventSlugs);
    }
    revalidatePublicBrands(brandSlugs);

    return NextResponse.json({
      revalidated: brandSlugs.length + eventSlugs.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
