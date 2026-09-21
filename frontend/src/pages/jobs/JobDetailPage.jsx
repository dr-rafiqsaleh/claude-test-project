import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  MapPin,
  PenLine,
  Phone,
  PlayCircle,
  Plus,
  Receipt,
  Smartphone,
  Timer,
  User as UserIcon,
  Wrench,
  XCircle,
} from 'lucide-react'

import { createInvoiceFromJob } from '@/api/invoices'
import { downloadJobReport, updateJob, updateJobSignature, updateJobStatus } from '@/api/jobs'
import { FindingCard } from '@/components/jobs/FindingCard'
import { FindingForm } from '@/components/jobs/FindingForm'
import { CheckboxField, FormField, SELECT_CLASSES } from '@/components/jobs/JobFormControls'
import { JobStatusBadge } from '@/components/jobs/JobStatusBadge'
import { PhotoLightbox } from '@/components/jobs/PhotoLightbox'
import { RiskLevelBadge } from '@/components/jobs/RiskLevelBadge'
import { SignaturePad } from '@/components/jobs/SignaturePad'
import { TreatmentCard } from '@/components/jobs/TreatmentCard'
import { TreatmentForm } from '@/components/jobs/TreatmentForm'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useJob, useJobPhotos } from '@/hooks/useJobs'
import { toApiError } from '@/lib/api'
import {
  cn,
  formatBookingDateTime,
  formatDuration,
  toDateInputValue,
} from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { JOB_STATUS, RISK_LEVELS, RISK_LEVEL_LABELS } from '@/lib/constants'

/** How long to wait after the last keystroke before auto-saving. */
const AUTOSAVE_DELAY_MS = 1500

function Field({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
        <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {label}
        </p>
        <p className="break-words text-sm font-medium text-slate-900 dark:text-slate-100">{value}</p>
      </div>
    </div>
  )
}

/** Subtle "Saving..." / "Saved" indicator shown next to the job number. */
function SaveIndicator({ state }) {
  if (state === 'idle') return null

  const map = {
    saving: { label: 'Saving...', className: 'text-slate-500' },
    saved: { label: 'Saved', className: 'text-emerald-600' },
    error: { label: 'Not saved', className: 'text-red-600' },
  }
  const entry = map[state] ?? map.saved

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', entry.className)}>
      {state === 'saving' ? <Spinner size="sm" className="h-3.5 w-3.5" /> : null}
      {state === 'saved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      {state === 'error' ? <AlertCircle className="h-3.5 w-3.5" /> : null}
      {entry.label}
    </span>
  )
}

function addressLine(job) {
  if (job.service_address) {
    const parts = [
      job.service_address.street,
      job.service_address.city,
      job.service_address.county,
      job.service_address.postcode,
    ].filter(Boolean)
    if (parts.length > 0) return parts.join(', ')
  }
  return job.customer_address ?? '--'
}

