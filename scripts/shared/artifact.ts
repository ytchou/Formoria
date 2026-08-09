/**
 * Shared artifact helpers for operator scripts that render a local review page.
 *
 * Hoisted from scripts/curation-rerun/render.ts and
 * scripts/resort-heroes/render.ts, which carried byte-identical copies of the
 * artifact root, the stamped filename builder, and the HTML escaper. The
 * module deliberately depends on nothing but `node:` builtins, so importing it
 * does not couple two otherwise-independent operator scripts to each other.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Review artifacts live outside the repo so a `git clean -xdf` cannot remove
 * them. `os.homedir()` rather than `process.env.HOME`: with HOME unset the
 * template literal produced a literal `undefined/...` directory under the
 * process cwd, silently scattering artifacts.
 */
export const ARTIFACT_ROOT = resolve(homedir(), "project/.artifact/formoria");

/** review_<name>_<YYYY-MM-DD-HHmmss>.html, matching the existing artifact naming. */
export function artifactPath(name: string): string {
  const t = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
  return resolve(ARTIFACT_ROOT, `review_${name}_${stamp}.html`);
}

/**
 * Escapes for element text and double-quoted attribute values, which is every
 * interpolation site in both renderers. Single quotes are intentionally not
 * escaped: no caller emits a single-quoted attribute. Add `'` here first if one
 * ever does.
 */
export const esc = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
