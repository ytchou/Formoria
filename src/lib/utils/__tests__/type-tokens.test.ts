import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cn } from "../index";

/**
 * `cn` must know every type role in `globals.css`. An unregistered role is an
 * unknown string to tailwind-merge: it survives beside a second role or a
 * base font-size, and the winner is whichever rule Tailwind emits last.
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const roles = [...css.matchAll(/@utility (type-[a-z-]+)\s*\{/g)].map(
  (match) => match[1],
);

describe("cn resolves the type roles", () => {
  it("finds the type roles in globals.css", () => {
    expect(roles.length).toBeGreaterThan(0);
  });

  it.each(roles)("%s replaces an earlier size, line height, and family", (role) => {
    expect(cn("text-sm leading-6 font-ming", role)).toBe(role);
  });

  it.each(roles)("%s replaces an earlier type role", (role) => {
    const earlier = role === "type-body" ? "type-label" : "type-body";
    expect(cn(earlier, role)).toBe(role);
  });

  it("lets a caller's role replace Label's base role and keep its state", () => {
    expect(cn("type-body-sm font-semibold text-ink", "type-label")).toBe(
      "font-semibold text-ink type-label",
    );
  });

  it("drops Button's base font-size for a caller's role", () => {
    expect(cn("text-sm", "type-nav")).toBe("type-nav");
  });

  it("keeps weight and colour placed after a role", () => {
    expect(cn("type-nav", "font-semibold")).toBe("type-nav font-semibold");
    expect(cn("type-nav", "text-ink-soft")).toBe("type-nav text-ink-soft");
  });

  it("keeps the role when a later size or line height overrides one property", () => {
    expect(cn("type-nav", "text-sm")).toBe("type-nav text-sm");
    expect(cn("type-nav", "leading-none")).toBe("type-nav leading-none");
  });
});
