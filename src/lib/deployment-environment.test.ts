import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAllowedStagingRequest,
  isStagingEnvironment,
  isStagingHost,
} from "./deployment-environment";

afterEach(() => vi.unstubAllEnvs());

describe("staging deployment safety policy", () => {
  it("recognizes every supported staging signal", () => {
    vi.stubEnv("FORMORIA_DEPLOYMENT_ENV", "staging");
    expect(isStagingEnvironment()).toBe(true);

    vi.stubEnv("FORMORIA_DEPLOYMENT_ENV", "");
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
    expect(isStagingEnvironment()).toBe(true);

    expect(isStagingHost("staging.formoria.com:443")).toBe(true);
  });

  it("allows private QA mutations to reach their route authorization", () => {
    expect(isAllowedStagingRequest("GET", "/brands")).toBe(true);
    expect(isAllowedStagingRequest("POST", "/en/auth/sign-in")).toBe(true);
    expect(isAllowedStagingRequest("POST", "/auth/sign-out")).toBe(true);
    expect(isAllowedStagingRequest("POST", "/submit")).toBe(false);
    expect(isAllowedStagingRequest("POST", "/submit", true)).toBe(true);
    expect(
      isAllowedStagingRequest("DELETE", "/api/admin/brands/123", true),
    ).toBe(true);
    expect(isAllowedStagingRequest("TRACE", "/api/admin/brands/123")).toBe(
      false,
    );
  });

  it("denies callbacks that mutate through GET", () => {
    expect(isAllowedStagingRequest("GET", "/api/newsletter/confirm")).toBe(
      false,
    );
    expect(isAllowedStagingRequest("GET", "/api/newsletter/unsubscribe")).toBe(
      false,
    );
    expect(isAllowedStagingRequest("GET", "/api/email/unsubscribe")).toBe(
      false,
    );
    expect(isAllowedStagingRequest("GET", "/en/auth/sign-up")).toBe(true);
    expect(isAllowedStagingRequest("GET", "/auth/forgot-password")).toBe(true);
    expect(isAllowedStagingRequest("GET", "/auth/reset-password")).toBe(true);
    expect(isAllowedStagingRequest("POST", "/auth/sign-up")).toBe(true);
    expect(isAllowedStagingRequest("POST", "/auth/forgot-password")).toBe(true);
    expect(isAllowedStagingRequest("PATCH", "/auth/reset-password")).toBe(false);
  });
});
