import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { router } from 'expo-router'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import type { OnboardingPath } from '@pawpin/core'
import {
  Button,
  colors,
  motion,
  radii,
  space,
  textStyle,
  type,
  useMotionPreference,
} from '@pawpin/ui'

import { onboardingCopy } from './copy'
import { TwoPathsHero } from './heroes'
import { Icon, type IconName } from './icons'
import { OnboardingFrame } from './OnboardingFrame'
import { rememberPath, stepBack } from './progress'

/** How far a chosen tile rises (px). */
const LIFT = 4
/** Past this text scale the two tiles stack instead of sharing a row. */
const STACK_FROM_FONT_SCALE = 1.35

type ChoiceCardProps = {
  icon: IconName
  title: string
  body: string
  selected: boolean
  onSelect: () => void
}

/** A selectable tile. The tile lifts over 160 ms when chosen (not with Reduce Motion). */
function ChoiceCard({ icon, title, body, selected, onSelect }: ChoiceCardProps) {
  const { reduced } = useMotionPreference()
  const lift = useSharedValue(selected ? 1 : 0)
  const [x1, y1, x2, y2] = motion.easing.standard

  useEffect(() => {
    lift.value = withTiming(selected ? 1 : 0, {
      duration: reduced ? 0 : motion.duration.fast,
      easing: Easing.bezier(x1, y1, x2, y2),
    })
  }, [selected, reduced, lift, x1, y1, x2, y2])

  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -LIFT * lift.value }] }))

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      // react-native-web ignores `accessibilityState`; this is what puts the state in the page.
      aria-checked={selected}
      onPress={onSelect}
      style={styles.choice}
    >
      <Animated.View
        style={[styles.card, selected ? styles.cardSelected : styles.cardIdle, liftStyle]}
      >
        <View style={styles.iconDisc}>
          <Icon name={icon} size={22} color={colors.cobalt} />
        </View>
        <View style={styles.cardText}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardBody}>{body}</Text>
        </View>
        {selected ? (
          <View testID="choice-check" style={styles.badge}>
            <Icon name="check" size={14} color={colors.white} strokeWidth={2.5} />
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  )
}

/** O01: protect my pet, or help a found pet. */
export function ChoosePathScreen() {
  const copy = onboardingCopy.choosePath
  const { fontScale } = useWindowDimensions()
  const [path, setPath] = useState<OnboardingPath>('owner')

  async function next() {
    await rememberPath(path)
    router.navigate('/(onboarding)/privacy')
  }

  return (
    <OnboardingFrame
      step={1}
      hero={<TwoPathsHero />}
      title={copy.title}
      body={copy.body}
      actions={
        <>
          <Button variant="primary" label={copy.primary} onPress={() => void next()} />
          <Button
            variant="secondary"
            label={copy.secondary}
            onPress={() => stepBack('/(onboarding)/welcome')}
          />
        </>
      }
    >
      <View
        accessibilityRole="radiogroup"
        style={[styles.choices, fontScale > STACK_FROM_FONT_SCALE ? styles.stacked : null]}
      >
        <ChoiceCard
          icon="shield-check"
          title={copy.owner.title}
          body={copy.owner.body}
          selected={path === 'owner'}
          onSelect={() => setPath('owner')}
        />
        <ChoiceCard
          icon="scan-search"
          title={copy.finder.title}
          body={copy.finder.body}
          selected={path === 'finder'}
          onSelect={() => setPath('finder')}
        />
      </View>
    </OnboardingFrame>
  )
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', gap: 12 },
  stacked: { flexDirection: 'column' },
  // 132 pt on the board; the tile grows with the text.
  choice: { flex: 1, minHeight: 132 },
  card: {
    flex: 1,
    borderRadius: radii.card,
    backgroundColor: colors.white,
    gap: space[8],
  },
  // The border is 1 pt when idle and 2 pt when chosen; the padding makes up the
  // difference so the text never shifts.
  cardIdle: { padding: 14, borderWidth: 1, borderColor: colors.line },
  cardSelected: {
    padding: 13,
    borderWidth: 2,
    borderColor: colors.cobalt,
    boxShadow: '0 8px 16px rgba(40, 88, 200, 0.16)',
  },
  iconDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.skyTint,
  },
  cardText: { gap: 4 },
  cardTitle: { ...textStyle(type.noteTitle), color: colors.deepBlue },
  cardBody: { ...textStyle(type.caption), color: colors.slate },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cobalt,
  },
})
