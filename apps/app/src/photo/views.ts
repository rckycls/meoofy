import type { PhotoView } from '@pawpin/core'

/** The views the guided capture asks for, in order. (An `extra` photo has no guided step.) */
export const GUIDED_VIEWS = ['front', 'side', 'markings'] as const satisfies readonly PhotoView[]

export type GuidedView = (typeof GUIDED_VIEWS)[number]
