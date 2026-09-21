import { useState } from 'react'
import { Plus, X } from 'lucide-react'

import { ChoiceChips, FormField, SELECT_CLASSES } from '@/components/jobs/JobFormControls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCompanySettings } from '@/hooks/useCompanySettings'
import { cn } from '@/lib/utils'
import {
  BAIT_STATUSES,
  BAIT_STATUS_LABELS,
  INSPECTION_AREAS,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
  TREATMENT_METHODS,
  TREATMENT_METHOD_LABELS,
  pestOptions,
} from '@/lib/constants'

const OTHER = 'Other'

/** The product select's value for "not in the list, type it in". */
const TYPED = '__typed__'

function emptyTreatment(pests) {
  return {
    // Empty until chosen; with no product list at all, the form is typed in.
    productChoice: '',
    pest_type: pests[0],
    customPest: '',
    method: 'spray',
    product_name: '',
    product_category: '',
    active_ingredient: '',
    registration_number: '',
    areas_treated: [],
    quantity_used: '',
    bait_status: '',
  }
}

/** One line describing a product from the list, e.g. "Rodenticide · Difenacoum · HSE 1234". */
function productSummary(product) {
  return [
    PRODUCT_CATEGORY_LABELS[product.category]?.replace(/ \(.*\)$/, ''),
    product.active_ingredient,
    product.formulation,
    product.registration_number,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Inline "Add product" form.
 *
 * The technician picks a product from the company's list, and its active
 * ingredient, registration number and safety sheet are copied onto the
 * report. A product that is not in the list can be typed in instead.
 *
 * Calls `onAdd(treatment)` with a plain treatment object ready to append to
 * `job.treatments`, then resets itself.
 */
export function TreatmentForm({ onAdd, onCancel, pestsFound = [], large = false, className }) {
  const settings = useCompanySettings()
  const products = settings?.products ?? []
  const pests = [...new Set([...pestsFound, ...pestOptions(pestsFound)])]

  const [draft, setDraft] = useState(() => emptyTreatment(pests))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const selectClass = cn(SELECT_CLASSES, large && 'h-12 text-base')
  const inputClass = large ? 'h-12 text-base' : undefined

  const typed = draft.productChoice === TYPED || products.length === 0
  const product = typed ? null : products.find((item) => item.id === draft.productChoice)
  const category = product?.category ?? draft.product_category
  const showBaitStatus = draft.method === 'bait' || category === 'rodenticide'

  function set(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function chooseProduct(choice) {
    const picked = products.find((item) => item.id === choice)
    setDraft((current) => ({
      ...current,
      productChoice: choice,
      // Rodenticides are laid as bait, so save a tap.
      method: picked?.category === 'rodenticide' ? 'bait' : current.method,
    }))
  }

  async function handleSubmit() {
    const pestType = draft.pest_type === OTHER ? draft.customPest.trim() : draft.pest_type

    if (!typed && !product) {
      setError('Choose the product you used.')
      return
    }
    if (typed && !draft.product_name.trim()) {
      setError('Name the product you used.')
      return
    }
    if (!pestType) {
      setError('Choose or type the pest it was for.')
      return
    }

    const details = product
      ? {
          product_id: product.id,
          product_name: product.name,
          product_category: product.category,
          active_ingredient: product.active_ingredient ?? null,
          formulation: product.formulation ?? null,
          registration_number: product.registration_number ?? null,
          safety_data_sheet_ref: product.safety_data_sheet_ref ?? null,
        }
      : {
          product_id: null,
          product_name: draft.product_name.trim(),
          product_category: draft.product_category || null,
          active_ingredient: draft.active_ingredient.trim() || null,
          formulation: null,
          registration_number: draft.registration_number.trim() || null,
          safety_data_sheet_ref: null,
        }

    setError(null)
    setSaving(true)
    const saved = await onAdd({
      ...details,
      pest_type: pestType,
      method: draft.method,
      areas_treated: draft.areas_treated,
      quantity_used: draft.quantity_used.trim() || null,
      bait_status: showBaitStatus ? draft.bait_status || null : null,
    })
    setSaving(false)

    // A failed save keeps the entry on screen so nothing has to be re-typed.
    if (saved === false) {
      setError('Not saved. Check your connection and tap Add product again.')
      return
    }
    setDraft(emptyTreatment(pests))
  }

  return (
    <div
      className={cn(
        'space-y-4 rounded-lg border border-sky-200 bg-sky-50/40 p-4 dark:border-sky-900 dark:bg-sky-950/20',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Product used</h4>
        {onCancel ? (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel}>
            <X className="h-4 w-4" />
            <span className="sr-only">Cancel</span>
          </Button>
        ) : null}
      </div>

      {products.length > 0 ? (
        <FormField label="Product" htmlFor="treatment-product-choice">
          <select
            id="treatment-product-choice"
            value={draft.productChoice}
            onChange={(event) => chooseProduct(event.target.value)}
            className={selectClass}
          >
            <option value="" disabled>
              Choose a product...
            </option>
            {PRODUCT_CATEGORIES.map((group) => {
              const inGroup = products.filter((item) => item.category === group)
              if (inGroup.length === 0) return null
              return (
                <optgroup key={group} label={PRODUCT_CATEGORY_LABELS[group]}>
                  {inGroup.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              )
            })}
            <option value={TYPED}>Not in the list: type it in</option>
          </select>
          {product ? (
            <p className="text-xs text-muted-foreground">{productSummary(product)}</p>
          ) : null}
        </FormField>
      ) : (
        <p className="text-xs text-muted-foreground">
          Products added in Settings, under Reports, fill in their ingredient and registration
          number for you.
        </p>
      )}

      {typed ? (
        <div className={cn('grid gap-4', large ? 'grid-cols-1' : 'sm:grid-cols-2')}>
          <FormField label="Product name" htmlFor="treatment-product" className={large ? undefined : 'sm:col-span-2'}>
            <Input
              id="treatment-product"
              value={draft.product_name}
              onChange={(event) => set('product_name', event.target.value)}
              placeholder="Product name"
              className={inputClass}
            />
          </FormField>

          <FormField label="Type" className={large ? undefined : 'sm:col-span-2'}>
            <ChoiceChips
              ariaLabel="Product type"
              options={PRODUCT_CATEGORIES}
              labels={PRODUCT_CATEGORY_LABELS}
              value={draft.product_category}
              onChange={(value) => set('product_category', value)}
              large={large}
            />
          </FormField>

          <FormField label="Active ingredient" htmlFor="treatment-ingredient">
            <Input
              id="treatment-ingredient"
              value={draft.active_ingredient}
              onChange={(event) => set('active_ingredient', event.target.value)}
              placeholder="Difenacoum 0.005%"
              className={inputClass}
            />
          </FormField>

          <FormField label="HSE / MAPP number" htmlFor="treatment-registration">
            <Input
              id="treatment-registration"
              value={draft.registration_number}
              onChange={(event) => set('registration_number', event.target.value)}
              placeholder="HSE 1234"
              className={inputClass}
            />
          </FormField>
        </div>
      ) : null}

      <div className={cn('grid gap-4', large ? 'grid-cols-1' : 'sm:grid-cols-3')}>
        <FormField label="For pest" htmlFor="treatment-pest">
          <select
            id="treatment-pest"
            value={draft.pest_type}
            onChange={(event) => set('pest_type', event.target.value)}
            className={selectClass}
          >
            {pests.map((pest) => (
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

        <FormField label="Quantity" htmlFor="treatment-quantity">
          <Input
            id="treatment-quantity"
            value={draft.quantity_used}
            onChange={(event) => set('quantity_used', event.target.value)}
            placeholder="6 boxes"
            className={inputClass}
          />
        </FormField>
      </div>

      {showBaitStatus ? (
        <FormField label="Bait status">
          <ChoiceChips
            ariaLabel="Bait status"
            options={BAIT_STATUSES}
            labels={BAIT_STATUS_LABELS}
            value={draft.bait_status}
            onChange={(value) => set('bait_status', value)}
            large={large}
          />
        </FormField>
      ) : null}

      <FormField label="Location">
        <ChoiceChips
          ariaLabel="Location"
          multiple
          options={INSPECTION_AREAS}
          value={draft.areas_treated}
          onChange={(value) => set('areas_treated', value)}
          large={large}
        />
      </FormField>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={saving}
          className={large ? 'h-12 w-full text-base' : undefined}
        >
          <Plus className="h-4 w-4" />
          {saving ? 'Saving...' : 'Add product'}
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
