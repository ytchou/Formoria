import type { SiteIdentitySubjectKind } from '../../site-identity-arbiter'
import {
  SITE_IDENTITY_EVIDENCE,
  type SiteIdentityCapturedEvidence,
} from './site-identity-evidence'

/**
 * Ground truth for the DEV-1309 site-identity ladder, read from the live
 * `brands` table on 2026-08-05 (759 brands), except the one `incident:` row,
 * which was corrected in production before this corpus was built.
 *
 * `expected` is the `resolveQuarantine` outcome the ladder must produce:
 * `'revoke'` for a subject the brand does not own, `'keep'` for one it does.
 *
 * Page evidence lives in `./site-identity-evidence`, captured by fetching each
 * subject URL on 2026-08-05. It is carried because production SKIPS any subject
 * whose evidence is empty and the system prompt answers `confidence: "low"`
 * when text is insufficient — which releases. Running the eval without page
 * text therefore scored the accept arm ~100% and the reject arm ~0% by
 * construction, and never exercised the plan's riskiest assumption: Han-language
 * calibration against real Han page copy. Page text is captured, never authored;
 * a subject whose text could not be fetched is `unscoreable` and the harness
 * reports it separately rather than counting it as a pass.
 *
 * `kind` splits the corpus so a regression is directional:
 *   - `reject`  the ladder must revoke
 *   - `accept`  the ladder must not touch a legitimate link
 *
 * A false reject in the `accept` arm is the merge-blocking failure — it silently
 * empties `purchase_website` with no error and no log.
 */
type SiteIdentityOutcome = 'revoke' | 'keep'

export type SiteIdentityEvalCase = {
  id: string
  kind: 'accept' | 'reject'
  brandName: string
  subjectUrl: string
  subjectKind: SiteIdentitySubjectKind
  columns: string[]
  /**
   * Where this row was read from, so a reviewer can re-derive it. Either
   * `brands.<column>#<slug>` for a value read out of the live `brands` table, or
   * `incident:<ref>` for a value that has since been corrected in production and
   * survives only in the incident record.
   */
  provenance: string
  expected: SiteIdentityOutcome
  acceptable?: SiteIdentityOutcome[]
  note: string
}

/**
 * The captured page text for a case, or an `unscoreable` marker when the host
 * refused the capture. A missing key is treated as unscoreable rather than as
 * empty evidence, so a fixture added without a capture cannot quietly inflate
 * the score.
 */
export function evidenceFor(id: string): SiteIdentityCapturedEvidence {
  return SITE_IDENTITY_EVIDENCE[id] ?? { unscoreable: 'no capture recorded' }
}

/**
 * True when this case carries no page text and so cannot be scored. Production
 * never sends such a subject to the arbiter at all — the phase skips a
 * quarantine group whose evidence is empty — so scoring it would measure the
 * release default, not the model.
 */
export function isUnscoreable(testCase: SiteIdentityEvalCase): boolean {
  const evidence = evidenceFor(testCase.id)
  if (evidence.unscoreable) return true
  return !(evidence.title || evidence.description || evidence.story)
}

