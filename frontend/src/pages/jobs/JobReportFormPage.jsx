import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  CheckCircle2,
  ClipboardList,
  Download,
  MapPin,
  PartyPopper,
  Phone,
  PlayCircle,
  Plus,
  SprayCan,
  User as UserIcon,
} from 'lucide-react'

import { downloadJobReport, updateJobSignature, updateJobStatus } from '@/api/jobs'
import { FindingCard } from '@/components/jobs/FindingCard'
import { FindingForm } from '@/components/jobs/FindingForm'
import {
  CheckboxField,
  FormField,
  SELECT_CLASSES_LG,
} from '@/components/jobs/JobFormControls'
import { JobStatusBadge } from '@/components/jobs/JobStatusBadge'
import { PhotoLightbox } from '@/components/jobs/PhotoLightbox'
import { RiskLevelBadge } from '@/components/jobs/RiskLevelBadge'
import { SignaturePad } from '@/components/jobs/SignaturePad'
import { TreatmentCard } from '@/components/jobs/TreatmentCard'
import { TreatmentForm } from '@/components/jobs/TreatmentForm'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useJob, useJobPhotos } from '@/hooks/useJobs'
import { useReportAutosave } from '@/hooks/useReportAutosave'
import { toApiError } from '@/lib/api'
import { cn, formatBookingDateTime, toDateInputValue } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { JOB_STATUS, RISK_LEVELS, RISK_LEVEL_LABELS, UserRole } from '@/lib/constants'

/** A numbered, full-width step panel. */
function Step({ number, title, description, icon: Icon, children, muted = false }) {
  return (
    <section
      className={cn(
        'rounded-xl border border-border bg-card p-4 shadow-sm',
        muted && 'opacity-60',
      )}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {Icon ? <Icon className="h-4 w-4" /> : number}
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  )
}

