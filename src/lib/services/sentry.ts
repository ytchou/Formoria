type SentryProject = {
  org: string
  project: string
}

let cached: SentryProject | null = null

export async function resolveSentryProject(token: string): Promise<SentryProject> {
  if (cached) return cached

  const response = await fetch('https://sentry.io/api/0/projects/', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  })

  if (!response.ok) {
    throw new Error(`Sentry API returned ${response.status}`)
  }

  const projects = (await response.json()) as Array<{
    slug: string
    organization: { slug: string }
  }>

  if (projects.length === 0) {
    throw new Error('No Sentry projects found for this token')
  }

  cached = { org: projects[0].organization.slug, project: projects[0].slug }
  return cached
}

export function clearSentryProjectCache() {
  cached = null
}
