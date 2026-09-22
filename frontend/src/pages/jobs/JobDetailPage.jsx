import { useEffect, useState } from 'react'
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
  Hash,
  Mail,
  MapPin,
  PenLine,
  Phone,
  PlayCircle,
  Plus,
  Receipt,
  Smartphone,
  Timer,
  User as UserIcon,
  UserRound,
  Wrench,
  XCircle,
} from 'lucide-react'

import { createInvoiceFromJob } from '@/api/invoices'
import { downloadJobReport, updateJobSignature, updateJobStatus } from '@/api/jobs'
import { EmailDialog } from '@/components/email/EmailDialog'
import { ActivityBadge } from '@/components/jobs/ActivityBadge'
import { FindingCard } from '@/components/jobs/FindingCard'
import { FindingForm } from '@/components/jobs/FindingForm'
import { FormField } from '@/components/jobs/JobFormControls'
import { JobStatusBadge } from '@/components/jobs/JobStatusBadge'
import { PhotoLightbox } from '@/components/jobs/PhotoLightbox'
import {
  ActionTakenField,
  ActivityFields,
  AssessmentFields,
  ConditionsFields,
  FollowUpFields,
  InspectionSummaryField,
  UnableToSignField,
  VisitTypeField,
  reportHasContent,
  useReportFields,
} from '@/components/jobs/ReportFields'
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
import { DetailField, PageHeader } from '@/components/ui/page'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { LoadingState, Spinner } from '@/components/ui/spinner'
import { toastError, toastSuccess } from '@/components/ui/use-toast'
import { useJob, useJobPhotos } from '@/hooks/useJobs'
import { useReportAutosave } from '@/hooks/useReportAutosave'
import { toApiError } from '@/lib/api'
import { cn, formatBookingDateTime, formatDuration } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { JOB_STATUS } from '@/lib/constants'


