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
 *
 * AD-CREATIVE SIGNALS (DEV-1989): the same call also estimates how much of the
 * image is overlaid text (`textCoverage`) and whether a person presents the
 * product (`endorsementPerson`), so `findAdCreativeSignals` can reject ad
 * creatives without a second model call. Every field is REQUIRED: strict
 * structured outputs drop optional fields. The instructions for the two new
 * fields live in the user message, because the system prompt is the Langfuse
 * `image-text` prompt and its repo snapshot mirrors Langfuse, never leads it.
 * Ceiling: the v1 system prompt still says "one field"; the strict schema and
 * the user message override it. Upgrade path: push an `image-text` v2 that
 * describes all three fields, then pull the snapshot.
 */

const imageTextShape = z.object({
  text: z.string(),
  textCoverage: z.number(),
  endorsementPerson: z.boolean(),
});

/** The transcribed text plus the two ad-creative judgements. */
export type ImageSignals = z.infer<typeof imageTextShape>;

const IMAGE_TEXT_SCHEMA = {
  name: "image_text",
  schema: toStrictJsonSchema(imageTextShape),
};

const IMAGE_TEXT_DETAIL = "low" as const;

const IMAGE_TEXT_USER_MESSAGE = [
  "Transcribe all visible text in the image that follows, then judge two things about the image. Return a JSON object with three fields:",
  '- "text": all visible text verbatim, or an empty string when there is none.',
  '- "textCoverage": a number from 0 to 1, the fraction of the image area covered by text overlaid on the photo or set as graphic design (banners, captions, slogans, badges, callouts). Do not count text physically printed on the product or its packaging. Return 0 when there is none.',
  '- "endorsementPerson": true when a person or model is the subject of the image, presenting or endorsing the product (a spokesperson, celebrity or model advertisement). False for a product-only shot, a hand holding or using the product, or no person at all.',
].join("\n");

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
 * Transcribes an image's visible text and reads its ad-creative signals.
 * `text` is "" when the image shows none.
 *
 * THROWS on every failure — a failed request, a refusal, a truncated or
 * off-schema answer. A reader that answered "" on failure would pass every
 * image the moment OpenAI is down; callers decide how to fail.
 */
export async function readImageSignals(
  processed: { buffer: Buffer } | Buffer,
  options: ReadImageTextOptions = {},
): Promise<ImageSignals> {
  const buffer = Buffer.isBuffer(processed) ? processed : processed.buffer;
  return readImageSignalsFromDataUri(await visionDataUri(buffer), options);
}

/**
 * The same read for an image already encoded as a vision data URI — what
 * `loadVisionDataUri` returns for a stored object.
 */
export async function readImageSignalsFromDataUri(
  dataUri: string,
  options: ReadImageTextOptions = {},
): Promise<ImageSignals> {
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
      // A model estimate outside 0..1 is clamped, not rejected: rejecting
      // would fail the gate closed on a rounding slip.
      const textCoverage = Math.min(1, Math.max(0, parsed.data.textCoverage));
      ctx.summary.textLength = parsed.data.text.length;
      ctx.summary.textCoverage = textCoverage;
      ctx.summary.endorsementPerson = parsed.data.endorsementPerson;
      return { ...parsed.data, textCoverage };
    },
    { subjectId: options.subjectId },
  );
}
