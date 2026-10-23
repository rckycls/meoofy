import { View } from 'react-native'
import { Card } from '@pawpin/ui'

/**
 * A failure or refusal that belongs to no single field (invite-only, offline, a refused code). It
 * is plain text in a live region: error text never animates, and it is read out when it appears.
 * The words carry the meaning; the warning colour only backs them up.
 */
export function ProblemNote({
  title,
  role = 'warning',
  children,
}: {
  title?: string
  /** `attention` (yellow) for a refused code, as board 05 draws S05; `warning` (peach) otherwise. */
  role?: 'warning' | 'attention'
  children: string
}) {
  return (
    <View testID="auth-problem" role="alert" accessibilityLiveRegion="polite">
      <Card role={role} title={title}>
        {children}
      </Card>
    </View>
  )
}
