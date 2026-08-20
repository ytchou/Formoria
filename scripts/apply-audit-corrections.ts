/**
 * Applies the reviewed corrections from the 2026-08 outdoor + tech content audit.
 *
 * Scope: STRUCTURED FIELDS ONLY — status, name/slug, founding_year, city,
 * category, subcategories, socials, purchase_website.
 * Long-form description rewrites are deliberately NOT in here; they are bilingual
 * editorial copy that needs its own review pass. `pnpm exec tsx … --pending` prints
 * the manifest of description edits still owed.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/apply-audit-corrections.ts
 *   pnpm exec tsx --env-file=.env.local scripts/apply-audit-corrections.ts --apply
 *   pnpm exec tsx --env-file=.env.local scripts/apply-audit-corrections.ts --pending
 *
 * `subcategories` patches are written as ONTOLOGY SLUGS, because that is what the
 * column stores since DEV-1510 and `updateBrand` copies the array through
 * verbatim. Writing zh-TW labels here un-migrates a row per `--apply` run, and
 * defeats the "already applied" check below as well: a label never equals the
 * stored slug, so the diff is never empty and every run rewrites every row.
 *
 * Provenance: every change below was verified against a primary source during the
 * 2026-08-11 review. Rows the audit got wrong (MONOCEAN's description, MXM's history,
 * PhotoFast's origin, ENABLE's ODM years, Allite's operating company, VIGHT's city)
 * are intentionally absent — see the review artifact.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { updateBrand, type BrandWriteInput } from "@/lib/services/brands";
import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { matchSubcategory, subcategoryBySlug } from "@/lib/taxonomy/ontology";

type Change = {
  ref: string;
  brand: string;
  brandId: string;
  why: string;
  patch: BrandWriteInput & Record<string, unknown>;
  /** Written to brand_slug_redirects so the old URL keeps resolving. */
  redirectFrom?: string;
  /** Redirect target. Defaults to this entry's new slug; set it when the target is another record. */
  redirectTo?: string;
  /** Set to hold an entry back; the reason is printed instead of applying it. */
  blocked?: string;
};

