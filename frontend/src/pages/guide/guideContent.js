/**
 * The in-app user guide: what each part of PestBase is for, step by step.
 *
 * Screenshots live in public/guide/ and were taken from the app itself on demo
 * data ("Greenshield Pest Control", a fictional company). Retake them when a
 * screen changes enough that a step no longer matches it.
 *
 * Text supports **bold** only; each step may have `tips` (short bullets) and a
 * `note` (one highlighted warning).
 */

export const GUIDE_SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting started',
    icon: 'Rocket',
    audience: 'Everyone',
    intro:
      'Signing in, finding your way around, and the Today page that starts every day.',
    steps: [
      {
        title: 'Sign in with your email address',
        text:
          'Go to your PestBase address and type the email address your administrator set up for you, then choose **Email me a sign-in link**. There is no password to remember.',
        image: '01-sign-in-email',
        tips: ['Use the same address your administrator added to the Team page.'],
      },
      {
        title: 'Open the link, or type the code',
        text:
          'We email you a link and a six-digit code. Open the link on the same device, or type the code into the box and choose **Sign in**. Handy on a site phone where opening email links is awkward.',
        image: '02-sign-in-code',
        tips: [
          'No email? Check your junk folder, then use **Send another**.',
          'Typed the wrong address? Use **Different email**.',
        ],
      },
      {
        title: 'Start on Today',
        text:
          'Today shows what needs attention: jobs to confirm with customers, reports still to file, quotes awaiting a reply, invoices ready to send and anything overdue. Below it is today’s diary across all technicians, and a summary of money in and owed. Choose any card to go straight to that list.',
        image: '03-today',
      },
      {
        title: 'Search for anything',
        text:
          'The search box at the top looks across customers, quotes, jobs and invoices at once. Start typing a name, postcode or number, then pick a result, or choose **See all results**.',
        image: '04-search',
      },
      {
        title: 'Keep an eye on notifications',
        text:
          'The bell shows reminders PestBase creates for you: jobs starting soon, tomorrow’s visits, invoices coming due or overdue, and quotes about to expire. Choose one to open it, or **Mark all read**.',
        image: '05-notifications',
      },
    ],
  },
  {
    id: 'customers',
    title: 'Customers',
    icon: 'Users',
    audience: 'Office',
    intro: 'Every quote, job, report and invoice belongs to a customer, so this is where most work begins.',
    steps: [
      {
        title: 'Find a customer',
        text:
          'Open **Customers** in the menu. Search by name, email, phone or postcode, and choose a customer to see everything you have done for them.',
        image: '10-customers',
      },
      {
        title: 'Add a new customer',
        text:
          'Choose **New customer** and fill in their name, phone number and address. An email address is optional, but you need one to email them quotes, reports and invoices. Then choose **Create customer**.',
        image: '11-customer-new',
      },
      {
        title: 'Everything about them, in one place',
        text:
          'The customer page shows their contact details and all their jobs, quotes and invoices. Tap a phone number to call it. From here you can start a **New quote** or **Book a job** for them straight away.',
        image: '12-customer-detail',
        tips: ['Invoices appear here automatically once a job for this customer is completed.'],
      },
    ],
  },
  {
    id: 'quotes',
    title: 'Quotes',
    icon: 'FileText',
    audience: 'Office',
    intro: 'Price the work, email it with a branded PDF, and turn an accepted quote into a booked job.',
    steps: [
      {
        title: 'See your quotes',
        text:
          'Open **Quotes** to see every quote with its status: Draft, Sent, Accepted, Rejected or Expired. Use the search and status filter to narrow the list.',
        image: '20-quotes',
      },
      {
        title: 'Create a quote',
        text:
          'Choose **New quote**, pick the customer, then add a line for each service: a description, the pest and service type, the quantity and unit, and the price per unit. Use **Add item** for more lines.',
        image: '21-quote-new',
      },
      {
        title: 'Check the totals and terms',
        text:
          'The live totals show the subtotal, VAT and total as you type. The quote is valid for 30 days unless you change the date. Add any notes for the customer, then choose **Save as draft**, or **Save and email** to send it now.',
        image: '21b-quote-totals',
      },
      {
        title: 'Send the quote',
        text:
          'On a draft quote, choose **Send quote**. The email is filled in from your template in Settings, with the quote attached as a PDF. Change anything you like, then choose **Send email**. The quote is marked as Sent.',
        image: '23-quote-email',
        tips: [
          'Use **Cc** to copy in a letting agent or tenant.',
          '**Download PDF** gives you the same PDF to print or send another way.',
        ],
      },
      {
        title: 'Accept it, and book the job',
        text:
          'When the customer agrees, open the quote and choose **Accept**. Then choose **Book the job**: the booking form opens with the customer, quote and price already filled in.',
        image: '24-quote-accepted',
      },
    ],
  },
  {
    id: 'jobs',
    title: 'Jobs and scheduling',
    icon: 'CalendarDays',
    audience: 'Office',
    intro: 'Book visits, give them to a technician, confirm them with the customer and see the week at a glance.',
    steps: [
      {
        title: 'Book a job',
        text:
          'Choose **Book a job** (from Today, Jobs, a customer or an accepted quote). Pick the customer, and the quote if there is one. Add who will be on site and their phone number, so the technician can call ahead.',
        image: '30-book-from-quote',
      },
      {
        title: 'Choose when, and who',
        text:
          'Set the start time and how long it should take; the end time follows. Pick the technician, and choose **Repeats** for contract work: weekly, fortnightly, monthly or quarterly. Tick the pests involved, then choose **Book job**.',
        image: '31-book-schedule',
        tips: [
          '**Quoted amount** is the price before VAT. It becomes the invoice line for jobs that did not come from a quote.',
          'A repeating job books a year of visits ahead as tentative visits, and keeps topping them up.',
        ],
      },
      {
        title: 'Confirm the visit with the customer',
        text:
          'A new job is Scheduled. Once the customer has agreed the time, open it and choose **Confirm**. The technician is told about new jobs in the app and by email.',
        image: '34-job-confirmed',
        tips: ['**Edit** to move a job, or **Cancel** if it is no longer needed.'],
      },
      {
        title: 'See every job',
        text:
          'Open **Jobs** for the full list. Filter by status or technician, search by customer or job number, or limit it to a date range.',
        image: '35-jobs-list',
      },
      {
        title: 'Use the calendar',
        text:
          'Switch to **Calendar** to see the day, week or month. Filter to one technician to see their diary. Tentative visits from repeating jobs show dashed until you confirm them.',
        image: '36-jobs-calendar',
      },
    ],
  },
  {
    id: 'reports',
    title: 'Inspection reports',
    icon: 'ClipboardList',
    audience: 'Technicians and office',
    intro:
      'Technicians fill in the Pest Control Inspection & Treatment Report on their phone, on site. The office checks it and emails it to the customer.',
    steps: [
      {
        title: 'Your day, on your phone',
        text:
          'Technicians open PestBase in their phone’s browser. Today lists your visits in order, with any report still to finish at the top. Use **Map** for directions and **Call** to ring the site contact.',
        image: '40-tech-today',
        phone: true,
      },
      {
        title: 'Start the job',
        text:
          'When you arrive, choose **Start job**. The report opens with the job details filled in, and records your start time. Everything you enter saves as you go.',
        image: '41-tech-report-start',
        phone: true,
      },
      {
        title: 'Record the visit and pest activity',
        text:
          'Tap the type of visit, how much activity you found, and the pests found. The pests from the booking are already ticked; tap to change them.',
        image: '42-tech-visit',
        phone: true,
      },
      {
        title: 'Add findings, area by area',
        text:
          'Write a short inspection summary, then choose **Add finding** for each problem: the area, the pest, its priority, the evidence seen, what you found, what you recommend and who needs to act.',
        image: '43-tech-finding',
        phone: true,
      },
      {
        title: 'Take photos',
        text:
          'Under each finding, choose **Take photo** to add pictures straight from your phone’s camera. They are printed on the report next to the finding.',
        image: '44-tech-finding-photo',
        phone: true,
      },
      {
        title: 'Record the products you used',
        text:
          'Under **Action taken & products**, describe what you did, then choose **Add product used**. Pick the product from your company’s list; its active ingredient and HSE/MAPP number are filled in for you. Add the quantity, bait status and location.',
        image: '45-tech-product',
        phone: true,
        tips: ['Your administrator keeps the product list in Settings, under Reports.'],
      },
      {
        title: 'Sign off and complete',
        text:
          'Add your recommendations and tick **Follow-up due** if a return visit is needed. Answer the assessments, get the customer to sign on screen, and sign yourself. If the customer is not there, tick **Customer not available to sign**. Then choose **Complete job**.',
        image: '46-tech-signoff',
        phone: true,
      },
      {
        title: 'Done',
        text:
          'The job is signed off and the report PDF is ready to download. In the office, a draft invoice has already been raised.',
        image: '48-tech-completed',
        phone: true,
      },
      {
        title: 'In the office: check the report',
        text:
          'Open **Jobs**, then the report (reports are numbered RPT-). You see everything the technician recorded: the visit, findings and photos, products used and signatures.',
        image: '51-report-office',
      },
      {
        title: 'Email the report to the customer',
        text:
          'Choose **Email report**. The message is filled in from your template and the report is attached as a PDF. Check it and choose **Send email**. **Download report** gives you the same PDF.',
        image: '53-report-email',
      },
    ],
  },
  {
    id: 'invoices',
    title: 'Invoices and payments',
    icon: 'Receipt',
    audience: 'Office',
    intro: 'Invoices raise themselves when a job is completed. Check them, send them, and record payments as they arrive.',
    steps: [
      {
        title: 'A draft invoice is waiting',
        text:
          'Completing a job raises a draft invoice. If the job came from a quote it uses the quote’s lines; otherwise it uses the job’s quoted amount. Open it from the report with **View invoice**, or from **Invoices**.',
        image: '60-invoice-draft',
        note:
          'Check the amount before sending. A job booked without a price gives a £0.00 draft: choose **Edit** and add the lines first.',
      },
      {
        title: 'Send the invoice',
        text:
          'Choose **Send invoice**. The email is filled in from your template, with the invoice attached as a PDF, including your bank details. Choose **Send email**, and the invoice is marked as Sent.',
        image: '62-invoice-email',
      },
      {
        title: 'Record a payment',
        text:
          'When money arrives, open the invoice and choose **Record payment**. Enter the amount, how it was paid, a reference and the date received. Part payments are fine: the balance due updates.',
        image: '63-record-payment',
      },
      {
        title: 'Track what is owed',
        text:
          'The invoice shows as Part paid until the balance is cleared, then Paid. **Email again** resends it; **Download PDF** gives you a copy.',
        image: '64-invoice-part-paid',
      },
      {
        title: 'Your invoices at a glance',
        text:
          'Open **Invoices** for totals invoiced, outstanding, overdue and collected this month. Filter by status or date, or tick **Overdue only** to chase what is late. Overdue invoices also show a red dot in the menu.',
        image: '61-invoices',
      },
    ],
  },
  {
    id: 'admin',
    title: 'Team and settings',
    icon: 'Settings',
    audience: 'Administrators',
    intro: 'Add your staff, choose what each role can do, and set up your company’s documents and emails.',
    steps: [
      {
        title: 'Your team',
        text:
          'Open **Team** under Admin to see everyone who can sign in, their role and whether they are active.',
        image: '70-team',
      },
      {
        title: 'Add a member of staff',
        text:
          'Choose **New user**, enter their name, job title (printed on reports) and email address, and pick their role. PestBase emails them a sign-in link. To stop someone signing in, set them to inactive; their history is kept.',
        image: '71-team-add',
        tips: [
          'Technicians see their jobs and reports, but not prices or invoices.',
          'Change what each role can do on the Roles tab.',
        ],
      },
      {
        title: 'Company profile and branding',
        text:
          'In **Settings**, the Company Profile tab holds your business name, contact details, address and logo. They appear on every quote, invoice and report PDF.',
        image: '72-settings',
      },
      {
        title: 'Invoicing',
        text:
          'The Invoicing tab holds your VAT registration, payment terms, bank details and the next numbers for quotes, jobs, reports and invoices.',
        image: '73-settings-invoicing',
        tips: ['Until you switch VAT on, nothing charges or mentions VAT.'],
      },
      {
        title: 'Products for reports',
        text:
          'The Reports tab holds the products your technicians use, with the active ingredient, HSE/MAPP number and safety data sheet reference, so they never have to type them on site.',
        image: '74-settings-reports',
      },
      {
        title: 'Email templates',
        text:
          'The Email tab holds the wording for quote, invoice and report emails, the reply-to address and an office copy. Placeholders such as {customer_name} are filled in for each email.',
        image: '75-settings-email',
      },
      {
        title: 'Support access',
        text:
          'If you need help from PestBase, the Support access tab lets you open a time-limited window for our support team to see your records. You can close it at any time, and every access is recorded in your audit trail.',
        image: '76-settings-support',
      },
    ],
  },
]

export const DEFAULT_SECTION = 'getting-started'
/** Technicians start with the part of the guide that is about their day. */
export const TECHNICIAN_SECTION = 'reports'
