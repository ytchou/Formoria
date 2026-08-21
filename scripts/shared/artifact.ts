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

export interface ArtifactNameOptions {
  /**
   * Leading segment. Defaults to `review`, which is what the two HTML
   * renderers emit; pass `""` for an artifact that is not a review page.
   */
  prefix?: string;
  /** Extension, without the dot. */
  ext?: string;
  /**
   * Trailing segment after the timestamp. The stamp is second-resolution, so a
   * caller whose runs can overlap passes its pid here — otherwise two
   * concurrent runs overwrite each other's evidence.
   */
  suffix?: string | number;
  /** Injectable clock, so one run can stamp several files identically. */
  now?: Date;
}

/**
 * `<prefix>_<name>_<YYYY-MM-DD-HHmmss>[_<suffix>].<ext>` under ARTIFACT_ROOT.
 *
 * Defaults reproduce the original `review_<name>_<stamp>.html` exactly, so the
 * HTML renderers are unchanged; the options exist for the dry-run report, which
 * needs its own prefix, extension and pid suffix and had hand-rolled the whole
 * builder a third time.
 */
export function artifactPath(
  name: string,
  options: ArtifactNameOptions = {},
): string {
  const { prefix = "review", ext = "html", suffix, now = new Date() } = options;
  const p = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const parts = [
    prefix,
    name,
    stamp,
    suffix === undefined ? "" : String(suffix),
  ].filter((part) => part !== "");
  return resolve(ARTIFACT_ROOT, `${parts.join("_")}.${ext}`);
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
