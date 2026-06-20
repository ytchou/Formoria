const encoder = new TextEncoder()

export function arrayBufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''

  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64urlToArrayBuffer(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    throw new Error('Invalid base64url value')
  }

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes.buffer
}

export function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await getHmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))

  return `${value}.${arrayBufferToBase64url(signature)}`
}

export async function verifyCookieValue(signed: string, secret: string): Promise<string | null> {
  if (!signed) return null

  const separatorIndex = signed.lastIndexOf('.')
  if (separatorIndex <= 0 || separatorIndex === signed.length - 1) return null

  const value = signed.slice(0, separatorIndex)
  const signature = signed.slice(separatorIndex + 1)
  const key = await getHmacKey(secret)

  let actualSignature: ArrayBuffer
  try {
    actualSignature = base64urlToArrayBuffer(signature)
  } catch {
    return null
  }

  const isValid = await crypto.subtle.verify('HMAC', key, actualSignature, encoder.encode(value))
  return isValid ? value : null
}
