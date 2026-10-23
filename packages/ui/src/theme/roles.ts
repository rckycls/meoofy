// Colour roles. Every text/background pair in the app comes from here, and the
// pairs are AA-checked (see theme.test.ts), so screens never pick their own.

export type CardRole =
  'privacy' | 'tip' | 'community' | 'warning' | 'celebration' | 'attention' | 'plain'

export type CardRoleColors = {
  /** Gradient start (top). */
  from: string
  /** Gradient end (bottom). */
  to: string
  title: string
  body: string
  stroke?: string
}

export const cardRoles: Record<CardRole, CardRoleColors> = {
  privacy: { from: '#DCEEFF', to: '#E8F1FF', title: '#2858C8', body: '#2858C8' },
  tip: { from: '#D9F5EA', to: '#EAFAF3', title: '#1C7055', body: '#2A6450' },
  community: { from: '#E9E5FF', to: '#F3F0FF', title: '#5B4FC9', body: '#4B4396' },
  warning: { from: '#FFE4CF', to: '#FFF0E4', title: '#A04E1C', body: '#7E4019' },
  celebration: { from: '#FFE3EC', to: '#FFF1F5', title: '#B03562', body: '#7D3350' },
  attention: { from: '#FFF2AE', to: '#FFF8D6', title: '#7A5A00', body: '#6B5300' },
  plain: { from: '#FFFFFF', to: '#FFFFFF', title: '#183B73', body: '#465268', stroke: '#E9EEF6' },
}

export type Flow = 'onboarding' | 'owner' | 'finder' | 'recovery' | 'outcomes' | 'resilience'

export type FlowTint = {
  /** Screen background tint. */
  tint: string
  /** Ambient glow, top right. */
  glowA: string
  /** Ambient glow, bottom left. */
  glowB: string
}

export const flowTints: Record<Flow, FlowTint> = {
  onboarding: { tint: '#E9F3FF', glowA: '#FFF2AE', glowB: '#E6E1FF' },
  owner: { tint: '#E6F2FF', glowA: '#FFF2AE', glowB: '#CFE6FF' },
  finder: { tint: '#E3F7EF', glowA: '#C9F0E0', glowB: '#DCEEFF' },
  recovery: { tint: '#FFEEF3', glowA: '#FFD3E0', glowB: '#E6E1FF' },
  outcomes: { tint: '#EFEBFF', glowA: '#DCD5FF', glowB: '#FFE1CC' },
  resilience: { tint: '#FFF1E6', glowA: '#FFE1C8', glowB: '#FFF2AE' },
}
