import { View } from 'react-native'
import { Card } from '@pawpin/ui'

/**
 * A failure or refusal that belongs to no single field (invite-only, offline, a refused code). It
 * is plain text in a live region: error text never animates, and it is read out when it appears.
 * The words carry the meaning; the warning colour only backs them up.
 */
export function ProblemNote({ title, children }: { title?: string; children: string }) {
  return (
    <View testID="auth-problem" role="alert" accessibilityLiveRegion="polite">
      <Card role="warning" title={title}>
        {children}
      </Card>
    </View>
  )
}
