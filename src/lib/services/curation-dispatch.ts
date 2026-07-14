const DISPATCH_TIMEOUT_MS = 10_000;

export function sanitizeDispatchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[REDACTED_JWT]",
    )
    .replace(
      /((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 1_000);
}

export async function dispatchCurationJob(
  jobId: string,
): Promise<{ accepted: true; status: string }> {
  const workerUrl = process.env.CURATION_WORKER_URL?.trim().replace(/\/+$/, "");
  const controlToken = process.env.CURATION_WORKER_CONTROL_TOKEN?.trim();

  if (!workerUrl || !controlToken) {
    throw new Error(
      "Immediate enrichment is not configured: CURATION_WORKER_URL and CURATION_WORKER_CONTROL_TOKEN are required",
    );
  }

  const endpoint = workerUrl.endsWith("/run") ? workerUrl : `${workerUrl}/run`;
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${controlToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jobId }),
      cache: "no-store",
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Worker dispatch request failed: ${sanitizeDispatchError(error)}`,
    );
  }

  const responseBody = await response.text();
  let payload: unknown = null;
  try {
    payload = responseBody ? JSON.parse(responseBody) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
    throw new Error(
      `Worker dispatch was rejected: ${sanitizeDispatchError(detail)}`,
    );
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    !("accepted" in payload) ||
    payload.accepted !== true
  ) {
    throw new Error("Worker dispatch returned an invalid acceptance response");
  }

  return {
    accepted: true,
    status:
      "status" in payload && typeof payload.status === "string"
        ? payload.status
        : "accepted",
  };
}
