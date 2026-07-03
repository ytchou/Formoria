import { createRequire } from 'node:module'

type TinaDatabaseClient = {
  request: (body: unknown) => Promise<unknown> | unknown
  get?: (request: Request) => Promise<Response> | Response
  GET?: (request: Request) => Promise<Response> | Response
  handleGet?: (request: Request) => Promise<Response> | Response
}

type TinaDatabaseClientModule = {
  databaseClient?: TinaDatabaseClient
  default?: {
    default?: TinaDatabaseClient
  } | TinaDatabaseClient
}

const require = createRequire(import.meta.url)

function describeModuleShape(generated: unknown) {
  if (typeof generated !== 'object' || generated === null) {
    return { type: typeof generated }
  }

  const record = generated as Record<string, unknown>

  return {
    keys: Object.keys(record),
    hasDefault: 'default' in record,
    hasDatabaseClient: 'databaseClient' in record,
    defaultType: typeof record.default,
    databaseClientType: typeof record.databaseClient,
  }
}

export function loadDatabaseClient(): TinaDatabaseClient | null {
  try {
    const generated = require('../../../../tina/__generated__/databaseClient') as
      | TinaDatabaseClient
      | TinaDatabaseClientModule

    if (typeof generated === 'object' && generated !== null && 'request' in generated) {
      const client = generated as TinaDatabaseClient

      if (typeof client.request === 'function') {
        return client
      }
    }

    if (
      typeof generated === 'object' &&
      generated !== null &&
      'databaseClient' in generated &&
      generated.databaseClient &&
      typeof generated.databaseClient.request === 'function'
    ) {
      return generated.databaseClient
    }

    if (typeof generated === 'object' && generated !== null && 'default' in generated) {
      const defaultExport = generated.default

      if (defaultExport && typeof defaultExport === 'object') {
        if ('request' in defaultExport && typeof defaultExport.request === 'function') {
          return defaultExport
        }

        if (
          'default' in defaultExport &&
          defaultExport.default &&
          typeof defaultExport.default === 'object' &&
          typeof defaultExport.default.request === 'function'
        ) {
          return defaultExport.default
        }
      }
    }

    console.warn('Tina database client module has an unexpected shape', describeModuleShape(generated))
  } catch (error) {
    console.warn('Failed to load Tina database client module', error)
    return null
  }

  return null
}
