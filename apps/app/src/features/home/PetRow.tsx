import { Pressable, StyleSheet, Text, View } from 'react-native'
import { formatAge } from '@pawpin/core'
import type { Pet } from '@pawpin/api'
import { Card, Chip, PetPortrait, colors, space, textStyle, type } from '@pawpin/ui'

import { homeCopy } from './copy'

const PORTRAIT = 64

/** "Dog · Beagle · 3 years": in words, so the sticker on the portrait never has to say it. */
function detail(pet: Pet): string {
  return [homeCopy.species[pet.species], pet.breed, formatAge(pet.ageMonths)]
    .filter((part) => part !== null && part !== '')
    .join(' · ')
}

/** One pet in the Home list: a portrait, the name, a line of detail and the Private chip. */
export function PetRow({ pet, onPress }: { pet: Pet; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Card role="plain">
        <View style={styles.content}>
          <PetPortrait species={pet.species} flow="owner" width={PORTRAIT} height={PORTRAIT} />
          <View style={styles.text}>
            <Text numberOfLines={2} style={styles.name}>
              {pet.name}
            </Text>
            <Text numberOfLines={2} style={styles.detail}>
              {detail(pet)}
            </Text>
            <Chip kind="private" />
          </View>
        </View>
      </Card>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // The portrait plus the card's padding; far above the 44 pt tap target.
  row: { minHeight: PORTRAIT + 2 * space[16] },
  pressed: { opacity: 0.85 },
  content: { flexDirection: 'row', alignItems: 'center', gap: space[16] },
  text: { flex: 1, gap: 4 },
  name: { ...textStyle(type.cardTitle), color: colors.deepBlue },
  detail: { ...textStyle(type.small), color: colors.slate },
})
