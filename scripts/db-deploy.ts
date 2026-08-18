import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const STAGING_CURATED_FIXTURE = resolve(
  ROOT,
  "supabase/fixtures/staging-curated-products.sql",
);
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const EXPECTED_STORAGE_BUCKETS =
  "brand-images:true,claim-proofs:false,image-eval:false,origin-evidence:false,run-logs:false";
const EXPECTED_EXTENSIONS =
  "pg_cron:pg_catalog,pg_net:public,pg_stat_statements:extensions,pg_trgm:public,pgcrypto:extensions,plpgsql:pg_catalog,supabase_vault:vault,uuid-ossp:extensions";

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
      throw new Error(`Unable to inspect staging E2E users: ${result.error.message}`);
    }
    const pageUsers = result.data?.users;
    if (!Array.isArray(pageUsers)) {
      throw new Error(`Unable to inspect staging E2E users: page ${page} was malformed`);
    }
    for (const user of pageUsers) {
      if (!user || typeof user.id !== "string" || !user.id) {
        throw new Error(`Unable to inspect staging E2E users: page ${page} contained a malformed user`);
      }
      if (seenIds.has(user.id)) {
        throw new Error(`Unable to inspect staging E2E users: page ${page} repeated user ${user.id}`);
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
  return users.find((user) => user.email?.trim().toLowerCase() === normalizedEmail);
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
  if (new Set(accounts.map((account) => account.email)).size !== accounts.length) {
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

  for (const { account, existingUser } of planStagingAccountActions(listed, accounts)) {
    if (existingUser) {
      const { error } = await supabase.auth.admin.updateUserById(existingUser.id, {
        password: account.password,
        email_confirm: true,
      });
      if (error) {
        throw new Error(`Unable to refresh staging ${account.role} account: ${error.message}`);
      }
      continue;
    }

    const { error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
    });
    if (error) {
      throw new Error(`Unable to create staging ${account.role} account: ${error.message}`);
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

function migrationCheck(target: DeploymentTarget): void {
  supabase(["migration", "list", "--db-url", target.databaseUrl]);
  supabase(["db", "push", "--db-url", target.databaseUrl, "--dry-run"]);
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
       (select count(*) from supabase_migrations.schema_migrations) as migration_count,
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
  const expectedMigrations = readdirSync(MIGRATIONS).filter((file) =>
    file.endsWith(".sql"),
  ).length;
  const actualMigrations = resultCount(invariants, "migration_count");
  const publicTablesWithoutRls = resultCount(
    invariants,
    "public_tables_without_rls",
  );
  const storageBuckets = resultCount(invariants, "storage_bucket_count");
  const extensions = resultCount(invariants, "extension_count");
  if (actualMigrations !== expectedMigrations) {
    throw new Error(
      `Database verification failed: expected ${expectedMigrations} migrations, found ${actualMigrations}`,
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
  const target = validateDeploymentTarget();

  switch (command) {
    case "migrate:check":
      migrationCheck(target);
      return;
    case "migrate": {
      const fresh = databaseIsFresh(target);
      const safety = migrationSafetyPlan(target, fresh);
      if (safety.bootstrapStaging) queryFile(target, STAGING_BOOTSTRAP);
      migrationCheck(target);
      supabase(["db", "push", "--db-url", target.databaseUrl]);
      if (safety.finalizeStaging) queryFile(target, STAGING_FINALIZE);
      verify(target, false);
      return;
    }
    case "seed:staging": {
      const { accounts } = validateStagingSeedEnvironment();
      queryFile(target, STAGING_FIXTURE);
      // Curated products carry a foreign key to the brands seeded above, so
      // this file can never run first.
      queryFile(target, STAGING_CURATED_FIXTURE);
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
