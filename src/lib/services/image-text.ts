import { z } from "zod";

import { auditedCall } from "@/lib/audit";
import { fetchLangfusePromptWithMeta } from "@/lib/langfuse/prompt";
import { parseAndValidate, toStrictJsonSchema } from "./_shared/zod-schema";
import { createProfiledOpenAIClient, profileChatParams } from "./llm-audit";
import { visionDataUri } from "./vision-image";

/**
 * Reads every piece of visible text off one image (DEV-1962).
 *
 * The commerce-truth gate needs the WORDS on a curated-product photo — a promo
 * banner reading a price is what it rejects — and the repo has no OCR. The
 * classify-images contract returns keep/reject reasons, not transcribed text,
 * and product images taken from listing thumbnails never pass through it. One
 * vision call that transcribes verbatim is the cheapest reliable check that
 * exists today, and it reuses the classifier's plumbing: the same base64 data
 * URI (no OpenAI fetcher in the path, see `vision-image.ts`), the same
 * profiled, audited client.
 *
 * CEILING: one low-detail vision call per ingested image. At `detail: low`
 * OpenAI sees a single 512px tile, so small or heavily stylised text can be
 * missed — the gate then lets that image through. Cost is ~1 call per image,
 * paid again whenever a refresh re-mirrors a row the gate rejected.
 *
 * UPGRADE PATH: fold text transcription into the classify-images contract, so
 * product-page images are read once at classification and the text persisted
 * with the verdict, instead of a second call at ingest.
 */

const imageTextShape = z.object({ text: z.string() });

const IMAGE_TEXT_SCHEMA = {
  name: "image_text",
  schema: toStrictJsonSchema(imageTextShape),
};

const IMAGE_TEXT_DETAIL = "low" as const;

const IMAGE_TEXT_USER_MESSAGE =
  'Transcribe all visible text in the image that follows. Return a JSON object whose "text" field holds it verbatim, or an empty string when there is none.';

/** Just the `chat` seam of the profiled client, so tests pass a stand-in. */
export type ImageTextChatClient = Pick<
  ReturnType<typeof createProfiledOpenAIClient>,
  "chat"
>;

export type ReadImageTextOptions = {
  client?: ImageTextChatClient;
  /** The row the image belongs to, recorded on the audit span. */
  subjectId?: string;
};

/**
 * Transcribes an image's visible text. Returns "" when the image shows none.
 *
 * THROWS on every failure — a failed request, a refusal, a truncated or
 * off-schema answer. A reader that answered "" on failure would pass every
 * image the moment OpenAI is down; callers decide how to fail.
 */
export async function readImageText(
  processed: { buffer: Buffer } | Buffer,
  options: ReadImageTextOptions = {},
): Promise<string> {
  const buffer = Buffer.isBuffer(processed) ? processed : processed.buffer;
  return readImageTextFromDataUri(await visionDataUri(buffer), options);
}

/**
 * The same read for an image already encoded as a vision data URI — what
 * `loadVisionDataUri` returns for a stored object.
 */
export async function readImageTextFromDataUri(
  dataUri: string,
  options: ReadImageTextOptions = {},
): Promise<string> {
  return auditedCall(
    { provider: "images", operation: "readImageText", kind: "service" },
    async (ctx) => {
      const { text: system, prompt } =
        await fetchLangfusePromptWithMeta("image-text");
      const client =
        options.client ??
        createProfiledOpenAIClient("imageText", {
          phase: "image_text",
          prompt,
        });

      const response = await client.chat({
        system,
        user: IMAGE_TEXT_USER_MESSAGE,
        images: [dataUri],
        imageDetail: IMAGE_TEXT_DETAIL,
        json: true,
        schema: IMAGE_TEXT_SCHEMA,
        ...profileChatParams("imageText"),
      });

      if (!response.ok) {
        throw new Error(`image text request failed (HTTP ${response.status})`);
      }
      if (response.refusal) {
        throw new Error(`image text request refused: ${response.refusal}`);
      }
      if (response.finishReason === "length") {
        throw new Error("image text response truncated (finish_reason=length)");
      }

      const parsed = parseAndValidate(response.content ?? "", imageTextShape);
      if (!parsed.success) {
        throw new Error(`image text response invalid: ${parsed.error}`);
      }
      ctx.summary.textLength = parsed.data.text.length;
      return parsed.data.text;
    },
    { subjectId: options.subjectId },
  );
}
