import { StyleSheet, Text, View } from 'react-native'

import { cardRoles, type CardRole } from '../theme/roles'
import { radii } from '../theme/tokens'
import { textStyle } from '../theme/textStyle'
import { type } from '../theme/type'

export type ChipKind = 'private' | 'missing' | 'recovered'

export type ChipProps = {
  kind: ChipKind
}

// Each chip borrows the text/background pair of the card role that carries
// the same meaning, so every pair stays on the AA-checked list.
const kinds: Record<ChipKind, { label: string; role: CardRole }> = {
  private: { label: 'Private', role: 'privacy' },
  missing: { label: 'Missing', role: 'attention' },
  recovered: { label: 'Recovered', role: 'tip' },
}

export function Chip({ kind }: ChipProps) {
  const { label, role } = kinds[kind]
  const { from, title } = cardRoles[role]

  return (
    <View testID="chip" style={[styles.chip, { backgroundColor: from }]}>
      <Text style={[styles.label, { color: title }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radii.chip,
    // Half a space step above and below, one and a half beside: a pill.
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  label: textStyle(type.small),
})
