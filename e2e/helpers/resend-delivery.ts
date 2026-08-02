// Delivery assertion for emails sent through Resend.
//
// Why this exists: asserting on the signup response only proves Supabase
// *accepted* the message. src/app/auth/actions.ts returns {error} when
// supabase.auth.signUp() fails, so a synchronous SMTP failure already fails the
// spec. What it cannot see is an ASYNCHRONOUS delivery failure — Supabase hands
// off cleanly, returns success, and the message bounces downstream. That is
// exactly what went undetected in DEV-1300: ~10 hard bounces/day while the
// suite stayed green, until Supabase threatened to restrict sending.
//
// Resend's list endpoint has no recipient filter, but it returns `to` and
// `last_event` per record and accepts limit=100. At this project's volume
// (~10 transactional emails/day) a just-sent message is always on the first
// page. If volume ever grows past ~100 emails between send and assertion, this
// needs pagination via the `after` cursor.

const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails?limit=100';

// Resend event vocabulary, per https://resend.com/docs — `last_event` carries
// the most recent event for the message.
const TERMINAL_FAILURE_EVENTS = new Set([
  'bounced',
  'complained',
  'failed',
  'suppressed',
  'canceled',
]);
const TERMINAL_SUCCESS_EVENT = 'delivered';

export type DeliveryOutcome =
  | { status: 'delivered'; lastEvent: string }
  | { status: 'failed'; lastEvent: string }
  | { status: 'pending'; lastEvent: string }
  | { status: 'not_found' };

interface ResendEmailRecord {
  id: string;
  to: string[] | string;
  last_event?: string;
  created_at?: string;
}

function recipients(record: ResendEmailRecord): string[] {
  if (Array.isArray(record.to)) return record.to;
  return typeof record.to === 'string' ? [record.to] : [];
}

async function findByRecipient(
  apiKey: string,
  recipient: string,
): Promise<ResendEmailRecord | null> {
  const response = await fetch(RESEND_EMAILS_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    // A bad key or a Resend outage must not read as 'delivered' — surface it.
    throw new Error(
      `Resend list-emails failed: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as { data?: ResendEmailRecord[] };
  const target = recipient.toLowerCase();
  const match = (body.data ?? []).find((record) =>
    recipients(record).some((address) => address.toLowerCase() === target),
  );
  return match ?? null;
}

/**
 * Polls Resend until the message to `recipient` reaches a terminal state.
 *
 * Never throws on a non-delivery — returns the outcome so the caller decides
 * whether it is a failure. Throws only when Resend itself is unreachable or
 * rejects the key, which is a different problem from a bounce.
 */
export async function waitForDelivery(
  recipient: string,
  options: { apiKey: string; timeoutMs?: number; pollMs?: number },
): Promise<DeliveryOutcome> {
  const { apiKey, timeoutMs = 60_000, pollMs = 3_000 } = options;
  const deadline = Date.now() + timeoutMs;
  let last: ResendEmailRecord | null = null;

  while (Date.now() < deadline) {
    last = await findByRecipient(apiKey, recipient);

    if (last) {
      const event = last.last_event ?? 'unknown';
      if (event === TERMINAL_SUCCESS_EVENT) return { status: 'delivered', lastEvent: event };
      if (TERMINAL_FAILURE_EVENTS.has(event)) return { status: 'failed', lastEvent: event };
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  if (!last) return { status: 'not_found' };
  return { status: 'pending', lastEvent: last.last_event ?? 'unknown' };
}
