import { describe, expect, it } from 'vitest'

import {
  CHROME_MAX_CHARS,
  LEAD_CHARS,
  MAX_MAIN_TEXT_CHARS,
  selectAcrossPages,
  selectPageText,
  type TextStats,
} from '../select-evidence'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Realistic product prose that matches no fact tier and no chrome label. */
const PROSE =
  '馬克杯的線條簡單俐落，適合每天早上泡一杯咖啡，也能在午後倒一點熱茶，慢慢享受屬於自己的安靜片刻。' +
  '窯燒後的釉色帶著淡淡的藍，放在木頭桌上格外好看。每一只都略有不同，這正是它迷人的地方。'

/** A neutral body block (~95 chars) that matches no fact tier and no chrome label. */
function bodyBlock(i: number): string {
  return `第${i}款${PROSE}`
}

/** A long description paragraph that mentions a chrome word in passing. */
const SHARE_PARAGRAPH =
  '這只馬克杯是我們想和你分享的日常：早晨的第一杯咖啡、午後的一壺熱茶，都值得一個拿起來順手、' +
  '看了會心一笑的杯子。杯身的弧度貼合掌心，杯緣薄而不易缺角。'

/** A 400-char block that repeats on every page but carries no chrome or fact label. */
const LONG_NOTICE = '本店所有訂單出貨時間說明。'.repeat(40).slice(0, 400)

type Page = {
  url: string
  mainText: string
  blocks?: string[]
  textStats?: TextStats
}

function page(i: number, blocks: string[] | undefined): Page {
  return { url: `https://brand.example/p/${i}`, mainText: 'old prefix', blocks }
}

// ---------------------------------------------------------------------------
// selectPageText
// ---------------------------------------------------------------------------

