export default function VerificationLoading() {
  return (
    <div className="h-48 animate-pulse rounded-xl border border-border bg-white p-6">
      <div className="h-5 w-36 rounded bg-muted" />

      <div className="mt-6 space-y-4">
        <div className="h-6 w-24 rounded-full bg-muted" />
        <div className="space-y-2">
          <div className="h-4 w-full max-w-xl rounded bg-muted" />
          <div className="h-4 w-3/4 rounded bg-muted" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-4 w-40 rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}