/** Subtle "Saving..." / "Saved" indicator shown next to the job number. */
function SaveIndicator({ state }) {
  if (state === 'idle') return null

  const map = {
    saving: { label: 'Saving...', className: 'text-muted-foreground' },
    saved: { label: 'Saved', className: 'text-primary' },
    error: { label: 'Not saved', className: 'text-destructive' },
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
  const { saveState, saveNow, scheduleSave } = useReportAutosave(id, setJob)
  // Local copies of the report fields, so typing is never interrupted by a
  // background save round-trip.
  const { fields, setField, setAssessment } = useReportFields(job, { saveNow, scheduleSave })
  const { photos, upload, remove: removePhoto } = useJobPhotos(id)

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
  const [emailOpen, setEmailOpen] = useState(false)

  const isAssigned = Boolean(job && job.technician_id && job.technician_id === user?.id)
  const editable =
    Boolean(job) &&
    (job.status === JOB_STATUS.PENDING || job.status === JOB_STATUS.IN_PROGRESS) &&
    (canWrite || isAssigned)

  useEffect(() => {
    if (!job) return
    setSignatureName(
      (current) =>
        current || job.customer_name_signed || job.site_contact_name || job.customer_name || '',
    )
  }, [job])

  async function addFinding(finding) {
    const saved = await saveNow({ findings: [...(job.findings ?? []), finding] })
    if (saved) setShowFindingForm(false)
    return Boolean(saved)
  }

  async function deleteFinding(index) {
    const next = (job.findings ?? []).filter((_, i) => i !== index)
    await saveNow({ findings: next })
  }

  async function addTreatment(treatment) {
    const saved = await saveNow({ treatments: [...(job.treatments ?? []), treatment] })
    if (saved) setShowTreatmentForm(false)
    return Boolean(saved)
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
      await saveNow({}, { throwOnError: true })
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
    return <LoadingState message="Loading report..." />
  }

  if (error || !job || !fields) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="-ml-2" onClick={() => navigate('/jobs')}>
          <ArrowLeft className="h-4 w-4" />
          Back to jobs
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Report not found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {error?.message ?? 'This report may have been removed.'}
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
  const canComplete = isInProgress && (canWrite || isAssigned) && reportHasContent(job, fields)
  const showSignatures = isInProgress || isCompleted
  const sectionProps = { fields, setField, saveNow, disabled: !editable }

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={`/bookings/${job.booking_id}`}
        backLabel="Back to job"
        title={`Report ${job.job_number}`}
        badge={
          <>
            <JobStatusBadge status={job.status} />
            <ActivityBadge level={job.activity_level} />
            <SaveIndicator state={saveState} />
          </>
        }
        description={
          <>
            {job.customer_name ?? 'Unknown customer'} · {job.service_type} ·{' '}
            {job.technician_name ?? 'Unassigned'}
          </>
        }
        actions={
          <>
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
                  <Spinner size="sm" className="text-current" />
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
                    : 'Record the pest activity, a finding or the action taken first'
                }
                onClick={() => void changeStatus(JOB_STATUS.COMPLETED)}
              >
                {transitioning ? (
                  <Spinner size="sm" className="text-current" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Complete job
              </Button>
            ) : null}

            {isCompleted && canWrite ? (
              <>
                <Button onClick={() => setEmailOpen(true)}>
                  <Mail className="h-4 w-4" />
                  Email report
                </Button>
                <EmailDialog
                  kind="report"
                  documentId={job.id}
                  open={emailOpen}
                  onOpenChange={setEmailOpen}
                  onSent={() => void refetch()}
                />
              </>
            ) : null}

            {isCompleted ? (
              <Button disabled={downloading} onClick={() => void handleDownload()}>
                {downloading ? (
                  <Spinner size="sm" className="text-current" />
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
          </>
        }
      />

      {/* Job info -------------------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Job details</CardTitle>
            <CardDescription>From the job this report belongs to.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <DetailField icon={ClipboardList} label="Service type" value={job.service_type} />
              <DetailField
                icon={Wrench}
                label="Technician"
                value={job.technician_name ?? 'Unassigned'}
              />
              <DetailField
                icon={CalendarClock}
                label="Scheduled"
                value={`${formatBookingDateTime(job.scheduled_start)} - ${formatBookingDateTime(
                  job.scheduled_end,
                )}`}
              />
              <DetailField
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
              <DetailField icon={Timer} label="Time on site" value={formatDuration(job.duration_minutes)} />
              {job.booking_number ? (
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Job
                    </p>
                    <Link
                      to={`/bookings/${job.booking_id}`}
                      className="text-sm font-medium text-primary hover:underline"
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
                <Bug className="h-4 w-4 text-muted-foreground" />
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Target pests
                </p>
              </div>
              {job.pest_types?.length ? (
                <div className="flex flex-wrap gap-2">
                  {job.pest_types.map((pest) => (
                    <span
                      key={pest}
                      className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground"
                    >
                      {pest}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">None recorded.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <DetailField icon={UserIcon} label="Name" value={job.customer_name ?? '--'} />
            <DetailField
              icon={Phone}
              label="Phone"
              value={job.customer_phone ?? '--'}
              href={job.customer_phone ? `tel:${job.customer_phone.replace(/\s/g, '')}` : undefined}
            />
            <DetailField icon={MapPin} label="Service address" value={addressLine(job)} />
            {job.site_contact_name || job.site_contact_phone ? (
              <DetailField
                icon={UserRound}
                label="Site contact"
                value={[job.site_contact_name, job.site_contact_phone].filter(Boolean).join(', ')}
                href={
                  job.site_contact_phone
                    ? `tel:${job.site_contact_phone.replace(/\s/g, '')}`
                    : undefined
                }
              />
            ) : null}
            {job.order_number ? (
              <DetailField icon={Hash} label="Order number" value={job.order_number} />
            ) : null}
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to={`/customers/${job.customer_id}`}>View customer</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Visit & pest activity ------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Visit &amp; pest activity</CardTitle>
          <CardDescription>
            {editable
              ? 'Why the visit happened and how much activity was found. Changes save automatically.'
              : 'Why the visit happened and how much activity was found.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <VisitTypeField {...sectionProps} />
          <ActivityFields {...sectionProps} />
        </CardContent>
      </Card>

      {/* Findings -------------------------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Inspection findings</CardTitle>
            <CardDescription>
              {editable
                ? 'An overall summary, then what was found area by area, with photos.'
                : 'An overall summary, then what was found area by area.'}
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
          <InspectionSummaryField {...sectionProps} />

          {showFindingForm ? (
            <FindingForm
              pestsFound={fields.pests_found}
              onAdd={addFinding}
              onCancel={() => setShowFindingForm(false)}
            />
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
            <p className="py-4 text-center text-sm text-muted-foreground">
              No findings recorded yet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Hygiene & proofing --------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Hygiene &amp; proofing</CardTitle>
          <CardDescription>What the customer needs to put right.</CardDescription>
        </CardHeader>
        <CardContent>
          <ConditionsFields {...sectionProps} />
        </CardContent>
      </Card>

      {/* Action taken & products ---------------------------------------- */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Action taken &amp; products used</CardTitle>
            <CardDescription>What was done, and every product used on site.</CardDescription>
          </div>
          {editable && !showTreatmentForm ? (
            <Button variant="outline" size="sm" onClick={() => setShowTreatmentForm(true)}>
              <Plus className="h-4 w-4" />
              Add product
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <ActionTakenField {...sectionProps} />

          {showTreatmentForm ? (
            <TreatmentForm
              pestsFound={fields.pests_found}
              onAdd={addTreatment}
              onCancel={() => setShowTreatmentForm(false)}
            />
          ) : null}

          {job.treatments?.length ? (
            job.treatments.map((treatment, index) => (
              <TreatmentCard
                key={`${treatment.product_name}-${treatment.pest_type}-${index}`}
                treatment={treatment}
                index={index}
                editable={editable}
                onDelete={() => void deleteTreatment(index)}
              />
            ))
          ) : !showTreatmentForm ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No products recorded yet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Recommendations & follow-up ------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>Recommendations &amp; follow-up</CardTitle>
          <CardDescription>What the customer should do next, and whether we return.</CardDescription>
        </CardHeader>
        <CardContent>
          <FollowUpFields {...sectionProps} />
        </CardContent>
      </Card>

      {/* Assessments ----------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Assessments</CardTitle>
          <CardDescription>The assessments in place for this visit, as printed on the report.</CardDescription>
        </CardHeader>
        <CardContent>
          <AssessmentFields {...sectionProps} setAssessment={setAssessment} />
        </CardContent>
      </Card>

      {/* Signatures ------------------------------------------------------ */}
      {showSignatures ? (
        <Card>
          <CardHeader>
            <CardTitle>Sign-off</CardTitle>
            <CardDescription>
              {job.signed_at
                ? `Signed by ${job.customer_name_signed ?? 'the customer'} on ${formatBookingDateTime(
                    job.signed_at,
                  )}.`
                : job.customer_unable_to_sign
                  ? `The customer was not available to sign${
                      job.customer_unable_reason ? `: ${job.customer_unable_reason}` : '.'
                    }`
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

            <UnableToSignField {...sectionProps} />

            <div className="grid gap-6 lg:grid-cols-2">
              {!fields.customer_unable_to_sign || job.customer_signature ? (
                <SignaturePad
                  label="Customer signature"
                  existingSignature={job.customer_signature}
                  readOnly={isCompleted && !canWrite}
                  onSave={(dataUrl) => setSignatures((s) => ({ ...s, customer: dataUrl }))}
                  onClear={() => setSignatures((s) => ({ ...s, customer: null }))}
                />
              ) : null}
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
                  <Spinner size="sm" className="text-current" />
                ) : (
                  <PenLine className="h-4 w-4" />
                )}
                {savingSignature ? 'Saving...' : 'Save signatures'}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Report ---------------------------------------------------------- */}
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
                <Spinner size="sm" className="text-current" />
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
              className="bg-destructive hover:bg-destructive/90"
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