describe('selectPageText', () => {
  it('select_surfaces_fact_after_prefix_cutoff (regression)', () => {
    const body: string[] = []
    for (let i = 0; i < 60; i++) {
      body.push(bodyBlock(i))
      if (i % 10 === 0) body.push('加入購物車 立即購買')
    }
    const blocks = [...body, '材質：100% 台灣棉', '尺寸：30 x 40 cm']
    expect(blocks.join(' ').length).toBeGreaterThan(5000)

    const oldPrefix = blocks.join(' ').slice(0, 4096)
    expect(oldPrefix).not.toContain('材質：100% 台灣棉')
    expect(oldPrefix).not.toContain('尺寸：30 x 40 cm')

    const { mainText } = selectPageText(blocks)
    expect(mainText).toContain('材質：100% 台灣棉')
    expect(mainText).toContain('尺寸：30 x 40 cm')
    expect(mainText.length).toBeLessThanOrEqual(MAX_MAIN_TEXT_CHARS)
  })

  it('select_strips_template_tokens', () => {
    const blocks = [
      "Clay plate {{ 'x' | translate }} made by hand",
      '{{Ctrl.Model.Field}}',
      'Glazed in {{Ctrl.Model.Field}} blue',
    ]
    const { mainText } = selectPageText(blocks)
    expect(mainText).not.toContain('{{')
    expect(mainText).not.toContain('}}')
    expect(mainText).not.toContain('translate')
    expect(mainText).not.toContain('Ctrl.Model.Field')
    expect(mainText).toContain('Clay plate')
    expect(mainText).toContain('blue')
  })

  it('select_drops_chrome_without_fact_label', () => {
    const blocks = [
      'A handmade clay plate.',
      '送貨方式 宅配到府 付款方式 信用卡',
      '付款方式 說明 材質：陶土',
    ]
    const { mainText } = selectPageText(blocks)
    expect(mainText).not.toContain('宅配到府')
    expect(mainText).toContain('付款方式 說明 材質：陶土')
  })

  it('select_keeps_long_chrome_word_paragraph_on_short_page (regression)', () => {
    expect(SHARE_PARAGRAPH.length).toBeGreaterThan(CHROME_MAX_CHARS)
    // Trade-off: a short heading with a chrome word is dropped like any short chrome.
    const blocks = ['會員限定 春季禮盒', SHARE_PARAGRAPH, '材質：陶土']
    const { mainText } = selectPageText(blocks)
    expect(mainText).toBe(`${SHARE_PARAGRAPH} 材質：陶土`)
  })

  it('select_ranks_long_chrome_word_block_last', () => {
    const lead = 'x'.repeat(2000)
    const chromeBlock = 'shipping ' + 'z'.repeat(1491)
    const plain = 'q'.repeat(1500)
    // Chrome block precedes the plain block in document order; only one fits whole.
    const { mainText } = selectPageText([lead, chromeBlock, plain])
    expect(mainText).toContain(plain)
    expect(mainText).not.toContain(chromeBlock)
    expect(mainText.indexOf(lead)).toBe(0)
    expect(mainText.length).toBeLessThanOrEqual(MAX_MAIN_TEXT_CHARS)
  })

  it('select_keeps_short_fact_label_with_its_value (regression)', () => {
    // '<p>成分：<br>value</p>' splits into a label block and a value block.
    const lead = PROSE.repeat(40).slice(0, 3000)
    const value = '乳木果油、荷荷芭油、甜杏仁油與天然維生素E'
    // Sized so that, without pairing, the filler takes the room the value needs.
    const filler = SHARE_PARAGRAPH.replace('分享', '').repeat(20).slice(0, 1086)
    const blocks = [lead, filler, '成分：', value]
    const { mainText } = selectPageText(blocks)
    expect(mainText).toContain(`成分： ${value}`)
    expect(mainText.length).toBeLessThanOrEqual(MAX_MAIN_TEXT_CHARS)
  })

  it('select_all_ages_phrase_is_not_a_spec', () => {
    const blocks = ['A handmade clay plate.', '大小朋友都愛！加入會員享優惠']
    const { mainText } = selectPageText(blocks)
    expect(mainText).toBe('A handmade clay plate.')
  })

  it('select_oversized_lead_keeps_later_fact (regression)', () => {
    const description = PROSE.repeat(60).slice(0, 5000)
    const { mainText, textStats } = selectPageText([description, '尺寸 20cm'])
    expect(mainText.startsWith(description.slice(0, LEAD_CHARS))).toBe(true)
    expect(mainText).toContain('尺寸 20cm')
    expect(mainText.length).toBeLessThanOrEqual(MAX_MAIN_TEXT_CHARS)
    expect(textStats.truncated).toBe(true)
  })

  it('select_slice_never_splits_surrogate_pair', () => {
    const block = 'a'.repeat(MAX_MAIN_TEXT_CHARS - 1) + '\u{1F600}' + 'b'.repeat(100)
    const { mainText } = selectPageText([block])
    expect(mainText).toBe('a'.repeat(MAX_MAIN_TEXT_CHARS - 1))
  })

  it('select_keeps_lead_and_document_order', () => {
    const blocks = [
      '分享',
      'First real block',
      'Second block',
      '保養：手洗',
      'Third block',
      '材質：陶土',
    ]
    const { mainText } = selectPageText(blocks)
    expect(mainText).toContain('First real block')
    const order = ['First real block', 'Second block', '保養：手洗', 'Third block', '材質：陶土']
    const positions = order.map((b) => mainText.indexOf(b))
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1])
    }
  })

  it('select_priority_when_budget_tight', () => {
    const lead = 'x'.repeat(2000)
    const care = '保養方式：' + 'c'.repeat(1495)
    const materials = '材質說明：' + 'm'.repeat(1495)
    // Care precedes materials in document order; only one of them fits.
    const { mainText, textStats } = selectPageText([lead, care, materials])
    expect(mainText).toContain(materials)
    expect(mainText).not.toContain(care)
    expect(mainText.indexOf(lead)).toBe(0)
    expect(textStats.truncated).toBe(true)
  })

  it('select_all_chrome_falls_back_to_prefix', () => {
    const blocks = ['加入購物車', '分享 this page', 'shipping info', '會員登入']
    const { mainText } = selectPageText(blocks)
    expect(mainText).not.toBe('')
    expect(mainText).toBe(blocks.join(' ').slice(0, MAX_MAIN_TEXT_CHARS))
  })

  it('select_slices_single_oversized_block', () => {
    const { mainText, textStats } = selectPageText(['y'.repeat(10_000)])
    expect(mainText.length).toBe(MAX_MAIN_TEXT_CHARS)
    expect(textStats.truncated).toBe(true)
    expect(textStats.fullChars).toBe(10_000)
    expect(textStats.includedChars).toBe(MAX_MAIN_TEXT_CHARS)
  })

  it('select_text_stats', () => {
    // Lengths: 14, 9 (5-char token + 4), 9 (chrome), 4 -> 36 + 3 separators = 39.
    const blocks = ['Lead text here', '{{x}}Body', '送貨方式 fast', '材質：棉']
    const { mainText, textStats } = selectPageText(blocks)
    expect(mainText).toBe('Lead text here Body 材質：棉')
    expect(textStats).toEqual({
      fullChars: 39,
      includedChars: 24,
      boilerplateChars: 14,
      truncated: false,
    })
  })

  it('select_empty_blocks_yield_empty_text', () => {
    expect(selectPageText([])).toEqual({
      mainText: '',
      textStats: { fullChars: 0, includedChars: 0, boilerplateChars: 0, truncated: false },
    })
  })

  it('select_drops_blocks_in_repeated_set', () => {
    const { mainText } = selectPageText(['Intro', LONG_NOTICE, '材質：陶土'], {
      repeated: new Set([LONG_NOTICE]),
    })
    expect(mainText).toBe('Intro 材質：陶土')
  })
})

