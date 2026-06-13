import { BulkImportForm } from '@/components/admin/bulk-import-form'

export default function BulkImportPage() {
  return (
    <div className="mx-auto max-w-screen-xl px-10 py-8">
      <h1 className="font-heading text-2xl font-bold text-foreground mb-6">批量匯入</h1>
      <BulkImportForm />
    </div>
  )
}
