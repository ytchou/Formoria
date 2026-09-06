/**
 * Probe evidence collection utility. Performs free HTTP GET requests on known
 * URLs to collect title, description, platform, and response status. Feeds
 * into detect as supplementary context.
 *
 * No side effects, no DB writes, no LLM calls.
 */

import { isPrivateUrl } from '@/lib/url'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProbeEvidence = {
  url: string
  title?: string
  description?: string
  platform?: string
  status?: number
  /**
   * Follower count read off an Instagram profile's og:description. Optional
   * and best-effort: Instagram serves the number only to some requests, and a
   * missing count is never evidence that the account is small.
   */
  instagramFollowers?: number
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

const PLATFORM_PATTERNS: Array<{ pattern: RegExp; platform: string }> = [
  { pattern: /instagram\.com/i, platform: 'instagram' },
  // Both hosts: Meta migrated Threads to threads.com, and a threads.net-only
  // pattern silently left every current profile URL unlabelled.
  { pattern: /threads\.(?:net|com)/i, platform: 'threads' },
  { pattern: /facebook\.com|fb\.com/i, platform: 'facebook' },
  { pattern: /pinkoi\.com/i, platform: 'pinkoi' },
  { pattern: /shopee\.\w+/i, platform: 'shopee' },
  { pattern: /twitter\.com|x\.com/i, platform: 'twitter' },
  { pattern: /youtube\.com|youtu\.be/i, platform: 'youtube' },
  { pattern: /linkedin\.com/i, platform: 'linkedin' },
]

function detectPlatform(url: string): string | undefined {
  for (const { pattern, platform } of PLATFORM_PATTERNS) {
    if (pattern.test(url)) return platform
  }
  return undefined
}

// ---------------------------------------------------------------------------
// HTML head extraction — lightweight regex, no DOM parser needed
// ---------------------------------------------------------------------------

function extractTitle(html: string): string | undefined {
  // Try <title> first
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html)
  if (titleMatch?.[1]?.trim()) return titleMatch[1].trim()

  // Fall back to og:title
  const ogTitleMatch = /<meta\s+(?:[^>]*?\s)?(?:property|name)=["']og:title["'][^>]*?\scontent=["']([^"']+)["']/i.exec(html)
    ?? /<meta\s+(?:[^>]*?\s)?content=["']([^"']+)["'][^>]*?\s(?:property|name)=["']og:title["']/i.exec(html)
  if (ogTitleMatch?.[1]?.trim()) return ogTitleMatch[1].trim()

  return undefined
}

function extractDescription(html: string): string | undefined {
  // Try meta description first
  const descMatch = /<meta\s+(?:[^>]*?\s)?name=["']description["'][^>]*?\scontent=["']([^"']+)["']/i.exec(html)
    ?? /<meta\s+(?:[^>]*?\s)?content=["']([^"']+)["'][^>]*?\sname=["']description["']/i.exec(html)
  if (descMatch?.[1]?.trim()) return descMatch[1].trim()

  // Fall back to og:description
  const ogDescMatch = /<meta\s+(?:[^>]*?\s)?(?:property|name)=["']og:description["'][^>]*?\scontent=["']([^"']+)["']/i.exec(html)
    ?? /<meta\s+(?:[^>]*?\s)?content=["']([^"']+)["'][^>]*?\s(?:property|name)=["']og:description["']/i.exec(html)
  if (ogDescMatch?.[1]?.trim()) return ogDescMatch[1].trim()

  return undefined
}

/**
 * The follower count inside an Instagram og:description.
 *
 * Instagram renders it as `8,014 Followers, 1 Following, 42 Posts - …`, and
 * abbreviates past a thousand (`1.6K`, `12M`). Regex only, matching the rest of
 * this module: no DOM parser is loaded here.
 */
export function parseInstagramFollowers(
  description: string | undefined,
): number | undefined {
  if (!description) return undefined

  const match = /([\d,.]+)\s*([KM])?\s+Followers/i.exec(description)
  if (!match) return undefined

  const value = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(value)) return undefined

  const multiplier =
    match[2]?.toUpperCase() === 'M'
      ? 1_000_000
      : match[2]?.toUpperCase() === 'K'
        ? 1_000
        : 1

  return Math.round(value * multiplier)
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5_000
const MAX_BODY_BYTES = 512 * 1024 // 512 KB — only need <head>

async function probeSingleUrl(
  url: string,
  timeout: number,
): Promise<ProbeEvidence> {
  const evidence: ProbeEvidence = { url }
  const platform = detectPlatform(url)
  if (platform) evidence.platform = platform

  // Guard: reject private/localhost URLs
  if (isPrivateUrl(url)) return evidence

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Formoria-Bot/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })

    clearTimeout(timer)
    evidence.status = response.status

    if (response.ok) {
      // Read a bounded chunk of the response for head extraction
      const text = await response.text()
      const bounded = text.slice(0, MAX_BODY_BYTES)

      evidence.title = extractTitle(bounded)
      evidence.description = extractDescription(bounded)

      if (platform === 'instagram') {
        const followers = parseInstagramFollowers(evidence.description)
        if (followers !== undefined) evidence.instagramFollowers = followers
      }
    }
  } catch {
    // Timeout, network error, or abort — return what we have (url + platform)
  }

  return evidence
}

/**
 * Probes a list of URLs with bounded concurrency, extracting title, description,
 * and platform from the HTML head. Returns one ProbeEvidence per input URL, even
 * on failure (with only `url` and optionally `platform` populated).
 */
export async function probeStatic(
  urls: string[],
  options?: { timeout?: number },
): Promise<ProbeEvidence[]> {
  if (urls.length === 0) return []

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS

  // Bounded concurrency: process 4 at a time
  const results: ProbeEvidence[] = []
  const batchSize = 4

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(
      batch.map((url) => probeSingleUrl(url, timeout)),
    )

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      if (result.status === 'fulfilled') {
        results.push(result.value)
      } else {
        // Should not happen (probeSingleUrl catches internally), but safety net
        results.push({ url: batch[j] })
      }
    }
  }

  return results
}
