import { useRef, useState } from 'react'
import { Camera, ImageOff, Trash2 } from 'lucide-react'

import { getPhotoUrl } from '@/api/jobs'
import { RiskLevelBadge } from '@/components/jobs/RiskLevelBadge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

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
        'space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Finding {index + 1}
            </span>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {finding.area}
            </h4>
            <span className="text-sm text-slate-500 dark:text-slate-400">- {finding.pest_type}</span>
            <RiskLevelBadge level={finding.severity} />
          </div>
        </div>

        {editable && onDelete ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950"
            onClick={onDelete}
            aria-label={`Delete finding ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {finding.description ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            What was found
          </p>
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
            {finding.description}
          </p>
        </div>
      ) : null}

      {finding.recommendation ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Recommendation
          </p>
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
            {finding.recommendation}
          </p>
        </div>
      ) : null}

      {attached.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attached.map((photo) => (
            <div key={photo.id} className="group relative">
              {photo.missing ? (
                <div className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-slate-300 text-slate-400 dark:border-slate-600">
                  <ImageOff className="h-5 w-5" />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onViewPhoto?.(photo)}
                  className="block overflow-hidden rounded-md border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-slate-700"
                >
                  <img
                    src={getPhotoUrl(jobId, photo.id)}
                    alt={photo.filename}
                    loading="lazy"
                    className="h-20 w-20 bg-slate-100 object-cover transition-transform group-hover:scale-105 dark:bg-slate-800"
                  />
                </button>
              )}

              {editable && onRemovePhoto ? (
                <button
                  type="button"
                  onClick={() => void handleRemovePhoto(photo.id)}
                  disabled={removingId === photo.id}
                  aria-label={`Remove ${photo.filename}`}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white shadow-sm transition-opacity hover:bg-red-700 disabled:opacity-50"
                >
                  {removingId === photo.id ? (
                    <Spinner size="sm" className="h-3 w-3 text-white" />
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
