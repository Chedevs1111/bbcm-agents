# BBCM Agents — Setup guide

For the person installing BBCM Agents for a firm. Allow **2–3 weeks**, most of it waiting for
Meta to verify the business. Every account is opened **in the firm's name** and the firm pays
the providers directly; you are paid once for the setup.

**Contents:**
- [0. Discovery call](#0-discovery-call)
- [1. Day 1 — accounts](#1-day-1--accounts-in-the-firms-name)
- [2. WhatsApp templates](#2-register-the-whatsapp-templates)
- [3. The register](#3-the-register-google-sheet)
- [4. Build the workflows](#4-build-the-workflows-for-this-firm)
- [5. Credentials](#5-credentials-in-n8n)
- [6. Import the workflows](#6-import-the-workflows)
- [7. Sandbox test](#7-sandbox-test)
- [8. Go-live](#8-go-live)
- [9. Deadlines](#9-deadlines-what-v1-does-and-the-festive-period-question)
- [10. POPIA](#10-popia-checklist)
- [11. Handover](#11-handover-checklist)
- [12. What v1 does not do yet](#12-what-v1-does-not-do-yet)

---

## 0. Discovery call

One hour with the firm. Settle:

- [ ] **Google Workspace or Microsoft 365?** v1 is built for Google (Sheets, Calendar, Drive).
  Microsoft 365 is the same design with the Excel Online, Outlook Calendar and OneDrive nodes,
  but it is not included here.
- [ ] **WhatsApp number.** A number moved onto the WhatsApp Business Platform **can no longer be
  used in the ordinary WhatsApp Business app**. Use a new number, or move the existing one
  knowing the staff will lose the app on it.
- [ ] **Which messages may send without approval** from day one. Recommended: none for the first
  week of each agent.
- [ ] **Hourly rate and staff costs** — put them into the [savings calculator](https://chedevs1111.github.io/bbcm-agents/).
- [ ] **The festive period** for each deadline rule (see §9).
- [ ] **Accounting package**, if any. v1 drafts fee notes in the register's Invoices tab; the
  firm copies them into its accounting package.

## 1. Day 1 — accounts in the firm's name

| Account | What it is for | Notes |
|---|---|---|
| **Meta Business** (business.facebook.com) | Owns the WhatsApp number | **Start business verification on day 1** — it can take weeks. |
| **WhatsApp Business Platform** (Cloud API) | Sends and receives WhatsApp | Create a Meta app (type *Business*), add the *WhatsApp* product and the firm's number. Create a **System User** with a **permanent token** that has `whatsapp_business_messaging` and `whatsapp_business_management`. Note the **phone number ID**, the **app ID** and the **app secret**. |
| **n8n Cloud** (Starter plan) | Runs the agents | Set the instance timezone to Africa/Johannesburg. Can move to self-hosted later. |
| **Google Workspace** | Register (Sheets), diary (Calendar), files (Drive) | Use the firm's existing account if it has one. |
| **Anthropic API** (console.anthropic.com) | The AI that reads messages and drafts replies | Create an API key and **set a monthly spend limit** (about R500 is plenty for a small practice). |

## 2. Register the WhatsApp templates

Messages the firm starts outside WhatsApp's 24-hour reply window must use templates approved
by Meta. Register all seven from [`whatsapp/templates.json`](../whatsapp/templates.json) in
WhatsApp Manager → *Message templates*. Use category **Utility** and language **English (en)**,
and copy the body text and the example values exactly.

| Template | Sent to | When |
|---|---|---|
| `document_reminder` | Client | Chasing outstanding documents |
| `status_update` | Client | Matter updates; fee note issued |
| `appointment_reminder` | Client | Before a consultation |
| `payment_reminder` | Client | 7, 14 and 30 days after an invoice is due |
| `morning_brief` | Attorneys | 07:30 on weekdays |
| `approval_request` | Attorneys | Every draft that needs approval — three quick-reply buttons: **Approve**, **Edit**, **Reject** |
| `system_alert` | Attorneys | When a workflow fails (nothing is sent to anyone else) |

Approval is usually quick for plain utility wording. If one is rejected, simplify the wording
and keep the same name and number of `{{n}}` variables.

## 3. The register (Google Sheet)

1. Create a Google Sheet named **BBCM Register** in the firm's Google account.
2. Import each file in [`register/`](../register) as its own tab, named exactly as the file:
   **Matters, Enquiries, Deadlines, Time, Invoices, Approvals, Log, Settings**
   (*File → Import → Upload → Insert new sheet(s)*, then rename the tab). Do not rename columns.
3. Copy the **Sheet ID** from its address — the long part between `/d/` and `/edit`.
4. Fill **Settings**:

| Key | What to enter | Example |
|---|---|---|
| Firm name | As it should appear in messages | `Example Attorneys Inc.` |
| Attorney WhatsApp numbers | `Name=number` pairs separated by `;`, numbers in international format. **The first attorney receives the approvals** (a `deadline:` note is confirmed by whoever sent it). Everyone listed gets the Morning brief and failure alerts. | `Sarah=27XXXXXXXXX; John=27XXXXXXXXX` |
| Office hours | For the firm's reference | `Mon–Fri 08:00–17:00` |
| Consultation slot rules | Start times for 1-hour consultations offered by Reception (weekdays) | `09:00, 11:00, 14:00` |
| Extra public holidays | Only days declared ad hoc (e.g. an election day), `YYYY-MM-DD` separated by `;`. Statutory SA public holidays are already computed. | `2029-05-08` |
| Auto-send booking confirmations | `Yes` or `No` | `No` |
| Auto-send document reminders | `Yes` or `No` — also covers routine client receipts such as "document received" | `No` |
| Auto-send payment reminders | `Yes` or `No` | `No` |
| Opted-out numbers | Filled in automatically when someone replies STOP | *(leave empty)* |
| WhatsApp phone number ID | From WhatsApp Manager (step 1) | `1234567890` |
| Hourly rate (R) | Used for fee notes | `1500` |

5. **Import the firm's matters** into **Matters**, one row per open matter. Use:
   - client WhatsApp numbers in international format;
   - **Outstanding items** as a comma-separated list;
   - **Status** `open` or `closed`;
   - **Reminders sent** `0`.
6. Create **one Google Drive folder per matter** and paste its link into **Drive folder link** —
   documents clients send are saved there.

Formats the agents expect elsewhere: dates as `YYYY-MM-DD`; **Amount** in rand as a plain number
(`4500.00`); Invoice **Status** `draft` → `issued` (by the agents) → `paid` (by the firm, by hand —
the agents never record payments).

## 4. Build the workflows for this firm

You need Node 22 or later. In this folder:

```bash
npm install
```

Point every Google Sheets step (63 of them) at the firm's register by building with its Sheet ID:

```bash
BBCM_SHEET_ID=paste-the-sheet-id-here npm run build
```

Then check everything:

```bash
npm test
```

```bash
npm run check:n8n
```

Before building, check that `GRAPH_API_VERSION` in [`scripts/lib/n8n.mjs`](../scripts/lib/n8n.mjs)
is a version Meta still supports (Meta retires Graph API versions about two years after
release). If you change it, build again.

> The built files now contain the firm's Sheet ID. Import them into n8n, then run
> `npm run build` (without the variable) before committing anything back to this repository.

## 5. Credentials in n8n

Create these in n8n (*Credentials → Add credential*) with **exactly these names** — the
workflows refer to them by name:

| Name | n8n credential type | What to enter |
|---|---|---|
| **BBCM Google** | Google Sheets OAuth2 API | Sign in with the firm's Google account |
| **BBCM Google** | Google Calendar OAuth2 API | Same account (same name, different type) |
| **BBCM Google** | Google Drive OAuth2 API | Same account |
| **BBCM WhatsApp** | Header Auth | Name `Authorization`, Value `Bearer <permanent token>` |
| **BBCM WhatsApp App** | WhatsApp OAuth API | Client ID = Meta **app ID**, Client Secret = **app secret** (used only by the Inbound router's trigger) |
| **BBCM Anthropic** | Header Auth | Name `x-api-key`, Value `<Anthropic API key>` |

## 6. Import the workflows

Import the files in [`workflows/`](../workflows) (*Workflows → Import from file*) **in this
order**, so each one exists before something calls it:

| # | Workflow | Runs | Does |
|---|---|---|---|
| 1 | Error alert | When any workflow fails | Alerts the attorneys with `system_alert`; nothing is sent to clients |
| 2 | Request approval | Called by the agents | Records the draft, asks the attorney (Approve / Edit / Reject), waits up to 24 h |
| 3 | Approval replies | Called by the Inbound router | Records the decision; Edit opens a 30-minute window for the corrected text |
| 4 | Edit timeouts | Every 10 minutes | Returns unanswered edits to *pending* and re-asks |
| 5 | Reception | Called by the Inbound router | Answers new enquiries, conflict check, offers 3 consultation slots, books one |
| 6 | Client updates | Called by the Inbound router | Answers clients, saves documents they send to the matter folder |
| 7 | Document reminders | 09:00 weekdays | Chases outstanding documents every 3 days, stops after 4 |
| 8 | Deadlines | Called by the Inbound router | Turns an attorney's note into a confirmed diary entry |
| 9 | Billing time | 17:30 weekdays | Suggests the day's time per matter for one-tap confirmation |
| 10 | Billing month end | 18:00 daily, acts on the last working day | Drafts fee notes from confirmed time |
| 11 | Billing reminders | 08:00 daily | Payment reminders 7, 14 and 30 days after the due date |
| 12 | Morning brief | 07:30 weekdays | One summary per attorney |
| 13 | Inbound router | Every WhatsApp message | The single front door, in this order: STOP, attorneys' `deadline:` notes, approval replies, clients, new enquiries |

After importing:

- [ ] **Re-link the 11 "Execute Workflow" steps.** Open each one and pick the workflow named in it
  from the list:
  - **Ask for approval → Request approval:** Reception, Client updates, Document reminders,
    Deadlines, Billing time, Billing month end, Billing reminders.
  - **Inbound router:** *To Approval replies*, *To Reception*, *To Client updates*, *To Deadlines*.
- [ ] **Credentials:** open any step showing a credential warning and pick the matching name from §5.
- [ ] **Error workflow:** in each of workflows 2–13, open *Settings → Error workflow* and choose
  **Error alert**.
- [ ] **Diary:** Reception, Deadlines and Morning brief use the connected account's **primary**
  calendar. If the firm keeps its diary in another calendar, choose it in those Calendar steps.
- [ ] **Activate the Inbound router last.** Meta delivers all of an app's messages to one
  address, and this workflow registers it.

## 7. Sandbox test

Test with a **copy** of the register and a test calendar, and Meta's **test WhatsApp number**,
your own phone playing both client and attorney (list it as the attorney in Settings).

- [ ] **Reception:**
  - a new enquiry → three slots → reply `2` → booked in the diary;
  - a name already in Matters → goes to the attorney (conflict);
  - "what should I do about…" → goes to the attorney (advice);
  - "how much do you charge" → goes to the attorney (fees).
- [ ] **Approvals:** Approve sends as is; Edit → send the corrected text within 30 minutes → the
  corrected text is sent; no text in 30 minutes → buttons re-sent; Reject sends nothing; no
  answer in 24 hours → *expired*, nothing sent, listed in the next Morning brief.
- [ ] **Client updates / Document reminders:** the reminder goes out 3 days after the last
  update; a photo from the client lands in the matter's Drive folder; chasing stops after 4
  reminders and the matter appears as *not responding* in the Morning brief.
- [ ] **Deadlines:** send `deadline: summons served 3 Oct, matter <number>` → the computed date
  waits for approval → only then does it appear in the diary, with reminders 7, 3 and 1 days
  before. Try a date before a weekend, before a public holiday and across year end.
- [ ] **Billing:**
  - confirm a day's time batch;
  - on a test last working day, the fee note matches the confirmed time × hourly rate;
  - no payment reminder before the due date.
- [ ] **STOP:** reply `STOP` from a client number → the number appears in *Opted-out numbers*
  and gets no further messages.
- [ ] **Failure:** use a wrong Anthropic key for one run → the attorneys receive a
  `system_alert` and nothing is sent to the client.

## 8. Go-live

Switch the register, calendar and number to the real ones, then go live **one agent at a time,
with every Auto-send switch on `No`** so the attorney approves everything for the first week:

- **Week 1:** approval loop, Error alert, Morning brief, Reception (and the Inbound router).
- **Week 2:** Client updates, Document reminders, Deadlines.
- **Week 3:** Billing time, Billing month end, Billing reminders.

Scheduled workflows start when you activate them. Reception, Client updates, Deadlines and the
approvals answer as soon as the Inbound router is active — which is why every Auto-send switch
stays on `No` at first. After a clean week, the firm may switch routine messages to `Yes` in
Settings.

## 9. Deadlines: what v1 does, and the festive-period question

An attorney sends a WhatsApp note starting with `deadline:`, for example
`deadline: summons served 3 Oct, matter 2026-014`. The agent:

1. reads the event, date and rule;
2. computes the due date;
3. asks that attorney to approve it;
4. only then adds it to the diary, with reminders 7, 3 and 1 days before.

It never moves or deletes a diary entry.

**Built-in rules** (in [`src/deadlines.mjs`](../src/deadlines.mjs)):
- notice of intention to defend — 10 court days;
- prescription of an ordinary debt — 3 years.

Any other note that says "N court days" or "N calendar days" is counted that way. Court days skip
weekends and SA public holidays, including a Sunday holiday observed on the Monday.

**Ask the firm, rule by rule:** should **16 December – 15 January** be left out of the count?
By default the count runs straight through that period. Some court rules exclude it for certain
steps; the attorney must decide which. To exclude it for a rule:
1. add `festiveDiesNon: true` to that rule in `src/deadlines.mjs`;
2. run `npm test`;
3. build again (§4);
4. re-import **Deadlines**.

The attorney confirms every date either way.

## 10. POPIA checklist

- [ ] The firm is the responsible party; each provider (Meta, n8n, Google, Anthropic) is an
  operator. Accept each provider's data-processing terms in the firm's name (s21).
- [ ] Personal information is processed outside South Africa by these providers. Record that
  the firm relies on their binding agreements (s72) and say so in the privacy notice.
- [ ] Add one line to the privacy notice / PAIA manual: *a digital assistant handles WhatsApp
  messages, and every message is reviewed by an attorney or logged.*
- [ ] Least data: the register holds only what the agents need; documents stay in Drive. ID
  numbers are not sent to the AI.

## 11. Handover checklist

- [ ] All accounts are in the firm's name, and the firm holds every login. Share the list.
- [ ] Anthropic spend limit set; WhatsApp payment method on the firm's Meta account.
- [ ] One-hour staff training:
  - approving, editing and rejecting drafts;
  - `deadline:` notes;
  - marking invoices *paid*;
  - closing matters.
- [ ] A one-page guide left with the firm, and 14 days of support agreed.
- [ ] Where to look when something goes wrong: the **Log** tab (every message and change),
  `system_alert` messages, and *Executions* in n8n.

## 12. What v1 does not do yet

- **Deadlines from documents:** creating deadlines automatically from files saved to Drive, or
  from a daily scan of new documents (v2). v1 works from the attorney's `deadline:` note.
- **Accounting packages:** posting fee notes into Sage, Xero or QuickBooks. v1 drafts them in
  the Invoices tab.
- **Out of scope:**
  - trust accounting, making or receiving payments;
  - court e-filing;
  - voice calls;
  - practice-management software.
- **Add-ons:** Drafting, Collections, Conveyancing tracker, POPIA/FICA assistant.
