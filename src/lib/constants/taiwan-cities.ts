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
