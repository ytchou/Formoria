import { getTranslations } from "next-intl/server";

import { Grid } from "@/components/ui/grid";
import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** One full row at the widest `catalog` breakpoint, twice. */
const SKELETON_CARDS = 10;

/**
 * /discover streams this while a situation search runs (DEV-1991). The shape
 * follows page.tsx: DirectoryHeader (title + search box), the lg filter aside,
 * and the `catalog` product grid with square ProductCard images. Reduced
 * motion is handled globally (see ui/skeleton.tsx).
 */
export default async function Loading() {
  const t = await getTranslations("common");
  return (
    <PageShell as="main" measure="page" className="pt-12 pb-section">
      <p role="status" className="sr-only">
        {t("loading")}
      </p>
      <div aria-hidden="true" className="space-y-stack">
        <div className="flex flex-col gap-6 border-b border-rule pb-6 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          <div className="min-w-0 space-y-3">
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-11 w-full lg:w-xl lg:shrink-0" />
        </div>
        <div className="flex flex-col gap-8 lg:flex-row">
          <div className="hidden shrink-0 space-y-3 px-1 py-4 lg:block lg:w-56">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
          <div className="min-w-0 flex-1 space-y-6">
            <Skeleton className="h-9 w-48" />
            <Grid cols="catalog">
              {Array.from({ length: SKELETON_CARDS }).map((_, i) => (
                <div key={i} className="flex flex-col">
                  <Skeleton className="aspect-square w-full" />
                  <div className="mt-3 flex flex-col gap-1">
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                </div>
              ))}
            </Grid>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
