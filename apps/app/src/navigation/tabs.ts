import { navItems, type NavKey } from '@meoofy/ui'

/** The route behind each nav destination. */
export const tabHref = {
  home: '/(tabs)/home',
  find: '/(tabs)/find',
  alerts: '/(tabs)/alerts',
  account: '/(tabs)/account',
} as const satisfies Record<NavKey, string>

const navKeys: readonly string[] = navItems.map((item) => item.key)
const isNavKey = (value: string): value is NavKey => navKeys.includes(value)

/** The destination to show as selected for a pathname (route groups are not part of it). */
export function navKeyForPath(pathname: string): NavKey {
  const first = pathname.split('/').find((segment) => segment !== '') ?? ''
  return isNavKey(first) ? first : 'home'
}
