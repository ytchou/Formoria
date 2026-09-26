import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeEvalSinkRecord } from "../llm-usage-sink";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "llm-usage-sink-"));
  path = join(dir, "sink.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readRecord(): Record<string, unknown> {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

const base = {
  target: { type: "brand", id: "b1" },
  phase: "detect",
  model: "gpt-4o",
  latencyMs: 12.4,
};

describe("writeEvalSinkRecord", () => {
  it("writes_finish_reason_and_response_format", () => {
    writeEvalSinkRecord({
      ...base,
      path,
      rawResponse: {
        ok: true,
        status: 200,
        response: { choices: [{ finish_reason: "length" }] },
      },
      input: { meta: { responseFormat: "json_object" } },
    });

    const record = readRecord();
    expect(record.finishReason).toBe("length");
    expect(record.responseFormat).toBe("json_object");
  });

  it("nulls_when_absent", () => {
    writeEvalSinkRecord({
      ...base,
      path,
      rawResponse: { ok: false, status: 500, error: "boom" },
    });

    const record = readRecord();
    expect(record.finishReason).toBeNull();
    expect(record.responseFormat).toBeNull();
  });
});
