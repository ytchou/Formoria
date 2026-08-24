import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
  validateStagingTarget,
} from "./staging-target";

type DeploymentEnvironment = "production" | "staging";

const EXPECTED_PROJECT_REFS: Record<DeploymentEnvironment, string> = {
  production: PRODUCTION_PROJECT_REF,
  staging: STAGING_PROJECT_REF,
};

const ROOT = resolve(import.meta.dirname, "..");
const DATABASE_TYPES = resolve(ROOT, "src/lib/supabase/database.types.ts");
const STAGING_BOOTSTRAP = resolve(ROOT, "supabase/bootstrap/staging.sql");
const STAGING_FINALIZE = resolve(
  ROOT,
  "supabase/bootstrap/deactivate-staging-cron.sql",
);
const STAGING_FIXTURE = resolve(ROOT, "supabase/fixtures/staging.sql");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
// Every bucket is private. brand-images was flipped by
// 20260822110000_brand_images_private.sql; reads go through /i/<path>. Until
// that migration reaches production, `db-deploy verify` against production
// fails here on purpose — the manifest is the drift signal, not a formality.
const EXPECTED_STORAGE_BUCKETS =
  "brand-images:false,claim-proofs:false,image-eval:false,origin-evidence:false,run-logs:false";
const EXPECTED_EXTENSIONS =
  "pg_cron:pg_catalog,pg_net:public,pg_stat_statements:extensions,pg_trgm:public,pgcrypto:extensions,plpgsql:pg_catalog,supabase_vault:vault,uuid-ossp:extensions";
const CHECKSUM_MANIFEST = resolve(ROOT, "supabase/migration-checksums.json");

// ---------------------------------------------------------------------------
// Migration content integrity
// ---------------------------------------------------------------------------

export function computeFileHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function buildChecksumManifest(
  migrationsDir: string = MIGRATIONS,
): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    manifest[migrationVersion(file)] = computeFileHash(
      readFileSync(resolve(migrationsDir, file)),
    );
  }
  return manifest;
}

export function verifyChecksumManifest(
  manifest: Record<string, string>,
  localFiles: Array<{ version: string; hash: string }>,
): string[] {
  const violations: string[] = [];
  for (const { version, hash } of localFiles) {
    const recorded = manifest[version];
    if (!recorded) {
      violations.push(
        `${version}: missing from checksum manifest (run "pnpm db-deploy checksums" to record)`,
      );
    } else if (hash !== recorded) {
      violations.push(
        `${version}: content modified since recorded (was ${recorded.slice(0, 12)}…, now ${hash.slice(0, 12)}…)`,
      );
    }
  }
  return violations;
}

function localMigrationFileHashes(
  migrationsDir: string = MIGRATIONS,
): Array<{ version: string; hash: string }> {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((file) => ({
      version: migrationVersion(file),
      hash: computeFileHash(readFileSync(resolve(migrationsDir, file))),
    }));
}

