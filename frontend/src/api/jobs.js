import api, { API_BASE_URL, unwrap } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'

function buildParams(params) {
  const query = {}
  if (params.page !== undefined) query.page = params.page
  if (params.page_size !== undefined) query.page_size = params.page_size
  if (params.status) query.status = params.status
  if (params.technician_id) query.technician_id = params.technician_id
  if (params.customer_id) query.customer_id = params.customer_id
  if (params.date_from) query.date_from = params.date_from
  if (params.date_to) query.date_to = params.date_to
  if (params.q) query.q = params.q
  return query
}

/** GET /jobs - paginated, filterable job list. */
export async function listJobs(params = {}, signal) {
  const response = await api.get('/jobs', { params: buildParams(params), signal })
  return unwrap(response)
}

/** GET /jobs/{id} */
export async function getJob(id, signal) {
  const response = await api.get(`/jobs/${id}`, { signal })
  return unwrap(response)
}

/** PUT /jobs/{id} - save inspection report fields. */
export async function updateJob(id, data) {
  const response = await api.put(`/jobs/${id}`, data)
  return unwrap(response)
}

/** PATCH /jobs/{id}/status - move the job through its lifecycle. */
export async function updateJobStatus(id, status) {
  const response = await api.patch(`/jobs/${id}/status`, { status })
  return unwrap(response)
}

/**
 * PATCH /jobs/{id}/signature
 * `data` is `{ customer_name_signed, customer_signature, technician_signature }`.
 */
export async function updateJobSignature(id, data) {
  const response = await api.patch(`/jobs/${id}/signature`, data)
  return unwrap(response)
}

/** POST /jobs/from-booking/{bookingId} - open a job against a booking. */
export async function createJobFromBooking(bookingId) {
  const response = await api.post(`/jobs/from-booking/${bookingId}`)
  return unwrap(response)
}

/** DELETE /jobs/{id} - pending jobs only, admin only. */
export async function deleteJob(id) {
  const response = await api.delete(`/jobs/${id}`)
  return unwrap(response)
}

/** The relative URL of a job's PDF report. */
export function getJobReportUrl(id) {
  return `${API_BASE_URL}/jobs/${id}/report`
}

/** GET /jobs/{id}/report - returns the rendered PDF as a Blob. */
export async function getJobReport(id) {
  const response = await api.get(`/jobs/${id}/report`, { responseType: 'blob' })
  return response.data
}

/** Fetch the inspection report and trigger a browser download. */
export async function downloadJobReport(id, jobNumber) {
  const blob = await getJobReport(id)
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `job-${jobNumber ?? id}-report.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()

  URL.revokeObjectURL(url)
}

/* -------------------------------------------------------------------------
 * Photos
 * ---------------------------------------------------------------------- */

/** POST /jobs/{jobId}/photos - multipart upload of one image. */
export async function uploadPhoto(jobId, file) {
  const form = new FormData()
  form.append('file', file)

  const response = await api.post(`/jobs/${jobId}/photos`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  })
  return unwrap(response)
}

/** GET /jobs/{jobId}/photos - photo metadata (no image data). */
export async function listPhotos(jobId, signal) {
  const response = await api.get(`/jobs/${jobId}/photos`, { signal })
  return unwrap(response)
}

/**
 * A URL that renders one photo, safe to drop straight into an `<img src>`.
 *
 * An `<img>` cannot carry an Authorization header, so the access token travels
 * in the query string - the API accepts it there for this endpoint only.
 */
export function getPhotoUrl(jobId, photoId) {
  const token = useAuthStore.getState().accessToken
  const base = `${API_BASE_URL}/jobs/${jobId}/photos/${photoId}`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

/** DELETE /jobs/{jobId}/photos/{photoId} */
export async function deletePhoto(jobId, photoId) {
  const response = await api.delete(`/jobs/${jobId}/photos/${photoId}`)
  return unwrap(response)
}
