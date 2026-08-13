import { describe, expect, it } from "vitest";
import {
  assertStagingSeed,
  migrationSafetyPlan,
  projectRefFromDatabaseUrl,
  resultCount,
  validateDeploymentTarget,
} from "./db-deploy";

const STAGING_REF = "xwkigpvnheecihpxyvsl";

describe("database deployment identity guard", () => {
  it("rejects a database URL wired to a different project", () => {
    expect(() =>
      validateDeploymentTarget({
        FORMORIA_DEPLOYMENT_ENV: "staging",
        SUPABASE_PROJECT_REF: STAGING_REF,
        SUPABASE_DB_URL:
          "postgresql://postgres:secret@db.xkcayngbttpxyibgzern.supabase.co:5432/postgres",
      }),
    ).toThrow(/identifies project xkcayngbttpxyibgzern/);
  });

  it("rejects missing environment declarations", () => {
    expect(() =>
      validateDeploymentTarget({
        SUPABASE_PROJECT_REF: STAGING_REF,
        SUPABASE_DB_URL: `postgresql://postgres:secret@db.${STAGING_REF}.supabase.co:5432/postgres`,
      }),
    ).toThrow("FORMORIA_DEPLOYMENT_ENV is required");

    expect(() =>
      validateDeploymentTarget({
        FORMORIA_DEPLOYMENT_ENV: "staging",
        SUPABASE_DB_URL: `postgresql://postgres:secret@db.${STAGING_REF}.supabase.co:5432/postgres`,
      }),
    ).toThrow("SUPABASE_PROJECT_REF is required");
  });

  it("accepts the declared staging project through a pooler URL", () => {
    const databaseUrl = `postgresql://postgres.${STAGING_REF}:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`;
    expect(
      validateDeploymentTarget({
        FORMORIA_DEPLOYMENT_ENV: "staging",
        SUPABASE_PROJECT_REF: STAGING_REF,
        SUPABASE_DB_URL: databaseUrl,
      }),
    ).toEqual({ databaseUrl, environment: "staging", projectRef: STAGING_REF });
    expect(projectRefFromDatabaseUrl(databaseUrl)).toBe(STAGING_REF);
  });

  it("refuses a fresh production ledger without staging side effects", () => {
    const production = validateDeploymentTarget({
      FORMORIA_DEPLOYMENT_ENV: "production",
      SUPABASE_PROJECT_REF: "xkcayngbttpxyibgzern",
      SUPABASE_DB_URL:
        "postgresql://postgres:secret@db.xkcayngbttpxyibgzern.supabase.co:5432/postgres",
    });
    expect(() => migrationSafetyPlan(production, true)).toThrow(
      "Production migration refused",
    );
    expect(() => assertStagingSeed(production)).toThrow(
      "cannot run against production",
    );
  });

  it("bootstraps only fresh staging and always finalizes staging cron", () => {
    const staging = validateDeploymentTarget({
      FORMORIA_DEPLOYMENT_ENV: "staging",
      SUPABASE_PROJECT_REF: STAGING_REF,
      SUPABASE_DB_URL: `postgresql://postgres:secret@db.${STAGING_REF}.supabase.co:5432/postgres`,
    });
    expect(migrationSafetyPlan(staging, true)).toEqual({
      bootstrapStaging: true,
      finalizeStaging: true,
    });
    expect(migrationSafetyPlan(staging, false)).toEqual({
      bootstrapStaging: false,
      finalizeStaging: true,
    });
    expect(() => assertStagingSeed(staging)).not.toThrow();
  });

  it("reads migration counts from Supabase CLI JSON output", () => {
    expect(
      resultCount(
        JSON.stringify({ rows: [{ formoria_migration_count: "257" }] }),
        "FORMORIA_MIGRATION_COUNT",
      ),
    ).toBe(257);
  });

  it("rejects Railway-style table output instead of reading an adjacent count", () => {
    const table = [
      "migration_count | public_tables_without_rls | storage_bucket_count",
      "----------------+---------------------------+---------------------",
      "258             | 0                         | 5",
    ].join("\n");

    expect(() => resultCount(table, "public_tables_without_rls")).toThrow(
      "could not read public_tables_without_rls as JSON",
    );
  });
});
