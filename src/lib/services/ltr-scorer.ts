import { readFileSync } from "node:fs";
import { join } from "node:path";
import { featureSpecHash, FEATURE_NAMES } from "./ltr-features";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LtrMeta = {
  feature_spec_hash: string;
  input_name: string;
  feature_names: string[];
  [key: string]: unknown;
};

type CachedSession = {
  session: import("onnxruntime-node").InferenceSession;
  meta: LtrMeta;
};

// ---------------------------------------------------------------------------
// Session cache
// ---------------------------------------------------------------------------

const sessions = new Map<string, CachedSession>();

/** Reset the session cache — test-only. */
export function _testResetCache(): void {
  sessions.clear();
}

// ---------------------------------------------------------------------------
// loadLtrModel
// ---------------------------------------------------------------------------

export async function loadLtrModel(
  version = "v1",
  opts?: { modelDir?: string },
): Promise<CachedSession> {
  const cached = sessions.get(version);
  if (cached) return cached;

  const modelDir = opts?.modelDir ?? join(process.cwd(), "models", "ltr");
  const metaPath = join(modelDir, `${version}.meta.json`);
  const modelPath = join(modelDir, `${version}.onnx`);

  const meta: LtrMeta = JSON.parse(readFileSync(metaPath, "utf8"));

  if (meta.feature_spec_hash !== featureSpecHash) {
    throw new Error(
      `Feature spec hash mismatch: model=${meta.feature_spec_hash}, code=${featureSpecHash}`,
    );
  }

  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
  });

  const entry: CachedSession = { session, meta };
  sessions.set(version, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// scoreCandidates
// ---------------------------------------------------------------------------

export async function scoreCandidates(
  rows: Float32Array[],
  version = "v1",
): Promise<number[]> {
  if (rows.length === 0) return [];

  const { session, meta } = await loadLtrModel(version);
  const n = rows.length;
  const dim = FEATURE_NAMES.length;
  const flat = new Float32Array(n * dim);
  for (let i = 0; i < n; i++) {
    flat.set(rows[i]!, i * dim);
  }

  const ort = await import("onnxruntime-node");
  const tensor = new ort.Tensor("float32", flat, [n, dim]);
  const feeds: Record<string, import("onnxruntime-node").Tensor> = {
    [meta.input_name]: tensor,
  };
  const results = await session.run(feeds);
  const output = Object.values(results)[0] as { data: Float32Array };
  return Array.from(output.data);
}
