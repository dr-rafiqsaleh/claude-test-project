import { cva } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
        secondary: 'border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        destructive: 'border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
        warning: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
        info: 'border-transparent bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
        outline: 'border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