const CHANGES: Change[] = [
  // ---------------------------------------------------------------- hide
  {
    ref: "OD-33",
    brand: "Horizon",
    brandId: "d75f046a-4986-4d28-9330-9023a4756223",
    why: "Canadian brand — ICareU Global Trading Ltd., Delta BC. Taiwan presence is an exclusive distributor only.",
    patch: { status: "hidden" },
  },
  {
    ref: "TC-26",
    brand: "HEREAFTER STUDIO",
    brandId: "b403563b-fc24-41cf-b441-d137dc83a072",
    why: "Hong Kong brand founded 2012; no Taiwan link found on its own About page.",
    patch: { status: "hidden" },
  },
  {
    ref: "DUP-01",
    brand: "HANDMADESHIP",
    brandId: "7070b13d-2b43-46eb-9d97-5af8a3b847a2",
    why: "Hong Kong brand — handmadeshiphk.com serves <html lang='zh-HK'>, its Pinkoi designer location reads 香港, and its products are 香港霓虹招牌 / 懷舊香港 subjects. Taiwan presence is cross-border marketplace distribution only. Same eligibility rule as HEREAFTER. Surfaced by the duplicate sweep, not by the original audit — it sat in the retired 工藝 L1, which the audit never covered.",
    patch: { status: "hidden" },
  },

  // ---------------------------------- duplicate sweep (2026-08-12 round)
  // Found by matching shared websites and Instagram handles rather than names —
  // which is what the name-similarity pass and the category-scoped audit both missed.
  {
    ref: "DUP-02",
    brand: "MeowMie 喵覓",
    brandId: "93795a99-6d13-46fb-bff2-e194c459fb67",
    why: "BOTH socials belong to 翔仔居家 Siangapato, a bedding brand: the @siang.apato profile reads 「翔仔居家siang.apato」 with home-textile collabs, and the Facebook page is SIANG.APATO. MeowMie's own site (meowmie.tw) has an empty Instagram placeholder, so there is no correct handle to swap in — clearing is the only accurate move.",
    patch: { socialInstagram: null, socialFacebook: null },
  },
  {
    ref: "DUP-03",
    brand: "三十革皮藝",
    brandId: "ae9cde15-af7f-49a2-98f1-5b4dfe305149",
    why: "@3___hiiii is 山孩甜點 SUAAN — the profile's display name is literally 山孩甜點 SUAAN and its content is desserts. Facebook is already correct (facebook.com/30leather, linked from 30leather.com.tw), so only the Instagram is cleared. SUAAN keeps the handle; it is that brand's only stored link.",
    patch: { socialInstagram: null },
  },
  {
    ref: "DUP-04",
    brand: "Murou (duplicate)",
    brandId: "9c92bcf3-e2f9-4611-8485-31aa553e70fb",
    why: "Same brand filed twice — identical website and Instagram. murou.com.tw shows one unified brand, MÜROU 璽沐 (統編 60547937, New Taipei), with a single 初沐 product line. The surviving record keeps the styled name and sits in kids-pets, which fits baby hygiene better than this record's beauty.",
    patch: { status: "hidden" },
    redirectFrom: "murou-2",
    redirectTo: "murou",
  },
  {
    ref: "DUP-05",
    brand: "CY Food (duplicate)",
    brandId: "3ffba511-2844-4089-88be-761fbc1536fe",
    why: "This record's own description describes 川元食品 (the 1996 Changhua candy maker), not 群川工作室 — the separate second-generation studio whose CyberBiz shop it links. So it is a duplicate entry pointing at a sibling storefront, not a distinct brand. Its Facebook was also wrong: facebook.com/CyHopeTx is a US non-profit.",
    patch: { status: "hidden" },
    redirectFrom: "cy-food",
    redirectTo: "chuan-yuan",
  },
  {
    ref: "DUP-06",
    brand: "川元食品 Chuan Yuan",
    brandId: "a532f3e2-0c54-40c8-a1ee-f64b87cbf31f",
    why: "Keeps the CyberBiz storefront reachable after the merge, as a secondary channel rather than a lost link. Operated by 群川工作室 (統編 95314558) under the 川元食品二代 banner.",
    patch: {
      other_urls: [
        {
          label: "川元食品二代 CyberBiz 商城",
          url: "https://cyfood.cyberbiz.co",
        },
      ],
    },
  },
  // ------------------------------------------------- identity + redirects
  {
    ref: "OD-04",
    brand: "Tw → VIGHT",
    brandId: "2df5a280-9227-467d-a0ef-6cf02e9f8d71",
    why: '"Tw" was a domain-prefix extraction. Brand is VIGHT, SINCE 2014 on its global About page. city=taipei is CORRECT and left untouched (永業創意整合有限公司, 統編 52862632).',
    patch: {
      name: "VIGHT",
      slug: "vight",
      foundingYear: 2014,
      purchaseWebsite: "https://tw.vightoptics.com/",
    },
    redirectFrom: "tw",
  },
  // RAFAC was filed twice. Resolution (your call, 2026-08-11): keep the older June
  // record as canonical — it already sits in `fashion`, where both 襪子 and 機能服飾
  // resolve to live facets, whereas the August record sits in `outdoor` where 襪子
  // orphans. Each record held half the truth: June had the right category and the
  // wrong links (UK Royal Air Force Air Cadets, who share the RAFAC acronym), August
  // had the right links and a three-way merged name. Neither is deleted.
  {
    ref: "OD-01a",
    brand: "RAFAC (canonical, June record)",
    brandId: "e2134cb6-74e3-4931-a067-fb9add978092",
    why: "Repairs the Air Cadets contamination: rafac.sharepoint.com and @aircadets belong to the UK Royal Air Force Air Cadets, not the Taiwanese sock brand. Correct links come from the August duplicate, which the audit verified.",
    patch: {
      purchaseWebsite: "https://rafac.com.tw",
      socialInstagram: "https://www.instagram.com/rafacsocks/",
    },
  },
  {
    ref: "OD-01b",
    brand: "RAFAC (August duplicate)",
    brandId: "02684c78-c843-404e-89cd-77f4e01d3f23",
    why: "Retire the duplicate. Its name merged three separate entities — RAFAC, sibling brand OutdoorNation, and MOJO Camping, an unrelated live company (mojocamping.com) we were misattributing. Hidden rather than deleted so the description stays recoverable.",
    patch: { status: "hidden" },
    redirectFrom: "mojo-camping-rafac",
    redirectTo: "rafac",
  },
  {
    ref: "OD-29",
    brand: "張萬春洋傘",
    brandId: "10e42662-e3eb-419e-9feb-b01d86f864ca",
    why: "Site uses 洋傘 21 times and 陽傘 zero. Socials belonged to the Taiwan Cultural Memory Bank, harvested from a citation. Slug unchanged, so no redirect needed.",
    patch: {
      name: "張萬春洋傘",
      socialInstagram: null,
      socialFacebook: null,
      subcategories: ["outdoor-accessories"],
    },
  },

  // ------------------------------------------------------- founding years
  // Convention (decided 2026-08-11): founding_year is the BRAND launch year,
  // never the operating company's incorporation year.
  {
    ref: "OD-34",
    brand: "好手 Good Hand",
    brandId: "64a82473-7870-4982-b9ff-bbebc798dbc6",
    why: "1988 is the good.hand brand launch; 1985 was 亦展運動用品 incorporation (operations trace to 1978).",
    patch: { foundingYear: 1988 },
  },
  {
    ref: "OD-35",
    brand: "ZIV",
    brandId: "1d39c063-5220-411a-96fb-33685b9b3f60",
    why: "Brand year per the convention. NOTE: weakest source in the set — a self-published 2017 news post on ziv.com.tw, not the About page.",
    patch: { foundingYear: 2010 },
  },
  {
    ref: "OD-09",
    brand: "NIKKO HELMETS",
    brandId: "1b5d604c-9ba3-4e53-b330-20099b8a928f",
    why: "Brand founded 2011 in California. Do NOT use 1974 — that is 東億兆實業, the Taiwan operating company.",
    patch: { foundingYear: 2011 },
  },
  {
    ref: "TC-16",
    brand: "YUJ",
    brandId: "1f482cc1-99cf-47c4-ae87-fef649c87bd0",
    why: "GCIS registry gives 設立日期 1986-09-26 (統編 22277944). The stored 1979 had no source; the audit wanted NULL.",
    patch: { foundingYear: 1986 },
  },
  {
    ref: "TC-19",
    brand: "Sweet House 松尼",
    brandId: "79b9bd21-e769-4e60-84c0-6a54a4e96f90",
    why: "Facebook page created 2014-12-05 per the official store history; 松尼創意國際 incorporated 2017.",
    patch: { foundingYear: 2014 },
  },

  // ---------------------------------------------------------------- city
  {
    ref: "OD-08",
    brand: "Love Mountain",
    brandId: "539d950b-e38a-49f2-aa1d-b2cc552f4da4",
    why: "樂登峰科技有限公司 registered at 桃園市蘆竹區, established Oct 2023.",
    patch: { city: "taoyuan" },
  },
  {
    ref: "OD-22",
    brand: "Taiwan Wader 台興",
    brandId: "15f71688-d68f-419c-856d-fab2ac7a3940",
    why: "Official address 20845 新北市金山區中山路443之3號.",
    patch: { city: "new_taipei" },
  },
  {
    ref: "TC-14",
    brand: "SpotCam",
    brandId: "85a43352-88b9-4030-8076-535ee92d9f8b",
    why: "HQ is 235 新北市 (Xizhi), not Taipei.",
    patch: { city: "new_taipei" },
  },
  {
    ref: "TC-18",
    brand: "HIPPORIZZ 河馬引力",
    brandId: "c52946bd-2020-4e8b-96a3-cba00632a2b6",
    why: "The only Taipei address belongs to MACLOVE, the general agent. No company address is published anywhere on the site.",
    patch: { city: null },
  },

  // -------------------------------------------------------- category
  {
    ref: "TC-27",
    brand: "MXM",
    brandId: "8760c48e-6c10-476b-9042-894f6c1e846c",
    why: "Professional hand tools, not consumer electronics. Also takes MXM from 0 live facets to 1 — 手工具 is registered under home.",
    patch: { categorySlug: "home" },
  },
  {
    ref: "TC-01",
    brand: "YUJ",
    brandId: "1f482cc1-99cf-47c4-ae87-fef649c87bd0",
    why: "Catalogue is fans, dish dryers, mosquito traps, baby and kitchen goods. 生活家電 is the ontology-valid home tag; the stored 螺絲/螺帽/螺栓 exist in no category.",
    patch: { categorySlug: "home", subcategories: ["home-appliances"] },
  },
  {
    ref: "OD-36",
    brand: "Arsenal Tool Inc. 愛森諾工具",
    brandId: "57571a79-fec9-489a-b0a7-ea364306981f",
    why: "Scissors, drivers, sockets, torque wrenches — hand tools, not outdoor gear. 手工具 goes live under home.",
    patch: { categorySlug: "home" },
  },
  {
    ref: "TC-19b",
    brand: "Sweet House 松尼",
    brandId: "79b9bd21-e769-4e60-84c0-6a54a4e96f90",
    why: "Plush, calendars, 春聯, homeware. No tag change — the ontology has no character-goods entry, so this brand lands on 0 live facets until it grows. `stationery` is the hand assignment DEV-1507 froze for character-IP goods brands, the same class as nagi-nagi and jmofinger.",
    patch: { categorySlug: "stationery" },
  },
  {
    ref: "TC-20",
    brand: "兔君 Bonnie Lu",
    brandId: "d1485433-c519-4f95-a18f-613c930f37aa",
    why: "Character IP licensed onto CASETiFY, not a tech brand. purchase_website moves off bonnielu.com, which is a portfolio site rather than a shop. DEV-1507 retired the 工藝 L1: 插畫・畫作 became `home/wall-art`, and the D3 tiebreak (craft node beats a tied use-axis vote) lands this brand on `home`.",
    patch: {
      categorySlug: "home",
      subcategories: ["phone-cases", "wall-art"],
      purchaseWebsite: "https://www.casetify.com/artist/bonnielu",
    },
  },
  {
    ref: "TC-22",
    brand: "橘皮 oranpeel",
    brandId: "84ff072a-30a5-4700-9e4b-640dbc36c8a7",
    why: "Illustration and character IP; 3C accessories are one licensed line among many. Same DEV-1507 re-file as 兔君 — 插畫・畫作 is now `home/wall-art` and decides the tie against 手機殼.",
    patch: { categorySlug: "home", subcategories: ["phone-cases", "wall-art"] },
  },
  {
    ref: "TC-24",
    brand: "毛絨絨星人 fluffystar",
    brandId: "a233c361-5d7a-4518-99bd-66bc6933ea95",
    why: "Original character brand with CASETiFY, apparel and jewellery collabs. DEV-1507 re-file: tech and bags-accessories tie 2-2 on the use axis, so the one craft node (插畫・畫作, now `home/wall-art`) decides.",
    patch: {
      categorySlug: "home",
      subcategories: [
        "phone-cases",
        "stands-and-mounts",
        "card-holders",
        "eco-and-shopping-bags",
        "brooches",
        "wall-art",
      ],
    },
  },

  // -------------------------------------------------------- subcategories
  {
    ref: "OD-18",
    brand: "Gallop Kustom Kulture",
    brandId: "35b24101-b8af-4e6f-9e3b-9ffd273bd8a1",
    why: "Apparel is unsupported on the Pinkoi store (rider face masks do exist, but those are accessories). Facebook was MOONEYES樂多 Kaohsiung, cleared per your call.",
    patch: {
      subcategories: ["helmets", "outdoor-accessories"],
      socialFacebook: null,
    },
  },
  {
    ref: "OD-23",
    brand: "Taiwan Wader 台興",
    brandId: "15f71688-d68f-419c-856d-fab2ac7a3940",
    why: "Neither pet clothing nor wetsuits. Waders keep you dry (PVC/mesh); wetsuits keep you warm while wet. 雨靴 is now registered as an alias of `boots` (fashion), so the tag it used to carry unregistered resolves to a live slug.",
    patch: { subcategories: ["boots"] },
  },
  {
    ref: "OD-24",
    brand: "ZIV",
    brandId: "1d39c063-5220-411a-96fb-33685b9b3f60",
    why: "No wetsuits and no water-sports equipment — only a 水上運動款 sunglasses sub-line.",
    patch: { subcategories: ["eyewear", "outdoor-accessories"] },
  },
  {
    ref: "OD-25",
    brand: "衣力美 EasyMain",
    brandId: "03bb5608-bfe9-4d92-b561-ac99b6fe64f8",
    why: "Mountaineering apparel and sun-protection layers; no water-sports products of any kind.",
    patch: { subcategories: ["performance-apparel", "outdoor-accessories"] },
  },
  {
    ref: "TC-17",
    brand: "PhotoFast 銀箭",
    brandId: "f498ec88-8b5a-49e0-b7aa-947b31b736c3",
    why: "Current categories are backup/storage, power/charging and gaming accessories. Phone cases are no longer a product line.",
    patch: { subcategories: ["chargers-and-cables", "power-banks", "storage-devices"] },
  },

  {
    ref: "TC-29",
    brand: "SpotCam",
    brandId: "85a43352-88b9-4030-8076-535ee92d9f8b",
    why: "Drops 手機應用程式 — a mobile app is a feature of the product, not a product category, so registering it in the ontology would create a facet nobody browses by. 攝影機 and 智慧門鈴 were registered under tech on 2026-08-12 and now render as live facets.",
    patch: { subcategories: ["security-cameras", "smart-doorbells"] },
  },

  // ---------------------------------------------------- retail + channels
  {
    ref: "TC-02",
    brand: "Allite",
    brandId: "60c7b391-827d-4c77-91b0-101744333478",
    why: "ALLITE Inc. (Miamisburg, OH) is a magnesium-alloy materials firm — identity collision. OneMore is the real brand site. 萬摩科技 is REAL (統編 50930640) and stays in the description.",
    patch: {
      purchaseWebsite: "https://www.onemore.me/",
    },
  },
];

