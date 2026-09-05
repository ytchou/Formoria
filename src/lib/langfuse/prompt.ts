import { getLangfuse } from "./client";

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

export type PromptMeta = {
  text: string;
  prompt: { name: string; version: number } | null;
};

/**
 * Parses `LANGFUSE_PROMPT_VERSIONS` env var into a name-to-version map.
 * Format: `"name:version,name:version"`. Blank/unset returns `{}`.
 * A malformed pair (non-numeric version) throws naming the pair.
 */
export function parsePromptVersionPins(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
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
 * version was used. Returns `{ text, prompt }` where `prompt` is
 * `{ name, version }` when a real Langfuse prompt was fetched, or `null`
 * when the client is absent or the fetch threw (fallback case).
 */
export async function fetchLangfusePromptWithMeta(
  name: string,
  fallback: string,
  variables?: Record<string, string>,
): Promise<PromptMeta> {
  const client = getLangfuse();
  if (!client) {
    if (variables) {
      assertAllVariablesPresent(fallback, variables);
      return { text: compileVariables(fallback, variables), prompt: null };
    }
    return { text: fallback, prompt: null };
  }

  let rawTemplate: string;
  let sdkCompile: ((vars: Record<string, string>) => unknown) | null = null;
  let promptMeta: { name: string; version: number } | null = null;

  try {
    // Read version pins per call so env changes take effect without restart
    const pins = parsePromptVersionPins();
    const pinnedVersion = pins[name];

    const promptClient =
      pinnedVersion !== undefined
        ? await client.getPrompt(name, pinnedVersion, { fallback })
        : await client.getPrompt(name, undefined, {
            fallback,
            label: "production",
          });

    if (typeof promptClient.prompt !== "string") {
      console.warn(
        `Langfuse prompt "${name}" is not a text prompt (got ${typeof promptClient.prompt}), using fallback`,
      );
      rawTemplate = fallback;
    } else {
      rawTemplate = promptClient.prompt;
      sdkCompile = (vars) => promptClient.compile(vars);
      if (!promptClient.isFallback) {
        promptMeta = {
          name: promptClient.name,
          version: promptClient.version,
        };
      }
    }
  } catch (error) {
    console.warn(
      `Failed to fetch Langfuse prompt "${name}", using fallback:`,
      error,
    );
    rawTemplate = fallback;
  }

  if (variables) {
    assertAllVariablesPresent(rawTemplate, variables);
    const text = sdkCompile
      ? (sdkCompile(variables) as string)
      : compileVariables(rawTemplate, variables);
    return { text, prompt: promptMeta };
  }

  return { text: rawTemplate, prompt: promptMeta };
}

/**
 * Fetches a named prompt from Langfuse using the SDK's built-in caching and
 * fallback mechanism. Optionally compiles template variables.
 *
 * When `variables` is provided, every `{{placeholder}}` in the prompt must
 * have a matching key — missing keys throw before compilation.
 */
export async function fetchLangfusePrompt(
  name: string,
  fallback: string,
  variables?: Record<string, string>,
): Promise<string> {
  return (await fetchLangfusePromptWithMeta(name, fallback, variables)).text;
}
