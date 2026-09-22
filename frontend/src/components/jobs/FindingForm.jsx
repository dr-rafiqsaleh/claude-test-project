import { useState } from 'react'
import { Plus, X } from 'lucide-react'

import { ChoiceChips, FormField, SELECT_CLASSES } from '@/components/jobs/JobFormControls'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  EVIDENCE_TYPES,
  INSPECTION_AREAS,
  PRIORITY_LABELS,
  RESPONSIBLE_PARTIES,
  RESPONSIBLE_PARTY_LABELS,
  RISK_LEVELS,
  pestOptions,
} from '@/lib/constants'

const OTHER = 'Other'

function emptyFinding(pests) {
  return {
    area: INSPECTION_AREAS[0],
    customArea: '',
    pest_type: pests[0],
    customPest: '',
    severity: 'low',
    evidence: [],
    description: '',
    recommendation: '',
    responsible_party: '',
  }
}

/**
 * Inline "Add finding" form.
 *
 * Calls `onAdd(finding)` with a plain finding object ready to append to
 * `job.findings`, then resets itself. `pestsFound` (the report's ticked pests)
 * are offered first, so the usual pest is already chosen.
 */
export function FindingForm({ onAdd, onCancel, pestsFound = [], large = false, className }) {
  const pests = [...new Set([...pestsFound, ...pestOptions(pestsFound)])]
  const [draft, setDraft] = useState(() => emptyFinding(pests))
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const selectClass = cn(SELECT_CLASSES, large && 'h-12 text-base')
  const inputClass = large ? 'h-12 text-base' : undefined

  function set(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit() {
    const area = draft.area === OTHER ? draft.customArea.trim() : draft.area
    const pestType = draft.pest_type === OTHER ? draft.customPest.trim() : draft.pest_type

    if (!area) {
      setError('Choose or type an area.')
      return
    }
    if (!pestType) {
      setError('Choose or type a pest type.')
      return
    }
    if (!draft.description.trim()) {
      setError('Describe what you found.')
      return
    }

    setError(null)
    setSaving(true)
    const saved = await onAdd({
      area,
      pest_type: pestType,
      severity: draft.severity,
      evidence: draft.evidence,
      description: draft.description.trim(),
      recommendation: draft.recommendation.trim(),
      responsible_party: draft.responsible_party || null,
      photo_ids: [],
    })
    setSaving(false)

    // A failed save keeps the entry on screen so nothing has to be re-typed.
    if (saved === false) {
      setError('Not saved. Check your connection and tap Add finding again.')
      return
    }
    setDraft(emptyFinding(pests))
  }

  return (
    <div
      className={cn(
        'space-y-4 rounded-lg border border-primary/30 bg-primary/6 p-4',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">New finding</h4>
        {onCancel ? (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onCancel}>
            <X className="h-4 w-4" />
            <span className="sr-only">Cancel</span>
          </Button>
        ) : null}
      </div>

      <div className={cn('grid gap-4', large ? 'grid-cols-1' : 'sm:grid-cols-3')}>
        <FormField label="Area" htmlFor="finding-area">
          <select
            id="finding-area"
            value={draft.area}
            onChange={(event) => set('area', event.target.value)}
            className={selectClass}
          >
            {INSPECTION_AREAS.map((area) => (
              <option key={area} value={area}>
                {area}
              </option>
            ))}
          </select>
          {draft.area === OTHER ? (
            <Input
              value={draft.customArea}
              onChange={(event) => set('customArea', event.target.value)}
              placeholder="Describe the area"
              className={cn('mt-2', inputClass)}
            />
          ) : null}
        </FormField>

        <FormField label="Pest type" htmlFor="finding-pest">
          <select
            id="finding-pest"
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

        <FormField label="Priority" htmlFor="finding-severity">
          <select
            id="finding-severity"
            value={draft.severity}
            onChange={(event) => set('severity', event.target.value)}
            className={selectClass}
          >
            {RISK_LEVELS.map((level) => (
              <option key={level} value={level}>
                {PRIORITY_LABELS[level]}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Evidence seen">
        <ChoiceChips
          ariaLabel="Evidence seen"
          multiple
          allowOther
          otherPlaceholder="Describe the evidence"
          options={EVIDENCE_TYPES}
          value={draft.evidence}
          onChange={(value) => set('evidence', value)}
          large={large}
        />
      </FormField>

      <FormField label="Description" htmlFor="finding-description">
        <Textarea
          id="finding-description"
          value={draft.description}
          onChange={(event) => set('description', event.target.value)}
          rows={large ? 4 : 3}
          placeholder="Live cockroaches and egg cases behind the fridge motor housing."
          className={large ? 'text-base' : undefined}
        />
      </FormField>

      <FormField label="Recommendation" htmlFor="finding-recommendation">
        <Textarea
          id="finding-recommendation"
          value={draft.recommendation}
          onChange={(event) => set('recommendation', event.target.value)}
          rows={large ? 4 : 3}
          placeholder="Seal the gap behind the cooker; keep food in sealed containers."
          className={large ? 'text-base' : undefined}
        />
      </FormField>

      <FormField label="Who needs to act">
        <ChoiceChips
          ariaLabel="Who needs to act"
          options={RESPONSIBLE_PARTIES}
          labels={RESPONSIBLE_PARTY_LABELS}
          value={draft.responsible_party}
          onChange={(value) => set('responsible_party', value)}
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
          {saving ? 'Saving...' : 'Add finding'}
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

export default FindingForm
