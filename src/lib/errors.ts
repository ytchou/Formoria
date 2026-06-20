export class ServiceError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
  }
}

export class NotFoundError extends ServiceError {
  constructor(entity: string, identifier: string) {
    super(`${entity} not found: ${identifier}`, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

export function sanitizeErrorResponse(
  _error: unknown,
  digest?: string
): { error: string; digest?: string } {
  return { error: 'An unexpected error occurred', ...(digest && { digest }) }
}