export function JobDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const canWrite = useAuthStore((state) => state.canWrite())
  const isAdmin = useAuthStore((state) => state.isAdmin())

  const { job, loading, error, refetch, setJob } = useJob(id)
  const { photos, upload, remove: removePhoto } = useJobPhotos(id)

  const [saveState, setSaveState] = useState('idle')
  const [transitioning, setTransitioning] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [invoicing, setInvoicing] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [showFindingForm, setShowFindingForm] = useState(false)
  const [showTreatmentForm, setShowTreatmentForm] = useState(false)
  const [lightboxPhoto, setLightboxPhoto] = useState(null)
  const [signatureName, setSignatureName] = useState('')
  const [signatures, setSignatures] = useState({ customer: null, technician: null })
  const [savingSignature, setSavingSignature] = useState(false)

  // Locally-controlled summary fields, so typing is never interrupted by a
  // background save round-trip.
  const [summary, setSummary] = useState(null)

  const timerRef = useRef(null)
  const pendingRef = useRef({})
  const savedTimerRef = useRef(null)

  const isAssigned = Boolean(job && job.technician_id && job.technician_id === user?.id)
  const editable =
    Boolean(job) &&
    (job.status === JOB_STATUS.PENDING || job.status === JOB_STATUS.IN_PROGRESS) &&
    (canWrite || isAssigned)

  // Seed the local form state once the job arrives.
  useEffect(() => {
    if (!job) return
    setSummary((current) =>
      current && current.__jobId === job.id
        ? current
        : {
            __jobId: job.id,
            overall_risk_level: job.overall_risk_level ?? '',
            inspection_notes: job.inspection_notes ?? '',
            recommendations: job.recommendations ?? '',
            follow_up_required: Boolean(job.follow_up_required),
            follow_up_notes: job.follow_up_notes ?? '',
            next_service_due: toDateInputValue(job.next_service_due),
          },
    )
    setSignatureName((current) => current || job.customer_name_signed || job.customer_name || '')
  }, [job])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    [],
  )

  const flashSaved = useCallback(() => {
    setSaveState('saved')
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2500)
  }, [])

  /** Save immediately, merging in anything already queued. */
  const saveNow = useCallback(
    async (extra = {}) => {
      if (!id) return null
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }

      const payload = { ...pendingRef.current, ...extra }
      pendingRef.current = {}
      if (Object.keys(payload).length === 0) return null

      setSaveState('saving')
      try {
        const updated = await updateJob(id, payload)
        setJob(updated)
        flashSaved()
        return updated
      } catch (err) {
        setSaveState('error')
        toastError('Could not save the report', toApiError(err).message)
        return null
      }
    },
    [id, setJob, flashSaved],
  )

  /** Queue a partial update and save it 1.5s after the last change. */
  const scheduleSave = useCallback(
    (partial) => {
      pendingRef.current = { ...pendingRef.current, ...partial }
      setSaveState('saving')

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void saveNow()
      }, AUTOSAVE_DELAY_MS)
    },
    [saveNow],
  )

  function updateSummary(field, value, { immediate = false } = {}) {
    setSummary((current) => ({ ...current, [field]: value }))

    let payloadValue = value
    if (field === 'overall_risk_level') payloadValue = value || null
    if (field === 'next_service_due') {
      payloadValue = value ? new Date(`${value}T00:00:00`).toISOString() : null
    }
    if (
      field === 'inspection_notes' ||
      field === 'recommendations' ||
      field === 'follow_up_notes'
    ) {
      payloadValue = value.trim() ? value : null
    }

    if (immediate) {
      void saveNow({ [field]: payloadValue })
    } else {
      scheduleSave({ [field]: payloadValue })
    }
  }

  async function addFinding(finding) {
    const next = [...(job.findings ?? []), finding]
    setShowFindingForm(false)
    await saveNow({ findings: next })
  }

  async function deleteFinding(index) {
    const next = (job.findings ?? []).filter((_, i) => i !== index)
    await saveNow({ findings: next })
  }

  async function addTreatment(treatment) {
    const next = [...(job.treatments ?? []), treatment]
    setShowTreatmentForm(false)
    await saveNow({ treatments: next })
  }

  async function deleteTreatment(index) {
    const next = (job.treatments ?? []).filter((_, i) => i !== index)
    await saveNow({ treatments: next })
  }

  /** Upload the chosen files, then link the new photo ids to one finding. */
  async function addPhotosToFinding(index, files) {
    try {
      const uploaded = []
      for (const file of files) {
        // Sequential, so a large batch cannot swamp the API.
        // eslint-disable-next-line no-await-in-loop
        const photo = await upload(file)
        if (photo?.id) uploaded.push(photo.id)
      }

      if (uploaded.length === 0) return

      const next = (job.findings ?? []).map((finding, i) =>
        i === index
          ? { ...finding, photo_ids: [...(finding.photo_ids ?? []), ...uploaded] }
          : finding,
      )
      await saveNow({ findings: next })
      toastSuccess('Photos added', `${uploaded.length} photo(s) attached to this finding.`)
    } catch (err) {
      toastError('Could not upload the photo', toApiError(err).message)
    }
  }

  async function removePhotoFromFinding(photoId) {
    try {
      await removePhoto(photoId)
      await refetch()
    } catch (err) {
      toastError('Could not delete the photo', toApiError(err).message)
    }
  }

  async function changeStatus(status) {
    if (!job) return
    setTransitioning(true)
    try {
      await saveNow()
      const updated = await updateJobStatus(job.id, status)
      setJob(updated)
      toastSuccess('Job updated', `${job.job_number} is now ${status.replace('_', ' ')}.`)
    } catch (err) {
      toastError('Could not update this job', toApiError(err).message)
    } finally {
      setTransitioning(false)
      setCancelOpen(false)
    }
  }

  async function handleSaveSignatures() {
    if (!job) return
    setSavingSignature(true)
    try {
      const payload = { customer_name_signed: signatureName.trim() || null }
      if (signatures.customer) payload.customer_signature = signatures.customer
      if (signatures.technician) payload.technician_signature = signatures.technician

      const updated = await updateJobSignature(job.id, payload)
      setJob(updated)
      setSignatures({ customer: null, technician: null })
      toastSuccess('Signatures saved', 'The sign-off has been recorded.')
    } catch (err) {
      toastError('Could not save the signatures', toApiError(err).message)
    } finally {
      setSavingSignature(false)
    }
  }

  /** Raise an invoice off this completed job and open it. */
  async function handleCreateInvoice() {
    if (!job) return
    setInvoicing(true)
    try {
      const invoice = await createInvoiceFromJob(job.id)
      toastSuccess('Invoice raised', `${invoice.invoice_number} was created for ${job.job_number}.`)
      navigate(`/invoices/${invoice.id}`)
    } catch (err) {
      toastError('Could not raise an invoice', toApiError(err).message)
      // A 409 means one already exists - pull the job again so the link shows.
      await refetch()
    } finally {
      setInvoicing(false)
    }
  }

  async function handleDownload() {
    if (!job) return
    setDownloading(true)
    try {
      await downloadJobReport(job.id, job.job_number)
      await refetch()
      toastSuccess('Report ready', `${job.job_number} inspection report downloaded.`)
    } catch (err) {
      toastError('Could not download the report', toApiError(err).message)
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <LoadingState message="Loading job..." />
  }

  if (error || !job || !summary) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate('/jobs')}>
          <ArrowLeft className="h-4 w-4" />
          Back to jobs
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-red-500" />
            <div>
              <p className="font-medium text-slate-900 dark:text-slate-100">Job not found</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {error?.message ?? 'This job may have been removed.'}
              </p>
            </div>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const isPending = job.status === JOB_STATUS.PENDING
  const isInProgress = job.status === JOB_STATUS.IN_PROGRESS
  const isCompleted = job.status === JOB_STATUS.COMPLETED
  const isCancelled = job.status === JOB_STATUS.CANCELLED
  const canStart = isPending && (canWrite || isAssigned)
  const canComplete =
    isInProgress &&
    (canWrite || isAssigned) &&
    ((job.findings?.length ?? 0) > 0 || Boolean(summary.inspection_notes.trim()))
  const showSignatures = isInProgress || isCompleted

  return (
    <div className="space-y-6">
      <Button variant="ghost" className="-ml-2" onClick={() => navigate('/jobs')}>
        <ArrowLeft className="h-4 w-4" />
        Back to jobs
      </Button>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {job.job_number}
            </h1>
            <JobStatusBadge status={job.status} />
            {job.overall_risk_level ? (
              <RiskLevelBadge level={job.overall_risk_level} />
            ) : null}
            <SaveIndicator state={saveState} />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {job.customer_name ?? 'Unknown customer'} · {job.service_type} ·{' '}
            {job.technician_name ?? 'Unassigned'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {editable ? (
            <Button asChild variant="outline">
              <Link to={`/jobs/${job.id}/report`}>
                <Smartphone className="h-4 w-4" />
                Field form
              </Link>
            </Button>
          ) : null}

          {canStart ? (
            <Button
              disabled={transitioning}
              onClick={() => void changeStatus(JOB_STATUS.IN_PROGRESS)}
            >
              {transitioning ? (
                <Spinner size="sm" className="text-white" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Start job
            </Button>
          ) : null}

          {isInProgress ? (
            <Button
              disabled={transitioning || !canComplete}
              title={
                canComplete
                  ? undefined
                  : 'Record at least one finding or some inspection notes first'
              }
              onClick={() => void changeStatus(JOB_STATUS.COMPLETED)}
            >
              {transitioning ? (
                <Spinner size="sm" className="text-white" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Complete job
            </Button>
          ) : null}

          {isCompleted ? (
            <Button disabled={downloading} onClick={() => void handleDownload()}>
              {downloading ? (
                <Spinner size="sm" className="text-white" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloading ? 'Preparing...' : 'Download report'}
            </Button>
          ) : null}

          {isCompleted && job.invoice_id ? (
            <Button asChild variant="outline">
              <Link to={`/invoices/${job.invoice_id}`}>
                <Receipt className="h-4 w-4" />
                View invoice
              </Link>
            </Button>
          ) : null}

          {isCompleted && !job.invoice_id && canWrite ? (
            <Button variant="outline" disabled={invoicing} onClick={() => void handleCreateInvoice()}>
              {invoicing ? <Spinner size="sm" /> : <Receipt className="h-4 w-4" />}
              {invoicing ? 'Creating...' : 'Create invoice'}
            </Button>
          ) : null}

          {isAdmin && !isCompleted && !isCancelled ? (
            <Button variant="destructive" disabled={transitioning} onClick={() => setCancelOpen(true)}>
              <XCircle className="h-4 w-4" />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {/* Section 1 - Job info ------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Job information</CardTitle>
            <CardDescription>Copied from the booking when the job was opened.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field icon={ClipboardList} label="Service type" value={job.service_type} />
              <Field
                icon={Wrench}
                label="Technician"
                value={job.technician_name ?? 'Unassigned'}
              />
              <Field
                icon={CalendarClock}
                label="Scheduled"
                value={`${formatBookingDateTime(job.scheduled_start)} - ${formatBookingDateTime(
                  job.scheduled_end,
                )}`}
              />
              <Field
                icon={Timer}
                label="Actual"
                value={
                  job.actual_start
                    ? `${formatBookingDateTime(job.actual_start)}${
                        job.actual_end ? ` - ${formatBookingDateTime(job.actual_end)}` : ' - in progress'
                      }`
                    : 'Not started'
                }
              />
              <Field icon={Timer} label="Time on site" value={formatDuration(job.duration_minutes)} />
              {job.booking_number ? (
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-slate-800">
                    <FileText className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Booking
                    </p>
                    <Link
                      to={`/bookings/${job.booking_id}`}
                      className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                    >
                      {job.booking_number}
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>

            <Separator />

            <div>
              <div className="mb-2 flex items-center gap-2">
                <Bug className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Target pests
                </p>
              </div>
              {job.pest_types?.length ? (
                <div className="flex flex-wrap gap-2">
                  {job.pest_types.map((pest) => (
                    <span
                      key={pest}
                      className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {pest}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">None recorded.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field icon={UserIcon} label="Name" value={job.customer_name ?? '--'} />
            <Field icon={Phone} label="Phone" value={job.customer_phone ?? '--'} />
            <Field icon={MapPin} label="Service address" value={addressLine(job)} />
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to={`/customers/${job.customer_id}`}>View customer</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Section 2 - Findings ------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Inspection findings</CardTitle>
            <CardDescription>
              {editable
                ? 'What was found on site, area by area. Attach photos to each finding.'
                : 'What was found on site, area by area.'}
            </CardDescription>
          </div>
          {editable && !showFindingForm ? (
            <Button variant="outline" size="sm" onClick={() => setShowFindingForm(true)}>
              <Plus className="h-4 w-4" />
              Add finding
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {showFindingForm ? (
            <FindingForm onAdd={addFinding} onCancel={() => setShowFindingForm(false)} />
          ) : null}

          {job.findings?.length ? (
            job.findings.map((finding, index) => (
              <FindingCard
                key={`${finding.area}-${finding.pest_type}-${index}`}
                finding={finding}
                index={index}
                jobId={job.id}
                photos={photos}
                editable={editable}
                onDelete={() => void deleteFinding(index)}
                onAddPhotos={(files) => addPhotosToFinding(index, files)}
                onRemovePhoto={(photoId) => removePhotoFromFinding(photoId)}
                onViewPhoto={setLightboxPhoto}
              />
            ))
          ) : !showFindingForm ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No findings recorded yet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Section 3 - Treatments ----------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Treatments applied</CardTitle>
            <CardDescription>Products, methods and the areas each one covered.</CardDescription>
          </div>
          {editable && !showTreatmentForm ? (
            <Button variant="outline" size="sm" onClick={() => setShowTreatmentForm(true)}>
              <Plus className="h-4 w-4" />
              Add treatment
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {showTreatmentForm ? (
            <TreatmentForm onAdd={addTreatment} onCancel={() => setShowTreatmentForm(false)} />
          ) : null}

          {job.treatments?.length ? (
            job.treatments.map((treatment, index) => (
              <TreatmentCard
                key={`${treatment.pest_type}-${treatment.method}-${index}`}
                treatment={treatment}
                index={index}
                editable={editable}
                onDelete={() => void deleteTreatment(index)}
              />
            ))
          ) : !showTreatmentForm ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              No treatments recorded yet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Section 4 - Summary -------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Summary &amp; recommendations</CardTitle>
          <CardDescription>
            {editable
              ? 'Changes save automatically a moment after you stop typing.'
              : 'The wrap-up recorded by the technician.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <FormField label="Overall risk level" htmlFor="job-risk">
            <select
              id="job-risk"
              value={summary.overall_risk_level}
              disabled={!editable}
              onChange={(event) =>
                updateSummary('overall_risk_level', event.target.value, { immediate: true })
              }
              className={cn(SELECT_CLASSES, 'sm:w-[220px]')}
            >
              <option value="">Not assessed</option>
              {RISK_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {RISK_LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Inspection notes" htmlFor="job-notes">
            <Textarea
              id="job-notes"
              rows={5}
              disabled={!editable}
              value={summary.inspection_notes}
              onChange={(event) => updateSummary('inspection_notes', event.target.value)}
              onBlur={() => void saveNow()}
              placeholder="Conditions on site, access notes, anything the office should know."
            />
          </FormField>

          <FormField label="Recommendations" htmlFor="job-recommendations">
            <Textarea
              id="job-recommendations"
              rows={4}
              disabled={!editable}
              value={summary.recommendations}
              onChange={(event) => updateSummary('recommendations', event.target.value)}
              onBlur={() => void saveNow()}
              placeholder="What the customer should do next, and what we recommend booking in."
            />
          </FormField>

          <CheckboxField
            id="job-follow-up"
            checked={summary.follow_up_required}
            disabled={!editable}
            onChange={(checked) => updateSummary('follow_up_required', checked, { immediate: true })}
            label="Follow-up required"
            description="Flag this job so the office books a return visit."
          />

          {summary.follow_up_required ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Follow-up notes" htmlFor="job-follow-up-notes" className="sm:col-span-2">
                <Textarea
                  id="job-follow-up-notes"
                  rows={3}
                  disabled={!editable}
                  value={summary.follow_up_notes}
                  onChange={(event) => updateSummary('follow_up_notes', event.target.value)}
                  onBlur={() => void saveNow()}
                  placeholder="Return visit to check bait take and top up stations."
                />
              </FormField>

              <FormField label="Next service due" htmlFor="job-next-service">
                <Input
                  id="job-next-service"
                  type="date"
                  disabled={!editable}
                  value={summary.next_service_due}
                  onChange={(event) =>
                    updateSummary('next_service_due', event.target.value, { immediate: true })
                  }
                />
              </FormField>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Section 5 - Signatures ----------------------------------------- */}
      {showSignatures ? (
        <Card>
          <CardHeader>
            <CardTitle>Sign-off</CardTitle>
            <CardDescription>
              {job.signed_at
                ? `Signed by ${job.customer_name_signed ?? 'the customer'} on ${formatBookingDateTime(
                    job.signed_at,
                  )}.`
                : 'Capture the customer and technician signatures on site.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField label="Customer name" htmlFor="signature-name" className="max-w-md">
              <Input
                id="signature-name"
                value={signatureName}
                disabled={isCompleted && !canWrite}
                onChange={(event) => setSignatureName(event.target.value)}
                placeholder="Name of the person signing"
              />
            </FormField>

            <div className="grid gap-6 lg:grid-cols-2">
              <SignaturePad
                label="Customer signature"
                existingSignature={job.customer_signature}
                readOnly={isCompleted && !canWrite}
                onSave={(dataUrl) => setSignatures((s) => ({ ...s, customer: dataUrl }))}
                onClear={() => setSignatures((s) => ({ ...s, customer: null }))}
              />
              <SignaturePad
                label="Technician signature"
                existingSignature={job.technician_signature}
                readOnly={isCompleted && !canWrite}
                onSave={(dataUrl) => setSignatures((s) => ({ ...s, technician: dataUrl }))}
                onClear={() => setSignatures((s) => ({ ...s, technician: null }))}
              />
            </div>

            {!(isCompleted && !canWrite) ? (
              <Button disabled={savingSignature} onClick={() => void handleSaveSignatures()}>
                {savingSignature ? (
                  <Spinner size="sm" className="text-white" />
                ) : (
                  <PenLine className="h-4 w-4" />
                )}
                {savingSignature ? 'Saving...' : 'Save signatures'}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Section 6 - Report --------------------------------------------- */}
      {isCompleted ? (
        <Card>
          <CardHeader>
            <CardTitle>Inspection report</CardTitle>
            <CardDescription>
              {job.report_generated_at
                ? `Report generated on ${formatBookingDateTime(job.report_generated_at)}.`
                : 'Generate the PDF report to send to the customer.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button disabled={downloading} onClick={() => void handleDownload()}>
              {downloading ? (
                <Spinner size="sm" className="text-white" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {downloading ? 'Preparing...' : 'Generate & download report'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <PhotoLightbox
        jobId={job.id}
        photo={lightboxPhoto}
        open={lightboxPhoto !== null}
        onOpenChange={(open) => {
          if (!open) setLightboxPhoto(null)
        }}
      />

      <AlertDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!transitioning) setCancelOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this job?</AlertDialogTitle>
            <AlertDialogDescription>
              {job.job_number} will be marked as cancelled. Cancelled jobs cannot be reopened, and
              their report can no longer be edited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transitioning}>Keep job</AlertDialogCancel>
            <AlertDialogAction
              disabled={transitioning}
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void changeStatus(JOB_STATUS.CANCELLED)
              }}
            >
              {transitioning ? 'Cancelling...' : 'Cancel job'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default JobDetailPage
