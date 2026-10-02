const LINEAR_API_URL = "https://api.linear.app/graphql";
const TIMEOUT_MS = 10_000;

export type LinearGraphqlBody<TData> = {
  errors?: Array<{ message: string }>;
  data?: TData | null;
};

/** Reads LINEAR_API_KEY; throws when Linear is not configured. */
export function requireLinearApiKey(): string {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error("Linear is not configured: LINEAR_API_KEY is required");
  }
  return apiKey;
}

/**
 * POSTs one GraphQL request to Linear and returns the parsed body. Throws on a
 * non-2xx response. GraphQL `errors` are returned to the caller, which decides
 * whether partial `data` is usable. Callers wrap this in their own auditedCall.
 */
export async function postLinearGraphql<TData>(
  apiKey: string,
  payload: { query: string; variables: Record<string, unknown> },
  fetchFn: typeof fetch = fetch,
): Promise<LinearGraphqlBody<TData>> {
  const response = await fetchFn(LINEAR_API_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Linear API error: ${response.status} ${text}`.trim());
  }

  return (await response.json()) as LinearGraphqlBody<TData>;
}
