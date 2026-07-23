export function trafficSourceLabel(
  source: string,
  labels: Record<string, string>,
): string {
  return labels[source.toLowerCase()] ?? labels.other ?? source
}
