import { useCallback, useEffect, useRef, useState } from 'react'

import { updateJob } from '@/api/jobs'
import { toastError } from '@/components/ui/use-toast'
import { toApiError } from '@/lib/api'

const AUTOSAVE_DELAY_MS = 1500

/**
 * Autosave for a job's inspection report.
 *
 * Edits passed to `scheduleSave` are sent 1.5s after the last change. Edits that
 * fail to save stay queued, so the next save retries them, and anything still
 * queued is flushed when the page closes - a technician losing signal in a loft
 * must never lose what they typed.
 *
 * `saveNow(extra)` saves immediately. It resolves to the updated job, or `null`
 * when there was nothing to save or the save failed (a toast explains why).
 * Pass `{ throwOnError: true }` to have a failure reject instead, for callers
 * that must not carry on - completing a job, for one.
 */
export function useReportAutosave(jobId, onSaved) {
  const [saveState, setSaveState] = useState('idle')
  const pendingRef = useRef({})
  const timerRef = useRef(null)
  const savedTimerRef = useRef(null)

  const saveNow = useCallback(
    async (extra = {}, { throwOnError = false } = {}) => {
      if (!jobId) return null
      clearTimeout(timerRef.current)
      timerRef.current = null

      const queued = pendingRef.current
      const payload = { ...queued, ...extra }
      pendingRef.current = {}
      if (Object.keys(payload).length === 0) return null

      setSaveState('saving')
      try {
        const updated = await updateJob(jobId, payload)
        onSaved(updated)
        setSaveState('saved')
        clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 2500)
        return updated
      } catch (err) {
        // Re-queue the debounced edits so they are retried. `extra` is not
        // re-queued: its caller still holds that data and can resubmit it.
        pendingRef.current = { ...queued, ...pendingRef.current }
        setSaveState('error')
        if (throwOnError) throw err
        toastError('Could not save the report', toApiError(err).message)
        return null
      }
    },
    [jobId, onSaved],
  )

  const scheduleSave = useCallback(
    (partial) => {
      pendingRef.current = { ...pendingRef.current, ...partial }
      setSaveState('saving')
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        void saveNow()
      }, AUTOSAVE_DELAY_MS)
    },
    [saveNow],
  )

  // Leaving the page flushes whatever is still queued rather than dropping it.
  const saveNowRef = useRef(saveNow)
  saveNowRef.current = saveNow
  useEffect(
    () => () => {
      clearTimeout(savedTimerRef.current)
      if (Object.keys(pendingRef.current).length > 0) void saveNowRef.current()
    },
    [],
  )

  return { saveState, saveNow, scheduleSave }
}
