import { redirect } from 'next/navigation'

export default function BulkImportPage(): never {
  redirect('/admin/catalog/import')
}
