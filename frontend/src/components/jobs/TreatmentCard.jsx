import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BAIT_STATUS_LABELS, TREATMENT_METHOD_LABELS } from '@/lib/constants'

function Detail({ label, value }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="break-words text-sm text-foreground">{value}</p>
    </div>
  )
}

/** One product used on site, with the details the report prints for it. */
export function TreatmentCard({ treatment, index, editable = false, onDelete, className }) {
  return (
    <div
      className={cn(
        'space-y-3 rounded-lg border border-border bg-card p-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            Product {index + 1}
          </span>
          <h4 className="text-sm font-semibold text-foreground">
            {treatment.product_name || 'Unnamed product'}
          </h4>
          <span className="text-sm text-muted-foreground">- {treatment.pest_type}</span>
          <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
            {TREATMENT_METHOD_LABELS[treatment.method] ?? treatment.method}
          </span>
        </div>

        {editable && onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
            aria-label={`Delete product ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Active ingredient" value={treatment.active_ingredient} />
        <Detail label="HSE / MAPP number" value={treatment.registration_number} />
        <Detail label="Concentration" value={treatment.product_concentration} />
        <Detail label="Quantity" value={treatment.quantity_used} />
        <Detail
          label="Location"
          value={treatment.areas_treated?.length ? treatment.areas_treated.join(', ') : null}
        />
        <Detail label="Bait status" value={BAIT_STATUS_LABELS[treatment.bait_status]} />
        <Detail label="Safety data sheet" value={treatment.safety_data_sheet_ref} />
      </div>
    </div>
  )
}

export default TreatmentCard
