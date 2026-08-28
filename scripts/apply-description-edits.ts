/**
 * Applies the reviewed DESCRIPTION edits from the 2026-08 content audit —
 * the companion to apply-audit-corrections.ts, which handled structured fields.
 *
 * Batch 1 (EDITS): SURGICAL find/replace against text that exists in the database
 * today, so each change is auditable against its source string rather than being an
 * opaque wholesale overwrite.
 *
 * Batch 2 (BATCH_2): records whose text described the wrong entity and could not be
 * salvaged clause by clause — YUJ, Love Mountain, NIKKO, 嘉雲, RAFAC. These use
 * whole-field `sets`, each protected by a `guard` substring proving the stored record
 * is still the one that was reviewed. MONOCEAN rides in batch 2 but stays surgical:
 * its description was worth keeping, contrary to the audit.
 *
 * A find string that is missing is reported, never silently skipped:
 *   - replacement already present  -> ALREADY APPLIED (safe, idempotent re-run)
 *   - neither present             -> DRIFT (someone edited the text; needs a look)
 *
 * Dry run by default. Nothing is written without --apply.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/apply-description-edits.ts
 *   pnpm exec tsx --env-file=.env.local scripts/apply-description-edits.ts --apply
 *
 * Deliberately NOT edited, because the audit was wrong about them:
 *   PhotoFast  — the online photo-printing origin is true and sourced, keep it
 *   MXM        — 近六十年 and SVCM＋ are both sourced; only the handle wording is off
 *   ENABLE     — the 25-year ODM history is sourced; only ISO 9001 and Just Mobile go
 *   MONOCEAN   — description stays; only the microplastics sentence is struck (batch 2)
 */
import { createServiceClient } from "@/lib/supabase/service";
import { updateBrand } from "@/lib/services/brands";
import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";

type Field = "description" | "description_en" | "blurb" | "blurb_en";

type Op = { field: Field; find: string; replace: string };

type Edit = {
  ref: string;
  brand: string;
  slug: string;
  why: string;
  /** Surgical find/replace. Preferred — the change is auditable against source text. */
  ops?: Op[];
  /**
   * Whole-field replacement, for records whose text is about the wrong entity and
   * cannot be salvaged clause by clause. Requires `guard`.
   */
  sets?: Partial<Record<Field, string>>;
  /**
   * Proof the stored record is still the one that was reviewed. A wholesale
   * overwrite runs only if this substring is present; otherwise the text has
   * changed underneath us and the edit is held back.
   */
  guard?: { field: Field; contains: string };
};

