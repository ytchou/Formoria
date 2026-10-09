import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import zhTW from "../../../messages/zh-TW.json";

/**
 * Every literal `t("…")` key the brand page renders must exist in both
 * catalogues (R2-01). A dead-key sweep (#1381) deleted
 * `brandDetail.gallery.viewer` while an open branch was adding a reader, and
 * the gallery rail shipped announcing the raw key. Component specs render
 * key-as-value mocks, so only a scan of the source against the real catalogues
 * catches that.
 *
 * Ceiling: static keys only. A key built at runtime (`t(\`x.${kind}\`)`) is
 * skipped; pin those in the owning component's spec.
 */
type MessageNode = { [key: string]: string | MessageNode };

const ROOT = join(__dirname, "../../..");
const SCAN_DIRS = [
  "src/components/brands",
  "src/app/[locale]/(site)/brands/[slug]",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const NAMESPACE_CALL =
  /(?:useTranslations|getTranslations)\(\s*(?:["']([\w.]+)["']|\{[^}]*?namespace:\s*["']([\w.]+)["'][^}]*\})\s*\)/;

/** Split an array literal's body on its top-level commas. */
function topLevelItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) {
      items.push(body.slice(start, i));
      start = i + 1;
    }
  }
  items.push(body.slice(start));
  return items.filter((item) => item.trim() !== "");
}

/**
 * Translator bindings in source order. A file may bind the same name twice
 * (one `t` per server action), so a call resolves to the nearest binding
 * above it, not to the file's last one.
 */
type Binding = { name: string; namespace: string; at: number };

function bindings(source: string): Binding[] {
  const found: Binding[] = [];
  const single = new RegExp(
    String.raw`const\s+(\w+)\s*=\s*(?:await\s+)?` + NAMESPACE_CALL.source,
    "g",
  );
  for (const match of source.matchAll(single)) {
    found.push({
      name: match[1],
      namespace: match[2] ?? match[3],
      at: match.index,
    });
  }
  const destructured =
    /const\s*\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(\[([\s\S]*?)\]\s*\)/g;
  for (const match of source.matchAll(destructured)) {
    const names = match[1].split(",").map((name) => name.trim());
    topLevelItems(match[2]).forEach((item, index) => {
      const call = item.match(NAMESPACE_CALL);
      const name = names[index];
      if (call && name) {
        found.push({ name, namespace: call[1] ?? call[2], at: match.index });
      }
    });
  }
  return found.sort((a, b) => a.at - b.at);
}

function resolve(node: MessageNode, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        typeof current === "object" && current !== null
          ? (current as MessageNode)[segment]
          : undefined,
      node,
    );
}

function usedKeys(): { file: string; key: string }[] {
  const used: { file: string; key: string }[] = [];
  for (const file of SCAN_DIRS.flatMap(sourceFiles)) {
    const source = readFileSync(join(ROOT, file), "utf8");
    const bound = bindings(source);
    for (const name of new Set(bound.map((binding) => binding.name))) {
      const call = new RegExp(
        String.raw`\b${name}(?:\.rich|\.markup)?\(\s*["']([\w.]+)["']`,
        "g",
      );
      for (const match of source.matchAll(call)) {
        const binding = bound.findLast(
          (candidate) => candidate.name === name && candidate.at < match.index,
        );
        if (!binding) continue;
        used.push({
          file: relative(ROOT, join(ROOT, file)),
          key: `${binding.namespace}.${match[1]}`,
        });
      }
    }
  }
  return used;
}

describe("brand page message keys", () => {
  const used = usedKeys();

  it("finds the brand page's translator calls", () => {
    // Guards the scanner itself: a regex that silently matched nothing would
    // pass every assertion below.
    expect(used.length).toBeGreaterThan(50);
    expect(used.map(({ key }) => key)).toContain("brandDetail.gallery.viewer");
  });

  it.each([
    ["zh-TW", zhTW],
    ["en", en],
  ])("every literal key exists in %s", (_locale, catalogue) => {
    const missing = used
      .filter(
        ({ key }) =>
          typeof resolve(catalogue as unknown as MessageNode, key) !== "string",
      )
      .map(({ file, key }) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });
});
