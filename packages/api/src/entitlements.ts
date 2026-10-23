import { AppError } from '@pawpin/core'
import type { PawpinClient } from './client'
import { toAppError, withStatus } from './errors'
import { toEntitlement, type Entitlement } from './types'

/** The signed-in user's tier, its pet limit (null when unlimited) and their private pet count. */
export async function getEntitlement(c: PawpinClient): Promise<Entitlement> {
  try {
    const { data, error, status } = await c
      .from('my_entitlement')
      .select('tier, pet_limit, active_pets')
      .maybeSingle()
    if (error) throw withStatus(error, status)
    if (data === null) throw new AppError('UNAUTHENTICATED', 'no entitlement for this session')
    return toEntitlement(data)
  } catch (e) {
    throw toAppError(e)
  }
}
