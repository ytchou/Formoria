import { SignJWT, jwtVerify } from "jose";

import { isStagingEnvironment } from "@/lib/deployment-environment";

export const E2E_STAGING_SESSION_COOKIE = "__Host-formoria-e2e";
export const E2E_STAGING_SESSION_ISSUER = "formoria:e2e";
export const E2E_STAGING_SESSION_AUDIENCE = "staging.formoria.com";
export const E2E_STAGING_SESSION_TTL_SECONDS = 60 * 60;

type ClockOptions = {
  now?: Date;
};

type RequestHeaders = {
  get(name: string): string | null;
};

function stagingSessionKey(): Uint8Array {
  const secret = process.env.E2E_STAGING_SESSION_SECRET ?? "";
  const key = new TextEncoder().encode(secret);
  if (key.byteLength < 32) {
    throw new Error("E2E_STAGING_SESSION_SECRET must be at least 32 bytes");
  }
  const perimeterSecrets = [
    process.env.CF_ORIGIN_SECRET,
    process.env.ORIGIN_SECRET,
    process.env.E2E_ORIGIN_SECRET,
    process.env.CF_ACCESS_CLIENT_SECRET,
  ];
  if (perimeterSecrets.some((candidate) => candidate && candidate === secret)) {
    throw new Error(
      "E2E_STAGING_SESSION_SECRET must be separate from perimeter credentials",
    );
  }
  return key;
}

function isExactStagingHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const normalized = host.trim().toLowerCase();
  return (
    normalized === E2E_STAGING_SESSION_AUDIENCE ||
    normalized === `${E2E_STAGING_SESSION_AUDIENCE}:443`
  );
}

export async function signStagingSession(
  runId: string,
  options: ClockOptions = {},
): Promise<string> {
  const normalizedRunId = runId.trim();
  if (!normalizedRunId || normalizedRunId.length > 128) {
    throw new Error(
      "A staging E2E run ID between 1 and 128 characters is required",
    );
  }

  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000);
  return new SignJWT({ purpose: "deep", run_id: normalizedRunId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(E2E_STAGING_SESSION_ISSUER)
    .setAudience(E2E_STAGING_SESSION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + E2E_STAGING_SESSION_TTL_SECONDS)
    .sign(stagingSessionKey());
}

export async function verifyStagingSession(
  token: string | null | undefined,
  host: string | null | undefined,
  options: ClockOptions = {},
): Promise<{ runId: string } | null> {
  if (!token || !isStagingEnvironment() || !isExactStagingHost(host)) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, stagingSessionKey(), {
      algorithms: ["HS256"],
      issuer: E2E_STAGING_SESSION_ISSUER,
      audience: E2E_STAGING_SESSION_AUDIENCE,
      currentDate: options.now,
      maxTokenAge: E2E_STAGING_SESSION_TTL_SECONDS,
    });
    const runId = payload.run_id;
    if (
      payload.purpose !== "deep" ||
      typeof runId !== "string" ||
      !runId.trim() ||
      runId.length > 128 ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > E2E_STAGING_SESSION_TTL_SECONDS
    ) {
      return null;
    }
    return { runId };
  } catch {
    return null;
  }
}

export async function verifyStagingSessionHeaders(
  headerStore: RequestHeaders,
): Promise<{ runId: string } | null> {
  const cookieHeader = headerStore.get("cookie") ?? "";
  const rawCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${E2E_STAGING_SESSION_COOKIE}=`))
    ?.slice(E2E_STAGING_SESSION_COOKIE.length + 1);
  let token = rawCookie;
  if (rawCookie) {
    try {
      token = decodeURIComponent(rawCookie);
    } catch {
      return null;
    }
  }

  return verifyStagingSession(
    token,
    headerStore.get("x-forwarded-host") ?? headerStore.get("host"),
  );
}
