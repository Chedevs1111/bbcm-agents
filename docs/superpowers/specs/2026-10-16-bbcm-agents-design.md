# BBCM Agents — Design

**Date:** 2026-10-16
**Status:** Draft for review
**Owner:** Devsense (seller) — for a small South African general-practice law firm (buyer)

## 1. Purpose

A team of AI assistants ("agents") that takes the day-to-day admin off a small law firm,
working where the firm already works: **WhatsApp**. It is a different product from
BBCM Summons (a divorce document generator) under the same family name.

Success means the firm's attorney spends less time on reception, chasing, diary and
billing admin, loses fewer enquiries and fewer billable hours, misses no deadlines — and
never has an AI say or send something on the firm's behalf that a person did not approve.

### What the buyer told us (via the seller)

- Small general practice: 1–5 attorneys, mixed matters (family, conveyancing, wills,
  debt collection, some litigation).
- Losing time and money in all four areas: new enquiries & intake, chasing clients,
  deadlines & diary, billing & getting paid.
- Staff should work with the agents **on WhatsApp**.
- Agents may message the firm's **clients** too, with attorney approval for anything
  advice-like; routine messages may be set to send automatically.
- Current tools are a mix / unknown.
- Sold as a **once-off purchase** at **R15,000–R25,000**.
- Built from **off-the-shelf tools**, with **n8n** as the agent engine.

### Assumptions (to confirm in the discovery call)

- Product name "BBCM Agents".
- The firm uses, or will adopt, Google Workspace (Microsoft 365 is a variant — §13).
- One firm per installation; every account is opened in the firm's name.

## 2. Scope

**Version 1 — five agents:** Reception, Client updates, Deadlines, Billing, Morning brief.

**Later, sold as add-ons:** Drafting (letters of demand, wills, NDAs), Collections,
Conveyancing tracker, POPIA/FICA compliance assistant, practice-software connectors.

**Out of scope for v1:** trust accounting, making or receiving payments, court e-filing
(CaseLines/Court Online), voice calls, any integration with practice-management software.

## 3. Building blocks

