import { NextResponse } from "next/server";
import {
  revalidateLocalizedPath,
  revalidatePublicBrand,
} from "@/lib/cache/public-brand-cache";

export const runtime = "nodejs";

const MAX_SLUGS = 200;

function readSlugKey(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" && key in payload
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

function isInvalidSlugList(value: unknown): boolean {
  return (
    !Array.isArray(value) ||
    value.length > MAX_SLUGS ||
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

    for (const slug of brandSlugs) {
      revalidatePublicBrand({ slug });
    }

    if (events !== undefined) {
      // The hub lists every event, so any event write makes it stale even when
      // no single detail page was touched.
      revalidateLocalizedPath("/events");
      for (const slug of eventSlugs) {
        revalidateLocalizedPath(`/events/${slug}`);
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
