import { createHash } from "node:crypto";

export interface SourceFailure {
  file: string | null;
  title: string;
  project: string;
  /** Human diagnosis context; never part of the exact Playwright selector. */
  reason?: string;
}

interface FrozenFailure extends SourceFailure {
  id: string;
}

export interface FrozenFailureSet {
  version: 1;
  failureSetHash: string;
  failures: FrozenFailure[];
}

function canonicalFailure(failure: SourceFailure): SourceFailure {
  const title = failure.title.trim();
  const project = failure.project.trim();
  const file = failure.file?.trim() || null;
  if (!title || !project)
    throw new Error("Failure title and project are required");
  return { file, title, project };
}

function failureId(failure: SourceFailure): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalFailure(failure)))
    .digest("hex")
    .slice(0, 20);
}

export function freezeFailures(
  failures: readonly SourceFailure[],
): FrozenFailureSet {
  if (failures.length === 0)
    throw new Error("Cannot freeze an empty failure set");
  const frozen = failures
    .map((input) => {
      const failure = canonicalFailure(input);
      return {
        ...failure,
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
        id: failureId(failure),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(frozen.map(({ id }) => id)).size !== frozen.length) {
    throw new Error("Frozen failure set contains duplicate failures");
  }
  const identity = frozen.map(({ file, title, project, id }) => ({
    file,
    title,
    project,
    id,
  }));
  const failureSetHash = createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
  return { version: 1, failureSetHash, failures: frozen };
}
