type SendDigestEmailInput = {
  subject: string
  html: string
}

const RESEND_EMAILS_URL = 'https://api.resend.com/emails'
const FROM_EMAIL = 'Formoria <noreply@formoria.com>'
const TO_EMAILS = ['patrick.ytchou@gmail.com']

export async function sendDigestEmail({
  subject,
  html,
}: SendDigestEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    throw new Error('RESEND_API_KEY is required')
  }

  const response = await fetch(RESEND_EMAILS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: TO_EMAILS,
      subject,
      html,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Resend API error (${response.status}): ${body}`)
  }
}

function parseSubject(argv: string[]): string {
  const subjectFlagIndex = argv.indexOf('--subject')
  const subject = subjectFlagIndex === -1 ? undefined : argv[subjectFlagIndex + 1]

  if (!subject) {
    throw new Error('Missing required --subject argument')
  }

  return subject
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<void> {
  const subject = parseSubject(process.argv)
  const html = await readStdin()

  await sendDigestEmail({ subject, html })
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main()
    .then(() => {
      process.exit(0)
    })
    .catch((error: unknown) => {
      console.error(error)
      process.exit(1)
    })
}
