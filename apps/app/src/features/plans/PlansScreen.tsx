import { Pressable, StyleSheet, Text, View } from 'react-native'
import { petLimit, type Tier } from '@pawpin/core'
import {
  Button,
  Card,
  ScreenShell,
  Sticker,
  cardRoles,
  colors,
  space,
  textStyle,
  type,
} from '@pawpin/ui'

import { useEntitlement } from '../../data/useEntitlement'
import { ContentColumn } from '../../layout/ContentColumn'
import { useLayoutMode } from '../../layout/layoutMode'
import { stepBack } from '../onboarding/progress'
import { TIERS, plansCopy } from './copy'

const DESKTOP_MAX_WIDTH = 1040

/** Compare plans: what each plan covers. There are no purchases yet, so upgrades are "Coming soon". */
export function PlansScreen() {
  const { data: entitlement } = useEntitlement()
  const desktop = useLayoutMode() === 'desktop'
  // Until the plan is known, the cards read as if the person were on Free.
  const current = entitlement?.tier

  return (
    <ScreenShell flow="owner" scroll>
      <ContentColumn style={[styles.column, desktop ? styles.wide : null]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => stepBack('/(tabs)/home')}
          style={styles.back}
        >
          <Text style={styles.backLabel}>{plansCopy.back}</Text>
        </Pressable>
        <View style={styles.header}>
          <Sticker name="paw-star" size={64} rotate={-6} />
          <Text accessibilityRole="header" style={styles.title}>
            {plansCopy.title}
          </Text>
          <Text style={styles.body}>{plansCopy.body}</Text>
        </View>
        <View
          testID="plans-tiers"
          style={[styles.tiers, { flexDirection: desktop ? 'row' : 'column' }]}
        >
          {TIERS.map((tier) => (
            <View key={tier} style={desktop ? styles.cell : null}>
              <TierCard tier={tier} current={current} />
            </View>
          ))}
        </View>
      </ContentColumn>
    </ScreenShell>
  )
}

function TierCard({ tier, current }: { tier: Tier; current: Tier | undefined }) {
  const isCurrent = tier === current
  const role = isCurrent ? 'privacy' : 'plain'
  // Only a plan above the person's own is something to upgrade to.
  const upgrade = TIERS.indexOf(tier) > TIERS.indexOf(current ?? 'free')

  return (
    <Card role={role} title={plansCopy.tierNames[tier]}>
      <Text style={[styles.pets, { color: cardRoles[role].title }]}>
        {plansCopy.pets(petLimit(tier))}
      </Text>
      {isCurrent ? (
        <Text style={[styles.current, { color: cardRoles[role].title }]}>{plansCopy.current}</Text>
      ) : null}
      {upgrade ? (
        <Button variant="secondary" label={plansCopy.comingSoon} disabled onPress={noop} />
      ) : null}
    </Card>
  )
}

function noop() {}

const styles = StyleSheet.create({
  column: { gap: space[24] },
  wide: { maxWidth: DESKTOP_MAX_WIDTH },
  back: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
    paddingRight: space[16],
  },
  backLabel: { ...textStyle(type.noteTitle), color: colors.cobalt },
  header: { gap: space[8] },
  title: { ...textStyle(type.headline), color: colors.deepBlue },
  body: { ...textStyle(type.body), color: colors.slate },
  tiers: { gap: space[16] },
  cell: { flex: 1 },
  pets: textStyle(type.section),
  current: textStyle(type.noteTitle),
})
