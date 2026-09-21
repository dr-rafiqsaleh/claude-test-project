/** Shared domain constants for the QKil frontend. */

export const UserRole = {
  ADMIN: 'admin',
  OFFICE_STAFF: 'office_staff',
  TECHNICIAN: 'technician',
}

export const ROLE_LABELS = {
  [UserRole.ADMIN]: 'Admin',
  [UserRole.OFFICE_STAFF]: 'Office Staff',
  [UserRole.TECHNICIAN]: 'Technician',
}

export const ALL_ROLES = [UserRole.ADMIN, UserRole.OFFICE_STAFF, UserRole.TECHNICIAN]

/** Roles allowed to create/update/delete records. */
export const WRITE_ROLES = [UserRole.ADMIN, UserRole.OFFICE_STAFF]

export const UK_COUNTIES = [
  'Bedfordshire', 'Berkshire', 'Bristol', 'Buckinghamshire', 'Cambridgeshire',
  'Cheshire', 'City of London', 'Cornwall', 'Cumbria', 'Derbyshire', 'Devon',
  'Dorset', 'Durham', 'East Riding of Yorkshire', 'East Sussex', 'Essex',
  'Gloucestershire', 'Greater London', 'Greater Manchester', 'Hampshire',
  'Herefordshire', 'Hertfordshire', 'Isle of Wight', 'Kent', 'Lancashire',
  'Leicestershire', 'Lincolnshire', 'Merseyside', 'Norfolk', 'North Yorkshire',
  'Northamptonshire', 'Northumberland', 'Nottinghamshire', 'Oxfordshire',
  'Rutland', 'Shropshire', 'Somerset', 'South Yorkshire', 'Staffordshire',
  'Suffolk', 'Surrey', 'Tyne and Wear', 'Warwickshire', 'West Midlands',
  'West Sussex', 'West Yorkshire', 'Wiltshire', 'Worcestershire',
  // Scotland
  'Aberdeenshire', 'Angus', 'Argyll and Bute', 'Clackmannanshire', 'Dumfries and Galloway',
  'Dundee', 'East Ayrshire', 'Edinburgh', 'Falkirk', 'Fife', 'Glasgow',
  'Highland', 'Inverclyde', 'Midlothian', 'Moray', 'North Ayrshire',
  'Perth and Kinross', 'Renfrewshire', 'Scottish Borders', 'Stirling',
  // Wales
  'Cardiff', 'Carmarthenshire', 'Ceredigion', 'Conwy', 'Denbighshire',
  'Flintshire', 'Gwynedd', 'Isle of Anglesey', 'Monmouthshire', 'Neath Port Talbot',
  'Newport', 'Pembrokeshire', 'Powys', 'Rhondda Cynon Taf', 'Swansea', 'Vale of Glamorgan',
  // Northern Ireland
  'Antrim', 'Armagh', 'Belfast', 'Down', 'Fermanagh', 'Londonderry', 'Tyrone',
]

export const QuoteStatus = {
  DRAFT: 'draft',
  SENT: 'sent',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
}

export const ALL_QUOTE_STATUSES = [
  QuoteStatus.DRAFT,
  QuoteStatus.SENT,
  QuoteStatus.ACCEPTED,
  QuoteStatus.REJECTED,
  QuoteStatus.EXPIRED,
]

export const QUOTE_STATUS_LABELS = {
  [QuoteStatus.DRAFT]: 'Draft',
  [QuoteStatus.SENT]: 'Sent',
  [QuoteStatus.ACCEPTED]: 'Accepted',
  [QuoteStatus.REJECTED]: 'Rejected',
  [QuoteStatus.EXPIRED]: 'Expired',
}

/** Badge variant used for each quote status. */
export const QUOTE_STATUS_BADGE = {
  [QuoteStatus.DRAFT]: 'secondary',
  [QuoteStatus.SENT]: 'info',
  [QuoteStatus.ACCEPTED]: 'default',
  [QuoteStatus.REJECTED]: 'destructive',
  [QuoteStatus.EXPIRED]: 'warning',
}

/** Units a quote line item can be priced in. */
export const QUOTE_UNITS = ['service', 'sqm', 'hour', 'item', 'visit']

/** Pest types offered as suggestions on a quote line item. */
export const QUOTE_PEST_TYPES = [
  'Cockroach',
  'Termite',
  'Ant',
  'Spider',
  'Rodent',
  'Bed Bug',
  'Flea',
  'Wasp',
  'Bird',
  'Other',
]

/** Service categories offered as suggestions on a quote line item. */
export const QUOTE_SERVICE_TYPES = [
  'Treatment',
  'Inspection',
  'Prevention',
  'Fumigation',
  'Baiting',
  'Exclusion',
  'Follow-up',
]

export const DEFAULT_QUOTE_TERMS = 'Payment due within 14 days. VAT included.'

