import type { NameCandidate } from '../../name-arbiter'

/**
 * Ground truth for the DEV-1321 name arbiter, drawn from the live 2026-08-03
 * curation runs — `curation_job_targets.phase_results` for what the regex
 * cleaner did, and `brands` vs `brand_submissions` for what reached the table.
 *
 * These are not invented strings. Every `storedName`/`scraped` pair below was
 * observed in production, which is the point: the gate asks whether the arbiter
 * beats the regex on the inputs that actually broke it.
 *
 * `expected` is a single defensible answer. `acceptable` is used where two
 * answers are genuinely defensible (usually "keep the fuller registered name"
 * vs "keep the short trading name") and forcing one would measure taste rather
 * than correctness — a verdict matching ANY entry scores as correct.
 *
 * `kind` splits the set so a regression in one direction is visible:
 *   - `preserve`  the name must survive intact (regex truncated it)
 *   - `strip`     trailing text really is a tagline or page chrome
 *   - `casing`    the brand's own casing must not be normalised
 *   - `reject`    a proposed rename must be refused outright
 */
export type NameArbitrationCase = {
  id: string
  kind: 'preserve' | 'strip' | 'casing' | 'reject'
  storedName: string
  candidates: NameCandidate[]
  expected?: string
  acceptable?: string[]
  note: string
}

const c = (source: NameCandidate['source'], value: string): NameCandidate => ({ source, value })

