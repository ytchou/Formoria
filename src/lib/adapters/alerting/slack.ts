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
