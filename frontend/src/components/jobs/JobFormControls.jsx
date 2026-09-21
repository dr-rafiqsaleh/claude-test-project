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

/**
 * A row of tap-to-choose buttons, quicker than a dropdown on a phone.
 *
 * Single choice by default: `value` is a string, and tapping the chosen
 * option again clears it. With `multiple`, `value` is an array and each
 * option toggles.
 */
export function ChoiceChips({
  options,
  labels = {},
  value,
  onChange,
  multiple = false,
  large = false,
  disabled = false,
  ariaLabel,
  className,
}) {
  const selected = multiple ? (value ?? []) : [value]

  function toggle(option) {
    if (multiple) {
      onChange(
        selected.includes(option)
          ? selected.filter((item) => item !== option)
          : [...selected, option],
      )
    } else {
      onChange(value === option ? '' : option)
    }
  }

  return (
    <div role="group" aria-label={ariaLabel} className={cn('flex flex-wrap gap-2', className)}>
      {options.map((option) => {
        const isSelected = selected.includes(option)
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={() => toggle(option)}
            className={cn(
              'rounded-full border px-3 font-medium transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              'disabled:cursor-not-allowed disabled:opacity-60',
              large ? 'min-h-11 py-2 text-sm' : 'py-1 text-xs',
              isSelected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-card text-muted-foreground enabled:hover:bg-muted/50',
            )}
          >
            {labels[option] ?? option}
          </button>
        )
      })}
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
