import api, { unwrap } from '@/lib/api'

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
  if (params.no_job !== undefined) query.no_job = params.no_job
  return query
}

/** GET /bookings - paginated, filterable booking list. */
export async function listBookings(params = {}, signal) {
  const response = await api.get('/bookings', { params: buildParams(params), signal })
  return unwrap(response)
}

/** GET /bookings/{id} */
export async function getBooking(id, signal) {
  const response = await api.get(`/bookings/${id}`, { signal })
  return unwrap(response)
}

/** POST /bookings */
export async function createBooking(data) {
  const response = await api.post('/bookings', data)
  return unwrap(response)
}

/** PUT /bookings/{id} - scheduled or confirmed bookings only. */
export async function updateBooking(id, data) {
  const response = await api.put(`/bookings/${id}`, data)
  return unwrap(response)
}

/** PATCH /bookings/{id}/status - move the booking through its lifecycle. */
export async function updateBookingStatus(id, status, reason) {
  const response = await api.patch(`/bookings/${id}/status`, {
    status,
    reason: reason ?? null,
  })
  return unwrap(response)
}

/** DELETE /bookings/{id} - scheduled or cancelled bookings only. */
export async function deleteBooking(id) {
  const response = await api.delete(`/bookings/${id}`)
  return unwrap(response)
}

/** GET /bookings/calendar - events shaped for FullCalendar. */
export async function getCalendarEvents(dateFrom, dateTo, technicianId, signal) {
  const params = {}
  if (dateFrom) params.date_from = dateFrom
  if (dateTo) params.date_to = dateTo
  if (technicianId) params.technician_id = technicianId

  const response = await api.get('/bookings/calendar', { params, signal })
  return unwrap(response) ?? []
}

/** POST /bookings/from-quote/{quoteId} - convert an accepted quote. */
export async function createBookingFromQuote(quoteId, data) {
  const response = await api.post(`/bookings/from-quote/${quoteId}`, data)
  return unwrap(response)
}

/** GET /bookings/technicians - active technicians available for assignment. */
export async function listTechnicians(signal) {
  const response = await api.get('/bookings/technicians', { signal })
  return unwrap(response)
}

/** GET /bookings/availability/{technicianId}?date= - booked slots for one day. */
export async function getTechnicianAvailability(technicianId, date, signal) {
  const response = await api.get(`/bookings/availability/${technicianId}`, {
    params: { date },
    signal,
  })
  return unwrap(response)
}