function loadChecksumManifest(
  manifestPath: string = CHECKSUM_MANIFEST,
): Record<string, string> {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Checksum manifest not found at ${manifestPath}. Run "pnpm db-deploy checksums" to create it.`,
    );
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
    string,
    string
  >;
}

export type DeploymentTarget = {
  databaseUrl: string;
  environment: DeploymentEnvironment;
  projectRef: string;
};

export function migrationSafetyPlan(
  target: DeploymentTarget,
  fresh: boolean,
): { bootstrapStaging: boolean; finalizeStaging: boolean } {
  if (fresh && target.environment === "production") {
    throw new Error(
      "Production migration refused: the target has no migration ledger",
    );
  }
  return {
    bootstrapStaging: fresh && target.environment === "staging",
    finalizeStaging: target.environment === "staging",
  };
}

export function assertStagingSeed(target: DeploymentTarget): void {
  if (target.environment !== "staging") {
    throw new Error("The staging fixture cannot run against production");
  }
}

/**
 * Every SQL file `seed:staging` applies, in order. The synthetic curated-product
 * fixture was deleted with DEV-1485 — staging now carries authored products, so
 * the brand fixture is the whole of the seed.
 */
export function stagingSeedFiles(): string[] {
  return [STAGING_FIXTURE];
}

export type StagingSeedAccount = {
  email: string;
  password: string;
  role: "user" | "admin";
};

export type StagingAuthUser = {
  id: string;
  email?: string | null;
};

export const AUTH_USERS_PAGE_SIZE = 1_000;
export const AUTH_USERS_MAX_PAGES = 25;

type AuthUsersPage = {
  data: { users: StagingAuthUser[] } | null;
  error: { message: string } | null;
};

/**
 * Auth admin pagination is one of the few places where a first-page-only
 * lookup can silently create duplicate durable accounts. Keep the bound
 * explicit and fail closed if Supabase keeps returning full pages forever.
 */
export async function paginateAuthUsers(
  listPage: (page: number, perPage: number) => Promise<AuthUsersPage>,
): Promise<StagingAuthUser[]> {
  const users: StagingAuthUser[] = [];
  const seenIds = new Set<string>();
  for (let page = 1; page <= AUTH_USERS_MAX_PAGES; page += 1) {
    const result = await listPage(page, AUTH_USERS_PAGE_SIZE);
    if (result.error) {
      throw new Error(
        `Unable to inspect staging E2E users: ${result.error.message}`,
      );
    }
    const pageUsers = result.data?.users;
    if (!Array.isArray(pageUsers)) {
      throw new Error(
        `Unable to inspect staging E2E users: page ${page} was malformed`,
      );
    }
    for (const user of pageUsers) {
      if (!user || typeof user.id !== "string" || !user.id) {
        throw new Error(
          `Unable to inspect staging E2E users: page ${page} contained a malformed user`,
        );
      }
      if (seenIds.has(user.id)) {
        throw new Error(
          `Unable to inspect staging E2E users: page ${page} repeated user ${user.id}`,
        );
      }
      seenIds.add(user.id);
      users.push(user);
    }
    if (pageUsers.length < AUTH_USERS_PAGE_SIZE) return users;
    if (page === AUTH_USERS_MAX_PAGES) {
      throw new Error(
        `Unable to inspect staging E2E users: pagination exceeded ${AUTH_USERS_MAX_PAGES} pages`,
      );
    }
  }
  return users;
}

export function findStagingAccount(
  users: readonly StagingAuthUser[],
  email: string,
): StagingAuthUser | undefined {
  const normalizedEmail = email.trim().toLowerCase();
  return users.find(
    (user) => user.email?.trim().toLowerCase() === normalizedEmail,
  );
}

export type StagingAccountAction = {
  account: StagingSeedAccount;
  existingUser: StagingAuthUser | null;
};

export function planStagingAccountActions(
  users: readonly StagingAuthUser[],
  accounts: readonly StagingSeedAccount[],
): StagingAccountAction[] {
  return accounts.map((account) => ({
    account,
    existingUser: findStagingAccount(users, account.email) ?? null,
  }));
}

/**
 * Validate the app/database/account identity before the seed can mutate
 * anything. The database guard alone is insufficient: a staging database URL
 * paired with a production app or credentials would still be cross-wired.
 */
export function validateStagingSeedEnvironment(
  environment: Environment = process.env,
): { target: DeploymentTarget; accounts: StagingSeedAccount[] } {
  const target = validateDeploymentTarget(environment);
  assertStagingSeed(target);
  validateStagingTarget(environment);

  const accounts: StagingSeedAccount[] = [
    {
      email: required(environment, "E2E_USER_EMAIL").toLowerCase(),
      password: required(environment, "E2E_USER_PASSWORD"),
      role: "user",
    },
    {
      email: required(environment, "E2E_ADMIN_EMAIL").toLowerCase(),
      password: required(environment, "E2E_ADMIN_PASSWORD"),
      role: "admin",
    },
  ];
  if (
    new Set(accounts.map((account) => account.email)).size !== accounts.length
  ) {
    throw new Error("E2E_USER_EMAIL and E2E_ADMIN_EMAIL must be different");
  }
  const adminAllowlist = required(environment, "ADMIN_EMAILS")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (!adminAllowlist.includes(accounts[1].email)) {
    throw new Error("ADMIN_EMAILS must include E2E_ADMIN_EMAIL for staging");
  }
  return { target, accounts };
}

type Environment = Record<string, string | undefined>;

function required(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function projectRefFromDatabaseUrl(databaseUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("SUPABASE_DB_URL must be a valid PostgreSQL URL");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("SUPABASE_DB_URL must use postgres:// or postgresql://");
  }

  const directMatch = parsed.hostname.match(/^db\.([a-z]{20})\.supabase\.co$/i);
  if (directMatch) return directMatch[1].toLowerCase();

  const poolerMatch = decodeURIComponent(parsed.username).match(
    /^postgres\.([a-z]{20})$/i,
  );
  return poolerMatch?.[1].toLowerCase() ?? null;
}

export function validateDeploymentTarget(
  environment: Environment = process.env,
): DeploymentTarget {
  const deploymentEnvironment = required(
    environment,
    "FORMORIA_DEPLOYMENT_ENV",
  );
  if (
    deploymentEnvironment !== "staging" &&
    deploymentEnvironment !== "production"
  ) {
    throw new Error("FORMORIA_DEPLOYMENT_ENV must be staging or production");
  }

  const projectRef = required(
    environment,
    "SUPABASE_PROJECT_REF",
  ).toLowerCase();
  const databaseUrl = required(environment, "SUPABASE_DB_URL");
  const urlProjectRef = projectRefFromDatabaseUrl(databaseUrl);
  if (!urlProjectRef) {
    throw new Error(
      "SUPABASE_DB_URL must identify a Supabase project in its host or pooler username",
    );
  }
  if (urlProjectRef !== projectRef) {
    throw new Error(
      `SUPABASE_DB_URL identifies project ${urlProjectRef}, not SUPABASE_PROJECT_REF ${projectRef}`,
    );
  }

  const expectedRef = EXPECTED_PROJECT_REFS[deploymentEnvironment];
  if (projectRef !== expectedRef) {
    throw new Error(
      `${deploymentEnvironment} must deploy to project ${expectedRef}, not ${projectRef}`,
    );
  }

  return { databaseUrl, environment: deploymentEnvironment, projectRef };
}

function run(command: string, args: string[], capture = false): string {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const detail = capture ? result.stderr.trim() : "";
    throw new Error(
      `${command} ${args[0] ?? ""} failed${detail ? `: ${detail}` : ""}`,
    );
  }
  return capture ? result.stdout : "";
}

function supabase(args: string[], capture = false): string {
  return run("pnpm", ["exec", "supabase", ...args], capture);
}

function query(target: DeploymentTarget, sql: string): string {
  const statement = sql.trim().replace(/;$/, "");
  const wrapped = `select json_build_object(
    'rows', coalesce(json_agg(row_to_json(formoria_query)), '[]'::json)
  ) from (${statement}) as formoria_query;`;
  return run(
    "psql",
    [
      "--dbname",
      target.databaseUrl,
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      wrapped,
    ],
    true,
  );
}

function queryFile(target: DeploymentTarget, file: string): void {
  const result = spawnSync(
    "psql",
    [
      "--dbname",
      target.databaseUrl,
      "--set",
      "ON_ERROR_STOP=1",
      "--file",
      file,
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed while applying ${file}`);
  }
}

