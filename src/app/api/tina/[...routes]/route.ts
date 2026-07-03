import { createRequire } from 'node:module'
import { NextRequest, NextResponse } from 'next/server'

type TinaDatabaseClient = {
  request: (body: unknown) => Promise<unknown> | unknown
}

type TinaDatabaseClientModule = {
  databaseClient?: TinaDatabaseClient
  default?: TinaDatabaseClient
}

const require = createRequire(import.meta.url)

function loadDatabaseClient(): TinaDatabaseClient | null {
  try {
    const generated = require('../../../../../tina/__generated__/databaseClient') as
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

    if (
      typeof generated === 'object' &&
      generated !== null &&
      'default' in generated &&
      generated.default &&
      typeof generated.default.request === 'function'
    ) {
      return generated.default
    }
  } catch {
    return null
  }

  return null
}

export async function GET() {
  return NextResponse.json({
    message: 'TinaCMS API route is available',
  })
}

export async function POST(request: NextRequest) {
  const databaseClient = loadDatabaseClient()

  if (!databaseClient) {
    return NextResponse.json(
      { error: 'TinaCMS database client is not initialized' },
      { status: 503 },
    )
  }

  const body = (await request.json()) as unknown
  const result = await databaseClient.request(body)

  return NextResponse.json(result)
}
