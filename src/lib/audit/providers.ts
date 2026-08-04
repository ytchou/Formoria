export const PROVIDERS = {
  serper: ["search", "images", "maps"],
  openai: ["chat_completions"],
  deepseek: ["chat_completions", "balance"],
  resend: ["send_email"],
  turnstile: ["siteverify"],
  slack: ["post_slack_alert"],
  posthog: ["run_query"],
  "mit-registry": ["lookup_cert_number", "lookup_cert_numbers", "sync_registry"],
  playwright: ["fetch_rendered"],
  http: ["fetch_html", "fetch_html_with_metadata", "download_and_store_images"],
} as const;

export type ProviderRegistry = typeof PROVIDERS;
export type AuditProvider = keyof ProviderRegistry;

export function assertRegistered(provider: string, operation: string): void {
  if (!(provider in PROVIDERS)) {
    throw new Error(`Unknown audit provider: ${provider}`);
  }

  const operations = PROVIDERS[provider as AuditProvider] as readonly string[];
  if (!operations.includes(operation)) {
    throw new Error(`Unknown audit operation: ${provider}.${operation}`);
  }
}