async function ensureStagingAccounts(
  accounts: StagingSeedAccount[],
  environment: Environment = process.env,
): Promise<void> {
  const supabaseUrl = required(environment, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = required(environment, "SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const listed = await paginateAuthUsers((page, perPage) =>
    supabase.auth.admin.listUsers({ page, perPage }),
  );

  for (const { account, existingUser } of planStagingAccountActions(
    listed,
    accounts,
  )) {
    if (existingUser) {
      const { error } = await supabase.auth.admin.updateUserById(
        existingUser.id,
        {
          password: account.password,
          email_confirm: true,
        },
      );
      if (error) {
        throw new Error(
          `Unable to refresh staging ${account.role} account: ${error.message}`,
        );
      }
      continue;
    }

    const { error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
    });
    if (error) {
      throw new Error(
        `Unable to create staging ${account.role} account: ${error.message}`,
      );
    }
  }
}

function databaseIsFresh(target: DeploymentTarget): boolean {
  const result = query(
    target,
    "select case when to_regclass('supabase_migrations.schema_migrations') is null then 'FORMORIA_FRESH' else 'FORMORIA_EXISTING' end as deployment_state;",
  );
  if (result.includes("FORMORIA_FRESH")) return true;
  if (result.includes("FORMORIA_EXISTING")) {
    const ledger = query(
      target,
      "select count(*)::text as FORMORIA_MIGRATION_COUNT from supabase_migrations.schema_migrations;",
    );
    return resultCount(ledger, "FORMORIA_MIGRATION_COUNT") === 0;
  }
  throw new Error("Could not determine remote migration state");
}

