import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { setTimeout as sleep } from "node:timers/promises";
import { POLL } from "../budgets";

export type CapturedAuthEmail = {
  id: string;
  action: string;
  recipient: string;
  tokenHash: string;
  redirectTo: string;
  createdAt: string;
};

type CaptureRow = {
  id: string;
  action: string;
  recipient: string;
  token_hash: string;
  redirect_to: string;
  created_at: string;
};

const CAPTURE_TABLE = "staging_auth_email_captures";
function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Auth capture access requires the staging service role key");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mapRow(row: CaptureRow): CapturedAuthEmail {
  return {
    id: row.id,
    action: row.action,
    recipient: row.recipient,
    tokenHash: row.token_hash,
    redirectTo: row.redirect_to,
    createdAt: row.created_at,
  };
}

export function capturedAuthLink(capture: CapturedAuthEmail): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  const link = new URL("/auth/v1/verify", supabaseUrl);
  link.searchParams.set("token", capture.tokenHash);
  link.searchParams.set(
    "type",
    capture.action === "recovery" ? "recovery" : capture.action,
  );
  link.searchParams.set("redirect_to", capture.redirectTo);
  return link.toString();
}

export async function waitForCapturedAuthEmail(options: {
  recipient: string;
  action: "signup" | "recovery";
  createdAfter?: string;
  timeoutMs?: number;
}): Promise<CapturedAuthEmail> {
  if (!options.recipient.startsWith("e2e-signup-")) {
    throw new Error("Captured Auth lookup requires an e2e-signup-* recipient");
  }
  const supabase = serviceClient();
  const deadline = Date.now() + (options.timeoutMs ?? POLL.AUTH_CAPTURE.timeout);
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    let query = supabase
      .from(CAPTURE_TABLE)
      .select("id, action, recipient, token_hash, redirect_to, created_at")
      .eq("recipient", options.recipient)
      .eq("action", options.action)
      .order("created_at", { ascending: false })
      .limit(1);
    if (options.createdAfter) query = query.gte("created_at", options.createdAfter);
    const { data, error } = await query.maybeSingle();
    if (error) {
      lastError = error.message;
    } else if (data) {
      return mapRow(data as CaptureRow);
    }
    await sleep(POLL.AUTH_CAPTURE.intervals[0]);
  }
  throw new Error(
    `Timed out waiting for captured ${options.action} email to ${options.recipient}${lastError ? ` (${lastError})` : ""}`,
  );
}

export async function deleteCapturedAuthEmail(id: string | null | undefined): Promise<void> {
  if (!id) return;
  const { error } = await serviceClient().from(CAPTURE_TABLE).delete().eq("id", id);
  if (error) throw new Error(`Unable to delete captured Auth email ${id}: ${error.message}`);
}
