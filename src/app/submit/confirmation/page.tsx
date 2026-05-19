import { Check, Home, Plus } from 'lucide-react'
import Link from 'next/link'

export const metadata = {
  title: 'Submission Received | MIT Map',
  description: 'Your brand submission has been received and is being reviewed.',
}

const TIMELINE_STEPS = [
  {
    label: 'Review in progress',
    description: 'Our team typically reviews within 3 business days',
    active: true,
  },
  {
    label: "We'll reach out if we need more info",
    description: 'You may receive an email with follow-up questions',
    active: false,
  },
  {
    label: 'Your brand goes live',
    description: "Once approved, it'll appear in the MIT Map directory",
    active: false,
  },
]

export default function ConfirmationPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-[560px] rounded-2xl border border-[#E8E5E0] bg-white p-10 shadow-sm">
        {/* Success badge */}
        <div className="flex justify-center">
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#E06B3F]">
            <Check className="h-8 w-8 text-white" strokeWidth={3} />
          </div>
        </div>

        {/* Heading */}
        <h1 className="mt-6 text-center font-display text-[26px] font-bold text-[#1A1918]">
          Thank You!
        </h1>
        <p className="mt-2 text-center text-[15px] text-[#7C7570]">
          Your brand submission has been received
        </p>

        {/* Timeline */}
        <div className="mt-8 rounded-xl bg-[#FAFAF8] p-6">
          <div className="space-y-4">
            {TIMELINE_STEPS.map((step, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`h-3 w-3 shrink-0 rounded-full ${
                      step.active ? 'bg-[#E06B3F]' : 'bg-[#D4CFC9]'
                    }`}
                  />
                  {i < TIMELINE_STEPS.length - 1 && (
                    <div className="mt-1 h-full w-px bg-[#D4CFC9]" />
                  )}
                </div>
                <div className="pb-4">
                  <p
                    className={`text-sm font-semibold ${
                      step.active ? 'text-[#1A1918]' : 'text-[#7C7570]'
                    }`}
                  >
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-xs text-[#B0AAA4]">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTAs */}
        <div className="mt-8 space-y-3">
          <Link
            href="/"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#E06B3F] px-5 py-3 text-sm font-medium text-white hover:bg-[#C85A33]"
          >
            <Home className="h-4 w-4" />
            Explore the MIT Map Directory
          </Link>
          <Link
            href="/submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#D4CFC9] bg-white px-5 py-3 text-sm font-medium text-[#1A1918] hover:bg-[#F5F4F1]"
          >
            <Plus className="h-4 w-4" />
            Submit another brand
          </Link>
        </div>
      </div>
    </div>
  )
}
