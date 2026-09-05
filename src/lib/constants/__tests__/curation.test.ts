import { describe, it, expect } from "vitest";
import { CURATION_AGENT_REVIEWER_ID } from "@/lib/constants/curation";

describe("CURATION_AGENT_REVIEWER_ID", () => {
  it("curation_agent_reviewer_id_is_a_fixed_v4_uuid", () => {
    expect(CURATION_AGENT_REVIEWER_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(CURATION_AGENT_REVIEWER_ID).toBe(
      "1b19250d-2b67-46d3-ab5a-ef2baa996f5b",
    );
  });
});
