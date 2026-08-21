import { describe, expect, it } from "vitest";
import {
  findStagingAccount,
  planStagingAccountActions,
  paginateAuthUsers,
  assertStagingSeed,
  migrationLedgerDiff,
  migrationPushPlan,
  migrationSafetyPlan,
  migrationVersion,
  parseVersionRows,
  projectRefFromDatabaseUrl,
  resultCount,
  validateDeploymentTarget,
  stagingSeedFiles,
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
    expect(
      validateStagingSeedEnvironment({
        ...base,
        STAGING_BASE_URL: "https://staging.formoria.com",
      }).accounts,
    ).toHaveLength(2);
    expect(() =>
      validateStagingSeedEnvironment({
        ...base,
        STAGING_BASE_URL: "https://formoria.com",
      }),
    ).toThrow(/staging\.formoria\.com/);
    expect(() =>
      validateStagingSeedEnvironment({
        ...base,
        STAGING_BASE_URL: "https://staging.formoria.com",
        ADMIN_EMAILS: "owner@example.test",
      }),
    ).toThrow(/ADMIN_EMAILS/);
  });

  it("seed:staging applies the brand fixture only", () => {
    // The synthetic curated-product fixture is gone (DEV-1485). One file, and
    // it must stay the brand seed — a second entry here would be a throwaway
    // dataset reappearing in a staging database that now holds authored rows.
    const files = stagingSeedFiles();
    expect(files).toHaveLength(1);
    expect(files[0].endsWith("/supabase/fixtures/staging.sql")).toBe(true);
  });

  it("the staging seed still refuses a production target", () => {
    const production = validateDeploymentTarget({
      FORMORIA_DEPLOYMENT_ENV: "production",
      SUPABASE_PROJECT_REF: "xkcayngbttpxyibgzern",
      SUPABASE_DB_URL:
        "postgresql://postgres:secret@db.xkcayngbttpxyibgzern.supabase.co:5432/postgres",
    });
    expect(() => assertStagingSeed(production)).toThrow(
      "The staging fixture cannot run against production",
    );
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
    expect(
      planStagingAccountActions(firstSeedUsers, [account])[0],
    ).toMatchObject({
      account,
      existingUser: target,
    });
    expect(
      planStagingAccountActions(secondSeedUsers, [account])[0],
    ).toMatchObject({
      account,
      existingUser: target,
    });
    expect(seenPages).toEqual([1, 2, 1, 2]);
  });

  it("fails closed on an unbounded or repeated Auth pagination response", async () => {
    await expect(
      paginateAuthUsers(async () => ({
        data: {
          users: [
            { id: "same-user", email: "one@example.test" },
            ...Array.from({ length: 999 }, (_, i) => ({
              id: `u-${i}`,
              email: null,
            })),
          ],
        },
        error: null,
      })),
    ).rejects.toThrow(/repeated user|pagination exceeded/);
  });
});

describe("migration ledger drift", () => {
  it("skips the push when the ledger is ahead and nothing is pending", () => {
    // The exact shape of ten of the twenty staging deploy failures up to
    // 2026-08-20: versions applied from an unmerged branch, no local work.
    const plan = migrationPushPlan(
      ["20260819090000", "20260819100000"],
      ["20260819090000", "20260819100000", "20260820090000", "20260820100000"],
    );

    expect(plan.action).toBe("skip");
    expect(plan.pending).toEqual([]);
    expect(plan.remoteAhead).toEqual(["20260820090000", "20260820100000"]);
  });

  it("pushes when local files are pending and the ledger holds nothing extra", () => {
    const plan = migrationPushPlan(
      ["20260821120000", "20260821130000", "20260821140000"],
      ["20260821130000"],
    );

    expect(plan.action).toBe("push");
    expect(plan.pending).toEqual(["20260821120000", "20260821140000"]);
    expect(plan.remoteAhead).toEqual([]);
  });

  it("refuses to guess when the ledger is ahead and migrations are also pending", () => {
    // `supabase db push` cannot run in this state at all, so the deploy fails
    // either way — but it fails naming both lists instead of suggesting repair.
    expect(() =>
      migrationPushPlan(["20260821120000"], ["20260822090000"]),
    ).toThrow(/Applied without a local file: 20260822090000/);
  });

  it("treats an empty ledger as every migration pending", () => {
    const plan = migrationPushPlan(["20260819090000"], []);

    expect(plan.action).toBe("push");
    expect(plan.pending).toEqual(["20260819090000"]);
  });

  it("reports both directions of drift without ordering assumptions", () => {
    expect(
      migrationLedgerDiff(
        ["20260819090000", "20260817054048"],
        ["20260818120000", "20260817054048"],
      ),
    ).toEqual({
      pending: ["20260819090000"],
      remoteAhead: ["20260818120000"],
    });
  });

  it("does not count legacy bootstrap rows as remote drift", () => {
    // Both Supabase projects carry `00001`…`00014` from before the CLI used
    // timestamps. No local file can ever match them, so calling them drift
    // means the condition can never clear.
    expect(
      migrationLedgerDiff(
        ["20260819090000"],
        ["00001", "00002", "00014", "20260819090000"],
      ),
    ).toEqual({ pending: [], remoteAhead: [] });
  });

  it("pushes past legacy bootstrap rows instead of demanding an unmergeable merge", () => {
    // Production on 2026-08-21: 36 pending behind 14 legacy rows. Before this
    // fix `migrationPushPlan` threw, so the cutover could not run at all.
    const plan = migrationPushPlan(
      ["20260819090000", "20260822090000"],
      ["00001", "00014"],
    );

    expect(plan.action).toBe("push");
    expect(plan.remoteAhead).toEqual([]);
    expect(plan.pending).toEqual(["20260819090000", "20260822090000"]);
  });

  it("still refuses when a real unmerged-branch row sits beside pending work", () => {
    // The guard this fix narrows must keep firing on the case it was written
    // for: a timestamped version applied from a branch that has not merged.
    expect(() =>
      migrationPushPlan(["20260819090000"], ["00001", "20260822090000"]),
    ).toThrow("Migration ledger is ahead of this commit");
  });

  it("reads the version prefix and rejects a file that has none", () => {
    expect(migrationVersion("20260821120000_drop_brand_channels.sql")).toBe(
      "20260821120000",
    );
    expect(() => migrationVersion("drop_brand_channels.sql")).toThrow(
      "missing a version prefix",
    );
  });

  it("reads ledger versions from psql JSON and rejects table output", () => {
    expect(
      parseVersionRows(
        JSON.stringify({ rows: [{ version: "20260821120000" }] }),
      ),
    ).toEqual(["20260821120000"]);
    expect(() => parseVersionRows("version\n--------\n20260821120000")).toThrow(
      "Could not read the migration ledger as JSON",
    );
  });
});
