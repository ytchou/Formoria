/**
 * Claude Code CLI integration for the repo worker.
 *
 * Builds the argument list and sanitised environment for spawning Claude Code
 * inside a cloned repository. The spawn itself is in jobs.ts behind a DI seam.
 *
 * Provider: claude-code (already registered in audit providers).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaudeOptions = {
  prompt: string;
  allowedTools: string[];
  maxTurns: number;
  jsonSchema: object;
  resumeSessionId?: string;
};

export type ClaudeEnvOptions = {
  oauthToken: string;
};

export type ClaudeResult = {
  structuredOutput: unknown;
  sessionId: string | undefined;
  costUsd: number | undefined;
};

// ---------------------------------------------------------------------------
// Argument builder
// ---------------------------------------------------------------------------

/**
 * Build the CLI argument list for `claude` (Claude Code CLI).
 *
 * Non-bare invocation: uses -p for the prompt, --allowedTools for tool
 * restriction, --max-turns for conversation depth, --output-format json for
 * machine-readable output, and --output-schema for structured responses.
 */
export function buildClaudeArgs(opts: ClaudeOptions): string[] {
  const args: string[] = [
    "-p",
    opts.prompt,
    "--allowedTools",
    opts.allowedTools.join(","),
    "--max-turns",
    String(opts.maxTurns),
    "--output-format",
    "json",
  ];

  if (opts.jsonSchema && Object.keys(opts.jsonSchema).length > 0) {
    args.push("--output-schema", JSON.stringify(opts.jsonSchema));
  }

  if (opts.resumeSessionId) {
    args.push("--resume", opts.resumeSessionId);
  }

  return args;
}

// ---------------------------------------------------------------------------
// Environment builder
// ---------------------------------------------------------------------------

/**
 * Build a minimal environment for the Claude Code subprocess.
 *
 * Only CLAUDE_CODE_OAUTH_TOKEN, PATH, and HOME are exposed — no Supabase
 * credentials, no OPENAI keys, no worker secrets leak into the repair agent.
 */
export function buildClaudeEnv(opts: ClaudeEnvOptions): Record<string, string> {
  return {
    CLAUDE_CODE_OAUTH_TOKEN: opts.oauthToken,
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/root",
  };
}

// ---------------------------------------------------------------------------
// Output parser
// ---------------------------------------------------------------------------

/**
 * Parse the JSON output from a Claude Code CLI invocation.
 *
 * The CLI writes a JSON object to stdout when --output-format json is set.
 * This function extracts the structured output, session ID, and cost.
 */
export function parseClaudeOutput(stdout: string): ClaudeResult {
  if (!stdout.trim()) {
    return { structuredOutput: null, sessionId: undefined, costUsd: undefined };
  }

  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    return {
      structuredOutput: parsed.result ?? parsed,
      sessionId:
        typeof parsed.session_id === "string"
          ? parsed.session_id
          : undefined,
      costUsd:
        typeof parsed.cost_usd === "number" ? parsed.cost_usd : undefined,
    };
  } catch {
    return { structuredOutput: stdout, sessionId: undefined, costUsd: undefined };
  }
}
