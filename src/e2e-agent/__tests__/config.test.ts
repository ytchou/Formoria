import { describe, expect, it } from "vitest";

import { STAGING_PROJECT_REF } from "@/lib/supabase/project-target";
import { validateE2eAgentConfig } from "../config";

const jwt = (ref: string, role: string) => {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ ref, role })}.signature`;
};

function validEnvironment(): Record<string, string> {
  return {
    FORMORIA_DEPLOYMENT_ENV: "staging",
    STAGING_BASE_URL: "https://staging.formoria.com",
    BASE_URL: "https://staging.formoria.com",
    NEXT_PUBLIC_SITE_URL: "https://staging.formoria.com",
    SUPABASE_PROJECT_REF: STAGING_PROJECT_REF,
    NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt(STAGING_PROJECT_REF, "anon"),
    SUPABASE_SERVICE_ROLE_KEY: jwt(STAGING_PROJECT_REF, "service_role"),
    SUPABASE_DB_URL: `postgresql://postgres.${STAGING_PROJECT_REF}:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
    ADMIN_EMAILS: "owner@formoria.com,e2e-admin@formoria.com",
    E2E_ADMIN_EMAIL: "e2e-admin@formoria.com",
    E2E_ADMIN_PASSWORD: "admin-password",
    E2E_USER_EMAIL: "e2e-user@formoria.com",
    E2E_USER_PASSWORD: "user-password",
    E2E_STAGING_SESSION_SECRET:
      "staging-session-secret-with-at-least-thirty-two-bytes",
    E2E_ORIGIN_SECRET: "origin-secret",
    CF_ACCESS_CLIENT_ID: "access-client-id",
    CF_ACCESS_CLIENT_SECRET: "access-client-secret",
    GITHUB_APP_ID: "12345",
    GITHUB_APP_PRIVATE_KEY: "private-key",
    GITHUB_APP_INSTALLATION_ID: "67890",
    SLACK_BOT_TOKEN: "xoxb-test-token",
    SLACK_E2E_CHANNEL: "C0123456789",
    OPS_AGENT_SLACK_BOT_ID: "U0OPSBOT",
  };
}

describe("E2E agent configuration", () => {
  it("accepts the complete staging and reporting configuration", () => {
    expect(validateE2eAgentConfig(validEnvironment())).toMatchObject({
      appHostname: "staging.formoria.com",
      projectRef: STAGING_PROJECT_REF,
    });
  });

  it("refuses to boot when any reporting credential is missing", () => {
    const environment = validEnvironment();
    delete environment.SLACK_BOT_TOKEN;

    expect(() => validateE2eAgentConfig(environment)).toThrow(
      /SLACK_BOT_TOKEN is required for the E2E agent/,
    );
  });

  it("refuses to boot without the ops agent bot id", () => {
    const environment = validEnvironment();
    delete environment.OPS_AGENT_SLACK_BOT_ID;

    expect(() => validateE2eAgentConfig(environment)).toThrow(
      /OPS_AGENT_SLACK_BOT_ID is required for the E2E agent/,
    );
  });

  it("does not require the retired self-heal credentials", () => {
    const environment = validEnvironment();
    expect(environment).not.toHaveProperty("REPO_WORKER_URL");
    expect(environment).not.toHaveProperty("LINEAR_API_KEY");
    expect(environment).not.toHaveProperty("LANGFUSE_HOST");

    expect(() => validateE2eAgentConfig(environment)).not.toThrow();
  });

  it("refuses a non-staging application origin", () => {
    expect(() =>
      validateE2eAgentConfig({
        ...validEnvironment(),
        STAGING_BASE_URL: "https://formoria.com",
        BASE_URL: "https://formoria.com",
        NEXT_PUBLIC_SITE_URL: "https://formoria.com",
      }),
    ).toThrow(/staging\.formoria\.com/);
  });

  it("refuses Supabase keys and database URLs for another project", () => {
    const productionRef = "xkcayngbttpxyibgzern";
    expect(() =>
      validateE2eAgentConfig({
        ...validEnvironment(),
        SUPABASE_SERVICE_ROLE_KEY: jwt(productionRef, "service_role"),
      }),
    ).toThrow(/identifies project xkcayngbttpxyibgzern/);

    expect(() =>
      validateE2eAgentConfig({
        ...validEnvironment(),
        SUPABASE_DB_URL: `postgresql://postgres.${productionRef}:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
      }),
    ).toThrow(/SUPABASE_DB_URL identifies project xkcayngbttpxyibgzern/);
  });

  it("refuses an admin account absent from ADMIN_EMAILS", () => {
    expect(() =>
      validateE2eAgentConfig({
        ...validEnvironment(),
        ADMIN_EMAILS: "owner@formoria.com",
      }),
    ).toThrow(/ADMIN_EMAILS must include E2E_ADMIN_EMAIL/);
  });
});
