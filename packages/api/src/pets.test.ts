// Pets without a network: what each function sends, how rows map, and validation before requests.
import type { PetInput, PetPatch } from '@meoofy/core'
import { describe, expect, it, vi } from 'vitest'
import { createPet, deletePet, getPet, listPets, updatePet } from './index'
import { offline, respond, stubClient } from './testSupport'

const ID = '6f1c1d4e-1111-4222-8333-944455556666'

/** A registry.pets row as create_pet/update_pet return it (owner_id included). */
const row = {
  id: ID,
  owner_id: '0b0b0b0b-1111-4222-8333-944455556666',
  name: 'Rex',
  species: 'dog',
  breed: null,
  age_months: 14,
  registration_state: 'private',
  discovery_enabled: false,
  created_at: '2026-10-23T09:00:00+00:00',
  updated_at: '2026-10-23T09:00:00+00:00',
}

const pet = {
  id: ID,
  name: 'Rex',
  species: 'dog',
  breed: null,
  ageMonths: 14,
  registrationState: 'private',
  discoveryEnabled: false,
  createdAt: '2026-10-23T09:00:00+00:00',
}

const bodyOf = (fetch: ReturnType<typeof vi.fn>) =>
  JSON.parse(String((fetch.mock.calls[0]![1] as RequestInit).body)) as unknown
const urlOf = (fetch: ReturnType<typeof vi.fn>) => new URL(String(fetch.mock.calls[0]![0]))

describe('createPet', () => {
  it('sends the validated input (trimmed, empty breed as null) and maps the row', async () => {
    const fetch = vi.fn(respond(200, row))
    const input = { id: ID, name: '  Rex ', species: 'dog', breed: '  ', ageMonths: null } as const
    expect(await createPet(stubClient(fetch), input)).toEqual(pet)
    expect(urlOf(fetch).pathname).toBe('/rest/v1/rpc/create_pet')
    expect(bodyOf(fetch)).toEqual({
      id: ID,
      name: 'Rex',
      species: 'dog',
      breed: null,
      age_months: null,
    })
  })

  it.each<[string, Partial<PetInput>]>([
    ['an id that is not a uuid', { id: 'pet-1' }],
    ['an empty name', { name: '   ' }],
    ['a 41-character name', { name: 'a'.repeat(41) }],
    ['an unknown species', { species: 'ferret' as PetInput['species'] }],
    ['an 81-character breed', { breed: 'b'.repeat(81) }],
    ['a negative age', { ageMonths: -1 }],
    ['an age over 360 months', { ageMonths: 361 }],
    ['a fractional age', { ageMonths: 1.5 }],
  ])('rejects %s as VALIDATION without a request', async (_label, change) => {
    const fetch = vi.fn(offline)
    const input = { id: ID, name: 'Rex', species: 'dog', breed: null, ageMonths: null, ...change }
    await expect(createPet(stubClient(fetch), input as PetInput)).rejects.toMatchObject({
      name: 'AppError',
      code: 'VALIDATION',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('surfaces the server limit as PET_LIMIT_REACHED', async () => {
    const fetch = respond(400, { code: 'P0001', message: 'MEOOFY:PET_LIMIT_REACHED' })
    const input = { id: ID, name: 'Rex', species: 'dog', breed: null, ageMonths: null } as const
    await expect(createPet(stubClient(fetch), input)).rejects.toMatchObject({
      name: 'AppError',
      code: 'PET_LIMIT_REACHED',
    })
  })
})

describe('updatePet', () => {
  it.each<[string, PetPatch, Record<string, unknown>]>([
    [
      'null breed and age become the clear flags',
      { breed: null, ageMonths: null },
      { clear_breed: true, clear_age: true },
    ],
    [
      'an empty breed clears it too',
      { name: ' Rex ', breed: '  ' },
      { name: 'Rex', clear_breed: true },
    ],
    [
      'values are sent as values',
      { species: 'cat', breed: ' Tabby ', ageMonths: 5 },
      { species: 'cat', breed: 'Tabby', age_months: 5 },
    ],
    ['an empty patch sends only the id', {}, {}],
  ])('%s; absent fields are not sent', async (_label, patch, sent) => {
    const fetch = vi.fn(respond(200, row))
    expect(await updatePet(stubClient(fetch), ID, patch)).toEqual(pet)
    expect(urlOf(fetch).pathname).toBe('/rest/v1/rpc/update_pet')
    expect(bodyOf(fetch)).toEqual({ id: ID, ...sent })
  })

  it.each<[string, string, PetPatch]>([
    ['an id that is not a uuid', 'pet-1', { name: 'Rex' }],
    ['an empty name', ID, { name: '' }],
    ['an unknown species', ID, { species: 'ferret' as PetPatch['species'] }],
    ['an age over 360 months', ID, { ageMonths: 361 }],
  ])('rejects %s as VALIDATION without a request', async (_label, id, patch) => {
    const fetch = vi.fn(offline)
    await expect(updatePet(stubClient(fetch), id, patch)).rejects.toMatchObject({
      name: 'AppError',
      code: 'VALIDATION',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('deletePet', () => {
  it('calls delete_pet with the id', async () => {
    const fetch = vi.fn(respond(204))
    await expect(deletePet(stubClient(fetch), ID)).resolves.toBeUndefined()
    expect(urlOf(fetch).pathname).toBe('/rest/v1/rpc/delete_pet')
    expect(bodyOf(fetch)).toEqual({ id: ID })
  })

  it('resolves when the server answers NOT_OWNER (Ruling 18: already gone)', async () => {
    const fetch = respond(400, { code: 'P0001', message: 'MEOOFY:NOT_OWNER' })
    await expect(deletePet(stubClient(fetch), ID)).resolves.toBeUndefined()
  })

  it('rejects an id that is not a uuid as VALIDATION without a request', async () => {
    const fetch = vi.fn(offline)
    await expect(deletePet(stubClient(fetch), 'pet-1')).rejects.toMatchObject({
      name: 'AppError',
      code: 'VALIDATION',
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('reads', () => {
  it('listPets reads api.pets oldest first and maps every row', async () => {
    const fetch = vi.fn(respond(200, [row, { ...row, id: ID.replace('6f', '7f'), name: 'Ivy' }]))
    expect(await listPets(stubClient(fetch))).toEqual([
      pet,
      { ...pet, id: ID.replace('6f', '7f'), name: 'Ivy' },
    ])
    const url = urlOf(fetch)
    expect(url.pathname).toBe('/rest/v1/pets')
    expect(url.searchParams.get('order')).toBe('created_at.asc,id.asc')
  })

  it('getPet returns the mapped pet, or null when the caller has no such pet', async () => {
    expect(await getPet(stubClient(respond(200, [row])), ID)).toEqual(pet)
    const fetch = vi.fn(respond(200, []))
    expect(await getPet(stubClient(fetch), ID)).toBeNull()
    expect(urlOf(fetch).searchParams.get('id')).toBe(`eq.${ID}`)
  })

  it('getPet rejects an id that is not a uuid as VALIDATION without a request', async () => {
    const fetch = vi.fn(offline)
    await expect(getPet(stubClient(fetch), 'pet-1')).rejects.toMatchObject({
      name: 'AppError',
      code: 'VALIDATION',
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a row missing a NOT NULL column is UNKNOWN, not a half-built pet', async () => {
    await expect(
      listPets(stubClient(respond(200, [{ ...row, name: null }]))),
    ).rejects.toMatchObject({ name: 'AppError', code: 'UNKNOWN' })
  })
})
