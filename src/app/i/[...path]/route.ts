import {
  PROXIED_IMAGE_BUCKET,
  serveProxiedImage,
} from "@/lib/images/image-proxy";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * `GET /i/<bucket-relative-path>` — same-origin image bytes (DEV-1551).
 *
 * HTTP wiring only: the allow-list, the traversal rejection and the response
 * headers live in `@/lib/images/image-proxy`, which is also what the tests
 * exercise (the download is injected there rather than mocked here).
 *
 * There is deliberately NO database query on this path. `storage.from(...)`
 * is the only Supabase call.
 */
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const bucket = () =>
    createServiceClient().storage.from(PROXIED_IMAGE_BUCKET);

  return serveProxiedImage(path, (key) => bucket().download(key), {
    ifNoneMatch: request.headers.get("if-none-match"),
    // DEV-1744: the metadata call is what makes a 304 possible. `download`
    // returns only `{ data: Blob, error }` — no response headers — so there is
    // nothing to reuse from it.
    info: (key) => bucket().info(key),
  });
}
