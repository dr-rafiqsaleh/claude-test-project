import * as React from 'react'

import { cn } from '@/lib/utils'

const Table = React.forwardRef(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-x-auto">
    <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
  </div>
))
Table.displayName = 'Table'

const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('bg-slate-50 [&_tr]:border-b dark:bg-slate-900/60', className)} {...props} />
))
TableHeader.displayName = 'TableHeader'

const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0 [&_tr:nth-child(even)]:bg-slate-50/50 dark:[&_tr:nth-child(even)]:bg-slate-900/30', className)}
    {...props}
  />
))
TableBody.displayName = 'TableBody'

const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn('border-t bg-slate-50 font-medium dark:bg-slate-900/60', className)}
    {...props}
  />
))
TableFooter.displayName = 'TableFooter'

const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b border-slate-200 transition-colors hover:bg-emerald-50/60 data-[state=selected]:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-800/60',
      className,
    )}
    {...props}
  />
))
TableRow.displayName = 'TableRow'

const TableHead = React.forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400',
      className,
    )}
    {...props}
  />
))
TableHead.displayName = 'TableHead'

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('px-4 py-3 align-middle', className)} {...props} />
))
TableCell.displayName = 'TableCell'

const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-slate-500 dark:text-slate-400', className)} {...props} />
))
TableCaption.displayName = 'TableCaption'

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
