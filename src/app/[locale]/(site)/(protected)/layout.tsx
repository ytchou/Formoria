/**
 * Deliberately auth-free. A layout has no pathname, so redirecting here cannot
 * build a `next` param — and because layouts render before their pages, doing
 * so also preempted the page-level guards that can. Each protected page owns
 * its own `requireUserPage` guard instead (DEV-1339).
 */
export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
