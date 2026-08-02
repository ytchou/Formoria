import { NextResponse } from "next/server";
import {
  revalidatePublicBrand,
  revalidatePublicEvent,
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

export async function POST(req: Request) {
  const originSecret = process.env.ORIGIN_SECRET?.trim();
  // A blank server-side secret must never make every caller authorized.
  if (!originSecret || req.headers.get("x-origin-verify") !== originSecret) {
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

    for (const slug of brandSlugs) {
      revalidatePublicBrand({ slug });
    }

    if (events !== undefined) {
      // An empty list still means "events changed": the hub and the sitemap are
      // stale even when no detail page was named.
      if (eventSlugs.length === 0) {
        revalidatePublicEvent();
      }
      for (const slug of eventSlugs) {
        revalidatePublicEvent({ slug });
      }
    }

    return NextResponse.json({
      revalidated: brandSlugs.length + eventSlugs.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
