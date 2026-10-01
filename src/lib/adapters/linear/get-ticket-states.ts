import { auditedCall } from "@/lib/audit";

const LINEAR_API_URL = "https://api.linear.app/graphql";
const TIMEOUT_MS = 10_000;

export type TicketState = {
  state: string;
  type: string;
};

type IssueNode = {
  identifier: string;
  state: { name: string; type: string } | null;
} | null;

/** Linear workflow-state types that mean the ticket is no longer open. */
export function isClosedState(type: string): boolean {
  return type === "completed" || type === "canceled";
}

/**
 * Looks up the workflow state of each Linear identifier in one aliased GraphQL
 * request. Identifiers Linear does not resolve are omitted from the result.
 */
export async function getTicketStates(
  identifiers: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, TicketState>> {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error("Linear is not configured: LINEAR_API_KEY is required");
  }

  const result = new Map<string, TicketState>();
  if (identifiers.length === 0) return result;

  const params = identifiers.map((_, i) => `$id${i}: String!`).join(", ");
  const fields = identifiers
    .map((_, i) => `t${i}: issue(id: $id${i}) { identifier state { name type } }`)
    .join("\n  ");
  const query = `query TicketStates(${params}) {\n  ${fields}\n}`;
  const variables = Object.fromEntries(identifiers.map((id, i) => [`id${i}`, id]));

  return auditedCall(
    { provider: "linear", operation: "get_ticket_states", kind: "external" },
    async () => {
      const response = await fetchFn(LINEAR_API_URL, {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Linear API error: ${response.status} ${text}`.trim());
      }

      const body = (await response.json()) as {
        errors?: Array<{ message: string }>;
        data?: Record<string, IssueNode>;
      };

      if (body.errors && body.errors.length > 0) {
        throw new Error(`Linear GraphQL error: ${body.errors[0]!.message}`);
      }

      for (const node of Object.values(body.data ?? {})) {
        if (!node?.state) continue;
        result.set(node.identifier, { state: node.state.name, type: node.state.type });
      }
      return result;
    },
  );
}
