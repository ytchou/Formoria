import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { AgentHubReportError } from "./envelope.mjs";
import { createTursoAgentHubWriter } from "./turso.mjs";

export { AgentHubReportError };
export { normalizeAgentRunEnvelope as normalizeRoutineEnvelope } from "./envelope.mjs";

export async function reportAgentRun(input, { writer, ...writerOptions } = {}) {
  const report = writer ?? createTursoAgentHubWriter(writerOptions);
  return report(input);
}

function fileArgument(argv) {
  const index = argv.indexOf("--file");
  return index >= 0 ? argv[index + 1] : null;
}

export async function main(argv = process.argv.slice(2)) {
  const file = fileArgument(argv);
  if (!file)
    throw new AgentHubReportError(
      "Usage: node scripts/agent-hub/report-run.mjs --file <envelope.json>",
    );
  const envelope = JSON.parse(await readFile(file, "utf8"));
  const result = await reportAgentRun(envelope);
  console.log(
    JSON.stringify({ event: "agent_hub_delivery_complete", ...result }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ error: message, event: "agent_hub_delivery_failed" }),
    );
    process.exitCode = 1;
  });
}
