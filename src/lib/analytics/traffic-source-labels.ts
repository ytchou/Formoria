export function trafficSourceLabel(
  source: string,
  labels: Record<string, string>,
): string {
  return labels[source.toLowerCase()] ?? labels.other ?? source
}

export function outboundDestinationLabel(
  destination: string,
  labels: Record<string, string>,
): string {
  return labels[destination.toLowerCase()] ?? labels.other ?? destination
}
