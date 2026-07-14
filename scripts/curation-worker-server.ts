import { timingSafeEqual, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { config } from "dotenv";
import type { CurationJob } from "@/lib/services/curation-jobs";

config({ path: ".env.local", quiet: true });

const { claimCurationJob, getCurationJob, getCurationJobDetail } =
  await import("@/lib/services/curation-jobs");
const { runJob, sanitizeJobError } = await import("@/lib/services/job-runner");

const MAX_BODY_BYTES = 16 * 1024;
const controlToken = process.env.CURATION_WORKER_CONTROL_TOKEN?.trim();
const port = parsePort(process.env.PORT);
const activeJobs = new Set<string>();

if (!controlToken) {
  throw new Error(
    "CURATION_WORKER_CONTROL_TOKEN is required for the curation worker",
  );
}

const requiredControlToken = controlToken;

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    if (!response.headersSent) {
      sendJson(response, 500, { error: "Worker request failed" });
    }
    console.error("[curation-worker]", sanitizeJobError(error));
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[curation-worker] listening on port ${port}`);
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method !== "POST" || request.url !== "/run") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!isAuthorized(request.headers.authorization, requiredControlToken)) {
    sendJson(response, 401, { error: "Unauthorized" });
    return;
  }

  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    sendJson(response, 400, {
      error: sanitizeJobError(error),
    });
    return;
  }
  const jobId = parseJobId(body);
  if (!jobId) {
    sendJson(response, 400, { error: "jobId must be a UUID" });
    return;
  }

  if (activeJobs.has(jobId)) {
    sendJson(response, 202, { accepted: true, status: "running" });
    return;
  }

  const workerToken = randomUUID();
  const claimed = await claimCurationJob(jobId, workerToken);
  if (!claimed) {
    const current = await getCurationJob(jobId).catch(() => null);
    if (current?.status === "running") {
      sendJson(response, 202, { accepted: true, status: "running" });
      return;
    }

    if (!current) {
      sendJson(response, 404, { error: "Job not found" });
      return;
    }

    sendJson(response, 409, {
      error:
        current.status === "pending"
          ? "Worker is busy or the job is not due yet"
          : "Job is no longer pending",
    });
    return;
  }

  activeJobs.add(jobId);
  sendJson(response, 202, { accepted: true, status: "started" });

  void runWithImmediateRetry(claimed, workerToken)
    .catch((error) => {
      console.error("[curation-worker:run]", sanitizeJobError(error));
    })
    .finally(() => {
      activeJobs.delete(jobId);
    });
}

async function runWithImmediateRetry(
  job: CurationJob,
  workerToken: string,
): Promise<void> {
  await runJob(job, workerToken);

  const detail = await getCurationJobDetail(job.id);
  const retry = detail.children.find(
    (child) =>
      child.trigger === "automatic_retry" && child.status === "pending",
  );
  if (!retry) return;

  const retryToken = randomUUID();
  const claimedRetry = await claimCurationJob(retry.id, retryToken);
  if (claimedRetry) {
    await runJob(claimedRetry, retryToken);
  }
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "8080", 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536
    ? parsed
    : 8080;
}

function isAuthorized(value: string | undefined, expected: string): boolean {
  if (!value?.startsWith("Bearer ")) return false;
  const received = Buffer.from(value.slice("Bearer ".length));
  const expectedBuffer = Buffer.from(expected);
  return (
    received.length === expectedBuffer.length &&
    timingSafeEqual(received, expectedBuffer)
  );
}

function parseJobId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const jobId =
    "jobId" in value && typeof value.jobId === "string"
      ? value.jobId.trim()
      : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    jobId,
  )
    ? jobId
    : null;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}
