# pestbase.co.uk

The public marketing site for PestBase: static HTML and CSS, no build step and
no JavaScript beyond the footer's year. It is deliberately separate from the
portal (`app.pestbase.co.uk`): different release cadence, nothing shared at
runtime, and nothing here can break sign-in.

| File | What |
| --- | --- |
| `index.html` | The home page |
| `privacy.html` | Privacy policy - also the URL both app stores require. **A draft: fill in the `[bracketed]` items and have it reviewed before publishing.** |
| `404.html`, `robots.txt`, `sitemap.xml` | The usual |
| `styles.css` | All the styling; light and dark themes |
| `favicon.svg` | The wasp, copied from `frontend/public/favicon.svg` |

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
