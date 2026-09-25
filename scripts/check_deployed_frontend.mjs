#!/usr/bin/env node
//
// Is the portal you are looking at actually built from the source on disk?
//
//   node scripts/check_deployed_frontend.mjs [http://localhost:3000]
//
// The failure this exists for: a fix lands in frontend/src, the containers are
// restarted rather than rebuilt, and the browser keeps serving the previous
// bundle. Every symptom then points at the code that was fixed, so the next
// hour goes on re-fixing something that was never running.
//
// How it decides, without a list to maintain: Vite minifies names but keeps
// string literals verbatim, so any long user-facing message in the source must
// appear somewhere in the served JavaScript. It samples such messages and looks
// for them. Missing ones mean the bundle predates the file they came from.
//
// Deliberately zero dependencies (no parser, no fetch library): it has to run
// on a machine where `npm ci` may itself be the thing that is broken.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const origin = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const SRC = 'frontend/src'
const MIN_LENGTH = 30
const SAMPLE_PER_FILE = 3

// Only literals made of characters that survive both source and bundle
// unchanged. Anything with a quote, a backslash or a template hole is skipped
// rather than unescaped - there are plenty of candidates without them.
const SAFE = /^[A-Za-z0-9 .,!?;:()/%&@#+=-]+$/
const LITERAL = /(['"])([^'"\\\n]{30,200})\1/g

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return jsFiles(full)
    return /\.jsx?$/.test(entry.name) ? [full] : []
  })
}

async function get(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return response.text()
}

/** The entry bundle plus any code-split chunk it names. */
async function servedJavaScript() {
  const html = await get(`${origin}/`)
  const entries = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1])
  if (entries.length === 0) throw new Error(`no <script src=...> in the HTML at ${origin}/`)

  const seen = new Set()
  const texts = []
  const queue = [...entries]
  while (queue.length) {
    const path = queue.shift()
    if (seen.has(path)) continue
    seen.add(path)
    const text = await get(new URL(path, `${origin}/`).href)
    texts.push(text)
    for (const m of text.matchAll(/["'](\/assets\/[A-Za-z0-9_.-]+\.js)["']/g)) queue.push(m[1])
  }
  return { code: texts.join('\n'), files: [...seen] }
}

let served
try {
  served = await servedJavaScript()
} catch (error) {
  console.error(`FAIL  cannot read the portal at ${origin}`)
  console.error(`      ${error.message}`)
  console.error('      Is the stack up?  ./scripts/compose.ps1 local ps')
  process.exit(2)
}

// Newest source file first: a stale bundle is most likely missing what changed
// last, so the check reports the useful name rather than an arbitrary one.
const sources = jsFiles(SRC)
  .map((path) => ({ path, mtime: statSync(path).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)

const missing = []
let checked = 0

for (const { path } of sources) {
  const found = new Set()
  for (const [, , value] of readFileSync(path, 'utf8').matchAll(LITERAL)) {
    if (!SAFE.test(value)) continue
    if (!value.includes(' ')) continue        // identifiers, class names, paths
    if (value.length < MIN_LENGTH) continue
    found.add(value.trim())
    if (found.size >= SAMPLE_PER_FILE) break
  }
  for (const value of found) {
    checked += 1
    if (!served.code.includes(value)) missing.push({ path: relative('.', path), value })
  }
}

const bytes = served.code.length.toLocaleString()
console.log(`served: ${served.files.join(', ')} (${bytes} bytes of JavaScript)`)
console.log(`checked ${checked} source strings from ${sources.length} files under ${SRC}`)

if (missing.length === 0) {
  console.log(`PASS  the portal at ${origin} was built from the source on disk`)
  process.exit(0)
}

console.error(`FAIL  the portal at ${origin} is serving an older build`)
console.error(`      ${missing.length} of ${checked} source strings are absent from the bundle:`)
for (const { path, value } of missing.slice(0, 8)) {
  console.error(`        ${path}`)
  console.error(`          "${value.length > 70 ? value.slice(0, 70) + '...' : value}"`)
}
if (missing.length > 8) console.error(`        ... and ${missing.length - 8} more`)
console.error('')
console.error('      Rebuild rather than restart - VITE_* values and the source are')
console.error('      compiled into the image:')
console.error('        ./scripts/compose.ps1 local up -d --build frontend')
process.exit(1)
