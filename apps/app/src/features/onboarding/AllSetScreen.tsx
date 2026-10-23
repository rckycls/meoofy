import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Button, Sticker, colors, radii, space, textStyle, type } from '@pawpin/ui'

import { useProfile } from '../../data/useProfile'
import { allSetTitle, onboardingCopy } from './copy'
import { CelebrationHero } from './heroes'
import { Icon } from './icons'
import { OnboardingFrame } from './OnboardingFrame'
import { useRecordOnboardingPath } from './useRecordOnboardingPath'

const AVATAR = 44

/** O03: the person is signed in and named. Add a first pet, or look around. */
export function AllSetScreen() {
  const copy = onboardingCopy.allSet
  // The first screen after sign-in: the path chosen in O01 is recorded here.
  const chosenPath = useRecordOnboardingPath()
  // Shares the entry gate's ['profile'] query. Without a name the greeting
  // simply leaves it out.
  const profile = useProfile()

  const addPet = () => router.navigate('/pets/new')
  const explore = () => router.replace(chosenPath === 'finder' ? '/(tabs)/find' : '/(tabs)/home')

  return (
    <OnboardingFrame
      hero={<CelebrationHero />}
      title={allSetTitle(profile.data?.displayName)}
      body={copy.body}
      actions={
        <>
          <Button variant="primary" label={copy.primary} onPress={addPet} />
          <Button variant="secondary" label={copy.secondary} onPress={explore} />
        </>
      }
    >
      <Pressable accessibilityRole="button" onPress={addPet} style={styles.card}>
        <View aria-hidden style={styles.avatars}>
          <View style={[styles.avatar, { backgroundColor: colors.sand }]}>
            <Sticker name="dog" size={34} />
          </View>
          <View style={[styles.avatar, styles.second, { backgroundColor: colors.mistGray }]}>
            <Sticker name="cat" size={34} />
          </View>
        </View>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>{copy.card.title}</Text>
          <Text style={styles.cardBody}>{copy.card.body}</Text>
        </View>
        <View style={styles.plus}>
          <Icon name="plus" size={18} color={colors.cobalt} />
        </View>
      </Pressable>
    </OnboardingFrame>
  )
}

const styles = StyleSheet.create({
  card: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[16],
    padding: space[16],
    borderRadius: radii.card,
    borderWidth: 1.5,
    // Dashed, as on board 08: the card is an invitation to add something.
    borderStyle: 'dashed',
    borderColor: colors.cobalt,
    backgroundColor: colors.white,
  },
  avatars: { flexDirection: 'row' },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  second: { marginLeft: -12 },
  cardText: { flex: 1, gap: 4 },
  cardTitle: { ...textStyle(type.noteTitle), color: colors.deepBlue },
  cardBody: { ...textStyle(type.caption), color: colors.slate },
  plus: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.skyTint,
  },
})
