import { describe, it, expect } from 'vitest'
import { convertPinyinToWadeGiles } from '../pinyin-to-wade-giles'

describe('convertPinyinToWadeGiles', () => {
  it('converts single pinyin syllable to Wade-Giles', () => {
    expect(convertPinyinToWadeGiles(['ding'])).toEqual(['ting'])
    expect(convertPinyinToWadeGiles(['tai'])).toEqual(['tai'])
    expect(convertPinyinToWadeGiles(['feng'])).toEqual(['feng'])
  })

  it('converts syllables with aspirated consonants (strips apostrophe)', () => {
    expect(convertPinyinToWadeGiles(['pa'])).toEqual(['pa'])
    expect(convertPinyinToWadeGiles(['ta'])).toEqual(['ta'])
    expect(convertPinyinToWadeGiles(['ka'])).toEqual(['ka'])
  })

  it('converts pinyin x to WG hs', () => {
    expect(convertPinyinToWadeGiles(['xin'])).toEqual(['hsin'])
    expect(convertPinyinToWadeGiles(['xi'])).toEqual(['hsi'])
  })

  it('converts pinyin zh to WG ch', () => {
    expect(convertPinyinToWadeGiles(['zhi'])).toEqual(['chih'])
    expect(convertPinyinToWadeGiles(['zhong'])).toEqual(['chung'])
  })

  it('converts pinyin q to WG ch (aspirated, apostrophe stripped)', () => {
    expect(convertPinyinToWadeGiles(['qi'])).toEqual(['chi'])
    expect(convertPinyinToWadeGiles(['quan'])).toEqual(['chuan'])
  })

  it('passes through non-pinyin strings unchanged', () => {
    expect(convertPinyinToWadeGiles(['hello'])).toEqual(['hello'])
    expect(convertPinyinToWadeGiles(['Brand'])).toEqual(['Brand'])
  })

  it('handles full brand name syllable arrays', () => {
    expect(convertPinyinToWadeGiles(['ding', 'tai', 'feng'])).toEqual(['ting', 'tai', 'feng'])
    expect(convertPinyinToWadeGiles(['yu', 'he'])).toEqual(['yu', 'ho'])
    expect(convertPinyinToWadeGiles(['guang', 'yuan', 'liang'])).toEqual(['kuang', 'yuan', 'liang'])
  })

  it('handles mixed CJK and Latin (nonZh consecutive)', () => {
    expect(convertPinyinToWadeGiles(['iliz'])).toEqual(['iliz'])
    expect(convertPinyinToWadeGiles(['MIT', 'tai', 'wan'])).toEqual(['MIT', 'tai', 'wan'])
  })
})
