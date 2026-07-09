import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

function createTestStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

beforeEach(() => {
  if (typeof window !== "undefined") {
    const storage = window.localStorage ?? createTestStorage();

    if (!window.localStorage) {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: storage,
      });
    }

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
  }
});

afterEach(() => {
  cleanup();
});

// Polyfills for Radix UI / Base UI pointer and scroll APIs missing in jsdom.
// Required so floating menus (DropdownMenu, Select, etc.) can open in tests.
if (typeof window !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
