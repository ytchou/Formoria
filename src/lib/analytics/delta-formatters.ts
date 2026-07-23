export type MetricDelta = {
  direction: 'up' | 'down' | 'flat'
  text: string
}

export function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

export function direction(value: number): MetricDelta['direction'] {
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'flat'
}

export function countDelta(
  current: number,
  prior: number | null,
): MetricDelta | undefined {
  if (prior === null || prior === 0) return undefined
  const change = ((current - prior) / prior) * 100
  return {
    direction: direction(change),
    text: `${change > 0 ? '↑' : change < 0 ? '↓' : '—'} ${Math.abs(Math.round(change))}%`,
  }
}

export function rateDelta(
  current: number | null,
  prior: number | null,
): MetricDelta | undefined {
  if (current === null || prior === null || prior === 0) return undefined
  const change = (current - prior) * 100
  return {
    direction: direction(change),
    text: `${change > 0 ? '↑' : change < 0 ? '↓' : '—'} ${Math.abs(change).toFixed(1)}pp`,
  }
}
