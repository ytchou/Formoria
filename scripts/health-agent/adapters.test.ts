import { describe, expect, it, vi } from "vitest";
import type { AuditRecord, HealthFinding } from "./contracts";
import {
  createAgentHubAdapter,
  createGitHubAdapter,
  createLinearAdapter,
  createSentryResolver,
  createSlackAdapter,
  renderSlackDigest,
} from "./adapters";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function auditLog(): {
  records: AuditRecord[];
  audit: (record: AuditRecord) => void;
} {
  const records: AuditRecord[] = [];
  return { records, audit: (record) => records.push(record) };
}

function finding(overrides: Partial<HealthFinding> = {}): HealthFinding {
  return {
    evidence: {
      observed: true,
      owner: "user@example.com",
      secret: "do-not-audit",
    },
    fingerprint: "sentry:issue:issue-1",
    mergePolicy: "human",
    severity: "high",
    source: "sentry",
    title: "Production error needs review",
    ...overrides,
  };
}

function bodyAt(
  fetchImpl: ReturnType<typeof vi.fn>,
  index: number,
): Record<string, unknown> {
  const call = fetchImpl.mock.calls[index];
  return JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
}

describe("Slack adapter", () => {
  it("sends one bounded summary without raw evidence", async () => {
    const { audit, records } = auditLog();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const adapter = createSlackAdapter({
      audit,
      fetchImpl,
      now: () => 100,
      webhookUrl: "https://hooks.slack.test/services/private-webhook",
    });

    const count = await adapter.send({
      failures: [{ reason: "Linear was unavailable", status: "failed" }],
      findings: [finding()],
      linearOutcomes: [{ identifier: "FOR-42", status: "created" }],
      pullRequestOutcomes: [{ identifier: "pr-7", status: "opened" }],
      skippedActions: [{ action: "branch deletion", reason: "protected" }],
      workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/123",
    });

    expect(count).toBe(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://hooks.slack.test/services/private-webhook",
      expect.objectContaining({
        body: expect.stringContaining("Production error needs review"),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    const text = String(bodyAt(fetchImpl, 0).text);
    expect(text).toContain("Production error needs review");
    expect(text).not.toContain("do-not-audit");
    expect(text).not.toContain("user@example.com");
    expect(text).not.toContain("sentry:issue:issue-1");
    expect([...text].length).toBeLessThan(3_000);
    expect(text).toContain("Linear");
    expect(text).toContain("PR");
    expect(text).toContain("Open workflow run");
    expect(records.every((record) => record.schemaValid !== undefined)).toBe(
      true,
    );
    const auditJson = JSON.stringify(records);
    expect(auditJson).not.toContain("private-webhook");
    expect(auditJson).not.toContain("do-not-audit");
    expect(auditJson).not.toContain("user@example.com");
  });

  it("truncates a large digest into one Slack message", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const adapter = createSlackAdapter({
      audit: () => undefined,
      fetchImpl,
      now: () => 100,
      webhookUrl: "https://hooks.slack.test/webhook",
    });

    const count = await adapter.send({
      findings: [
        finding({
          evidence: { veryLongValue: "x".repeat(8_000) },
        }),
      ],
    });

    expect(count).toBe(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const payload = bodyAt(fetchImpl, 0) as { text: string };
    expect([...payload.text].length).toBeLessThan(3_000);
  });

  it("sends a compact all-clear and throws on a non-2xx response", async () => {
    expect(renderSlackDigest({})).toContain("All clear");

    const { audit, records } = auditLog();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("provider failure", { status: 500 }));
    const adapter = createSlackAdapter({
      audit,
      fetchImpl,
      now: () => 100,
      webhookUrl: "https://hooks.slack.test/webhook",
    });

    await expect(adapter.send({})).rejects.toThrow("Slack request failed");
    expect(records.at(-1)).toMatchObject({
      adapter: "slack",
      operation: "send_message",
      schemaValid: true,
      status: "failure",
    });
  });

  it("renders one grouped terminal summary with no ticket before the digest is filed", () => {
    const digest = renderSlackDigest({
      healthSummary: {
        checks: {
          directory: {
            findingCount: 27,
            severities: { critical: 0, high: 6, low: 0, medium: 21 },
            status: "success",
          },
          link: {
            findingCount: 22,
            severities: { critical: 0, high: 0, low: 0, medium: 22 },
            status: "success",
          },
          quality: {
            findingCount: 0,
            severities: { critical: 0, high: 0, low: 0, medium: 0 },
            status: "success",
          },
          cron: {
            findingCount: 0,
            severities: { critical: 0, high: 0, low: 0, medium: 0 },
            status: "success",
          },
          sentry: {
            findingCount: 10,
            severities: { critical: 2, high: 8, low: 0, medium: 0 },
            status: "success",
          },
        },
        overallStatus: "needs_attention",
        deliveryWarnings: [
          {
            category: "optional_delivery",
            code: "linear_ticket_candidates_failed",
            operation: "list_unticketed_health_fingerprints",
            reason: "ledger_reader_unavailable",
          },
        ],
        phases: {
          analyze: "success",
          collect: "success",
          deliver: "success",
          publish: "success",
          repair: "success",
        },
        repair: {
          batches: {
            automatic: {
              findingCount: 3,
              prNumber: 42,
              prUrl: "https://github.com/ytchou/Formoria/pull/42",
              status: "pr_opened",
            },
            human: { findingCount: 0, status: "not_required" },
          },
          claimed: 3,
          fixed: 3,
          pullRequests: 1,
          queued: 59,
          repaired: 3,
          unresolved: 56,
        },
      },
      workflowUrl: "https://github.com/ytchou/Formoria/actions/runs/123",
    });

    expect(digest).toContain("⚠️ *Formoria Health Agent — Needs attention*");
    expect(digest).toContain("*Summary*\n• 59 total · 59 new");
    expect(digest).toContain("• 3 repaired this run · 56 unresolved");
    expect(digest).toContain("*Work done*\n• 1 repair PR");
    expect(digest).toContain(
      "Automatic — 3 · pr opened · <https://github.com/ytchou/Formoria/pull/42|PR #42>",
    );
    expect(digest).not.toContain("Human — 0 · not required");
    expect(digest).not.toContain("Untitled finding");
    expect(digest).not.toContain("linear.app");
    expect(digest).toContain("Optional delivery warnings (1)");
    expect(digest).toContain(
      "linear_ticket_candidates_failed (list_unticketed_health_fingerprints)",
    );
    expect(digest).toContain("ledger_reader_unavailable");
  });

  it("uses the manager summary format and links this run's digest ticket", () => {
    const digest = renderSlackDigest({
      healthSummary: {
        checks: {
          directory: {
            findingCount: 28,
            severities: { critical: 0, high: 0, low: 0, medium: 28 },
            status: "success",
          },
          link: {
            findingCount: 22,
            severities: { critical: 0, high: 0, low: 0, medium: 22 },
            status: "success",
          },
          quality: {
            findingCount: 0,
            severities: { critical: 0, high: 0, low: 0, medium: 0 },
            status: "success",
          },
          cron: {
            findingCount: 0,
            severities: { critical: 0, high: 0, low: 0, medium: 0 },
            status: "success",
          },
          sentry: {
            findingCount: 0,
            severities: { critical: 0, high: 0, low: 0, medium: 0 },
            status: "failed",
          },
        },
        overallStatus: "failed",
        phases: {
          analyze: "failed",
          collect: "success",
          deliver: "skipped",
          publish: "skipped",
          repair: "skipped",
        },
        repair: { fixed: 0, pullRequests: 0, unresolved: 50 },
        // Each run files its own digest ticket; DEV-1231 was the retired
        // rolling ticket and is never written to again.
        ticket: {
          identifier: "DEV-1400",
          url: "https://linear.app/ytchou/issue/DEV-1400",
        },
      },
    });

    expect(digest).toContain("❌ *Formoria Health Agent — Failed*");
    expect(digest).toContain("*Summary*\n• 50 total");
    expect(digest).toContain("• 0 repaired this run · 50 unresolved");
    expect(digest).toContain("• 0 repair PRs");
    expect(digest).toContain("linear.app/ytchou/issue/DEV-1400");
    expect(digest).toContain("Investigate analyze");
    expect(digest).toContain("*Manager action*");
  });
});

describe("Linear adapter", () => {
  function linearConfig(
    fetchImpl: typeof fetch,
    audit: (record: AuditRecord) => void,
  ) {
    return {
      assigneeId: "assignee-1",
      audit,
      fetchImpl,
      now: () => 100,
      oauthToken: "linear-oauth-secret",
      projectId: "project-1",
      teamId: "team-1",
    };
  }

  function allowedLabelsResponse(): Response {
    return jsonResponse({
      data: {
        issueLabels: {
          nodes: [
            { id: "label-dq", name: "Data Quality", team: { id: "team-1" } },
            { id: "label-ops", name: "Ops", team: { id: "team-1" } },
          ],
        },
      },
    });
  }

  function issueCreateResponse(identifier: string): Response {
    return jsonResponse({
      data: {
        issueCreate: {
          issue: { id: `linear-${identifier}`, identifier },
          success: true,
        },
      },
    });
  }

  function digestSummary(
    overrides: Partial<{
      fixed: number;
      newFindings: number;
      ongoingFindings: number;
      regressedFindings: number;
      reviewFindings: number;
      totalFindings: number;
      unresolved: number;
    }> = {},
  ) {
    return {
      fixed: 0,
      newFindings: 1,
      ongoingFindings: 0,
      regressedFindings: 0,
      reviewFindings: 1,
      runAt: "2026-07-29T02:00:00.000Z",
      status: "needs_attention" as const,
      totalFindings: 1,
      unresolved: 1,
      ...overrides,
    };
  }

  it("captures bounded GraphQL errors for failed provider requests", async () => {
    const { audit, records } = auditLog();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          errors: [
            {
              extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
              message: "Argument first must be at most 100 token=private-value",
            },
          ],
        },
        400,
      ),
    );
    const adapter = createLinearAdapter(linearConfig(fetchImpl, audit));

    await expect(adapter.sync([finding()])).rejects.toThrow(
      "Argument first must be at most 100 [redacted-secret]",
    );
    expect(records.at(-1)?.response).toMatchObject({
      httpStatus: 400,
      providerErrors: [
        {
          code: "GRAPHQL_VALIDATION_FAILED",
          message: "Argument first must be at most 100 [redacted-secret]",
        },
      ],
    });
  });

  it("filters automatic findings unless exhausted and creates with configured routing and allowed labels", async () => {
    const { audit, records } = auditLog();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(allowedLabelsResponse())
      .mockResolvedValueOnce(issueCreateResponse("FOR-42"));
    const adapter = createLinearAdapter(linearConfig(fetchImpl, audit));
    const automatic = finding({
      fingerprint: "link:broken:automatic",
      mergePolicy: "automatic",
    });
    const exhausted = finding({
      fingerprint: "link:broken:exhausted",
      mergePolicy: "automatic",
      source: "link",
      title: "Purchase website needs review",
    });

    const result = await adapter.sync([automatic, exhausted], {
      exhaustedAutomationFingerprints: [exhausted.fingerprint],
    });

    expect(result).toMatchObject({ created: 1, skipped: 1, updated: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(bodyAt(fetchImpl, 0).query).toContain("issueLabels");
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer linear-oauth-secret",
    });
    const createInput = (
      bodyAt(fetchImpl, 1).variables as Record<string, unknown>
    ).input as Record<string, unknown>;
    expect(createInput).toMatchObject({
      assigneeId: "assignee-1",
      labelIds: ["label-dq"],
      projectId: "project-1",
      teamId: "team-1",
    });
    expect(createInput.title).toMatch(
      /^Health Agent — 1 new finding \(\d{4}-\d{2}-\d{2}\)$/,
    );
    expect(JSON.stringify(createInput)).not.toContain("milestone");
    expect(JSON.stringify(records)).not.toContain("linear-oauth-secret");
  });

  it("sends personal API keys without an OAuth Bearer prefix", async () => {
    const { audit } = auditLog();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ data: { issues: { nodes: [] } } }));
    const adapter = createLinearAdapter({
      ...linearConfig(fetchImpl, audit),
      apiKey: "linear-personal-api-key",
      oauthToken: undefined,
    });

    await expect(adapter.sync([finding()])).rejects.toThrow(
      "Linear returned an invalid response",
    );

    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "linear-personal-api-key",
    });
  });

  it("creates a fresh digest issue on every run and never updates one", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(allowedLabelsResponse())
      .mockResolvedValueOnce(issueCreateResponse("FOR-100"))
      .mockResolvedValueOnce(allowedLabelsResponse())
      .mockResolvedValueOnce(issueCreateResponse("FOR-101"));
    const adapter = createLinearAdapter(
      linearConfig(fetchImpl, () => undefined),
    );

    const first = await adapter.sync({
      exhaustedAutomationFingerprints: [],
      findings: [finding()],
      summary: digestSummary(),
    });
    const second = await adapter.sync({
      exhaustedAutomationFingerprints: [],
      findings: [finding()],
      summary: digestSummary(),
    });

    expect(first).toMatchObject({ created: 1, updated: 0 });
    expect(second).toMatchObject({ created: 1, updated: 0 });
    expect(first.outcomes[0]).toMatchObject({
      action: "created",
      identifier: "FOR-100",
    });
    expect(second.outcomes[0]).toMatchObject({
      action: "created",
      identifier: "FOR-101",
    });
    const bodies = fetchImpl.mock.calls.map(([, init]) => String(init?.body));
    expect(bodies.filter((body) => body.includes("issueCreate"))).toHaveLength(
      2,
    );
    expect(bodies.some((body) => body.includes("issueUpdate"))).toBe(false);
    expect(bodies.some((body) => body.includes("HealthAgentIssueLookup"))).toBe(
      false,
    );
    expect(bodies.some((body) => body.includes("workflowStates"))).toBe(false);
  });

  it("titles the digest with the in-ticket count and the run date", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(allowedLabelsResponse())
      .mockResolvedValueOnce(issueCreateResponse("FOR-200"));
    const adapter = createLinearAdapter(
      linearConfig(fetchImpl, () => undefined),
    );

    await adapter.sync({
      exhaustedAutomationFingerprints: [],
      findings: [
        finding(),
        finding({
          fingerprint: "link:broken:brand-2",
          source: "link",
          title: "Purchase website needs review",
        }),
      ],
      // The run carries 37 findings in total; the ticket carries 2. The title
      // must report 2 — the mismatch is what produced the misleading "37".
      summary: digestSummary({ reviewFindings: 37, totalFindings: 37 }),
    });

    const createInput = (
      bodyAt(fetchImpl, 1).variables as Record<string, unknown>
    ).input as Record<string, unknown>;
    expect(createInput.title).toBe(
      "Health Agent — 2 new findings (2026-07-29)",
    );
    expect(createInput.description).not.toContain("This rolling ticket");
  });

  it("creates nothing when no finding needs a ticket", async () => {
    const { audit, records } = auditLog();
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = createLinearAdapter(linearConfig(fetchImpl, audit));

    const result = await adapter.sync({
      exhaustedAutomationFingerprints: [],
      findings: [finding({ mergePolicy: "automatic" })],
      summary: digestSummary({ reviewFindings: 0 }),
    });

    expect(result).toMatchObject({ created: 0, skipped: 1, updated: 0 });
    expect(result.outcomes).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(records.at(-1)).toMatchObject({
      adapter: "linear",
      operation: "filter_findings",
      response: { reason: "no_human_or_exhausted_findings" },
      status: "suppressed",
    });
  });

  it("groups multiple eligible findings into one reviewable issue", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(allowedLabelsResponse())
      .mockResolvedValueOnce(issueCreateResponse("FOR-10"));
    const adapter = createLinearAdapter(
      linearConfig(fetchImpl, () => undefined),
    );

    const result = await adapter.sync([
      finding(),
      finding({
        fingerprint: "link:broken:brand-2",
        source: "link",
        title: "Purchase website needs review",
      }),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ created: 1, updated: 0 });
    const createInput = (
      bodyAt(fetchImpl, 1).variables as Record<string, unknown>
    ).input as Record<string, unknown>;
    expect(createInput.title).toContain("2 new findings");
    expect(createInput.description).toEqual(
      expect.stringContaining("<!-- health-agent:summary:v2 -->"),
    );
    expect(createInput.description).toEqual(expect.stringContaining("Sentry"));
    expect(createInput.description).toEqual(expect.stringContaining("Link"));
    expect(createInput.description).toEqual(
      expect.stringContaining("link:broken:brand-2"),
    );
    expect(createInput.description).toEqual(
      expect.stringContaining("**Fixed:** 0 at triage time"),
    );
    expect(createInput.description).toEqual(
      expect.stringContaining("**Manager action:**"),
    );
  });

  it("uses workspace-wide allowed labels without creating duplicates", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            issueLabels: {
              nodes: [
                { id: "label-ops", name: "Ops", team: null },
                {
                  id: "other-team-ops",
                  name: "Ops",
                  team: { id: "team-2" },
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(issueCreateResponse("FOR-12"));
    const adapter = createLinearAdapter(
      linearConfig(fetchImpl, () => undefined),
    );

    await expect(adapter.sync([finding()])).resolves.toMatchObject({
      created: 1,
      updated: 0,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const createInput = (
      bodyAt(fetchImpl, 1).variables as Record<string, unknown>
    ).input as Record<string, unknown>;
    expect(createInput.labelIds).toEqual(["label-ops"]);
    expect(bodyAt(fetchImpl, 1).query).toContain("issueCreate");
  });

  it("paginates allowed labels before deciding a label is missing", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            issueLabels: {
              nodes: [],
              pageInfo: { endCursor: "label-cursor-1", hasNextPage: true },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            issueLabels: {
              nodes: [{ id: "label-ops", name: "Ops", team: null }],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        }),
      )
      .mockResolvedValueOnce(issueCreateResponse("FOR-13"));
    const adapter = createLinearAdapter(
      linearConfig(fetchImpl, () => undefined),
    );

    await expect(adapter.sync([finding()])).resolves.toMatchObject({
      created: 1,
      updated: 0,
    });
    expect(bodyAt(fetchImpl, 0).query).not.toContain("issueLabels(filter:");
    expect(bodyAt(fetchImpl, 1).variables).toEqual({
      after: "label-cursor-1",
    });
    expect(bodyAt(fetchImpl, 2).query).toContain("issueCreate");
  });

  it("provisions every missing allowed label before creating any issues", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            issueLabels: {
              nodes: [
                {
                  id: "wrong-team",
                  name: "Data Quality",
                  team: { id: "other-team" },
                },
                { id: "bad-label", name: "Security", team: { id: "team-1" } },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            issueLabelCreate: {
              issueLabel: { id: "label-dq", name: "Data Quality" },
              success: true,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            issueLabelCreate: {
              issueLabel: { id: "label-ops", name: "Ops" },
              success: true,
            },
          },
        }),
      )
      .mockResolvedValueOnce(issueCreateResponse("FOR-50"));
    const adapter = createLinearAdapter(
      linearConfig(fetchImpl, () => undefined),
    );

    await expect(
      adapter.sync([
        finding({ fingerprint: "link:broken:one", source: "link" }),
        finding({ fingerprint: "sentry:issue:one", source: "sentry" }),
      ]),
    ).resolves.toMatchObject({ created: 1, updated: 0 });

    expect(bodyAt(fetchImpl, 1)).toMatchObject({
      variables: { input: { name: "Data Quality", teamId: "team-1" } },
    });
    expect(bodyAt(fetchImpl, 2)).toMatchObject({
      variables: { input: { name: "Ops", teamId: "team-1" } },
    });
    expect(bodyAt(fetchImpl, 3).query).toContain("issueCreate");
    const groupedInput = (
      bodyAt(fetchImpl, 3).variables as { input: { labelIds: string[] } }
    ).input;
    expect(groupedInput.labelIds).toEqual(["label-dq", "label-ops"]);
  });
});

