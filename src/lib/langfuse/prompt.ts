import { getLangfuse } from "./client";
import snapshot from "@/lib/prompts/langfuse-snapshot.json";

export type PromptName = keyof typeof snapshot.prompts;

export type PromptMeta = {
  text: string;
  prompt: { name: string; version: number; source: "langfuse" | "snapshot" };
};

/**
 * Returns the snapshot text (lines joined with `\n`) and version for a named
 * prompt. Throws if the name is not present in the snapshot.
 */
export function snapshotPrompt(
  name: PromptName,
): { text: string; version: number } {
  const entry = snapshot.prompts[name];
  if (!entry) {
    throw new Error(`Unknown prompt name: "${String(name)}"`);
  }
  return { text: entry.text.join("\n"), version: entry.version };
}

// Module-level set for drift warn-once semantics, keyed by prompt name.
const driftWarned = new Set<string>();

/** Resets the drift warning set. Exported for tests only. */
export function resetDriftWarningsForTests(): void {
  driftWarned.clear();
}

/**
 * Compiles `{{key}}` placeholders in a template string by replacing each
 * with the corresponding value from `variables`.
 */
function compileVariables(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return key in variables ? variables[key] : `{{${key}}}`;
  });
}

/**
 * Scans a template string for `{{var}}` placeholders and throws if any
 * placeholder lacks a corresponding key in `variables`. Warns (without
 * throwing) for extra keys that have no matching placeholder.
 */
function assertAllVariablesPresent(
  template: string,
  variables: Record<string, string>,
): void {
  const pattern = /\{\{(\w+)\}\}/g;
  const missing: string[] = [];
  const templateKeys = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(template)) !== null) {
    const key = match[1];
    templateKeys.add(key);
    if (!(key in variables)) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing template variables: ${missing.join(", ")}`,
    );
  }

  // Warn about extra variables that have no matching placeholder
  for (const key of Object.keys(variables)) {
    if (!templateKeys.has(key)) {
      console.warn(
        `Extra template variable "${key}" has no matching {{${key}}} placeholder`,
      );
    }
  }
}

/**
 * Parses `LANGFUSE_PROMPT_VERSIONS` env var into a name-to-version map.
 * Format: `"name:version,name:version"`. Blank/unset returns `{}`.
 * A malformed pair (non-numeric version) throws naming the pair.
 */
export function parsePromptVersionPins(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): Record<string, number> {
  const raw = env.LANGFUSE_PROMPT_VERSIONS;
  if (!raw) return {};

  const pins: Record<string, number> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.lastIndexOf(":");
    if (colonIdx === -1) {
      throw new Error(`Malformed prompt version pin: "${trimmed}"`);
    }
    const name = trimmed.slice(0, colonIdx);
    const versionStr = trimmed.slice(colonIdx + 1);
    const version = Number(versionStr);
    if (!Number.isInteger(version) || versionStr.trim() === "") {
      throw new Error(`Malformed prompt version pin: "${trimmed}"`);
    }
    pins[name] = version;
  }
  return pins;
}

/**
 * Fetches a named prompt from Langfuse with metadata about which prompt
 * version was used. The snapshot provides the fallback text and the baseline
 * version for drift detection.
 *
 * `assertAllVariablesPresent` runs OUTSIDE the SDK try/catch so a missing
 * variable surfaces as a hard error (DEV-1641 rule).
 */
export async function fetchLangfusePromptWithMeta(
  name: PromptName,
  variables?: Record<string, string>,
): Promise<PromptMeta> {
  const snap = snapshotPrompt(name);
  const snapshotText = snap.text;

  const client = getLangfuse();
  if (!client) {
    if (variables) {
      assertAllVariablesPresent(snapshotText, variables);
      return {
        text: compileVariables(snapshotText, variables),
        prompt: { name, version: snap.version, source: "snapshot" },
      };
    }
    return {
      text: snapshotText,
      prompt: { name, version: snap.version, source: "snapshot" },
    };
  }

  let rawTemplate: string;
  let sdkCompile: ((vars: Record<string, string>) => unknown) | null = null;
  let promptInfo: PromptMeta["prompt"];

  try {
    // Read version pins per call so env changes take effect without restart
    const pins = parsePromptVersionPins();
    const pinnedVersion = pins[name];

    const promptClient =
      pinnedVersion !== undefined
        ? await client.getPrompt(name, pinnedVersion, {
            fallback: snapshotText,
          })
        : await client.getPrompt(name, undefined, {
            fallback: snapshotText,
            label: "production",
          });

    if (typeof promptClient.prompt !== "string") {
      console.warn(
        `Langfuse prompt "${name}" is not a text prompt (got ${typeof promptClient.prompt}), using fallback`,
      );
      rawTemplate = snapshotText;
      promptInfo = { name, version: snap.version, source: "snapshot" };
    } else {
      rawTemplate = promptClient.prompt;
      sdkCompile = (vars) => promptClient.compile(vars);
      if (promptClient.isFallback) {
        promptInfo = { name, version: snap.version, source: "snapshot" };
      } else {
        promptInfo = {
          name: promptClient.name,
          version: promptClient.version,
          source: "langfuse",
        };
        // Drift check: warn once per name when remote text differs from snapshot
        if (
          typeof promptClient.prompt === "string" &&
          promptClient.prompt !== snapshotText &&
          !driftWarned.has(name)
        ) {
          driftWarned.add(name);
          console.warn(
            `[langfuse] prompt "${name}": production v${promptClient.version} differs from snapshot v${snap.version}; run pnpm llm-eval prompt pull`,
          );
        }
      }
    }
  } catch (error) {
    console.warn(
      `Failed to fetch Langfuse prompt "${name}", using fallback:`,
      error,
    );
    rawTemplate = snapshotText;
    promptInfo = { name, version: snap.version, source: "snapshot" };
  }

  if (variables) {
    assertAllVariablesPresent(rawTemplate, variables);
    const text = sdkCompile
      ? (sdkCompile(variables) as string)
      : compileVariables(rawTemplate, variables);
    return { text, prompt: promptInfo };
  }

  return { text: rawTemplate, prompt: promptInfo };
}

/**
 * Fetches a named prompt from Langfuse. Returns the compiled text only.
 */
export async function fetchLangfusePrompt(
  name: PromptName,
  variables?: Record<string, string>,
): Promise<string> {
  return (await fetchLangfusePromptWithMeta(name, variables)).text;
}
