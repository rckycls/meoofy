import { Card } from './Card'

export type PrivacyBannerProps = {
  text: string
}

export function PrivacyBanner({ text }: PrivacyBannerProps) {
  return <Card role="privacy">{text}</Card>
}
