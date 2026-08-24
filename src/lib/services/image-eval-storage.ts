import { createServiceClient } from "@/lib/supabase/service";
import { auditedCall } from "@/lib/audit";
import {
  bucketSigner,
  createSignedUrlsInBatches,
} from "./_shared/signed-urls";

const IMAGE_EVAL_BUCKET = "image-eval" as const;
const IMAGE_EVAL_SIGNED_URL_SECONDS = 60 * 60;

export async function uploadImageEvalAsset(
  path: string,
  data: Buffer,
): Promise<void> {
  return auditedCall(
    { provider: "images", operation: "uploadImageEvalAsset", kind: "service" },
    async () => {
      const { error } = await createServiceClient()
        .storage.from(IMAGE_EVAL_BUCKET)
        .upload(path, data, {
          contentType: "image/webp",
          cacheControl: "31536000",
          upsert: true,
        });
      if (error) throw error;
    },
  );
}

export async function createImageEvalSignedUrls(
  paths: string[],
): Promise<Map<string, string>> {
  const { byPath } = await createSignedUrlsInBatches(
    paths,
    bucketSigner(IMAGE_EVAL_BUCKET, IMAGE_EVAL_SIGNED_URL_SECONDS),
  );

  return byPath;
}
