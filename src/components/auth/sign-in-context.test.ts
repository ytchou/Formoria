import { describe, expect, it } from "vitest";

import { signInContextFor } from "./sign-in-context";

describe("signInContextFor", () => {
  it("maps the favorites page in either locale", () => {
    expect(signInContextFor("/favorites")).toBe("favorites");
    expect(signInContextFor("/en/favorites")).toBe("favorites");
  });

  it("maps the settings page and ignores its query and hash", () => {
    expect(signInContextFor("/settings?tab=x")).toBe("settings");
    expect(signInContextFor("/en/settings#marketing")).toBe("settings");
  });

  it("matches sub-paths but not a path that only shares the prefix", () => {
    expect(signInContextFor("/favorites/brands")).toBe("favorites");
    expect(signInContextFor("/favorites-foo")).toBeNull();
  });

  it("returns null for any other destination", () => {
    expect(signInContextFor("/brands")).toBeNull();
    expect(signInContextFor("/")).toBeNull();
    expect(signInContextFor("//evil.example/favorites")).toBeNull();
  });

  it("returns null when there is no next", () => {
    expect(signInContextFor(null)).toBeNull();
    expect(signInContextFor(undefined)).toBeNull();
    expect(signInContextFor("")).toBeNull();
  });
});
