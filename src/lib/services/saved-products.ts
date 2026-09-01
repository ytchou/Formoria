import { auditedCall } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'

type ProductSaveRow = {
  product_id: string
}

export async function getUserSavedProductIds(
  userId: string
): Promise<string[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('product_saves')
    .select('product_id')
    .eq('user_id', userId)

  if (error) {
    if (error.code === 'PGRST205') return []
    throw error
  }

  const rows = (data ?? []) as ProductSaveRow[]
  return rows.map((row) => row.product_id)
}

export async function saveProduct(
  userId: string,
  productId: string
): Promise<void> {
  return auditedCall(
    { provider: 'curatedProducts', operation: 'saveProduct', kind: 'service' },
    async () => {
      const supabase = createServiceClient()
      const { error } = await supabase.from('product_saves').upsert(
        {
          user_id: userId,
          product_id: productId,
        },
        { onConflict: 'user_id,product_id' }
      )

      if (error) throw error
    },
    { subjectId: productId, summary: { userId } },
  )
}

export async function unsaveProduct(
  userId: string,
  productId: string
): Promise<void> {
  return auditedCall(
    { provider: 'curatedProducts', operation: 'unsaveProduct', kind: 'service' },
    async () => {
      const supabase = createServiceClient()
      const { error } = await supabase
        .from('product_saves')
        .delete()
        .eq('user_id', userId)
        .eq('product_id', productId)

      if (error) throw error
    },
    { subjectId: productId, summary: { userId } },
  )
}

export async function isProductSaved(
  userId: string,
  productId: string
): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('product_saves')
    .select('id')
    .eq('user_id', userId)
    .eq('product_id', productId)
    .maybeSingle()

  if (error) throw error
  return !!data
}
