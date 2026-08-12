import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  classifyInfrastructure,
  evaluateSelfMerge,
  freezeFailures,
  nextIncidentState,
  renderIncidentPrBody,
  terminalOutcome,
  validateDiagnosis,
  validateRepair,
  type DiagnosisResult,
  type FrozenFailureSet,
  type IncidentCounters,
  type IncidentPrBodyInput,
  type RepairResult,
  type SelfMergeEvidence,
  type SourceFailure,
} from "./incident";

async function jsonFile<T>(path: string | undefined): Promise<T> {
  if (!path) throw new Error("A JSON file path is required");
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function output(value: unknown): void {
  process.stdout.write(
    `${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`,
  );
}

export async function runIncidentCli(args: string[]): Promise<void> {
  const [command, ...paths] = args;
  switch (command) {
    case "freeze": {
      const value = await jsonFile<
        SourceFailure[] | { failures: SourceFailure[] }
      >(paths[0]);
      output(freezeFailures(Array.isArray(value) ? value : value.failures));
      return;
    }
    case "validate-diagnosis":
      output(
        validateDiagnosis(
          await jsonFile<FrozenFailureSet>(paths[0]),
          await jsonFile<DiagnosisResult>(paths[1]),
        ),
      );
      return;
    case "validate-repair":
      output(
        validateRepair(
          await jsonFile<DiagnosisResult>(paths[0]),
          await jsonFile<RepairResult>(paths[1]),
          await jsonFile<string[]>(paths[2]),
        ),
      );
      return;
    case "classify-infrastructure":
      output(
        classifyInfrastructure(
          await jsonFile<Parameters<typeof classifyInfrastructure>[0]>(
            paths[0],
          ),
        ),
      );
      return;
    case "transition":
      output(
        nextIncidentState(
          await jsonFile<IncidentCounters>(paths[1]),
          paths[0] as Parameters<typeof nextIncidentState>[1],
        ),
      );
      return;
    case "eligibility":
      output(evaluateSelfMerge(await jsonFile<SelfMergeEvidence>(paths[0])));
      return;
    case "render-pr":
      output(
        renderIncidentPrBody(await jsonFile<IncidentPrBodyInput>(paths[0])),
      );
      return;
    case "outcome":
      output(
        terminalOutcome(
          await jsonFile<Parameters<typeof terminalOutcome>[0]>(paths[0]),
        ),
      );
      return;
    default:
      throw new Error(
        `Unsupported incident command: ${command ?? "(missing)"}`,
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runIncidentCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
