import { describe, expect, it } from "vitest";
import {
  assertStagingRevision,
  projectRefFromSupabaseUrl,
  validateSupabaseKeyIdentity,
  validateStagingTarget,
  STAGING_PROJECT_REF,
} from "./staging-target";

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

  it("accepts only the explicitly declared Railway candidate origin", () => {
    const candidateUrl = "https://formoria-candidate-production.up.railway.app";
    expect(
      validateStagingTarget({
        ...stagingEnvironment,
        STAGING_BASE_URL: candidateUrl,
        BASE_URL: candidateUrl,
        RELEASE_CANDIDATE_BASE_URL: candidateUrl,
      }),
    ).toMatchObject({
      appHostname: "formoria-candidate-production.up.railway.app",
      projectRef: STAGING_PROJECT_REF,
    });
    expect(() =>
      validateStagingTarget({
        ...stagingEnvironment,
        STAGING_BASE_URL: candidateUrl,
        BASE_URL: candidateUrl,
        RELEASE_CANDIDATE_BASE_URL:
          "https://different-candidate-production.up.railway.app",
      }),
    ).toThrow(/declared Railway candidate/);
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
