import { expect } from '@playwright/test';

import { POLL } from '../budgets';

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
  | { status: 'not_found' }
  // Resend refused the credential, so delivery could not be OBSERVED. That is
  // never evidence that delivery failed, and the caller must not treat it as a
  // bounce. Same class as the Supabase 429 quota case the spec already tolerates:
  // infrastructure we do not control, recorded as a visible skip rather than a
  // red suite or a false green (DEV-1380).
  | { status: 'unobservable'; httpStatus: number };

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
): Promise<ResendEmailRecord | { unobservable: number } | null> {
  const response = await fetch(RESEND_EMAILS_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (response.status === 401 || response.status === 403) {
    // Credential refused: the check cannot run. Distinct from every other
    // non-OK status, which still means "Resend is broken" and stays a throw.
    return { unobservable: response.status };
  }

  if (!response.ok) {
    // A Resend outage must not read as 'delivered' — surface it.
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
 * whether it is a failure. A refused credential returns `unobservable` rather
 * than throwing: it means the check could not run, which is not the same claim
 * as "the message bounced" and must not fail the suite on the app's behalf.
 * Throws only when Resend itself is unreachable or erroring.
 */
export async function waitForDelivery(
  recipient: string,
  options: { apiKey: string },
): Promise<DeliveryOutcome> {
  const { apiKey } = options;
  let last: ResendEmailRecord | null = null;
  let terminal: DeliveryOutcome | null = null;

  try {
    await expect
      .poll(
        async () => {
          const result = await findByRecipient(apiKey, recipient);

          if (result && 'unobservable' in result) {
            terminal = { status: 'unobservable', httpStatus: result.unobservable };
            return true;
          }
          last = result;

          if (last) {
            const event = last.last_event ?? 'unknown';
            if (event === TERMINAL_SUCCESS_EVENT) {
              terminal = { status: 'delivered', lastEvent: event };
              return true;
            }
            if (TERMINAL_FAILURE_EVENTS.has(event)) {
              terminal = { status: 'failed', lastEvent: event };
              return true;
            }
          }

          return false;
        },
        POLL.DB,
      )
      .toBe(true);
  } catch (error) {
    // A polling timeout is an observable pending delivery, not a helper error.
    // Preserve the old return shape; network and Resend errors still surface.
    if (!(error instanceof Error) || !/timeout|timed out/i.test(error.message)) throw error;
  }

  if (terminal) return terminal;
  if (!last) return { status: 'not_found' };
  return { status: 'pending', lastEvent: last.last_event ?? 'unknown' };
}
