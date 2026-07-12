#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export const frontendTokenRoots = ['src/app', 'src/components']

const allowedMatches = [
  {
    file: 'src/components/auth/google-button.tsx',
    names: ['raw hex color literal'],
    values: ['#4285F4', '#34A853', '#FBBC04', '#EA4335'],
  },
  {
    file: 'src/components/brands/share-dialog.tsx',
    names: ['raw hex color class', 'raw hex color literal', 'raw-type-combo'],
    values: ['text-[#07B53B]', '#07B53B', 'text-[#1877F2]', '#1877F2', 'text-sm font-medium'],
  },
  {
    file: 'src/components/brands/brand-links.tsx',
    names: ['raw hex color class', 'raw hex color literal'],
    values: [
      'text-[#E1306C]',
      '#E1306C',
      'text-[#1877F2]',
      '#1877F2',
      'text-[#E05B6F]',
      '#E05B6F',
      'text-[#EE4D2D]',
      '#EE4D2D',
    ],
  },
  {
    file: 'src/components/microsite/__tests__/default-template.test.tsx',
    names: ['raw hex color literal'],
    values: ['#7C5C3E', '#FFFFFF'],
  },
  {
    file: 'src/components/microsite/__tests__/registry.test.ts',
    names: ['raw hex color literal'],
    values: ['#123456', '#FFFFFF', '#000000'],
  },
  {
    file: 'src/components/microsite/tokens.ts',
    names: ['raw hex color literal'],
    values: ['#FFFFFF'],
  },
  {
    file: 'src/components/microsite/contact-cta.tsx',
    names: ['arbitrary numeric text size', 'raw-type-combo'],
    values: ['text-[13px]', 'text-sm font-semibold'],
  },
  {
    file: 'src/components/microsite/hero.tsx',
    names: ['arbitrary numeric text size', 'raw-type-combo'],
    values: ['text-[clamp(2.5rem,8vw,6rem)]', 'text-sm font-semibold'],
  },
  {
    file: 'src/components/microsite/product-grid.tsx',
    names: ['arbitrary numeric text size'],
    values: ['text-[13px]'],
  },
  {
    file: 'src/components/ui/button.tsx',
    names: ['arbitrary numeric text size'],
    values: ['text-[0.8125rem]'],
  },
  // raw-type-combo allowlist — existing code, migrated in wave 0
  {
    file: 'src/app/[locale]/(protected)/favorites/page.tsx',
    names: ['raw-type-combo'],
    values: ['text-3xl font-bold'],
  },
  {
    file: 'src/app/[locale]/getting-started/page.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-bold'],
  },
  {
    file: 'src/app/[locale]/submit/confirmation/page.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-semibold'],
  },
  {
    file: 'src/app/admin/review-queue/moderation/page.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-medium'],
  },
  {
    file: 'src/app/admin/review-queue/submissions/submissions-review-list.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-semibold'],
  },
  {
    file: 'src/app/auth/layout.tsx',
    names: ['raw-type-combo'],
    values: ['text-lg font-semibold'],
  },
  {
    file: 'src/app/layout.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm focus:font-medium'],
  },
  {
    file: 'src/components/admin/admin-nav.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-medium'],
  },
  {
    file: 'src/components/admin/brand-list.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-medium'],
  },
  {
    file: 'src/components/admin/claim-requests-list.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-semibold', 'text-sm font-semibold'],
  },
  {
    file: 'src/components/admin/edit-diff-view.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-semibold'],
  },
  {
    file: 'src/components/admin/feedback-list.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-semibold'],
  },
  {
    file: 'src/components/admin/queue-summary-card.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-semibold', 'text-sm font-medium'],
  },
  {
    file: 'src/components/admin/reports-table.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-semibold'],
  },
  {
    file: 'src/components/admin/status-badge.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-medium'],
  },
  {
    file: 'src/components/auth/account-menu.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-semibold'],
  },
  {
    file: 'src/components/brands/brand-filter-sidebar.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-semibold'],
  },
  {
    file: 'src/components/brands/brand-image-fallback.tsx',
    names: ['raw-type-combo'],
    values: ["font-bold text-foreground ${size === 'detail' ? 'text-5xl' : 'text-3xl"],
  },
  {
    file: 'src/components/brands/brand-locations.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-medium'],
  },
  {
    file: 'src/components/brands/image-carousel.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-medium', 'text-xs font-bold'],
  },
  {
    file: 'src/components/brands/preview-banner.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-medium'],
  },
  {
    file: 'src/components/brands/related-brands.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-medium'],
  },
  {
    file: 'src/components/brands/report-dialog.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-medium'],
  },
  {
    file: 'src/components/brands/search-empty-state.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-semibold', 'text-sm font-medium'],
  },
  {
    file: 'src/components/dashboard/analytics-chart.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-medium'],
  },
  {
    file: 'src/components/dashboard/dashboard-tab-nav.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-medium'],
  },
  {
    file: 'src/components/dashboard/owner-brand-overview.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-semibold'],
  },
  {
    file: 'src/components/dashboard/profile-completeness-card.tsx',
    names: ['raw-type-combo'],
    values: ['text-xs font-bold', 'text-xs font-medium', 'text-xs font-semibold'],
  },
  {
    file: 'src/components/forms/product-tag-field.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-medium'],
  },
  {
    file: 'src/components/newsletter/email-capture-form.tsx',
    names: ['raw-type-combo'],
    values: ['text-sm font-medium'],
  },
]

