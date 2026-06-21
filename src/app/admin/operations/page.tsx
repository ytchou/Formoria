import type { Metadata } from 'next'

import type { CurationOperation } from '@/app/admin/operations/actions'
import { OperationCard } from '@/components/admin/operation-card'

export const metadata: Metadata = {
  title: '批次操作 | 管理後台',
}

type OperationConfig = {
  operation: CurationOperation
  title: string
  description: string
  showPhasePicker?: boolean
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
        operation: 'cleanup',
        title: 'Cleanup',
        description: 'Clean names, normalize slugs, detect non-brands',
      },
    ],
  },
  {
    title: '品牌充實',
    operations: [
      {
        operation: 'enrich',
        title: 'Enrich',
        description: 'Discover URLs, fill links, download images, fill descriptions',
        showPhasePicker: true,
      },
    ],
  },
  {
    title: '自動分類',
    operations: [
      {
        operation: 'auto-tag',
        title: 'Auto-Tag',
        description: 'Keyword-based category assignment',
      },
    ],
  },
  {
    title: '能見度',
    operations: [
      {
        operation: 'set-visibility',
        title: 'Set Visibility',
        description: 'Final visibility approval',
        warning:
          '⚠ Evaluates each brand individually for approved status, website, description, and name, then sets visibility accordingly.',
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
                  showPhasePicker={operation.showPhasePicker}
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
