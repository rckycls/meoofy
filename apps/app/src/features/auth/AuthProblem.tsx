import type { AppError } from '@meoofy/core'

import { env } from '../../env'
import { authCopy } from './copy'
import { problemText } from './problem'
import { ProblemNote } from './ProblemNote'
import { TextLink } from './TextLink'

/**
 * The note for a failure on a sign-in screen. An invite-only refusal also gets a way to ask for an
 * invite, a `mailto:` link to the configured support address, and none when there is no address.
 */
export function AuthProblem({ error }: { error: AppError }) {
  const supportEmail = error.code === 'INVITE_ONLY' ? env.supportEmail : null
  return (
    <>
      <ProblemNote>{problemText(error)}</ProblemNote>
      {supportEmail === null ? null : (
        <TextLink label={authCopy.errors.contact} href={`mailto:${supportEmail}`} />
      )}
    </>
  )
}
