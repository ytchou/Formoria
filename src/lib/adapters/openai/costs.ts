import { auditedCall } from "@/lib/audit";
import { ExternalServiceError } from "@/lib/errors";

const ENDPOINT = "https://api.openai.com/v1/organization/costs";
const TIMEOUT_MS = 15_000;
const BUCKET_LIMIT = 31;
// A billing cycle is at most 31 daily buckets, so one page normally covers it.
// Ceiling: 12 pages (~1 year of daily buckets); raise it if the report ever
// asks for a longer window.
const MAX_PAGES = 12;

type OpenAICostDay = { start: string; end: string; usd: number };

export type OpenAICosts = {
  totalUsd: number;
  days: OpenAICostDay[];
};

export type OpenAICostsDependencies = {
  fetchImpl?: typeof fetch;
  apiKey?: string;
};

type CostBucket = {
  start_time: number;
  end_time: number;
  results: Array<{ amount?: { value?: unknown; currency?: unknown } | null }>;
};

type CostsPage = {
  data: CostBucket[];
  has_more: boolean;
  next_page: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCostBucket(value: unknown): value is CostBucket {
  return (
    isRecord(value) &&
    typeof value.start_time === "number" &&
    typeof value.end_time === "number" &&
    Array.isArray(value.results) &&
    value.results.every(
      (result) =>
        isRecord(result) &&
        (result.amount === undefined ||
          result.amount === null ||
          (isRecord(result.amount) &&
            typeof result.amount.value === "number" &&
            Number.isFinite(result.amount.value))),
    )
  );
}

function isCostsPage(value: unknown): value is CostsPage {
  return (
    isRecord(value) &&
    Array.isArray(value.data) &&
    value.data.every(isCostBucket) &&
    typeof value.has_more === "boolean" &&
    (value.next_page === undefined ||
      value.next_page === null ||
      typeof value.next_page === "string")
  );
}

function providerMessage(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  return typeof body.error.message === "string" ? body.error.message : null;
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * OpenAI's billed organization cost, from the Costs API. Requires an admin
 * key (OPENAI_ADMIN_KEY); a project key is rejected by this endpoint.
 */
export async function fetchOpenAICosts(
  { startTime, endTime }: { startTime: Date; endTime: Date },
  dependencies: OpenAICostsDependencies = {},
): Promise<OpenAICosts> {
  const apiKey = (dependencies.apiKey ?? process.env.OPENAI_ADMIN_KEY)?.trim();
  if (!apiKey) {
    throw new Error("OpenAI Costs API is not configured: OPENAI_ADMIN_KEY is required");
  }
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const start = unixSeconds(startTime);
  const end = unixSeconds(endTime);

  return auditedCall(
    { provider: "openai", operation: "organization_costs", kind: "external" },
    async (audit) => {
      const buckets: CostBucket[] = [];
      let nonUsdResults = 0;
      let pageCursor: string | null = null;
      let pages = 0;

      for (;;) {
        if (pages >= MAX_PAGES) {
          throw new Error("OpenAI Costs API exceeded the page cap");
        }
        pages += 1;
        const params = new URLSearchParams({
          start_time: String(start),
          end_time: String(end),
          bucket_width: "1d",
          limit: String(BUCKET_LIMIT),
        });
        if (pageCursor) params.set("page", pageCursor);

        const response = await fetchImpl(`${ENDPOINT}?${params.toString()}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
          audit.summary.response = { httpStatus: response.status, pages };
          const body: unknown = await response.json().catch(() => null);
          throw new ExternalServiceError(
            "openai",
            "organization_costs",
            response.status,
            providerMessage(body),
          );
        }

        const body: unknown = await response.json();
        if (!isCostsPage(body)) {
          audit.summary.response = {
            httpStatus: response.status,
            pages,
            invalidPayload: true,
          };
          throw new Error("OpenAI Costs API returned an invalid response");
        }

        buckets.push(...body.data);
        if (!body.has_more) break;
        if (!body.next_page) {
          throw new Error("OpenAI Costs API reported more pages without a cursor");
        }
        pageCursor = body.next_page;
      }

      const days = buckets.map((bucket) => {
        let usd = 0;
        for (const result of bucket.results) {
          if (!result.amount) continue;
          const currency = result.amount.currency;
          if (typeof currency === "string" && currency.toLowerCase() !== "usd") {
            nonUsdResults += 1;
            continue;
          }
          usd += result.amount.value as number;
        }
        return {
          start: new Date(bucket.start_time * 1000).toISOString(),
          end: new Date(bucket.end_time * 1000).toISOString(),
          usd,
        };
      });
      const totalUsd = days.reduce((total, day) => total + day.usd, 0);

      audit.summary.response = {
        httpStatus: 200,
        pages,
        bucketCount: days.length,
        nonUsdResults,
      };
      return { totalUsd, days };
    },
    {
      summary: {
        request: {
          method: "GET",
          startTime: start,
          endTime: end,
          bucketWidth: "1d",
        },
      },
    },
  );
}
