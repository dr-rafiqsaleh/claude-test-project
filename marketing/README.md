# pestbase.co.uk

The public marketing site for PestBase: static HTML and CSS, no build step and
no JavaScript beyond the footer's year. It is deliberately separate from the
portal (`app.pestbase.co.uk`): different release cadence, nothing shared at
runtime, and nothing here can break sign-in.

| File | What |
| --- | --- |
| `index.html` | The home page |
| `privacy.html` | Privacy policy, adapted from Service Record Ltd's ServiceRecord policy |
| `terms.html` | Terms and conditions, adapted the same way |
| `404.html`, `robots.txt`, `sitemap.xml` | The usual |
| `styles.css` | All the styling; light and dark themes |
| `favicon.svg` | The wasp, copied from `frontend/public/favicon.svg` |

## Before publishing

- The registered office address lives only in the footer, so a change of
  address never touches the privacy policy or terms. The footer is repeated in
  each page (`index.html`, `privacy.html`, `terms.html`, `404.html`): search
  for "Registered office" and update all four.
- Create the mailboxes the pages use: `hello@pestbase.co.uk` and
  `privacy@pestbase.co.uk`.
- Have the privacy policy and terms reviewed. They were adapted from Service
  Record Ltd's ServiceRecord documents for what PestBase does: no AI features,
  no free-trial checks and no named payment provider, but support access,
  emails sent through the customer's own mail account and pest-control
  record-keeping responsibilities.

## Preview

```bash
cd marketing
python3 -m http.server 8080    # http://localhost:8080
```

## Host it

Any static host works: Cloudflare Pages, Netlify, GitHub Pages or an S3
bucket - point it at this folder, no build command. Or the included image:

```bash
docker build -t pestbase-marketing marketing
docker run -p 8080:80 pestbase-marketing
```

Then point DNS: `pestbase.co.uk` (and `www`) at the site, and
`app.pestbase.co.uk` at the portal. The site links to
`https://app.pestbase.co.uk/login` for sign-in and uses `hello@pestbase.co.uk`
as the contact address - change both in `index.html` if they differ.
