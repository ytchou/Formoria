import { redirect } from 'next/navigation'

export default function PendingEditsPage(): never {
  redirect('/admin/review-queue/edits')
}
