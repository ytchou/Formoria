import { describe, expect, it } from 'vitest'

import {
  applyGuard,
  buildDetectItem,
  evidenceMetadata,
  isAnchorLeak,
  parseRegenerateArgs,
  parseStoredFields,
  sourceFromStored,
  sourceFromSubmission,
  uuid5,
  type SubmissionRow,
} from '../regenerate-detect-golden-inputs'

const OLD_FORMAT_USER = [
  '品牌 slug：submission-456c87e9-dd7a-4828-876d-ca4b58acde71',
  '品牌名稱：Design Council Busan',
  '描述：無',
  '網站：https://dcb.or.kr',
  '搜尋摘要：Busan designated World Design Capital — Design Council Busan；SUMIDA MODERN — an initiative',
  '探測：Design Council Busan — official site',
].join('\n')

describe('parseStoredFields', () => {
  it('parse_stored_fields_fallback: recovers name, description and website from an old-format message', () => {
    expect(parseStoredFields(OLD_FORMAT_USER)).toEqual({
      slug: 'submission-456c87e9-dd7a-4828-876d-ca4b58acde71',
      name: 'Design Council Busan',
      description: null,
      website: 'https://dcb.or.kr',
      submittedWebsite: null,
      probeLineCount: 1,
    })
  })

  it('keeps a multi-line description whole and rejects a message with no name', () => {
    const user = '品牌 slug：s\n品牌名稱：A\n描述：line one\nline two\n網站：無'
    expect(parseStoredFields(user)).toMatchObject({ description: 'line one\nline two', website: null, probeLineCount: 0 })
    expect(() => parseStoredFields('品牌 slug：s\n描述：x')).toThrow()
  })
})

const SUBMISSION: SubmissionRow = {
  id: '8d53ef2f-dc4c-4542-9ea6-6c15ee30915d',
  brand_id: null,
  intent: 'new',
  base_brand_data: null,
  brand_name: 'Winten',
  description: 'Cat plush importer',
  website_url: 'https://win10.com.tw',
  hero_image_url: null,
  social_instagram: 'https://www.instagram.com/winten.tw/',
  social_threads: null,
  social_facebook: null,
  other_urls: null,
  enriched_data: null,
  owner_data: null,
  status: 'rejected',
  purchase_website: 'https://shop.win10.com.tw',
  purchase_pinkoi: null,
  purchase_shopee: null,
} as SubmissionRow

const RAW_RESPONSE = {
  organic: [
    { title: 'WINTEN official', link: 'https://win10.com.tw/about', snippet: 'Cat goods', position: 1 },
    { title: 'Winten on IG', link: 'https://www.instagram.com/winten.tw/', position: 2 },
    { title: 'Other WINTEN', link: 'https://example.com/winten', snippet: 'Unrelated', position: 3 },
  ],
}

describe('buildDetectItem', () => {
  it('build_item_from_sources: submission + stored SERP + probes render the production message', () => {
    const { item, rendered } = buildDetectItem({
      source: sourceFromSubmission(SUBMISSION),
      rawResponse: RAW_RESPONSE,
      probeEvidence: [{ url: 'https://win10.com.tw', status: 404 }],
    })

    expect(item.slug).toBe(`submission-${SUBMISSION.id}`)
    expect(item.submittedWebsite).toBe('https://win10.com.tw')
    expect(item.results?.map((r) => r.match)).toEqual(['site', 'instagram', null])
    expect(rendered).toContain('提交網址：https://win10.com.tw')
    expect(rendered).toContain('搜尋結果：WINTEN official — Cat goods（win10.com.tw，官網）')
    expect(rendered).toContain('搜尋結果：Winten on IG（instagram.com，IG 相符）')
    expect(rendered).toContain('搜尋結果：Other WINTEN — Unrelated（example.com）')
    expect(rendered).toContain('探測：win10.com.tw — 無法連線（HTTP 404）')
  })

  it('rebuilds from stored fields when the submission row is missing', () => {
    const { item, rendered } = buildDetectItem({ source: sourceFromStored(parseStoredFields(OLD_FORMAT_USER)), rawResponse: null })
    expect(item.name).toBe('Design Council Busan')
    expect(item.website).toBe('https://dcb.or.kr')
    expect(rendered).toContain('提交網址：無')
  })
})

describe('evidenceMetadata', () => {
  it('evidence_dates_recorded: stored SERP keeps its own date, a live one takes the run date', () => {
    expect(evidenceMetadata({ serpCreatedAt: '2026-08-08T00:41:17Z', runDate: '2026-09-28' })).toEqual({
      evidenceDates: { serp: '2026-08-08T00:41:17Z', probe: '2026-09-28' },
      serpSource: 'stored',
    })
    expect(evidenceMetadata({ serpCreatedAt: null, runDate: '2026-09-28' })).toEqual({
      evidenceDates: { serp: '2026-09-28', probe: '2026-09-28' },
      serpSource: 'live',
    })
  })
})

describe('isAnchorLeak', () => {
  it('anchor_leak_check_rejects: names matching a prompt golden anchor are rejected', () => {
    expect(isAnchorLeak('好物嚴選')).toBe(true)
    expect(isAnchorLeak(' 島嶼紙品 ')).toBe(true)
    expect(isAnchorLeak('某某工作室 Studio')).toBe(true)
    expect(isAnchorLeak('Design Council Busan')).toBe(false)
  })
})

describe('applyGuard', () => {
  it('apply_refuses_over_10pct_failures: 3 of 20 failing refuses, 2 of 20 passes', () => {
    expect(applyGuard({ total: 20, failed: 3 }).ok).toBe(false)
    expect(applyGuard({ total: 20, failed: 2 }).ok).toBe(true)
    expect(applyGuard({ total: 0, failed: 0 }).ok).toBe(false)
  })
})

describe('parseRegenerateArgs', () => {
  it('apply_requires_pre_export: --apply without --pre-export is rejected', () => {
    expect(() => parseRegenerateArgs(['--apply'])).toThrow(/--pre-export/)
    expect(parseRegenerateArgs(['--apply', '--pre-export', '/tmp/x.json'])).toMatchObject({
      apply: true,
      preExport: '/tmp/x.json',
    })
  })

  it('defaults to a dry run printing 10 diffs', () => {
    expect(parseRegenerateArgs([])).toEqual({
      apply: false,
      preExport: null,
      addDenied: false,
      assignSplits: false,
      diffs: 10,
    })
    expect(parseRegenerateArgs(['--add-denied', '--assign-splits', '--diffs', '3'])).toMatchObject({
      addDenied: true,
      assignSplits: true,
      diffs: 3,
    })
  })
})

describe('uuid5', () => {
  it('matches Python uuid.uuid5(NAMESPACE_URL, name), the id scheme the existing items use', () => {
    expect(uuid5('detect-golden:8ce1123d-7f47-4844-b5a2-f523933fa9dc')).toBe('70ea9d76-bfb4-524a-ba4e-4314fc12090f')
  })
})
