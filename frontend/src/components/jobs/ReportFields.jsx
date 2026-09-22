import { useCallback, useEffect, useRef, useState } from 'react'

import {
  CheckboxField,
  ChoiceChips,
  FormField,
} from '@/components/jobs/JobFormControls'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn, toDateInputValue } from '@/lib/utils'
import {
  ACTIVITY_LEVELS,
  ACTIVITY_LEVEL_LABELS,
  ASSESSMENTS,
  ASSESSMENT_ANSWERS,
  ASSESSMENT_ANSWER_LABELS,
  HYGIENE_RATINGS,
  HYGIENE_RATING_LABELS,
  VISIT_TYPES,
  VISIT_TYPE_LABELS,
  pestOptions,
} from '@/lib/constants'

/**
 * The inspection report's own fields, shared by the phone form and the office
 * report page so both always ask the same questions in the same order.
 *
 * Findings, products and signatures have their own components; everything
 * here is a plain field that autosaves.
 */

/** Free-text fields: a blank entry is saved as "not recorded". */
const TEXT_FIELDS = [
  'visit_type_other',
  'inspection_notes',
  'hygiene_notes',
  'proofing_notes',
  'action_taken',
  'recommendations',
  'follow_up_notes',
  'customer_unable_reason',
]

/** Single-choice fields: an empty choice is saved as "not recorded". */
const CHOICE_FIELDS = ['visit_type', 'activity_level', 'hygiene_rating']

function fieldsFromJob(job) {
  return {
    __jobId: job.id,
    visit_type: job.visit_type ?? '',
    visit_type_other: job.visit_type_other ?? '',
    activity_level: job.activity_level ?? '',
    pests_found: job.pests_found ?? [],
    inspection_notes: job.inspection_notes ?? '',
    hygiene_rating: job.hygiene_rating ?? '',
    hygiene_notes: job.hygiene_notes ?? '',
    proofing_notes: job.proofing_notes ?? '',
    action_taken: job.action_taken ?? '',
    recommendations: job.recommendations ?? '',
    follow_up_required: Boolean(job.follow_up_required),
    follow_up_notes: job.follow_up_notes ?? '',
    next_service_due: toDateInputValue(job.next_service_due),
    assessments: { ...(job.assessments ?? {}) },
    customer_unable_to_sign: Boolean(job.customer_unable_to_sign),
    customer_unable_reason: job.customer_unable_reason ?? '',
  }
}

/**
 * Local, instantly-editable copies of the report fields, so typing is never
 * interrupted by a save round-trip. `setField(name, value)` updates the copy
 * and queues the save; pass `{ immediate: true }` for taps and toggles.
 */
export function useReportFields(job, { saveNow, scheduleSave }) {
  const [fields, setFields] = useState(null)
  const fieldsRef = useRef(null)
  fieldsRef.current = fields

  useEffect(() => {
    if (!job) return
    setFields((current) => (current && current.__jobId === job.id ? current : fieldsFromJob(job)))
  }, [job])

  const setField = useCallback(
    (field, value, { immediate = false } = {}) => {
      setFields((current) => ({ ...current, [field]: value }))

      let payloadValue = value
      if (TEXT_FIELDS.includes(field)) payloadValue = value.trim() ? value : null
      if (CHOICE_FIELDS.includes(field)) payloadValue = value || null
      if (field === 'next_service_due') {
        payloadValue = value ? new Date(`${value}T00:00:00`).toISOString() : null
      }

      if (immediate) void saveNow({ [field]: payloadValue })
      else scheduleSave({ [field]: payloadValue })
    },
    [saveNow, scheduleSave],
  )

  /** Answer one assessment, keeping the others as they are. */
  const setAssessment = useCallback(
    (key, answer) => {
      const next = { ...(fieldsRef.current?.assessments ?? {}), [key]: answer || null }
      setField('assessments', next, { immediate: true })
    },
    [setField],
  )

  return { fields, setField, setAssessment }
}

/** True once the report records what was found or done, so the job can be completed. */
export function reportHasContent(job, fields) {
  return (
    (job.findings?.length ?? 0) > 0 ||
    Boolean(fields.activity_level) ||
    Boolean(fields.inspection_notes.trim()) ||
    Boolean(fields.action_taken.trim())
  )
}

