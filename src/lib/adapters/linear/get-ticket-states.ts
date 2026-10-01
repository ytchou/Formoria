import { auditedCall } from "@/lib/audit";
import { postLinearGraphql, requireLinearApiKey } from "./linear-graphql";

/** Provider-neutral ticket state: the workflow state name and whether it is closed. */
type TicketState = {
  state: string;
  closed: boolean;
};

type IssueNode = {
  identifier: string;
  state: { name: string; type: string } | null;
} | null;

/** Linear workflow-state types that mean the ticket is no longer open. */
function isClosedState(type: string): boolean {
  return type === "completed" || type === "canceled";
}

/**
 * Looks up the workflow state of each Linear identifier in one aliased GraphQL
 * request, keyed by the identifier as requested (an issue that moved teams
 * resolves under its old identifier). Identifiers Linear does not resolve are
 * omitted: a per-issue "not found" error with partial data is not a failure.
 * Throws only when the response carries no data at all.
 */
export async function getTicketStates(
  identifiers: readonly string[],
  fetchFn: typeof fetch = fetch,
): Promise<Map<string, TicketState>> {
  const apiKey = requireLinearApiKey();

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
      const body = await postLinearGraphql<Record<string, IssueNode>>(
        apiKey,
        { query, variables },
        fetchFn,
      );

      if (!body.data) {
        const message = body.errors?.[0]?.message ?? "response has no data";
        throw new Error(`Linear GraphQL error: ${message}`);
      }

      for (const [i, identifier] of identifiers.entries()) {
        const node = body.data[`t${i}`];
        if (!node?.state) continue;
        result.set(identifier, {
          state: node.state.name,
          closed: isClosedState(node.state.type),
        });
      }
      return result;
    },
  );
}
