import { Langfuse } from "langfuse";

let instance: Langfuse | null = null;
let initialized = false;

/**
 * Returns the Langfuse singleton, or null if env vars are missing.
 * Initializes on first call; subsequent calls return the cached instance.
 */
export function getLangfuse(): Langfuse | null {
  if (initialized) return instance;
  initialized = true;

  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_HOST;

  if (!publicKey || !secretKey || !baseUrl) {
    return null;
  }

  try {
    instance = new Langfuse({ publicKey, secretKey, baseUrl });

    process.on("beforeExit", async () => {
      try {
        await instance?.shutdownAsync();
      } catch {
        // Shutdown errors must never break the process exit
      }
    });

    process.on("SIGTERM", async () => {
      try {
        await instance?.shutdownAsync();
      } catch {
        // Shutdown errors must never break the process exit
      }
    });
  } catch {
    // Constructor failure must never break production
    instance = null;
  }

  return instance;
}

/**
 * Explicitly flush pending Langfuse events.
 * No-ops if the client was never initialized or env vars are missing.
 */
export async function flushLangfuse(): Promise<void> {
  if (!instance) return;
  try {
    await instance.flushAsync();
  } catch {
    // Flush errors must never break production
  }
}