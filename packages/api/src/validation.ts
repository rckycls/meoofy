import { AppError, petInputSchema } from '@pawpin/core'

/** The core id rule (any 8-4-4-4-12 hex uuid, as Postgres accepts), shared by pets and photos. */
const idSchema = petInputSchema.shape.id

/** A schema's failure as a VALIDATION AppError naming the first bad field. */
export function validationError(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
}): AppError {
  const issue = error.issues[0]
  if (issue === undefined) return new AppError('VALIDATION')
  const field = issue.path.map(String).join('.')
  return new AppError('VALIDATION', field === '' ? issue.message : `${field}: ${issue.message}`)
}

/** `value` if it is a uuid; otherwise throws VALIDATION, so no request is made with it. */
export function parseId(value: string, field = 'id'): string {
  const parsed = idSchema.safeParse(value)
  if (!parsed.success) throw new AppError('VALIDATION', `${field} must be a uuid`)
  return parsed.data
}
