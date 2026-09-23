import { NextResponse } from "next/server";

import { postMessage } from "@/lib/adapters/slack/web-api";

export const runtime = "nodejs";

type SummaryPayload = {
  channel: string;
  thread_ts: string;
  text: string;
  blocks: Record<string, unknown>[];
};

function isAuthorizedRoutine(req: Request): boolean {
  const token = process.env.OPS_ROUTINE_CALLBACK_TOKEN?.trim();
  return Boolean(token) && req.headers.get("authorization") === `Bearer ${token}`;
}

/**
 * Relay endpoint for the ops routine to post Slack summaries as the
 * Formoria Ops bot instead of the user's personal Slack connector.
 *
 * POST /api/internal/ops-summary
 * Authorization: Bearer <OPS_ROUTINE_CALLBACK_TOKEN>
 * Body: { channel, thread_ts, text, blocks }
 */
export async function POST(req: Request): Promise<Response> {
  if (!isAuthorizedRoutine(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: SummaryPayload;
  try {
    payload = (await req.json()) as SummaryPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.channel || !payload.thread_ts || !payload.text) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const result = await postMessage({
    channel: payload.channel,
    threadTs: payload.thread_ts,
    text: payload.text,
    blocks: payload.blocks,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Slack post failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, ts: result.ts });
}
