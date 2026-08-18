import { describe, expect, it } from "vitest";
import { PRODUCTION_PROJECT_REF, STAGING_PROJECT_REF } from "./staging-target";
import { assertWorkerDatabaseTarget } from "./worker-target";

const jwt = (ref: string, role: string) => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ref, role })}.signature`;
};

const environmentFor = (ref: string) => ({
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: jwt(ref, "service_role"),
});

describe("curation worker database target guard", () => {
  it("accepts credentials that match the declared environment", () => {
    expect(
      assertWorkerDatabaseTarget("staging", environmentFor(STAGING_PROJECT_REF)),
    ).toEqual({
      deploymentEnvironment: "staging",
      projectRef: STAGING_PROJECT_REF,
    });
    expect(
      assertWorkerDatabaseTarget(
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
      assertWorkerDatabaseTarget(
        "staging",
        environmentFor(PRODUCTION_PROJECT_REF),
      ),
    ).toThrow(/identifies project xkcayngbttpxyibgzern, but this worker declares staging/);
  });

  // The fail-open declaration: an unset FORMORIA_DEPLOYMENT_ENV resolves to
  // production, so staging credentials under it must crash rather than run.
  it("refuses a production-declared worker holding staging credentials", () => {
    expect(() =>
      assertWorkerDatabaseTarget("production", environmentFor(STAGING_PROJECT_REF)),
    ).toThrow(/but this worker declares production/);
  });

  it("refuses a key whose ref matches but whose role is not service_role", () => {
    expect(() =>
      assertWorkerDatabaseTarget("staging", {
        ...environmentFor(STAGING_PROJECT_REF),
        SUPABASE_SERVICE_ROLE_KEY: jwt(STAGING_PROJECT_REF, "anon"),
      }),
    ).toThrow(/has role anon, expected service_role/);
  });

  it("refuses a non-JWT key, which exposes no verifiable ref", () => {
    expect(() =>
      assertWorkerDatabaseTarget("staging", {
        ...environmentFor(STAGING_PROJECT_REF),
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abcdefghijklmnop",
      }),
    ).toThrow(/must be a Supabase JWT with a verifiable project ref/);
  });

  it("refuses a missing connection URL or key", () => {
    expect(() =>
      assertWorkerDatabaseTarget("staging", {
        SUPABASE_SERVICE_ROLE_KEY: jwt(STAGING_PROJECT_REF, "service_role"),
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL is required for the curation worker/);
    expect(() =>
      assertWorkerDatabaseTarget("staging", {
        NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY is required for the curation worker/);
  });
});
