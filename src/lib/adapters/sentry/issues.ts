import { auditedCall } from "@/lib/audit";
import { ExternalServiceError } from "@/lib/errors";

const TIMEOUT_MS = 8_000;
const MAX_TITLE_LENGTH = 200;
const MIN_HOURS = 1;
const MAX_HOURS = 168;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export type SentryIssue = {
  id: string;
  title: string;
  count: string;
  userCount: number;
  lastSeen: string;
  permalink: string;
  level: string;
};

export type ListIssuesOptions = {
  limit?: number;
  excludeHealthCanary?: boolean;
  requireComplete?: boolean;
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
    process.env.SENTRY_READ_TOKEN || process.env.SENTRY_AUTH_TOKEN;

  if (!organization || !project || !token) {
    throw new Error(
      "Sentry is not configured: SENTRY_ORGANIZATION, SENTRY_PROJECT, and either SENTRY_AUTH_TOKEN or SENTRY_READ_TOKEN are required",
    );
  }

  return { baseUrl, organization, project, token };
}

function hasNextPage(link: string | null): boolean | null {
  if (!link) return null;
  const next = link
    .split(",")
    .find((part) => /rel=(?:"next"|next)/i.test(part));
  if (!next) return null;
  if (/results=(?:"true"|true)/i.test(next)) return true;
  if (/results=(?:"false"|false)/i.test(next)) return false;
  return null;
}

function isSentryIssue(value: unknown): value is SentryIssue {
  if (typeof value !== "object" || value === null) return false;
  const issue = value as Record<string, unknown>;
  return (
    typeof issue.id === "string" &&
    typeof issue.title === "string" &&
    typeof issue.count === "string" &&
    typeof issue.userCount === "number" &&
    typeof issue.lastSeen === "string" &&
    typeof issue.permalink === "string" &&
    typeof issue.level === "string"
  );
}

export async function listIssues(
  hours = 24,
  options: ListIssuesOptions = {},
): Promise<SentryIssue[]> {
  const config = getConfig();
  const clampedHours = clamp(hours, MIN_HOURS, MAX_HOURS);
  const limit = clamp(
    Math.trunc(options.limit ?? DEFAULT_LIMIT),
    1,
    MAX_LIMIT,
  );
  const query = [
    `is:unresolved project:${config.project}`,
    options.excludeHealthCanary ? "!health_canary:true" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return auditedCall(
    { provider: "sentry", operation: "list_issues", kind: "external" },
    async (audit) => {
      const endpoint = `${config.baseUrl}/api/0/organizations/${encodeURIComponent(config.organization)}/issues/`;
      const params = new URLSearchParams({
        query,
        environment: "production",
        statsPeriod: `${clampedHours}h`,
        limit: String(limit),
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
        audit.summary.response = { httpStatus: response.status };
        throw new ExternalServiceError(
          "sentry",
          "list_issues",
          response.status,
        );
      }

      const data: unknown = await response.json();
      if (!Array.isArray(data) || !data.every(isSentryIssue)) {
        throw new Error("Sentry returned an invalid response");
      }

      const nextPage = hasNextPage(response.headers.get("link"));
      audit.summary.response = {
        httpStatus: response.status,
        issueCount: data.length,
        hasNextPage: nextPage,
      };
      if (
        options.requireComplete &&
        (nextPage === true || (data.length === limit && nextPage !== false))
      ) {
        throw new Error("Sentry returned an incomplete snapshot");
      }

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
    {
      summary: {
        request: {
          method: "GET",
          hours: clampedHours,
          limit,
          environment: "production",
          excludeHealthCanary: options.excludeHealthCanary === true,
          requireComplete: options.requireComplete === true,
        },
      },
    },
  );
}
