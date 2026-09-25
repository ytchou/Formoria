import { auditedCall } from "@/lib/audit";

const LINEAR_API_URL = "https://api.linear.app/graphql";
const TIMEOUT_MS = 10_000;

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
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Linear is not configured: LINEAR_API_KEY is required",
    );
  }

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

      const response = await fetch(LINEAR_API_URL, {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: ISSUE_CREATE_MUTATION,
          variables: { input },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Linear API error: ${response.status} ${text}`.trim());
      }

      const json = (await response.json()) as {
        errors?: Array<{ message: string }>;
        data: { issueCreate: { issue: { identifier: string; url?: string } } };
      };

      if (json.errors?.length) {
        throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
      }

      const { identifier, url } = json.data.issueCreate.issue;
      return { identifier, ...(url ? { url } : {}) };
    },
  );
}