export const frontendTokenChecks = [
  {
    name: 'raw hex color class',
    pattern: /(?:text|bg|border|stroke|fill)-\[#[0-9A-Fa-f]{3,8}\]/g,
  },
  {
    name: 'raw hex color literal',
    pattern: /#[0-9A-Fa-f]{6}\b/g,
  },
  {
    name: 'arbitrary numeric text size',
    pattern: /text-\[(?:\d|\d*\.)[^\]]+\]/g,
  },
  {
    name: 'direct heading font',
    pattern: /font-heading|font-\[family-name:var\(--font-heading\)\]/g,
  },
  {
    name: 'raw-type-combo',
    pattern: /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b.*\bfont-(medium|semibold|bold)\b|\bfont-(medium|semibold|bold)\b.*\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/g,
  },
]

function isAllowedMatch(file, name, value) {
  return allowedMatches.some(
    (allowed) =>
      allowed.file === file &&
      allowed.names.includes(name) &&
      allowed.values.includes(value),
  )
}

function collectSourceFiles(cwd, root) {
  const absoluteRoot = join(cwd, root)
  if (!existsSync(absoluteRoot)) return []

  const files = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue

    for (const entry of readdirSync(join(cwd, current), {
      withFileTypes: true,
    })) {
      if (entry.name === '.next' || entry.name === 'node_modules') continue

      const child = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(child)
        continue
      }

      if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        files.push(child)
      }
    }
  }

  return files.sort()
}

export function collectFrontendTokenFailures({
  cwd = process.cwd(),
  roots = frontendTokenRoots,
} = {}) {
  const files = roots.flatMap((root) => collectSourceFiles(cwd, root))

  const failures = []

  for (const file of files) {
    const source = readFileSync(join(cwd, file), 'utf8')
    const lines = source.split('\n')

    for (const check of frontendTokenChecks) {
      if (check.name === 'raw-type-combo' && file.startsWith('src/components/ui/')) continue
      for (const [index, line] of lines.entries()) {
        const matches = [...line.matchAll(check.pattern)].map(
          (match) => match[0],
        )
        if (!matches) continue

        for (const value of matches) {
          if (isAllowedMatch(file, check.name, value)) continue

          failures.push({
            file: relative(cwd, join(cwd, file)),
            line: index + 1,
            name: check.name,
            value,
          })
        }
      }
    }
  }

  return failures
}

export function reportFrontendTokenFailures(failures) {
  if (failures.length > 0) {
    console.error('Frontend typography/token guard failed:')
    for (const failure of failures) {
      console.error(
        `${failure.file}:${failure.line} - ${failure.name}: ${failure.value}`,
      )
    }
    console.error(
      'Use semantic type-* utilities, Typography/textStyles variants, and design tokens. Add an allowlist only for real platform/brand-color exceptions.',
    )
    return 1
  }

  console.log('Frontend typography/token guard passed.')
  return 0
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = reportFrontendTokenFailures(
    collectFrontendTokenFailures(),
  )
}
