export type NavKey = 'home' | 'find' | 'alerts' | 'account'

export const navItems = [
  { key: 'home', label: 'Home' },
  { key: 'find', label: 'Find' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'account', label: 'Account' },
] as const satisfies readonly { key: NavKey; label: string }[]

export type NavProps = {
  /** The destination currently shown. */
  active: NavKey
  /** Called with the destination the user picked. */
  onSelect?: (key: NavKey) => void
}
