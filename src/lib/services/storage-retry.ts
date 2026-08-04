import { classifyStorageError, IN_PROCESS, withRetry } from '@/lib/retry'

export type StorageRetryOptions = {
  idempotent?: boolean
}

export function uploadWithRetry<T>(
  operation: () => Promise<T>,
  options?: StorageRetryOptions,
): Promise<T> {
  if (options?.idempotent === false) {
    return operation()
  }

  return withRetry(IN_PROCESS, operation, {
    classify: classifyStorageError,
    service: 'supabase-storage',
  })
}
