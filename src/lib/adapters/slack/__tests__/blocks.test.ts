import { describe, expect, it } from "vitest";
import {
  renderAnswer,
  renderProposalCard,
  renderResultCard,
  renderThreadNotice,
} from "../blocks";

describe("renderProposalCard", () => {
  it("proposal_card_renders_confirm_and_cancel_with_request_id", () => {
    const blocks = renderProposalCard({
      requestId: "req_abc123",
      operatorSlackId: "U123USER",
      proposal: "Rerun the e2e-staging workflow",
      rationale: "Last run failed due to flaky test",
      expiresAt: "2026-09-15T12:00:00Z",
    });

    // Must contain an actions block
    const actionsBlock = blocks.find(
      (b: Record<string, unknown>) => b.type === "actions",
    );
    expect(actionsBlock).toBeDefined();

    const elements = (actionsBlock as { elements: Array<Record<string, unknown>> })
      .elements;
    expect(elements).toHaveLength(2);

    const confirm = elements.find(
      (e: Record<string, unknown>) => e.action_id === "ops_confirm",
    );
    const cancel = elements.find(
      (e: Record<string, unknown>) => e.action_id === "ops_cancel",
    );

    expect(confirm).toBeDefined();
    expect(confirm!.value).toBe("req_abc123");
    expect(confirm!.style).toBe("primary");

    expect(cancel).toBeDefined();
    expect(cancel!.value).toBe("req_abc123");
    expect(cancel!.style).toBe("danger");

    // Text fallback must be <= 2999 chars (boundedSlackText)
    const textFallbacks = blocks
      .filter((b: Record<string, unknown>) => typeof b.text === "object" && b.text !== null)
      .map(
        (b: Record<string, unknown>) =>
          (b.text as { text: string }).text,
      );

    for (const t of textFallbacks) {
      expect(t.length).toBeLessThanOrEqual(2999);
    }
  });
});

describe("renderResultCard", () => {
  it("result_card_has_no_buttons", () => {
    const blocks = renderResultCard({
      proposal: "Rerun the e2e-staging workflow",
      result: "Workflow dispatched successfully",
    });

    const actionsBlock = blocks.find(
      (b: Record<string, unknown>) => b.type === "actions",
    );
    expect(actionsBlock).toBeUndefined();
  });

  it("renders error when present", () => {
    const blocks = renderResultCard({
      proposal: "Rerun the e2e-staging workflow",
      error: "Dispatch failed: 401 Unauthorized",
    });

    const textContent = JSON.stringify(blocks);
    expect(textContent).toContain("Dispatch failed: 401 Unauthorized");
  });

  it("renders summary under *Result*", () => {
    const blocks = renderResultCard({
      proposal: "Run the e2e-staging workflow",
      summary: "Started e2e run on staging (~20 min).",
    });

    const textContent = JSON.stringify(blocks);
    expect(textContent).toContain("*Result*\\nStarted e2e run on staging (~20 min).");
  });
});

describe("renderAnswer", () => {
  it("renders plain mrkdwn section", () => {
    const blocks = renderAnswer("Here is the status summary.");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "Here is the status summary.",
      },
    });
  });
});

describe("renderThreadNotice", () => {
  it("thread_notice_renders_header_section_and_context", () => {
    const { text, blocks } = renderThreadNotice({
      title: "Repair failed",
      body: "Failed to start repair routine",
      context: "run-123",
    });

    expect(blocks.map((b) => b.type)).toEqual(["header", "section", "context"]);
    expect((blocks[0] as { text: { type: string; text: string } }).text).toMatchObject({
      type: "plain_text",
      text: "Repair failed",
    });
    expect((blocks[1] as { text: { type: string; text: string } }).text).toMatchObject({
      type: "mrkdwn",
      text: "Failed to start repair routine",
    });
    expect(
      (blocks[2] as { elements: Array<{ text: string }> }).elements[0]!.text,
    ).toBe("run-123");
    expect(text).toContain("Repair failed");
  });

  it("thread_notice_omits_context_and_truncates_header", () => {
    const { blocks } = renderThreadNotice({ title: "x".repeat(400), body: "b" });

    expect(blocks.map((b) => b.type)).toEqual(["header", "section"]);
    const header = (blocks[0] as { text: { text: string } }).text.text;
    expect(Array.from(header).length).toBeLessThanOrEqual(150);
  });
});