// ---------------------------------------------------------------------------
// selectAcrossPages
// ---------------------------------------------------------------------------

describe('selectAcrossPages', () => {
  it('across_pages_keeps_repeated_fact_block', () => {
    // Shape seen on production (entadar): one brand-wide material + care block on every page.
    const sharedFacts =
      '本品牌使用的PU皮革皆為無溶劑皮革，製造過程並無使用有毒的溶劑。保養方式：請使用不會起棉絮的布沾溼之後擦拭即可清理，所有商品都不能以洗衣機清洗，洗衣機滾動過程可能損壞皮革表面。'.repeat(2)
    const pages = Array.from({ length: 6 }, (_, i) =>
      page(i, [`Product ${i} intro text`, sharedFacts, LONG_NOTICE]),
    )
    const out = selectAcrossPages(pages)
    out.forEach((p) => {
      expect(p.mainText).toContain(sharedFacts)
      expect(p.mainText).not.toContain(LONG_NOTICE)
    })
  })

  it('across_pages_drops_long_repeats', () => {
    const pages = Array.from({ length: 12 }, (_, i) =>
      page(i, [`Product ${i} intro text`, LONG_NOTICE, '材質：925純銀']),
    )
    // Sanity: per-page selection alone keeps the notice; only dedup removes it.
    expect(selectPageText(pages[0].blocks ?? []).mainText).toContain(LONG_NOTICE)

    const out = selectAcrossPages(pages)
    expect(out).toHaveLength(12)
    out.forEach((p, i) => {
      expect(p.mainText).not.toContain(LONG_NOTICE)
      expect(p.mainText).toContain('材質：925純銀')
      expect(p.mainText).toContain(`Product ${i} intro text`)
    })
  })

  it('across_pages_keeps_two_page_shared_block', () => {
    const pages = Array.from({ length: 12 }, (_, i) =>
      page(i, i < 2 ? [`Product ${i}`, LONG_NOTICE] : [`Product ${i}`]),
    )
    const out = selectAcrossPages(pages)
    expect(out[0].mainText).toContain(LONG_NOTICE)
    expect(out[1].mainText).toContain(LONG_NOTICE)
  })

  it('across_pages_below_three_pages_never_dedups', () => {
    const pages = [page(0, ['A', LONG_NOTICE]), page(1, ['B', LONG_NOTICE])]
    const out = selectAcrossPages(pages)
    expect(out[0].mainText).toContain(LONG_NOTICE)
    expect(out[1].mainText).toContain(LONG_NOTICE)
  })

  it('across_pages_share_ignores_pages_with_empty_blocks', () => {
    const pages = [
      ...Array.from({ length: 3 }, (_, i) =>
        page(i, [`Product ${i} intro text`, LONG_NOTICE, '材質：925純銀']),
      ),
      ...Array.from({ length: 4 }, (_, i) => page(3 + i, [])),
    ]
    const out = selectAcrossPages(pages)
    for (const p of out.slice(0, 3)) expect(p.mainText).not.toContain(LONG_NOTICE)
  })

  it('across_pages_counts_duplicate_urls_once', () => {
    const shared = 'https://brand.example/p/shared'
    const pages = Array.from({ length: 3 }, (_, i) => ({
      ...page(i, [`Product ${i} intro text`, LONG_NOTICE]),
      url: shared,
    }))
    const out = selectAcrossPages(pages)
    for (const p of out) expect(p.mainText).toContain(LONG_NOTICE)
  })

  it('across_pages_passes_through_pages_without_blocks', () => {
    const legacy = { url: 'https://brand.example/legacy', mainText: 'recorded text' }
    const out = selectAcrossPages([legacy, page(1, ['Fresh block'])])
    expect(out[0]).toEqual(legacy)
    expect(out[0].mainText).toBe('recorded text')
    expect(out[1].mainText).toBe('Fresh block')
  })

  it('across_pages_strips_blocks', () => {
    const pages = [page(0, ['A']), page(1, undefined), page(2, ['C'])]
    const out = selectAcrossPages(pages)
    for (const p of out) expect('blocks' in p).toBe(false)
    expect(out[0].mainText).toBe('A')
    expect(out[0].textStats?.fullChars).toBe(1)
  })

  it('across_pages_normalizes_whitespace_and_width_for_repeat_key', () => {
    // NFKC folds full-width Latin; whitespace runs collapse and trim.
    const base = 'ABC ' + LONG_NOTICE
    const variant = 'ＡＢＣ   ' + LONG_NOTICE + '  '
    const pages = [page(0, ['A', base]), page(1, ['B', variant]), page(2, ['C', base])]
    const out = selectAcrossPages(pages)
    for (const p of out) expect(p.mainText).not.toContain('本店')
  })
})
