import { withAuditScope } from "@/lib/audit/scope";
import { NextResponse } from "next/server";
import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";
import { revalidatePublicBrands } from "@/lib/cache/public-brand-cache";

export const runtime = "nodejs";

/** Cap on `revalidatePath` calls per request. */
const MAX_SLUGS = 200;

export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload: unknown = await req.json();
    const slugs =
      payload && typeof payload === "object" && "slugs" in payload
        ? (payload as Record<string, unknown>).slugs
        : undefined;

    if (
      slugs === undefined ||
      !Array.isArray(slugs) ||
      slugs.some((slug) => typeof slug !== "string" || slug.trim() === "")
    ) {
      return NextResponse.json({ error: "Invalid slugs" }, { status: 400 });
    }

    if (slugs.length > MAX_SLUGS) {
      return NextResponse.json({ error: "Too many slugs" }, { status: 400 });
    }

    revalidatePublicBrands(slugs);

    return NextResponse.json({ revalidated: slugs.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
