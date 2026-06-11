import { DefaultTemplate } from './default-template'

const TEMPLATES = { default: DefaultTemplate } as const

export function getTemplate(id?: string) {
  return TEMPLATES[(id ?? 'default') as keyof typeof TEMPLATES] ?? TEMPLATES.default
}
