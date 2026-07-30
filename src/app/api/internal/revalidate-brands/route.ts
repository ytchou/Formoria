import { NextResponse } from "next/server";
import { revalidatePublicBrand } from "@/lib/cache/public-brand-cache";

export const runtime = "nodejs";

const MAX_SLUGS = 200;

export async function POST(req: Request) {
  const originSecret = process.env.ORIGIN_SECRET?.trim();
  // A blank server-side secret must never make every caller authorized.
  if (!originSecret || req.headers.get("x-origin-verify") !== originSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload: unknown = await req.json();
    const slugs =
      payload && typeof payload === "object" && "slugs" in payload
        ? (payload as { slugs: unknown }).slugs
        : undefined;

    if (
      !Array.isArray(slugs) ||
      slugs.length > MAX_SLUGS ||
      slugs.some((slug) => typeof slug !== "string" || slug.trim() === "")
    ) {
      return NextResponse.json({ error: "Invalid slugs" }, { status: 400 });
    }

    for (const slug of slugs as string[]) {
      revalidatePublicBrand({ slug });
    }

    return NextResponse.json({ revalidated: slugs.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
