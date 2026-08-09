export class ServiceError extends Error {
  readonly code: string

  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ServiceError'
    this.code = code
  }
}

export class NotFoundError extends ServiceError {
  constructor(entity: string, identifier: string, options?: { cause?: unknown }) {
    super(`${entity} not found: ${identifier}`, 'NOT_FOUND', options)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'VALIDATION_ERROR', options)
    this.name = 'ValidationError'
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'CONFLICT', options)
    this.name = 'ConflictError'
  }
}

/**
 * Best-effort human-readable text for anything thrown or returned as an error.
 * PostgREST hands back a plain `{ message, code, details }` object rather than
 * an `Error`, so `instanceof Error` alone loses the only useful part of a
 * database failure. Used to carry a swallowed error into an audit summary.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

export function sanitizeErrorResponse(
  _error: unknown,
  digest?: string
): { error: string; digest?: string } {
  return { error: 'An unexpected error occurred', ...(digest && { digest }) }
}
