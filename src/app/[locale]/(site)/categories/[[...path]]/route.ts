import { NextResponse, type NextRequest } from "next/server";
import { isVisibleCategory, subcategoryBySlug } from "@/lib/taxonomy/ontology";

/**
 * Catch-all redirect for retired category pages. Only visible taxonomy moves
 * to /discover; deferred or invalid paths are gone (410).
 *
 * - /categories          -> /discover
 * - /categories/[l1]     -> /discover?category=[l1]
 * - /categories/[l1]/[l2] -> /discover?category=[l1]&sub=[l2]
 *
 * The next.config.ts redirects handle legacy slug aliases (crafts, kids-pets,
 * etc.) before this route fires.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string; path?: string[] }> },
) {
  const { locale, path } = await params;
  const [l1, l2] = path ?? [];

  if (
    (l1 && !isVisibleCategory(l1)) ||
    (l2 && subcategoryBySlug(l2)?.category !== l1)
  ) {
    return new NextResponse(null, { status: 410 });
  }

  const baseUrl = new URL(request.url);

  // Build the /discover destination with optional query params
  const localePart = locale === "zh-TW" ? "" : `/${locale}`;
  const discoverPath = `${localePart}/discover`;
  const destination = new URL(discoverPath, baseUrl.origin);

  if (l1) {
    destination.searchParams.set("category", l1);
  }
  if (l2) {
    destination.searchParams.set("sub", l2);
  }

  return NextResponse.redirect(destination, { status: 301 });
}
