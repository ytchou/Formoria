/**
 * The 15 brands in the 2026 Taiwan Creative Expo editorial shortlist, in the
 * Notion doc's own order (category, then rank).
 *
 * Three slugs are mangled — `y` for 郁郁 YùYù, `ng` for 雱 PĀNG, and
 * `610-asteroid-b` for 小行星 B-610. That is the DEV-1301 slug-generation
 * defect (diacritics and Han dropped), not a typo here. It matters for this
 * run because the `slugs` phase may rewrite them, which changes a live URL.
 */
export const EXPO15_SLUGS = [
  'ziliaoshi',
  'nichi',
  'taluma',
  'huiaio-studio',
  'yuwu-design',
  'laoshan-collector',
  'take-a-snooze',
  'y',
  'ng',
  'mountopia',
  'tings-aroma',
  'zenu',
  'eggplants',
  '610-asteroid-b',
  'yarn-ball',
] as const

/** Display labels from the Notion doc, for the comparison page. */
export const EXPO15_LABELS: Record<string, string> = {
  ziliaoshi: '織療室 ziliaoshi',
  nichi: '恬日 tan.nichi',
  taluma: 'TALUMA 知返設計',
  'huiaio-studio': '這一窯 Huiaio Studio',
  'yuwu-design': '寓物設計',
  'laoshan-collector': '老3香室',
  'take-a-snooze': 'Take a Snooze 瞇一下',
  y: '郁郁 YùYù',
  ng: '雱 PĀNG',
  mountopia: 'Mountopia 山托邦',
  'tings-aroma': '亭氏香氛 TINGS AROMA',
  zenu: '山霧 ZenU',
  eggplants: '茄子先生 Mr. Eggplants',
  '610-asteroid-b': '小行星 B-610',
  'yarn-ball': '針線球 Yarnball',
}