export const SITE_IDENTITY_CASES: SiteIdentityEvalCase[] = [
  // ---- reject: stored links that identify a platform, publisher, or company --
  {
    id: 'smore',
    kind: 'reject',
    brandName: "S'MORE",
    subjectUrl: 'https://www.smore.com',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#s-more',
    expected: 'revoke',
    note: 'A US newsletter tool. Its marketing illustrations were published on a live Formoria brand page. Rung 1 CONFIRMS this link — `smore` contains the token `more` — so only the Rung 2 verdict can catch it. This is the canonical case.',
  },
  {
    id: 'kokoyun-slippers',
    kind: 'reject',
    brandName: '可可雲手作室內拖鞋',
    subjectUrl: 'https://beboss.wda.gov.tw',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#可可雲手作室內拖鞋',
    expected: 'revoke',
    note: 'A government workforce-development portal was adopted by the `deriveOfficialWebsite` first-eligible fall-through because the Han-only name yields zero Latin tokens.',
  },
  {
    id: 'unicorn-163',
    kind: 'reject',
    brandName: '大I獨角獸 光棲之所',
    subjectUrl: 'https://h.163.com',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#大i獨角獸-光棲之所',
    expected: 'revoke',
    note: 'NetEase.',
  },
  {
    id: 'lishan-fuguoyuan',
    kind: 'reject',
    brandName: '梨山福果園',
    subjectUrl: 'https://smiletaiwan.cw.com.tw',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#梨山-福果園',
    expected: 'revoke',
    note: 'A CommonWealth Magazine article page, not the brand\'s site.',
  },
  {
    id: 'yuhe-dictionary',
    kind: 'reject',
    brandName: '遇合',
    subjectUrl: 'https://dict.revised.moe.edu.tw',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#遇合',
    expected: 'revoke',
    note: 'The Ministry of Education revised dictionary was a first-eligible fall-through on a two-character Han name.',
  },
  {
    id: 'yu-behance',
    kind: 'reject',
    brandName: '魚氏 YU',
    subjectUrl: 'https://www.behance.net',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#yu',
    expected: 'revoke',
    note: 'A Behance portfolio root; `YU` is two letters so the name yields zero Latin tokens.',
  },
  {
    id: 'manman-iyp',
    kind: 'reject',
    brandName: '慢蔓皂屋',
    subjectUrl: 'https://www.iyp.com.tw',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#man-man-soap',
    expected: 'revoke',
    note: '`iyp.com.tw` is a business directory, not a brand site.',
  },
  {
    id: 'yuanzuo-momoshop',
    kind: 'reject',
    brandName: '源作木坊',
    subjectUrl: 'https://www.momoshop.com.tw',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#源作木坊',
    expected: 'revoke',
    note: 'momoshop is a marketplace root, not the brand own site.',
  },
  {
    id: 'nudream-nahoku',
    kind: 'reject',
    brandName: 'NU Dream Jewelry',
    subjectUrl: 'https://www.facebook.com/NaHoku',
    subjectKind: 'source-page',
    columns: ['social_facebook'],
    provenance: 'incident:DEV-1309-nahoku',
    expected: 'revoke',
    note: 'A Hawaiian jewellery company Facebook page was harvested off `nahoku.com`\'s footer and written into `social_facebook`; production corrected it to `facebook.com/highjewellerydream`, so this value survives only in the incident record.',
  },

  // ---- accept: legitimate links that Rung 1 cannot confirm ------------------
  {
    id: 'dtbbag',
    kind: 'accept',
    brandName: 'Darker Than Black Bags',
    subjectUrl: 'https://www.dtbbag.com',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#darker-than-black-bags',
    expected: 'keep',
    note: 'The brand\'s own site, which Rung 1 cannot confirm because the domain abbreviates the name.',
  },
  {
    id: '74ounce',
    kind: 'accept',
    brandName: '74OUNCE',
    subjectUrl: 'https://www.74oz.com.tw/',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#74ounce',
    expected: 'keep',
    note: 'The brand\'s own site, which Rung 1 cannot confirm because the domain abbreviates the name.',
  },
  {
    id: '1cmhandmake',
    kind: 'accept',
    brandName: '一公分手作 1Cmhandmake',
    subjectUrl: 'https://1cmhandmade.com',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#1cmhandmake',
    expected: 'keep',
    note: 'The brand\'s own site, which Rung 1 cannot confirm because the domain abbreviates the name.',
  },
  {
    id: 'new-buffalo',
    kind: 'accept',
    brandName: '牛頭牌台灣鞋',
    subjectUrl: 'https://www.newbuffalo.com.tw',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#new-buffalo',
    expected: 'keep',
    note: '牛頭牌 translates to the domain\'s `newbuffalo`.',
  },
  {
    id: 'tipsy-farm',
    kind: 'accept',
    brandName: '微醺農場',
    subjectUrl: 'https://www.whfarm.com.tw',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#tipsy-farm',
    expected: 'keep',
    note: '`wh` initialises 微醺.',
  },
  {
    id: 'immugoat',
    kind: 'accept',
    brandName: '乙木羊鮮羊奶',
    subjectUrl: 'https://www.immugoat.com',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#immugoat',
    expected: 'keep',
    note: 'The brand own domain matches its slug.',
  },
  {
    id: 'jaibei',
    kind: 'accept',
    brandName: '佳貝牙刷',
    subjectUrl: 'https://www.jaibei.com.tw',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#chia-pei-ya-shua',
    expected: 'keep',
    note: '`jaibei` romanises 佳貝.',
  },
  {
    id: '1koshijimi',
    kind: 'accept',
    brandName: '壹顆蜆',
    subjectUrl: 'https://1koshijimi.com.tw',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#1-koshijimi',
    expected: 'keep',
    note: 'Domain matches the slug.',
  },
  {
    id: 'cucumber',
    kind: 'accept',
    brandName: '廣源良',
    subjectUrl: 'https://www.cucumber.com.tw',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#廣源良-mit',
    expected: 'keep',
    note: 'The long-established cucumber-water brand\'s own domain.',
  },
  {
    id: 'shunyun-tea',
    kind: 'accept',
    brandName: '順韻茶葉',
    subjectUrl: 'https://www.shunyuntea.com',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#shunyun-tea',
    expected: 'keep',
    note: '`shunyun` romanises 順韻.',
  },
  {
    id: 'mazupu',
    kind: 'accept',
    brandName: '媽祖埔豆腐張',
    subjectUrl: 'https://www.mzp1991.com',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#mazupu-tofu-zhang',
    expected: 'keep',
    note: '`mzp` initialises 媽祖埔.',
  },
  {
    id: 'daughter-tea',
    kind: 'accept',
    brandName: '女兒不懂茶',
    subjectUrl: 'https://www.daughter-tea.com',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#daughter-tea',
    expected: 'keep',
    note: 'The domain translates the name.',
  },
  {
    id: 'kajitsu',
    kind: 'accept',
    brandName: '菓實日 kué-tsí-li̍t',
    subjectUrl: 'https://www.kajitsu.com.tw/',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#kue-tsi-lit',
    expected: 'keep',
    note: 'The Tâi-lô romanisation carries diacritics, so it yields no Latin tokens.',
  },
  {
    id: 'yuyu-tea',
    kind: 'accept',
    brandName: '郁郁 YùYù',
    subjectUrl: 'https://www.yuyuteadaily.com',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#yuyu',
    expected: 'keep',
    note: '`YùYù` is diacritic-bearing and two letters per syllable, so it tokenises to nothing.',
  },
  {
    id: 'pangscent',
    kind: 'accept',
    brandName: '雱PĀNG',
    subjectUrl: 'https://www.pangscent.com/',
    subjectKind: 'website',
    columns: ['purchase_website'],
    provenance: 'brands.purchase_website#pang',
    expected: 'keep',
    note: '`PĀNG` carries a macron, so the name yields no Latin tokens.',
  },
]
