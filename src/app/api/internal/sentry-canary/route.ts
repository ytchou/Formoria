import { captureException } from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { isAuthorizedMachineCaller } from "@/lib/security/machine-caller";

export const runtime = "nodejs";

/**
 * Sentry canary: a route that deliberately throws a tagged error so the health
 * agent can validate that the Sentry→PagerDuty round-trip is live.
 *
 * Contract:
 *   POST /api/internal/sentry-canary
 *   headers: { x-origin-verify: ORIGIN_SECRET }
 *   body:    { token: string }           // echoed into a unique event tag
 *   401  — missing or wrong secret
 *   500  — the deliberate canary error (fixed fingerprint, unique token tag)
 *
 * Never returns 2xx: a successful canary fires and crashes, which is the point.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let token = "unknown";
  try {
    const body: unknown = await req.json();
    if (
      typeof body === "object" &&
      body !== null &&
      typeof (body as Record<string, unknown>).token === "string"
    ) {
      token = (body as Record<string, string>).token;
    }
  } catch {
    // Body parse failure is non-fatal — fire the canary with the default token.
    captureException(new Error("sentry-canary: request body unreadable"), {
      fingerprint: ["health_canary"],
      tags: { health_canary: "true", health_canary_token: token },
    });
  }

  const canaryError = new Error(`sentry-canary: deliberate health probe [${token}]`);
  canaryError.name = "SentryCanaryError";

  try {
    captureException(canaryError, {
      fingerprint: ["health_canary"],
      tags: { health_canary: "true", health_canary_token: token },
    });
  } catch (captureError) {
    // Sentry SDK failure must not mask the 500 — the canary still fires.
    captureException(captureError, {
      fingerprint: ["health_canary"],
      tags: { health_canary: "true", health_canary_token: token },
    });
  }

  return NextResponse.json(
    { error: "canary fired", token },
    { status: 500 },
  );
}
