import { auditedCall } from "@/lib/audit";

export function toSlackMrkdwn(markdown: string): string {
  return markdown.replace(/\*\*([^*]+)\*\*/g, "*$1*");
}

type SlackBlock = Record<string, unknown>;

export type SlackMessageMetadata = {
  event_type: string;
  event_payload: Record<string, unknown>;
};

type PostMessageParams = {
  channel: string;
  threadTs?: string;
  text: string;
  blocks?: SlackBlock[];
  metadata?: SlackMessageMetadata;
};

type UpdateMessageParams = {
  channel: string;
  ts: string;
  text: string;
  blocks?: SlackBlock[];
  metadata?: SlackMessageMetadata;
};

type ReadMessageMetadataParams = {
  channel: string;
  ts: string;
};

type AddReactionParams = {
  channel: string;
  timestamp: string;
  name: string;
};

type SlackOk = { ok: true; ts: string };
type SlackUpdateOk = { ok: true };
type SlackReactionOk = { ok: true };
type SlackError = { ok: false; error: string };
type SlackMetadataOk = { ok: true; metadata: SlackMessageMetadata | null };

const TIMEOUT_MS = 8_000;

function getToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not set");
  return token;
}

export async function postMessage(
  params: PostMessageParams,
): Promise<SlackOk | SlackError> {
  const token = getToken();

  return auditedCall(
    { provider: "slack", operation: "post_message", kind: "external" },
    async () => {
      const body: Record<string, unknown> = {
        channel: params.channel,
        text: params.text,
      };
      if (params.threadTs) body.thread_ts = params.threadTs;
      if (params.blocks) body.blocks = params.blocks;
      if (params.metadata) body.metadata = params.metadata;

      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const data = (await response.json()) as { ok: boolean; ts?: string; error?: string };
      if (data.ok) {
        return { ok: true as const, ts: data.ts! };
      }
      return { ok: false as const, error: data.error ?? "unknown_error" };
    },
    {
      classify: (result) => (result.ok ? "succeeded" : "failed"),
    },
  );
}

const channelNameCache = new Map<string, string | null>();

export async function resolveChannelName(channelId: string): Promise<string | null> {
  const cached = channelNameCache.get(channelId);
  if (cached !== undefined) return cached;

  const token = getToken();
  try {
    const response = await fetch(
      `https://slack.com/api/conversations.info?channel=${encodeURIComponent(channelId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const data = (await response.json()) as {
      ok: boolean;
      channel?: { name?: string };
    };
    const name = data.ok ? (data.channel?.name ?? null) : null;
    channelNameCache.set(channelId, name);
    return name;
  } catch {
    return null;
  }
}

export async function updateMessage(
  params: UpdateMessageParams,
): Promise<SlackUpdateOk | SlackError> {
  const token = getToken();

  return auditedCall(
    { provider: "slack", operation: "update_message", kind: "external" },
    async () => {
      const body: Record<string, unknown> = {
        channel: params.channel,
        ts: params.ts,
        text: params.text,
      };
      if (params.blocks) body.blocks = params.blocks;
      if (params.metadata) body.metadata = params.metadata;

      const response = await fetch("https://slack.com/api/chat.update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const data = (await response.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        return { ok: true as const };
      }
      return { ok: false as const, error: data.error ?? "unknown_error" };
    },
    {
      classify: (result) => (result.ok ? "succeeded" : "failed"),
    },
  );
}

export async function addReaction(
  params: AddReactionParams,
): Promise<SlackReactionOk | SlackError> {
  const token = getToken();

  return auditedCall(
    { provider: "slack", operation: "add_reaction", kind: "external" },
    async () => {
      const response = await fetch("https://slack.com/api/reactions.add", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: params.channel,
          timestamp: params.timestamp,
          name: params.name,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const data = (await response.json()) as { ok: boolean; error?: string };
      if (data.ok || data.error === "already_reacted") {
        return { ok: true as const };
      }
      return { ok: false as const, error: data.error ?? "unknown_error" };
    },
    {
      classify: (result) => (result.ok ? "succeeded" : "failed"),
    },
  );
}

export async function readMessageMetadata(
  params: ReadMessageMetadataParams,
): Promise<SlackMetadataOk | SlackError> {
  const token = getToken();

  return auditedCall(
    { provider: "slack", operation: "read_message_metadata", kind: "external" },
    async () => {
      type HistoryResponse = {
        ok: boolean;
        error?: string;
        messages?: Array<{ ts?: string; metadata?: SlackMessageMetadata }>;
      };
      const fetchPage = async (
        method: string,
        query: URLSearchParams,
      ): Promise<HistoryResponse> => {
        const response = await fetch(
          `https://slack.com/api/${method}?${query.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
        return (await response.json()) as HistoryResponse;
      };

      const history = await fetchPage(
        "conversations.history",
        new URLSearchParams({
          channel: params.channel,
          latest: params.ts,
          oldest: params.ts,
          inclusive: "true",
          limit: "1",
          include_all_metadata: "true",
        }),
      );
      if (!history.ok) {
        return { ok: false as const, error: history.error ?? "unknown_error" };
      }
      const topLevel = history.messages?.find((m) => m.ts === params.ts);
      if (topLevel) {
        return { ok: true as const, metadata: topLevel.metadata ?? null };
      }

      // conversations.history returns top-level messages only; a timeline posted
      // as a thread reply is found through conversations.replies. Slack always
      // returns the thread parent first, so the page must hold more than one
      // message; `oldest` skips the replies posted before the timeline.
      const replies = await fetchPage(
        "conversations.replies",
        new URLSearchParams({
          channel: params.channel,
          ts: params.ts,
          oldest: params.ts,
          inclusive: "true",
          limit: "10",
          include_all_metadata: "true",
        }),
      );
      if (!replies.ok) {
        if (replies.error === "thread_not_found") {
          return { ok: true as const, metadata: null };
        }
        return { ok: false as const, error: replies.error ?? "unknown_error" };
      }
      const reply = replies.messages?.find((m) => m.ts === params.ts);
      return { ok: true as const, metadata: reply?.metadata ?? null };
    },
    {
      classify: (result) => (result.ok ? "succeeded" : "failed"),
    },
  );
}
