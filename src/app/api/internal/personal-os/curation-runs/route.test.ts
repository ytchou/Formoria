import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

afterEach(() => {
  delete process.env.PERSONAL_OS_INTERNAL_TOKEN;
});
describe("Personal OS curation runs endpoint", () => {
  // Bug caught: the sanitized curation history endpoint could be read without the existing bearer token.
  it("rejects requests without the Personal OS bearer token", async () => {
    process.env.PERSONAL_OS_INTERNAL_TOKEN = "internal-secret";

    const response = await GET(
      new Request(
        "https://formoria.test/api/internal/personal-os/curation-runs",
      ),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "unauthorized",
      message: "Unauthorized",
    });
  });

  it("rejects an incomplete run window before querying curation history", async () => {
    process.env.PERSONAL_OS_INTERNAL_TOKEN = "internal-secret";

    const response = await GET(
      new Request(
        "https://formoria.test/api/internal/personal-os/curation-runs?start=2026-08-09T16%3A00%3A00Z",
        { headers: { Authorization: "Bearer internal-secret" } },
      ),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "invalid_curation_runs_window",
      message: "A valid start and end window is required.",
    });
  });
});
