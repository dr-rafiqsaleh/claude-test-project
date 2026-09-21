import { cn } from '@/lib/utils'

/** QKil pest/bug mark. */
export function LogoMark({ className, size = 32 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="QKil"
      className={cn('shrink-0', className)}
    >
      <rect width="24" height="24" rx="6" className="fill-emerald-600" />
      <g
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* antennae */}
        <path d="M9.2 5.4 10.6 7.2M14.8 5.4 13.4 7.2" />
        {/* body */}
        <ellipse cx="12" cy="13" rx="3.2" ry="5" fill="rgba(255,255,255,0.15)" />
        <path d="M12 8.2v9.6" />
        {/* legs */}
        <path d="M8.9 10.6 6.2 9.4M8.8 13.2H5.9M8.9 15.8l-2.7 1.3M15.1 10.6l2.7-1.2M15.2 13.2h2.9M15.1 15.8l2.7 1.3" />
      </g>
    </svg>
  )
}

/** QKil icon + wordmark. */
export function Logo({ className, size = 32, textClassName, subtitle }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={size} />
      <div className="flex flex-col leading-none">
        <span className={cn('text-lg font-bold tracking-tight', textClassName)}>QKil</span>
        {subtitle ? (
          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-slate-400">
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  )
}
