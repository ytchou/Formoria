import { auditedCall } from "@/lib/audit";
import {
  boundedSlackText,
  renderAgentNotification,
  type AgentNotification,
} from "@/lib/adapters/slack/notification";

/**
 * Slack adapter for background alerting. Owns the webhook POST; the webhook URL
 * is optional so a missing configuration degrades to a single warning instead
 * of failing the job that triggered the alert.
 */

let missingWebhookWarned = false;

function webhookUrl(): string | undefined {
  const value = process.env.SLACK_FORMORIA_WEBHOOK_URL?.trim();
  return value ? value : undefined;
}

/** Posts a notification to Slack. Returns whether it was sent. */
export async function postSlackAlert(
  notification: AgentNotification,
): Promise<boolean> {
  return postWebhookPayload(
    { text: boundedSlackText(renderAgentNotification(notification)) },
    notification.status,
  );
}

/** Posts pre-rendered text to the configured Slack webhook. */
export async function postSlackText(text: string): Promise<boolean> {
  return postWebhookPayload({ text: boundedSlackText(text) });
}

/** Posts Block Kit blocks with a plain-text fallback to the configured Slack webhook. */
export async function postSlackBlocks(
  blocks: Array<Record<string, unknown>>,
  fallbackText: string,
): Promise<boolean> {
  return postWebhookPayload({
    blocks,
    text: boundedSlackText(fallbackText),
  });
}

async function postWebhookPayload(
  payload: Record<string, unknown>,
  messageKind?: AgentNotification["status"],
): Promise<boolean> {
  const url = webhookUrl();
  if (!url) {
    if (!missingWebhookWarned) {
      missingWebhookWarned = true;
      console.warn(
        "[alerting:slack] No SLACK_FORMORIA_WEBHOOK_URL set — Slack alerts are disabled",
      );
    }
    return false;
  }

  return auditedCall(
    { provider: "slack", operation: "post_slack_alert", kind: "external" },
    async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook responded with HTTP ${response.status}`);
      }

      return true;
    },
    {
      summary: {
        messageLength: JSON.stringify(payload).length,
        ...(messageKind ? { messageKind } : {}),
      },
    },
  );
}

export function resetSlackAdapterForTests(): void {
  missingWebhookWarned = false;
}
