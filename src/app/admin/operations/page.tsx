import type { Metadata } from 'next'

import { OperationCard } from '@/components/admin/operation-card'

export const metadata: Metadata = {
  title: '批次操作 | 管理後台',
}

type OperationConfig = {
  operation: string
  title: string
  description: string
  showValidateToggle?: boolean
  warning?: string
}

type OperationSection = {
  title: string
  operations: OperationConfig[]
}

const sections: OperationSection[] = [
  {
    title: '資料清理',
    operations: [
      {
        operation: 'clean-names',
        title: 'Clean Names',
        description: 'Strip emojis, decorative Unicode, marketing suffixes from brand names',
      },
      {
        operation: 'detect-non-brands',
        title: 'Detect Non-Brands',
        description: 'Flag resellers, charities, government entities, placeholder names',
      },
      {
        operation: 'normalize-slugs',
        title: 'Normalize Slugs',
        description: 'Convert CJK slugs to ASCII kebab-case, create redirects',
      },
    ],
  },
  {
    title: '內容充實',
    operations: [
      {
        operation: 'enrich-descriptions',
        title: 'Enrich Descriptions',
        description: 'Fill missing or thin descriptions by scraping brand websites',
      },
      {
        operation: 'auto-tag',
        title: 'Auto-Tag Categories',
        description: 'Auto-assign product categories via keyword matching',
      },
    ],
  },
  {
    title: '品牌充實 (Brand Enrichment)',
    operations: [
      {
        operation: 'enrich',
        title: 'Enrich',
        description: 'Discover brand URLs via Google search, fill links, scrape product images',
        showValidateToggle: true,
      },
    ],
  },
  {
    title: '能見度',
    operations: [
      {
        operation: 'set-visibility',
        title: 'Set Visibility',
        description: 'Bulk approve/hide — hide all brands, then approve specified slugs',
        warning: '⚠ This will hide ALL brands first, then approve only the specified slugs',
      },
    ],
  },
]

export default function AdminOperationsPage() {
  return (
    <div className="space-y-8 bg-[#FAF8F3]">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          批次操作
        </h1>
        <p className="mt-2 text-muted-foreground">
          執行資料清理、內容充實、連結探索與能見度批次作業。
        </p>
      </div>

      <div className="space-y-8">
        {sections.map((section) => (
          <section key={section.title} aria-labelledby={`${section.title}-heading`}>
            <h2
              id={`${section.title}-heading`}
              className="mb-4 text-lg font-semibold text-[#1C1C1C]"
            >
              {section.title}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {section.operations.map((operation) => (
                <OperationCard
                  key={operation.operation}
                  operation={operation.operation}
                  title={operation.title}
                  description={operation.description}
                  showValidateToggle={operation.showValidateToggle}
                >
                  {operation.warning && (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm font-medium text-destructive">
                      {operation.warning}
                    </p>
                  )}
                </OperationCard>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
