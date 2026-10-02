import { auditedCall } from "@/lib/audit";
import { postLinearGraphql, requireLinearApiKey } from "./linear-graphql";

const ISSUE_CREATE_MUTATION = `
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    issue { identifier url }
  }
}
`;

const LABEL_ENV_MAP: Record<string, string> = {
  data_quality: "LINEAR_LABEL_DATA_QUALITY",
  ops: "LINEAR_LABEL_OPS",
};

type TicketContent = {
  title: string;
  body: string;
};

export type TicketSpec = TicketContent &
  ({ label: string; labels?: never } | { label?: never; labels: string[] });

export type TicketResult = {
  identifier: string;
  url?: string;
};

function resolveLabel(label: string): string {
  const normalizedLabel = label.toLowerCase().replace(/\s+/g, '_');
  const envKey = LABEL_ENV_MAP[normalizedLabel];
  if (envKey) {
    return process.env[envKey] ?? label;
  }
  // Pass-through: already a UUID or unknown key
  return label;
}

export async function createTicket(spec: TicketSpec): Promise<TicketResult> {
  const apiKey = requireLinearApiKey();

  const teamId = process.env.LINEAR_TEAM_ID;
  if (!teamId) {
    throw new Error(
      "Linear is not configured: LINEAR_TEAM_ID is required",
    );
  }

  const labelIds = (spec.labels ?? [spec.label]).map(resolveLabel);

  const projectId = process.env.LINEAR_PROJECT_ID;
  const assigneeId = process.env.LINEAR_ASSIGNEE_ID;
  const stateId = process.env.LINEAR_STATE_TODO_ID;

  return auditedCall(
    { provider: "linear", operation: "create_ticket", kind: "external" },
    async () => {
      const input: Record<string, unknown> = {
        teamId,
        title: spec.title,
        description: spec.body,
        labelIds,
        priority: 1,
        ...(projectId && { projectId }),
        ...(assigneeId && { assigneeId }),
        ...(stateId && { stateId }),
      };

      const json = await postLinearGraphql<{
        issueCreate: { issue: { identifier: string; url?: string } };
      }>(apiKey, { query: ISSUE_CREATE_MUTATION, variables: { input } });

      if (json.errors?.length) {
        throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
      }

      const { identifier, url } = json.data!.issueCreate.issue;
      return { identifier, ...(url ? { url } : {}) };
    },
  );
}
