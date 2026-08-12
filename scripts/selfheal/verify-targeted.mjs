import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const stateFile =
  process.env.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE || "playwright-last-run.json";
const attemptsFile =
  process.env.SELFHEAL_ATTEMPTS_FILE || "/tmp/formoria-targeted-attempts";
const targetedEnv = { SELFHEAL_TARGETED: "true" };
const attempts = Number.parseInt(readFileSafe(attemptsFile) || "0", 10);
if (!Number.isInteger(attempts) || attempts >= 8)
  fail("Targeted verification limit reached (8)");

let state;
try {
  state = JSON.parse(readFileSync(stateFile, "utf8"));
} catch {
  const legacySpecs = readFileSafe("legacy-failed-specs.txt")
    .split("\n")
    .filter(Boolean);
  if (!legacySpecs.length)
    fail(`Missing or invalid failed-test state: ${stateFile}`);
  writeFileSync(attemptsFile, `${attempts + 1}\n`);
  run(
    [
      "exec",
      "playwright",
      "test",
      ...legacySpecs,
      "--project=deep",
      "--project=mobile",
      "--last-failed",
      "--last-failed-file",
      stateFile,
      "--reporter=html,json",
    ],
    {
      ...targetedEnv,
      PLAYWRIGHT_JSON_OUTPUT_NAME: "playwright-results-targeted.json",
    },
  );
  process.exit(0);
}
if (!Array.isArray(state.failedTests))
  fail(`Invalid failed-test state: ${stateFile}`);
if (state.failedTests.length === 0) process.exit(0);

const collectionFile = "/tmp/formoria-playwright-collection.json";
run(
  [
    "exec",
    "playwright",
    "test",
    "--project=deep",
    "--project=mobile",
    "--list",
    "--reporter=json",
  ],
  {
    ...targetedEnv,
    PLAYWRIGHT_JSON_OUTPUT_NAME: collectionFile,
  },
);
const collection = JSON.parse(readFileSync(collectionFile, "utf8"));
const collected = new Set(findIds(collection));
const missing = state.failedTests.filter((id) => !collected.has(id));
if (missing.length)
  fail(
    `Stored Playwright test IDs are no longer collectible: ${missing.join(", ")}`,
  );

writeFileSync(attemptsFile, `${attempts + 1}\n`);
run(
  [
    "exec",
    "playwright",
    "test",
    "--project=deep",
    "--project=mobile",
    "--last-failed",
    "--last-failed-file",
    stateFile,
    "--reporter=html,json",
  ],
  {
    ...targetedEnv,
    PLAYWRIGHT_JSON_OUTPUT_NAME: "playwright-results-targeted.json",
  },
);

function readFileSafe(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}
function findIds(value) {
  if (Array.isArray(value)) return value.flatMap(findIds);
  if (!value || typeof value !== "object") return [];
  return [
    ...(typeof value.id === "string" && value.id.includes("-")
      ? [value.id]
      : []),
    ...Object.values(value).flatMap(findIds),
  ];
}
function run(args, extraEnv = {}) {
  const result = spawnSync("pnpm", args, {
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
