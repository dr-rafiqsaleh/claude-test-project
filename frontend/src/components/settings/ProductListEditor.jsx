import { Plus, Trash2 } from 'lucide-react'

import { SELECT_CLASSES } from '@/components/jobs/JobFormControls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS } from '@/lib/constants'

/** A new, blank product. It gets its id from the server when saved. */
export function emptyProduct() {
  return {
    id: null,
    name: '',
    category: 'rodenticide',
    active_ingredient: '',
    formulation: '',
    registration_number: '',
    safety_data_sheet_ref: '',
  }
}

/** True when a product row has nothing typed in, so it can be dropped on save. */
export function isBlankProduct(product) {
  return ![
    product.name,
    product.active_ingredient,
    product.formulation,
    product.registration_number,
    product.safety_data_sheet_ref,
  ].some((value) => String(value ?? '').trim())
}

const FIELDS = [
  { key: 'active_ingredient', label: 'Active ingredient', placeholder: 'Difenacoum 0.005%' },
  { key: 'formulation', label: 'Formulation', placeholder: 'Wax block, gel, bait box...' },
  { key: 'registration_number', label: 'HSE / MAPP number', placeholder: 'HSE 1234' },
  { key: 'safety_data_sheet_ref', label: 'Safety data sheet ref', placeholder: 'SDS-2024-03' },
]

/**
 * The company's product list, edited in place. Technicians pick from it on a
 * report, and the product's details are copied onto that report.
 */
export function ProductListEditor({ products, onChange }) {
  function update(index, field, value) {
    onChange(products.map((product, i) => (i === index ? { ...product, [field]: value } : product)))
  }

  return (
    <div className="space-y-3">
      {products.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No products yet. Add the ones your technicians use most.
        </p>
      ) : null}

      {products.map((product, index) => {
        const prefix = `product-${index}`
        return (
          <div key={product.id ?? `new-${index}`} className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={`${prefix}-name`}>Product name</Label>
                <Input
                  id={`${prefix}-name`}
                  value={product.name}
                  onChange={(event) => update(index, 'name', event.target.value)}
                  placeholder="e.g. Mouse bait box"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove ${product.name || 'this product'}`}
                onClick={() => onChange(products.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${prefix}-category`}>Type</Label>
                <select
                  id={`${prefix}-category`}
                  value={product.category}
                  onChange={(event) => update(index, 'category', event.target.value)}
                  className={SELECT_CLASSES}
                >
                  {PRODUCT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {PRODUCT_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
              </div>
              {FIELDS.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`${prefix}-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`${prefix}-${field.key}`}
                    value={product[field.key] ?? ''}
                    onChange={(event) => update(index, field.key, event.target.value)}
                    placeholder={field.placeholder}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}

      <Button type="button" variant="outline" onClick={() => onChange([...products, emptyProduct()])}>
        <Plus className="h-4 w-4" />
        Add product
      </Button>
    </div>
  )
}

export default ProductListEditor