describe("Sentry resolver", () => {
  it("requires an explicit write token and never falls back to the read token", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = createSentryResolver({
      audit: () => undefined,
      baseUrl: "https://sentry.test",
      fetchImpl,
      now: () => 100,
      organizationSlug: "formoria",
      projectSlug: "web",
      readToken: "read-only-token",
    });

    await expect(adapter.resolve(["issue-1"])).rejects.toThrow(
      "Sentry write token is required",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolves only explicit IDs with the separate write token", async () => {
    const { audit, records } = auditLog();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ id: "issue-1", status: "resolved" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "issue-2", status: "resolved" }),
      );
    const adapter = createSentryResolver({
      audit,
      baseUrl: "https://sentry.test",
      fetchImpl,
      now: () => 100,
      organizationSlug: "formoria",
      projectSlug: "web",
      readToken: "read-only-token",
      writeToken: "resolve-only-token",
    });

    await expect(adapter.resolve(["issue-1", "issue-2"])).resolves.toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://sentry.test/api/0/issues/issue-1/",
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ status: "resolved" }),
      headers: {
        Authorization: "Bearer resolve-only-token",
        "Content-Type": "application/json",
      },
      method: "PUT",
    });
    expect(JSON.stringify(records)).not.toContain("resolve-only-token");
    expect(JSON.stringify(records)).not.toContain("read-only-token");
    expect(JSON.stringify(records)).not.toContain("issue-1");
  });

  it("throws on a non-2xx resolution response", async () => {
    const { audit, records } = auditLog();
    const adapter = createSentryResolver({
      audit,
      baseUrl: "https://sentry.test",
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("no", { status: 403 })),
      now: () => 100,
      organizationSlug: "formoria",
      projectSlug: "web",
      writeToken: "resolve-only-token",
    });

    await expect(adapter.resolve(["issue-1"])).rejects.toThrow(
      "Sentry request failed",
    );
    expect(records.at(-1)).toMatchObject({
      adapter: "sentry",
      status: "failure",
      schemaValid: false,
    });
  });
});