const EDITS: Edit[] = [
  {
    ref: "OD-28",
    brand: "MOLA 摩拉",
    slug: "mola",
    why: "The whole-range warranty claim is false — /pages/warranty excludes five named series. The blurbs also generalize TR90 to the brand, though the description already scopes it to 部分款式.",
    ops: [
      {
        field: "description",
        find: "，品牌全系列提供一年保固。",
        replace:
          "。多款商品標示一年保固，但夾片、Vernon 運動、Speed 與安全眼鏡系列不在保固範圍。",
      },
      {
        field: "description_en",
        find: " MOLA provides a one-year warranty across its collection.",
        replace:
          " Many MOLA products carry a one-year warranty, though the clip-on, Vernon sports, Speed, and safety-eyewear lines are excluded.",
      },
      {
        field: "blurb",
        find: "，結合輕量 TR90 鏡框與戶外防護設計",
        replace: "，並針對亞洲臉型調整鏡框與戶外防護設計",
      },
      {
        field: "blurb_en",
        find: ", using lightweight TR90 frames",
        replace: ", with frames adjusted for Asian facial shapes",
      },
    ],
  },
  {
    ref: "OD-30",
    brand: "張萬春洋傘",
    slug: "zhang-wan-chun-umbrella",
    why: "The China-sourcing clause is unsupported on mana.tw and sits against the site's own 「MIT不惜趕走客」 positioning. The blurb also still carries the old 陽傘 spelling.",
    ops: [
      {
        field: "description",
        find: "部分產品保留臺灣製傘工藝，亦供應中國製傘款，並提供修傘服務。",
        replace: "部分產品保留臺灣製傘工藝，並提供修傘服務。",
      },
      {
        field: "description_en",
        find: ", alongside umbrellas made in China,",
        replace: ",",
      },
      { field: "blurb", find: "張萬春陽傘", replace: "張萬春洋傘" },
    ],
  },
  {
    ref: "TC-13",
    brand: "ENABLE",
    slug: "enable",
    why: "ISO 9001 deleted per your call (unverifiable either way). Just Mobile deleted — genuinely absent, and that brand's maker was 唯光科技. Taiwan-made rescoped to power banks: the homepage title says 行動電源 100% 台灣製造 while desk accessories list China as origin. The 25-year ODM history STAYS — it is sourced to the company profile.",
    ops: [
      {
        field: "description",
        find: "品牌主張台灣設計、台灣生產與台灣製造，產品依規格透過ＢＳＭＩ等安全認證，並以國際標準化品質管理系統作為製造管理基礎。",
        replace:
          "品牌行動電源明確標示台灣製造，產品依規格透過ＢＳＭＩ等安全認證。",
      },
      {
        field: "description",
        find: "除自有產品外，團隊也曾為 Just Mobile 等品牌提供代工服務，累積行動電源與充電周邊的開發經驗。",
        replace: "除自有品牌外，團隊也持續承接充電周邊的代工開發。",
      },
      {
        field: "description_en",
        find: "The brand presents its products as designed, produced, and manufactured in Taiwan, with product lines meeting safety requirements such as BSMI certification and production managed under ISO 9001.",
        replace:
          "Its power banks are explicitly labelled as made in Taiwan, with product lines meeting safety requirements such as BSMI certification.",
      },
      {
        field: "description_en",
        find: "ENABLE also provides manufacturing services for brands including Just Mobile, extending its experience from contract development into its own consumer electronics range.",
        replace:
          "ENABLE also continues to take on contract development for charging accessories alongside its own consumer electronics range.",
      },
      {
        field: "blurb",
        find: "開發台灣設計製造的行動電源、充電器與桌面配件",
        replace: "開發行動電源、充電器與桌面配件，部分行動電源標示台灣製造",
      },
      {
        field: "blurb_en",
        find: "into Taiwan-made power banks, chargers, and desktop accessories",
        replace:
          "into power banks, chargers, and desktop accessories, with selected power banks made in Taiwan",
      },
    ],
  },
  {
    ref: "TC-06",
    brand: "MXM",
    slug: "mxm",
    why: "The patent is real (ZL200830251615.7) but it is a 三階段 three-stage handle, not 三曲線. Wording fix only — the 60-year history and SVCM＋ claims are both sourced and stay.",
    ops: [
      {
        field: "description",
        find: "MXM 的獨家專利手柄從手部三種核心曲線出發，使握持更貼合、施力更均勻",
        replace:
          "MXM 的專利手柄（專利號 ZL200830251615.7）採三階段結構，使握持更貼合、施力更均勻",
      },
      {
        field: "description_en",
        find: "MXM’s patented handle design follows three core curves of the hand to create a closer grip",
        replace:
          "MXM’s patented handle (ZL200830251615.7) uses a three-stage structure to create a closer grip",
      },
      {
        field: "blurb",
        find: "到三曲線專利手柄",
        replace: "到三階段專利手柄",
      },
      {
        field: "blurb_en",
        find: "a patented three-curve handle",
        replace: "a patented three-stage handle",
      },
    ],
  },
  {
    ref: "TC-14",
    brand: "SpotCam",
    slug: "spotcam",
    why: "AWS is stale rather than hallucinated — the global page still says 'AWS or GCP', but Taiwan users' data sits on GCP 彰濱. Manufacturing needs the nuance the official FAQ states: not all models are Taiwan-made.",
    ops: [
      {
        field: "description",
        find: "各型號支援雲端錄影，資料儲存於亞馬遜 AWS 雲端主機，",
        replace: "各型號支援雲端錄影，台灣用戶影像存放於台灣在地資料中心，",
      },
      {
        field: "description",
        find: "品牌由具備影像監控產業經驗的團隊創立，並強調台灣製造。",
        replace:
          "品牌由具備影像監控產業經驗的台灣團隊創立，軟體、韌體與雲端服務均由台灣團隊開發；官方並說明部分機種於台灣製造，並非全系列。",
      },
      {
        field: "description_en",
        find: "Cameras support cloud recording through Amazon Web Services, with event recording",
        replace:
          "Cameras support cloud recording, with Taiwan users’ footage held in Taiwan-local data centres, alongside event recording",
      },
      {
        field: "description_en",
        find: "SpotCam was founded by specialists with experience in the video-surveillance industry and highlights Taiwan manufacturing.",
        replace:
          "SpotCam was founded by specialists with experience in the video-surveillance industry. Its software, firmware, and cloud services are developed by its Taiwan team, and the company states that selected — not all — camera models are made in Taiwan.",
      },
    ],
  },
  {
    ref: "TC-15",
    brand: "Overdigi",
    slug: "overdigi",
    why: "The runway appearance was 台北時裝週 with designer oqLiq (2024 SS). London appears on the official news page only as generic industry context.",
    ops: [
      {
        field: "description",
        find: "，並曾登上倫敦時裝週。",
        replace:
          "。產品並曾透過與 oqLiq 的聯名，出現在台北時裝週的伸展台（2024 春夏）。",
      },
      {
        field: "description_en",
        find: "; it has also appeared at London Fashion Week.",
        replace:
          ". Its products have also appeared on the Taipei Fashion Week runway through a collaboration with the label oqLiq (2024 SS).",
      },
    ],
  },
  {
    ref: "OD-16",
    brand: "PNGL 穿山甲",
    slug: "pngl",
    why: "LIGHTZIP is currently listed at 27–32L, and no 18L figure exists anywhere on the site. The 100% Taiwan claim lives on the LIGHTZIP product page only — the About page makes no manufacturing claim, so the brand-wide phrasing has to go.",
    ops: [
      {
        field: "description",
        find: "容量可由18公升擴充至32公升",
        replace: "容量為27至32公升的彈性設計",
      },
      {
        field: "description",
        find: "並以台灣設計、台灣布料與台灣生產作為品牌識別。",
        replace: "LIGHTZIP 從織布、染布到成品組裝與維修均在台灣完成。",
      },
      {
        field: "description_en",
        find: "expanding from 18 to 32 liters for day hikes",
        replace: "offering 27 to 32 liters of flexible capacity for day hikes",
      },
      {
        field: "description_en",
        find: "connects durability, comfort, and practical improvements with Taiwanese design, materials, and manufacturing.",
        replace:
          "connects durability, comfort, and practical improvements, with the LIGHTZIP produced entirely in Taiwan — from weaving and dyeing through assembly and repair.",
      },
      {
        field: "blurb",
        find: "容量可由18公升擴充至32公升",
        replace: "容量為27至32公升",
      },
    ],
  },
  {
    ref: "OD-15",
    brand: "ACEKA",
    slug: "aceka",
    why: "Rescoped rather than weakened. The About page carries no MIT claim, but every product line sampled (TRENDY, MODERN, T-Rex) labels the item MIT台灣設計製造 — so per-product labelling is the accurate framing.",
    ops: [
      {
        field: "description",
        find: "品牌資料亦標示全系列在台灣設計製造。",
        replace: "官方商品頁並逐款標示「MIT台灣設計製造」。",
      },
      {
        field: "description_en",
        find: "Brand materials identify the collection as designed and manufactured in Taiwan.",
        replace:
          "Individual product pages label items as MIT — designed and manufactured in Taiwan.",
      },
    ],
  },
  {
    ref: "OD-31",
    brand: "Arsenal Tool Inc. 愛森諾工具",
    slug: "arsenal-tool-inc",
    why: "The figure appears on product pages as 製作超過5000萬把剪刀經驗 — accumulated manufacturing experience, not a company sales record.",
    ops: [
      {
        field: "description",
        find: "曾製造超過五千萬把剪刀，",
        replace: "累積超過五千萬把剪刀的製作經驗，",
      },
      {
        field: "description_en",
        find: "with a production record of over 50 million scissors",
        replace:
          "with accumulated manufacturing experience of over 50 million scissors",
      },
    ],
  },
  {
    ref: "OD-19",
    brand: "Gallop Kustom Kulture",
    slug: "gallop-kustom-kulture",
    why: "Apparel is unsupported on the Pinkoi store, and sizing differs per model — a single shell cannot span half-shell, 3/4 and full-face lines. CNS certification and Taiwan manufacture are both verified on the product listings.",
    ops: [
      {
        field: "description",
        find: "Gallop Kustom Kulture 開發安全帽、服飾及騎乘配件，並以台灣製造為生產特色。品牌的通用帽殼採一頂帽殼對應四種尺寸，透過更換內襯調整為小、中、大、特大尺寸，維持帽體比例；耳襯可依四種尺寸快速更換，頂襯則分為小中尺寸共用與大特大尺寸共用。內襯可拆卸清洗，設計同時處理佩戴舒適度、外觀比例與騎乘安全需求。",
        replace:
          "Gallop Kustom Kulture 開發復古安全帽與騎乘配件，官方商品頁標示多款為台灣製造並符合 CNS 安全規範。部分帽款透過更換內襯調整尺寸，內襯可拆卸清洗，兼顧佩戴舒適度與帽體比例。",
      },
      {
        field: "description_en",
        find: "Its range includes helmets, riding apparel, and motorcycle accessories, with production identified as Made in Taiwan. The signature “One Shell, Multiple Sizes” system uses one helmet shell for S, M, L, and XL sizing through interchangeable liners. Ear liners are available in all four sizes, while the crown liner is shared by S/M and L/XL. Removable, washable liners support everyday maintenance while preserving the helmet’s proportions.",
        replace:
          "Its range centres on retro helmets and riding accessories, with multiple models labelled Made in Taiwan and certified to CNS safety standards. Selected helmets are sized through interchangeable liners, which are removable and washable for everyday maintenance while preserving the helmet’s proportions.",
      },
      {
        field: "blurb",
        find: "以台灣製造打造一頂帽殼、四種尺寸的安全帽，並延伸至服飾與騎乘配件",
        replace: "以台灣製造打造符合 CNS 規範的復古安全帽，並延伸至騎乘配件",
      },
      {
        field: "blurb_en",
        find: "and a Taiwan-made one-shell, four-size liner system",
        replace: "with Taiwan-made models certified to CNS safety standards",
      },
    ],
  },
  {
    ref: "OD-26",
    brand: "衣力美 EasyMain",
    slug: "easymain",
    why: "The Japanese sun-protection fabric is unsourced — the sun-protection line is presented on the site as the brand's own development. Polartec STAYS: it is named explicitly on both the about and history pages, with variants and a 2008 Polartec design award.",
    ops: [
      {
        field: "description",
        find: "布料運用美國製保暖機能布、品牌自研的循環乾爽系列，以及日本製防曬布料；",
        replace: "布料運用美國製 Polartec 保暖機能布與品牌自研的循環乾爽系列；",
      },
    ],
  },
  {
    ref: "TC-12",
    brand: "毛絨絨星人 fluffystar",
    slug: "fluffystar",
    why: "The stop-motion / frame-by-frame technique is genuinely absent from the creator's own pages, which say 短動畫. Animated is not the same as stop-motion. Taiwan origin STAYS — first-party: 由台灣創作者-毛歐.",
    ops: [
      {
        field: "description",
        find: "品牌以療癒系動態插畫和定格動畫描繪兩隻貓咪在「毛絨絨宇宙」中的互動，透過一幀一畫的創作呈現細膩表情與陪伴感。",
        replace:
          "品牌以療癒系動態插畫描繪兩隻貓咪在「毛絨絨宇宙」中的互動，呈現細膩表情與陪伴感。",
      },
      {
        field: "description_en",
        find: "The brand builds a fluffy universe through soothing animated illustrations and stop-motion work, using frame-by-frame creation to show the cats’ expressions and quiet companionship.",
        replace:
          "The brand builds a fluffy universe through soothing animated illustrations that show the cats’ expressions and quiet companionship.",
      },
      {
        field: "blurb",
        find: "以定格動畫描繪情侶日常與生活心聲",
        replace: "以動態插畫描繪情侶日常與生活心聲",
      },
      {
        field: "blurb_en",
        find: "a soothing illustrated universe of stop-motion stories",
        replace: "a soothing illustrated universe of animated stories",
      },
    ],
  },
  {
    ref: "TC-23",
    brand: "橘皮 oranpeel",
    slug: "oranpeel",
    why: "Per-image detail (leaf scenes, case colours, a caption read off a picture) is not a durable brand fact. Replaced with the verified merchandise range from the Illustration Taipei exhibitor profile. ALSO fixes a translation bug the audit never saw: 薯條 (fries) was rendered as “Frieze”, an architectural term.",
    ops: [
      {
        field: "description",
        find: "品牌內容涵蓋圖文、插畫、梗圖與周邊商品，代表圖像包括躺在葉片場景中的棕色狗狗、臘腸狗搭配「CAUTION DACHSHUND IN AREA」字樣，以及透明、淺綠、米色與深海軍藍色手機殼等設計。其創作以短腿狗狗的表情、姿勢和生活片段為視覺核心，將毛孩角色延伸至手機殼與其他手機周邊。",
        replace:
          "品牌內容涵蓋圖文、插畫、梗圖與周邊商品，並延伸至印刷品、手作公仔、3C 配件、服飾、飾品與寵物用品。其創作以短腿狗狗的表情、姿勢和生活片段為視覺核心。",
      },
      {
        field: "description_en",
        find: "dachshund Frieze. The stories focus on Frieze’s weary gaze",
        replace:
          "dachshund Shutiao (薯條). The stories focus on Shutiao’s weary gaze",
      },
      {
        field: "description_en",
        find: "Its product imagery includes a brown dog resting among leaves, a dachshund paired with the phrase “CAUTION DACHSHUND IN AREA,” and phone cases in transparent, pale green, beige, and deep navy finishes. Short-legged dogs, expressive poses, and small domestic episodes remain central as the characters move from drawings into phone accessories.",
        replace:
          "Merchandise spans prints, handmade figures, tech accessories, apparel, jewellery, and pet goods. Short-legged dogs, expressive poses, and small domestic episodes remain central as the characters move from drawings into products.",
      },
      {
        field: "blurb_en",
        find: "dachshund Frieze and raccoon Juanmao",
        replace: "dachshund Shutiao and raccoon Juanmao",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Batch 2 — records whose text cannot be salvaged clause by clause.
// ---------------------------------------------------------------------------
const BATCH_2: Edit[] = [
  {
    ref: "TC-01",
    brand: "YUJ 友情企業",
    slug: "yuj",
    why: "Wrong-entity text: the record described a precision-fastener maker. The real 友情企業 makes household appliances. Founding year comes from the GCIS registry (設立 1986-09-26, 統編 22277944), not the unsourced 1979. The PF-5888 MIT/BSMI/ISO certifications are deliberately omitted — the product pages are image-based and could not be read, so they are unverified rather than false.",
    guard: { field: "description", contains: "螺絲、螺帽、螺栓" },
    sets: {
      description:
        "友情企業股份有限公司（YUJ）位於台南安平工業區，以家用電器為主要產品線。品牌製造箱扇、立扇、桌立扇、古典扇、循環扇與吸頂扇等各式電風扇，並延伸至塑膠與紫外線烘碗機、捕蚊燈、嬰兒用品及廚房用品。產品開發以家庭日常使用情境為重點，涵蓋空氣循環、餐具乾燥與居家清潔等需求。公司登記成立於1986年。",
      description_en:
        "YUJ (You Ching Enterprise) is based in the Anping Industrial District of Tainan and focuses on household appliances. Its range covers box, stand, desk, classic, circulation and ceiling fans, extending to plastic and UV dish dryers, mosquito traps, baby products and kitchen goods. Development centres on everyday household needs such as air circulation, drying tableware and home upkeep. The company was registered in 1986.",
      blurb:
        "位於台南的家用電器製造商，產品涵蓋各式電風扇、循環扇、烘碗機、捕蚊燈與廚房生活用品。",
      blurb_en:
        "A Tainan-based household-appliance maker producing fans, circulation fans, dish dryers, mosquito traps and kitchen goods.",
    },
  },
  {
    ref: "OD-08",
    brand: "Love Mountain 樂登峰",
    slug: "love-mountain",
    why: "Wrong-entity text: the record described multifunction survival bracelets. The site's own title and meta are 樂登峰登山靴, and the adjacent SKUs are boot-related. Company established Oct 2023, registered 桃園市蘆竹區. Note the site serves over HTTP only — its HTTPS certificate is expired, which is what made an earlier check read as a 502 outage.",
    guard: { field: "description", contains: "求生手環" },
    sets: {
      description:
        "Love Mountain 樂登峰是樂登峰科技有限公司經營的台灣戶外鞋履品牌，公司於2023年10月成立，登記於桃園市蘆竹區。品牌以高筒多功能登山靴為核心產品，針對登山情境的防水、止滑抓地、包覆性與腳踝防護開發，並採旋鈕式結構調整鬆緊。產品線另包含止滑羊毛中筒襪、鞋油與抗菌鞋墊等登山鞋履周邊。",
      description_en:
        "Love Mountain is a Taiwanese outdoor-footwear brand operated by Love Mountain Technology Co., Ltd., established in October 2023 and registered in Luzhu, Taoyuan. Its core product is a high-top multifunction hiking boot developed around waterproofing, grip, secure fit and ankle protection, using a dial-based system to adjust tension. The range also includes non-slip wool crew socks, shoe polish and antibacterial insoles.",
      blurb:
        "桃園的戶外鞋履品牌，以旋鈕調整的高筒多功能登山靴為核心，兼顧防水、抓地與腳踝防護。",
      blurb_en:
        "A Taoyuan outdoor-footwear brand built around a dial-adjusted high-top hiking boot for waterproofing, grip and ankle protection.",
    },
  },
  {
    ref: "OD-10",
    brand: "NIKKO HELMETS",
    slug: "nikko-helmets",
    why: "The record put the brand's manufacturing base in Tainan; its own About pages say NIKKO was founded in California in 2011 and brought to Taiwan in 2016 by 東億兆實業有限公司 (founded 1974), with Tainan 歸仁 as the office address. The India-manufacturing caveat is deliberately NOT included (your call, 2026-08-12): this is a directory that explains brands rather than audits them, and NIKKO operates as a Taiwanese brand today. The result is silent on manufacturing location.",
    guard: { field: "description", contains: "品牌以台南為製造基地" },
    sets: {
      description:
        "NIKKO HELMETS 於2011年在美國加州創立，2016年由台灣的東億兆實業有限公司（成立於1974年）將品牌帶回台灣經營，台灣營運據點位於台南市歸仁區。品牌生產全罩式、半罩式與可樂帽等機車安全帽，帽體材料涵蓋 ABS 與 PC，並開發 CFK、碳纖維等複合材質；部分帽款配置快拆式鏡片、雙鏡片或內藏墨鏡，Asian Fit 依亞洲頭型設計，Easy Fit 則在帽體內加入眼鏡溝。產品取得美國 DOT、歐洲 ECE、台灣 CNS 加強型與日本 JIS 等多國安全規範。",
      description_en:
        "NIKKO HELMETS was established in California in 2011 and brought to Taiwan in 2016 by Tong I Zhao Industrial Co., Ltd. (founded 1974), whose Taiwan operation is based in Guiren, Tainan. The brand produces full-face, open-face and modular motorcycle helmets, with ABS and PC shells alongside CFK and carbon composites. Selected models use quick-release or dual shields and drop-down internal sun visors; Asian Fit shapes the shell for Asian head profiles, while Easy Fit adds a channel for eyeglasses. Helmets carry safety approvals including DOT, ECE, CNS and JIS.",
      blurb:
        "2011年創立於加州、2016年由東億兆帶回台灣的安全帽品牌，以台南為營運據點，產品取得 DOT、ECE、CNS 與 JIS 等多國認證。",
      blurb_en:
        "Founded in California in 2011 and brought to Taiwan in 2016, NIKKO develops DOT-, ECE-, CNS- and JIS-certified motorcycle helmets from its Tainan base.",
    },
  },
  {
    ref: "OD-21",
    brand: "嘉雲製傘 Jiayun",
    slug: "jiayun-store",
    why: "The description said the brand was founded in 2011, contradicting the live founding_year of 2016. Resolved from both official sites: 1987 rib-processing plant (合懋傘業) → 2011 嘉雲製傘 company in 南投草屯 → 2016 JIAYUN own brand. The Taiwan-made claim here is the strongest of the whole audit and is stated brand-wide, so it stays unqualified.",
    guard: { field: "description", contains: "於2011年在南投草屯創立" },
    sets: {
      description:
        "嘉雲製傘 JIAYUN 是2016年成立的自有雨傘品牌，製造端由2011年於南投草屯設立的嘉雲製傘承接；製傘脈絡可追溯至1987年，前身合懋傘業自傘骨加工轉型為雨傘成品製造。品牌以台灣福懋興業190T傘布製作傘面，傘布經超潑水塗層處理，並採一吋10針的高密度車縫（市面常見規格為一吋7針）。產品包含直傘、摺疊傘、反向傘、雙層抗風傘，以及遮光降溫傘與客製廣告傘等品項；官方說明所有嘉雲製傘的雨傘皆為台灣製造，並通過 MIT 雨傘檢測標準。",
      description_en:
        "JIAYUN is an in-house umbrella brand established in 2016, manufactured by Jiayun Umbrella, the factory founded in Caotun, Nantou, in 2011. Its craft lineage runs back to 1987, when predecessor Hemao Umbrella moved from rib processing into finished umbrellas. Canopies use water-repellent-treated Formosa Taffeta 190T fabric sewn at 10 stitches per inch, against a market norm of seven. The range covers straight, folding, reverse and double-canopy wind-resistant umbrellas, alongside light-blocking cooling models and custom printed umbrellas. The brand states that every Jiayun umbrella is made in Taiwan and passes MIT umbrella testing.",
      blurb:
        "2016年成立的台灣雨傘品牌，承接南投草屯製傘工廠與1987年起的製造經驗，以福懋190T傘布與一吋10針車縫製作台灣製雨傘。",
      blurb_en:
        "Founded as a brand in 2016 on a Nantou factory dating to 1987, JIAYUN makes Taiwan-produced umbrellas with Formosa Taffeta 190T fabric and 10-stitch seams.",
    },
  },
  {
    ref: "OD-01a",
    brand: "RAFAC",
    slug: "rafac",
    why: "This is the record that was contaminated with UK Royal Air Force Air Cadets data, so its copy needs treating with suspicion. DROPPED as unverified: the 阿美族語 naming story, and the coffee-yarn / recycled-polyester material claim — neither could be confirmed, and this record's provenance is poor. Both are recoverable from git if a source turns up. ADDED: the OutdoorNation blanket collaboration, which IS verified on the official storefront.",
    guard: { field: "description", contains: "阿美族語" },
    sets: {
      description:
        "RAFAC 是台灣的親子戶外織襪品牌，以兒童、成人與親子襪款為核心，將戶外活動所需的包覆與機能表現放入日常穿著。產品線涵蓋機能襪、雪行襪、反光襪與兒童機能襪，並延伸至戶外萬用毯、沙灘巾與飲料恆溫套等織品。品牌亦與戶外品牌 OutdoorNation 合作推出戶外萬用毯，將織品運用延伸至野餐與露營情境。",
      description_en:
        "RAFAC is a Taiwanese sock brand built around family and outdoor use, with children’s, adult and matching family styles at the centre of its range, combining outdoor-ready fit with everyday wear. Its line covers performance socks, snow socks, reflective socks and children’s performance socks, extending into multipurpose outdoor blankets, beach towels and drink insulators. The brand has also collaborated with OutdoorNation on multipurpose outdoor blankets for picnic and camping use.",
      blurb:
        "台灣親子戶外織襪品牌，從兒童、成人到親子襪款，並與 OutdoorNation 合作推出戶外萬用毯。",
      blurb_en:
        "A Taiwanese family-and-outdoor sock brand spanning children’s, adult and matching styles, with OutdoorNation blanket collaborations.",
    },
  },
  {
    ref: "OD-11/12",
    brand: "MONOCEAN",
    slug: "monocean",
    why: "Surgical, NOT a rewrite. The audit wanted this description blanked; five of its six claims are confirmed verbatim on the brand's own Threads bio — Dutch instructors, bio-based, Asian women, Made in Taiwan, 550% stretch — and all of those stay. Only the ocean-microplastics sentence had no first-party support. Pre-launch status added because the site is a signup page and the OceanShell wetsuit is not yet on sale, so a reader would otherwise expect to be able to buy it.",
    ops: [
      {
        field: "description",
        find: "其材料選擇也回應塑膠微粒進入海洋的問題，將海上活動所需的保護性服裝，連結至較低環境負擔的材質思考。",
        replace: "",
      },
      {
        field: "description",
        find: "讓穿著者能在下水前完成穿著。",
        replace:
          "讓穿著者能在下水前完成穿著。品牌官方網站目前為新品預告與訂閱頁面，代表產品 OceanShell 兩件式防寒衣尚未正式發售。",
      },
      {
        field: "description_en",
        find: "Material selection is presented as a response to plastic particles entering the ocean, connecting protective gear for water activities with lower-impact material choices. ",
        replace: "",
      },
      {
        field: "description_en",
        find: "allowing the wearer to put on the suit shortly before entering the water.",
        replace:
          "allowing the wearer to put on the suit shortly before entering the water. The brand’s site is currently a pre-launch signup page, and its OceanShell two-piece wetsuit has not yet gone on sale.",
      },
    ],
  },
];

EDITS.push(...BATCH_2);

const FIELD_TO_CAMEL: Record<Field, string> = {
  description: "description",
  description_en: "descriptionEn",
  blurb: "blurb",
  blurb_en: "blurbEn",
};

/**
 * Excerpt around a KNOWN index rather than by searching for the needle. Searching
 * breaks whenever the replacement is short and common — a bare "," matched the
 * first comma in the string and rendered a diff from the wrong part of the text.
 */
function excerptAt(
  text: string,
  index: number,
  length: number,
  pad = 26,
): string {
  const start = Math.max(0, index - pad);
  const end = Math.min(text.length, index + length + pad);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const supabase = createServiceClient();

  const slugs = EDITS.map((e) => e.slug);
  const { data: rows, error } = await supabase
    .from("brands")
    .select("id, slug, name, description, description_en, blurb, blurb_en")
    .in("slug", slugs);
  if (error) throw error;

  const bySlug = new Map(
    (rows ?? []).map((r) => [r.slug as string, r as Record<string, unknown>]),
  );
  const missingRows = slugs.filter((s) => !bySlug.has(s));
  if (missingRows.length > 0) {
    throw new Error(`Brand slugs not found: ${missingRows.join(", ")}`);
  }

  console.log(
    apply
      ? "\nAPPLYING description edits (batch 1: surgical)\n"
      : "\nDRY RUN — nothing will be written. Re-run with --apply to commit.\n",
  );

  let applied = 0;
  let already = 0;
  const drifted: string[] = [];
  const ambiguous: string[] = [];
  const touched: string[] = [];

  for (const edit of EDITS) {
    const row = bySlug.get(edit.slug)!;
    const patch: Record<string, string> = {};
    const lines: string[] = [];

    if (edit.sets) {
      const guard = edit.guard;
      if (!guard) throw new Error(`${edit.ref}: sets requires a guard`);
      const guardText = (row[guard.field] as string | null) ?? "";

      if (!guardText.includes(guard.contains)) {
        const alreadyDone = Object.entries(edit.sets).every(
          ([field, value]) => ((row[field] as string | null) ?? "") === value,
        );
        if (alreadyDone) {
          already += Object.keys(edit.sets).length;
          console.log(`  ${edit.ref.padEnd(8)} ${edit.brand} — no change`);
          continue;
        }
        drifted.push(
          `${edit.ref} ${edit.brand} · guard on ${guard.field} not satisfied — stored text is not what was reviewed`,
        );
        console.log(
          `  ${edit.ref.padEnd(8)} ${edit.brand} — HELD BACK, guard failed`,
        );
        continue;
      }

      for (const [field, value] of Object.entries(edit.sets)) {
        const current = ((row[field] as string | null) ?? "") as string;
        if (current === value) {
          already += 1;
          continue;
        }
        patch[field] = value as string;
        applied += 1;
        lines.push(`      ${field}  (full replace)`);
        lines.push(
          `        −  ${current.slice(0, 90)}${current.length > 90 ? "…" : ""}`,
        );
        lines.push(
          `        +  ${(value as string).slice(0, 90)}${(value as string).length > 90 ? "…" : ""}`,
        );
      }
    }

    for (const op of edit.ops ?? []) {
      const current = (patch[op.field] ??
        (row[op.field] as string | null) ??
        "") as string;

      if (!current.includes(op.find)) {
        if (current.includes(op.replace)) {
          already += 1;
        } else {
          drifted.push(
            `${edit.ref} ${edit.brand} · ${op.field}: "${op.find.slice(0, 40)}…"`,
          );
        }
        continue;
      }

      const hits = countOccurrences(current, op.find);
      if (hits > 1) {
        ambiguous.push(
          `${edit.ref} ${edit.brand} · ${op.field}: find string occurs ${hits}× — only the first would be replaced`,
        );
        continue;
      }

      const at = current.indexOf(op.find);
      const next = current.replace(op.find, op.replace);
      patch[op.field] = next;
      applied += 1;
      lines.push(`      ${op.field}`);
      lines.push(`        −  ${excerptAt(current, at, op.find.length)}`);
      lines.push(`        +  ${excerptAt(next, at, op.replace.length)}`);
    }

    if (Object.keys(patch).length === 0) {
      console.log(`  ${edit.ref.padEnd(8)} ${edit.brand} — no change`);
      continue;
    }

    console.log(`  ${edit.ref.padEnd(8)} ${edit.brand}`);
    console.log(`      why: ${edit.why}`);
    console.log(lines.join("\n"));
    console.log();

    touched.push(edit.slug);

    if (apply) {
      const camelPatch: Record<string, string> = {};
      for (const [field, value] of Object.entries(patch)) {
        camelPatch[FIELD_TO_CAMEL[field as Field]] = value;
      }
      await updateBrand(row.id as string, camelPatch, { source: "admin" });
    }
  }

  if (drifted.length > 0) {
    console.log("DRIFT — find string absent and replacement not present:");
    for (const d of drifted) console.log(`  • ${d}`);
    console.log(
      "  These were NOT applied. The stored text differs from what was reviewed.\n",
    );
  }

  if (ambiguous.length > 0) {
    console.log("AMBIGUOUS — find string is not unique, NOT applied:");
    for (const a of ambiguous) console.log(`  • ${a}`);
    console.log();
  }

  console.log(
    `${applied} replacement(s) across ${touched.length} brand(s); ${already} already applied; ` +
      `${drifted.length} drifted; ${ambiguous.length} ambiguous.`,
  );

  if (!apply) {
    console.log("\nDry run complete. Re-run with --apply to commit.");
    return;
  }

  const result = await requestPublicBrandRevalidation(touched);
  console.log(
    `Revalidation: ${result.ok ? "ok" : "FAILED"}${result.reason ? ` (${result.reason})` : ""}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
