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

    const brandSlugs = toSlugList(body.slugs);
    if (!brandSlugs) {
      return NextResponse.json({ error: "Invalid slugs" }, { status: 400 });
    }
    const trails = toSlugList(body.trailSlugs);
    if (!trails) {
      return NextResponse.json(
        { error: "Invalid trailSlugs" },
        { status: 400 },
      );
    }

    if (brandSlugs.length > MAX_SLUGS) {
      return NextResponse.json({ error: "Too many slugs" }, { status: 400 });
    }
    if (trails.length > MAX_SLUGS) {
      return NextResponse.json(
        { error: "Too many trailSlugs" },
        { status: 400 },
      );
    }

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
