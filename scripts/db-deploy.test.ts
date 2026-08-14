import { describe, expect, it } from "vitest";
import {
  findStagingAccount,
  planStagingAccountActions,
  paginateAuthUsers,
  assertStagingSeed,
  migrationSafetyPlan,
  projectRefFromDatabaseUrl,
  resultCount,
  validateDeploymentTarget,
  validateStagingSeedEnvironment,
} from "./db-deploy";

const STAGING_REF = "xwkigpvnheecihpxyvsl";
const key = (ref: string, role: string) => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ ref, role })}.signature`;
};

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

  it("rejects a seed when the app origin or admin allowlist is cross-wired", () => {
    const base = {
      FORMORIA_DEPLOYMENT_ENV: "staging",
      SUPABASE_PROJECT_REF: STAGING_REF,
      SUPABASE_DB_URL: `postgresql://postgres:secret@db.${STAGING_REF}.supabase.co:5432/postgres`,
      NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: key(STAGING_REF, "anon"),
      SUPABASE_SERVICE_ROLE_KEY: key(STAGING_REF, "service_role"),
      E2E_USER_EMAIL: "e2e-user@example.test",
      E2E_USER_PASSWORD: "user-password",
      E2E_ADMIN_EMAIL: "e2e-admin@example.test",
      E2E_ADMIN_PASSWORD: "admin-password",
      ADMIN_EMAILS: "e2e-admin@example.test",
    };
    expect(validateStagingSeedEnvironment({ ...base, STAGING_BASE_URL: "https://staging.formoria.com" }).accounts).toHaveLength(2);
    expect(() => validateStagingSeedEnvironment({ ...base, STAGING_BASE_URL: "https://formoria.com" })).toThrow(/staging\.formoria\.com/);
    expect(() => validateStagingSeedEnvironment({ ...base, STAGING_BASE_URL: "https://staging.formoria.com", ADMIN_EMAILS: "owner@example.test" })).toThrow(/ADMIN_EMAILS/);
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

  it("finds a durable account beyond page one and keeps repeated seed lookup idempotent", async () => {
    const target = { id: "user-page-2", email: "e2e-user@example.test" };
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      id: `user-page-1-${index}`,
      email: `other-${index}@example.test`,
    }));
    const pages = new Map([
      [1, firstPage],
      [2, [target]],
    ]);
    const seenPages: number[] = [];
    const listPage = async (page: number) => {
      seenPages.push(page);
      return { data: { users: pages.get(page) ?? [] }, error: null };
    };

    const firstSeedUsers = await paginateAuthUsers(listPage);
    const secondSeedUsers = await paginateAuthUsers(listPage);
    const account = {
      email: target.email,
      password: "user-password",
      role: "user" as const,
    };

    expect(findStagingAccount(firstSeedUsers, target.email)).toEqual(target);
    expect(findStagingAccount(secondSeedUsers, target.email)).toEqual(target);
    expect(planStagingAccountActions(firstSeedUsers, [account])[0]).toMatchObject({
      account,
      existingUser: target,
    });
    expect(planStagingAccountActions(secondSeedUsers, [account])[0]).toMatchObject({
      account,
      existingUser: target,
    });
    expect(seenPages).toEqual([1, 2, 1, 2]);
  });

  it("fails closed on an unbounded or repeated Auth pagination response", async () => {
    await expect(
      paginateAuthUsers(async () => ({
        data: { users: [{ id: "same-user", email: "one@example.test" }, ...Array.from({ length: 999 }, (_, i) => ({ id: `u-${i}`, email: null }))] },
        error: null,
      })),
    ).rejects.toThrow(/repeated user|pagination exceeded/);
  });
});
