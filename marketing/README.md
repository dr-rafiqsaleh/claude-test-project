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
| `partials/footer.html` | The footer on every page, with the company's statutory details |
| `preview.py` | Local preview that fills in the footer |
| `favicon.svg` | The wasp, copied from `frontend/public/favicon.svg` |

## Before publishing

- The company's details, including the registered office address, live in one
  file: `partials/footer.html`. Every page pulls it in, and the privacy policy
  and terms point to the footer, so a change of address is a one-line edit
  there and nothing else.
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
python3 preview.py 8080    # http://localhost:8080
```

Use `preview.py` rather than `python3 -m http.server` or opening a file
directly: those leave out the shared footer.

## Host it

Use the included image, which serves the site with nginx and fills in the
footer:

```bash
docker build -t pestbase-marketing marketing
docker run -p 8080:80 pestbase-marketing
```

Any other host must support nginx-style server-side includes (`ssi on`).
Plain static hosts such as Cloudflare Pages, Netlify, GitHub Pages or an S3
bucket do not, and would publish every page **without its footer** - and so
without the company details UK law requires.

Then point DNS: `pestbase.co.uk` (and `www`) at the site, and
`app.pestbase.co.uk` at the portal. The site links to
`https://app.pestbase.co.uk/login` for sign-in and uses `hello@pestbase.co.uk`
as the contact address - change both in `index.html` if they differ.
