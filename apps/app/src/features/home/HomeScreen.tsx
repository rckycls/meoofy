import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import type { Entitlement } from '@meoofy/api'
import { canAddPet, parseAppError } from '@meoofy/core'
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
} from '@meoofy/ui'

import { useEntitlement } from '../../data/useEntitlement'
import { usePets } from '../../data/usePets'
import { useProfile } from '../../data/useProfile'
import { ContentColumn } from '../../layout/ContentColumn'
import { useLayoutMode } from '../../layout/layoutMode'
import { ProblemNote } from '../auth/ProblemNote'
import { TextLink } from '../auth/TextLink'
import { homeCopy } from './copy'
import { PetRow } from './PetRow'

const DESKTOP_MAX_WIDTH = 1120
const SIDE_WIDTH = 360

/** O02 Hello with the pet list, or S01 for an empty registry. Two columns (W06) from 1024 px. */
export function HomeScreen() {
  const pets = usePets()
  const plan = useEntitlement().data
  const name = useProfile().data?.displayName
  const desktop = useLayoutMode() === 'desktop'

  // While the plan is unknown the person may still try; the server enforces the limit.
  const fullPlan = plan !== undefined && !canAddPet(plan.tier, plan.activePets) ? plan : null
  const addPet = () => router.push(fullPlan === null ? '/pets/new' : '/plans')
  const comparePlans = () => router.push('/plans')
  const hasPets = pets.data !== undefined && pets.data.length > 0
  const isEmpty = pets.data !== undefined && pets.data.length === 0

  const greeting = (
    <Text accessibilityRole="header" style={styles.greeting}>
      {homeCopy.greeting(name)}
    </Text>
  )
  const list = <PetsSection pets={pets} onAdd={addPet} />
  // On the phone it sits on the screen; on desktop it is inside the plan card.
  const fullNote =
    fullPlan !== null && fullPlan.petLimit !== null ? (
      <Text style={desktop ? styles.cardNote : styles.note}>
        {homeCopy.plan.full(fullPlan.tier, fullPlan.petLimit)}
      </Text>
    ) : null
  const addButton = hasPets ? (
    <Button variant="primary" label={homeCopy.addPet} onPress={addPet} />
  ) : null

  return (
    // The tab bar pads the bottom safe area itself. S01 has its own warmer tint (board 05).
    <ScreenShell flow={isEmpty ? 'resilience' : 'owner'} scroll edges={['top', 'left', 'right']}>
      <ContentColumn style={[styles.column, desktop ? styles.wide : null]}>
        {desktop ? (
          <View testID="home-columns" style={styles.columns}>
            <View testID="home-main" style={styles.main}>
              {greeting}
              {list}
            </View>
            <View testID="home-side" style={styles.side}>
              <Card
                role="community"
                title={plan ? homeCopy.plan.cardTitle(plan) : homeCopy.plan.unknownCardTitle}
              >
                <View style={styles.cornerSticker}>
                  <Sticker name="paw-star" size={32} rotate={6} />
                </View>
                {fullNote}
                <TextLink label={homeCopy.plan.comparePlans} onPress={comparePlans} />
                {addButton}
              </Card>
            </View>
          </View>
        ) : (
          <>
            {greeting}
            {plan ? <PlanLine plan={plan} onCompare={comparePlans} /> : null}
            {list}
            {fullNote}
            {addButton}
          </>
        )}
      </ContentColumn>
    </ScreenShell>
  )
}

function PlanLine({ plan, onCompare }: { plan: Entitlement; onCompare: () => void }) {
  return (
    <View style={styles.planLine}>
      <Text style={styles.plan}>{homeCopy.plan.line(plan)}</Text>
      <TextLink label={homeCopy.plan.comparePlans} onPress={onCompare} />
    </View>
  )
}

/** The pet rows, or what stands in for them: S01, a progress indicator, or a plain failure note. */
function PetsSection({ pets, onAdd }: { pets: ReturnType<typeof usePets>; onAdd: () => void }) {
  if (pets.data !== undefined) {
    if (pets.data.length === 0) return <EmptyRegistry onAdd={onAdd} />
    return (
      <View style={styles.list}>
        {pets.data.map((pet) => (
          <PetRow key={pet.id} pet={pet} onPress={() => router.push(`/pets/${pet.id}`)} />
        ))}
      </View>
    )
  }
  if (pets.isError) {
    const offline = parseAppError(pets.error).code === 'NETWORK'
    return (
      <View style={styles.list}>
        <ProblemNote>{offline ? homeCopy.errors.offline : homeCopy.errors.loadFailed}</ProblemNote>
        <Button
          variant="secondary"
          label={homeCopy.errors.retry}
          onPress={() => void pets.refetch()}
        />
      </View>
    )
  }
  // The device is offline and nothing was saved: the read waits for the network.
  if (pets.fetchStatus === 'paused') return <ProblemNote>{homeCopy.errors.offline}</ProblemNote>
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={homeCopy.loading}
      style={styles.loading}
    >
      <ActivityIndicator color={colors.cobalt} />
    </View>
  )
}

/** S01: nothing registered yet. */
function EmptyRegistry({ onAdd }: { onAdd: () => void }) {
  return (
    <Card role="celebration" title={homeCopy.empty.title}>
      <View style={styles.stickers}>
        <Sticker name="dog" size={64} rotate={-6} />
        <Sticker name="cat" size={64} rotate={6} />
      </View>
      <Text style={[styles.emptyBody, { color: cardRoles.celebration.body }]}>
        {homeCopy.empty.body}
      </Text>
      <Button variant="primary" label={homeCopy.empty.action} onPress={onAdd} />
    </Card>
  )
}

const styles = StyleSheet.create({
  column: { gap: space[16] },
  wide: { maxWidth: DESKTOP_MAX_WIDTH },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space[32] },
  main: { flex: 1, gap: space[16] },
  side: { width: SIDE_WIDTH },
  greeting: { ...textStyle(type.headline), color: colors.deepBlue },
  planLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plan: { ...textStyle(type.noteTitle), color: colors.slate },
  note: { ...textStyle(type.body), color: colors.slate },
  cardNote: { ...textStyle(type.body), color: cardRoles.community.body },
  cornerSticker: { position: 'absolute', top: space[8], right: space[8] },
  list: { gap: space[16] },
  loading: { paddingVertical: space[32] },
  stickers: { flexDirection: 'row', gap: space[8] },
  emptyBody: textStyle(type.body),
})
