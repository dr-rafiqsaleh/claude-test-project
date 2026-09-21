import { cn } from '@/lib/utils'

/** Matches the look of the shared `Input`, applied to a native `<select>`. */
export const SELECT_CLASSES =
  'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60'

/** Taller controls for the mobile technician form. */
export const SELECT_CLASSES_LG = cn(SELECT_CLASSES, 'h-12 text-base')

/** A labelled field wrapper used across the job report forms. */
export function FormField({ label, htmlFor, hint, children, className }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground/70">{hint}</p> : null}
    </div>
  )
}

/** A read-only label/value pair. */
export function ReadOnlyField({ label, value, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="break-words text-sm font-medium text-foreground">
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
        'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors',
        checked ? 'border-primary/30 bg-primary/10' : '',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-muted/50',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-input text-primary focus:ring-ring"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description ? (
          <span className="block text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  )
}
