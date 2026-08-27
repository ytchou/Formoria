import { getLangfuse } from "./client";

const cache = new Map<string, string>();

/**
 * Fetches a named prompt from Langfuse, falling back to a local constant.
 * Results are cached in-memory by prompt name for the lifetime of the process.
 */
export async function fetchLangfusePrompt(
  name: string,
  fallback: string,
): Promise<string> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  try {
    const client = getLangfuse();
    if (!client) return fallback;

    const response = await client.getPrompt(name);
    const text = response.prompt;
    cache.set(name, text);
    return text;
  } catch (err) {
    console.warn(`[langfuse] Failed to fetch prompt "${name}", using fallback`, err);
    return fallback;
  }
}
