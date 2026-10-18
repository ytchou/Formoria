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
 * above, or an allow-list per brand. A tail with a valid GS1 check digit is a
 * real EAN-8 barcode and is never stripped (DEV-2046): 「巧克力 47112346」.
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

/** `head` less a separator a removed token left dangling; never emptied. */
function trimDanglingSeparator(head: string): string {
  return head.replace(DANGLING_SEPARATOR, "").trim() || head;
}

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
  if (digits && !hasGs1CheckDigit(digits[1]!.trim())) {
    return name.slice(0, -digits[1]!.length);
  }
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
  // Never empty the name: a head that is only a separator stays as it is.
  if (head !== null) normalized = trimDanglingSeparator(head);

  const doubled = DOUBLED_NAME.exec(normalized);
  if (doubled && !SINGLE_LATIN_WORD.test(doubled[1]!.trim())) {
    normalized = doubled[1]!.trim();
  }

  return normalized;
}

/**
 * `normalizeCuratedProductName`, or the stored name when normalising would
 * empty it (a whitespace-only name). Shared by the public name resolver and
 * the normalize-names backfill.
 */
export function normalizedOrStoredName(name: string): string {
  return normalizeCuratedProductName(name) || name;
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
const CJK_CHAR =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/u;

/**
 * Display only (DEV-1989 round 2): drops a trailing model code from a name
 * whose head is CJK text, so 「6cm超穩跟繫帶高跟鞋 LA034-000-OBK」 reads
 * 「6cm超穩跟繫帶高跟鞋」 on a tile. The stored name keeps the code — it is a
 * product fact an editor and the official listing use — so this is NOT part of
 * `normalizeCuratedProductName` and the backfill never writes it. Latin-only
 * names (the EN column) are left alone: there the code is often the name.
 * Ceiling: codes without a separator (`DKGP730`, `BAL 5642`) still render.
 * Private: public reads reach it only through `createPublicNameResolver`
 * (DEV-2046), which keeps the code when it is all that tells two products
 * apart. A separator the code leaves dangling goes with it
 * (「鞋 ｜ LA034-000-OBK」 → 「鞋」).
 */
function stripTrailingModelCode(name: string): string {
  const match = TRAILING_MODEL_CODE.exec(name);
  if (!match) return name;
  const head = trimDanglingSeparator(name.slice(0, match.index).trim());
  return head && CJK_CHAR.test(head) ? head : name;
}

// ---------------------------------------------------------------------------
// Suffix classification (DEV-2017), moved from the census script
// ---------------------------------------------------------------------------

export type SuffixKind =
  | "url_listing_id"
  | "gtin"
  | "long_number"
  | "model_code"
  | "quantity"
  | "short_number";

export type SuffixClass = {
  kind: SuffixKind;
  token: string;
  /** The name with the token (and the space before it) removed. */
  head: string;
  /** The token is a whole segment of the row's `official_url`. */
  inUrl: boolean;
};

/** A Han, kana, or CJK/fullwidth punctuation character class body. */
const CJK_CLASS =
  "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3000-\\u303f\\uff00-\\uffef";

/** A whitespace-separated last token. */
const SPACED_TAIL = /\s+(\S+)$/u;

/** 5+ digits glued to CJK text with no space: 「肌膚急救箱3040094558316」. */
const GLUED_DIGITS = new RegExp(`(?<=[${CJK_CLASS}])(\\d{5,})$`, "u");

/** Only identifier-shaped tokens are suffixes; a trailing word is name. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * A count or measure. Units seen in shop names; deliberately short so a model
 * code such as `A5210009` never reads as a quantity.
 */
const QUANTITY =
  /^\d+(?:\.\d+)?(?:ml|mL|ML|l|L|g|kg|mg|cm|mm|m|oz|mAh|W|V|吋|寸|入|件|組|片|包|盒|支|瓶|罐|個|顆|枚|條|雙|號|色|款|cc|CC|-[Pp]ack)$/u;

/** True when `digits` carries a valid GS1 check digit (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function hasGs1CheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) {
    return false;
  }
  const body = digits.slice(0, -1);
  let sum = 0;
  // Weights run 3,1,3,… from the digit nearest the check digit.
  for (let i = 0; i < body.length; i += 1) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/**
 * True when 10 digits carry a valid ISBN-10 mod-11 check (DEV-2046). GS1
 * covers ISBN-13 only, and the display policy never hides an ISBN. A check
 * character of `X` is not a pure number, so it already classifies as a model
 * code and needs no case here.
 */
export function hasIsbn10CheckDigit(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += (10 - i) * Number(digits[i]);
  return sum % 11 === 0;
}

/**
 * The URL's path and query split on separators, decoded and lowercased, so a
 * listing ID is matched as a whole segment (`/item/3040094558316/…`,
 * `?id=123456`) and never as a substring of something longer.
 */
function urlSegments(officialUrl: string | null): Set<string> {
  if (!officialUrl) return new Set();
  let url: URL;
  try {
    url = new URL(officialUrl);
  } catch {
    return new Set();
  }
  let text = `${url.pathname}${url.search}`;
  try {
    text = decodeURIComponent(text);
  } catch {
    // A malformed escape: match against the raw text instead.
  }
  return new Set(
    text
      .toLowerCase()
      .split(/[\s/?&=#.,_\-+%]+/u)
      .filter(Boolean),
  );
}

/**
 * Pure: the trailing identifier of a product name and what it is, or null
 * when the name ends in a word. Never decides removal — it reports evidence.
 *
 *   gtin            8/12/13/14 digits with a valid GS1 check digit, or 10 with
 *                   a valid ISBN-10 check — a barcode or ISBN, kept;
 *   url_listing_id  5+ digits, no valid check digit, and a whole segment of
 *                   the row's own `official_url` — the shop's listing number;
 *   long_number     5+ digits, neither of the above — unknown, kept;
 *   model_code      letters and digits together (`DKGP730`, `LA034-000-OBK`);
 *   quantity        a number with a unit (`500ml`, `2入`) — the variant, kept;
 *   short_number    1–4 digits (`2`, `2024`) — a version, size or year, kept.
 */
export function classifyNameSuffix(
  name: string,
  officialUrl: string | null,
): SuffixClass | null {
  const trimmed = name.trim();
  const spaced = SPACED_TAIL.exec(trimmed);
  const glued = spaced ? null : GLUED_DIGITS.exec(trimmed);
  const match = spaced ?? glued;
  if (!match) return null;

  const token = match[1]!;
  const head = trimmed.slice(0, match.index).trim();
  if (!head) return null;

  if (QUANTITY.test(token))
    return { kind: "quantity", token, head, inUrl: false };
  if (!IDENTIFIER.test(token)) return null;
  // A Latin word (`Mini`, `Cream`) is name, even when the URL slug repeats it.
  if (!/\d/.test(token)) return null;

  const inUrl = urlSegments(officialUrl).has(token.toLowerCase());
  if (!/^\d+$/.test(token)) return { kind: "model_code", token, head, inUrl };
  // Before the URL test: a shop may use the barcode or ISBN as its handle
  // (`tobecraft.com/products/9784529072441`), and then it is still the
  // product's identity, not a disposable listing number.
  if (hasGs1CheckDigit(token) || hasIsbn10CheckDigit(token)) {
    return { kind: "gtin", token, head, inUrl };
  }
  if (token.length < 5) return { kind: "short_number", token, head, inUrl };
  if (inUrl) return { kind: "url_listing_id", token, head, inUrl };
  return { kind: "long_number", token, head, inUrl };
}

/**
 * Display only (DEV-2046, policy checks 1–3): drops a shop listing number the
 * product's own `official_url` already carries — 5+ digits, no GS1 or ISBN-10
 * check digit, and a whole URL segment — and any separator it leaves dangling.
 * 「肌膚急救箱 3040094558316」 reads 「肌膚急救箱」. Any other name is returned
 * unchanged. Private, like `stripTrailingModelCode`.
 */
function stripUrlListingId(name: string, officialUrl: string | null): string {
  const suffix = classifyNameSuffix(name, officialUrl);
  return suffix?.kind === "url_listing_id"
    ? trimDanglingSeparator(suffix.head)
    : name;
}

// ---------------------------------------------------------------------------
// Public display name, with the sibling guard (DEV-2046)
// ---------------------------------------------------------------------------

/**
 * The names a stored name may render as on a public read, most hidden first;
 * each is the fallback when the one before it would collide:
 *
 *   1. normalised, less ONE display-only token — a URL listing number if
 *      there is one, else a trailing model code;
 *   2. normalised (`normalizedOrStoredName`): shop token stripped, a doubled
 *      name collapsed, model codes and listing numbers kept;
 *   3. the stored name, trimmed — nothing hidden.
 *
 * Duplicates are dropped, so a name with nothing to hide has one level.
 */
function displayLevels(stored: string, officialUrl: string | null): string[] {
  const normalized = normalizedOrStoredName(stored);
  const withoutListing = stripUrlListingId(normalized, officialUrl);
  const candidate =
    withoutListing !== normalized
      ? withoutListing
      : stripTrailingModelCode(normalized);
  return [...new Set([candidate, normalized, stored.trim() || stored])];
}

/** One `curated_products` row of a brand, as the sibling guard reads it. */
export type PublicNameSibling = {
  id: string;
  brandId: string;
  nameZh: string | null;
  nameEn: string | null;
  officialUrl: string | null;
};

type PublicNameColumn = "name_zh" | "name_en";

/**
 * Resolves the name a public read renders for one column of one row. Admin
 * edit reads must NOT use it — an editor has to see, and can fix, the value
 * that is actually stored.
 */
export type PublicNameResolver = (
  row: { id: string; brandId: string; officialUrl: string | null },
  column: PublicNameColumn,
  stored: string,
) => string;

/** One name column of one sibling, while the guard settles its level. */
type NameEntry = {
  id: string;
  brandId: string;
  stored: string;
  levels: string[];
  level: number;
};

/** Ids holding each name, keyed per brand. */
class BrandNameIndex {
  private readonly ids = new Map<string, Set<string>>();

  // NUL cannot occur in a uuid or a name column, so the key cannot collide.
  private static key(brandId: string, name: string): string {
    return `${brandId}\u0000${name}`;
  }

  add(brandId: string, name: string, id: string): void {
    const key = BrandNameIndex.key(brandId, name);
    const ids = this.ids.get(key) ?? new Set<string>();
    ids.add(id);
    this.ids.set(key, ids);
  }

  /** Some row other than `id` holds `name` in `brandId`. */
  heldByOther(brandId: string, name: string, id: string): boolean {
    const ids = this.ids.get(BrandNameIndex.key(brandId, name));
    return ids !== undefined && (ids.size > 1 || !ids.has(id));
  }
}

/**
 * The read-side name guard (DEV-1989, DEV-2046). Display only: stored names
 * never change.
 *
 * Every hidden token — a shop token `normalizeCuratedProductName` strips, a
 * URL listing number, a trailing model code — is hidden only while the row's
 * name stays its own within the brand. Each name column of each sibling
 * starts at its most hidden level (`displayLevels`) and drops one level, back
 * towards its stored name, while its name equals a name some OTHER row of the
 * brand holds:
 *
 *   - that row's current rendered name, in EITHER column — English surfaces
 *     fall back to `name_zh`, so the two columns share one namespace;
 *   - that row's bare name (the normalised name less its trailing
 *     identifier) or most hidden name, whatever it settles on. The bare
 *     comparison is what keeps umu's 「非洲柚木一枚板 T0417505A14VB-1」 from
 *     collapsing onto seven slabs whose codes never hide.
 *
 * Levels only ever move towards the stored name, so this repeats until
 * nothing moves, and it settles: at the fixed point no two rows of a brand render the
 * same name unless both render their stored names and those are equal. It
 * never merges two products. The result is computed once, here.
 *
 * `siblings` should be every row of the row's brand, hidden and rejected ones
 * included: a superset of every public gate, so no surface sees a different
 * answer. A row the set lacks (or whose stored name differs from it) is
 * resolved alone against the settled names. `null` is the fail-safe for a
 * failed sibling read — every row renders its stored name, trimmed, with no
 * token hidden, so a broken guard shows codes and never merges products.
 */
export function createPublicNameResolver(
  siblings: readonly PublicNameSibling[] | null,
): PublicNameResolver {
  if (siblings === null) {
    return (_row, _column, stored) => stored.trim() || stored;
  }

  const entries = new Map<string, NameEntry>();
  const reserved = new BrandNameIndex();
  for (const sibling of siblings) {
    for (const column of ["name_zh", "name_en"] as const) {
      const stored = column === "name_zh" ? sibling.nameZh : sibling.nameEn;
      if (!stored) continue;
      const levels = displayLevels(stored, sibling.officialUrl);
      const normalized = normalizedOrStoredName(stored);
      const bare = trimDanglingSeparator(
        classifyNameSuffix(normalized, sibling.officialUrl)?.head ?? normalized,
      );
      reserved.add(sibling.brandId, bare, sibling.id);
      reserved.add(sibling.brandId, levels[0]!, sibling.id);
      entries.set(`${sibling.id}\u0000${column}`, {
        id: sibling.id,
        brandId: sibling.brandId,
        stored,
        levels,
        level: 0,
      });
    }
  }

  const nameOf = (entry: NameEntry) => entry.levels[entry.level]!;
  const renderedIndex = () => {
    const index = new BrandNameIndex();
    for (const entry of entries.values()) {
      index.add(entry.brandId, nameOf(entry), entry.id);
    }
    return index;
  };
  /** The name at `level` is taken by another row, and a fallback remains. */
  const mustDrop = (
    index: BrandNameIndex,
    brandId: string,
    id: string,
    levels: readonly string[],
    level: number,
  ) =>
    level < levels.length - 1 &&
    (index.heldByOther(brandId, levels[level]!, id) ||
      reserved.heldByOther(brandId, levels[level]!, id));

  // Each pass drops at least one entry one level, so it ends within
  // (total levels) passes.
  let rendered = renderedIndex();
  for (;;) {
    let moved = false;
    for (const entry of entries.values()) {
      const { brandId, id, levels, level } = entry;
      if (mustDrop(rendered, brandId, id, levels, level)) {
        entry.level += 1;
        moved = true;
      }
    }
    if (!moved) break;
    rendered = renderedIndex();
  }

  return (row, column, stored) => {
    const entry = entries.get(`${row.id}\u0000${column}`);
    if (entry && entry.stored === stored) return nameOf(entry);
    const levels = displayLevels(stored, row.officialUrl);
    let level = 0;
    while (mustDrop(rendered, row.brandId, row.id, levels, level)) level += 1;
    return levels[level]!;
  };
}
