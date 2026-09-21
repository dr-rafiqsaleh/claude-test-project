import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TREATMENT_METHOD_LABELS } from '@/lib/constants'

function Detail({ label, value }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="break-words text-sm text-slate-800 dark:text-slate-200">{value}</p>
    </div>
  )
}

/** One treatment applied on site. */
export function TreatmentCard({ treatment, index, editable = false, onDelete, className }) {
  return (
    <div
      className={cn(
        'space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Treatment {index + 1}
          </span>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {treatment.pest_type}
          </h4>
          <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
            {TREATMENT_METHOD_LABELS[treatment.method] ?? treatment.method}
          </span>
        </div>

        {editable && onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
            onClick={onDelete}
            aria-label={`Delete treatment ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Product" value={treatment.product_name} />
        <Detail label="Concentration" value={treatment.product_concentration} />
        <Detail label="Quantity used" value={treatment.quantity_used} />
        <Detail
          label="Areas treated"
          value={treatment.areas_treated?.length ? treatment.areas_treated.join(', ') : null}
        />
        <Detail label="Safety data sheet" value={treatment.safety_data_sheet_ref} />
      </div>
    </div>
  )
}

export default TreatmentCard
