import { createPrivateKey } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { auditedCall } from "@/lib/audit";

const TIMEOUT_MS = 8_000;
const GITHUB_API = "https://api.github.com";

/**
 * Normalize a PEM private key from any Railway env var encoding to valid PKCS#8.
 *
 * Handles: literal `\n`, `\\n`, missing line-breaks, PKCS#1→PKCS#8 conversion.
 */
function normalizePem(raw: string): string {
  // Step 1: Replace literal \n sequences with real newlines
  let pem = raw.replace(/\\n/g, "\n").trim();

  // Step 2: If the PEM looks like a single line, reconstruct it
  const headerMatch = pem.match(
    /-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----/,
  );
  const footerMatch = pem.match(
    /-----END (RSA PRIVATE KEY|PRIVATE KEY)-----/,
  );
  if (headerMatch && footerMatch) {
    const header = `-----BEGIN ${headerMatch[1]}-----`;
    const footer = `-----END ${footerMatch[1]}-----`;
    const body = pem
      .replace(header, "")
      .replace(footer, "")
      .replace(/\s+/g, "");
    // Re-wrap base64 at 64 chars per line
    const lines = body.match(/.{1,64}/g) ?? [];
    pem = [header, ...lines, footer].join("\n");
  }

  // Step 3: Convert PKCS#1 (RSA PRIVATE KEY) → PKCS#8 (PRIVATE KEY) if needed
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    const pkcs8Key = createPrivateKey(pem);
    return pkcs8Key.export({ type: "pkcs8", format: "pem" }) as string;
  }

  return pem;
}

type TokenScope = "clone" | "publish";

const PERMISSIONS: Record<TokenScope, Record<string, string>> = {
  clone: { contents: "read" },
  publish: { contents: "write", pull_requests: "write" },
};

/**
 * Typed error for GitHub App API failures. Surfaces the HTTP status
 * instead of letting a raw fetch TypeError propagate.
 */
export class GitHubAppError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`GitHub App API error: ${status}`);
    this.name = "GitHubAppError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Sign a short-lived JWT for the GitHub App.
 * Clock skew: iat is 60 s in the past; exp is 10 min from now.
 */
async function signAppJwt(
  appId: string,
  privateKeyPem: string,
): Promise<string> {
  const key = await importPKCS8(normalizePem(privateKeyPem), "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 10 * 60)
    .setIssuer(appId)
    .sign(key);
}

/**
 * Exchange an App JWT for a scoped installation access token.
 *
 * The token is narrowed to the single repository configured in
 * `GITHUB_APP_REPOSITORY` and carries only the permissions required
 * for the requested scope.
 *
 * Ceiling: no caching — every call signs a JWT and makes an HTTP
 * round-trip. Add a TTL cache keyed on scope if call volume exceeds
 * ~10/min; GitHub rate-limits App JWT exchanges per installation.
 */
export async function getInstallationToken(
  scope: TokenScope,
): Promise<string> {
  const appId = requireEnv("GITHUB_APP_ID");
  const privateKey = requireEnv("GITHUB_APP_PRIVATE_KEY");
  const installationId = requireEnv("GITHUB_APP_INSTALLATION_ID");
  const repository =
    process.env.GITHUB_APP_REPOSITORY ?? "ytchou/Formoria";
  const repoName = repository.split("/").pop()!;

  const jwt = await signAppJwt(appId, privateKey);

  return auditedCall(
    {
      provider: "github-app",
      operation: "get_installation_token",
      kind: "external",
    },
    async () => {
      const response = await fetch(
        `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repositories: [repoName],
            permissions: PERMISSIONS[scope],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        throw new GitHubAppError(response.status, body);
      }

      const data = (await response.json()) as { token: string };
      return data.token;
    },
  );
}
