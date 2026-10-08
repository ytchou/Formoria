import type { AbstractIntlMessages } from 'next-intl'

/**
 * Top-level message namespaces that `useTranslations` can read under the
 * `[locale]` layout's `NextIntlClientProvider`.
 *
 * Why: the provider serialises every message it receives into each page's
 * inline RSC payload. Passing the whole catalogue cost ~112 KB per page
 * (DEV-1972) for namespaces such as `categories`, `districts`, `legal` and
 * `faq` that only server components read via `getTranslations`, which reads
 * the request config, not the provider.
 *
 * Failure mode: a client component that calls `useTranslations` with a
 * namespace missing here renders raw keys instead of copy, with no build or
 * type error. `src/i18n/__tests__/client-messages.test.ts` scans `src/` for
 * every `useTranslations` call and fails when its namespace is not listed
 * here, so add new namespaces to this list in the same change.
 *
 * A superset is safe: `useTranslations` in a non-async server component also
 * resolves here, so every literal namespace in `src/` is listed. `admin` is
 * excluded on purpose — it exists only in `messages/en.json` and is rendered
 * under `src/app/admin/layout.tsx`, which has its own provider.
 */
export const CLIENT_MESSAGE_NAMESPACES = [
  'account',
  'auth',
  'brandDetail',
  'brandFields',
  'brands',
  'cities',
  'common',
  'errors',
  'filters',
  'footer',
  'forms',
  'landing',
  'marketingEmailConsent',
  'nav',
  'newsletter',
  'products',
  'saveBrand',
  'saveProduct',
  'search',
  'settings',
  'stories',
  'style',
  'submit',
  'trustLabel',
] as const

export type ClientMessageNamespace = (typeof CLIENT_MESSAGE_NAMESPACES)[number]

/**
 * Files whose `useTranslations` call takes a non-literal or empty argument, so
 * the guard test cannot read the namespace from source. Each entry lists every
 * top-level namespace that call can resolve to; keep it in sync when the call
 * site changes.
 */
export const NON_LITERAL_NAMESPACE_CALLERS: Readonly<
  Record<string, readonly ClientMessageNamespace[]>
> = {
  // Root-level call with no namespace; reads `nav.*` and `account.*` keys.
  'src/components/auth/account-menu.tsx': ['nav', 'account'],
  // Takes a `namespace` prop defaulting to 'stories'; no caller overrides it.
  'src/components/stories/story-row.tsx': ['stories'],
  // Namespace is `kind === 'brand' ? 'saveBrand' : 'saveProduct'`.
  'src/components/ui/save-button.tsx': ['saveBrand', 'saveProduct'],
}

/** Returns only the namespaces in `CLIENT_MESSAGE_NAMESPACES` that exist in `messages`. */
export function pickClientMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const picked: AbstractIntlMessages = {}
  for (const namespace of CLIENT_MESSAGE_NAMESPACES) {
    if (Object.hasOwn(messages, namespace)) {
      picked[namespace] = messages[namespace]
    }
  }
  return picked
}
