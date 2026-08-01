import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const EVAL_ROOT = resolve(process.cwd(), "scripts/image-eval");
export const CORPUS_ROOT = join(EVAL_ROOT, "corpus");
export const RUN_ROOT = join(EVAL_ROOT, "runs");
export const ROSTER_PATH = join(CORPUS_ROOT, "roster.json");
export const MANIFEST_PATH = join(CORPUS_ROOT, "manifest.json");
export const LABELS_PATH = join(CORPUS_ROOT, "labels.json");
export const BASELINE_PATH = join(CORPUS_ROOT, "baseline.json");

export async function ensureEvalDirectories(): Promise<void> {
  await mkdir(CORPUS_ROOT, { recursive: true });
  await mkdir(RUN_ROOT, { recursive: true });
}

export function runPath(runId: string, fileName: string): string {
  return join(RUN_ROOT, runId, fileName);
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}
