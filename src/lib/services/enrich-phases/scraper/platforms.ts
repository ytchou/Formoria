export type PlatformId =
  | 'shopline'
  | '91app'
  | 'shop2000'
  | 'cyberbiz'
  | 'pinkoi'
  | 'shopee'
  | 'myship'
  | 'shopify'
  | 'easystore'
  | 'meepshop'
  | 'waca'
  | 'oen'

type PlatformRule = {
  id: PlatformId
  hosts: readonly string[]
  fingerprints: readonly RegExp[]
  productRoute: RegExp
}

const RULES: readonly PlatformRule[] = [
  {
    id: 'pinkoi',
    hosts: ['pinkoi.com'],
    fingerprints: [/cdn01\.pinkoi\.com/i],
    productRoute: /^\/product\/[^/]+/i,
  },
  {
    id: 'shopee',
    hosts: ['shopee.tw', 'shopee.com.tw'],
    fingerprints: [/susercontent\.com/i],
    productRoute: /(?:\/product\/[^/]+\/[^/]+|[-.]i\.\d+\.\d+)/i,
  },
  {
    id: 'myship',
    hosts: ['myship.7-11.com.tw'],
    fingerprints: [/\/i\/cgdm\/GM\d+/i],
    productRoute: /^\/general\/detail\/GM\d+/i,
  },
  {
    id: 'shopline',
    hosts: ['shoplineapp.com', 'shopline.tw'],
    fingerprints: [/shopline(?:app|img)?\.com/i, /Shopline\.theme/i],
    productRoute: /^\/products\/[^/]+/i,
  },
  {
    id: '91app',
    hosts: ['91app.com'],
    fingerprints: [/91APP/i, /SalePage\/Index/i],
    productRoute: /^\/(?:v2\/official\/)?SalePage\/Index\/\d+/i,
  },
  {
    id: 'shop2000',
    hosts: ['shop2000.com.tw'],
    fingerprints: [/shop2000\.com\.tw/i],
    productRoute: /(?:\/product\/[^/]+|[?&](?:id|prod|product_id)=\d+)/i,
  },
  {
    id: 'cyberbiz',
    hosts: ['cyberbiz.co'],
    fingerprints: [/cyberbiz(?:\.co)?/i],
    productRoute: /^\/products\/[^/]+/i,
  },
  {
    id: 'shopify',
    hosts: ['myshopify.com'],
    fingerprints: [/cdn\.shopify\.com/i, /Shopify\.theme/i],
    productRoute: /^\/products\/[^/]+/i,
  },
  {
    id: 'easystore',
    hosts: ['easy.co'],
    fingerprints: [/easystore/i],
    productRoute: /^\/products\/[^/]+/i,
  },
  {
    id: 'meepshop',
    hosts: ['meepshop.com'],
    fingerprints: [/meepshop/i],
    productRoute: /^\/products?\/[^/]+/i,
  },
  {
    id: 'waca',
    hosts: ['waca.ec'],
    fingerprints: [/waca(?:\.ec)?/i],
    productRoute: /^\/product\/detail\/\d+/i,
  },
  {
    id: 'oen',
    hosts: ['oen.tw'],
    fingerprints: [/oen(?:\.tw)?/i],
    productRoute: /^\/products?\/[^/]+/i,
  },
]

function hostMatches(hostname: string, expected: string): boolean {
  return hostname === expected || hostname.endsWith(`.${expected}`)
}

export function identifyPlatform(url: string, html = ''): PlatformId | null {
  let hostname = ''
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }

  const hostRule = RULES.find((rule) =>
    rule.hosts.some((host) => hostMatches(hostname, host)),
  )
  if (hostRule) return hostRule.id

  const sample = html.slice(0, 100_000)
  return (
    RULES.find((rule) =>
      rule.fingerprints.some((fingerprint) => fingerprint.test(sample)),
    )?.id ?? null
  )
}

export function isOwnedProductRoute(
  candidateUrl: string,
  sourceUrl: string,
  platform: PlatformId | null = identifyPlatform(sourceUrl),
): boolean {
  let candidate: URL
  let source: URL
  try {
    candidate = new URL(candidateUrl)
    source = new URL(sourceUrl)
  } catch {
    return false
  }

  const sameHost =
    candidate.hostname.replace(/^www\./i, '').toLowerCase() ===
    source.hostname.replace(/^www\./i, '').toLowerCase()
  if (!sameHost) return false
  if (!platform)
    return /^\/(?:products?|items?|goods)\/[^/]+/i.test(candidate.pathname)

  const rule = RULES.find((entry) => entry.id === platform)
  return (
    rule?.productRoute.test(`${candidate.pathname}${candidate.search}`) ?? false
  )
}
