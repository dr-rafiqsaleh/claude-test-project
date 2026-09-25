import { cn } from '@/lib/utils'

/**
 * The PestBase wasp, seen from above: swept wings, a pinched waist and a banded
 * abdomen tapering to a point.
 *
 * The waist is the whole design. Without it this is a bee - which would be an
 * own goal, because pest controllers protect bees and destroy wasps, and a bee
 * on the badge says the opposite of what the business does. Widen the join
 * between thorax and abdomen, or round off the tip, and it turns back into one.
 *
 * The two bands are holes through the abdomen (`fill-rule: evenodd`), not
 * painted stripes, so the mark is a single flat colour and works on any ground
 * - the one-colour and reversed versions need no separate artwork.
 *
 * The 0.88 inset is deliberate: at full size the abdomen tip crowded the tile's
 * rounded corner.
 *
 * Paths are shared verbatim with public/favicon.svg - change one, change both.
 * Checked by rendering at 16, 32, 48 and 256px, in one colour and reversed, not
 * by reading the numbers.
 */
export function LogoMark({ className, size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="PestBase"
      className={cn('shrink-0', className)}
    >
      <rect width="64" height="64" rx="15" className="fill-primary" />
      <g
        className="fill-primary-foreground"
        transform="translate(32 32) scale(0.88) translate(-32 -32)"
      >
        {/* wings, swept back off the thorax */}
        <path d="M27.5 20 C21 19.5 12 25 10.5 31 C15.5 32.6 23.5 28.4 28.5 24.5 Z" />
        <path d="M36.5 20 C43 19.5 52 25 53.5 31 C48.5 32.6 40.5 28.4 35.5 24.5 Z" />
        <path
          d="M27.5 8.5 C24.5 4 20.5 3.5 18.5 5.5"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          className="stroke-primary-foreground"
        />
        <path
          d="M36.5 8.5 C39.5 4 43.5 3.5 45.5 5.5"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          className="stroke-primary-foreground"
        />
        <ellipse cx="32" cy="13.5" rx="6.6" ry="5.6" />
        <ellipse cx="32" cy="23.5" rx="7.6" ry="6.2" />
        {/* the waist: the one part that makes this a wasp and not a bee */}
        <rect x="30.2" y="28.8" width="3.6" height="4.6" rx="1.4" />
        {/* abdomen, with the two bands cut through it */}
        <path
          fillRule="evenodd"
          d="M32 32.5 C27 32.5 23.5 36 22.6 41 C21.3 47.8 25.5 55.5 32 59 C38.5 55.5 42.7 47.8 41.4 41 C40.5 36 37 32.5 32 32.5 Z M23.9 39.2 H40.1 A1.8 1.8 0 0 1 40.1 42.8 H23.9 A1.8 1.8 0 0 1 23.9 39.2 Z M26.3 46.8 H37.7 A1.8 1.8 0 0 1 37.7 50.4 H26.3 A1.8 1.8 0 0 1 26.3 46.8 Z"
        />
      </g>
    </svg>
  )
}

/** PestBase icon + wordmark. */
export function Logo({ className, size = 32, textClassName, subtitle }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <div className="flex flex-col leading-none">
        <span className={cn('text-lg font-bold tracking-tight', textClassName)}>PestBase</span>
        {subtitle ? (
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70">
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  )
}
