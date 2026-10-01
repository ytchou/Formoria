import { withAuditScope } from "@/lib/audit/scope";
import { NextResponse } from "next/server";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import {
  revalidatePublicBrands,
  revalidateTrailSurfaces,
} from "@/lib/cache/public-brand-cache";

export const runtime = "nodejs";

/** Cap on `revalidatePath` calls per request. */
const MAX_SLUGS = 200;

/** An absent list is empty; anything but non-blank strings is invalid (null). */
function toSlugList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((slug) => typeof slug !== "string" || slug.trim() === "")
  ) {
    return null;
  }
  return value as string[];
}

const SLUG_FIELDS = ["slugs", "trailSlugs"] as const;
type SlugField = (typeof SLUG_FIELDS)[number];

/**
 * Both lists, or the 400 message for the first problem. Every list is checked
 * for shape before any is checked against the cap.
 */
function parseSlugLists(
  body: Record<string, unknown>,
): { lists: Record<SlugField, string[]> } | { error: string } {
  const lists: Partial<Record<SlugField, string[]>> = {};
  for (const field of SLUG_FIELDS) {
    const list = toSlugList(body[field]);
    if (!list) return { error: `Invalid ${field}` };
    lists[field] = list;
  }
  for (const field of SLUG_FIELDS) {
    if (lists[field]!.length > MAX_SLUGS) return { error: `Too many ${field}` };
  }
  return { lists: lists as Record<SlugField, string[]> };
}

export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload: unknown = await req.json();
    const body =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : {};
    if (body.slugs === undefined && body.trailSlugs === undefined) {
      return NextResponse.json({ error: "Invalid slugs" }, { status: 400 });
    }

    const parsed = parseSlugLists(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { slugs: brandSlugs, trailSlugs: trails } = parsed.lists;

    if (brandSlugs.length > 0) revalidatePublicBrands(brandSlugs);
    if (trails.length > 0) revalidateTrailSurfaces(trails);

    return NextResponse.json({
      revalidated: brandSlugs.length + trails.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
