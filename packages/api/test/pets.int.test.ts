import { randomUUID } from 'node:crypto'
import type { PetInput } from '@meoofy/core'
import { afterAll, describe, expect, it } from 'vitest'
import { createPet, deletePet, getEntitlement, getPet, listPets, updatePet, type Pet } from '../src'
import { cleanup, newOwner } from './helpers'

afterAll(cleanup)

function petInput(name: string, extra: Partial<PetInput> = {}): PetInput {
  return { id: randomUUID(), name, species: 'dog', breed: null, ageMonths: null, ...extra }
}

describe('pet lifecycle', () => {
  it('create → list (1) → update name → get → delete → list (0)', async () => {
    const { client } = await newOwner()
    const input = petInput('  Biscuit ', { breed: 'Beagle', ageMonths: 18 })

    const created = await createPet(client, input)
    expect(created).toEqual<Pet>({
      id: input.id,
      name: 'Biscuit',
      species: 'dog',
      breed: 'Beagle',
      ageMonths: 18,
      registrationState: 'private',
      discoveryEnabled: false,
      createdAt: expect.any(String),
    })
    expect(await listPets(client)).toEqual([created])

    const renamed = await updatePet(client, input.id, { name: 'Biscuit II' })
    expect(renamed).toEqual({ ...created, name: 'Biscuit II' })
    expect(await getPet(client, input.id)).toEqual(renamed)

    await deletePet(client, input.id)
    expect(await listPets(client)).toEqual([])
    expect(await getPet(client, input.id)).toBeNull()
  })

  it('updatePet: null clears breed and age, an absent field is left unchanged', async () => {
    const { client } = await newOwner()
    const input = petInput('Miso', { species: 'cat', breed: 'Tabby', ageMonths: 40 })
    await createPet(client, input)

    const aged = await updatePet(client, input.id, { ageMonths: 41 })
    expect(aged).toMatchObject({ name: 'Miso', species: 'cat', breed: 'Tabby', ageMonths: 41 })

    const cleared = await updatePet(client, input.id, { breed: null, ageMonths: null })
    expect(cleared).toMatchObject({ name: 'Miso', species: 'cat', breed: null, ageMonths: null })
    expect(await getPet(client, input.id)).toEqual(cleared)
  })

  it('listPets is ordered by createdAt, oldest first', async () => {
    const { client } = await newOwner()
    const ids: string[] = []
    for (const name of ['First', 'Second', 'Third']) {
      ids.push((await createPet(client, petInput(name))).id)
    }
    const pets = await listPets(client)
    expect(pets.map((p) => p.id)).toEqual(ids)
    const times = pets.map((p) => Date.parse(p.createdAt))
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('deleting a pet twice resolves (Ruling 18: a retried delete is not an error)', async () => {
    const { client } = await newOwner()
    const { id } = await createPet(client, petInput('Pip'))
    await deletePet(client, id)
    await expect(deletePet(client, id)).resolves.toBeUndefined()
  })
})

describe('the Free 3-pet limit', () => {
  it('concurrent creates never exceed the limit', async () => {
    const { client } = await newOwner()
    await createPet(client, petInput('One'))
    await createPet(client, petInput('Two'))

    // A double tap: two different pets submitted at once for the last free slot.
    const results = await Promise.allSettled([
      createPet(client, petInput('Three a')),
      createPet(client, petInput('Three b')),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reason).toMatchObject({ name: 'AppError', code: 'PET_LIMIT_REACHED' })
    expect(await listPets(client)).toHaveLength(3)
  })

  it('retrying createPet with the same id returns the same pet and keeps the count', async () => {
    const { client } = await newOwner()
    const input = petInput('Olive')
    const first = await createPet(client, input)

    const retried = await createPet(client, input)
    expect(retried).toEqual(first)
    expect(await listPets(client)).toEqual([first])
    expect((await getEntitlement(client)).activePets).toBe(1)
  })
})

describe('owner isolation', () => {
  it("owner B never sees owner A's pets", async () => {
    const a = await newOwner()
    const b = await newOwner()
    const aPet = await createPet(a.client, petInput('Mine'))
    const bPet = await createPet(b.client, petInput('Theirs'))

    expect(await listPets(b.client)).toEqual([bPet])
    expect(await getPet(b.client, aPet.id)).toBeNull()

    // B's delete of A's pet resolves (Ruling 18) but changes nothing.
    await deletePet(b.client, aPet.id)
    expect(await getPet(a.client, aPet.id)).toEqual(aPet)

    await expect(updatePet(b.client, aPet.id, { name: 'Stolen' })).rejects.toMatchObject({
      name: 'AppError',
      code: 'NOT_OWNER',
    })
    expect(await getPet(a.client, aPet.id)).toEqual(aPet)
  })
})
