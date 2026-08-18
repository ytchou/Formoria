import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const bootstrap = readFileSync(
  resolve(import.meta.dirname, "../supabase/bootstrap/staging.sql"),
  "utf8",
).toLowerCase();
const deployGuard = readFileSync(
  resolve(import.meta.dirname, "./db-deploy.ts"),
  "utf8",
).toLowerCase();
const packageJson = readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8");

describe("staging database bootstrap contracts", () => {
  it("creates inert health agent roles only when they are absent", () => {
    for (const role of ["health_agent_reader", "health_agent_writer"]) {
      expect(bootstrap).toMatch(
        new RegExp(
          `if not exists[\\s\\S]*create role ${role} nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
        ),
      );
      expect(bootstrap).not.toMatch(new RegExp(`alter role ${role}`));
    }
  });

  it("keeps the guarded remote deploy path and removes local replay tooling", () => {
    expect(deployGuard).toContain("validatedeploymenttarget");
    expect(deployGuard).toContain("migrationsafetyplan");
    expect(deployGuard).toContain("verify(target, false)");
    expect(packageJson).not.toContain("db:replay:clean");
    expect(existsSync(resolve(import.meta.dirname, "./db-clean-replay.sh"))).toBe(false);
    expect(existsSync(resolve(import.meta.dirname, "../.github/workflows/database-replay.yml"))).toBe(false);
  });

  it("requires the complete staging identity and two durable E2E accounts", () => {
    expect(deployGuard).toContain("validatestagingtarget(environment)");
    for (const name of [
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_ADMIN_EMAIL",
      "E2E_ADMIN_PASSWORD",
      "ADMIN_EMAILS",
    ]) {
      expect(deployGuard).toContain(`\"${name.toLowerCase()}\"`);
    }
    expect(deployGuard).toContain("email_confirm: true");
    expect(deployGuard).toContain("updateuserbyid");
  });
});
