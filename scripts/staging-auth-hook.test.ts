import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../supabase/migrations/20260814084238_staging_auth_email_capture.sql",
  ),
  "utf8",
).toLowerCase();

describe("staging Auth capture contract", () => {
  it("captures only the minimal namespaced token fields", () => {
    expect(migration).toContain("create table if not exists public.staging_auth_email_captures");
    for (const column of ["action", "recipient", "token_hash", "redirect_to", "created_at"]) {
      expect(migration).toContain(`${column} `);
    }
    expect(migration).toContain("recipient like 'e2e-signup-%'");
    expect(migration).not.toContain("raw_event");
    expect(migration).not.toContain("email_body");
    expect(migration).not.toContain("user_metadata");
  });

  it("uses invoker rights and grants only hook insertion and service-role test access", () => {
    expect(migration).toMatch(/returns jsonb[\s\S]*security invoker/);
    expect(migration).toContain("alter table public.staging_auth_email_captures enable row level security");
    expect(migration).toContain("grant insert on table public.staging_auth_email_captures to supabase_auth_admin");
    expect(migration).toContain("grant select, delete on table public.staging_auth_email_captures to service_role");
    expect(migration).toContain("grant execute on function public.staging_capture_auth_email(jsonb) to supabase_auth_admin");
    expect(migration).toContain("revoke all on table public.staging_auth_email_captures from anon, authenticated");
    expect(migration).toContain("redirect_to like 'https://staging.formoria.com/%'");
    expect(migration).not.toContain("security definer");
  });

  it("does not send externally and returns the documented empty hook response", () => {
    expect(migration.match(/return '\{\}'::jsonb;/g)).toHaveLength(2);
    expect(migration).not.toContain("jsonb_build_object('success'");
    expect(migration).not.toMatch(/resend|smtp|http_post|net\.http/);
  });
});
