import type { Context } from '@just-genius/dsh-plugin-runtime/host'
import { defineDomain, type Domain } from '@just-genius/dsh-plugin-runtime/host'
import { z } from 'zod'
import { INITIAL_STATE, normalizeState, type PetState } from './shared/pet-state.ts'

const PetStateSchema = z.object({
  level: z.number(),
  xp: z.number(),
  stats: z.object({
    tasksDone: z.number(),
    failures: z.number(),
    sessions: z.number(),
    activeMs: z.number(),
    firstSeenAt: z.number().nullable(),
  }),
  titles: z.array(z.string()),
  memory: z.array(z.string()),
  updatedAt: z.number(),
})

const PET_DOMAIN = defineDomain({
  name: 'dsh_whale_girl',
  version: 1,
  global: {
    schema: PetStateSchema,
    initial: INITIAL_STATE,
  },
  tables: {},
})

export interface PetStore {
  load(): PetState
  save(state: PetState): Promise<void>
  close(): Promise<void>
}

export async function openPetStore(ctx: Context): Promise<PetStore> {
  const domain: Domain<typeof PET_DOMAIN> = await ctx.storageDomain.open(PET_DOMAIN)
  return {
    load: () => normalizeState(domain.global.get()) ?? freshState(),
    save: state => domain.global.set(state),
    close: () => domain.close(),
  }
}

function freshState(): PetState {
  return {
    ...INITIAL_STATE,
    stats: { ...INITIAL_STATE.stats },
    titles: [],
    memory: [],
    updatedAt: Date.now(),
  }
}
