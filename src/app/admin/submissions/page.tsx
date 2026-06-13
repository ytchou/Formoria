import { redirect } from 'next/navigation'

export default function SubmissionsPage(): never {
  redirect('/admin/review-queue/submissions')
}
