import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { requireAdminAction } from "@/lib/auth/require-admin";
import { sanitizeErrorResponse } from "@/lib/errors";
import { processImage } from "@/lib/security/image-processor";
import {
  deleteStoredImagePaths,
  uploadPublicImage,
} from "@/lib/services/image-upload";
import { stageSubmissionReviewImage } from "@/lib/services/submissions";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminAction();
  if ("error" in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.code === "unauthenticated" ? 401 : 403 },
    );
  }

  const submissionIdResult = z.uuid().safeParse((await params).id);
  if (!submissionIdResult.success) {
    return NextResponse.json({ error: "Invalid submission" }, { status: 400 });
  }
  const submissionId = submissionIdResult.data;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File size must be under 5MB" },
      { status: 400 },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Please upload an image file" },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size must be under 5MB" },
        { status: 400 },
      );
    }

    const processed = await processImage(Buffer.from(await file.arrayBuffer()));
    const storagePath = `submissions/${submissionId}/${crypto.randomUUID()}.webp`;
    const uploaded = await uploadPublicImage({
      bucket: "brand-images",
      path: storagePath,
      data: processed.buffer,
      contentType: processed.contentType,
    });

    try {
      const image = await stageSubmissionReviewImage({
        submissionId,
        storagePath,
        url: uploaded.url,
        width: processed.width,
        height: processed.height,
      });
      return NextResponse.json(image, { status: 201 });
    } catch (error) {
      try {
        await deleteStoredImagePaths([storagePath]);
      } catch (rollbackError) {
        Sentry.captureException(rollbackError);
      }
      throw error;
    }
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json(sanitizeErrorResponse(error), { status: 500 });
  }
}
