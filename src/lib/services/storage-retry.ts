import { classifyStorageError, IN_PROCESS, withRetry } from '@/lib/retry'

export function uploadWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  return withRetry(IN_PROCESS, operation, {
    classify: classifyStorageError,
    service: 'supabase-storage',
  })
}
