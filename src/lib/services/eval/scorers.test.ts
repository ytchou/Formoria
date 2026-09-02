import { languagePurity, lengthBand, classificationPrecision } from './scorers'
import { expect, it } from 'vitest'

it('languagePurity flags English runs inside a zh field and vice versa', () => {
  expect(languagePurity('這是一段完整的繁體中文品牌描述內容', 'zh')).toBe(1)
  expect(languagePurity('這個品牌 offers great quality products 給大家', 'zh')).toBeLessThan(0.8)
  expect(languagePurity('A fully English description of the brand.', 'en')).toBe(1)
})
it('lengthBand checks inclusive char bands', () => {
  expect(lengthBand('a'.repeat(400), [300, 600])).toBe(true)
  expect(lengthBand('short', [300, 600])).toBe(false)
})
it('classificationPrecision compares predicted vs labeled image tags', () => {
  const labeled = [{ url: 'u1', junk: true }, { url: 'u2', junk: false }]
  // `promo` is a LEGACY tag: only pre-contract rows carry it, and it must still
  // score as junk so historic corpora keep grading correctly.
  const predicted = new Map([['u1', 'promo'], ['u2', 'product']])
  expect(classificationPrecision(labeled, predicted)).toBe(1)
})

it('treats both current keep tags as publishable rather than junk', () => {
  expect(
    classificationPrecision(
      [
        { url: 'i1', junk: false },
        { url: 'i2', junk: false },
      ],
      new Map([
        ['i1', 'logo'],
        ['i2', 'product'],
      ]),
    ),
  ).toBe(1)
})

it('cannot see a rejection that carries no tag — callers must supply one', () => {
  // Documented limitation, not desired behaviour. Under the disposition/reasons
  // contract a rejected image has `tags: null`, and an absent prediction reads
  // as "not junk" here. Callers scoring modern rows must map disposition to a
  // tag before calling; a disposition-aware harness scores them directly.
  expect(
    classificationPrecision([{ url: 'i1', junk: true }], new Map()),
  ).toBe(0)
})
