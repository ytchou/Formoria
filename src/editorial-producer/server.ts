import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setAuditWriteSeam } from "@/lib/audit/emit";
import { ProducerController } from "@/lib/services/editorial-producer/controller";
import { RunStore } from "@/lib/services/editorial-producer/store";
import {
  StartSchema,
  CommandSchema,
} from "@/lib/services/editorial-producer/types";

const MAX_BODY_BYTES = 32_000;
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += Buffer.byteLength(chunk);
    if (length > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createEditorialWorker(
  controller: ProducerController,
  token: string,
) {
  if (!token.trim()) throw new Error("EDITORIAL_PRODUCER_TOKEN is required");
  const expected = Buffer.from("Bearer " + token);
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/health") {
        json(response, 200, { ok: true });
        return;
      }
      const authorization = Buffer.from(request.headers.authorization ?? "");
      if (
        authorization.length !== expected.length ||
        !timingSafeEqual(authorization, expected)
      ) {
        json(response, 401, { error: "Unauthorized" });
        return;
      }
      if (
        request.method !== "POST" ||
        !["/runs/start", "/runs/command"].includes(request.url ?? "")
      ) {
        json(response, 404, { error: "Not found" });
        return;
      }
      const input = await body(request);
      if (request.url === "/runs/start") {
        const parsed = StartSchema.safeParse(input);
        if (!parsed.success) {
          json(response, 400, { error: "Invalid start request" });
          return;
        }
        const result = await controller.start(parsed.data);
        json(response, result.accepted ? 202 : 409, result);
      } else {
        const parsed = CommandSchema.safeParse(input);
        if (!parsed.success) {
          json(response, 400, { error: "Invalid run command" });
          return;
        }
        json(response, 200, await controller.command(parsed.data));
      }
    })().catch((error) => {
      if (!response.headersSent)
        json(
          response,
          (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400,
          {
            error:
              (error as NodeJS.ErrnoException).code === "ENOENT"
                ? "Run not found"
                : error instanceof Error
                  ? error.message
                  : "Worker request failed",
          },
        );
    });
  });
  return {
    server,
    async stop() {
      server.closeIdleConnections();
      const closing = new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      await controller.shutdown();
      await closing;
    },
  };
}

async function main() {
  const root = process.env.EDITORIAL_PRODUCER_RUNS_DIR;
  if (!root)
    throw new Error(
      "EDITORIAL_PRODUCER_RUNS_DIR must identify the mounted persistent volume",
    );
  const token = process.env.EDITORIAL_PRODUCER_TOKEN;
  if (!token) throw new Error("EDITORIAL_PRODUCER_TOKEN is required");
  const store = new RunStore(root);
  await store.initialize();
  setAuditWriteSeam(async (record) => {
    try {
      await store.journal(record.correlationId, { audit: record });
      return null;
    } catch (error) {
      return {
        message:
          error instanceof Error ? error.message : "Audit storage failed",
      };
    }
  });
  const worker = createEditorialWorker(new ProducerController(store), token);
  await new Promise<void>((done) =>
    worker.server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", done),
  );
  const shutdown = () => {
    void worker.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log(
    "[editorial-producer] Ready; explicit HTTP initiation only; persistent storage at " +
      root,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error) => {
    console.error(
      "[editorial-producer] startup failed",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
