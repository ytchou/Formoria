import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminAction: vi.fn(),
  processImage: vi.fn(),
  uploadPublicImage: vi.fn(),
  stageSubmissionReviewImage: vi.fn(),
  deleteStoredImagePaths: vi.fn(),
}));

vi.mock("@/lib/auth/require-admin", () => ({
  requireAdminAction: mocks.requireAdminAction,
}));
vi.mock("@/lib/security/image-processor", () => ({
  processImage: mocks.processImage,
}));
vi.mock("@/lib/services/image-upload", () => ({
  uploadPublicImage: mocks.uploadPublicImage,
  deleteStoredImagePaths: mocks.deleteStoredImagePaths,
}));
vi.mock("@/lib/services/submissions", () => ({
  stageSubmissionReviewImage: mocks.stageSubmissionReviewImage,
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { POST } from "./route";

const submissionId = "00000000-0000-4000-8000-000000000010";

describe("POST /api/admin/submissions/[id]/images", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminAction.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com" },
    });
    mocks.processImage.mockResolvedValue({
      buffer: Buffer.from("processed"),
      contentType: "image/webp",
      width: 1200,
      height: 900,
    });
    mocks.uploadPublicImage.mockResolvedValue({
      url: "https://cdn.example.com/upload.webp",
    });
    mocks.stageSubmissionReviewImage.mockResolvedValue({
      id: "image-1",
      submissionId,
      storagePath: expect.any(String),
      url: "https://cdn.example.com/upload.webp",
      source: "admin",
      status: "draft",
      sortOrder: 0,
      altZh: null,
      altEn: null,
      width: 1200,
      height: 900,
    });
  });

  it("rejects unauthenticated uploads before reading the body", async () => {
    mocks.requireAdminAction.mockResolvedValue({
      error: "Authentication required",
      code: "unauthenticated",
    });
    const request = { formData: vi.fn() } as unknown as Request;

    const response = await POST(request, context());

    expect(response.status).toBe(401);
    expect(request.formData).not.toHaveBeenCalled();
  });

  it("rejects an invalid submission id before reading the body", async () => {
    const request = { formData: vi.fn(), headers: new Headers() } as unknown as Request;

    const response = await POST(request, {
      params: Promise.resolve({ id: "../other-submission" }),
    });

    expect(response.status).toBe(400);
    expect(request.formData).not.toHaveBeenCalled();
  });

  it.each([
    ["image/gif", 4],
    ["image/png", 5 * 1024 * 1024 + 1],
  ])("rejects invalid %s uploads", async (type, size) => {
    const response = await POST(uploadRequest(type, size), context());

    expect(response.status).toBe(400);
    expect(mocks.uploadPublicImage).not.toHaveBeenCalled();
  });

  it("processes, stores, and registers a draft review image", async () => {
    const response = await POST(uploadRequest("image/png", 10), context());

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: "image-1",
      submissionId,
      status: "draft",
      url: "https://cdn.example.com/upload.webp",
    });
    expect(mocks.uploadPublicImage).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "brand-images",
        path: expect.stringMatching(
          new RegExp(`^submissions/${submissionId}/.+\\.webp$`),
        ),
        contentType: "image/webp",
      }),
    );
    expect(mocks.stageSubmissionReviewImage).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId,
        width: 1200,
        height: 900,
      }),
    );
  });

  it("rolls storage back when draft registration fails", async () => {
    mocks.stageSubmissionReviewImage.mockRejectedValue(new Error("db failed"));

    const response = await POST(uploadRequest("image/webp", 10), context());

    expect(response.status).toBe(500);
    expect(mocks.deleteStoredImagePaths).toHaveBeenCalledWith([
      expect.stringMatching(
        new RegExp(`^submissions/${submissionId}/.+\\.webp$`),
      ),
    ]);
  });
});

function context() {
  return { params: Promise.resolve({ id: submissionId }) };
}

function uploadRequest(type: string, size: number): Request {
  const formData = new FormData();
  formData.set("file", new File([new Uint8Array(size)], "image", { type }));
  return new Request("http://localhost/api/admin/submissions/id/images", {
    method: "POST",
    body: formData,
  });
}
