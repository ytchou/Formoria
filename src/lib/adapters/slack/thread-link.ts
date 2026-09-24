/**
 * Workspace-agnostic Slack deep link to a message or thread. Slack redirects
 * it to the thread. Pure: no imports, safe to load from any runtime.
 */
export function threadLink(channelId: string, threadTs: string): string {
  return `https://slack.com/archives/${channelId}/p${threadTs.replace(".", "")}`;
}
