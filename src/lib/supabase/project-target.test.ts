import { describe, expect, it } from "vitest";
import {
  assertDatabaseTarget,
  assertStagingRevision,
  projectRefFromSupabaseUrl,
  validateSupabaseKeyIdentity,
  validateStagingTarget,
  PRODUCTION_PROJECT_REF,
  STAGING_PROJECT_REF,
} from "./project-target";

const stagingUrl = `https://${STAGING_PROJECT_REF}.supabase.co`;
const jwt = (ref: string, role: string) => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ref, role })}.signature`;
};
const stagingAnonKey = jwt(STAGING_PROJECT_REF, "anon");
const stagingServiceRoleKey = jwt(STAGING_PROJECT_REF, "service_role");

const stagingEnvironment = {
  FORMORIA_DEPLOYMENT_ENV: "staging",
  STAGING_BASE_URL: "https://staging.formoria.com",
  BASE_URL: "https://staging.formoria.com",
  NEXT_PUBLIC_SUPABASE_URL: stagingUrl,
  SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: stagingAnonKey,
  SUPABASE_SERVICE_ROLE_KEY: stagingServiceRoleKey,
};

describe("staging target guard", () => {
  it("accepts the complete canonical staging identity tuple", () => {
    expect(
      validateStagingTarget({
        ...stagingEnvironment,
      }),
    ).toMatchObject({
      appHostname: "staging.formoria.com",
      projectRef: STAGING_PROJECT_REF,
    });
  });

  it("rejects production and cross-wired application targets", () => {
    expect(() =>
      validateStagingTarget({
        FORMORIA_DEPLOYMENT_ENV: "production",
        STAGING_BASE_URL: "https://staging.formoria.com",
        NEXT_PUBLIC_SUPABASE_URL: stagingUrl,
        SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: stagingAnonKey,
        SUPABASE_SERVICE_ROLE_KEY: stagingServiceRoleKey,
      }),
    ).toThrow(/must be staging/);
    expect(() =>
      validateStagingTarget({
        FORMORIA_DEPLOYMENT_ENV: "staging",
        STAGING_BASE_URL: "https://formoria.com",
        NEXT_PUBLIC_SUPABASE_URL: stagingUrl,
        SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
      }),
    ).toThrow(/staging\.formoria\.com/);
    expect(() =>
      validateStagingTarget({
        FORMORIA_DEPLOYMENT_ENV: "staging",
        STAGING_BASE_URL: "https://staging.formoria.com",
        NEXT_PUBLIC_SITE_URL: "https://formoria.com",
        NEXT_PUBLIC_SUPABASE_URL: stagingUrl,
        SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: stagingAnonKey,
        SUPABASE_SERVICE_ROLE_KEY: stagingServiceRoleKey,
      }),
    ).toThrow(/NEXT_PUBLIC_SITE_URL/);
    expect(() =>
      validateStagingTarget({
        FORMORIA_DEPLOYMENT_ENV: "staging",
        STAGING_BASE_URL: "https://staging.formoria.com",
        NEXT_PUBLIC_SUPABASE_URL: "https://xkcayngbttpxyibgzern.supabase.co",
        SUPABASE_PROJECT_REF: "xkcayngbttpxyibgzern",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("xkcayngbttpxyibgzern", "anon"),
        SUPABASE_SERVICE_ROLE_KEY: jwt("xkcayngbttpxyibgzern", "service_role"),
      }),
    ).toThrow(new RegExp(STAGING_PROJECT_REF));
  });

  it("rejects a Supabase URL that disagrees with the declared project", () => {
    expect(() =>
      validateStagingTarget({
        FORMORIA_DEPLOYMENT_ENV: "staging",
        STAGING_BASE_URL: "https://staging.formoria.com",
        NEXT_PUBLIC_SUPABASE_URL: "https://xkcayngbttpxyibgzern.supabase.co",
        SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: stagingAnonKey,
        SUPABASE_SERVICE_ROLE_KEY: stagingServiceRoleKey,
      }),
    ).toThrow(/identifies project/);
    expect(projectRefFromSupabaseUrl(stagingUrl)).toBe(STAGING_PROJECT_REF);
    expect(() => projectRefFromSupabaseUrl(`${stagingUrl}/rest/v1`)).toThrow(
      /canonical hosted project URL/,
    );
  });

  it("rejects production project keys and swapped Supabase key roles", () => {
    expect(() =>
      validateStagingTarget({
        ...stagingEnvironment,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("xkcayngbttpxyibgzern", "anon"),
      }),
    ).toThrow(/identifies project xkcayngbttpxyibgzern/);
    expect(() =>
      validateStagingTarget({
        ...stagingEnvironment,
        SUPABASE_SERVICE_ROLE_KEY: stagingAnonKey,
      }),
    ).toThrow(/expected service_role/);
    expect(() =>
      validateStagingTarget({
        ...stagingEnvironment,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: stagingServiceRoleKey,
      }),
    ).toThrow(/expected anon/);
    expect(() =>
      validateStagingTarget({
        ...stagingEnvironment,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_staging",
      }),
    ).toThrow(/publishable\/secret key formats are rejected/);
  });

  it("validates a JWT identity without exposing the key value", () => {
    expect(
      validateSupabaseKeyIdentity(
        stagingServiceRoleKey,
        "SUPABASE_SERVICE_ROLE_KEY",
        STAGING_PROJECT_REF,
        "service_role",
      ),
    ).toMatchObject({ ref: STAGING_PROJECT_REF, role: "service_role" });
  });

  it("fails closed on missing or mismatched deployed revisions", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(() => assertStagingRevision(sha, sha)).not.toThrow();
    expect(() => assertStagingRevision(sha, null)).toThrow(/missing/);
    expect(() => assertStagingRevision(sha, `${sha.slice(0, -1)}8`)).toThrow(
      /mismatch/,
    );
  });
});

const environmentFor = (ref: string) => ({
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: jwt(ref, "service_role"),
});

describe("curation worker database target guard", () => {
  it("accepts credentials that match the declared environment", () => {
    expect(
      assertDatabaseTarget("staging", environmentFor(STAGING_PROJECT_REF)),
    ).toEqual({
      deploymentEnvironment: "staging",
      projectRef: STAGING_PROJECT_REF,
    });
    expect(
      assertDatabaseTarget(
        "production",
        environmentFor(PRODUCTION_PROJECT_REF),
      ),
    ).toEqual({
      deploymentEnvironment: "production",
      projectRef: PRODUCTION_PROJECT_REF,
    });
  });

  it("refuses a staging worker holding production credentials", () => {
    expect(() =>
      assertDatabaseTarget("staging", environmentFor(PRODUCTION_PROJECT_REF)),
    ).toThrow(
      /identifies project xkcayngbttpxyibgzern, but this worker declares staging/,
    );
  });

  // The fail-open declaration: an unset FORMORIA_DEPLOYMENT_ENV resolves to
  // production, so staging credentials under it must crash rather than run.
  it("refuses a production-declared worker holding staging credentials", () => {
    expect(() =>
      assertDatabaseTarget("production", environmentFor(STAGING_PROJECT_REF)),
    ).toThrow(/but this worker declares production/);
  });

  it("refuses a key whose ref matches but whose role is not service_role", () => {
    expect(() =>
      assertDatabaseTarget("staging", {
        ...environmentFor(STAGING_PROJECT_REF),
        SUPABASE_SERVICE_ROLE_KEY: jwt(STAGING_PROJECT_REF, "anon"),
      }),
    ).toThrow(/has role anon, expected service_role/);
  });

  it("refuses a non-JWT key, which exposes no verifiable ref", () => {
    expect(() =>
      assertDatabaseTarget("staging", {
        ...environmentFor(STAGING_PROJECT_REF),
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abcdefghijklmnop",
      }),
    ).toThrow(/must be a Supabase JWT with a verifiable project ref/);
  });

  it("refuses a missing connection URL or key", () => {
    expect(() =>
      assertDatabaseTarget("staging", {
        SUPABASE_SERVICE_ROLE_KEY: jwt(STAGING_PROJECT_REF, "service_role"),
      }),
    ).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL is required to resolve the Supabase project target/,
    );
    expect(() =>
      assertDatabaseTarget("staging", {
        NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
      }),
    ).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY is required to resolve the Supabase project target/,
    );
  });
});