export const NAME_ARBITRATION_CASES: NameArbitrationCase[] = [
  // ---- preserve: the regex cleaner truncated these on live rows ----------
  {
    id: 'unigaze',
    kind: 'preserve',
    storedName: 'UNIGAZE 慢火金工創作室',
    candidates: [c('cleaned', 'UNIGAZE 慢火金工創作室'), c('detected', 'UNIGAZE')],
    expected: 'UNIGAZE 慢火金工創作室',
    note: '慢火金工創作室 is the registered studio name, not a tagline. Regex produced `UNIGAZE`.',
  },
  {
    id: 'mu-ran',
    kind: 'preserve',
    storedName: '暮苒甜點工作室',
    candidates: [c('cleaned', '暮苒甜點')],
    expected: '暮苒甜點工作室',
    note: '工作室 was stripped as a product descriptor; it is part of the name.',
  },
  {
    id: 'lin-tsao',
    kind: 'preserve',
    storedName: '藺草工坊',
    candidates: [c('cleaned', '藺草')],
    expected: '藺草工坊',
    note: 'Live row was truncated to 藺草.',
  },
  {
    id: 'ywc',
    kind: 'preserve',
    storedName: 'YWC 製鞋工作室',
    candidates: [c('cleaned', 'YWC 製鞋')],
    expected: 'YWC 製鞋工作室',
    note: 'Same 工作室 truncation, bilingual form.',
  },
  {
    id: 'crochet-02',
    kind: 'preserve',
    storedName: "02 編織工作室 02's crochet",
    candidates: [c('cleaned', '02')],
    acceptable: ["02 編織工作室 02's crochet", '02 編織工作室', "02's crochet 編織工作室"],
    note: 'Worst observed truncation: down to `02`. Any form keeping both halves is correct.',
  },
  {
    id: 'quemoy',
    kind: 'preserve',
    storedName: '洋樓拾憶文創工作室 Quemoy Memory Creative Studio',
    candidates: [c('scraped', '洋樓拾憶 Quemoy Memory')],
    acceptable: [
      '洋樓拾憶文創工作室 Quemoy Memory Creative Studio',
      '洋樓拾憶 Quemoy Memory',
    ],
    note: 'Registered vs trading name — both defensible, neither is a tagline.',
  },
  {
    id: 'bon-bon',
    kind: 'preserve',
    storedName: '邦妮插畫工作室 Bon Bon Stickers',
    candidates: [c('scraped', 'Bon Bon Stickers 邦妮插畫')],
    acceptable: ['邦妮插畫工作室 Bon Bon Stickers', 'Bon Bon Stickers 邦妮插畫工作室'],
    note: 'Must not lose 工作室 or either language half.',
  },
  {
    id: 'chudi',
    kind: 'preserve',
    storedName: '櫥底 Cookies &',
    candidates: [c('cleaned', '櫥底 Cookies &')],
    expected: '櫥底 Cookies &',
    note: 'Trailing ampersand is part of the name; must not be trimmed as noise.',
  },

  // ---- strip: trailing text really is a tagline or page chrome -----------
  {
    id: 'hsiao-chu',
    kind: 'strip',
    storedName: '小朱甜點',
    candidates: [c('scraped', '首頁 - 小朱甜點')],
    expected: '小朱甜點',
    note: '首頁 is page-title chrome. This shipped to the brands table.',
  },
  {
    id: '74ounce',
    kind: 'strip',
    storedName: '74OUNCE',
    candidates: [c('scraped', '74OUNCE BAGSMART 全家人的包')],
    expected: '74OUNCE',
    note: '全家人的包 is a tagline. This shipped to the brands table.',
  },
  {
    id: 'adela',
    kind: 'strip',
    storedName: 'ADELA',
    candidates: [c('scraped', 'Adela 愛德拉'), c('cleaned', 'ADELA')],
    expected: 'Adela 愛德拉',
    note: 'The motivating win: adopt the bilingual name, drop 守護家人，為愛研發.',
  },
  {
    id: 'boingboing',
    kind: 'strip',
    storedName: 'BoingBoing 故事鞋與童畫包',
    candidates: [c('cleaned', 'BoingBoing 故事鞋與童畫包'), c('detected', 'BoingBoing')],
    expected: 'BoingBoing',
    note: 'Same shape as UNIGAZE but genuinely a tagline — the pair the regex cannot separate.',
  },
  {
    id: 'aromase',
    kind: 'strip',
    storedName: 'AROMASE 艾瑪絲 頭皮療癒永續品牌',
    candidates: [c('cleaned', 'AROMASE 艾瑪絲 頭皮療癒永續品牌')],
    expected: 'AROMASE 艾瑪絲',
    note: '頭皮療癒永續品牌 is marketing copy the shrunken cleaner now leaves behind.',
  },
  {
    id: 'escura',
    kind: 'strip',
    storedName: 'ESCURA 自然 X 機能服飾',
    candidates: [c('cleaned', 'ESCURA 自然 X 機能服飾')],
    expected: 'ESCURA',
    note: 'Category copy, not a name.',
  },
  {
    id: 'la-fille',
    kind: 'strip',
    storedName: 'La Fille 樂菲真皮手工鞋',
    candidates: [c('scraped', 'La Fille 樂菲')],
    expected: 'La Fille 樂菲',
    note: '真皮手工鞋 describes the product.',
  },
  {
    id: 'tint',
    kind: 'strip',
    storedName: 'T.I.N.T STUDIO',
    candidates: [c('scraped', 'T.I.N.T STUDIO 染 生活')],
    expected: 'T.I.N.T STUDIO',
    note: '染•生活 is a tagline appended by the page title.',
  },
  {
    id: '404oligo',
    kind: 'strip',
    storedName: '404Oligo 你的好菌優化師',
    candidates: [c('cleaned', '404Oligo 你的好菌優化師')],
    expected: '404Oligo',
    note: 'Slogan.',
  },

  // ---- casing: the brand's own casing is identity ------------------------
  {
    id: 'qn-dessert',
    kind: 'casing',
    storedName: 'qn dessert',
    candidates: [c('cleaned', 'qn dessert'), c('scraped', 'QN Dessert')],
    acceptable: ['qn dessert', 'QN Dessert'],
    note: 'Must not become `Qn Dessert`, which is what titleCaseAllLowercase produced.',
  },
  {
    id: '1woof',
    kind: 'casing',
    storedName: '一屋 1woof',
    candidates: [c('cleaned', '一屋 1woof')],
    expected: '一屋 1woof',
    note: 'Regex produced `一屋 1Woof`.',
  },
  {
    id: 'iliz',
    kind: 'casing',
    storedName: '愛麗絲傢俱 iliz',
    candidates: [c('cleaned', '愛麗絲傢俱 iliz')],
    expected: '愛麗絲傢俱 iliz',
    note: 'Regex produced `愛麗絲傢俱 Iliz`.',
  },
  {
    id: 'iii-sum',
    kind: 'casing',
    storedName: 'iii sum+ 實樂設計',
    candidates: [c('cleaned', 'iii sum+ 實樂設計')],
    expected: 'iii sum+ 實樂設計',
    note: 'Lowercase plus a trailing symbol — both deliberate.',
  },
  {
    id: 'simple-is',
    kind: 'casing',
    storedName: 'Simple Is',
    candidates: [c('scraped', 'Simple is Studio')],
    acceptable: ['Simple Is', 'Simple Is Studio'],
    note: 'Live row lost the capital I. Either capitalisation-preserving answer passes.',
  },

  // ---- reject: a proposed rename must be refused -------------------------
  {
    id: 'trista',
    kind: 'reject',
    storedName: 'Trista Handmade',
    candidates: [c('scraped', 'Trista Smile Girl 微笑女孩')],
    expected: 'Trista Handmade',
    note: 'A page title sharing one token must not rebrand the record. This shipped.',
  },
  {
    id: 'seo-copy',
    kind: 'reject',
    storedName: 'ADELA',
    candidates: [c('scraped', 'ADELA 推薦 必買 伴手禮')],
    expected: 'ADELA',
    note: 'SEO listicle copy.',
  },
  {
    id: 'different-company',
    kind: 'reject',
    storedName: 'ADELA',
    candidates: [c('scraped', '德瑪貝爾化粧品')],
    expected: 'ADELA',
    note: 'Title names a different company entirely.',
  },
  {
    id: 'partial-drop',
    kind: 'reject',
    storedName: 'Adela 愛德拉',
    candidates: [c('scraped', 'Adela')],
    expected: 'Adela 愛德拉',
    note: 'A candidate that drops half the stored bilingual name is a regression, not a fix.',
  },
]
