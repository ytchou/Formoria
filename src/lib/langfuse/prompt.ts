import { getLangfuse } from "./client";

/**
 * Scans a template string for `{{var}}` placeholders and throws if any
 * placeholder lacks a corresponding key in `variables`.
 */
function assertAllVariablesPresent(
  template: string,
  variables: Record<string, string>,
): void {
  const pattern = /\{\{(\w+)\}\}/g;
  const missing: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(template)) !== null) {
    const key = match[1];
    if (!(key in variables)) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing template variables: ${missing.join(", ")}`,
    );
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
    return fallback;
  }

  const prompt = await client.getPrompt(name, undefined, {
    fallback,
    label: "production",
  });

  if (variables) {
    assertAllVariablesPresent(prompt.prompt as string, variables);
    return prompt.compile(variables) as string;
  }

  return prompt.prompt as string;
}
