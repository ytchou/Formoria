import type { RenderProvider } from "./enrich-phases/scraper/render/types";
import type { RenderProviderWithBudget } from "./enrich-phases/scraper/render/provider";

export type RenderHandle = { provider: RenderProvider; owned: boolean };

/**
 * Resolve a render provider: use the injected one when present (not owned),
 * otherwise call the factory to create one (owned — caller must release it).
 */
export function resolveRenderProvider(
  options: { renderProvider?: RenderProvider },
  create: () => RenderProviderWithBudget,
): RenderHandle {
  if (options.renderProvider) {
    return { provider: options.renderProvider, owned: false };
  }
  return { provider: create(), owned: true };
}

/**
 * Release a render provider. Only closes providers this process created
 * (`owned: true`). Errors are logged and swallowed — a failed browser
 * shutdown must never mask the job's real outcome.
 */
export async function releaseRenderProvider(
  handle: RenderHandle,
): Promise<void> {
  if (!handle.owned) return;
  try {
    await handle.provider.close?.();
  } catch (error) {
    console.error(
      "[curation-worker] render provider close failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
