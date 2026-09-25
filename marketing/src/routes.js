/**
 * Every page of the website, with the title and description it is published
 * under. The prerender step writes these into each page's HTML, and PageMeta
 * keeps the tab title right when moving between pages in the browser.
 */
export const PAGES = {
  '/': {
    title: 'PestBase – Pest control management software for UK operators',
    description:
      "PestBase runs a pest control business from first call to paid invoice: customers, quotes, scheduling, photographic inspection reports from the technician's phone, and invoicing. Works in any browser.",
  },
  '/contact': {
    title: 'Contact us – PestBase',
    description: 'Book a demo, ask about pricing or get help with PestBase. We reply by email.',
  },
  '/privacy': {
    title: 'Privacy Policy – PestBase',
    description:
      'How PestBase, a trading name of Service Record Ltd, collects, uses, stores and shares personal data on its website and platform.',
  },
  '/terms': {
    title: 'Terms and Conditions – PestBase',
    description:
      'The business terms governing access to and use of the PestBase website and platform, provided by Service Record Ltd.',
  },
  '/404': {
    title: 'Page not found – PestBase',
    description: 'That page does not exist.',
    noindex: true,
  },
}
