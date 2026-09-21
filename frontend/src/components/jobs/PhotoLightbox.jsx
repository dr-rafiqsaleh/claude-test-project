import { getPhotoUrl } from '@/api/jobs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/** Full-size view of one inspection photo. */
export function PhotoLightbox({ jobId, photo, open, onOpenChange }) {
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
            src={getPhotoUrl(jobId, photo.id)}
            alt={photo.filename}
            className="max-h-[70vh] w-full rounded-md bg-slate-100 object-contain dark:bg-slate-800"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export default PhotoLightbox
