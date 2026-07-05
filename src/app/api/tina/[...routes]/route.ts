import { NextRequest, NextResponse } from 'next/server'
import { loadDatabaseClient } from '@/lib/tina/database-client'

export async function GET() {
  const databaseClient = loadDatabaseClient()

  if (databaseClient) {
    const client = databaseClient as {
      get?: (request: Request) => Promise<Response> | Response
      GET?: (request: Request) => Promise<Response> | Response
      handleGet?: (request: Request) => Promise<Response> | Response
    }

    const getHandler = client.get ?? client.GET ?? client.handleGet

    if (typeof getHandler === 'function') {
      return await getHandler(new Request('http://localhost/api/tina'))
    }
  }

  return NextResponse.json({
    status: 'ok',
    service: 'tina',
    databaseClientLoaded: Boolean(databaseClient),
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

  let body: unknown

  try {
    body = (await request.json()) as unknown
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload' },
      { status: 400 },
    )
  }

  try {
    const result = await databaseClient.request(body)

    return NextResponse.json(result)
  } catch {
    return NextResponse.json(
      { error: 'TinaCMS database client request failed' },
      { status: 502 },
    )
  }
}
