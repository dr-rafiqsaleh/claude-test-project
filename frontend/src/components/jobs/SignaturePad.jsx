import { useCallback, useEffect, useRef, useState } from 'react'
import SignaturePadLib from 'signature_pad'
import { Check, Eraser, PenLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Drawing area height, in CSS pixels. */
const CANVAS_HEIGHT = 150

/** Nominal width. The canvas stretches to its container, capped at this. */
const CANVAS_WIDTH = 400

/** White space kept around the ink when a signature is cropped, in CSS pixels. */
const TRIM_PADDING = 8

/**
 * The signature as a PNG cropped to its ink, so it prints at a readable size
 * instead of as a small scribble in a large blank box. Null when nothing is
 * drawn.
 */
function trimmedSignature(canvas) {
  const context = canvas.getContext('2d')
  if (!context) return null
  const { width, height } = canvas
  const pixels = context.getImageData(0, 0, width, height).data

  let top = height
  let left = width
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      // Dark ink on the pad's white background.
      if (pixels[index] < 200 || pixels[index + 1] < 200 || pixels[index + 2] < 200) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  if (right < 0) return null

  const padding = Math.round(TRIM_PADDING * Math.max(window.devicePixelRatio || 1, 1))
  left = Math.max(left - padding, 0)
  top = Math.max(top - padding, 0)
  right = Math.min(right + padding, width - 1)
  bottom = Math.min(bottom + padding, height - 1)

  const cropped = document.createElement('canvas')
  cropped.width = right - left + 1
  cropped.height = bottom - top + 1
  const target = cropped.getContext('2d')
  target.fillStyle = '#ffffff'
  target.fillRect(0, 0, cropped.width, cropped.height)
  target.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
  return cropped.toDataURL('image/png')
}

/**
 * Signature capture built on signature_pad.
 *
 * The signature is captured as it is drawn: `onSave` runs after every stroke,
 * so there is no separate save step to forget before completing a job.
 *
 * Props:
 *   - `label`              caption shown above the pad
 *   - `existingSignature`  a base64 PNG data URL; shown as an image when set
 *   - `onSave(dataUrl)`    called with the PNG, cropped to the ink, after each stroke
 *   - `onClear()`          called when the pad is wiped, or a re-sign is cancelled
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
  const [saved, setSaved] = useState(false)

  // The pad's stroke listener is set up once; this keeps it calling the latest onSave.
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

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
    setSaved(false)

    const handleEnd = () => {
      if (pad.isEmpty()) return
      const dataUrl = trimmedSignature(canvas)
      if (!dataUrl) return
      setSaved(true)
      onSaveRef.current?.(dataUrl)
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
  }, [showPad, resizeCanvas])

  function handleClear() {
    padRef.current?.clear()
    setSaved(false)
    onClear?.()
  }

  return (
    <div className={cn('space-y-2', className)} ref={containerRef}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <PenLine className="h-3.5 w-3.5" />
          {label}
        </p>
        {saved ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
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
            className="touch-none rounded-md border border-input bg-card"
            style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleClear}>
              <Eraser className="h-4 w-4" />
              Clear
            </Button>
            {existingSignature ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Keep the signature already on file, not the half-drawn one.
                  setEditing(false)
                  setSaved(false)
                  onClear?.()
                }}
              >
                Keep previous signature
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">Saved as you sign.</span>
          </div>
        </>
      ) : (
        <>
          {existingSignature ? (
            <img
              src={existingSignature}
              alt={`${label} (captured)`}
              className="rounded-md border border-input bg-card"
              style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, objectFit: 'contain' }}
            />
          ) : (
            <div
              className="flex items-center justify-center rounded-md border border-dashed border-input bg-muted/50 text-sm text-muted-foreground/70"
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
