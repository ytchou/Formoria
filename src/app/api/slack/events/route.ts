import { after, NextResponse } from "next/server";
import { withAuditScope } from "@/lib/audit/scope";
import { verifySlackSignature } from "@/lib/adapters/slack/signature";
import { addReaction, postMessage, resolveChannelName } from "@/lib/adapters/slack/web-api";
import { CHANNEL_PREFIX, evaluateGuards } from "@/lib/services/ops-agent/guards";
import {
  createRequest,
  admitRequest,
  isActiveThread,
  completeThread,
  reactivateThread,
} from "@/lib/services/ops-agent/requests";
import { JSON_BLOCK_RE } from "@/lib/services/ops-agent/repair";
import { runOpsAgent } from "@/lib/services/ops-agent/run";

export const runtime = "nodejs";

const DEFAULT_DAILY_CAP = 50;
const BOT_HANDLE_RE = /^<@[A-Z0-9]+>\s*/;
const MENTION_RE = /<@[A-Z0-9]+>/;
const ROUTINE_MARKER_RE = /Sent using Claude/;

export type EventsRouteDeps = {
  verifySignature: typeof verifySlackSignature;
  postMessage: typeof postMessage;
  addReaction: typeof addReaction;
  resolveChannelName: typeof resolveChannelName;
  evaluateGuards: typeof evaluateGuards;
  createRequest: typeof createRequest;
  admitRequest: typeof admitRequest;
  isActiveThread: typeof isActiveThread;
  completeThread: typeof completeThread;
  reactivateThread: typeof reactivateThread;
  scheduleRun: (requestId: string) => void;
  env: Record<string, string | undefined>;
};

const defaultDeps: EventsRouteDeps = {
  verifySignature: verifySlackSignature,
  postMessage,
  addReaction,
  resolveChannelName,
  evaluateGuards,
  createRequest,
  admitRequest,
  isActiveThread,
  completeThread,
  reactivateThread,
  scheduleRun: (requestId) => after(() => runOpsAgent(requestId)),
  env: process.env as Record<string, string | undefined>,
};

export function createEventsHandler(deps: EventsRouteDeps = defaultDeps) {
  return withAuditScope(async (request: Request) => {
    const rawBody = await request.text();

    const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
    const signature = request.headers.get("x-slack-signature") ?? "";
    const secret = deps.env.SLACK_SIGNING_SECRET ?? "";

    if (!secret) {
      return NextResponse.json({ error: "Signing secret not configured" }, { status: 401 });
    }

    if (!deps.verifySignature({ rawBody, timestamp, signature, secret })) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    if (body.type !== "event_callback") {
      return NextResponse.json({});
    }

    const event = body.event as Record<string, unknown> | undefined;
    if (!event) {
      return NextResponse.json({});
    }

    const isReactionAdded = event.type === "reaction_added";
    const isReactionRemoved = event.type === "reaction_removed";

    if (isReactionAdded || isReactionRemoved) {
      if (event.reaction !== "white_check_mark") return NextResponse.json({});
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type !== "message") return NextResponse.json({});
      const reactionChannelId = item.channel as string;
      const messageTs = item.ts as string;

      if (isReactionAdded) {
        await deps.completeThread(reactionChannelId, messageTs);
      } else {
        await deps.reactivateThread(reactionChannelId, messageTs);
      }
      return NextResponse.json({});
    }

    const isAppMention = event.type === "app_mention";
    const rawText = (event.text as string) ?? "";
    const isThreadReply =
      event.type === "message" &&
      !event.subtype &&
      !event.bot_id &&
      typeof event.thread_ts === "string" &&
      event.thread_ts !== event.ts &&
      !MENTION_RE.test(rawText);
    const isSystemBotRepair =
      event.type === "message" &&
      (!event.subtype || event.subtype === "bot_message") &&
      !!event.bot_id &&
      JSON_BLOCK_RE.test(rawText);

    if (!isAppMention && !isThreadReply && !isSystemBotRepair) {
      return NextResponse.json({});
    }

    const channelId = event.channel as string;
    const threadTs = (event.thread_ts as string) ?? (event.ts as string);

    if (isThreadReply) {
      if (ROUTINE_MARKER_RE.test(rawText)) {
        return NextResponse.json({});
      }
      const active = await deps.isActiveThread(channelId, threadTs);
      if (!active) {
        return NextResponse.json({});
      }
    }

    const slackEventId = (body.event_id as string) ?? null;
    const slackUserId = (event.user as string) ?? (event.bot_id as string) ?? "unknown";
    const text = isAppMention
      ? rawText.replace(BOT_HANDLE_RE, "").trim()
      : rawText.trim();

    const isSystemBot = !!event.bot_id;
    let operatorEmail: string | null;

    if (isSystemBot) {
      if (!JSON_BLOCK_RE.test(rawText)) {
        return NextResponse.json({});
      }
      if (deps.env.OPS_AGENT !== "on") {
        return NextResponse.json({});
      }
      const channelName = await deps.resolveChannelName(channelId);
      if (!channelName?.startsWith(CHANNEL_PREFIX)) {
        return NextResponse.json({});
      }
      operatorEmail = "system:bot";
    } else {
      const channelName = await deps.resolveChannelName(channelId);

      const guardResult = deps.evaluateGuards({
        env: {
          OPS_AGENT: deps.env.OPS_AGENT,
          OPS_AGENT_OPERATORS: deps.env.OPS_AGENT_OPERATORS,
        },
        slackUserId,
        channelName,
      });

      if (!guardResult.ok) {
        if (guardResult.reason === "off") {
          await deps.postMessage({
            channel: channelId,
            threadTs,
            text: "The ops agent is currently off.",
          });
          return NextResponse.json({});
        }

        if (guardResult.reason === "wrong_channel") {
          return NextResponse.json({});
        }

        await deps.createRequest({
          slackEventId,
          slackUserId,
          operatorEmail: null,
          channelId,
          threadTs,
          text,
          status: "refused",
        });
        await deps.postMessage({
          channel: channelId,
          threadTs,
          text: `Request refused: ${guardResult.reason}`,
        });
        return NextResponse.json({});
      }

      operatorEmail = guardResult.operatorEmail;
    }

    const cap = Number(deps.env.OPS_AGENT_DAILY_CAP) || DEFAULT_DAILY_CAP;
    const effectiveCap = isSystemBot ? Number.MAX_SAFE_INTEGER : cap;
    const admitResult = await deps.admitRequest(
      {
        slackEventId,
        slackUserId,
        operatorEmail,
        channelId,
        threadTs,
        text,
        status: "received",
      },
      effectiveCap,
    );

    if (!admitResult.ok) {
      await deps.postMessage({
        channel: channelId,
        threadTs,
        text: "Daily request cap reached. Try again tomorrow.",
      });
      return NextResponse.json({});
    }

    if ("duplicate" in admitResult) {
      return NextResponse.json({});
    }

    const row = admitResult.row;
    if (!row) {
      return NextResponse.json({});
    }

    const messageTs = (event.ts as string) ?? "";
    if (messageTs) {
      deps.addReaction({ channel: channelId, timestamp: messageTs, name: "eyes" })
        .catch((err) => console.warn("[ops-agent] eyes reaction failed:", err));
    }

    deps.scheduleRun(row.id);
    return NextResponse.json({});
  });
}

export const POST = createEventsHandler();
