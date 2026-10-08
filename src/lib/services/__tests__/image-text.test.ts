import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { readImageSignals, type ImageTextChatClient } from "../image-text";
import type { OpenAIChatResult } from "../openai-client";

/**
 * The image text reader (DEV-1962), which also reads the ad-creative signals
 * (DEV-1989). The chat client is injected as an argument
 * — `scripts/check-test-boundaries.mjs` forbids vi.mock of `@/lib/services/` —
 * so no call ever reaches OpenAI.
 */

async function image(): Promise<Buffer> {
  return sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .png()
    .toBuffer();
}

function chatResult(overrides: Partial<OpenAIChatResult>): OpenAIChatResult {
  return {
    response: new Response(null),
    data: null,
    content: null,
    ok: true,
    status: 200,
    errorBody: null,
    finishReason: "stop",
    refusal: null,
    toolCalls: null,
    ...overrides,
  };
}

function fakeClient(result: OpenAIChatResult): {
  client: ImageTextChatClient;
  calls: Parameters<ImageTextChatClient["chat"]>[0][];
} {
  const calls: Parameters<ImageTextChatClient["chat"]>[0][] = [];
  return {
    calls,
    client: {
      async chat(input) {
        calls.push(input);
        return result;
      },
    },
  };
}

describe("readImageSignals", () => {
  it("returns the text and ad-creative signals from one low-detail vision call", async () => {
    const signals = {
      text: "$589\n原價$676",
      textCoverage: 0.22,
      endorsementPerson: true,
    };
    const { client, calls } = fakeClient(
      chatResult({ content: JSON.stringify(signals) }),
    );

    const result = await readImageSignals(await image(), { client });

    expect(result).toEqual(signals);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.imageDetail).toBe("low");
    expect(calls[0]?.images).toHaveLength(1);
    expect(String(calls[0]?.images?.[0])).toMatch(/^data:image\/webp;base64,/);
    expect(calls[0]?.schema?.name).toBe("image_text");
    // Strict outputs drop optional fields, so all three must be required.
    expect(calls[0]?.schema?.schema).toMatchObject({
      required: ["text", "textCoverage", "endorsementPerson"],
    });
  });

  it("clamps a coverage estimate outside 0..1", async () => {
    const { client } = fakeClient(
      chatResult({
        content: JSON.stringify({
          text: "",
          textCoverage: 1.3,
          endorsementPerson: false,
        }),
      }),
    );

    await expect(readImageSignals(await image(), { client })).resolves.toEqual(
      { text: "", textCoverage: 1, endorsementPerson: false },
    );
  });

  it("accepts a processed image as well as raw bytes", async () => {
    const empty = { text: "", textCoverage: 0, endorsementPerson: false };
    const { client } = fakeClient(
      chatResult({ content: JSON.stringify(empty) }),
    );

    await expect(
      readImageSignals({ buffer: await image() }, { client }),
    ).resolves.toEqual(empty);
  });

  it("throws when the request fails", async () => {
    const { client } = fakeClient(chatResult({ ok: false, status: 500 }));

    await expect(readImageSignals(await image(), { client })).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("throws when the answer is truncated", async () => {
    const { client } = fakeClient(
      chatResult({ content: '{"text":"$5', finishReason: "length" }),
    );

    await expect(readImageSignals(await image(), { client })).rejects.toThrow(
      /truncated/,
    );
  });

  it("throws when the answer does not match the schema", async () => {
    const { client } = fakeClient(chatResult({ content: '{"words":"x"}' }));

    await expect(readImageSignals(await image(), { client })).rejects.toThrow(
      /schema|JSON/i,
    );
  });

  it("throws when an ad-creative field is missing", async () => {
    const { client } = fakeClient(
      chatResult({ content: JSON.stringify({ text: "x" }) }),
    );

    await expect(readImageSignals(await image(), { client })).rejects.toThrow(
      /schema|JSON/i,
    );
  });
});