/* -------------------------------------------------------------------------
 * Bookings
 * ---------------------------------------------------------------------- */

export const BOOKING_STATUS = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}

/** Alias matching the QuoteStatus naming style used elsewhere. */
export const BookingStatus = BOOKING_STATUS

export const ALL_BOOKING_STATUSES = [
  BOOKING_STATUS.SCHEDULED,
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.IN_PROGRESS,
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.CANCELLED,
]

export const BOOKING_STATUS_LABELS = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const BOOKING_STATUS_COLORS = {
  scheduled: 'bg-indigo-100 text-indigo-800',
  confirmed: 'bg-sky-100 text-sky-800',
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
}

/** Hex colours used by FullCalendar events, mirroring the backend palette. */
export const BOOKING_STATUS_HEX = {
  scheduled: '#6366f1',
  confirmed: '#0ea5e9',
  in_progress: '#f59e0b',
  completed: '#10b981',
  cancelled: '#ef4444',
}

/** Statuses where a booking's details can still be edited. */
export const EDITABLE_BOOKING_STATUSES = [BOOKING_STATUS.SCHEDULED, BOOKING_STATUS.CONFIRMED]

/** Statuses where a booking may be deleted. */
export const DELETABLE_BOOKING_STATUSES = [BOOKING_STATUS.SCHEDULED, BOOKING_STATUS.CANCELLED]

export const SERVICE_TYPES = [
  'General Pest Control',
  'Termite Inspection',
  'Termite Treatment',
  'Rodent Control',
  'Cockroach Treatment',
  'Ant Treatment',
  'Spider Treatment',
  'Bed Bug Treatment',
  'Wasp/Bee Removal',
  'Pre-Purchase Inspection',
  'Commercial Pest Control',
]

export const PEST_TYPES = [
  'Cockroach',
  'Ant',
  'Spider',
  'Termite',
  'Rodent',
  'Bed Bug',
  'Wasp',
  'Bee',
  'Flea',
  'Silverfish',
  'Fly',
  'Mosquito',
]

export const RECURRENCE_TYPES = {
  none: 'One-off',
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
}

/** Default length, in minutes, of a newly scheduled booking. */
export const DEFAULT_BOOKING_DURATION_MINUTES = 60

/* -------------------------------------------------------------------------
 * Jobs & inspection reports
 * ---------------------------------------------------------------------- */

export const JOB_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}

/** Alias matching the QuoteStatus/BookingStatus naming style used elsewhere. */
export const JobStatus = JOB_STATUS

export const ALL_JOB_STATUSES = [
  JOB_STATUS.PENDING,
  JOB_STATUS.IN_PROGRESS,
  JOB_STATUS.COMPLETED,
  JOB_STATUS.CANCELLED,
]

export const JOB_STATUS_LABELS = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const JOB_STATUS_COLORS = {
  pending: 'bg-gray-100 text-gray-800',
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
}

/** Statuses where the inspection report can still be edited. */
export const EDITABLE_JOB_STATUSES = [JOB_STATUS.PENDING, JOB_STATUS.IN_PROGRESS]

/** Statuses where a job may be deleted. */
export const DELETABLE_JOB_STATUSES = [JOB_STATUS.PENDING]

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical']

export const RISK_LEVEL_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export const RISK_LEVEL_COLORS = {
  low: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

/** Hex swatches mirroring the backend PDF palette. */
export const RISK_LEVEL_HEX = {
  low: '#10b981',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
}

export const TREATMENT_METHODS = [
  'spray',
  'bait',
  'dust',
  'gel',
  'trap',
  'fumigation',
  'heat',
  'other',
]

export const TREATMENT_METHOD_LABELS = {
  spray: 'Spray',
  bait: 'Bait',
  dust: 'Dust',
  gel: 'Gel',
  trap: 'Trap',
  fumigation: 'Fumigation',
  heat: 'Heat',
  other: 'Other',
}

/* -------------------------------------------------------------------------
 * Invoices & payments
 * ---------------------------------------------------------------------- */

export const INVOICE_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  PAID: 'paid',
  PARTIALLY_PAID: 'partially_paid',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
}

/** Alias matching the QuoteStatus/BookingStatus naming style used elsewhere. */
export const InvoiceStatus = INVOICE_STATUS

export const ALL_INVOICE_STATUSES = [
  INVOICE_STATUS.DRAFT,
  INVOICE_STATUS.SENT,
  INVOICE_STATUS.PARTIALLY_PAID,
  INVOICE_STATUS.OVERDUE,
  INVOICE_STATUS.PAID,
  INVOICE_STATUS.CANCELLED,
]

export const INVOICE_STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  partially_paid: 'Part Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
}

export const INVOICE_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-800',
  paid: 'bg-emerald-100 text-emerald-800',
  partially_paid: 'bg-teal-100 text-teal-800',
  overdue: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-500 line-through',
}