| Piece | Tool | Role |
|---|---|---|
| Messaging | **WhatsApp Business Platform (Meta Cloud API)**, connected directly through n8n's WhatsApp Business Cloud node — no reseller fee | Clients and staff talk to the agents; approvals are tap buttons |
| Agent engine | **n8n Cloud** (Starter plan; can move to self-hosted later) | Each agent is one or more workflows; AI steps; pauses for approvals |
| AI | **Claude** (Anthropic API) via n8n's Anthropic node, with a monthly **spend limit** on the key | Reads messages and documents, drafts, extracts dates and facts |
| Records | **Google Sheets** (one workbook = the firm's register), **Google Calendar** (diary), **Google Drive** (one folder per matter) | Source of truth the attorney can read and correct without new software |
| Billing | The firm's accounting package (Sage, Xero or QuickBooks) via n8n; or an Invoices tab + Google Docs template if they have none | Agents draft; the accounting package stays the record |

All accounts are opened **in the firm's name**. The firm pays providers directly; the
seller is paid once for setup.

**One front door.** A WhatsApp app delivers every inbound message to a single webhook, so
exactly one n8n workflow — the **Inbound router** — receives WhatsApp. It hands each message
on: approval button taps and attorney replies to the approval workflow, messages from known
client numbers to Client updates, and everything else to Reception. Agents never listen to
WhatsApp directly.

## 4. The firm's register (Google Sheets workbook)

| Tab | Columns |
|---|---|
| **Matters** | MatterID, Client name, Client WhatsApp, Client email, Matter type, Opposing party, Stage, Responsible attorney, Outstanding items (comma list), Reminders sent, Next step, Last client update, Drive folder link, Opened, Status (open/closed) |
| **Enquiries** | Received at, Name, WhatsApp, Matter type, Summary, Conflict result, Consultation slot, Status |
| **Deadlines** | DeadlineID, MatterID, Description, Trigger date, Rule, Computed due date, Confirmed (Y/N), Calendar event ID |
| **Time** | Date, MatterID, Activity, Suggested minutes, Confirmed minutes, Billed (Y/N) |
| **Invoices** | Invoice no., MatterID, Amount (R), Issued, Due, Status, Reminders sent |
| **Approvals** | ApprovalID, Agent, MatterID, Recipient, Draft text, Status (pending/editing/approved/edited/rejected/expired), Edit until, Decided at, Decided by, Resume URL |
| **Log** | Timestamp, Agent, MatterID, Action, Detail — every message sent and every record changed |
| **Settings** | Key/value rows: Firm name, attorney WhatsApp numbers, office hours, consultation slot rules, extra public holidays (statutory SA holidays are computed; list only ad hoc declared days such as election days), auto-send switches per message type, opted-out numbers |

Google Sheets suits a 1–5 attorney firm. If volume outgrows it (API rate limits or
concurrent edits), the upgrade path is Airtable or a Postgres database behind the same
workflows.

## 5. How approval works (shared by every agent)

1. The agent writes its draft to **Approvals** (status `pending`) and pauses on an n8n
   **Wait** node set to resume by webhook; the resume URL is stored in the row.
2. The responsible attorney receives a WhatsApp interactive message: the draft, who it is
   for, and three reply buttons — **Approve / Edit / Reject** (WhatsApp allows up to three).
3. A shared **"Approval replies"** workflow receives the tap, looks up the ApprovalID from
   the button payload, records the decision, and calls the stored resume URL.
   - **Approve** → the paused workflow sends the draft as is.
   - **Edit** → the agent replies "Send the corrected text for approval <ApprovalID>"; the
     attorney's next text message within 30 minutes replaces the draft and is sent. If none
     arrives in 30 minutes, the approval returns to `pending` and the buttons are re-sent.
     Only one approval per attorney can be in edit mode at a time.
   - **Reject** → nothing is sent; the item is logged.
4. **Expiry:** unanswered after 24 hours → status `expired`, nothing is sent, and the item
   reappears in the next Morning brief.

Routine message types listed in **Settings** (booking confirmations, document reminders,
payment reminders) can be switched to auto-send. Everything else always waits.

## 6. The agents

### 6.1 Reception

- **Trigger:** inbound WhatsApp from a number not in Matters, any hour.
- **Steps:** greet (stating it is the firm's digital assistant) in the client's language →
  identify matter type → collect name, contact and a short description → conflict check
  (opposing party and client names against Matters) → offer free slots from Calendar per
  Settings rules → book → send the FICA document checklist and directions → write to
  Enquiries and Log.
- **Waits for approval:** any conflict hit, fee questions, anything advice-like.
- **Never:** gives legal advice, quotes fees, or accepts a mandate.

### 6.2 Client updates

- **Triggers:** Stage change in Matters; every 3 days while Outstanding items is non-empty;
  inbound photo/PDF from a known client number.
- **Steps:** request outstanding items politely → save inbound files to the matter's Drive
  folder and remove the item from Outstanding items → answer "where is my matter?" from
  Stage and Next step → send a short update when Stage changes → update Last client update.
- **Waits for approval:** the first update of each kind per matter type, and anything
  non-routine; reminders may auto-send once switched on.
- **Stops chasing** after 4 reminders and flags the matter to the attorney instead.

### 6.3 Deadlines

- **Triggers:** new file in a matter's Drive folder; the attorney WhatsApps a note
  (e.g. "summons served 3 Oct, matter 2026-014"); daily scan of open matters.
- **Steps:** extract the trigger event and date → apply the rule (court days exclude
  Saturdays, Sundays and public holidays from Settings; e.g. 10 court days for notice of
  intention to defend; 3-year prescription under the Prescription Act 68 of 1969) →
  write to Deadlines with Confirmed = N → ask the attorney to confirm → on confirmation,
  create the Calendar event with reminders 7, 3 and 1 days before.
- **Waits for approval:** **every** computed deadline, without exception.
- **Never:** deletes or moves an existing Calendar event.
- The date rules live in one n8n Code node with a fixed set of test cases (§10).

### 6.4 Billing

- **Triggers:** 17:30 each working day; the last working day of the month; invoice due
  date passed.
- **Steps:** collect the day's logged actions per matter → propose time entries
  (Suggested minutes) → attorney confirms or edits them as one batch → at month-end draft
  fee notes for confirmed, unbilled time in the accounting package (or the Invoices
  template) → after approval, send to the client → payment reminders at 7, 14 and 30 days
  overdue.
- **Waits for approval:** every time batch and every fee note; reminders may auto-send.
- **Never:** moves money, records payments, or touches the trust account.

### 6.5 Morning brief

- **Trigger:** 07:30 on working days.
- **Sends** one WhatsApp per attorney: today's appointments, deadlines in the next 7 days,
  approvals waiting, new enquiries since yesterday, total overdue invoices.
- Sent as a pre-approved **utility template**, because it starts the conversation.

## 7. Rules every agent follows

- Tells every client it is the firm's digital assistant.
- Never gives legal advice, quotes fees or makes commitments without approval.
- Only messages people who contacted the firm or are its clients; "STOP" opts a number out
  (recorded in Settings).
- Sends the AI only what the task needs; ID numbers are not sent to the AI unless the task
  is reading that document.
- Logs every message and record change to **Log**.
- On any failure (tool down, AI error, unreadable document) it does nothing externally
  and notifies the responsible attorney instead.

## 8. WhatsApp rules that shape the design

- Free-form replies are allowed within 24 hours of the other person's last message.
  Outside that window, messages the firm starts must use **pre-approved templates**:
  document reminder, status update, appointment reminder, payment reminder, morning brief,
  approval request. These are registered with Meta during setup.
- Interactive buttons: maximum three per message (hence Approve / Edit / Reject).
- **Number choice:** a number moved onto the Business Platform can no longer be used in the
  ordinary WhatsApp Business app. Decide in discovery whether to use a new number or move
  the firm's existing one.

## 9. POPIA

- The firm is the responsible party; each provider is an operator. Sign each provider's
  data-processing terms during setup (s21).
- Personal information is processed outside South Africa by these providers; rely on their
  binding agreements (s72) and say so in the firm's privacy notice.
- Add one line to the firm's privacy notice / PAIA manual: a digital assistant handles
  WhatsApp messages and every message is reviewed or logged.
- Least data: the Sheet holds only what agents need; documents stay in Drive.

## 10. Testing and go-live

- **Sandbox first:** a copy of the workbook and Calendar, and Meta's test WhatsApp number,
  with the seller's phone playing both client and attorney.
- **Per-agent checklist** before switching it on for real:
  - Reception: new enquiry → booking; conflict hit → approval; advice question → approval.
  - Client updates: reminder cadence; file saved to the right folder; stops after 4.
  - Deadlines: the date-rule test cases pass — weekends, public holidays, a deadline
    crossing year end, and prescription; nothing enters the Calendar unconfirmed.
  - Billing: batch confirm; fee note matches confirmed time; no reminder before the due date.
  - Approvals: approve, edit, reject and 24-hour expiry each behave as in §5.
  - Failure: AI step forced to fail → attorney notified, nothing sent.
- **Go-live:** one agent at a time, each in "approve everything" mode for its first week.

## 11. Costs, savings and price

*Estimates. Confirm current provider prices at setup; replace the savings figures with the
firm's real numbers from discovery.*

**Running costs (paid by the firm to providers), 2 attorneys + 1 secretary:** n8n ~R500,
WhatsApp ~R300–R800, Claude ~R200–R500, Google Workspace ~R130 per user if not already
used — about **R1,000–R2,000 per month**.

**Illustrative monthly savings:** reception ~20 h, client chasing ~15 h, diary ~8 h,
billing admin ~6 h, plus ~5 h of recovered billable time per attorney (~R12,000 at
R1,200/h) — roughly **R15,000–R30,000 per month**.

**Price:** once-off **R15,000–R25,000**, a fixed package: accounts set up in the firm's
name, matters imported from Excel, five agents configured, POPIA paperwork, one staff
training session, 14 days of support. **Optional later:** add-on agents (~R5,000 each),
support retainer, retraining.

**Pitch:** "For a once-off R20,000, your firm gets a receptionist, a client-follow-up
clerk, a diary keeper and a billing assistant on WhatsApp, 24/7, for about R1,500 a month
in running costs — it pays for itself in about six weeks."
(At the illustrative figures — R17,345 value against R1,500 running costs — R20,000 is
recovered in 1.3 months; R15,000 in under one month.)

## 12. Rollout (about 2–3 weeks per firm)

1. Discovery call (1 hour): matter types, staff, tools, real numbers, WhatsApp number choice.
2. Day 1: start Meta business verification; open n8n, Google Workspace and the Anthropic
   key (with spend limit) in the firm's name.
3. POPIA paperwork and privacy-notice line.
4. Import matters; create Drive folders; fill Settings.
5. Week 1: Morning brief + Reception. Week 2: Client updates + Deadlines. Week 3: Billing.
6. One-hour staff training and a one-page guide; written handover of all accounts.

## 13. Risks

| Risk | Guard |
|---|---|
| Meta verification takes weeks | Start day 1; email reminders until WhatsApp is live |
| Wrong deadline | Attorney confirms every date; tested rules; reminders 7/3/1 days; no deletions |
| AI says something it shouldn't | Approval for anything advice-like; disclosure; full log |
| Template rejected by Meta | Plain utility wording; register early; have a fallback wording |
| Tool outage or price rise | Firm-owned accounts; Sheet is the source of truth; fail safe to "notify attorney" |
| Google Sheets limits | Fine at 1–5 attorneys; upgrade path to Airtable/Postgres |
| Firm on Microsoft 365, not Google | Swap to Excel Online + Outlook Calendar + OneDrive nodes; same design |
| Dependence on the seller | Firm owns every account; written handover guide |

## 14. Open questions for discovery

1. Product name — "BBCM Agents"?
2. Google Workspace or Microsoft 365?
3. Accounting package, if any?
4. New WhatsApp number, or move the existing one (§8)?
5. Which message types should auto-send from day one?
6. Hourly rates and staff costs for the savings sheet.