function textareaClass(large) {
  return large ? 'text-base' : undefined
}

/** Why the technician is there. */
export function VisitTypeField({ fields, setField, saveNow, disabled, large = false }) {
  return (
    <FormField label="Type of visit">
      <ChoiceChips
        ariaLabel="Type of visit"
        options={VISIT_TYPES}
        labels={VISIT_TYPE_LABELS}
        value={fields.visit_type}
        onChange={(value) => setField('visit_type', value, { immediate: true })}
        disabled={disabled}
        large={large}
      />
      {fields.visit_type === 'other' ? (
        <Input
          aria-label="Describe the visit"
          className={cn('mt-2', large && 'h-12 text-base')}
          disabled={disabled}
          value={fields.visit_type_other}
          onChange={(event) => setField('visit_type_other', event.target.value)}
          onBlur={() => void saveNow()}
          placeholder="What kind of visit?"
        />
      ) : null}
    </FormField>
  )
}

/** How much activity, and which pests. Pests are hidden when there is none. */
export function ActivityFields({ fields, setField, disabled, large = false }) {
  return (
    <div className="space-y-5">
      <FormField label="Pest activity found">
        <ChoiceChips
          ariaLabel="Pest activity level"
          options={ACTIVITY_LEVELS}
          labels={ACTIVITY_LEVEL_LABELS}
          value={fields.activity_level}
          onChange={(value) => setField('activity_level', value, { immediate: true })}
          disabled={disabled}
          large={large}
        />
      </FormField>

      {fields.activity_level !== 'none' ? (
        <FormField label="Pests found" hint="Pre-ticked from the booking. Tap to change.">
          <ChoiceChips
            ariaLabel="Pests found"
            multiple
            allowOther
            otherPlaceholder="Name the pest"
            options={pestOptions(fields.pests_found)}
            value={fields.pests_found}
            onChange={(value) => setField('pests_found', value, { immediate: true })}
            disabled={disabled}
            large={large}
          />
        </FormField>
      ) : null}
    </div>
  )
}

/** A few sentences on the whole inspection, above the per-area findings. */
export function InspectionSummaryField({ fields, setField, saveNow, disabled, large = false }) {
  return (
    <FormField label="Inspection summary" htmlFor="field-inspection-summary">
      <Textarea
        id="field-inspection-summary"
        rows={large ? 4 : 3}
        className={textareaClass(large)}
        disabled={disabled}
        value={fields.inspection_notes}
        onChange={(event) => setField('inspection_notes', event.target.value)}
        onBlur={() => void saveNow()}
        placeholder="What you inspected and what you found overall."
      />
    </FormField>
  )
}

/** Hygiene and proofing: what the customer needs to put right. */
export function ConditionsFields({ fields, setField, saveNow, disabled, large = false }) {
  return (
    <div className="space-y-5">
      <FormField label="Hygiene">
        <ChoiceChips
          ariaLabel="Hygiene"
          options={HYGIENE_RATINGS}
          labels={HYGIENE_RATING_LABELS}
          value={fields.hygiene_rating}
          onChange={(value) => setField('hygiene_rating', value, { immediate: true })}
          disabled={disabled}
          large={large}
        />
        <Textarea
          aria-label="Hygiene notes"
          rows={2}
          className={cn('mt-2', textareaClass(large))}
          disabled={disabled}
          value={fields.hygiene_notes}
          onChange={(event) => setField('hygiene_notes', event.target.value)}
          onBlur={() => void saveNow()}
          placeholder="Food debris, clutter, waste storage..."
        />
      </FormField>

      <FormField label="Proofing" htmlFor="field-proofing">
        <Textarea
          id="field-proofing"
          rows={large ? 3 : 2}
          className={textareaClass(large)}
          disabled={disabled}
          value={fields.proofing_notes}
          onChange={(event) => setField('proofing_notes', event.target.value)}
          onBlur={() => void saveNow()}
          placeholder="Entry points found, and what needs sealing."
        />
      </FormField>
    </div>
  )
}

