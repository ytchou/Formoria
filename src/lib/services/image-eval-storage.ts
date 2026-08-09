import { createServiceClient } from "@/lib/supabase/service";
import { auditedCall } from "@/lib/audit";

export const IMAGE_EVAL_BUCKET = "image-eval" as const;
export const IMAGE_EVAL_SIGNED_URL_SECONDS = 60 * 60;

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
  const result = new Map<string, string>();
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const supabase = createServiceClient();

  for (let index = 0; index < uniquePaths.length; index += 100) {
    const batch = uniquePaths.slice(index, index + 100);
    const { data, error } = await supabase.storage
      .from(IMAGE_EVAL_BUCKET)
      .createSignedUrls(batch, IMAGE_EVAL_SIGNED_URL_SECONDS);
    if (error) throw error;
    data?.forEach((item, itemIndex) => {
      const signedUrl = item.signedUrl;
      if (signedUrl && batch[itemIndex])
        result.set(batch[itemIndex], signedUrl);
    });
  }

  return result;
}
