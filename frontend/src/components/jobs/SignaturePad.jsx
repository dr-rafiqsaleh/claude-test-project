import { useCallback, useEffect, useRef, useState } from 'react'
import SignaturePadLib from 'signature_pad'
import { Check, Eraser, PenLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Drawing area height, in CSS pixels. */
const CANVAS_HEIGHT = 150

/** Nominal width. The canvas stretches to its container, capped at this. */
const CANVAS_WIDTH = 400

/**
 * Signature capture built on signature_pad.
 *
 * Props:
 *   - `label`              caption shown above the pad
 *   - `existingSignature`  a base64 PNG data URL; renders read-only when set
 *   - `onSave(dataUrl)`    called with the trimmed PNG data URL
 *   - `onClear()`          called after the pad is wiped
 *   - `readOnly`           force read-only even without an existing signature
 */
export function SignaturePad({
  label = 'Signature',
  existingSignature = null,
  onSave,
  onClear,
  readOnly = false,
  className,
  disabled = false,
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const padRef = useRef(null)

  // Editing starts closed when a signature already exists - the saved image is
  // shown instead, and "Re-sign" swaps back to the drawing surface.
  const [editing, setEditing] = useState(!existingSignature)
  const [hasInk, setHasInk] = useState(false)
  const [saved, setSaved] = useState(false)

  const locked = readOnly || disabled
  const showPad = editing && !locked

  /** Match the backing store to the container width and device pixel ratio. */
  const resizeCanvas = useCallback((preserve = true) => {
    const canvas = canvasRef.current
    const pad = padRef.current
    if (!canvas || !pad) return

    const previous = preserve && !pad.isEmpty() ? pad.toDataURL('image/png') : null

    const ratio = Math.max(window.devicePixelRatio || 1, 1)
    const available = containerRef.current?.clientWidth || CANVAS_WIDTH
    const width = Math.max(Math.min(available, CANVAS_WIDTH * 2), 220)

    canvas.style.width = `${width}px`
    canvas.style.height = `${CANVAS_HEIGHT}px`
    canvas.width = Math.floor(width * ratio)
    canvas.height = Math.floor(CANVAS_HEIGHT * ratio)

    const context = canvas.getContext('2d')
    if (context) {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.scale(ratio, ratio)
    }

    pad.clear()
    if (previous) {
      void pad.fromDataURL(previous, { width, height: CANVAS_HEIGHT })
    }
  }, [])

  // Create the pad once the canvas is on screen.
  useEffect(() => {
    if (!showPad) {
      padRef.current = null
      return undefined
    }

    const canvas = canvasRef.current
    if (!canvas) return undefined

    const pad = new SignaturePadLib(canvas, {
      backgroundColor: 'rgba(255, 255, 255, 1)',
      penColor: '#0f172a',
      minWidth: 0.7,
      maxWidth: 2.2,
    })
    padRef.current = pad

    resizeCanvas(false)

    // Load an existing signature so the technician can amend rather than redo.
    if (existingSignature) {
      const width = canvas.clientWidth || CANVAS_WIDTH
      void pad.fromDataURL(existingSignature, { width, height: CANVAS_HEIGHT })
      setHasInk(true)
    } else {
      setHasInk(false)
    }

    const handleEnd = () => {
      setHasInk(!pad.isEmpty())
      setSaved(false)
    }
    pad.addEventListener('endStroke', handleEnd)

    const handleResize = () => resizeCanvas(true)
    window.addEventListener('resize', handleResize)

    let observer = null
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver(() => resizeCanvas(true))
      observer.observe(containerRef.current)
    }

    return () => {
      pad.removeEventListener('endStroke', handleEnd)
      window.removeEventListener('resize', handleResize)
      observer?.disconnect()
      pad.off()
      padRef.current = null
    }
    // `existingSignature` is intentionally read only when the pad is (re)created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPad, resizeCanvas])

  function handleClear() {
    padRef.current?.clear()
    setHasInk(false)
    setSaved(false)
    onClear?.()
  }

  function handleSave() {
    const pad = padRef.current
    if (!pad || pad.isEmpty()) return
    const dataUrl = pad.toDataURL('image/png')
    setSaved(true)
    onSave?.(dataUrl)
  }

  return (
    <div className={cn('space-y-2', className)} ref={containerRef}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <PenLine className="h-3.5 w-3.5" />
          {label}
        </p>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <Check className="h-3.5 w-3.5" />
            Captured
          </span>
        ) : null}
      </div>

      {showPad ? (
        <>
          <canvas
            ref={canvasRef}
            aria-label={`${label} drawing area`}
            className="touch-none rounded-md border border-slate-300 bg-white dark:border-slate-600"
            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleClear}>
              <Eraser className="h-4 w-4" />
              Clear
            </Button>
            <Button type="button" size="sm" disabled={!hasInk} onClick={handleSave}>
              <Check className="h-4 w-4" />
              Save signature
            </Button>
            {existingSignature ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false)
                  setSaved(false)
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          {existingSignature ? (
            <img
              src={existingSignature}
              alt={`${label} (captured)`}
              className="rounded-md border border-slate-300 bg-white dark:border-slate-600"
              style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, objectFit: 'contain' }}
            />
          ) : (
            <div
              className="flex items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400 dark:border-slate-600 dark:bg-slate-900"
              style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
            >
              Not signed
            </div>
          )}
          {!locked ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              <PenLine className="h-4 w-4" />
              {existingSignature ? 'Re-sign' : 'Sign here'}
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}

export default SignaturePad
