import { readFile, writeFile } from "node:fs/promises";

import { sentryClassificationBatchJsonSchema } from "./sentry";

async function main() {
  const [issuesPath, outputPath] = process.argv.slice(2);
  if (!issuesPath || !outputPath)
    throw new Error("usage: issues-path output-path");

  const input = JSON.parse(await readFile(issuesPath, "utf8")) as {
    issues?: unknown[];
  };
  if (!Array.isArray(input.issues)) throw new Error("invalid_sentry_issues");

  const json = JSON.stringify(
    sentryClassificationBatchJsonSchema(input.issues.length),
  );
  await writeFile(outputPath, `${json}\n`);
  process.stdout.write(json);
}

void main();
