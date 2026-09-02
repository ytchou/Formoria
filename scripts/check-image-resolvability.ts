/**
 * DEV-1568 — health check: can the read proxy actually serve every image the
 * site renders?
 *
 * A unit test cannot answer this. The function that builds the `/i/` URL is
 * correct and its tests were green throughout the staging outage; what broke
 * is the agreement between three things that only exist at run time — the
 * `brand_images` rows, the objects in that project's bucket, and the proxy's
 * deny-list. This repo has no database-backed tests and forbids mocking
 * Supabase, so the guard is a check you run against a project, and the rule it
 * applies is the pure, unit-tested `planImageResolvability`.
 *
 *   pnpm check:image-resolvability                       # staging
 *   pnpm check:image-resolvability --project-ref <ref>   # staging or production
 *
 * Exits non-zero when any rendered row is unservable, so it can gate a deploy.
 *
 * READ-ONLY by construction: the client comes from `createWriteBlockingClient`,
 * so no code path here can write to the project it inspects, and an attempted
 * write fails the check instead of happening quietly.
 *
 * Credentials come from `supabase projects api-keys`, reusing
 * `sync-staging-from-prod.ts`'s resolver rather than a second path — the
 * environment holds PRODUCTION under generic names, and
 * `scripts/check-service-registry.mjs` hard-fails on new credential-shaped env
 * vars.
 *
 * Ceiling: the bucket inventory is one `list` call per distinct folder
 * (`brands/<brand-id>/`), so the cost scales with brands, not images. If that
 * ever gets slow, query `storage.objects` directly over a database connection
 * instead of the storage API.
 */
import { type SupabaseClient } from "@supabase/supabase-js";

import {
  PAGE_SIZE,
  STORAGE_BUCKET,
  listStorageKeys,
  resolveServiceRoleKey,
  storageFoldersOf,
} from "./sync-staging-from-prod";
import { createWriteBlockingClient } from "./lib/readonly-client";
import {
  isFullyResolvable,
  planImageResolvability,
  type ResolvabilityRow,
} from "@/lib/images/image-resolvability";
import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  projectRefFromSupabaseUrl,
} from "@/lib/supabase/project-target";
import { loadScriptTarget } from "./shared/target";

/**
 * The status the public reads filter on (`.eq('status', 'active')` in
 * `src/lib/services/brand-images.ts`). A rejected row is never rendered and
 * has its key nulled by storage maintenance, so counting it here would report
 * thousands of failures for images nobody asks for.
 */
const RENDERED_STATUS = "active";

/** How many failing rows to print before the list stops being readable. */
const SAMPLE_SIZE = 10;

type ImageRow = { id: string; storage_path: string | null };

function parseProjectRef(argv: string[]): string {
  const inline = argv.find((arg) => arg.startsWith("--project-ref="));
  const index = argv.indexOf("--project-ref");
  const value = inline
    ? inline.slice("--project-ref=".length)
    : index >= 0
      ? argv[index + 1]
      : STAGING_PROJECT_REF;
  const ref = (value ?? "").trim().toLowerCase();
  if (ref !== STAGING_PROJECT_REF && ref !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      `--project-ref must be ${STAGING_PROJECT_REF} (staging) or ${PRODUCTION_PROJECT_REF} (production), not ${JSON.stringify(ref)}`,
    );
  }
  return ref;
}

/** Every rendered row, one PostgREST page at a time. */
async function readRenderedImages(
  client: SupabaseClient,
): Promise<ResolvabilityRow[]> {
  const rows: ResolvabilityRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("brand_images")
      .select("id, storage_path")
      .eq("status", RENDERED_STATUS)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`read brand_images failed: ${error.message}`);
    }
    const page = (data ?? []) as ImageRow[];
    rows.push(
      ...page.map((row) => ({ id: row.id, storagePath: row.storage_path })),
    );
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function main(): Promise<void> {
  const { argv } = loadScriptTarget();
  const ref = parseProjectRef(argv);
  const { url, key } = resolveServiceRoleKey(ref);
  if (projectRefFromSupabaseUrl(url) !== ref) {
    throw new Error(`Resolved URL identifies another project than ${ref}`);
  }
  const { client, blocked } = createWriteBlockingClient(url, key);

  console.log(`Checking image resolvability in ${ref} (${STORAGE_BUCKET})`);

  const rows = await readRenderedImages(client);
  const keys = rows
    .map((row) => row.storagePath?.trim())
    .filter((value): value is string => Boolean(value));
  const objectKeys = await listStorageKeys(client, storageFoldersOf(keys));

  const report = planImageResolvability(rows, objectKeys);

  console.log(
    `  rendered rows: ${report.scanned} (${report.withoutStoragePath} carry no key)`,
  );
  console.log(`  bucket objects in those folders: ${objectKeys.size}`);
  console.log(`  resolvable: ${report.resolvable}`);
  console.log(`  missing object: ${report.counts["missing-object"]}`);
  console.log(`  deny-listed prefix: ${report.counts["private-prefix"]}`);

  if (blocked.length > 0) {
    throw new Error(
      `This check attempted ${blocked.length} write(s) against ${ref}; it must be read-only.`,
    );
  }

  if (isFullyResolvable(report)) {
    console.log("OK: every rendered image resolves through /i/.");
    return;
  }

  for (const entry of report.unresolvable.slice(0, SAMPLE_SIZE)) {
    console.error(`  ${entry.reason}: ${entry.storagePath} (row ${entry.id})`);
  }
  const remaining = report.unresolvable.length - SAMPLE_SIZE;
  if (remaining > 0) console.error(`  ...and ${remaining} more`);
  throw new Error(
    [
      `${report.unresolvable.length} rendered image(s) cannot be served in ${ref}.`,
      report.counts["missing-object"] > 0
        ? "Missing objects: run `pnpm db:sync:staging`, which copies the bytes."
        : "",
      report.counts["private-prefix"] > 0
        ? "Deny-listed keys: run `pnpm tsx scripts/promote-submission-images.ts promote --live`."
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
