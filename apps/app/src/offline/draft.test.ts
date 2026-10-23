import AsyncStorage from '@react-native-async-storage/async-storage'

import { clearDraft, loadDraft, saveDraft, type PetDraft } from './draft'

const KEY = 'pawpin.petDraft'
const stored = async () => {
  const raw = await AsyncStorage.getItem(KEY)
  return raw === null ? null : (JSON.parse(raw) as unknown)
}

beforeEach(async () => {
  await AsyncStorage.clear()
})

describe('the add-pet draft', () => {
  it('is kept on the device, as typed, and read back', async () => {
    const draft = { name: 'Milo', species: 'cat', breed: 'Tabby', years: '3', months: '' } as const

    await saveDraft(draft)

    expect(await stored()).toEqual(draft)
    expect(await loadDraft()).toEqual(draft)
  })

  it('keeps a draft of only some fields', async () => {
    await saveDraft({ name: 'Mil' })

    expect(await loadDraft()).toEqual({ name: 'Mil' })
  })

  it('is null when there is none', async () => {
    expect(await loadDraft()).toBeNull()
  })

  it('is forgotten by clearDraft', async () => {
    await saveDraft({ name: 'Milo' })

    await clearDraft()

    expect(await stored()).toBeNull()
    expect(await loadDraft()).toBeNull()
  })

  it('stores only the form’s own fields', async () => {
    await saveDraft({ name: 'Milo', ageMonths: 36 } as PetDraft)

    expect(await stored()).toEqual({ name: 'Milo' })
  })

  it.each([
    ['text that is not JSON', '{"name":'],
    ['JSON null', 'null'],
    ['a list', '["Milo"]'],
    ['a bare string', '"Milo"'],
    ['a name that is not text', JSON.stringify({ name: 7 })],
    ['a species the app does not know', JSON.stringify({ name: 'Milo', species: 'rabbit' })],
    ['an older shape', JSON.stringify({ name: 'Milo', ageMonths: 36 })],
  ])('ignores and clears %s, without throwing', async (_case, raw) => {
    await AsyncStorage.setItem(KEY, raw)

    await expect(loadDraft()).resolves.toBeNull()

    expect(await AsyncStorage.getItem(KEY)).toBeNull()
  })
})
