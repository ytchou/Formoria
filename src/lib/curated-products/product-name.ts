/**
 * Leaf module: curated-product name hygiene (DEV-1962, DS-03). Pure string
 * work, no imports, so the service layer, the enrichment pipeline, the admin
 * prefill and the backfill script all share one definition.
 *
 * Two defects, both measured on the 2026-10-08 public catalog scan (1,366
 * names): 173 names end in a shop's random 8-character SKU/handle token
 * (「Your Monkey 眼鏡架兼存錢筒 7cFSL8yz」), and 5 names are the same name
 * written twice (「啵啵杯710ml 啵啵杯710ml」).
 *
 * The 2026-10-08 staging review (DEV-1989, DS2-01) added a third shape: a
 * pure 8-digit shop SKU after a CJK run (「綁帶甜椒日・白菊姊姊 32141747」).
 * See `CJK_THEN_DIGIT_SKU` for where that rule stops. The same review found
 * tokens glued to a fullwidth closing bracket with no space
 * (`BRACKET_THEN_TOKEN`), and separators a stripped token left dangling
 * (`DANGLING_SEPARATOR`).
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
 * are kept here — bar the all-digit tail after CJK text, which
 * `CJK_THEN_DIGIT_SKU` handles separately — because they cannot be told apart from model codes such as
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

/**
 * A trailing whitespace-separated 8-digit token, directly after a CJK
 * character: Han, kana, or CJK / fullwidth punctuation such as 」.
 *
 * Deliberate ceiling: digits after Latin text (`DKGP 10131234`) are KEPT,
 * because there they read as a model number, and `isShopSkuToken` keeps its
 * no-lowercase rule for the same reason. An 8-digit model code that follows
 * Chinese text directly (「多WAY皺皺掛繩 41020001」) is stripped; on the
 * 2026-10-08 staging scan every such tail was a shop item number, not a name.
 * Upgrade path, if a real one appears: the same official-URL comparison as
 * above, or an allow-list per brand.
 */
const CJK_THEN_DIGIT_SKU =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\uFF00-\uFFEF](\s+\d{8})$/u;

/**
 * An 8-character token glued, with no whitespace, to a fullwidth closing
 * bracket: 「石虎機能設計襪（女款）fv6wjmPG」 (DEV-1989). Only these five
 * brackets: after any other character a glued run is as likely to be part of a
 * word as a token. The token itself must still pass `isShopSkuToken`.
 */
const BRACKET_THEN_TOKEN = /[）」』】〕]([A-Za-z0-9]{8})$/u;

/**
 * A separator a stripped token leaves dangling: 「桌鐘 Mesa - 1y9JSeGG」 →
 * 「桌鐘 Mesa -」 → 「桌鐘 Mesa」. ASCII separators need a space before them
 * (`T-` is a word); fullwidth ones do not. Trimmed only in the call that
 * stripped a token, so a name that really ends in one is never touched.
 */
const DANGLING_SEPARATOR = /(?:\s+[-–—|/]+|\s*[・｜／]+)$/u;

/** `X X`, `X X X`, … → `X`, where `X` may itself contain spaces (`T Torch T Torch`). */
const DOUBLED_NAME = /^(.+?)(?:\s+\1)+$/u;

/**
 * A single Latin word said twice is usually the name itself (`Bloom Bloom`,
 * `Bye Bye`), not a copy-paste defect. Only a repeated segment with a space,
 * a digit or a non-Latin character (`T Torch`, `啵啵杯710ml`) is collapsed.
 */
const SINGLE_LATIN_WORD = /^[A-Za-z]+$/;

/** The name without its trailing shop token, or null when it has none. */
function stripShopToken(name: string): string | null {
  const token = TRAILING_TOKEN.exec(name);
  if (token && isShopSkuToken(token[1]!)) {
    const head = name.slice(0, token.index).trim();
    return head || null;
  }
  const glued = BRACKET_THEN_TOKEN.exec(name);
  if (glued && isShopSkuToken(glued[1]!)) {
    return name.slice(0, -glued[1]!.length);
  }
  const digits = CJK_THEN_DIGIT_SKU.exec(name);
  if (digits) return name.slice(0, -digits[1]!.length);
  return null;
}

/**
 * Strips a trailing shop SKU token (alphanumeric after whitespace or glued to a
 * fullwidth closing bracket, or 8 digits after CJK text) and any separator it
 * leaves dangling, then collapses a name written twice.
 * Idempotent, and returns the input unchanged (bar trimming) when neither
 * defect is present, so it is safe on every write path.
 */
export function normalizeCuratedProductName(name: string): string {
  let normalized = name.trim();

  const head = stripShopToken(normalized);
  if (head !== null) {
    const trimmed = head.replace(DANGLING_SEPARATOR, "").trim();
    // Never empty the name: a head that is only a separator stays as it is.
    normalized = trimmed || head;
  }

  const doubled = DOUBLED_NAME.exec(normalized);
  if (doubled && !SINGLE_LATIN_WORD.test(doubled[1]!.trim())) {
    normalized = doubled[1]!.trim();
  }

  return normalized;
}

/**
 * A trailing retailer model code: segments of capitals and digits joined by
 * `-` or `_`, with at least one capital and two digits (`LA034-000-OBK`,
 * `HFMIC26-0722`, `OKEMARU_31`). Lowercase segments never match, so a real
 * phrase such as `2-in-1` or `YWC_core_001` stays; neither does a bare number
 * or year range (`2025-26`), which needs a capital.
 */
const TRAILING_MODEL_CODE =
  /\s+((?=[A-Z0-9_-]*[A-Z])(?=(?:[^0-9]*[0-9]){2})[A-Z0-9]+(?:[-_][A-Z0-9]+)+)$/u;

/** A Han, kana, or CJK/fullwidth punctuation character. */
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/u;

/**
 * Display only (DEV-1989 round 2): drops a trailing model code from a name
 * whose head is CJK text, so 「6cm超穩跟繫帶高跟鞋 LA034-000-OBK」 reads
 * 「6cm超穩跟繫帶高跟鞋」 on a tile. The stored name keeps the code — it is a
 * product fact an editor and the official listing use — so this is NOT part of
 * `normalizeCuratedProductName` and the backfill never writes it. Latin-only
 * names (the EN column) are left alone: there the code is often the name.
 * Ceiling: codes without a separator (`DKGP730`, `BAL 5642`) still render.
 */
export function stripTrailingModelCode(name: string): string {
  const match = TRAILING_MODEL_CODE.exec(name);
  if (!match) return name;
  const head = name.slice(0, match.index).trim();
  return head && CJK_CHAR.test(head) ? head : name;
}

/**
 * The name a public read renders (DEV-1989, DS2-01): the normalised name, or
 * the stored one when normalising would empty it, with a trailing model code
 * hidden. Read projections apply it at their transformer boundary so a stored
 * token name never renders, even on rows the backfill has not reached. Admin
 * edit reads must NOT use it — an editor has to see, and can fix, the value
 * that is actually stored.
 */
export function publicCuratedProductName(name: string): string {
  return stripTrailingModelCode(normalizeCuratedProductName(name) || name);
}
