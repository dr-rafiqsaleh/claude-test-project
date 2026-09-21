import { cn } from '@/lib/utils'
import { ACTIVITY_LEVEL_COLORS, ACTIVITY_LEVEL_LABELS } from '@/lib/constants'

/** Pill showing how much pest activity a report found, e.g. "Activity: High". */
export function ActivityBadge({ level, className }) {
  if (!level) return null

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium',
        ACTIVITY_LEVEL_COLORS[level] ?? 'bg-muted text-foreground',
        className,
      )}
    >
      {level === 'none' ? 'No activity' : `Activity: ${ACTIVITY_LEVEL_LABELS[level] ?? level}`}
    </span>
  )
}

export default ActivityBadge