/**
 * The version Supabase records in its ledger: the digits before the first `_`.
 * A migration file that does not carry one would never be applied and would
 * never appear in the ledger, so it is a repo error rather than a skip.
 */
export function migrationVersion(fileName: string): string {
  const match = /^(\d+)_/.exec(fileName);
  if (!match?.[1]) {
    throw new Error(`Migration file is missing a version prefix: ${fileName}`);
  }
  return match[1];
}

/**
 * A ledger version that predates the 14-digit timestamp convention.
 *
 * Both Supabase projects were bootstrapped with rows `00001` … `00014`, which
 * `supabase db push` wrote before the CLI adopted timestamps. `localMigrationVersions`
 * derives its list from `<14-digit>_*.sql` filenames, so a version in this shape
 * can never have a local file — not because a branch is unmerged, but because no
 * such file has ever existed.
 */
function isLegacyLedgerVersion(version: string): boolean {
  return !/^\d{14}$/.test(version);
}

/**
 * The two ways a migration ledger can disagree with the commit being deployed.
 *
 * `pending` — a local file with no ledger row. Work this deploy must do.
 * `remoteAhead` — a ledger row with no local file, because the migration was
 * pushed to the database from a branch that has not merged yet.
 *
 * Legacy bootstrap rows are excluded from `remoteAhead` entirely. Counting them
 * conflates "a branch owns this and has not merged" with "this predates the
 * naming convention", and the two need opposite responses: the first is a real
 * hold, the second can never be resolved by merging anything. Production carries
 * 14 of them alongside 36 pending migrations, which made `migrationPushPlan`
 * throw and `verify` hard-fail with advice ("merge the branch that owns the
 * first list") that names no branch and no file (DEV-1531).
 */
export function migrationLedgerDiff(
  localVersions: string[],
  remoteVersions: string[],
): { pending: string[]; remoteAhead: string[] } {
  const remote = new Set(remoteVersions);
  const local = new Set(localVersions);
  return {
    pending: localVersions.filter((version) => !remote.has(version)).sort(),
    remoteAhead: remoteVersions
      .filter((version) => !local.has(version))
      .filter((version) => !isLegacyLedgerVersion(version))
      .sort(),
  };
}

export type MigrationPushPlan = {
  pending: string[];
  remoteAhead: string[];
  action: "push" | "skip";
};

/**
 * Decide whether this deploy has migrations to apply.
 *
 * A ledger that is *ahead* of the commit is not a reason to abort. The database
 * already has those changes; refusing the deploy only keeps OLDER code serving
 * against that same schema while everything else stops shipping. Ten of the
 * twenty staging deploy failures up to 2026-08-20 died exactly here, and every
 * one of them had nothing to apply (DEV-1534).
 *
 * `--include-all` covers the opposite hole: a migration held back for deploy
 * ordering leaves a gap, and `supabase db push` refuses to insert anything
 * before the last applied migration unless told to (DEV-1533).
 *
 * The CLI has no flag for a remote-only version — it refuses before it looks at
 * anything else — so when both lists are non-empty we still cannot push, and we
 * name the versions instead of leaving the CLI to suggest `migration repair`.
 * That combination has not occurred; if it starts to, the upgrade path is to
 * apply `pending` through psql and write the ledger rows directly rather than
 * shelling out to `db push`.
 */
export function migrationPushPlan(
  localVersions: string[],
  remoteVersions: string[],
): MigrationPushPlan {
  const { pending, remoteAhead } = migrationLedgerDiff(
    localVersions,
    remoteVersions,
  );
  if (pending.length > 0 && remoteAhead.length > 0) {
    throw new Error(
      `Migration ledger is ahead of this commit and ${pending.length} migration(s) still need applying. ` +
        `Applied without a local file: ${remoteAhead.join(", ")}. ` +
        `Waiting to apply: ${pending.join(", ")}. ` +
        "Merge the branch that owns the first list, then redeploy.",
    );
  }
  return {
    pending,
    remoteAhead,
    action: pending.length > 0 ? "push" : "skip",
  };
}

