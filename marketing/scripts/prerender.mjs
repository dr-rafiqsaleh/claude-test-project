/**
 * Renders every page to static HTML after `vite build`.
 *
 * Each page is written with its content, title, description and canonical link
 * already in place, so search engines and visitors without JavaScript get the
 * whole page - footer and company details included - and any static host can
 * serve the result. React then takes over in the browser for the contact form.
 *
 *   dist/index.html            /
 *   dist/contact/index.html    /contact
 *   dist/privacy/index.html    /privacy
 *   dist/terms/index.html      /terms
 *   dist/404.html              anything else
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const serverEntry = path.join(root, 'dist-server', 'entry-server.js')

const { render, PAGES, SITE_URL } = await import(serverEntry)
const template = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')

const escape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function page(url, outFile) {
  const meta = PAGES[url]
  const head = [
    `<title>${escape(meta.title)}</title>`,
    `<meta name="description" content="${escape(meta.description)}" />`,
    meta.noindex
      ? '<meta name="robots" content="noindex" />'
      : `<link rel="canonical" href="${SITE_URL}${url === '/' ? '/' : url}" />`,
    `<meta property="og:title" content="${escape(meta.title)}" />`,
    `<meta property="og:description" content="${escape(meta.description)}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="PestBase" />',
    '<meta property="og:locale" content="en_GB" />',
  ].join('\n    ')

  const html = template
    .replace(/<!--page-meta-->[\s\S]*<!--\/page-meta-->/, head)
    .replace('<!--app-html-->', render(url === '/404' ? '/this-page-does-not-exist' : url))

  const target = path.join(dist, outFile)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, html)
  console.log(`  prerendered ${url.padEnd(9)} -> dist/${outFile}`)
}

for (const url of Object.keys(PAGES)) {
  page(url, url === '/' ? 'index.html' : url === '/404' ? '404.html' : `${url.slice(1)}/index.html`)
}

fs.rmSync(path.join(root, 'dist-server'), { recursive: true, force: true })
