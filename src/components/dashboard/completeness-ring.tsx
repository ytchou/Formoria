export function CompletenessRing({ score }: { score: number }) {
  const normalizedScore = Math.min(100, Math.max(0, score))

  return (
    <span
      aria-label={`${normalizedScore}%`}
      className="relative flex size-12 shrink-0 items-center justify-center"
      role="img"
    >
      <svg aria-hidden="true" className="absolute inset-0 size-full -rotate-90">
        <circle
          className="stroke-muted"
          cx="24"
          cy="24"
          fill="none"
          r="20"
          strokeWidth="4"
        />
        <circle
          className="stroke-primary"
          cx="24"
          cy="24"
          fill="none"
          pathLength="100"
          r="20"
          strokeDasharray="100"
          strokeDashoffset={100 - normalizedScore}
          strokeLinecap="round"
          strokeWidth="4"
        />
      </svg>
      <span className="type-label tabular-nums">
        {normalizedScore}%
      </span>
    </span>
  )
}
