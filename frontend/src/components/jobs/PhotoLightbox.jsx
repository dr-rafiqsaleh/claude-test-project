import { getPhotoUrl } from '@/api/jobs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuthedSrc } from '@/hooks/useAuthedSrc'

/** Full-size view of one inspection photo. */
export function PhotoLightbox({ jobId, photo, open, onOpenChange }) {
  const src = useAuthedSrc(photo ? getPhotoUrl(jobId, photo.id) : null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-all">{photo?.filename ?? 'Photo'}</DialogTitle>
          <DialogDescription>
            {photo
              ? `${photo.content_type} - ${Math.round((photo.size_bytes ?? 0) / 1024)} KB`
              : 'Inspection photo'}
          </DialogDescription>
        </DialogHeader>

        {photo ? (
          <img
            src={src}
            alt={photo.filename}
            className="max-h-[70vh] w-full rounded-md bg-muted object-contain"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export default PhotoLightbox
