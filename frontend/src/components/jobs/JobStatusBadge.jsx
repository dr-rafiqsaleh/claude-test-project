import { cn } from '@/lib/utils'
import { JOB_STATUS_COLORS, JOB_STATUS_LABELS } from '@/lib/constants'

/** Dark-mode companion classes for each job status. */
const DARK_CLASSES = {
  pending: 'dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'dark:bg-amber-900/40 dark:text-amber-300',
  completed: 'dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'dark:bg-red-900/40 dark:text-red-300',
}

/** Pill showing a job's lifecycle status. */
export function JobStatusBadge({ status, className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium',
        JOB_STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-700',
        DARK_CLASSES[status] ?? 'dark:bg-slate-800 dark:text-slate-300',
        className,
      )}
    >
      {JOB_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default JobStatusBadge
