import { cn } from '@/lib/utils'
import { RISK_LEVEL_COLORS, RISK_LEVEL_LABELS } from '@/lib/constants'

/** Dark-mode companion classes for each risk level. */
const DARK_CLASSES = {
  low: '',
  medium: 'dark:bg-yellow-900/40 dark:text-yellow-300',
  high: 'dark:bg-orange-900/40 dark:text-orange-300',
  critical: '',
}

/** Pill showing a finding's severity, or a job's overall risk level. */
export function RiskLevelBadge({ level, className, size = 'sm' }) {
  if (!level) return null

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-transparent font-medium',
        size === 'lg' ? 'px-4 py-1.5 text-sm font-semibold' : 'px-2.5 py-0.5 text-xs',
        RISK_LEVEL_COLORS[level] ?? 'bg-muted text-foreground',
        DARK_CLASSES[level] ?? '',
        className,
      )}
    >
      {RISK_LEVEL_LABELS[level] ?? level}
    </span>
  )
}

export default RiskLevelBadge
