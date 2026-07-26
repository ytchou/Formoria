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

export function sanitizeErrorResponse(
  _error: unknown,
  digest?: string
): { error: string; digest?: string } {
  return { error: 'An unexpected error occurred', ...(digest && { digest }) }
}
