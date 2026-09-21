import * as React from 'react'

import { cn } from '@/lib/utils'

const Input = React.forwardRef(({ className, type = 'text', hasError = false, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    aria-invalid={hasError || undefined}
    className={cn(
      'flex h-10 w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors',
      'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
      'disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60',
      '',
      hasError
        ? 'border-destructive focus-visible:ring-destructive'
        : 'border-input focus-visible:ring-ring',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
