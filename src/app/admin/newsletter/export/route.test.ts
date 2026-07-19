import { describe, expect, it } from "vitest";
import { toNewsletterCsv } from "./route";

describe("newsletter CSV export", () => {
  it("exports safe fields and escapes commas, quotes, and line breaks", () => {
    const csv = toNewsletterCsv([{
      id: "550e8400-e29b-41d4-a716-446655440001",
      email: "reader@example.com",
      name: "Reader, \"One\"\nTaipei",
      interests: ["brand-stories", "curated-picks"],
      locale: "en",
      subscribed_at: "2026-07-18T09:00:00Z",
      confirmed_at: null,
      unsubscribed_at: null,
      consent_source: "homepage_newsletter",
      consent_version: "2026-07-16",
      consent_recorded_at: "2026-07-18T09:00:00Z",
      status: "pending",
    }]);

    expect(csv).toContain('"Reader, ""One""\nTaipei"');
    expect(csv).toContain("brand-stories|curated-picks");
    expect(csv).not.toMatch(/confirm_token|unsubscribe_token/);
  });
});
