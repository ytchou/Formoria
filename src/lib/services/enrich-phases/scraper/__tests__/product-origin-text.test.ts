import { describe, expect, it } from 'vitest'
import {
  extractMainTextBlocks,
  extractRenderedMainText,
} from '../product-origin-text'

// Golden captured from extractRenderedMainText before the mainRoot refactor.
const GOLDEN_HTML =
  '<html><head><title>T</title></head><body><header>Site header</header><nav>Menu</nav>' +
  '<main><h1>Linen Tote</h1><p>Hand  sewn<br>in Tainan.</p><ul><li>One</li><li>Two</li></ul>' +
  '<dl><dt>Material</dt><dd>100% linen</dd></dl><table><tr><th>Size</th><td>30 x 40 cm</td></tr></table>' +
  '<div>Care<span>wash cold</span></div><script>var x = 1</script><style>.a{}</style>' +
  '<noscript>Enable JS</noscript><form><input value="q">Search</form><footer>Main footer</footer>' +
  '</main><footer>Site footer</footer></body></html>'
const GOLDEN_TEXT =
  'Linen Tote Hand sewn in Tainan. One Two Material 100% linen Size 30 x 40 cm Carewash cold'

describe('extractMainTextBlocks', () => {
  it('extract_blocks_splits_on_block_elements_and_br', () => {
    const html = `<html><body><main>
      <h1>Title</h1>
      <h3>Sub   heading</h3>
      <p>Line  one<br>Line two</p>
      <ul>
        <li>A</li>
        <li>B</li>
      </ul>
      <dl><dt>Material</dt><dd>linen</dd></dl>
      <table><tr><th>Size</th><td>30 cm</td></tr></table>
      <div>Div   block</div>
      <div><div>Nested</div>tail</div>
      <p>   </p>
    </main></body></html>`

    expect(extractMainTextBlocks(html)).toEqual([
      'Title',
      'Sub heading',
      'Line one',
      'Line two',
      'A',
      'B',
      'Material linen',
      'Size 30 cm',
      'Div block',
      'Nested',
      'tail',
    ])
  })

  it('extract_blocks_keeps_dl_label_with_value', () => {
    const html =
      '<main><dl><dt>材質</dt><dd>100%純棉</dd><dt>產地</dt><dd>台灣</dd></dl></main>'
    expect(extractMainTextBlocks(html)).toEqual(['材質 100%純棉', '產地 台灣'])
  })

  it('extract_blocks_keeps_table_row_together', () => {
    const html =
      '<main><table><tr><th>容量</th><td>350ml</td></tr>' +
      '<tr><th>重量</th><td>200g</td></tr></table></main>'
    expect(extractMainTextBlocks(html)).toEqual(['容量 350ml', '重量 200g'])
  })

  it('extract_blocks_splits_br_label_from_value', () => {
    // Selection (selectPageText) keeps a short fact label with its value.
    const html = '<main><p>成分：<br>乳木果油、荷荷芭油</p></main>'
    expect(extractMainTextBlocks(html)).toEqual(['成分：', '乳木果油、荷荷芭油'])
  })

  it('extract_blocks_source_newlines_do_not_split', () => {
    const html = '<main><p>材質：\n  有機棉</p></main>'
    expect(extractMainTextBlocks(html)).toEqual(['材質： 有機棉'])
  })

  it('extract_blocks_separates_loose_text_before_nested_block', () => {
    const html =
      '<main><div>加入會員<p>這款托特包以厚磅帆布縫製，容量足以裝下筆電與午餐。</p></div></main>'
    expect(extractMainTextBlocks(html)).toEqual([
      '加入會員',
      '這款托特包以厚磅帆布縫製，容量足以裝下筆電與午餐。',
    ])
  })

  it('extract_blocks_private_use_glyph_in_source_does_not_split', () => {
    const html = '<main><p>Hand &#xE000; sewn</p></main>'
    expect(extractMainTextBlocks(html)).toEqual(['Hand sewn'])
  })

  it('extract_blocks_drops_same_elements_as_main_text', () => {
    const html = `<html><body>
      <p>Outside main</p>
      <main>
        <header>Header text</header>
        <nav>Nav text</nav>
        <p>Kept</p>
        <script>scriptText()</script>
        <style>.style-text{}</style>
        <noscript>Noscript text</noscript>
        <form><label>Form text</label></form>
        <footer>Footer text</footer>
      </main>
    </body></html>`

    const blocks = extractMainTextBlocks(html)
    expect(blocks).toEqual(['Kept'])
    const joined = blocks.join('\n')
    for (const dropped of [
      'Outside main',
      'Header text',
      'Nav text',
      'scriptText',
      'style-text',
      'Noscript text',
      'Form text',
      'Footer text',
    ]) {
      expect(joined).not.toContain(dropped)
    }
  })

  it('falls back to body when there is no main element', () => {
    const html =
      '<html><body><nav>Nav</nav><p>Body one</p><p>Body two</p></body></html>'
    expect(extractMainTextBlocks(html)).toEqual(['Body one', 'Body two'])
  })
})

describe('extractRenderedMainText', () => {
  it('extract_rendered_main_text_unchanged', () => {
    expect(extractRenderedMainText(GOLDEN_HTML)).toBe(GOLDEN_TEXT)
  })

  it('is not affected by a prior extractMainTextBlocks call', () => {
    extractMainTextBlocks(GOLDEN_HTML)
    expect(extractRenderedMainText(GOLDEN_HTML)).toBe(GOLDEN_TEXT)
  })
})
