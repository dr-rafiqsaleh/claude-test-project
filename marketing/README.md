# pestbase.co.uk

The public website for PestBase, a trading name of Service Record Ltd. Built
like the app: React 18, Vite, Tailwind, React Router, react-hook-form and zod,
with the app's theme tokens and UI components (`src/components/ui` is copied
from `frontend/src/components/ui`). Hosted separately from the app
(`app.pestbase.co.uk`).

| Page | Route | Source |
| --- | --- | --- |
| Home | `/` | `src/pages/HomePage.jsx` |
| Contact us (form) | `/contact` | `src/pages/ContactPage.jsx` |
| Privacy policy | `/privacy` | `src/content/privacyContent.js` |
| Terms and conditions | `/terms` | `src/content/termsContent.js` |
| Not found | anything else | `src/pages/NotFoundPage.jsx` |

## Company details

`src/content/company.js` holds the company's name, number, place of
registration and registered office. The footer on every page shows them, and
the privacy policy and terms point to the footer rather than repeating the
address - so a change of address is a one-line edit there.

## Contact form

The form posts to the app's API, `POST /api/v1/contact` (see
`backend/app/routers/contact.py`). The API stores every enquiry in the
`contact_enquiries` collection and emails it to `CONTACT_INBOX` through the
platform's mail settings (Platform > Settings in the app), with the enquirer as
the reply-to. If sending fails the enquiry is still kept, marked with the
reason.

Platform staff see every enquiry in the app under **Platform > Enquiries**:
open ones first, with who handled each, and an "Email again" button for any
that could not be emailed.

Spam protection: a hidden honeypot field, and at most `CONTACT_RATE_LIMIT_MAX`
enquiries per IP address per hour (5 by default).

`?topic=` pre-selects the subject - `demo`, `sales`, `support`, `privacy` or
`other` - which is how "Book a demo" buttons and the privacy policy link in.

On the API server:

```
CORS_ORIGINS=...,https://pestbase.co.uk   # let the website post to the API
CONTACT_INBOX=hello@pestbase.co.uk        # where enquiries are emailed
```

`python scripts/check_contact.py` (from `backend/`) checks the endpoint end to
end against a throwaway database and a fake mail server.

## Develop

```bash
cd marketing
npm install
npm run dev        # http://localhost:5174 - the form posts to the backend on :8000
```

## Build

```bash
npm run build      # -> dist/
npm run preview    # serve dist/ locally
```

`build` bundles the site, then prerenders every page to static HTML
(`scripts/prerender.mjs`): each page is published with its content, title,
description and footer already in the HTML, so it reads without JavaScript and
search engines see everything. React takes over in the browser.

A built site posts the form to `https://app.pestbase.co.uk`. To point it
elsewhere (a staging API), set `VITE_API_ORIGIN` at build time - see
`.env.example`.

## Host it

`dist/` is plain static files, so any static host works - Cloudflare Pages,
Netlify or S3 (build command `npm run build`, output `dist`, serve `404.html`
for unknown paths). Or the included image, which builds and serves it with
nginx:

```bash
docker build -t pestbase-marketing marketing
docker run -p 8080:80 pestbase-marketing
```

Then point DNS: `pestbase.co.uk` (and `www`) at the site, and
`app.pestbase.co.uk` at the app.

## Before publishing

- Create the `hello@pestbase.co.uk` mailbox (or set `CONTACT_INBOX` to another
  address), and set up the platform's mail settings in the app so enquiries are
  emailed.
- Have the privacy policy and terms reviewed. They were adapted from Service
  Record Ltd's ServiceRecord documents for what PestBase does.
