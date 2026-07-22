import { createServiceClient } from '@/lib/supabase/server'

export type MitDeclarationScope = 'all' | 'most' | 'some'

export type MitDeclarationResult =
  | { ok: true }
  | { ok: false; code: string }

type QueryError = { message?: string }
type BrandStatus = 'unverified' | 'declared' | 'verified'
type BrandDeclarationPatch = {
  mit_status: BrandStatus
  mit_declared_scope: MitDeclarationScope | null
  mit_declared_at: string | null
  mit_declared_by: string | null
}

type UpdateQuery = {
  eq: (column: 'id' | 'mit_status', value: string) => UpdateQuery
  in: (column: 'mit_status', values: BrandStatus[]) => UpdateQuery
  select: (columns: 'id') => {
    maybeSingle: () => Promise<{
      data: { id: string } | null
      error: QueryError | null
    }>
  }
}

type SelectQuery = {
  eq: (column: 'id', value: string) => {
    maybeSingle: () => Promise<{
      data: { mit_status: BrandStatus } | null
      error: QueryError | null
    }>
  }
}

export type MitDeclarationClient = {
  from: (table: 'brands') => {
    select: (columns: 'mit_status') => SelectQuery
    update: (patch: BrandDeclarationPatch) => UpdateQuery
  }
}

export type MitDeclarationContext = {
  userId: string
  client?: unknown
  now?: () => string
}

function getClient(ctx?: Pick<MitDeclarationContext, 'client'>): MitDeclarationClient {
  return (ctx?.client ?? createServiceClient()) as MitDeclarationClient
}

async function resetDeclaration(
  brandId: string,
  client: MitDeclarationClient,
): Promise<MitDeclarationResult> {
  const { data, error } = await client
    .from('brands')
    .update({
      mit_status: 'unverified',
      mit_declared_scope: null,
      mit_declared_at: null,
      mit_declared_by: null,
    })
    .eq('id', brandId)
    .eq('mit_status', 'declared')
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, code: 'database_error' }
  if (!data) return { ok: false, code: 'not_declared' }
  return { ok: true }
}

export async function declareMit(
  brandId: string,
  scope: MitDeclarationScope,
  ctx: MitDeclarationContext,
): Promise<MitDeclarationResult> {
  const client = getClient(ctx)
  const { data, error } = await client
    .from('brands')
    .update({
      mit_status: 'declared',
      mit_declared_scope: scope,
      mit_declared_at: ctx.now?.() ?? new Date().toISOString(),
      mit_declared_by: ctx.userId,
    })
    .eq('id', brandId)
    .in('mit_status', ['unverified', 'declared'])
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, code: 'database_error' }
  if (data) return { ok: true }

  const statusResult = await client
    .from('brands')
    .select('mit_status')
    .eq('id', brandId)
    .maybeSingle()

  if (statusResult.error) return { ok: false, code: 'database_error' }
  if (!statusResult.data) return { ok: false, code: 'not_found' }
  if (statusResult.data.mit_status === 'verified') {
    return { ok: false, code: 'already_verified' }
  }
  return { ok: false, code: 'invalid_state' }
}

export async function withdrawDeclaration(
  brandId: string,
  ctx: MitDeclarationContext,
): Promise<MitDeclarationResult> {
  return resetDeclaration(brandId, getClient(ctx))
}

export async function stripDeclaration(
  brandId: string,
  reviewerId: string,
  notes: string,
): Promise<MitDeclarationResult> {
  void reviewerId
  void notes
  return resetDeclaration(brandId, getClient())
}
