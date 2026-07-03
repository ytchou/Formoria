import generatedModule from '@tina/databaseClient'

type TinaDatabaseClient = {
  request: (body: unknown) => Promise<unknown> | unknown
  get?: (request: Request) => Promise<Response> | Response
  GET?: (request: Request) => Promise<Response> | Response
  handleGet?: (request: Request) => Promise<Response> | Response
}

export function loadDatabaseClient(): TinaDatabaseClient | null {
  const generated = generatedModule as Record<string, unknown> | null

  if (!generated || typeof generated !== 'object') return null

  if ('request' in generated && typeof generated.request === 'function') {
    return generated as unknown as TinaDatabaseClient
  }

  return null
}
