export function parseSubscribeForm(fd: FormData): { email: string; interests: string[]; locale: string } {
  const email = String(fd.get('email') ?? '')
  const interests = fd
    .getAll('interests')
    .filter((interest): interest is string => typeof interest === 'string')
  const locale = String(fd.get('locale') ?? 'zh-TW')

  return { email, interests, locale }
}

export function isHoneypotFilled(fd: FormData): boolean {
  const value = fd.get('website')
  return typeof value === 'string' && value.trim().length > 0
}
