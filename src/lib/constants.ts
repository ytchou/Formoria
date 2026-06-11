export const CONTACT_EMAILS = {
  operations: 'ops@formoria.com',
  contact: 'hello@formoria.com',
  noreply: 'noreply@formoria.com',
} as const

// Official Formoria social handles (full URLs). Gates the `social_dm` claim-proof
// option (DEV-768): when empty, that proof type is disabled in the claim form.
// Populate with the founder's official handle(s) to enable it.
export const FORMORIA_SOCIALS: string[] = []

// Official 台灣製 MIT 微笑產品 (MIT Smile) certification registry — public product
// search. Used as the proof destination for the MIT-verified badge.
export const MIT_SMILE_REGISTRY_URL = 'https://www.mittw.org.tw/products/'
