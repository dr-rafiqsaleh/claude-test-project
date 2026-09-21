import { useState } from 'react'
import { Plus, X } from 'lucide-react'

import { FormField, SELECT_CLASSES } from '@/components/jobs/JobFormControls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  INSPECTION_AREAS,
  PEST_TYPES,
  TREATMENT_METHODS,
  TREATMENT_METHOD_LABELS,
} from '@/lib/constants'

const OTHER = 'Other'

function emptyTreatment() {
  return {
    pest_type: PEST_TYPES[0],
    customPest: '',
    method: 'spray',
    product_name: '',
    product_concentration: '',
    areas_treated: [],
    quantity_used: '',
    safety_data_sheet_ref: '',
  }
}

/**
 * Inline "Add treatment" form.
 *
 * Calls `onAdd(treatment)` with a plain treatment object ready to append to
 * `job.treatments`, then resets itself.
 */
export function TreatmentForm({ onAdd, onCancel, large = false, className }) {
  const [draft, setDraft] = useState(emptyTreatment)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const selectClass = cn(SELECT_CLASSES, large && 'h-12 text-base')
  const inputClass = large ? 'h-12 text-base' : undefined

  function set(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function toggleArea(area) {
    setDraft((current) => ({
      ...current,
      areas_treated: current.areas_treated.includes(area)
        ? current.areas_treated.filter((item) => item !== area)
        : [...current.areas_treated, area],
    }))
  }

  async function handleSubmit() {
    const pestType = draft.pest_type === OTHER ? draft.customPest.trim() : draft.pest_type

    if (!pestType) {
      setError('Choose or type a pest type.')
      return
    }
    if (!draft.product_name.trim()) {
      setError('Record the product that was used.')
      return
    }

    setError(null)
    setSaving(true)
    const saved = await onAdd({
      pest_type: pestType,
      method: draft.method,
      product_name: draft.product_name.trim(),
      product_concentration: draft.product_concentration.trim() || null,
      areas_treated: draft.areas_treated,
      quantity_used: draft.quantity_used.trim() || null,
      safety_data_sheet_ref: draft.safety_data_sheet_ref.trim() || null,
    })
    setSaving(false)

    // A failed save keeps the entry on screen so nothing has to be re-typed.
    if (saved === false) {
      setError('Not saved. Check your connection and tap Add treatment again.')
      return
    }
    setDraft(emptyTreatment())
  }

  return (
    <div
      className={cn(
        'space-y-4 rounded-lg border border-sky-200 bg-sky-50/40 p-4 dark:border-sky-900 dark:bg-sky-950/20',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">New treatment</h4>
        {onCancel ? (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel}>
            <X className="h-4 w-4" />
            <span className="sr-only">Cancel</span>
          </Button>
        ) : null}
      </div>

      <div className={cn('grid gap-4', large ? 'grid-cols-1' : 'sm:grid-cols-2')}>
        <FormField label="Pest type" htmlFor="treatment-pest">
          <select
            id="treatment-pest"
            value={draft.pest_type}
            onChange={(event) => set('pest_type', event.target.value)}
            className={selectClass}
          >
            {PEST_TYPES.map((pest) => (
              <option key={pest} value={pest}>
                {pest}
              </option>
            ))}
            <option value={OTHER}>{OTHER}</option>
          </select>
          {draft.pest_type === OTHER ? (
            <Input
              value={draft.customPest}
              onChange={(event) => set('customPest', event.target.value)}
              placeholder="Name the pest"
              className={cn('mt-2', inputClass)}
            />
          ) : null}
        </FormField>

        <FormField label="Method" htmlFor="treatment-method">
          <select
            id="treatment-method"
            value={draft.method}
            onChange={(event) => set('method', event.target.value)}
            className={selectClass}
          >
            {TREATMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {TREATMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Product name" htmlFor="treatment-product">
          <Input
            id="treatment-product"
            value={draft.product_name}
            onChange={(event) => set('product_name', event.target.value)}
            placeholder="Maxforce Gold Cockroach Gel"
            className={inputClass}
          />
        </FormField>

        <FormField label="Concentration" htmlFor="treatment-concentration">
          <Input
            id="treatment-concentration"
            value={draft.product_concentration}
            onChange={(event) => set('product_concentration', event.target.value)}
            placeholder="0.5%"
            className={inputClass}
          />
        </FormField>

        <FormField label="Quantity used" htmlFor="treatment-quantity">
          <Input
            id="treatment-quantity"
            value={draft.quantity_used}
            onChange={(event) => set('quantity_used', event.target.value)}
            placeholder="500ml"
            className={inputClass}
          />
        </FormField>

        <FormField label="Safety data sheet ref" htmlFor="treatment-sds">
          <Input
            id="treatment-sds"
            value={draft.safety_data_sheet_ref}
            onChange={(event) => set('safety_data_sheet_ref', event.target.value)}
            placeholder="SDS-MXF-2024-03"
            className={inputClass}
          />
        </FormField>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Areas treated
        </p>
        <div className="flex flex-wrap gap-2">
          {INSPECTION_AREAS.map((area) => {
            const selected = draft.areas_treated.includes(area)
            return (
              <button
                key={area}
                type="button"
                onClick={() => toggleArea(area)}
                aria-pressed={selected}
                className={cn(
                  'rounded-full border px-3 font-medium transition-colors',
                  large ? 'py-2 text-sm' : 'py-1 text-xs',
                  selected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-card text-muted-foreground hover:bg-muted/50',
                )}
              >
                {area}
              </button>
            )
          })}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={saving}
          className={large ? 'h-12 w-full text-base' : undefined}
        >
          <Plus className="h-4 w-4" />
          {saving ? 'Saving...' : 'Add treatment'}
        </Button>
        {onCancel && !large ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export default TreatmentForm
