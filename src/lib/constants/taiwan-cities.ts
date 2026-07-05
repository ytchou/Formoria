export const TAIWAN_CITIES = [
  { slug: 'taipei', nameZh: '臺北市', nameEn: 'Taipei City', topoId: 'TW-TPE' },
  { slug: 'new_taipei', nameZh: '新北市', nameEn: 'New Taipei City', topoId: 'TW-NWT' },
  { slug: 'taoyuan', nameZh: '桃園市', nameEn: 'Taoyuan City', topoId: 'TW-TAO' },
  { slug: 'taichung', nameZh: '臺中市', nameEn: 'Taichung City', topoId: 'TW-TXG' },
  { slug: 'tainan', nameZh: '臺南市', nameEn: 'Tainan City', topoId: 'TW-TNN' },
  { slug: 'kaohsiung', nameZh: '高雄市', nameEn: 'Kaohsiung City', topoId: 'TW-KHH' },
  { slug: 'keelung', nameZh: '基隆市', nameEn: 'Keelung City', topoId: 'TW-KEE' },
  { slug: 'hsinchu_city', nameZh: '新竹市', nameEn: 'Hsinchu City', topoId: 'TW-HSZ' },
  { slug: 'chiayi_city', nameZh: '嘉義市', nameEn: 'Chiayi City', topoId: 'TW-CYI' },
  { slug: 'hsinchu_county', nameZh: '新竹縣', nameEn: 'Hsinchu County', topoId: 'TW-HSQ' },
  { slug: 'miaoli', nameZh: '苗栗縣', nameEn: 'Miaoli County', topoId: 'TW-MIA' },
  { slug: 'changhua', nameZh: '彰化縣', nameEn: 'Changhua County', topoId: 'TW-CHA' },
  { slug: 'nantou', nameZh: '南投縣', nameEn: 'Nantou County', topoId: 'TW-NAN' },
  { slug: 'yunlin', nameZh: '雲林縣', nameEn: 'Yunlin County', topoId: 'TW-YUN' },
  { slug: 'chiayi_county', nameZh: '嘉義縣', nameEn: 'Chiayi County', topoId: 'TW-CYQ' },
  { slug: 'pingtung', nameZh: '屏東縣', nameEn: 'Pingtung County', topoId: 'TW-PIF' },
  { slug: 'yilan', nameZh: '宜蘭縣', nameEn: 'Yilan County', topoId: 'TW-ILA' },
  { slug: 'hualien', nameZh: '花蓮縣', nameEn: 'Hualien County', topoId: 'TW-HUA' },
  { slug: 'taitung', nameZh: '臺東縣', nameEn: 'Taitung County', topoId: 'TW-TTT' },
  { slug: 'penghu', nameZh: '澎湖縣', nameEn: 'Penghu County', topoId: 'TW-PEH' },
  { slug: 'kinmen', nameZh: '金門縣', nameEn: 'Kinmen County', topoId: 'TW-KIN' },
  { slug: 'lienchiang', nameZh: '連江縣', nameEn: 'Lienchiang County', topoId: 'TW-LIE' },
] as const

export type CitySlug = typeof TAIWAN_CITIES[number]['slug']

export const CITY_SLUGS = TAIWAN_CITIES.map(c => c.slug) as [CitySlug, ...CitySlug[]]
