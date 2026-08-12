export const TAIWAN_CITIES = [
  { slug: 'taipei', nameEn: 'Taipei City', topoId: 'TW-TPE' },
  { slug: 'new_taipei', nameEn: 'New Taipei City', topoId: 'TW-NWT' },
  { slug: 'taoyuan', nameEn: 'Taoyuan City', topoId: 'TW-TAO' },
  { slug: 'taichung', nameEn: 'Taichung City', topoId: 'TW-TXG' },
  { slug: 'tainan', nameEn: 'Tainan City', topoId: 'TW-TNN' },
  { slug: 'kaohsiung', nameEn: 'Kaohsiung City', topoId: 'TW-KHH' },
  { slug: 'keelung', nameEn: 'Keelung City', topoId: 'TW-KEE' },
  { slug: 'hsinchu_city', nameEn: 'Hsinchu City', topoId: 'TW-HSZ' },
  { slug: 'chiayi_city', nameEn: 'Chiayi City', topoId: 'TW-CYI' },
  { slug: 'hsinchu_county', nameEn: 'Hsinchu County', topoId: 'TW-HSQ' },
  { slug: 'miaoli', nameEn: 'Miaoli County', topoId: 'TW-MIA' },
  { slug: 'changhua', nameEn: 'Changhua County', topoId: 'TW-CHA' },
  { slug: 'nantou', nameEn: 'Nantou County', topoId: 'TW-NAN' },
  { slug: 'yunlin', nameEn: 'Yunlin County', topoId: 'TW-YUN' },
  { slug: 'chiayi_county', nameEn: 'Chiayi County', topoId: 'TW-CYQ' },
  { slug: 'pingtung', nameEn: 'Pingtung County', topoId: 'TW-PIF' },
  { slug: 'yilan', nameEn: 'Yilan County', topoId: 'TW-ILA' },
  { slug: 'hualien', nameEn: 'Hualien County', topoId: 'TW-HUA' },
  { slug: 'taitung', nameEn: 'Taitung County', topoId: 'TW-TTT' },
  { slug: 'penghu', nameEn: 'Penghu County', topoId: 'TW-PEH' },
  { slug: 'kinmen', nameEn: 'Kinmen County', topoId: 'TW-KIN' },
  { slug: 'lienchiang', nameEn: 'Lienchiang County', topoId: 'TW-LIE' },
] as const

export type CitySlug = typeof TAIWAN_CITIES[number]['slug']

export const CITY_SLUGS = TAIWAN_CITIES.map(c => c.slug) as [CitySlug, ...CitySlug[]]

/**
 * SHORT zh-TW city labels, keyed by slug — "台北", not "臺北市".
 *
 * These are region chips (channel/location grouping), deliberately clipped and
 * using the 台 variant. For the full names the brand page renders, use
 * `CITY_NAMES_ZH` below — the two are not interchangeable.
 *
 * Lives here rather than in a message catalog because the enrichment pipeline
 * needs it outside any request scope: the curation worker runs `tsx` against
 * the repo with no Next.js bundler and no `messages/` directory in its image,
 * so importing `messages/zh-TW.json` there crashes at module resolution.
 */
export const CITY_REGION_LABELS_ZH: Readonly<Record<string, string>> = {
  taipei: '台北',
  new_taipei: '新北',
  taoyuan: '桃園',
  taichung: '台中',
  tainan: '台南',
  kaohsiung: '高雄',
  keelung: '基隆',
  hsinchu_city: '新竹',
  hsinchu_county: '新竹縣',
  chiayi_city: '嘉義',
  chiayi_county: '嘉義縣',
  miaoli: '苗栗',
  changhua: '彰化',
  nantou: '南投',
  yunlin: '雲林',
  pingtung: '屏東',
  yilan: '宜蘭',
  hualien: '花蓮',
  taitung: '台東',
  penghu: '澎湖',
  kinmen: '金門',
  lienchiang: '連江',
}

/**
 * FULL zh-TW city names, keyed by slug — the same strings the brand page
 * renders via `tCities(brand.city)`.
 *
 * This MUST stay identical to the `cities` namespace in `messages/zh-TW.json`;
 * `taiwan-cities.test.ts` asserts that, so drift fails CI rather than silently
 * making the enrichment prompt describe a brand differently from its own page.
 *
 * It is duplicated here rather than imported from the catalog because the
 * curation worker runs `tsx` with no bundler and no `messages/` directory in
 * its image — importing the JSON from anything the worker reaches crashes it at
 * module resolution. Tests can import the catalog freely; runtime code cannot.
 */
export const CITY_NAMES_ZH: Readonly<Record<string, string>> = {
  taipei: '臺北市',
  new_taipei: '新北市',
  taoyuan: '桃園市',
  taichung: '臺中市',
  tainan: '臺南市',
  kaohsiung: '高雄市',
  keelung: '基隆市',
  hsinchu_city: '新竹市',
  chiayi_city: '嘉義市',
  hsinchu_county: '新竹縣',
  miaoli: '苗栗縣',
  changhua: '彰化縣',
  nantou: '南投縣',
  yunlin: '雲林縣',
  chiayi_county: '嘉義縣',
  pingtung: '屏東縣',
  yilan: '宜蘭縣',
  hualien: '花蓮縣',
  taitung: '臺東縣',
  penghu: '澎湖縣',
  kinmen: '金門縣',
  lienchiang: '連江縣',
}

const CITY_SLUG_BY_NAME_ZH = new Map(
  CITY_SLUGS.map((slug) => [CITY_NAMES_ZH[slug], slug]),
)

export function citySlugFromName(name: string | null | undefined): CitySlug | null {
  if (!name) return null
  return CITY_SLUG_BY_NAME_ZH.get(name.replaceAll('台', '臺')) ?? null
}

export function citySlugToPath(slug: CitySlug): string {
  return slug.replaceAll('_', '-')
}

export function citySlugFromPath(path: string): CitySlug | null {
  const candidate = path.replaceAll('-', '_')
  return CITY_SLUGS.find((slug) => slug === candidate) ?? null
}
