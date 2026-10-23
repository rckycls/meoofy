import type { AppError } from '@pawpin/core'

import { authCopy } from './copy'

/** The sentence for a failure that is not about one field. */
export function problemText(error: AppError): string {
  switch (error.code) {
    case 'INVITE_ONLY':
      return authCopy.errors.inviteOnly
    case 'RATE_LIMITED':
      return authCopy.errors.rateLimited
    case 'NETWORK':
      return authCopy.errors.network
    default:
      return authCopy.errors.unknown
  }
}
