import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import {
  resetAuditEmitterForTests,
  setAuditWriteSeam,
} from "@/lib/audit";
import { getInstallationToken, GitHubAppError } from "../app-auth";

let testPrivateKeyPem: string;

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  testPrivateKeyPem = await exportPKCS8(privateKey);
});

beforeEach(() => {
  setAuditWriteSeam(async () => null);
  vi.stubEnv("GITHUB_APP_ID", "12345");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", testPrivateKeyPem);
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "67890");
  vi.stubEnv("GITHUB_APP_REPOSITORY", "ytchou/Formoria");
});

afterEach(() => {
  resetAuditEmitterForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getInstallationToken", () => {
  it("installation token request narrows to one repository and contents:read for clone tokens", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ token: "ghs_clone_token" }));

    const token = await getInstallationToken("clone");
    expect(token).toBe("ghs_clone_token");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/app/installations/67890/access_tokens");

    const body = JSON.parse(init!.body as string);
    expect(body.repositories).toEqual(["Formoria"]);
    expect(body.permissions).toEqual({ contents: "read" });
  });

  it("publish token requests contents:write and pull_requests:write", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ token: "ghs_publish_token" }));

    await getInstallationToken("publish");

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.permissions).toEqual({
      contents: "write",
      pull_requests: "write",
    });
  });

  it("a 401 from GitHub surfaces as a typed error, not a thrown fetch error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Bad credentials", { status: 401 }),
    );

    const err = await getInstallationToken("clone").catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GitHubAppError);
    expect((err as GitHubAppError).status).toBe(401);
  });
});