describe("GitHub branch deletion adapter", () => {
  function safeResponses(fetchImpl: ReturnType<typeof vi.fn>) {
    fetchImpl
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ protected: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          ref: "refs/heads/feature/old",
          object: { sha: "tip-sha" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({
          base_commit: { sha: "tip-sha" },
          merge_base_commit: { sha: "tip-sha" },
          status: "ahead",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ref: "refs/heads/feature/old",
          object: { sha: "tip-sha" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
  }

  function githubAdapter(
    fetchImpl: typeof fetch,
    audit: (record: AuditRecord) => void,
  ) {
    return createGitHubAdapter({
      accessToken: "github-app-secret",
      audit,
      baseUrl: "https://api.github.test",
      fetchImpl,
      now: () => 100,
      owner: "formoria-org",
      repo: "formoria",
    });
  }

  it("deletes only after checking protection, open PRs, ancestry, and an unchanged exact tip", async () => {
    const { audit, records } = auditLog();
    const fetchImpl = vi.fn<typeof fetch>();
    safeResponses(fetchImpl);
    const adapter = githubAdapter(fetchImpl, audit);

    const result = await adapter.deleteBranch("feature/old", "tip-sha");

    expect(result).toMatchObject({ outcome: "deleted", tipSha: "tip-sha" });
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(
      fetchImpl.mock.calls.map((call) => call[1]?.method ?? "GET"),
    ).toEqual(["GET", "GET", "GET", "GET", "GET", "GET", "DELETE"]);
    expect(String(fetchImpl.mock.calls[5]?.[0])).toContain(
      "/git/ref/heads/feature%2Fold",
    );
    expect(String(fetchImpl.mock.calls[6]?.[0])).toContain(
      "/git/refs/heads/feature%2Fold",
    );
    expect(JSON.stringify(records)).not.toContain("github-app-secret");
  });

  it("skips deletion when no previously recorded tip SHA is supplied", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = githubAdapter(fetchImpl, () => undefined);

    await expect(adapter.deleteBranch("feature/old")).resolves.toMatchObject({
      evidence: { expectedTipRecorded: false },
      outcome: "skipped",
      reason: "missing recorded tip",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [
      "default",
      { repo: { default_branch: "main" }, branch: { protected: false } },
      "default branch",
    ],
    [
      "protected",
      { repo: { default_branch: "main" }, branch: { protected: true } },
      "protected",
    ],
  ])("safely skips a %s branch", async (_name, values, reason) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(values.repo))
      .mockResolvedValueOnce(jsonResponse(values.branch))
      .mockResolvedValueOnce(
        jsonResponse({
          ref: `refs/heads/${_name === "default" ? "main" : "feature/old"}`,
          object: { sha: "tip-sha" },
        }),
      );
    const adapter = githubAdapter(fetchImpl, () => undefined);

    const result = await adapter.deleteBranch(
      _name === "default" ? "main" : "feature/old",
      "tip-sha",
    );

    expect(result.outcome).toBe("skipped");
    expect(result.reason).toContain(reason);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("skips open PRs, non-ancestors, and a tip race without deleting", async () => {
    const openPrFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ protected: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          ref: "refs/heads/feature/old",
          object: { sha: "tip-sha" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse([{ number: 7 }]));
    const openPrResult = await githubAdapter(
      openPrFetch,
      () => undefined,
    ).deleteBranch("feature/old", "tip-sha");
    expect(openPrResult).toMatchObject({
      outcome: "skipped",
      reason: "open pull request",
    });
    expect(openPrFetch).toHaveBeenCalledTimes(4);

    const nonAncestorFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ protected: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          ref: "refs/heads/feature/old",
          object: { sha: "tip-sha" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ status: "diverged" }));
    const nonAncestorResult = await githubAdapter(
      nonAncestorFetch,
      () => undefined,
    ).deleteBranch("feature/old", "tip-sha");
    expect(nonAncestorResult).toMatchObject({
      outcome: "skipped",
      reason: "not an ancestor",
    });
    expect(nonAncestorFetch).toHaveBeenCalledTimes(5);

    const raceFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ protected: false }))
      .mockResolvedValueOnce(
        jsonResponse({
          ref: "refs/heads/feature/old",
          object: { sha: "tip-sha" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(
        jsonResponse({ status: "ahead", base_commit: { sha: "tip-sha" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ref: "refs/heads/feature/old",
          object: { sha: "new-tip" },
        }),
      );
    const raceResult = await githubAdapter(
      raceFetch,
      () => undefined,
    ).deleteBranch("feature/old", "tip-sha");
    expect(raceResult).toMatchObject({
      outcome: "skipped",
      reason: "tip race",
      tipSha: "tip-sha",
    });
    expect(raceFetch).toHaveBeenCalledTimes(6);
  });
});

describe("Agent Hub adapter", () => {
  it("delegates through the injected runner and audits only a normalized outcome", async () => {
    const { audit, records } = auditLog();
    const runner = vi
      .fn()
      .mockResolvedValue({ duplicate: false, run_id: "run-123" });
    const adapter = createAgentHubAdapter({ audit, now: () => 100, runner });
    const envelope = {
      data: { userEmail: "private@example.com" },
      routine: "directory-health",
    };

    await expect(adapter.report(envelope)).resolves.toEqual({
      duplicate: false,
      run_id: "run-123",
    });
    expect(runner).toHaveBeenCalledWith(envelope);
    expect(records.at(-1)).toMatchObject({
      adapter: "agent-hub",
      operation: "delegate",
      response: { duplicate: false, reported: true, runIdPresent: true },
      schemaValid: true,
      status: "success",
    });
    expect(JSON.stringify(records)).not.toContain("run-123");
    expect(JSON.stringify(records)).not.toContain("private@example.com");
  });

  it("surfaces runner failures so another delivery path can run independently", async () => {
    const { audit, records } = auditLog();
    const failure = new Error("Agent Hub unavailable");
    const runner = vi.fn().mockRejectedValue(failure);
    const adapter = createAgentHubAdapter({ audit, now: () => 100, runner });

    await expect(adapter.report({ routine: "sentry-triage" })).rejects.toBe(
      failure,
    );
    expect(records.at(-1)).toMatchObject({
      adapter: "agent-hub",
      response: { error: "runner_failed" },
      schemaValid: false,
      status: "failure",
    });
  });
});