/** A short account of the treatment, above the products used. */
export function ActionTakenField({ fields, setField, saveNow, disabled, large = false }) {
  return (
    <FormField label="Action taken" htmlFor="field-action-taken">
      <Textarea
        id="field-action-taken"
        rows={large ? 3 : 2}
        className={textareaClass(large)}
        disabled={disabled}
        value={fields.action_taken}
        onChange={(event) => setField('action_taken', event.target.value)}
        onBlur={() => void saveNow()}
        placeholder="What you did on this visit."
      />
    </FormField>
  )
}

/** Recommendations for the customer, and whether we are coming back. */
export function FollowUpFields({ fields, setField, saveNow, disabled, large = false }) {
  return (
    <div className="space-y-5">
      <FormField label="Recommendations" htmlFor="field-recommendations">
        <Textarea
          id="field-recommendations"
          rows={large ? 4 : 3}
          className={textareaClass(large)}
          disabled={disabled}
          value={fields.recommendations}
          onChange={(event) => setField('recommendations', event.target.value)}
          onBlur={() => void saveNow()}
          placeholder="What the customer should do next."
        />
      </FormField>

      <CheckboxField
        id="field-follow-up"
        checked={fields.follow_up_required}
        disabled={disabled}
        onChange={(checked) => setField('follow_up_required', checked, { immediate: true })}
        label="Follow-up due"
        description="Flag this job so the office books a return visit."
      />

      {fields.follow_up_required ? (
        <div className={cn('grid gap-5', !large && 'sm:grid-cols-2')}>
          <FormField label="Follow-up by" htmlFor="field-next-service">
            <Input
              id="field-next-service"
              type="date"
              className={large ? 'h-12 text-base' : undefined}
              disabled={disabled}
              value={fields.next_service_due}
              onChange={(event) =>
                setField('next_service_due', event.target.value, { immediate: true })
              }
            />
          </FormField>

          <FormField
            label="Follow-up details"
            htmlFor="field-follow-up-notes"
            className={large ? undefined : 'sm:col-span-2'}
          >
            <Textarea
              id="field-follow-up-notes"
              rows={2}
              className={textareaClass(large)}
              disabled={disabled}
              value={fields.follow_up_notes}
              onChange={(event) => setField('follow_up_notes', event.target.value)}
              onBlur={() => void saveNow()}
              placeholder="Check bait take and top up the stations."
            />
          </FormField>
        </div>
      ) : null}
    </div>
  )
}

/** One Yes / No / N/A row per assessment. */
export function AssessmentFields({ fields, setAssessment, disabled, large = false }) {
  return (
    <div className="divide-y divide-border rounded-md border border-border">
      {ASSESSMENTS.map(({ key, label }) => (
        <div
          key={key}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5"
        >
          <span className="text-sm font-medium text-foreground">{label}</span>
          <ChoiceChips
            ariaLabel={label}
            options={ASSESSMENT_ANSWERS}
            labels={ASSESSMENT_ANSWER_LABELS}
            value={fields.assessments?.[key] ?? ''}
            onChange={(answer) => setAssessment(key, answer)}
            disabled={disabled}
            large={large}
          />
        </div>
      ))}
    </div>
  )
}

/** For a visit where nobody was there to sign, say so rather than leave it blank. */
export function UnableToSignField({ fields, setField, saveNow, disabled, large = false }) {
  return (
    <div className="space-y-3">
      <CheckboxField
        id="field-unable-to-sign"
        checked={fields.customer_unable_to_sign}
        disabled={disabled}
        onChange={(checked) => setField('customer_unable_to_sign', checked, { immediate: true })}
        label="Customer not available to sign"
        description="The report will say so, with the reason."
      />
      {fields.customer_unable_to_sign ? (
        <Input
          aria-label="Reason the customer could not sign"
          className={large ? 'h-12 text-base' : undefined}
          disabled={disabled}
          value={fields.customer_unable_reason}
          onChange={(event) => setField('customer_unable_reason', event.target.value)}
          onBlur={() => void saveNow()}
          placeholder="e.g. Tenant not at home, keys left with neighbour"
        />
      ) : null}
    </div>
  )
}