export const PAYMENT_METHODS = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  other: 'Other',
}

/** Statuses where the invoice details can still be edited. */
export const EDITABLE_INVOICE_STATUSES = [INVOICE_STATUS.DRAFT, INVOICE_STATUS.SENT]

/** Statuses where an invoice may be deleted. */
export const DELETABLE_INVOICE_STATUSES = [INVOICE_STATUS.DRAFT]

/** Statuses that can accept a payment. */
export const PAYABLE_INVOICE_STATUSES = [
  INVOICE_STATUS.SENT,
  INVOICE_STATUS.PARTIALLY_PAID,
  INVOICE_STATUS.OVERDUE,
]

/** Statuses an invoice can no longer move out of. */
export const TERMINAL_INVOICE_STATUSES = [INVOICE_STATUS.PAID, INVOICE_STATUS.CANCELLED]

export const DEFAULT_INVOICE_TERMS =
  'Payment due within 14 days. VAT registered under GB123456789. ' +
  'Thank you for your business.'

export const DEFAULT_PAYMENT_INSTRUCTIONS =
  'Bank transfer - Sort Code: 20-00-00  Account No: 12345678  ' +
  'Account Name: QKil Pest Control Ltd. Please quote the invoice number as the reference.'

/** Days between the issue date and the due date on a new invoice. */
export const DEFAULT_INVOICE_TERM_DAYS = 14

/* -------------------------------------------------------------------------
 * Global search
 * ---------------------------------------------------------------------- */

/** Collections the search endpoint covers, in display order. */
export const SEARCH_TYPES = ['customers', 'quotes', 'bookings', 'jobs', 'invoices']

export const SEARCH_TYPE_LABELS = {
  customers: 'Customers',
  quotes: 'Quotes',
  bookings: 'Bookings',
  jobs: 'Jobs',
  invoices: 'Invoices',
}

/** Maps a result item's singular `type` back to its group key. */
export const SEARCH_ITEM_GROUP = {
  customer: 'customers',
  quote: 'quotes',
  booking: 'bookings',
  job: 'jobs',
  invoice: 'invoices',
}

/** Badge variant per result status, shared by the dropdown and results page. */
export const SEARCH_STATUS_BADGE = {
  active: 'default',
  inactive: 'secondary',
  draft: 'secondary',
  sent: 'info',
  accepted: 'default',
  rejected: 'destructive',
  expired: 'warning',
  scheduled: 'info',
  confirmed: 'info',
  pending: 'secondary',
  in_progress: 'warning',
  completed: 'default',
  cancelled: 'secondary',
  paid: 'default',
  partially_paid: 'info',
  overdue: 'destructive',
}

/** localStorage key holding the last few header searches. */
export const RECENT_SEARCHES_KEY = 'qkil_recent_searches'

/** How many recent searches the header dropdown remembers. */
export const MAX_RECENT_SEARCHES = 5

/* -------------------------------------------------------------------------
 * Notifications
 * ---------------------------------------------------------------------- */

export const NOTIFICATION_TYPE = {
  BOOKING_REMINDER: 'booking_reminder',
  BOOKING_TODAY: 'booking_today',
  INVOICE_OVERDUE: 'invoice_overdue',
  INVOICE_DUE_SOON: 'invoice_due_soon',
  JOB_FOLLOW_UP: 'job_follow_up',
  QUOTE_EXPIRING: 'quote_expiring',
  QUOTE_ACCEPTED: 'quote_accepted',
  JOB_COMPLETED: 'job_completed',
  SYSTEM: 'system',
}

/** Which filter tab a notification type belongs under. */
export const NOTIFICATION_CATEGORY = {
  booking_reminder: 'bookings',
  booking_today: 'bookings',
  invoice_overdue: 'invoices',
  invoice_due_soon: 'invoices',
  job_follow_up: 'jobs',
  job_completed: 'jobs',
  quote_expiring: 'quotes',
  quote_accepted: 'quotes',
  system: 'system',
}

export const NOTIFICATION_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'quotes', label: 'Quotes' },
]

/** Accent colour per notification category, used for the icon chip. */
export const NOTIFICATION_ACCENT = {
  bookings: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  invoices: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  jobs: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  quotes: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  system: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

/* -------------------------------------------------------------------------
 * Company settings
 * ---------------------------------------------------------------------- */

/** Largest company logo the settings page will accept, in bytes (2 MB). */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

export const DEFAULT_PRIMARY_COLOR = '#059669'

export const INSPECTION_AREAS = [
  'Kitchen',
  'Bathroom',
  'Laundry',
  'Living Room',
  'Bedroom',
  'Garage',
  'Roof Void',
  'Subfloor',
  'Garden/Yard',
  'Perimeter',
  'Shed',
  'Fence Line',
  'Drains',
  'Other',
]
