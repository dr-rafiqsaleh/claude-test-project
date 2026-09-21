import { Loader2 } from 'lucide-react'

import { cn } from '@/lib/utils'

const sizeMap = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-10 w-10',
}

/** Inline loading indicator. */
export function Spinner({ size = 'md', className, label = 'Loading' }) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn('animate-spin text-emerald-600', sizeMap[size], className)}
    />
  )
}

/** Centred spinner with a caption, for full-panel loading states. */
export function LoadingState({ message = 'Loading...', className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16', className)}>
      <Spinner size="lg" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{message}</p>
    </div>
  )
}
