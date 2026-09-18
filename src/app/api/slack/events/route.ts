import { after, NextResponse } from "next/server";
import { withAuditScope } from "@/lib/audit/scope";
import { verifySlackSignature } from "@/lib/adapters/slack/signature";
import { postMessage, resolveChannelName } from "@/lib/adapters/slack/web-api";
import { evaluateGuards } from "@/lib/services/ops-agent/guards";
import {
  createRequest,
  admitRequest,
} from "@/lib/services/ops-agent/requests";
import { runOpsAgent } from "@/lib/services/ops-agent/run";

export const runtime = "nodejs";

const DEFAULT_DAILY_CAP = 50;
const BOT_HANDLE_RE = /^<@[A-Z0-9]+>\s*/;

export type EventsRouteDeps = {
  verifySignature: typeof verifySlackSignature;
  postMessage: typeof postMessage;
  resolveChannelName: typeof resolveChannelName;
  evaluateGuards: typeof evaluateGuards;
  createRequest: typeof createRequest;
  admitRequest: typeof admitRequest;
  scheduleRun: (requestId: string) => void;
  env: Record<string, string | undefined>;
};

const defaultDeps: EventsRouteDeps = {
  verifySignature: verifySlackSignature,
  postMessage,
  resolveChannelName,
  evaluateGuards,
  createRequest,
  admitRequest,
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

    if (event.type !== "app_mention") {
      return NextResponse.json({});
    }

    const slackEventId = (body.event_id as string) ?? null;
    const slackUserId = event.user as string;
    const channelId = event.channel as string;
    const rawText = (event.text as string) ?? "";
    const threadTs = (event.thread_ts as string) ?? (event.ts as string);
    const text = rawText.replace(BOT_HANDLE_RE, "").trim();

    const isSystemBot = !!event.bot_id;
    let operatorEmail: string | null;

    if (isSystemBot) {
      const jsonBlockRe = /```json\s*\{[\s\S]*?\}\s*```/;
      if (!jsonBlockRe.test(rawText)) {
        return NextResponse.json({});
      }
      if (deps.env.OPS_AGENT !== "on") {
        return NextResponse.json({});
      }
      const channelName = await deps.resolveChannelName(channelId);
      if (!channelName?.startsWith("formoria-")) {
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
      cap,
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

    deps.scheduleRun(row.id);
    return NextResponse.json({});
  });
}

export const POST = createEventsHandler();
