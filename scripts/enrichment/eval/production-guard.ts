/**
 * Production target guard — extracted from brand-census.ts to avoid the CLI
 * entrypoint that brand-census.ts runs on non-Vitest import.
 */
import { PRODUCTION_PROJECT_REF } from "@/lib/supabase/project-target";

/**
 * Refuses to census production unless BOTH `--target production` and
 * `--confirm` are present.
 *
 * `loadScriptTarget` already proves the credentials belong to the declared
 * target, so the URL check here is the second, independent half: a production
 * project reached under any weaker declaration is a mistake, not a shortcut.
 * Nothing but the public project ref is ever printed.
 */
export function assertCensusTarget(input: {
  supabaseUrl: string;
  target: string;
  confirmed: boolean;
}): void {
  if (!input.supabaseUrl.includes(PRODUCTION_PROJECT_REF)) return;

  if (input.target !== "production") {
    throw new Error(
      `Refusing to run: the resolved Supabase URL names the production project ${PRODUCTION_PROJECT_REF} while --target says ${input.target}`,
    );
  }
  if (!input.confirmed) {
    throw new Error(
      `Refusing to run against production project ${PRODUCTION_PROJECT_REF} without --confirm`,
    );
  }
}
