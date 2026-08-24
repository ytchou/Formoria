import { BUDGET, POLL } from "./budgets";
import path from "path";
import fs from "fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "child_process";
import { chromium, expect, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { cleanupTestData } from "./helpers/cleanup";
import { writeAuthStorageState } from "./helpers/auth-session";
import { validateStagingTarget } from "../scripts/staging-target";

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
    process.env.STAGING_BASE_URL ??
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
  // This is deliberately before any cleanup or probe mutation. Local and
  // production targets are not supported: the suite is canonical only against
  // the isolated deployed staging origin and project.
  validateStagingTarget(process.env);

  // Guard first: everything below is wasted work if the wrong server answers.
  assertServerServesThisCheckout();

  // Purge stale auth session files so every worker gets a fresh Supabase token
  const authDir = path.join(__dirname, ".auth");
  if (fs.existsSync(authDir)) {
    for (const file of fs.readdirSync(authDir)) {
      fs.unlinkSync(path.join(authDir, file));
    }
  }

  // Sweep orphaned test data from previous runs (runs once, globally). The 6h
  // window is deliberate here — setup must remain safe if an operator starts
  // a manual run while another invocation is still finishing. Teardown runs
  // after the serialized suite and applies the strict run-scoped audit.
  process.env.E2E_RUN_STARTED_AT = new Date().toISOString();
  // Short id specs may stamp '[E2E-TEST] R-<id> …' seed names (see
  // helpers/cleanup.ts's e2eSeedName); the strict teardown sweep also covers
  // legacy un-stamped names because complete suite invocations are serialized.
  process.env.E2E_RUN_ID = randomUUID().slice(0, 8);
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
      // `brands_approved_requires_timestamp` (#643): an approved row without
      // this column is rejected outright.
      approved_at: new Date().toISOString(),
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

  // Clean up probe immediately; a successful insert with a failed delete must
  // not be allowed to seed residue before the suite has even started.
  const { error: probeCleanupErr } = await supabase
    .from("brands")
    .delete()
    .eq("id", probe.id);
  if (probeCleanupErr) {
    throw new Error(
      `E2E preflight cleanup failed — ${probeCleanupErr.message}`,
    );
  }

  // Sessions are written lazily per worker in fixtures/auth.ts.
  // global-setup intentionally does NOT write shared .auth/*.json files —
  // each Playwright worker will call writeAuthStorageState() for its own
  // per-worker path, giving every worker a distinct Supabase refresh token.

  // CI runs against the deployed staging server, so there are no on-demand
  // bundles to warm.
  if (process.env.CI) return;

  // Browser warm-up: compile the submit flows before specs hit them.
  // A plain fetch() only warms the server bundle, not the client bundle.
  // Any failure is swallowed — this must NEVER break the suite.
  const baseURL =
    process.env.PLAYWRIGHT_BASE_URL ??
    process.env.BASE_URL ??
    process.env.STAGING_BASE_URL ??
    "http://localhost:3000";

  // webServer 2xx fires before manifests are written; poll a static chunk to
  // avoid loadManifestFromRelativePath SyntaxError without a guessed sleep.
  const manifestProbeUrl = `${baseURL}/_next/static/chunks/main.js`;
  try {
    await expect
      .poll(
        async () => {
          try {
            const res = await fetch(manifestProbeUrl);
            return res.ok;
          } catch {
            return false;
          }
        },
        POLL.NAVIGATION,
      )
      .toBe(true);
  } catch (err) {
    console.warn(
      "[global-setup] static asset warm-up probe failed (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
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
        timeout: BUDGET.NAVIGATION,
      });
      await page
        .locator('input[type="url"]')
        .first()
        .waitFor({ state: "visible", timeout: BUDGET.WARMUP });
      // The submit overview. Wrapped like its siblings so a warm-up failure
      // here fails on its own rather than throwing past every warm-up below it.
      try {
        await page.goto(`${baseURL}/submit`, {
          waitUntil: "domcontentloaded",
          timeout: BUDGET.NAVIGATION,
        });
        await page
          .getByRole("heading", { level: 1 })
          .first()
          .waitFor({ state: "visible", timeout: BUDGET.WARMUP });
        console.log("[global-setup] /submit warm-up complete");
      } catch (err) {
        console.warn(
          "[global-setup] /submit warm-up failed (non-fatal):",
          err instanceof Error ? err.message : String(err),
        );
      }
      try {
        await page.goto(baseURL + "/admin", {
          waitUntil: "domcontentloaded",
          timeout: BUDGET.NAVIGATION,
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
          timeout: BUDGET.NAVIGATION,
        });
        await page
          .locator("main a[aria-label]")
          .first()
          .waitFor({ state: "visible", timeout: BUDGET.WARMUP });
        console.log("[global-setup] /brands warm-up complete");
      } catch (err) {
        console.warn(
          "[global-setup] /brands warm-up failed (non-fatal):",
          err instanceof Error ? err.message : String(err),
        );
      }
      // /stories is reached by a client-side nav from the header link, so the first
      // click has to wait on an on-demand compile of a route nothing has touched yet.
      // That regularly exceeded the smoke spec's 15s URL assertion and read as "the
      // nav link does not navigate" rather than "the route was still compiling".
      try {
        await page.goto(baseURL + "/stories", {
          waitUntil: "domcontentloaded",
          timeout: BUDGET.NAVIGATION,
        });
        console.log("[global-setup] /stories warm-up complete");
      } catch (err) {
        console.warn(
          "[global-setup] /stories warm-up failed (non-fatal):",
          err instanceof Error ? err.message : String(err),
        );
      }
      // Brand detail is the most-exercised route in the deep suite and carries a
      // heavy client bundle (correction dialog, share dialog, likes). Compiling it
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
            timeout: BUDGET.NAVIGATION,
          });
          await page
            .getByRole("heading", { level: 1 })
            .first()
            .waitFor({ state: "visible", timeout: BUDGET.WARMUP });
          console.log("[global-setup] /brands/[slug] warm-up complete");
          // The unprefixed URL above redirects to the default locale (zh-TW),
          // so the `en` render of this route is still cold. Specs navigate to
          // /en/brands/[slug] client-side, where the first on-demand compile
          // was measured at 4.4-8.4s — well past Playwright's 5s default
          // `expect` budget, which reads as "the link does not navigate".
          await page.goto(`${baseURL}/en/brands/${warmBrand.slug}`, {
            waitUntil: "domcontentloaded",
            timeout: BUDGET.NAVIGATION,
          });
          await page
            .getByRole("heading", { level: 1 })
            .first()
            .waitFor({ state: "visible", timeout: BUDGET.WARMUP });
          console.log("[global-setup] /en/brands/[slug] warm-up complete");
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
