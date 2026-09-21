import { cn } from '@/lib/utils'
import { JOB_STATUS_COLORS, JOB_STATUS_LABELS } from '@/lib/constants'

/** Dark-mode companion classes for each job status. */
const DARK_CLASSES = {
  pending: '',
  in_progress: 'dark:bg-amber-900/40 dark:text-amber-300',
  completed: '',
  cancelled: '',
}

/** Pill showing a job's lifecycle status. */
export function JobStatusBadge({ status, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium',
        JOB_STATUS_COLORS[status] ?? 'bg-muted text-foreground',
        DARK_CLASSES[status] ?? '',
        className,
      )}
    >
      {JOB_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default JobStatusBadge
