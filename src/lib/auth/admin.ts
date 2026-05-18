export function isAdmin(email: string): boolean {
  if (!email) return false;

  const adminEmails = process.env.ADMIN_EMAILS;
  if (!adminEmails) return false;

  const admins = adminEmails
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return admins.includes(email.toLowerCase());
}
