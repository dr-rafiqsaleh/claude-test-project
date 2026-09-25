import { Fragment } from 'react'
import { Link } from 'react-router-dom'

import { COMPANY } from '@/content/company'

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g
const linkClass = 'font-medium text-primary underline underline-offset-4 hover:no-underline'

/** Text with [label](href) links: in-site ones become router links. */
function RichText({ text }) {
  const parts = []
  let last = 0
  for (const match of text.matchAll(LINK)) {
    const [whole, label, href] = match
    parts.push(text.slice(last, match.index))
    parts.push(
      href.startsWith('/') ? (
        <Link key={match.index} to={href} className={linkClass}>
          {label}
        </Link>
      ) : (
        <a key={match.index} href={href} className={linkClass}>
          {label}
        </a>
      ),
    )
    last = match.index + whole.length
  }
  parts.push(text.slice(last))
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>)
}

function Block({ block }) {
  switch (block.type) {
    case 'p':
      return (
        <p>
          <RichText text={block.text} />
        </p>
      )
    case 'h3':
      return <h3 className="pt-2 text-base font-semibold text-foreground">{block.text}</h3>
    case 'ul':
      return (
        <ul className="list-disc space-y-1 pl-6">
          {block.items.map((item) => (
            <li key={item}>
              <RichText text={item} />
            </li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol className="list-[lower-alpha] space-y-1 pl-6">
          {block.items.map((item) => (
            <li key={item}>
              <RichText text={item} />
            </li>
          ))}
        </ol>
      )
    case 'table':
      // Wide tables scroll inside their own box rather than widening the page.
      return (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead className="bg-muted/60">
              <tr>
                {block.headers.map((header) => (
                  <th key={header} scope="col" className="px-3 py-2.5 text-left font-semibold text-foreground">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]} className="border-t align-top">
                  {row.map((cell, index) =>
                    index === 0 ? (
                      <th key={index} scope="row" className="w-[22%] px-3 py-2.5 text-left font-semibold text-foreground">
                        {cell}
                      </th>
                    ) : (
                      <td key={index} className="px-3 py-2.5">
                        <RichText text={cell} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    default:
      return null
  }
}

/** The company panel both documents open with. The address is in the footer only. */
export function CompanyDetails() {
  return (
    <ul className="list-disc space-y-1 pl-6">
      <li>{COMPANY.legalName}</li>
      <li>Trading as: {COMPANY.tradingName}</li>
      <li>Company number: {COMPANY.number}</li>
      <li>Registered in {COMPANY.registeredIn}</li>
    </ul>
  )
}

/**
 * A privacy policy or terms page: title, date, contents, then the sections.
 * A block of type "company" renders the company panel from content/company.js.
 */
export function LegalPage({ title, intro, updated, sections }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-20 pt-14 sm:px-6">
      <span className="inline-block rounded-full bg-accent px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-accent-foreground">
        Legal
      </span>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">Last updated: {updated}</p>
      <p className="mt-4 text-muted-foreground">{intro}</p>

      <nav aria-label="Contents" className="mt-8 rounded-lg border bg-muted/40 p-5">
        <h2 className="mb-2 font-semibold">Contents</h2>
        <ol className="gap-x-8 text-sm sm:columns-2">
          {sections.map((section) => (
            <li key={section.id} className="break-inside-avoid py-0.5">
              <a href={`#${section.id}`} className="text-primary hover:underline">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((section) => (
        <section key={section.id} id={section.id} className="mt-10">
          <h2 className="mb-3 text-xl font-semibold tracking-tight">{section.title}</h2>
          <div className="space-y-4 leading-relaxed text-muted-foreground">
            {section.blocks.map((block, index) =>
              block.type === 'company' ? <CompanyDetails key={index} /> : <Block key={index} block={block} />,
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
