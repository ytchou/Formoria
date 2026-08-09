import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

afterEach(() => {
  delete process.env.PERSONAL_OS_INTERNAL_TOKEN;
});
describe("Personal OS curation runs endpoint", () => {
  // Bug caught: the sanitized curation history endpoint could be read without the existing bearer token.
  it("rejects requests without the Personal OS bearer token", async () => {
    process.env.PERSONAL_OS_INTERNAL_TOKEN = "internal-secret";

    const response = await GET(new Request("https://formoria.test/api/internal/personal-os/curation-runs"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ code: "unauthorized", message: "Unauthorized" });
  });
});
