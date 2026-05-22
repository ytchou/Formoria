import { NextResponse } from 'next/server'
import { scrapeUrlSchema } from '@/lib/validations/submission'
import { scrapeBrandUrl } from '@/lib/services/scraper'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    // Authenticate user
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const parsed = scrapeUrlSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    // Scrape the URL
    const data = await scrapeBrandUrl(parsed.data.url)

    return NextResponse.json(data)
  } catch (error) {
    console.error('Scrape API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
