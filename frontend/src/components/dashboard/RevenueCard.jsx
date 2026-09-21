import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Receipt } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/page'
import { cn, formatCurrency } from '@/lib/utils'

function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

/** Series colours come from index.css (validated for colour-vision deficiency). */
const SERIES = [
  { key: 'invoiced', label: 'Invoiced', color: 'var(--chart-invoiced)' },
  { key: 'collected', label: 'Collected', color: 'var(--chart-collected)' },
]

function RevenueTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm" style={{ background: entry.color }} aria-hidden="true" />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{formatCurrency(entry.value)}</span>
        </p>
      ))}
    </div>
  )
}

/** Invoiced against collected: one £ axis, and a table twin so no value is tooltip-only. */
export default function RevenueCard({ series, state, months }) {
  const [asTable, setAsTable] = useState(false)
  const hasData = series.some((row) => row.invoiced > 0 || row.collected > 0)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">Revenue</CardTitle>
          <CardDescription>Invoiced against collected, last {months} months.</CardDescription>
        </div>
        {state === 'ready' && hasData ? (
          <div className="inline-flex rounded-md border border-input p-0.5 text-xs font-medium" role="group" aria-label="Revenue view">
            {['Chart', 'Table'].map((label) => {
              const selected = (label === 'Table') === asTable
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setAsTable(label === 'Table')}
                  className={cn(
                    'rounded px-2.5 py-1 transition-colors duration-150',
                    selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {state === 'loading' ? (
          <Skeleton className="h-[284px]" />
        ) : state === 'failed' || !hasData ? (
          <EmptyState
            icon={Receipt}
            title={state === 'failed' ? 'Revenue figures are unavailable right now' : 'No invoices in the last six months'}
            className="py-12"
          />
        ) : asTable ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 font-medium">Month</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-2 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((row) => (
                <tr key={row.month} className="border-b border-border last:border-0">
                  <td className="py-2 text-foreground">{row.month}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-2 text-right tabular-nums text-foreground">
                      {formatCurrency(row[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <>
            <ul className="mb-3 flex gap-4 text-xs text-muted-foreground" aria-label="Legend">
              {SERIES.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
                  {s.label}
                </li>
              ))}
            </ul>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} barGap={2} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={{ stroke: 'hsl(var(--border))' }}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis
                    width={72}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(value) => `£${Number(value).toLocaleString('en-GB')}`}
                  />
                  <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} content={<RevenueTooltip />} />
                  {SERIES.map((s) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={24} radius={[4, 4, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
