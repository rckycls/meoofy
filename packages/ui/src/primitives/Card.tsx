import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

import { cardRoles, type CardRole } from '../theme/roles'
import { radii, space } from '../theme/tokens'
import { textStyle } from '../theme/textStyle'
import { type } from '../theme/type'

export type CardProps = {
  role: CardRole
  title?: string
  /** Plain strings are set as body text in the role's body colour. */
  children?: ReactNode
}

export function Card({ role, title, children }: CardProps) {
  const roleColors = cardRoles[role]

  return (
    <View
      testID="card"
      style={[
        styles.card,
        roleColors.stroke ? { borderColor: roleColors.stroke, borderWidth: 1 } : null,
      ]}
    >
      <LinearGradient
        testID="card-gradient"
        colors={[roleColors.from, roleColors.to]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {title ? (
        <Text accessibilityRole="header" style={[styles.title, { color: roleColors.title }]}>
          {title}
        </Text>
      ) : null}
      {typeof children === 'string' ? (
        <Text style={[styles.body, { color: roleColors.body }]}>{children}</Text>
      ) : (
        children
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    overflow: 'hidden',
    padding: space[16],
    gap: space[8],
  },
  title: textStyle(type.cardTitle),
  body: textStyle(type.body),
})
