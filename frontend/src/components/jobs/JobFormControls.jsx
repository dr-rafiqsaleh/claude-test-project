import { cn } from '@/lib/utils'

/** Matches the look of the shared `Input`, applied to a native `<select>`. */
export const SELECT_CLASSES =
  'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

/** Taller controls for the mobile technician form. */
export const SELECT_CLASSES_LG = cn(SELECT_CLASSES, 'h-12 text-base')

/** A labelled field wrapper used across the job report forms. */
export function FormField({ label, htmlFor, hint, children, className }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
    </div>
  )
}

/** A read-only label/value pair. */
export function ReadOnlyField({ label, value, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="break-words text-sm font-medium text-slate-900 dark:text-slate-100">
        {value || '--'}
      </p>
    </div>
  )
}

/** A simple checkbox with a label, sized for touch. */
export function CheckboxField({ id, checked, onChange, label, description, disabled }) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 p-3 transition-colors dark:border-slate-700',
        checked ? 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20' : '',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{label}</span>
        {description ? (
          <span className="block text-xs text-slate-500 dark:text-slate-400">{description}</span>
        ) : null}
      </span>
    </label>
  )
}
