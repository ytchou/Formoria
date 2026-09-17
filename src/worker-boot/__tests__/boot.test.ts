import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSupabaseUserAgent } from "@/lib/supabase/service";
import { captureAlert } from "@/lib/adapters/alerting/sentry";
import { postSlackAlert } from "@/lib/adapters/alerting/slack";
import {
  setAuditWriteSeam,
  resetAuditEmitterForTests,
} from "@/lib/audit";
import { reportWorkerFailure } from "@/lib/services/job-alerts";
import { bootWorker } from "../index";

vi.mock("@/lib/adapters/alerting/sentry", () => ({
  captureAlert: vi.fn(() => true),
}));
vi.mock("@/lib/adapters/alerting/slack", () => ({
  postSlackAlert: vi.fn(async () => true),
}));

describe("bootWorker", () => {
  it("asserts the database target before importing services", async () => {
    const order: string[] = [];
    const assertTarget = () => {
      order.push("assert");
    };
    const loadServices = async () => {
      order.push("load");
    };

    await bootWorker({
      agent: "test",
      assertTarget,
      loadServices,
    });

    expect(order).toEqual(["assert", "load"]);
  });

  it("crash handlers report under the given agent name", async () => {
    const reported: Array<{ context: string; agent?: string }> = [];
    const reporter = async (
      context: string,
      _error: unknown,
      options?: { agent?: string },
    ) => {
      reported.push({ context, agent: options?.agent });
    };

    // Capture the handlers that bootWorker installs
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const onSpy = vi
      .spyOn(process, "on")
      .mockImplementation(
        (event: string | symbol, handler: (...args: unknown[]) => void) => {
          handlers[String(event)] = handler;
          return process;
        },
      );

    await bootWorker({
      agent: "health-agent",
      assertTarget: () => {},
      loadServices: async () => {},
      reportFailure: reporter,
      sanitizeError: (e: unknown) => String(e),
    });

    // Trigger unhandledRejection
    handlers["unhandledRejection"]?.(new Error("boom"));

    expect(reported).toHaveLength(1);
    expect(reported[0].context).toBe("unhandledRejection");
    expect(reported[0].agent).toBe("health-agent");

    onSpy.mockRestore();
  });
});

describe("reportWorkerFailure agent parameter", () => {
  beforeEach(() => {
    setAuditWriteSeam(async () => null);
    vi.mocked(captureAlert).mockReturnValue(true);
    vi.mocked(postSlackAlert).mockResolvedValue(true);
  });

  afterEach(() => {
    resetAuditEmitterForTests();
    vi.clearAllMocks();
  });

  it("uses the agent it is given", async () => {
    await reportWorkerFailure("unhandledRejection", new Error("boom"), {
      agent: "health-agent",
      provider: "health-agent",
    });

    const notification = vi.mocked(postSlackAlert).mock.calls[0]?.[0];
    expect(notification?.agent).toBe("Health Agent");
    expect(notification?.managerAction).toContain("health-agent");

    const sentryCall = vi.mocked(captureAlert).mock.calls[0];
    expect(sentryCall?.[0]).toContain("Health-agent");
  });

  it("defaults to curation wording when no agent is given", async () => {
    await reportWorkerFailure("cron", new Error("oops"));

    const notification = vi.mocked(postSlackAlert).mock.calls[0]?.[0];
    expect(notification?.agent).toBe("Curation");
    expect(notification?.managerAction).toContain("curation worker");
  });
});

describe("service client traffic labels", () => {
  it("labels health-agent and repo-worker entry points as worker traffic", () => {
    expect(
      buildSupabaseUserAgent({
        nodeEnv: "production",
        argv: ["node", "/app/src/health-agent/server.ts"],
      }),
    ).toBe("FormoriaSupabase/1.0 (worker)");

    expect(
      buildSupabaseUserAgent({
        nodeEnv: "production",
        argv: ["node", "/app/src/repo-worker/server.ts"],
      }),
    ).toBe("FormoriaSupabase/1.0 (worker)");

    // Curation worker still labeled correctly
    expect(
      buildSupabaseUserAgent({
        nodeEnv: "production",
        argv: ["node", "/app/src/curation-worker/server.ts"],
      }),
    ).toBe("FormoriaSupabase/1.0 (worker)");
  });
});

describe("worker-boot module purity", () => {
  it("imports in plain Node without server-only or scripts/", async () => {
    const result = await new Promise<{
      code: string | number | null;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `import("./src/worker-boot/index.ts").then(() => console.log("worker-boot loaded"))`,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "worker-test-key",
          },
        },
        (error, stdout, stderr) =>
          resolve({
            code: error?.code ?? 0,
            stdout,
            stderr,
          }),
      );
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("worker-boot loaded");
  });
});
