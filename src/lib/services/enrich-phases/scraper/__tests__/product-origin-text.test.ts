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
      'Material',
      'linen',
      'Size',
      '30 cm',
      'Div block',
      'Nested',
      'tail',
    ])
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
