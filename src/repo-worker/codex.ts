import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Ajv, { type AnySchema } from "ajv";

import { auditedCall } from "@/lib/audit";
import { sanitizeJobError } from "@/lib/services/job-errors";
import type { AgentRequest, AgentResult } from "./agent";

const CODEX_MODEL = "gpt-5.6-sol";
const CODEX_REASONING_EFFORT = "high";
const CODEX_TIMEOUT_MS = 1_200_000;

type CodexProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

type RunProcess = (
  args: string[],
  cwd: string,
  env: Record<string, string>,
  stdin: string,
) => Promise<CodexProcessResult>;

export type CodexAdapterOptions = {
  apiKey: string;
  runProcess?: RunProcess;
  audit?: typeof auditedCall;
};

export function buildCodexArgs(
  request: AgentRequest,
  schemaPath: string,
  outputPath: string,
): string[] {
  const common = [
    "--json",
    "--ignore-user-config",
    "--model",
    CODEX_MODEL,
    "--config",
    `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
    "--config",
    'shell_environment_policy.inherit="core"',
    "--config",
    "shell_environment_policy.ignore_default_excludes=false",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
  ];

  if (request.resumeSessionId) {
    return ["exec", "resume", ...common, request.resumeSessionId, "-"];
  }

  return [
    "exec",
    ...common,
    "--sandbox",
    request.access === "write" ? "workspace-write" : "read-only",
    "-",
  ];
}

export function buildCodexEnv(apiKey: string): Record<string, string> {
  return {
    CODEX_API_KEY: apiKey,
    HOME: process.env.HOME ?? "/root",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  };
}

export function parseCodexJsonl(
  stdout: string,
): Pick<AgentResult, "sessionId" | "usage"> {
  let sessionId: string | undefined;
  let usage: Record<string, number> | undefined;

  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new Error("Codex emitted malformed JSONL");
    }

    if (
      event.type === "thread.started" &&
      typeof event.thread_id === "string"
    ) {
      sessionId = event.thread_id;
    }
    if (event.type === "turn.completed" && isNumberRecord(event.usage)) {
      usage = event.usage;
    }
  }

  return { sessionId, usage };
}

export function parseCodexStructuredOutput(
  raw: string,
  jsonSchema?: object,
): unknown {
  if (!raw.trim()) throw new Error("Codex returned no structured output");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Codex returned non-JSON structured output");
  }
  if (jsonSchema) {
    const validate = new Ajv({ allErrors: true, strict: false }).compile(
      jsonSchema as AnySchema,
    );
    if (!validate(parsed)) {
      throw new Error("Codex returned structured output that did not match schema");
    }
  }
  return parsed;
}

export async function runCodexAgent(
  repoDir: string,
  request: AgentRequest,
  options: CodexAdapterOptions,
): Promise<AgentResult> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("CODEX_API_KEY is not configured");

  const tempDir = await mkdtemp(path.join(tmpdir(), "formoria-codex-"));
  const schemaPath = path.join(tempDir, "schema.json");
  const outputPath = path.join(tempDir, "output.json");
  const runProcess = options.runProcess ?? defaultRunProcess;
  const audit = options.audit ?? auditedCall;

  try {
    await writeFile(schemaPath, JSON.stringify(request.jsonSchema), "utf8");
    const args = buildCodexArgs(request, schemaPath, outputPath);

    return await audit(
      {
        provider: "openai",
        operation: "codex_exec",
        kind: "external",
        meta: {
          model: CODEX_MODEL,
          access: request.access,
          resumed: Boolean(request.resumeSessionId),
        },
      },
      async (auditContext) => {
        auditContext.summary = {
          request: {
            prompt: request.prompt,
            jsonSchema: request.jsonSchema,
          },
        };
        const processResult = await runProcess(
          args,
          repoDir,
          buildCodexEnv(apiKey),
          request.prompt,
        );
        if (processResult.exitCode !== 0) {
          const detail = sanitizeJobError(
            processResult.stderr || processResult.stdout,
            1_000,
          );
          auditContext.summary.response = {
            exitCode: processResult.exitCode,
            signal: processResult.signal,
            error: detail || "codex_process_failed",
          };
          throw new Error(
            detail
              ? `Codex exited with ${processResult.exitCode}: ${detail}`
              : `Codex exited with ${processResult.exitCode}`,
          );
        }

        let rawOutput: string;
        try {
          rawOutput = await readFile(outputPath, "utf8");
        } catch {
          auditContext.summary.response = {
            exitCode: processResult.exitCode,
            signal: processResult.signal,
            error: "missing_structured_output",
          };
          throw new Error("Codex did not write its structured output file");
        }

        let structuredOutput: unknown;
        try {
          structuredOutput = parseCodexStructuredOutput(
            rawOutput,
            request.jsonSchema,
          );
        } catch (error) {
          auditContext.summary.response = {
            exitCode: processResult.exitCode,
            signal: processResult.signal,
            error: error instanceof Error ? error.message : "invalid_output",
          };
          throw error;
        }
        const { sessionId, usage } = parseCodexJsonl(processResult.stdout);
        const result: AgentResult = {
          structuredOutput,
          ...(sessionId ? { sessionId } : {}),
          ...(usage ? { usage } : {}),
        };

        auditContext.summary = {
          ...auditContext.summary,
          response: result,
          exitCode: processResult.exitCode,
          signal: processResult.signal,
        };
        auditContext.promptTokens = usage?.input_tokens;
        auditContext.completionTokens = usage?.output_tokens;
        return result;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "number")
  );
}

function defaultRunProcess(
  args: string[],
  cwd: string,
  env: Record<string, string>,
  stdin: string,
): Promise<CodexProcessResult> {
  return new Promise((resolve) => {
    const child = spawn("codex", args, {
      cwd,
      env: env as NodeJS.ProcessEnv,
      timeout: CODEX_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: error.message,
        exitCode: 1,
        signal: null,
      });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        signal,
      });
    });
    child.stdin.end(stdin);
  });
}
