/**
 * Leaf module: curated-product name hygiene (DEV-1962, DS-03). Pure string
 * work, no imports, so the service layer, the enrichment pipeline, the admin
 * prefill and the backfill script all share one definition.
 *
 * Two defects, both measured on the 2026-10-08 public catalog scan (1,366
 * names): 173 names end in a shop's random 8-character SKU/handle token
 * (「Your Monkey 眼鏡架兼存錢筒 7cFSL8yz」), and 5 names are the same name
 * written twice (「啵啵杯710ml 啵啵杯710ml」).
 */

/** A trailing whitespace-separated 8-character alphanumeric token. */
const TRAILING_TOKEN = /\s+([A-Za-z0-9]{8})$/;

/**
 * A word-shaped run of letters: lowercase, Capitalized, camelCase with real
 * humps (`iPadMini`, `Chamonix`), or ALL CAPS (`CHECK`). A random token breaks
 * this shape — a capital followed by fewer than two lowercase letters, or a
 * digit between letters.
 */
const WORD_SHAPE = /^(?:[a-z]*(?:[A-Z][a-z]{2,})*|[A-Z]+)$/;

/** `iPhone15`, `Type2024`, `CHECK350`: a word, then a short number. */
const WORD_THEN_NUMBER = /^([A-Za-z]{2,})(\d{1,4})$/;

/** `10000mAh`, `1500ml`: a quantity and a unit. */
const QUANTITY_UNIT = /^\d+[A-Za-z]{1,3}$/;

/**
 * True when an 8-character token reads as a shop's random SKU or handle rather
 * than part of the product's name.
 *
 * The ticket's literal rule ("mixes upper, lower and digits") matches only a
 * minority of the observed tokens: `zJJGtwgx` and `QJVtWFVy` carry no digit,
 * and `q2wz7ii6` no capital. This rule requires a lowercase letter plus either
 * a capital or a digit, then exempts the shapes real names take. On the scan it
 * strips exactly the 173 names the review counted.
 *
 * Deliberate ceiling: tokens with no lowercase letter (`ZYZDLHGE`, `H955AQ6B`)
 * are kept, because they cannot be told apart from model codes such as
 * `DKGP1013` or `A5210009`; tokens that happen to be word-shaped (`acerGurt`)
 * are kept too. Upgrade path, if those matter: compare the token against the
 * product's official URL, where shop handles usually appear verbatim.
 */
export function isShopSkuToken(token: string): boolean {
  if (!/^[A-Za-z0-9]{8}$/.test(token)) return false;
  if (!/[a-z]/.test(token)) return false;
  if (!/[A-Z0-9]/.test(token)) return false;
  if (WORD_SHAPE.test(token)) return false;
  const wordThenNumber = WORD_THEN_NUMBER.exec(token);
  if (wordThenNumber && WORD_SHAPE.test(wordThenNumber[1]!)) return false;
  if (QUANTITY_UNIT.test(token)) return false;
  return true;
}

/** `X X`, `X X X`, … → `X`, where `X` may itself contain spaces (`T Torch T Torch`). */
const DOUBLED_NAME = /^(.+?)(?:\s+\1)+$/u;

/**
 * Strips a trailing shop SKU token, then collapses a name written twice.
 * Idempotent, and returns the input unchanged (bar trimming) when neither
 * defect is present, so it is safe on every write path.
 */
export function normalizeCuratedProductName(name: string): string {
  let normalized = name.trim();

  const token = TRAILING_TOKEN.exec(normalized);
  if (token && isShopSkuToken(token[1]!)) {
    const head = normalized.slice(0, token.index).trim();
    if (head) normalized = head;
  }

  const doubled = DOUBLED_NAME.exec(normalized);
  if (doubled) normalized = doubled[1]!.trim();

  return normalized;
}