function localMigrationVersions(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .map(migrationVersion);
}

export function parseVersionRows(result: string): string[] {
  let parsed: { rows?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(result) as { rows?: Array<Record<string, unknown>> };
  } catch {
    throw new Error("Could not read the migration ledger as JSON");
  }
  if (!Array.isArray(parsed.rows)) {
    throw new Error("Could not read migration versions from the ledger JSON");
  }
  return parsed.rows.map((row) => {
    const version = row.version;
    if (typeof version !== "string") {
      throw new Error("The migration ledger returned a non-text version");
    }
    return version;
  });
}

function remoteMigrationVersions(target: DeploymentTarget): string[] {
  const state = query(
    target,
    "select case when to_regclass('supabase_migrations.schema_migrations') is null then 'FORMORIA_NO_LEDGER' else 'FORMORIA_LEDGER' end as ledger_state;",
  );
  if (state.includes("FORMORIA_NO_LEDGER")) return [];
  return parseVersionRows(
    query(
      target,
      "select version::text as version from supabase_migrations.schema_migrations order by version;",
    ),
  );
}

function reportRemoteAhead(
  target: DeploymentTarget,
  remoteAhead: string[],
): void {
  if (remoteAhead.length === 0) return;
  console.warn(
    `WARNING: ${remoteAhead.length} migration(s) are applied to ${target.environment} ` +
      `but have no file on this commit: ${remoteAhead.join(", ")}. ` +
      "They were pushed from a branch that has not merged yet.",
  );
}

function migrationCheck(target: DeploymentTarget): MigrationPushPlan {
  supabase(["migration", "list", "--db-url", target.databaseUrl]);
  const plan = migrationPushPlan(
    localMigrationVersions(),
    remoteMigrationVersions(target),
  );
  reportRemoteAhead(target, plan.remoteAhead);
  if (plan.action === "skip") {
    console.log("No migrations to apply.");
    return plan;
  }
  console.log(`Migrations to apply: ${plan.pending.join(", ")}`);
  supabase([
    "db",
    "push",
    "--db-url",
    target.databaseUrl,
    "--dry-run",
    "--include-all",
  ]);
  return plan;
}

export function resultCount(result: string, column: string): number {
  try {
    const parsed = JSON.parse(result) as {
      rows?: Array<Record<string, unknown>>;
    };
    const value = parsed.rows?.[0]?.[column.toLowerCase()];
    if (typeof value === "number" || typeof value === "string") {
      const count = Number(value);
      if (Number.isInteger(count) && count >= 0) return count;
    }
  } catch {
    throw new Error(`Database verification could not read ${column} as JSON`);
  }
  throw new Error(`Database verification could not read ${column} from JSON`);
}

