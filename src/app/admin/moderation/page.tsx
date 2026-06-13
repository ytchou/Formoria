import { redirect } from 'next/navigation'

export default function ModerationPage(): never {
  redirect('/admin/review-queue/moderation')
}
