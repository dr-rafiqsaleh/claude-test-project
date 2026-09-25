import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names, resolving Tailwind conflicts. Same as the app's. */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