function verify(target: DeploymentTarget, includeSchemaDiff: boolean): void {
  supabase(["migration", "list", "--db-url", target.databaseUrl]);
  const invariants = query(
    target,
    `select
       (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as public_tables_without_rls,
       (select count(*) from storage.buckets) as storage_bucket_count,
       (select count(*) from pg_extension) as extension_count,
       (select 'FORMORIA_BUCKETS=' || string_agg(id || ':' || public::text, ',' order by id)
          from storage.buckets) as bucket_manifest,
       (select 'FORMORIA_EXTENSIONS=' || string_agg(e.extname || ':' || n.nspname, ',' order by e.extname)
          from pg_extension e join pg_namespace n on n.oid = e.extnamespace) as extension_manifest,
       case when to_regclass('cron.job') is null then 0
            else (select count(*) from cron.job where active)
       end as active_cron_jobs;`,
  );
  const publicTablesWithoutRls = resultCount(
    invariants,
    "public_tables_without_rls",
  );
  const storageBuckets = resultCount(invariants, "storage_bucket_count");
  const extensions = resultCount(invariants, "extension_count");
  // Containment, not equality. Every local migration must be applied; a ledger
  // row with no local file means an unmerged branch pushed to this database,
  // which is tolerable on the shared staging target and never on production.
  const ledger = migrationLedgerDiff(
    localMigrationVersions(),
    remoteMigrationVersions(target),
  );
  if (ledger.pending.length > 0) {
    throw new Error(
      `Database verification failed: ${ledger.pending.length} migration(s) are not applied: ${ledger.pending.join(", ")}`,
    );
  }
  if (ledger.remoteAhead.length > 0) {
    if (target.environment === "production") {
      throw new Error(
        `Database verification failed: ${ledger.remoteAhead.length} ledger row(s) have no migration file: ${ledger.remoteAhead.join(", ")}`,
      );
    }
    reportRemoteAhead(target, ledger.remoteAhead);
  }
  const checksumViolations = verifyChecksumManifest(
    loadChecksumManifest(),
    localMigrationFileHashes(),
  );
  if (checksumViolations.length > 0) {
    throw new Error(
      `Migration content integrity check failed:\n  ${checksumViolations.join("\n  ")}`,
    );
  }

  if (publicTablesWithoutRls !== 0) {
    throw new Error(
      "Database verification failed: a public table is missing RLS",
    );
  }
  if (
    storageBuckets !== EXPECTED_STORAGE_BUCKETS.split(",").length ||
    !invariants.includes(`FORMORIA_BUCKETS=${EXPECTED_STORAGE_BUCKETS}`)
  ) {
    throw new Error(
      "Database verification failed: storage bucket manifest differs from production",
    );
  }
  if (
    extensions !== EXPECTED_EXTENSIONS.split(",").length ||
    !invariants.includes(`FORMORIA_EXTENSIONS=${EXPECTED_EXTENSIONS}`)
  ) {
    throw new Error(
      "Database verification failed: extension manifest differs from production",
    );
  }

  if (target.environment === "staging") {
    const cron = query(
      target,
      "select count(*)::text as FORMORIA_ACTIVE_CRON from cron.job where active;",
    );
    if (resultCount(cron, "FORMORIA_ACTIVE_CRON") !== 0) {
      throw new Error(
        "Staging verification failed: at least one cron job is active",
      );
    }
  }

  if (includeSchemaDiff) {
    const generatedTypes = supabase(
      ["gen", "types", "typescript", "--db-url", target.databaseUrl],
      true,
    );
    if (generatedTypes.trim() !== readFileSync(DATABASE_TYPES, "utf8").trim()) {
      throw new Error(
        "Generated database types are stale; run pnpm db:types and commit them",
      );
    }
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === "checksums") {
    const manifest = buildChecksumManifest();
    writeFileSync(CHECKSUM_MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
    console.log(
      `Recorded ${Object.keys(manifest).length} migration checksums to ${CHECKSUM_MANIFEST}`,
    );
    return;
  }
  const target = validateDeploymentTarget();

  switch (command) {
    case "migrate:check":
      migrationCheck(target);
      return;
    case "migrate": {
      const fresh = databaseIsFresh(target);
      const safety = migrationSafetyPlan(target, fresh);
      if (safety.bootstrapStaging) queryFile(target, STAGING_BOOTSTRAP);
      const plan = migrationCheck(target);
      if (plan.action === "push") {
        // Flags must match the dry-run in migrationCheck exactly. A check that
        // pushes a different set from the real push is not a check.
        supabase([
          "db",
          "push",
          "--db-url",
          target.databaseUrl,
          "--include-all",
        ]);
      }
      if (safety.finalizeStaging) queryFile(target, STAGING_FINALIZE);
      verify(target, false);
      return;
    }
    case "seed:staging": {
      // validateStagingSeedEnvironment already ran assertStagingSeed.
      const { accounts } = validateStagingSeedEnvironment();
      for (const file of stagingSeedFiles()) queryFile(target, file);
      await ensureStagingAccounts(accounts);
      return;
    }
    case "verify":
      verify(target, true);
      return;
    case "types": {
      const generatedTypes = supabase(
        ["gen", "types", "typescript", "--db-url", target.databaseUrl],
        true,
      );
      writeFileSync(DATABASE_TYPES, `${generatedTypes.trim()}\n`);
      console.log(`Updated ${DATABASE_TYPES}`);
      return;
    }
    default:
      throw new Error(`Unknown database command: ${command ?? "<missing>"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
