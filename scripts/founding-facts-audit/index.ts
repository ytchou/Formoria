import { applyAudit } from "./apply";
import { runAudit } from "./audit";
import { renderAudit } from "./render";

function argValue(flag: string): string | undefined {
  const inline = process.argv.find((argument) =>
    argument.startsWith(`${flag}=`),
  );
  if (inline) return inline.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv.at(index + 1) : undefined;
}

function requiredArg(flag: string): string {
  const value = argValue(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

async function main(): Promise<void> {
  const command = process.argv.at(2);
  if (command === "audit") {
    if (process.argv.includes("--all") && process.argv.includes("--pilot"))
      throw new Error("choose only one of --pilot or --all");
    const mode = process.argv.includes("--all") ? "all" : "pilot";
    const concurrency = Number(argValue("--concurrency") ?? "3");
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5)
      throw new Error("--concurrency must be an integer from 1 to 5");
    console.log(await runAudit({ mode, concurrency }));
    return;
  }
  if (command === "render") {
    console.log(await renderAudit(requiredArg("--artifact")));
    return;
  }
  if (command === "apply") {
    console.log(
      await applyAudit({
        artifactFile: requiredArg("--artifact"),
        autoHigh: process.argv.includes("--auto-high"),
        decisionsFile: argValue("--decisions"),
        confirm: process.argv.includes("--confirm"),
      }),
    );
    return;
  }
  throw new Error(
    "usage: founding-facts:audit <audit --pilot|--all | render --artifact FILE | apply --artifact FILE (--auto-high|--decisions FILE) [--confirm]>",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
