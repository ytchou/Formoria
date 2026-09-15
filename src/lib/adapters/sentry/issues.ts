import { auditedCall } from "@/lib/audit";

const TIMEOUT_MS = 8_000;
const MAX_TITLE_LENGTH = 200;
const MIN_HOURS = 1;
const MAX_HOURS = 168;
const DEFAULT_LIMIT = 20;

export type SentryIssue = {
  id: string;
  title: string;
  count: string;
  userCount: number;
  lastSeen: string;
  permalink: string;
  level: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeTitle(title: string): string {
  if (title.length <= MAX_TITLE_LENGTH) return title;
  return title.slice(0, MAX_TITLE_LENGTH);
}

function getConfig() {
  const baseUrl = (
    process.env.SENTRY_BASE_URL ?? "https://sentry.io"
  ).replace(/\/$/, "");
  const organization = process.env.SENTRY_ORGANIZATION;
  const project = process.env.SENTRY_PROJECT;
  const token =
    process.env.SENTRY_READ_TOKEN ?? process.env.SENTRY_AUTH_TOKEN;

  if (!organization || !project || !token) {
    throw new Error(
      "Sentry is not configured: SENTRY_ORGANIZATION, SENTRY_PROJECT, and SENTRY_READ_TOKEN are required",
    );
  }

  return { baseUrl, organization, project, token };
}

export async function listIssues(hours = 24): Promise<SentryIssue[]> {
  const config = getConfig();
  const clampedHours = clamp(hours, MIN_HOURS, MAX_HOURS);

  return auditedCall(
    { provider: "sentry", operation: "list_issues", kind: "external" },
    async () => {
      const endpoint = `${config.baseUrl}/api/0/organizations/${encodeURIComponent(config.organization)}/issues/`;
      const params = new URLSearchParams({
        query: `is:unresolved project:${config.project}`,
        environment: "production",
        statsPeriod: `${clampedHours}h`,
        limit: String(DEFAULT_LIMIT),
      });

      const response = await fetch(`${endpoint}?${params.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`Sentry API error: ${response.status}`);
      }

      const data = (await response.json()) as Array<{
        id: string;
        title: string;
        count: string;
        userCount: number;
        lastSeen: string;
        permalink: string;
        level: string;
      }>;

      return data.map((issue) => ({
        id: issue.id,
        title: sanitizeTitle(issue.title),
        count: issue.count,
        userCount: issue.userCount,
        lastSeen: issue.lastSeen,
        permalink: issue.permalink,
        level: issue.level,
      }));
    },
  );
}
