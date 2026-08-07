import { describe, expect, it } from 'vitest'
import { CRAWLER_REGISTRY, matchCrawler, robotsTokenFor } from '../crawler-registry'

describe('crawler registry', () => {
  it('every entry has a purpose, policy, reviewDate and owner', () => {
    for (const entry of CRAWLER_REGISTRY) {
      expect(entry.name).toBeTruthy()
      expect(entry.purpose).toBeTruthy()
      expect(entry.policy).toBeTruthy()
      expect(entry.reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.owner).toBe('growth')
    }
  })

  it('every ai-search entry records citesSources and expectedBenefit', () => {
    for (const entry of CRAWLER_REGISTRY.filter(({ purpose }) => purpose === 'ai-search')) {
      expect(typeof entry.citesSources).toBe('boolean')
      expect(entry.expectedBenefit).toBeTruthy()
    }
  })

  it('matchCrawler returns the entry for a known UA', () => {
    const cases = [
      ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
      ['Bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
      ['Google-InspectionTool', 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0)'],
      ['AdsBot-Google', 'Mozilla/5.0 (compatible; AdsBot-Google-Mobile; +http://www.google.com/mobile/adsbot.html)'],
      ['LINE', 'Linespider/1.0 (+https://www.line.me/)'],
      ['facebookexternalhit', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
      ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)'],
      ['PerplexityBot', 'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
    ] as const

    for (const [name, ua] of cases) {
      expect(matchCrawler(ua)?.name).toBe(name)
    }
  })

  it('matchCrawler returns null for a browser UA', () => {
    expect(matchCrawler('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36')).toBeNull()
  })

  it('no two entries match the same UA string', () => {
    for (const entry of CRAWLER_REGISTRY) {
      const probe = `${robotsTokenFor(entry)}/1.0`
      const matches = CRAWLER_REGISTRY.filter(({ uaPattern }) => uaPattern.test(probe))
      expect(matches.map(({ name }) => name)).toEqual([entry.name])
    }
  })

  // A published robots group is selected by product token, so a token its own
  // uaPattern rejects is a dead group (LINE published `LINE` while its crawler
  // sends `Linespider`). Assert the two can never drift apart silently.
  it('every published robots token is matched by its own uaPattern', () => {
    for (const entry of CRAWLER_REGISTRY) {
      expect(entry.uaPattern.test(robotsTokenFor(entry))).toBe(true)
    }
  })

  it("every entry policy is 'allow' at this revision", () => {
    expect(CRAWLER_REGISTRY.every(({ policy }) => policy === 'allow')).toBe(true)
  })

  it('only PerplexityBot and ChatGPT-User carry trustedUnverified', () => {
    // Sorted so the assertion pins the SET of carve-outs, not their position in the registry.
    const carveOuts = CRAWLER_REGISTRY.filter((entry) => entry.trustedUnverified)
      .map(({ name }) => name)
      .sort()
    expect(carveOuts).toEqual(['ChatGPT-User', 'PerplexityBot'])
  })

  it('every trustedUnverified entry has a reviewDate', () => {
    for (const entry of CRAWLER_REGISTRY.filter(({ trustedUnverified }) => trustedUnverified)) {
      expect(entry.reviewDate).toBeTruthy()
    }
  })
})
