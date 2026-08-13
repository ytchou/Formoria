import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const BRAND_DETAIL_SRC_ROUTES = [
  "/[locale]/brands/[slug]",
  "/brands/[slug]",
];
export const BRAND_DETAIL_PRERENDER_BUDGET = 0;

/**
 * Return the concrete routes emitted for the brand detail page.
 *
 * The prerender manifest uses `srcRoute` to retain the dynamic source route
 * for each concrete output. The source route itself is not a concrete page,
 * so only manifest keys different from it count against this budget.
 */
export function findBrandPrerenderRoutes(manifest) {
  return Object.entries(manifest?.routes ?? {})
    .filter(
      ([route, entry]) =>
        !BRAND_DETAIL_SRC_ROUTES.includes(route) &&
        BRAND_DETAIL_SRC_ROUTES.includes(entry?.srcRoute),
    )
    .map(([route]) => route);
}

export function assertBrandPrerenderBudget(
  manifest,
  budget = BRAND_DETAIL_PRERENDER_BUDGET,
) {
  const routes = findBrandPrerenderRoutes(manifest);
  if (routes.length > budget) {
    throw new Error(
      `Brand detail prerender budget exceeded: ${routes.length} concrete routes found (budget ${budget}).`,
    );
  }
  return routes;
}

export function readPrerenderManifest(cwd = process.cwd()) {
  const manifestPath = resolve(cwd, ".next/prerender-manifest.json");
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

export function runBrandPrerenderBudgetCheck(cwd = process.cwd()) {
  const routes = assertBrandPrerenderBudget(readPrerenderManifest(cwd));
  console.log(
    `Brand detail prerender budget OK: ${routes.length}/${BRAND_DETAIL_PRERENDER_BUDGET} concrete routes.`,
  );
  return routes;
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  pathToFileURL(resolve(invokedPath)).href === import.meta.url
) {
  try {
    runBrandPrerenderBudgetCheck();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Brand prerender budget check failed.",
    );
    process.exitCode = 1;
  }
}
