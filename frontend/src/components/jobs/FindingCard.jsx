import { useRef, useState } from 'react'
import { Camera, ImageOff, Trash2 } from 'lucide-react'

import { getPhotoUrl } from '@/api/jobs'
import { RiskLevelBadge } from '@/components/jobs/RiskLevelBadge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuthedSrc } from '@/hooks/useAuthedSrc'
import { cn } from '@/lib/utils'
import { PRIORITY_LABELS, RESPONSIBLE_PARTY_LABELS } from '@/lib/constants'

/**
 * One inspection finding, with its photo strip.
 *
 * Props:
 *   - `finding`        the finding object from `job.findings`
 *   - `index`          zero-based position, used for the heading
 *   - `jobId`          owning job, needed to build photo URLs
 *   - `photos`         photo metadata for this job, keyed lookup happens here
 *   - `editable`       show the delete / add-photo controls
 *   - `useCamera`      open the rear camera directly (mobile technician form)
 *   - `onDelete()`     remove this finding
 *   - `onAddPhotos(files)`  async; resolve with the new photo ids
 *   - `onRemovePhoto(photoId)`  async
 *   - `onViewPhoto(photo)`
 */
/** A photo thumbnail that also loads in the app, where an <img> cannot send the session. */
function PhotoThumb({ src, ...props }) {
  const authedSrc = useAuthedSrc(src)
  return <img src={authedSrc} loading="lazy" {...props} />
}

export function FindingCard({
  finding,
  index,
  jobId,
  photos = [],
  editable = false,
  useCamera = false,
  onDelete,
  onAddPhotos,
  onRemovePhoto,
  onViewPhoto,
  className,
}) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [removingId, setRemovingId] = useState(null)

  const photoLookup = new Map(photos.map((photo) => [photo.id, photo]))
  const attached = (finding.photo_ids ?? [])
    .map((id) => photoLookup.get(id) ?? { id, filename: 'Photo', missing: true })

  async function handleFiles(event) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0 || !onAddPhotos) return

    setUploading(true)
    try {
      await onAddPhotos(files)
    } finally {
      setUploading(false)
    }
  }

  async function handleRemovePhoto(photoId) {
    if (!onRemovePhoto) return
    setRemovingId(photoId)
    try {
      await onRemovePhoto(photoId)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div
      className={cn(
        'space-y-3 rounded-lg border border-border bg-card p-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
              Finding {index + 1}
            </span>
            <h4 className="text-sm font-semibold text-foreground">
              {finding.area}
            </h4>
            <span className="text-sm text-muted-foreground">- {finding.pest_type}</span>
            <RiskLevelBadge level={finding.severity} label={PRIORITY_LABELS[finding.severity]} />
          </div>
        </div>

        {editable && onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onDelete}
            aria-label={`Delete finding ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {finding.description ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            What was found
          </p>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {finding.description}
          </p>
        </div>
      ) : null}

      {finding.evidence?.length ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Evidence
          </p>
          <p className="text-sm text-foreground">{finding.evidence.join(', ')}</p>
        </div>
      ) : null}

      {finding.recommendation ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recommendation
          </p>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {finding.recommendation}
          </p>
        </div>
      ) : null}

      {finding.responsible_party ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Action by
          </p>
          <p className="text-sm text-foreground">
            {RESPONSIBLE_PARTY_LABELS[finding.responsible_party] ?? finding.responsible_party}
          </p>
        </div>
      ) : null}

      {attached.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attached.map((photo) => (
            <div key={photo.id} className="group relative">
              {photo.missing ? (
                <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-input text-muted-foreground/70">
                  <ImageOff className="h-5 w-5" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onViewPhoto?.(photo)}
                  className="block overflow-hidden rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <PhotoThumb
                    src={getPhotoUrl(jobId, photo.id)}
                    alt={photo.filename}
                    className="h-20 w-20 bg-muted object-cover transition-transform group-hover:scale-105"
                  />
                </button>
              )}

              {editable && onRemovePhoto ? (
                <button
                  type="button"
                  onClick={() => void handleRemovePhoto(photo.id)}
                  disabled={removingId === photo.id}
                  aria-label={`Remove ${photo.filename}`}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-opacity hover:bg-destructive/90 disabled:opacity-50"
                >
                  {removingId === photo.id ? (
                    <Spinner size="sm" className="h-3 w-3 text-current" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {editable && onAddPhotos ? (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            {...(useCamera ? { capture: 'environment' } : {})}
            onChange={(event) => void handleFiles(event)}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? <Spinner size="sm" /> : <Camera className="h-4 w-4" />}
            {uploading ? 'Uploading...' : useCamera ? 'Take photo' : 'Add photos'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default FindingCard
