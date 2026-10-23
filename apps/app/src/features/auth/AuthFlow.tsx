import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

type AuthFlow = {
  /** The address the code was sent to; `null` until the sign-in screen has sent one. */
  email: string | null
  setEmail: (email: string) => void
}

const AuthFlowContext = createContext<AuthFlow | null>(null)

/**
 * Carries the email from sign-in to the code screen in memory. It stays out of the URL, where it
 * would end up in browser history and logs; a reload of the code screen starts again at sign-in.
 */
export function AuthFlowProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null)
  const value = useMemo(() => ({ email, setEmail }), [email])
  return <AuthFlowContext.Provider value={value}>{children}</AuthFlowContext.Provider>
}

export function useAuthFlow(): AuthFlow {
  const flow = useContext(AuthFlowContext)
  if (flow === null) throw new Error('useAuthFlow must be used inside <AuthFlowProvider>')
  return flow
}
