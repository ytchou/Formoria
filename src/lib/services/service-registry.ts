export type ServiceCategory =
  | 'database'
  | 'ai'
  | 'search'
  | 'email'
  | 'security'
  | 'analytics'
  | 'observability'
  | 'hosting'
  | 'tooling'
  | 'registry'

export type ServiceCriticality =
  'customer-critical' | 'customer-flow' | 'back-office' | 'dev-tooling'

export type ServiceStatus = 'active' | 'unwired' | 'dormant'
export type ServicePlanKind = 'free' | 'subscription' | 'metered' | 'usage'
export type ServiceMeter = 'llm-tokens' | 'serper-credits' | 'resend-sends'

export interface ServicePlan {
  kind: ServicePlanKind
  monthlyUsd?: number
  asOf: string
  sourceUrl: string
}

export interface ServiceQuota {
  metric: string
  included: number
  unit: string
  overageUsdPerUnit: number
  cycleResetsOnDay: number
}

export interface ServiceEntry {
  id: string
  name: string
  vendor: string
  category: ServiceCategory
  criticality: ServiceCriticality
  envVars: readonly string[]
  status: ServiceStatus
  plan: ServicePlan
  quota?: ServiceQuota
  meter?: ServiceMeter
  probe?: 'executive-health'
  blindSpots?: readonly string[]
  dashboardUrl?: string
  notes?: string
}

export interface InventoryPlan {
  kind: ServicePlanKind
  monthlyUsd: number | null
  asOf: string
}

export interface InventoryQuota {
  metric: string
  included: number
  unit: string
  cycleResetsOnDay: number
}

export interface InventoryEntry {
  id: string
  name: string
  vendor: string
  category: ServiceCategory
  criticality: ServiceCriticality
  status: ServiceStatus
  plan: InventoryPlan
  quota: InventoryQuota | null
  dashboardUrl: string | null
}

export const NON_SERVICE_ENV: Readonly<Record<string, string>> = {
  CHALLENGE_SECRET:
    'Internal challenge-cookie signing secret, not a provider service.',
  CLAIM_TOKEN_SECRET:
    'Internal claim-token signing secret, not a provider service.',
  FORMORIA_LINK_HEALTH_URL: 'Optional internal health-agent link target.',
  NEXT_PUBLIC_SITE_URL:
    'Public host used by absolute links and the availability probe; not a credential.',
  ORIGIN_SECRET: 'Internal machine-caller authentication secret.',
  PERSONAL_OS_INTERNAL_TOKEN:
    'Shared Formoria-to-personal-os route authentication token.',
  FORMORIA_LINK_HEALTH_ORIGIN_SECRET:
    'Internal health-agent link authentication secret.',
  PR_URL: 'CI notification metadata, not a provider service.',
  SEARCH_LOAD_BASE_URL: 'Load-test target URL, not a provider service.',
}

const TODAY = '2026-08-10'

