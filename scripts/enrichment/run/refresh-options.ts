export function validateLocalRenderFlags(args: readonly string[]): boolean {
  const localRender = args.includes('--local-render')
  if (
    localRender &&
    (args.includes('--via-worker') || args.includes('--enqueue-only'))
  ) {
    throw new Error(
      '--local-render cannot be combined with --via-worker or --enqueue-only',
    )
  }
  return localRender
}
