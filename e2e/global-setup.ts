import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import { chromium, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { cleanupTestData } from "./helpers/cleanup";
import { writeAuthStorageState } from "./helpers/auth-session";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Working directory of whatever process is listening on `port`, or null if undeterminable. */
function listeningProcessCwd(port: string): string | null {
  const run = (args: string[]) =>
    execFileSync("lsof", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  try {
    const pids = run(["-t", `-i:${port}`, "-sTCP:LISTEN"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    for (const pid of pids) {
      const cwdLine = run(["-a", "-p", pid, "-d", "cwd", "-Fn"])
        .split("\n")
        .find((line) => line.startsWith("n/"));
      if (cwdLine) return cwdLine.slice(1);
    }
  } catch {
    // lsof missing (non-macOS/Linux) or no listener — fall through
  }
  return null;
}

/**
 * `reuseExistingServer` is on outside CI, so a `pnpm dev` left running from a
 * *different* checkout answers on the same port and the whole suite silently
 * tests the wrong code. It is not an obvious failure: brand rows live in the
 * shared cloud database, so pages still render and only branch-specific UI is
 * missing — specs die on opaque "element(s) not found" timeouts that look like
 * selector bugs. This repo keeps many worktrees, so it is easy to hit.
 * Fail fast and name the directory actually being served.
 */
function assertServerServesThisCheckout(): void {
  if (process.env.CI) return;

  const baseURL =
    process.env.BASE_URL ??
    process.env.PLAYWRIGHT_BASE_URL ??
    "http://localhost:3000";
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return;
  }
  // A remote target is deliberate (preview/staging) — nothing to compare against.
  if (!LOCAL_HOSTNAMES.has(url.hostname)) return;

  const serverCwd = listeningProcessCwd(url.port || "3000");
  if (!serverCwd) return; // nothing listening yet, or no lsof — don't block the run

  const projectRoot = path.resolve(__dirname, "..");
  if (path.resolve(serverCwd) === projectRoot) return;

  throw new Error(
    `E2E preflight failed — ${baseURL} is served from a different checkout.\n` +
      `  serving:  ${serverCwd}\n` +
      `  expected: ${projectRoot}\n` +
      `Playwright reuses an already-running dev server, so this run would have\n` +
      `tested the wrong branch's code and failed with misleading selector errors.\n` +
      `Hint: stop that dev server (\`lsof -ti:${url.port || "3000"} | xargs kill\`) and re-run,\n` +
      `or point this run elsewhere with BASE_URL=http://localhost:<other-port>.`,
  );
}

async function globalSetup() {
  // Guard first: everything below is wasted work if the wrong server answers.
  assertServerServesThisCheckout();

  // Purge stale auth session files so every worker gets a fresh Supabase token
  const authDir = path.join(__dirname, ".auth");
  if (fs.existsSync(authDir)) {
    for (const file of fs.readdirSync(authDir)) {
      fs.unlinkSync(path.join(authDir, file));
    }
  }

  // Sweep orphaned test data from previous runs (runs once, globally)
  await cleanupTestData();

  const requiredVars = [
    "E2E_ADMIN_EMAIL",
    "E2E_ADMIN_PASSWORD",
    "E2E_USER_EMAIL",
    "E2E_USER_PASSWORD",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required e2e env vars: ${missing.join(", ")}\nAdd them to .env.local`,
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Preflight: validate seed insert works — catches schema changes early
  const { data: probe, error: probeErr } = await supabase
    .from("brands")
    .insert({
      name: "[E2E-TEST] Preflight Probe",
      slug: `e2e-preflight-probe-${Date.now()}`,
      status: "approved",
    })
    .select("id")
    .single();

  if (probeErr || !probe) {
    throw new Error(
      `E2E preflight failed — seed insert rejected.\n` +
        `Constraint: ${probeErr?.code} — ${probeErr?.message}\n` +
        `Details: ${probeErr?.details}\n` +
        `Hint: Check brands table schema for new CHECK constraints or NOT NULL columns.`,
    );
  }

  // Clean up probe immediately
  await supabase.from("brands").delete().eq("id", probe.id);

  // Sessions are written lazily per worker in fixtures/auth.ts.
  // global-setup intentionally does NOT write shared .auth/*.json files —
  // each Playwright worker will call writeAuthStorageState() for its own
  // per-worker path, giving every worker a distinct Supabase refresh token.

  // CI runs the production server, so there are no on-demand bundles to warm.
  if (process.env.CI) return;

  // Browser warm-up: compile the submit recommendation and owner flows before specs
  // hit them. A plain fetch() only warms the server bundle, not the client bundle.
  // Any failure is swallowed — this must NEVER break the suite.
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

  // webServer 2xx fires before manifests are written; probe a static chunk to avoid loadManifestFromRelativePath SyntaxError
  const manifestProbeUrl = `${baseURL}/_next/static/chunks/main.js`;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(manifestProbeUrl);
      if (res.ok) break;
    } catch {
      // server not yet serving static assets
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
  }

  const tmpStorePath = path.join(__dirname, ".auth", "warmup-user.json");
  await (async () => {
    let browser: Browser | undefined;
    try {
      await writeAuthStorageState("user", tmpStorePath);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ storageState: tmpStorePath });
      const page = await context.newPage();
      await page.goto(`${baseURL}/submit/recommend`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page
        .locator('input[type="url"]')
        .first()
        .waitFor({ state: "visible", timeout: 120_000 });
      await page.goto(`${baseURL}/submit/owner/quick`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page
        .locator('input[type="url"]')
        .first()
        .waitFor({ state: "visible", timeout: 120_000 });
      try {
        await page.goto(baseURL + "/dashboard", {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        console.log("[global-setup] /dashboard warm-up complete");
      } catch (err) {
        console.warn(
          "[global-setup] /dashboard warm-up failed (non-fatal):",
          err instanceof Error ? err.message : String(err),
        );
      }
      try {
        await page.goto(baseURL + "/admin", {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        console.log("[global-setup] /admin warm-up complete");
      } catch (err) {
        console.warn(
          "[global-setup] /admin warm-up failed (non-fatal):",
          err instanceof Error ? err.message : String(err),
        );
      }
      // /brands is the entry point the brand-detail spec's beforeAll hook uses to
      // resolve a brand href. Compiling it on demand while several workers hit it
      // at once pushed that hook past its timeout, failing the whole describe
      // block before any test body ran.
      try {
        await page.goto(baseURL + "/brands", {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await page
          .locator("main a[aria-label]")
          .first()
          .waitFor({ state: "visible", timeout: 120_000 });
        console.log("[global-setup] /brands warm-up complete");
      } catch (err) {
        console.warn(
          "[global-setup] /brands warm-up failed (non-fatal):",
          err instanceof Error ? err.message : String(err),
        );
      }
      // Brand detail is the most-exercised route in the deep suite and carries a
      // heavy client bundle (correction sheets, share dialog, likes). Compiling it
      // on demand while several workers hit it at once pushes first interaction
      // and the first server-action round-trip past the specs' timeouts, which
      // shows up as flaky "element(s) not found" on dialogs and toasts.
      try {
        const { data: warmBrand } = await supabase
          .from("brands")
          .select("slug")
          .eq("status", "approved")
          .limit(1)
          .maybeSingle();
        if (warmBrand?.slug) {
          await page.goto(`${baseURL}/brands/${warmBrand.slug}`, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          await page
            .getByRole("heading", { level: 1 })
            .first()
            .waitFor({ state: "visible", timeout: 120_000 });
          console.log("[global-setup] /brands/[slug] warm-up complete");
        }
      } catch (err) {
        console.warn(
          "[global-setup] /brands/[slug] warm-up failed (non-fatal):",
          err instanceof Error ? err.message : String(err),
        );
      }
      await context.close();
      console.log(
        "[global-setup] /submit/recommend warm-up complete — client bundle compiled",
      );
    } catch (err) {
      console.warn(
        "[global-setup] /submit/recommend warm-up failed (non-fatal):",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      if (browser) await browser.close().catch(() => {});
      if (fs.existsSync(tmpStorePath)) fs.unlinkSync(tmpStorePath);
    }
  })();
}

export default globalSetup;
