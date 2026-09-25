import { Fragment, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ClipboardList,
  FileText,
  Lightbulb,
  Receipt,
  Rocket,
  Settings,
  Users,
} from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageHeader } from '@/components/ui/page'
import { UserRole } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { DEFAULT_SECTION, GUIDE_SECTIONS, TECHNICIAN_SECTION } from '@/pages/guide/guideContent'
import { useAuthStore } from '@/store/authStore'

const ICONS = { Rocket, Users, FileText, CalendarDays, ClipboardList, Receipt, Settings }

/** Text with **bold** runs. */
function Rich({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={index} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  )
}

function Screenshot({ step, onOpen }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group block overflow-hidden rounded-lg border border-border bg-muted shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        step.phone ? 'mx-auto w-full max-w-[280px] rounded-2xl' : 'w-full',
      )}
      aria-label={`Enlarge screenshot: ${step.title}`}
    >
      <img
        src={`/guide/${step.image}.webp`}
        alt={step.title}
        loading="lazy"
        className="block h-auto w-full transition-transform duration-200 group-hover:scale-[1.01]"
      />
    </button>
  )
}

function Step({ step, number, onOpenImage }) {
  return (
    <li className="grid gap-5 border-t border-border py-8 first:border-t-0 first:pt-2 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-8">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {number}
          </span>
          <h3 className="text-lg font-semibold leading-snug text-foreground">{step.title}</h3>
        </div>
        <p className="leading-relaxed text-muted-foreground">
          <Rich text={step.text} />
        </p>
        {step.note ? (
          <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              <Rich text={step.note} />
            </span>
          </p>
        ) : null}
        {step.tips?.length ? (
          <ul className="space-y-1.5">
            {step.tips.map((tip) => (
              <li key={tip} className="flex gap-2 text-sm text-muted-foreground">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <Rich text={tip} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {step.image ? <Screenshot step={step} onOpen={() => onOpenImage(step)} /> : null}
    </li>
  )
}

function SectionLink({ section, active }) {
  const Icon = ICONS[section.icon] ?? FileText
  const ref = useRef(null)

  // On a phone the sections are a sideways-scrolling row: keep the current one in view.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active])

  return (
    <Link
      ref={ref}
      to={`/guide/${section.id}`}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} aria-hidden="true" />
      <span className="whitespace-nowrap">{section.title}</span>
    </Link>
  )
}

/** The user guide: how to use PestBase, section by section, with screenshots. */
export default function GuidePage() {
  const { sectionId } = useParams()
  const role = useAuthStore((state) => state.user?.role)
  const [enlarged, setEnlarged] = useState(null)

  if (!sectionId) {
    return <Navigate to={`/guide/${role === UserRole.TECHNICIAN ? TECHNICIAN_SECTION : DEFAULT_SECTION}`} replace />
  }

  const index = GUIDE_SECTIONS.findIndex((section) => section.id === sectionId)
  if (index === -1) return <Navigate to={`/guide/${DEFAULT_SECTION}`} replace />

  const section = GUIDE_SECTIONS[index]
  const previous = GUIDE_SECTIONS[index - 1]
  const next = GUIDE_SECTIONS[index + 1]

  return (
    <div className="space-y-6">
      <PageHeader
        title="User guide"
        description="How to run your day in PestBase, from signing in to getting paid. Choose a screenshot to see it larger."
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Guide sections" className="lg:sticky lg:top-4 lg:self-start">
          <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
            {GUIDE_SECTIONS.map((item) => (
              <SectionLink key={item.id} section={item} active={item.id === section.id} />
            ))}
          </div>
        </nav>

        <Card>
          <CardContent className="p-5 sm:p-8">
            <div className="mb-4 space-y-2">
              <Badge variant="secondary">For: {section.audience}</Badge>
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">{section.title}</h2>
              <p className="text-muted-foreground">{section.intro}</p>
            </div>

            <ol>
              {section.steps.map((step, stepIndex) => (
                <Step key={step.title} step={step} number={stepIndex + 1} onOpenImage={setEnlarged} />
              ))}
            </ol>

            <div className="mt-4 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between">
              {previous ? (
                <Button asChild variant="outline">
                  <Link to={`/guide/${previous.id}`}>
                    <ArrowLeft className="h-4 w-4" />
                    {previous.title}
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              {next ? (
                <Button asChild>
                  <Link to={`/guide/${next.id}`}>
                    Next: {next.title}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(enlarged)} onOpenChange={(open) => !open && setEnlarged(null)}>
        <DialogContent className={cn('max-h-[95dvh] overflow-y-auto', enlarged?.phone ? 'max-w-md' : 'max-w-5xl')}>
          <DialogHeader>
            <DialogTitle>{enlarged?.title}</DialogTitle>
            <DialogDescription>Screenshot from the PestBase demo company.</DialogDescription>
          </DialogHeader>
          {enlarged ? (
            <img src={`/guide/${enlarged.image}.webp`} alt={enlarged.title} className="h-auto w-full rounded-md border border-border" />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
