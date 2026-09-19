import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  E2E_STAGING_SESSION_AUDIENCE,
  E2E_STAGING_SESSION_ISSUER,
  E2E_STAGING_SESSION_TTL_SECONDS,
  signStagingSession,
  verifyStagingSession,
} from "./staging-session";

const SECRET = "e2e-staging-session-secret-with-32-bytes";
const NOW = new Date("2026-09-20T08:00:00.000Z");

afterEach(() => vi.unstubAllEnvs());

function enableStaging(secret = SECRET) {
  vi.stubEnv("FORMORIA_DEPLOYMENT_ENV", "staging");
  vi.stubEnv("E2E_STAGING_SESSION_SECRET", secret);
}

async function tokenWith(
  overrides: { audience?: string; purpose?: string; expiresAt?: number } = {},
) {
  const now = Math.floor(NOW.getTime() / 1000);
  return new SignJWT({
    purpose: overrides.purpose ?? "deep",
    run_id: "run-1779",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(E2E_STAGING_SESSION_ISSUER)
    .setAudience(overrides.audience ?? E2E_STAGING_SESSION_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(
      overrides.expiresAt ?? now + E2E_STAGING_SESSION_TTL_SECONDS,
    )
    .sign(new TextEncoder().encode(SECRET));
}

describe("request-scoped staging E2E session", () => {
  it("accepts a valid deep token on the staging deployment and host", async () => {
    enableStaging();
    const token = await signStagingSession("run-1779", { now: NOW });

    await expect(
      verifyStagingSession(token, "staging.formoria.com", { now: NOW }),
    ).resolves.toEqual({ runId: "run-1779" });
  });

  it("rejects expired, tampered, and wrong-audience tokens", async () => {
    enableStaging();
    const expired = await tokenWith({
      expiresAt: Math.floor(NOW.getTime() / 1000) - 1,
    });
    const valid = await tokenWith();
    const tampered = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
    const wrongAudience = await tokenWith({ audience: "formoria.com" });

    await expect(
      verifyStagingSession(expired, "staging.formoria.com", { now: NOW }),
    ).resolves.toBeNull();
    await expect(
      verifyStagingSession(tampered, "staging.formoria.com", { now: NOW }),
    ).resolves.toBeNull();
    await expect(
      verifyStagingSession(wrongAudience, "staging.formoria.com", { now: NOW }),
    ).resolves.toBeNull();
  });

  it("rejects wrong-purpose and missing-run-id tokens", async () => {
    enableStaging();
    const wrongPurpose = await tokenWith({ purpose: "smoke" });
    const now = Math.floor(NOW.getTime() / 1000);
    const missingRunId = await new SignJWT({ purpose: "deep" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(E2E_STAGING_SESSION_ISSUER)
      .setAudience(E2E_STAGING_SESSION_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + E2E_STAGING_SESSION_TTL_SECONDS)
      .sign(new TextEncoder().encode(SECRET));

    await expect(
      verifyStagingSession(wrongPurpose, "staging.formoria.com", { now: NOW }),
    ).resolves.toBeNull();
    await expect(
      verifyStagingSession(missingRunId, "staging.formoria.com", { now: NOW }),
    ).resolves.toBeNull();
  });

  it("rejects the right token on a wrong host or a production deployment", async () => {
    enableStaging();
    const token = await tokenWith();

    await expect(
      verifyStagingSession(token, "formoria.com", { now: NOW }),
    ).resolves.toBeNull();

    vi.stubEnv("FORMORIA_DEPLOYMENT_ENV", "production");
    await expect(
      verifyStagingSession(token, "staging.formoria.com", { now: NOW }),
    ).resolves.toBeNull();
  });

  it("fails closed when the secret is missing or weak", async () => {
    enableStaging("");
    await expect(
      verifyStagingSession("anything", "staging.formoria.com", { now: NOW }),
    ).resolves.toBeNull();
    await expect(signStagingSession("run-1779", { now: NOW })).rejects.toThrow(
      /at least 32 bytes/,
    );

    vi.stubEnv("E2E_STAGING_SESSION_SECRET", "too-short");
    await expect(
      verifyStagingSession("anything", "staging.formoria.com", { now: NOW }),
    ).resolves.toBeNull();

    vi.stubEnv("E2E_STAGING_SESSION_SECRET", SECRET);
    vi.stubEnv("CF_ORIGIN_SECRET", SECRET);
    await expect(signStagingSession("run-1779", { now: NOW })).rejects.toThrow(
      /separate from perimeter credentials/,
    );
  });
});