export function JobReportFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const canWrite = useAuthStore((state) => state.canWrite())

  const { job, loading, error, refetch, setJob } = useJob(id)
  const { saveState, saveNow, scheduleSave } = useReportAutosave(id, setJob)
  const { photos, upload, remove: removePhoto } = useJobPhotos(id)

  const [summary, setSummary] = useState(null)
  const [showFindingForm, setShowFindingForm] = useState(false)
  const [showTreatmentForm, setShowTreatmentForm] = useState(false)
  const [lightboxPhoto, setLightboxPhoto] = useState(null)
  const [signatureName, setSignatureName] = useState('')
  const [signatures, setSignatures] = useState({ customer: null, technician: null })
  const [working, setWorking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [completed, setCompleted] = useState(false)

  const isTechnician = user?.role === UserRole.TECHNICIAN
  const isAssigned = Boolean(job && job.technician_id && job.technician_id === user?.id)
  const editable =
    Boolean(job) &&
    (job.status === JOB_STATUS.PENDING || job.status === JOB_STATUS.IN_PROGRESS) &&
    (canWrite || isAssigned)

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
    if (job.status === JOB_STATUS.COMPLETED) setCompleted(true)
  }, [job])


  function updateSummary(field, value, { immediate = false } = {}) {
    setSummary((current) => ({ ...current, [field]: value }))

    let payloadValue = value
    if (field === 'overall_risk_level') payloadValue = value || null
    if (field === 'next_service_due') {
      payloadValue = value ? new Date(`${value}T00:00:00`).toISOString() : null
    }
    if (['inspection_notes', 'recommendations', 'follow_up_notes'].includes(field)) {
      payloadValue = value.trim() ? value : null
    }

    if (immediate) void saveNow({ [field]: payloadValue })
    else scheduleSave({ [field]: payloadValue })
  }

  async function handleStart() {
    if (!job) return
    setWorking(true)
    try {
      const updated = await updateJobStatus(job.id, JOB_STATUS.IN_PROGRESS)
      setJob(updated)
      toastSuccess('Visit started', 'Your start time has been recorded.')
    } catch (err) {
      toastError('Could not start the visit', toApiError(err).message)
    } finally {
      setWorking(false)
    }
  }

  /** Keeps the form open, with the technician's entry, until the save succeeds. */
  async function addFinding(finding) {
    const saved = await saveNow({ findings: [...(job.findings ?? []), finding] })
    if (saved) setShowFindingForm(false)
    return Boolean(saved)
  }

  async function deleteFinding(index) {
    await saveNow({ findings: (job.findings ?? []).filter((_, i) => i !== index) })
  }

  async function addTreatment(treatment) {
    const saved = await saveNow({ treatments: [...(job.treatments ?? []), treatment] })
    if (saved) setShowTreatmentForm(false)
    return Boolean(saved)
  }

  async function deleteTreatment(index) {
    await saveNow({ treatments: (job.treatments ?? []).filter((_, i) => i !== index) })
  }

  async function addPhotosToFinding(index, files) {
    try {
      const uploaded = []
      for (const file of files) {
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

  /** Save signatures, then complete the job in one go. */
  async function handleComplete() {
    if (!job) return
    setWorking(true)
    try {
      // A report that did not save must not be locked by completing the job.
      await saveNow({}, { throwOnError: true })

      const signaturePayload = { customer_name_signed: signatureName.trim() || null }
      if (signatures.customer) signaturePayload.customer_signature = signatures.customer
      if (signatures.technician) signaturePayload.technician_signature = signatures.technician
      await updateJobSignature(job.id, signaturePayload)

      const updated = await updateJobStatus(job.id, JOB_STATUS.COMPLETED)
      setJob(updated)
      setCompleted(true)
      setSignatures({ customer: null, technician: null })
      toastSuccess('Visit completed', 'The inspection report is ready.')
    } catch (err) {
      toastError('Could not complete the visit', toApiError(err).message)
    } finally {
      setWorking(false)
    }
  }

  async function handleDownload() {
    if (!job) return
    setDownloading(true)
    try {
      await downloadJobReport(job.id, job.job_number)
    } catch (err) {
      toastError('Could not download the report', toApiError(err).message)
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <LoadingState message="Loading report..." />
  }

  if (error || !job || !summary) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate('/dashboard')}>
          <ArrowLeft className="h-4 w-4" />
          Back to today
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <p className="font-medium text-foreground">Report not found</p>
            <p className="text-sm text-muted-foreground">
              {error?.message ?? 'This report may have been removed.'}
            </p>
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
  const hasReportContent =
    (job.findings?.length ?? 0) > 0 || Boolean(summary.inspection_notes.trim())

  const address = job.service_address
    ? [
        job.service_address.street,
        job.service_address.city,
        job.service_address.county,
        job.service_address.postcode,
      ]
        .filter(Boolean)
        .join(', ')
    : (job.customer_address ?? '--')

  // Success state once the technician has signed the job off.
  if (completed && isCompleted) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15">
              <PartyPopper className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Visit completed
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {job.job_number} is signed off. Report will be generated.
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <Button disabled={downloading} onClick={() => void handleDownload()}>
                {downloading ? (
                  <Spinner size="sm" className="text-current" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {downloading ? 'Preparing...' : 'Download report'}
              </Button>
              <Button variant="outline" onClick={() => navigate(`/jobs/${job.id}`)}>
                View job details
              </Button>
              <Button variant="ghost" onClick={() => navigate('/dashboard')}>
                Back to today
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-16 pt-4">
      {/* Step 1 - Job summary ------------------------------------------- */}
      <Step number={1} title="Visit summary" icon={ClipboardList} description={job.job_number}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <JobStatusBadge status={job.status} />
            {job.overall_risk_level ? <RiskLevelBadge level={job.overall_risk_level} /> : null}
          </div>

          <div className="flex items-start gap-3">
            <UserIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {job.customer_name ?? 'Unknown customer'}
              </p>
              {job.customer_phone ? (
                <a
                  href={`tel:${job.customer_phone.replace(/\s+/g, '')}`}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {job.customer_phone}
                </a>
              ) : null}
            </div>
          </div>

          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-sm text-foreground">{address}</p>
          </div>

          <div className="flex items-start gap-3">
            <Bug className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
            <p className="text-sm text-foreground">
              {job.service_type}
              {job.pest_types?.length ? ` - ${job.pest_types.join(', ')}` : ''}
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Scheduled {formatBookingDateTime(job.scheduled_start)}
          </p>
        </div>
      </Step>

      {/* Step 2 - Start the visit ----------------------------------------- */}
      <Step
        number={2}
        title="Start the visit"
        icon={PlayCircle}
        description={
          job.actual_start
            ? `Started at ${formatBookingDateTime(job.actual_start)}`
            : 'Tap once you are on site.'
        }
      >
        {isPending ? (
          <Button
            className="h-14 w-full text-base"
            disabled={working || !editable}
            onClick={() => void handleStart()}
          >
            {working ? (
              <Spinner size="sm" className="text-current" />
            ) : (
              <PlayCircle className="h-5 w-5" />
            )}
            Start visit
          </Button>
        ) : (
          <div className="flex items-center gap-2 rounded-md bg-primary/10 p-3 text-sm text-primary">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Started {formatBookingDateTime(job.actual_start)}
          </div>
        )}
      </Step>

      {/* Step 3 - Findings ---------------------------------------------- */}
      <Step
        number={3}
        title="Findings"
        description="Record what you found, area by area, with photos."
        muted={isPending}
      >
        <div className="space-y-4">
          {job.findings?.map((finding, index) => (
            <FindingCard
              key={`${finding.area}-${finding.pest_type}-${index}`}
              finding={finding}
              index={index}
              jobId={job.id}
              photos={photos}
              editable={editable && !isPending}
              useCamera
              onDelete={() => void deleteFinding(index)}
              onAddPhotos={(files) => addPhotosToFinding(index, files)}
              onRemovePhoto={(photoId) => removePhotoFromFinding(photoId)}
              onViewPhoto={setLightboxPhoto}
            />
          ))}

          {showFindingForm ? (
            <FindingForm large onAdd={addFinding} onCancel={() => setShowFindingForm(false)} />
          ) : editable && !isPending ? (
            <Button
              variant="outline"
              className="h-14 w-full text-base"
              onClick={() => setShowFindingForm(true)}
            >
              <Plus className="h-5 w-5" />
              Add finding
            </Button>
          ) : null}
        </div>
      </Step>

      {/* Step 4 - Treatments -------------------------------------------- */}
      <Step
        number={4}
        title="Treatments"
        icon={SprayCan}
        description="Products used, and where you applied them."
        muted={isPending}
      >
        <div className="space-y-4">
          {job.treatments?.map((treatment, index) => (
            <TreatmentCard
              key={`${treatment.pest_type}-${treatment.method}-${index}`}
              treatment={treatment}
              index={index}
              editable={editable && !isPending}
              onDelete={() => void deleteTreatment(index)}
            />
          ))}

          {showTreatmentForm ? (
            <TreatmentForm
              large
              onAdd={addTreatment}
              onCancel={() => setShowTreatmentForm(false)}
            />
          ) : editable && !isPending ? (
            <Button
              variant="outline"
              className="h-14 w-full text-base"
              onClick={() => setShowTreatmentForm(true)}
            >
              <Plus className="h-5 w-5" />
              Add treatment
            </Button>
          ) : null}
        </div>
      </Step>

      {/* Step 5 - Summary & notes --------------------------------------- */}
      <Step
        number={5}
        title="Summary & notes"
        description="Changes save automatically."
        muted={isPending}
      >
        <div className="space-y-5">
          <FormField label="Overall risk level" htmlFor="field-risk">
            <select
              id="field-risk"
              value={summary.overall_risk_level}
              disabled={!editable || isPending}
              onChange={(event) =>
                updateSummary('overall_risk_level', event.target.value, { immediate: true })
              }
              className={SELECT_CLASSES_LG}
            >
              <option value="">Not assessed</option>
              {RISK_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {RISK_LEVEL_LABELS[level]}
                </option>
              ))}
            </select>
            {summary.overall_risk_level ? (
              <div className="pt-2">
                <RiskLevelBadge level={summary.overall_risk_level} size="lg" />
              </div>
            ) : null}
          </FormField>

          <FormField label="Inspection notes" htmlFor="field-notes">
            <Textarea
              id="field-notes"
              rows={5}
              className="text-base"
              disabled={!editable || isPending}
              value={summary.inspection_notes}
              onChange={(event) => updateSummary('inspection_notes', event.target.value)}
              onBlur={() => void saveNow()}
              placeholder="Conditions on site, access notes, anything the office should know."
            />
          </FormField>

          <FormField label="Recommendations" htmlFor="field-recommendations">
            <Textarea
              id="field-recommendations"
              rows={4}
              className="text-base"
              disabled={!editable || isPending}
              value={summary.recommendations}
              onChange={(event) => updateSummary('recommendations', event.target.value)}
              onBlur={() => void saveNow()}
              placeholder="What the customer should do next."
            />
          </FormField>

          <CheckboxField
            id="field-follow-up"
            checked={summary.follow_up_required}
            disabled={!editable || isPending}
            onChange={(checked) => updateSummary('follow_up_required', checked, { immediate: true })}
            label="Follow-up required"
            description="Flag this visit so the office books a return visit."
          />

          {summary.follow_up_required ? (
            <>
              <FormField label="Follow-up notes" htmlFor="field-follow-up-notes">
                <Textarea
                  id="field-follow-up-notes"
                  rows={3}
                  className="text-base"
                  disabled={!editable || isPending}
                  value={summary.follow_up_notes}
                  onChange={(event) => updateSummary('follow_up_notes', event.target.value)}
                  onBlur={() => void saveNow()}
                />
              </FormField>

              <FormField label="Next service due" htmlFor="field-next-service">
                <Input
                  id="field-next-service"
                  type="date"
                  className="h-12 text-base"
                  disabled={!editable || isPending}
                  value={summary.next_service_due}
                  onChange={(event) =>
                    updateSummary('next_service_due', event.target.value, { immediate: true })
                  }
                />
              </FormField>
            </>
          ) : null}
        </div>
      </Step>

      {/* Step 6 - Sign off ---------------------------------------------- */}
      <Step
        number={6}
        title="Sign off"
        description="Capture both signatures, then complete the visit."
        muted={isPending}
      >
        <div className="space-y-6">
          <FormField label="Customer name" htmlFor="field-signature-name">
            <Input
              id="field-signature-name"
              className="h-12 text-base"
              disabled={!editable || isPending}
              value={signatureName}
              onChange={(event) => setSignatureName(event.target.value)}
              placeholder="Name of the person signing"
            />
          </FormField>

          <SignaturePad
            label="Customer signature"
            existingSignature={job.customer_signature}
            readOnly={!editable || isPending}
            onSave={(dataUrl) => setSignatures((s) => ({ ...s, customer: dataUrl }))}
            onClear={() => setSignatures((s) => ({ ...s, customer: null }))}
          />

          <SignaturePad
            label="Technician signature"
            existingSignature={job.technician_signature}
            readOnly={!editable || isPending}
            onSave={(dataUrl) => setSignatures((s) => ({ ...s, technician: dataUrl }))}
            onClear={() => setSignatures((s) => ({ ...s, technician: null }))}
          />

          {isInProgress ? (
            <>
              <Button
                className="h-14 w-full text-base"
                disabled={working || !hasReportContent}
                onClick={() => void handleComplete()}
              >
                {working ? (
                  <Spinner size="sm" className="text-current" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" />
                )}
                {working ? 'Completing...' : 'Complete visit'}
              </Button>
              {!hasReportContent ? (
                <p className="text-center text-xs text-muted-foreground">
                  Add at least one finding or some inspection notes before completing.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </Step>

      <p className="pt-2 text-center text-xs text-muted-foreground/70">
        {saveState === 'saving'
          ? 'Saving...'
          : saveState === 'saved'
            ? 'All changes saved'
            : saveState === 'error'
              ? 'Some changes could not be saved'
              : `${job.job_number} · ${isTechnician ? 'Technician portal' : 'Field form'}`}
      </p>

      <PhotoLightbox
        jobId={job.id}
        photo={lightboxPhoto}
        open={lightboxPhoto !== null}
        onOpenChange={(open) => {
          if (!open) setLightboxPhoto(null)
        }}
      />
    </div>
  )
}

export default JobReportFormPage
