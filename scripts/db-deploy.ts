import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type DeploymentEnvironment = "production" | "staging";

const EXPECTED_PROJECT_REFS: Record<DeploymentEnvironment, string> = {
  production: "xkcayngbttpxyibgzern",
  staging: "xwkigpvnheecihpxyvsl",
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
  return supabase(["db", "query", "--db-url", target.databaseUrl, sql], true);
}

function queryFile(target: DeploymentTarget, file: string): void {
  supabase(["db", "query", "--db-url", target.databaseUrl, "--file", file]);
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
    const match = ledger.match(/FORMORIA_MIGRATION_COUNT[\s|:]+(\d+)/i);
    if (!match) throw new Error("Could not read the remote migration ledger");
    return Number(match[1]) === 0;
  }
  throw new Error("Could not determine remote migration state");
}

function migrationCheck(target: DeploymentTarget): void {
  supabase(["migration", "list", "--db-url", target.databaseUrl]);
  supabase(["db", "push", "--db-url", target.databaseUrl, "--dry-run"]);
}

function resultCount(result: string, column: string): number {
  const match = result.match(new RegExp(`${column}[\\s|:]+(\\d+)`, "i"));
  if (!match) throw new Error(`Database verification could not read ${column}`);
  return Number(match[1]);
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
    if (!/FORMORIA_ACTIVE_CRON[\s|:]+0\b/i.test(cron)) {
      throw new Error(
        "Staging verification failed: at least one cron job is active",
      );
    }
  }

  const generatedTypes = supabase(
    ["gen", "types", "typescript", "--db-url", target.databaseUrl],
    true,
  );
  if (generatedTypes.trim() !== readFileSync(DATABASE_TYPES, "utf8").trim()) {
    throw new Error(
      "Generated database types are stale; run pnpm db:types and commit them",
    );
  }

  if (includeSchemaDiff) {
    const diff = supabase(
      ["db", "diff", "--db-url", target.databaseUrl, "--use-pg-schema"],
      true,
    );
    if (diff.trim())
      throw new Error("Repository-to-database schema drift detected");
  }
}

function main(): void {
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
      // Schema diff creates a Docker-backed shadow database. Railway pre-deploy
      // intentionally runs every remote invariant except that evidence step;
      // `pnpm db:verify` remains the explicit drift gate after deployment.
      verify(target, false);
      return;
    }
    case "seed:staging":
      assertStagingSeed(target);
      queryFile(target, STAGING_FIXTURE);
      return;
    case "verify":
      verify(target, true);
      return;
    case "types": {
      const generatedTypes = supabase(
        ["gen", "types", "typescript", "--db-url", target.databaseUrl],
        true,
      );
      writeFileSync(DATABASE_TYPES, generatedTypes);
      console.log(`Updated ${DATABASE_TYPES}`);
      return;
    }
    default:
      throw new Error(`Unknown database command: ${command ?? "<missing>"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
