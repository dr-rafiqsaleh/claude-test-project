import { LegalPage } from '@/components/legal/LegalPage'
import { TERMS_LAST_UPDATED, TERMS_SECTIONS } from '@/content/termsContent'

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms and Conditions"
      intro="Please read these Terms carefully. PestBase is a trading name of Service Record Ltd."
      updated={TERMS_LAST_UPDATED}
      sections={TERMS_SECTIONS}
    />
  )
}
