import { LegalPage } from '@/components/legal/LegalPage'
import { PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from '@/content/privacyContent'

export default function PrivacyPage() {
  return (
    <LegalPage
      title="PestBase Privacy Policy"
      intro="Welcome to PestBase's Privacy Policy. PestBase is a trading name of Service Record Ltd."
      updated={PRIVACY_LAST_UPDATED}
      sections={PRIVACY_SECTIONS}
    />
  )
}