/** Description edits still owed. Bilingual editorial copy — separate review pass. */
const PENDING_DESCRIPTION_EDITS = [
  [
    "OD-01a",
    "RAFAC (canonical)",
    "The surviving June record's description claims the name comes from Amis (阿美族語) meaning 徜徉自然、自由自在 — UNVERIFIED, and that record was contaminated with UK Air Cadets data, so treat its copy with suspicion. It also lacks the OutdoorNation blanket collaboration, which IS verified. Rewrite from the August duplicate's description plus rafac.com.tw.",
  ],
  [
    "OD-11/12",
    "MONOCEAN",
    "KEEP the description — strike only the ocean-microplastics sentence. Add pre-launch status. Do NOT blank it.",
  ],
  [
    "OD-28",
    "MOLA 摩拉",
    'Remove "全系列一年保固" — the warranty page excludes clip-on, Vernon sports, Speed, safety eyewear and kids 0–4.',
  ],
  [
    "OD-16",
    "PNGL 穿山甲",
    'Rescope "100% made in Taiwan" to LIGHTZIP only. Fix LIGHTZIP capacity 18–32L → 27–32L.',
  ],
  [
    "OD-30",
    "張萬春洋傘",
    'Remove the "also supplies China-made umbrellas" sentence — unsupported on mana.tw and against its own MIT positioning.',
  ],
  [
    "OD-10",
    "NIKKO HELMETS",
    "Rewrite origin: founded 2011 California, brought to Taiwan 2016 by 東億兆 (est. 1974). Remove the blanket Tainan-manufacturing implication — production is China + India.",
  ],
  [
    "OD-08",
    "Love Mountain",
    "Replace the survival-bracelet description entirely — the brand makes high-top hiking boots.",
  ],
  [
    "OD-21",
    "嘉雲製傘 Jiayun",
    "Description must say 2011 = factory, 2016 = brand (1987 = 合懋傘業 frame plant).",
  ],
  [
    "OD-15",
    "ACEKA",
    "Rescope the MIT claim to per-product labelling rather than weakening it — every sampled line carries MIT台灣設計製造.",
  ],
  [
    "OD-31",
    "Arsenal Tool",
    "Frame 50M scissors as accumulated manufacturing experience, not sales.",
  ],
  ["OD-27", "MOLA 摩拉", "Remove blanket 28g/TR90 specs — both are per-model."],
  [
    "OD-19",
    "Gallop",
    'Remove apparel; remove the "one shell covers S/M/L/XL" generalization.',
  ],
  [
    "OD-26",
    "衣力美 EasyMain",
    'Drop the unsourced "Japanese sun-protection fabric" line. Polartec IS on the site and stays.',
  ],
  [
    "TC-01",
    "YUJ",
    "Full description replace — home appliances, not precision fasteners.",
  ],
  [
    "TC-13",
    "ENABLE",
    "Delete the ISO 9001 claim (your call) and the Just Mobile OEM claim. KEEP the 25-year ODM history — it is sourced. Rescope Taiwan-made to power banks.",
  ],
  [
    "TC-06",
    "MXM",
    "Reword the handle patent: ZL200830251615.7 is a 三階段 (three-stage) handle, not 三曲線. KEEP the 60-year and SVCM+ claims — both sourced.",
  ],
  [
    "TC-14",
    "SpotCam",
    'Rewrite the cloud claim: the global page still says "AWS or GCP"; Taiwan users are on GCP 彰濱. Note that not all models are Taiwan-made.',
  ],
  [
    "TC-15",
    "Overdigi",
    "Replace 倫敦時裝週 with the precise fact: 台北時裝週 runway via the oqLiq collaboration, 2024 SS.",
  ],
  [
    "TC-07",
    "PhotoFast",
    "KEEP the online photo-printing origin — it is true and sourced. No edit needed.",
  ],
  [
    "TC-23",
    "橘皮 oranpeel",
    "Strip per-image visual detail. Note 〈橘皮與頭套朋友們〉 has run in 國語日報 since 2018 — the brand predates the 2025 薯條 phase.",
  ],
  [
    "TC-12",
    "fluffystar",
    "Delete the 定格動畫 / 一幀一畫 claim. KEEP the Taiwan origin — first-party: 由台灣創作者-毛歐.",
  ],
  [
    "TC-20",
    "兔君 Bonnie Lu",
    'Remove the "started 2025" claim — 2023-01-18 Nova coverage predates it.',
  ],
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Key-order-independent serialization for equality checks. Postgres returns jsonb
 * object keys in its own order, which will not match the order a patch literal
 * declares them in — comparing raw JSON.stringify output reports a phantom diff
 * and makes the script rewrite identical data on every run.
 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** camelCase patch key → the brands column it writes. */
function columnFor(key: string): string {
  if (key.includes("_")) return key;
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function format(v: unknown): string {
  if (v === null) return "NULL";
  if (v === undefined) return "—";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return v.some(isPlainObject)
      ? JSON.stringify(v)
      : `[${(v as unknown[]).join(", ")}]`;
  }
  if (isPlainObject(v)) return JSON.stringify(v);
  return String(v);
}

function printPendingEdits(): void {
  console.log("\nDescription edits still owed (not handled by this script)\n");
  for (const [ref, brand, note] of PENDING_DESCRIPTION_EDITS) {
    console.log(`  ${ref.padEnd(9)} ${brand}`);
    console.log(`  ${" ".repeat(9)} ${note}\n`);
  }
  console.log(
    `  ${PENDING_DESCRIPTION_EDITS.length} description edits pending.\n`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--pending")) {
    printPendingEdits();
    return;
  }

  const apply = args.includes("--apply");
  const supabase = createServiceClient();

  const ids = [...new Set(CHANGES.map((c) => c.brandId))];
  const { data: rows, error } = await supabase
    .from("brands")
    .select(
      // Every column any patch touches must be selected — a missing one reads as
      // undefined, so the diff never matches and the script rewrites it forever.
      "id, name, slug, status, category, founding_year, city, subcategories, social_instagram, social_facebook, purchase_website, other_urls",
    )
    .in("id", ids);

  if (error) throw error;

  const current = new Map(
    (rows ?? []).map((r) => [r.id as string, r as Record<string, unknown>]),
  );

  const missing = ids.filter((id) => !current.has(id));
  if (missing.length > 0) {
    throw new Error(`Brand ids not found: ${missing.join(", ")}`);
  }

  console.log(
    apply
      ? "\nAPPLYING audit corrections\n"
      : "\nDRY RUN — nothing will be written. Re-run with --apply to commit.\n",
  );

  let changedFields = 0;
  let noopFields = 0;
  const touchedSlugs = new Set<string>();
  const tagWarnings: string[] = [];
  const blockedEntries: string[] = [];

  for (const change of CHANGES) {
    const before = current.get(change.brandId)!;
    const diffs: string[] = [];

    for (const [key, next] of Object.entries(change.patch)) {
      const col = columnFor(key);
      const prev = before[col];
      const same = canonical(prev) === canonical(next);
      if (same) {
        noopFields += 1;
        continue;
      }
      changedFields += 1;
      diffs.push(`      ${col}: ${format(prev)}  →  ${format(next)}`);
    }

    // Surface tags that will render as invisible labels under the target category.
    const nextTags = change.patch.subcategories as string[] | undefined;
    const nextType =
      (change.patch.categorySlug as string | undefined) ??
      (before.category as string);
    if (nextTags) {
      const dead = nextTags.filter(
        // Slug-first, matching the column the patches now carry. Name-keyed
        // lookup alone reports every multi-word slug as a dead facet.
        (t) =>
          (subcategoryBySlug(t) ?? matchSubcategory(t))?.category !== nextType,
      );
      const live = nextTags.length - dead.length;
      if (dead.length > 0) {
        tagWarnings.push(
          `${change.brand}: ${live} live facet(s); no facet for ${dead.join(", ")} under "${nextType}"`,
        );
      }
    }

    if (change.blocked) {
      blockedEntries.push(`${change.ref} ${change.brand}`);
      console.log(
        `  ${change.ref.padEnd(8)} ${change.brand} — BLOCKED, not applied`,
      );
      console.log(`      ${change.blocked}\n`);
      continue;
    }

    if (diffs.length === 0) {
      console.log(
        `  ${change.ref.padEnd(8)} ${change.brand} — already applied, skipping`,
      );
      continue;
    }

    console.log(`  ${change.ref.padEnd(8)} ${change.brand}`);
    console.log(`      why: ${change.why}`);
    console.log(diffs.join("\n"));
    const redirectTarget = change.redirectTo ?? (change.patch.slug as string);
    if (change.redirectFrom) {
      console.log(
        `      redirect: /brands/${change.redirectFrom}  →  /brands/${redirectTarget}`,
      );
    }
    console.log();

    touchedSlugs.add(before.slug as string);
    if (typeof change.patch.slug === "string")
      touchedSlugs.add(change.patch.slug);
    if (change.redirectFrom && redirectTarget) touchedSlugs.add(redirectTarget);

    if (apply) {
      await updateBrand(change.brandId, change.patch, { source: "admin" });

      if (change.redirectFrom) {
        const { error: redirectError } = await supabase
          .from("brand_slug_redirects")
          .upsert(
            { old_slug: change.redirectFrom, new_slug: redirectTarget },
            { onConflict: "old_slug" },
          );
        if (redirectError) throw redirectError;
      }

      // Keep the in-memory snapshot current so a second --apply is a clean no-op.
      for (const [key, next] of Object.entries(change.patch)) {
        before[columnFor(key)] = next as never;
      }
    }
  }

  if (tagWarnings.length > 0) {
    console.log(
      "Tag coverage warnings (expected — ontology gaps, not script errors):",
    );
    for (const w of tagWarnings) console.log(`  • ${w}`);
    console.log();
  }

  if (blockedEntries.length > 0) {
    console.log(
      `BLOCKED, needs a human decision: ${blockedEntries.join("; ")}\n`,
    );
  }

  console.log(
    `${changedFields} field change(s) across ${CHANGES.length} entries; ` +
      `${noopFields} already matched; ${blockedEntries.length} blocked.`,
  );

  if (!apply) {
    console.log("\nDry run complete. Re-run with --apply to commit.");
    printPendingEdits();
    return;
  }

  const result = await requestPublicBrandRevalidation([...touchedSlugs]);
  console.log(
    `Revalidation: ${result.ok ? "ok" : "FAILED"}${result.reason ? ` (${result.reason})` : ""}`,
  );
  console.log(
    "\nApplied. Description edits are still outstanding — run with --pending.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
