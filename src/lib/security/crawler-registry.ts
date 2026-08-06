// Every crawler is allowed at this revision; the allow/block matrix is deliberately deferred pending referral data.

export type CrawlerPurpose = 'search' | 'social' | 'ai-search' | 'ai-training' | 'seo' | 'agent' | 'monitoring'
export type CrawlerPolicy = 'allow' | 'block' | 'behavioral'

export interface CrawlerEntry {
  name: string
  uaPattern: RegExp
  purpose: CrawlerPurpose
  policy: CrawlerPolicy
  citesSources?: boolean
  expectedBenefit?: string
  reviewDate: string
  owner: string
  // Cloudflare delisted Perplexity from verified bots in 2025, so without this carve-out these two silently lose their rate-limit exemption; the cost is that a spoofer claiming either UA gets 200 req/min rather than being limited.
  trustedUnverified?: true
}

const OWNER = 'growth'
const REVIEW_DATE = '2026-11-30'

export const CRAWLER_REGISTRY: readonly CrawlerEntry[] = [
  {
    name: 'Googlebot-Image',
    uaPattern: /Googlebot-Image/i,
    purpose: 'search',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Google-InspectionTool',
    uaPattern: /Google-InspectionTool/i,
    purpose: 'search',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'AdsBot-Google',
    uaPattern: /AdsBot-Google/i,
    purpose: 'seo',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Applebot-Extended',
    uaPattern: /Applebot-Extended/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Google-Extended',
    uaPattern: /Google-Extended/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Claude-SearchBot',
    uaPattern: /Claude-SearchBot/i,
    purpose: 'ai-search',
    policy: 'allow',
    citesSources: true,
    expectedBenefit: 'Helps Claude retrieve pages for sourced answers',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Meta-ExternalAgent',
    uaPattern: /Meta-ExternalAgent/i,
    purpose: 'agent',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Threadsbot',
    uaPattern: /Threadsbot/i,
    purpose: 'social',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    // Meta's documented link-preview fetcher, which is what unfurls Instagram and Threads
    // shares. A bare /Instagram/i pattern would also match the Instagram in-app browser,
    // whose UA belongs to a HUMAN reader -- that would hand every in-app session the
    // crawler rate-limit exemption, so the pattern is deliberately narrow.
    name: 'Meta-ExternalFetcher',
    uaPattern: /Meta-ExternalFetcher/i,
    purpose: 'social',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'facebookexternalhit',
    uaPattern: /facebookexternalhit/i,
    purpose: 'social',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'LinkedInBot',
    uaPattern: /LinkedInBot/i,
    purpose: 'social',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Twitterbot',
    uaPattern: /Twitterbot/i,
    purpose: 'social',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Slackbot',
    uaPattern: /Slackbot/i,
    purpose: 'social',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Discordbot',
    uaPattern: /Discordbot/i,
    purpose: 'social',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'WhatsApp',
    uaPattern: /WhatsApp/i,
    purpose: 'social',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'LINE',
    uaPattern: /linespider/i,
    purpose: 'social',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Googlebot',
    uaPattern: /Googlebot(?!-)/i,
    purpose: 'search',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Bingbot',
    uaPattern: /Bingbot/i,
    purpose: 'search',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Applebot',
    uaPattern: /Applebot(?!-)/i,
    purpose: 'search',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'DuckDuckBot',
    uaPattern: /DuckDuckBot/i,
    purpose: 'search',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'YandexBot',
    uaPattern: /YandexBot/i,
    purpose: 'search',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Slurp',
    uaPattern: /Slurp/i,
    purpose: 'search',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'GPTBot',
    uaPattern: /GPTBot/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'ChatGPT-User',
    uaPattern: /ChatGPT-User/i,
    purpose: 'ai-search',
    policy: 'allow',
    citesSources: true,
    expectedBenefit: 'Supports ChatGPT retrieval for user-requested pages',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
    // Cloudflare delisted Perplexity from verified bots in 2025, so without this carve-out these two silently lose their rate-limit exemption; the cost is that a spoofer claiming either UA gets 200 req/min rather than being limited. This review date time-boxes the carve-out.
    trustedUnverified: true,
  },
  {
    name: 'PerplexityBot',
    uaPattern: /PerplexityBot/i,
    purpose: 'ai-search',
    policy: 'allow',
    citesSources: true,
    expectedBenefit: 'Supports Perplexity sourced search results',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
    // Cloudflare delisted Perplexity from verified bots in 2025, so without this carve-out these two silently lose their rate-limit exemption; the cost is that a spoofer claiming either UA gets 200 req/min rather than being limited. This review date time-boxes the carve-out.
    trustedUnverified: true,
  },
  {
    name: 'ClaudeBot',
    uaPattern: /ClaudeBot/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Bytespider',
    uaPattern: /Bytespider/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Amazonbot',
    uaPattern: /Amazonbot/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'CCBot',
    uaPattern: /CCBot/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Diffbot',
    uaPattern: /Diffbot/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'cohere-ai',
    uaPattern: /cohere-ai/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'Timpibot',
    uaPattern: /Timpibot/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
  {
    name: 'YouBot',
    uaPattern: /YouBot/i,
    purpose: 'ai-training',
    policy: 'allow',
    reviewDate: REVIEW_DATE,
    owner: OWNER,
  },
]

export function matchCrawler(ua: string): CrawlerEntry | null {
  return CRAWLER_REGISTRY.find(({ uaPattern }) => uaPattern.test(ua)) ?? null
}
