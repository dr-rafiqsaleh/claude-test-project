import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef(({ className, type = 'text', hasError = false, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    aria-invalid={hasError || undefined}
    className={cn(
      'flex h-10 w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors',
      'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
      'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60',
      'dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500',
      hasError
        ? 'border-red-500 focus-visible:ring-red-500'
        : 'border-slate-300 focus-visible:ring-emerald-600 dark:border-slate-700',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
