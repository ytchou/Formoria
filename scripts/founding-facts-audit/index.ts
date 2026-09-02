/**
 * @formoria-script
 * purpose: Audits brand founding_year facts against stored evidence and applies the accepted corrections.
 * class: operator
 * invoke: pnpm founding-facts:audit
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 */
import { applyAudit } from "./apply";
import { runAudit } from "./audit";
import { renderAudit } from "./render";
import { loadScriptTarget } from "../shared/target";

// Both helpers read the argv `loadScriptTarget` returns, which has `--target
// <x>` already removed. Reading `process.argv` here instead would let
// `--artifact --target production` resolve `--artifact` to the literal
// `"--target"`.
function argValue(argv: readonly string[], flag: string): string | undefined {
  const inline = argv.find((argument) => argument.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv.at(index + 1) : undefined;
}

function requiredArg(argv: readonly string[], flag: string): string {
  const value = argValue(argv, flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

async function main(): Promise<void> {
  const { argv } = loadScriptTarget();
  const command = argv.at(0);
  if (command === "audit") {
    if (argv.includes("--all") && argv.includes("--pilot"))
      throw new Error("choose only one of --pilot or --all");
    const mode = argv.includes("--all") ? "all" : "pilot";
    const concurrency = Number(argValue(argv, "--concurrency") ?? "3");
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5)
      throw new Error("--concurrency must be an integer from 1 to 5");
    console.log(await runAudit({ mode, concurrency }));
    return;
  }
  if (command === "render") {
    console.log(await renderAudit(requiredArg(argv, "--artifact")));
    return;
  }
  if (command === "apply") {
    console.log(
      await applyAudit({
        artifactFile: requiredArg(argv, "--artifact"),
        autoHigh: argv.includes("--auto-high"),
        decisionsFile: argValue(argv, "--decisions"),
        confirm: argv.includes("--confirm"),
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
