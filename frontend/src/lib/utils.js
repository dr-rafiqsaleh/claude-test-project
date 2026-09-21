import { clsx } from 'clsx'
import { format, isValid, parseISO } from 'date-fns'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names, resolving Tailwind conflicts. */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

/** Initials for an avatar fallback, e.g. "Alice Administrator" -> "AA". */
export function getInitials(name) {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Format an ISO timestamp as a short readable date. */
export function formatDate(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/** Format an ISO timestamp as date + time. */
export function formatDateTime(value) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Render a UK address on one line. */
export function formatAddress(address) {
  if (!address) return '--'
  const parts = [address.street, address.city, address.county, address.postcode]
  return parts.filter(Boolean).join(', ')
}

/** Format a number as GBP currency. */
export function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '£0.00'
  return (
    '£' +
    Number(amount).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/** Format an ISO date as the YYYY-MM-DD value an <input type="date"> expects. */
export function toDateInputValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Today plus `days`, as a YYYY-MM-DD string. */
export function addDaysToToday(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateInputValue(date)
}

/** Coerce an ISO string / Date / number into a valid Date, or null. */
export function toDate(value) {
  if (!value) return null
  const date =
    value instanceof Date ? value : typeof value === 'string' ? parseISO(value) : new Date(value)
  return isValid(date) ? date : null
}

/** Booking-style timestamp, e.g. "Mon 28 Jul 2025, 9:00 AM". */
export function formatBookingDateTime(value) {
  const date = toDate(value)
  if (!date) return '--'
  return format(date, 'EEE d MMM yyyy, h:mm a')
}

/** Just the time portion, e.g. "9:00 AM". */
export function formatTime(value) {
  const date = toDate(value)
  if (!date) return '--'
  return format(date, 'h:mm a')
}

/** Human duration from a minute count, e.g. 90 -> "1h 30m". */
export function formatDuration(minutes) {
  const total = Math.max(Math.round(Number(minutes) || 0), 0)
  if (total === 0) return '0m'
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

/** Minutes between two timestamps (0 when either is missing/invalid). */
export function minutesBetween(start, end) {
  const from = toDate(start)
  const to = toDate(end)
  if (!from || !to) return 0
  return Math.max(Math.round((to.getTime() - from.getTime()) / 60000), 0)
}

/**
 * Format a Date (or ISO string) as the local `YYYY-MM-DDTHH:mm` value that
 * an <input type="datetime-local"> expects.
 */
export function toDateTimeInputValue(value) {
  const date = toDate(value)
  if (!date) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Turn a `datetime-local` input value into an ISO string (or null). */
export function fromDateTimeInputValue(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Add `minutes` to a `datetime-local` input value, returning the same format. */
export function addMinutesToInputValue(value, minutes) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  date.setMinutes(date.getMinutes() + (Number(minutes) || 0))
  return toDateTimeInputValue(date)
}

/** Start (00:00) and end (23:59:59.999) of a day, as ISO strings. */
export function dayRangeIso(value = new Date()) {
  const date = toDate(value) ?? new Date()
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)
  return { from: start.toISOString(), to: end.toISOString() }
}
