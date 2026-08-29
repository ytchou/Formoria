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
  const client = getLangfuse();
  if (!client) {
    if (variables) {
      assertAllVariablesPresent(fallback, variables);
      return compileVariables(fallback, variables);
    }
    return fallback;
  }

  let rawTemplate: string;
  let sdkCompile: ((vars: Record<string, string>) => unknown) | null = null;

  try {
    const prompt = await client.getPrompt(name, undefined, {
      fallback,
      label: "production",
    });

    if (typeof prompt.prompt !== "string") {
      console.warn(
        `Langfuse prompt "${name}" is not a text prompt (got ${typeof prompt.prompt}), using fallback`,
      );
      rawTemplate = fallback;
    } else {
      rawTemplate = prompt.prompt;
      sdkCompile = (vars) => prompt.compile(vars);
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
    return sdkCompile
      ? (sdkCompile(variables) as string)
      : compileVariables(rawTemplate, variables);
  }

  return rawTemplate;
}
