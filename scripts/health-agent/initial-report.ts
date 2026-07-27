import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { sendSlackDigest } from "./adapters";
import type { AuditRecord, HealthFinding } from "./contracts";
import { validateCollectorArtifact } from "./orchestrator";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function findings(aggregate: unknown): HealthFinding[] {
  if (!isRecord(aggregate) || !isRecord(aggregate.artifacts)) return [];
  const seen = new Set<string>();
  return Object.values(aggregate.artifacts).flatMap((value) => {
    try {
      return validateCollectorArtifact(value).findings.filter((finding) => {
        if (seen.has(finding.fingerprint)) return false;
        seen.add(finding.fingerprint);
        return true;
      });
    } catch {
      return [];
    }
  });
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function ticket(
  aggregate: unknown,
): { identifier: string; url: string } | null {
  if (!isRecord(aggregate) || !Array.isArray(aggregate.linearOutcomes))
    return null;
  const outcome = aggregate.linearOutcomes.find(
    (value) => isRecord(value) && typeof value.identifier === "string",
  );
  if (!isRecord(outcome) || typeof outcome.identifier !== "string") return null;
  return {
    identifier: outcome.identifier,
    url: `https://linear.app/ytchou/issue/${outcome.identifier}`,
  };
}

async function main(): Promise<void> {
  const aggregate = await json(argument("--aggregate"));
  const queue = await json(argument("--queue"));
  const snapshot = await json(argument("--snapshot"));
  const output = argument("--output");
  const auditPath = argument("--audit");
  const workflowUrl = argument("--workflow-url");
  const allFindings = findings(aggregate);
  if (allFindings.length === 0) {
    await writeFile(output, `${JSON.stringify({ sent: false })}\n`, "utf8");
    await writeFile(auditPath, "", "utf8");
    return;
  }
  const artifacts =
    isRecord(aggregate) && isRecord(aggregate.artifacts)
      ? aggregate.artifacts
      : {};
  const findingCount = (routine: string): number => {
    try {
      return validateCollectorArtifact(artifacts[routine]).findings.length;
    } catch {
      return 0;
    }
  };
  const lifecycle =
    isRecord(queue) && isRecord(queue.lifecycle) ? queue.lifecycle : {};
  const repairable =
    isRecord(snapshot) && Array.isArray(snapshot.findings)
      ? snapshot.findings.length
      : 0;
  const escalation = Math.max(0, allFindings.length - repairable);
  const linear = ticket(aggregate);
  const selfHeal = process.env.HEALTH_SELF_HEAL === "true" && repairable > 0;
  const audit: AuditRecord[] = [];
  await sendSlackDigest(
    {
      notification: {
        agent: "Health Agent findings",
        details: [
          `• Product ${findingCount("link-checker") + findingCount("directory-health")} · Runtime ${findingCount("sentry-triage")} · Repository ${findingCount("quality-health")}`,
          `• ${repairable} repairable · ${escalation} escalation-only`,
          `• Linear: ${linear ? `<${linear.url}|${linear.identifier}>` : "unavailable"}`,
          `• Self-heal: ${selfHeal ? "will run" : "will not run"}`,
        ],
        managerAction: linear
          ? `<${linear.url}|Review ${linear.identifier}> after the final report`
          : "Wait for the final report",
        status: "needs_attention",
        summary: [
          `• ${allFindings.length} distinct findings`,
          `• ${count(lifecycle.new)} new · ${count(lifecycle.ongoing)} ongoing · ${count(lifecycle.regressed)} regressed`,
        ],
        workflowUrl,
      },
    },
    {
      audit: (record) => audit.push(record),
      webhookUrl: process.env.SLACK_HEALTH_WEBHOOK_URL,
    },
  );
  await writeFile(
    output,
    `${JSON.stringify({ linear, repairable, sent: true, selfHeal })}\n`,
    "utf8",
  );
  await writeFile(
    auditPath,
    audit.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "initial_report_failed",
    );
    process.exitCode = 1;
  });
}
