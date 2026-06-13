import { redirect } from 'next/navigation'

export default function FeedbackPage(): never {
  redirect('/admin/signals/feedback')
}
