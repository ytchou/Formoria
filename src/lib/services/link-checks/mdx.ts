/**
 * MDX link checker — checks pre-extracted links from MDX content files.
 *
 * The links arrive from the repo-worker `mdx-links` job (Task 15). This
 * module performs NO filesystem reads — it receives the links as input and
 * checks them over HTTP.
 */

import { stableFingerprint, type HealthFinding } from '@/lib/services/health-agent/contracts'
import { mapWithConcurrency } from '@/lib/services/_shared/concurrency'

import type { CheckUrlResult } from './check-url'
import type { LinkCheckClassResult } from './types'
import { LINK_CHECK_CONCURRENCY, MAX_DEAD_LINKS_PER_FINDING } from './types'

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export type MdxLink = {
  /** The MDX file path (relative to repo root). */
  file: string
  /** The URL extracted from the MDX file. */
  url: string
}

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export type CheckMdxDeps = {
  links: MdxLink[]
  checkUrl: (url: string) => Promise<CheckUrlResult>
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

type DeadLink = {
  file: string
  url: string
  statusCode: number | null
}

export async function checkMdxLinks(
  deps: CheckMdxDeps,
): Promise<LinkCheckClassResult> {
  const { links, checkUrl } = deps

  // Deduplicate by URL — same URL in multiple files is checked once
  const uniqueUrls = [...new Set(links.map((l) => l.url))]
  const urlToFiles = new Map<string, string[]>()
  for (const link of links) {
    const files = urlToFiles.get(link.url) ?? []
    if (!files.includes(link.file)) files.push(link.file)
    urlToFiles.set(link.url, files)
  }

  if (uniqueUrls.length === 0) {
    return { checked: 0, dead: 0, blocked: 0, findings: [] }
  }

  let dead = 0
  let blocked = 0
  const deadLinks: DeadLink[] = []

  await mapWithConcurrency(
    uniqueUrls,
    LINK_CHECK_CONCURRENCY,
    async (url) => {
      const result = await checkUrl(url)
      if (result.status === 'blocked') {
        blocked += 1
      } else if (result.status === 'broken') {
        dead += 1
        const files = urlToFiles.get(url) ?? []
        for (const file of files) {
          deadLinks.push({
            file,
            url,
            statusCode: result.statusCode,
          })
        }
      }
    },
  )

  const findings: HealthFinding[] = []
  if (deadLinks.length > 0) {
    findings.push({
      source: 'links-weekly',
      fingerprint: stableFingerprint('links-weekly', 'dead-mdx-links', 'batch'),
      title: `${deadLinks.length} dead MDX link(s) found`,
      severity: 'medium',
      evidence: {
        deadLinks: deadLinks.slice(0, MAX_DEAD_LINKS_PER_FINDING),
        total: deadLinks.length,
        blocked,
      },
      mergePolicy: 'human',
    })
  }

  return { checked: uniqueUrls.length, dead, blocked, findings }
}