export const SERVICE_REGISTRY: readonly ServiceEntry[] = [
  {
    id: 'public-site',
    name: 'Public site',
    vendor: 'Formoria',
    category: 'hosting',
    criticality: 'customer-critical',
    envVars: [],
    status: 'active',
    plan: {
      kind: 'subscription',
      monthlyUsd: 5,
      asOf: TODAY,
      sourceUrl: 'https://railway.com/pricing',
    },
    probe: 'executive-health',
    dashboardUrl: 'https://railway.app/dashboard',
    notes:
      'Public availability probe; the hosting bill is represented by Railway.',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    vendor: 'Supabase',
    category: 'database',
    criticality: 'customer-critical',
    envVars: [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'HEALTH_AGENT_READ_DATABASE_URL',
      'HEALTH_AGENT_READ_DATABASE_PASSWORD',
      'HEALTH_AGENT_WRITE_DATABASE_URL',
      'HEALTH_AGENT_WRITE_DATABASE_PASSWORD',
    ],
    status: 'active',
    plan: {
      kind: 'subscription',
      monthlyUsd: 25,
      asOf: TODAY,
      sourceUrl: 'https://supabase.com/pricing',
    },
    quota: {
      metric: 'Storage image transformations',
      included: 100,
      unit: 'origin images / cycle',
      overageUsdPerUnit: 0.005,
      cycleResetsOnDay: 19,
    },
    probe: 'executive-health',
    dashboardUrl: 'https://supabase.com/dashboard',
    notes: 'Published Pro quotas also include 100 GB storage and 100k MAU.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    vendor: 'OpenAI',
    category: 'ai',
    criticality: 'back-office',
    envVars: ['OPENAI_API_KEY'],
    status: 'active',
    plan: {
      kind: 'usage',
      asOf: TODAY,
      sourceUrl: 'https://openai.com/api/pricing/',
    },
    meter: 'llm-tokens',
    probe: 'executive-health',
    dashboardUrl: 'https://platform.openai.com/usage',
    blindSpots: [
      'Eval spend bypasses persistence through CURATION_EVAL_SINK at _shared/ai-results.ts:130-140; model-A/B installs setAuditWriteSeam at scripts/model-ab/run.ts:63.',
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    vendor: 'DeepSeek',
    category: 'ai',
    criticality: 'back-office',
    envVars: ['DEEPSEEK_API_KEY'],
    status: 'dormant',
    plan: {
      kind: 'usage',
      asOf: TODAY,
      sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    },
    meter: 'llm-tokens',
    dashboardUrl: 'https://platform.deepseek.com/usage',
    blindSpots: [
      'Eval spend bypasses persistence through CURATION_EVAL_SINK at _shared/ai-results.ts:130-140; model-A/B installs setAuditWriteSeam at scripts/model-ab/run.ts:63.',
    ],
  },
  {
    id: 'serper',
    name: 'Serper',
    vendor: 'Serper',
    category: 'search',
    criticality: 'back-office',
    envVars: ['SERPER_API_KEY'],
    status: 'active',
    plan: {
      kind: 'subscription',
      monthlyUsd: 50,
      asOf: TODAY,
      sourceUrl: 'https://serper.dev/pricing',
    },
    quota: {
      metric: 'Search credits',
      included: 2500,
      unit: 'credits / cycle',
      overageUsdPerUnit: 0.02,
      cycleResetsOnDay: 1,
    },
    meter: 'serper-credits',
    probe: 'executive-health',
    dashboardUrl: 'https://serper.dev/dashboard',
  },
  {
    id: 'resend',
    name: 'Resend',
    vendor: 'Resend',
    category: 'email',
    criticality: 'customer-flow',
    envVars: ['RESEND_API_KEY', 'E2E_RESEND_API_KEY'],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://resend.com/pricing',
    },
    quota: {
      metric: 'Emails',
      included: 3000,
      unit: 'sends / cycle',
      overageUsdPerUnit: 0,
      cycleResetsOnDay: 1,
    },
    meter: 'resend-sends',
    probe: 'executive-health',
    dashboardUrl: 'https://resend.com/overview',
  },
  {
    id: 'cloudflare-turnstile',
    name: 'Cloudflare Turnstile',
    vendor: 'Cloudflare',
    category: 'security',
    criticality: 'customer-flow',
    envVars: ['NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY'],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://www.cloudflare.com/products/turnstile/',
    },
    probe: 'executive-health',
    dashboardUrl: 'https://dash.cloudflare.com/',
  },
  {
    id: 'cloudflare-origin',
    name: 'Cloudflare origin protection',
    vendor: 'Cloudflare',
    category: 'security',
    criticality: 'customer-critical',
    envVars: ['CF_ORIGIN_SECRET'],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://www.cloudflare.com/plans/free/',
    },
    dashboardUrl: 'https://dash.cloudflare.com/',
  },
  {
    id: 'upstash-redis',
    name: 'Upstash Redis',
    vendor: 'Upstash',
    category: 'database',
    criticality: 'customer-flow',
    envVars: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
    status: 'active',
    plan: {
      kind: 'usage',
      asOf: TODAY,
      sourceUrl: 'https://upstash.com/pricing/redis',
    },
    quota: {
      metric: 'Commands',
      included: 10_000,
      unit: 'commands / cycle',
      overageUsdPerUnit: 0,
      cycleResetsOnDay: 1,
    },
    probe: 'executive-health',
    dashboardUrl: 'https://console.upstash.com/',
  },
  {
    id: 'posthog',
    name: 'PostHog',
    vendor: 'PostHog',
    category: 'analytics',
    criticality: 'back-office',
    envVars: [
      'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN',
      'NEXT_PUBLIC_POSTHOG_HOST',
      'NEXT_PUBLIC_POSTHOG_UI_HOST',
      'POSTHOG_PROJECT_ID',
      'POSTHOG_PERSONAL_API_KEY',
      'POSTHOG_API_HOST',
      'POSTHOG_DASHBOARD_URL',
    ],
    status: 'active',
    plan: {
      kind: 'usage',
      asOf: TODAY,
      sourceUrl: 'https://posthog.com/pricing',
    },
    quota: {
      metric: 'Product analytics events',
      included: 1_000_000,
      unit: 'events / cycle',
      overageUsdPerUnit: 0,
      cycleResetsOnDay: 1,
    },
    probe: 'executive-health',
    dashboardUrl: 'https://us.posthog.com/',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    vendor: 'Sentry',
    category: 'observability',
    criticality: 'customer-critical',
    envVars: [
      'NEXT_PUBLIC_SENTRY_DSN',
      'SENTRY_DSN',
      'SENTRY_AUTH_TOKEN',
      'SENTRY_BASE_URL',
      'SENTRY_ORGANIZATION',
      'SENTRY_PROJECT',
      'SENTRY_READ_TOKEN',
    ],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://sentry.io/pricing/',
    },
    probe: 'executive-health',
    dashboardUrl: 'https://sentry.io/organizations/',
  },
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    vendor: 'Google',
    category: 'analytics',
    criticality: 'back-office',
    envVars: ['NEXT_PUBLIC_GA_ID'],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://marketingplatform.google.com/about/analytics/',
    },
    dashboardUrl: 'https://analytics.google.com/',
  },
  {
    id: 'google-search-console',
    name: 'Google Search Console',
    vendor: 'Google',
    category: 'search',
    criticality: 'back-office',
    envVars: [
      'GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON',
      'GOOGLE_SEARCH_CONSOLE_PROPERTY',
    ],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://search.google.com/search-console/about',
    },
    dashboardUrl: 'https://search.google.com/search-console',
  },
  {
    id: 'slack-formoria',
    name: 'Slack Formoria alerts',
    vendor: 'Slack',
    category: 'observability',
    criticality: 'back-office',
    envVars: ['SLACK_FORMORIA_WEBHOOK_URL'],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://slack.com/pricing',
    },
    dashboardUrl: 'https://app.slack.com/',
  },
  {
    id: 'slack-health',
    name: 'Slack health alerts',
    vendor: 'Slack',
    category: 'observability',
    criticality: 'back-office',
    envVars: ['SLACK_HEALTH_WEBHOOK_URL'],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://slack.com/pricing',
    },
    dashboardUrl: 'https://app.slack.com/',
  },
  {
    id: 'railway-formoria',
    name: 'Railway Formoria app',
    vendor: 'Railway',
    category: 'hosting',
    criticality: 'customer-critical',
    envVars: ['FORMORIA_RAILWAY_URL', 'RAILWAY_LOGS_URL'],
    status: 'active',
    plan: {
      kind: 'usage',
      asOf: TODAY,
      sourceUrl: 'https://railway.com/pricing',
    },
    dashboardUrl: 'https://railway.app/dashboard',
  },
  {
    id: 'railway-curation-worker',
    name: 'Railway curation worker',
    vendor: 'Railway',
    category: 'hosting',
    criticality: 'back-office',
    envVars: [
      'CURATION_WORKER_URL',
      'CURATION_WORKER_CONTROL_TOKEN',
      'RAILWAY_GIT_COMMIT_SHA',
    ],
    status: 'active',
    plan: {
      kind: 'usage',
      asOf: TODAY,
      sourceUrl: 'https://railway.com/pricing',
    },
    probe: 'executive-health',
    dashboardUrl: 'https://railway.app/dashboard',
  },
  {
    id: 'mit-registry',
    name: 'MIT registry',
    vendor: 'Taiwan Ministry of Economic Affairs',
    category: 'registry',
    criticality: 'customer-flow',
    envVars: [],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://keid.nat.gov.tw/mittw/',
    },
    dashboardUrl: 'https://keid.nat.gov.tw/mittw/',
  },
  {
    id: 'linear',
    name: 'Linear',
    vendor: 'Linear',
    category: 'tooling',
    criticality: 'back-office',
    envVars: [
      'LINEAR_OAUTH_ACCESS_TOKEN',
      'LINEAR_OAUTH_CLIENT_ID',
      'LINEAR_OAUTH_CLIENT_SECRET',
      'LINEAR_TEAM_ID',
      'LINEAR_PROJECT_ID',
      'LINEAR_ASSIGNEE_ID',
    ],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://linear.app/pricing',
    },
    probe: 'executive-health',
    dashboardUrl: 'https://linear.app/',
  },
  {
    id: 'github',
    name: 'GitHub',
    vendor: 'GitHub',
    category: 'tooling',
    criticality: 'back-office',
    envVars: [
      'GITHUB_TOKEN',
      'HEALTH_AGENT_GITHUB_APP_ID',
      'HEALTH_AGENT_GITHUB_APP_PRIVATE_KEY',
      'HEALTH_AGENT_GITHUB_APP_INSTALLATION_ID',
    ],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://github.com/pricing',
    },
    probe: 'executive-health',
    dashboardUrl: 'https://github.com/ytchou/Formoria',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude Code Action',
    vendor: 'Anthropic',
    category: 'ai',
    criticality: 'dev-tooling',
    envVars: ['CLAUDE_CODE_OAUTH_TOKEN'],
    status: 'active',
    plan: {
      kind: 'subscription',
      asOf: TODAY,
      sourceUrl: 'https://www.anthropic.com/pricing',
    },
    dashboardUrl: 'https://console.anthropic.com/',
  },
  {
    id: 'agent-hub',
    name: 'Agent Hub',
    vendor: 'Formoria',
    category: 'tooling',
    criticality: 'dev-tooling',
    envVars: [
      'AGENT_HUB_INGEST_URL',
      'AGENT_HUB_INGEST_TOKEN',
      'HEALTH_AGENT_READER_TOKEN',
      'HEALTH_AGENT_WRITER_TOKEN',
    ],
    status: 'active',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://github.com/ytchou/personal-os',
    },
    dashboardUrl: 'https://github.com/ytchou/personal-os',
  },
  {
    id: 'indexnow',
    name: 'IndexNow',
    vendor: 'Microsoft Bing',
    category: 'search',
    criticality: 'back-office',
    envVars: ['INDEXNOW_KEY'],
    status: 'unwired',
    plan: {
      kind: 'free',
      monthlyUsd: 0,
      asOf: TODAY,
      sourceUrl: 'https://www.indexnow.org/',
    },
    notes:
      'Provisioned in environment examples but no production caller is wired.',
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    vendor: 'Google',
    category: 'tooling',
    criticality: 'customer-flow',
    envVars: ['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'],
    status: 'unwired',
    plan: {
      kind: 'usage',
      asOf: TODAY,
      sourceUrl: 'https://mapsplatform.google.com/pricing/',
    },
    dashboardUrl: 'https://console.cloud.google.com/',
    notes:
      'Provisioned for the retail location widget; no production caller is wired.',
  },
]

export function toInventoryProjection(entry: ServiceEntry): InventoryEntry {
  return {
    id: entry.id,
    name: entry.name,
    vendor: entry.vendor,
    category: entry.category,
    criticality: entry.criticality,
    status: entry.status,
    plan: {
      kind: entry.plan.kind,
      monthlyUsd: entry.plan.monthlyUsd ?? null,
      asOf: entry.plan.asOf,
    },
    quota: entry.quota
      ? {
          metric: entry.quota.metric,
          included: entry.quota.included,
          unit: entry.quota.unit,
          cycleResetsOnDay: entry.quota.cycleResetsOnDay,
        }
      : null,
    dashboardUrl: entry.dashboardUrl ?? null,
  }
}
