# BBCM Agents

**WhatsApp assistants that take the day-to-day admin off a small South African law firm —
and never send anything a person did not approve.**

**[Open the savings calculator →](https://chedevs1111.github.io/bbcm-agents/)**

---

## The problem

A small general practice (1–5 attorneys; family, conveyancing, wills, debt collection, some
litigation) loses time and money in four places:

- **New enquiries:** calls and messages go unanswered after hours, so clients go elsewhere.
- **Chasing clients:** for documents and answers, again and again.
- **Deadlines and the diary:** counted by hand, with weekends and public holidays to get right.
- **Billing:** time that is never recorded, fee notes that go out late, and invoices nobody
  follows up.

## The five agents

They work where the firm already works: **WhatsApp**.

| Agent | What it does | Waits for the attorney |
|---|---|---|
| **Reception** | Answers new enquiries 24/7 and says it is the firm's digital assistant. Checks for conflicts, offers three consultation slots from the diary and books the one chosen. | Every conflict, legal question and fee question; bookings unless switched to auto-send |
| **Client updates** | Answers existing clients and files the documents they send into the matter's Drive folder. Chases outstanding documents every 3 days, then flags clients who stop responding after 4 reminders. | Every answer about the matter; routine receipts and reminders unless switched to auto-send |
| **Deadlines** | Turns an attorney's WhatsApp note (`deadline: summons served 3 Oct, matter 2026-014`) into a computed due date, counting court days around weekends and SA public holidays. | **Every** deadline — nothing enters the diary unconfirmed. Diary reminders follow 7, 3 and 1 days before. |
| **Billing** | Suggests each day's time per matter, drafts month-end fee notes from confirmed time, and sends payment reminders 7, 14 and 30 days overdue. | Every time batch and fee note; reminders unless switched to auto-send |
| **Morning brief** | At 07:30 each attorney gets today's diary, deadlines in the next 7 days, approvals waiting, new enquiries, clients not responding and the total overdue. | — |

## How approval works

1. The agent drafts the message and sends it to the attorney with three buttons:
   **Approve · Edit · Reject**.
2. **Approve** sends it as is. **Edit** lets the attorney type the corrected text (within 30
   minutes). **Reject** sends nothing.
3. Unanswered after 24 hours, the draft expires — nothing is sent — and it reappears in the
   next Morning brief.

Routine messages (booking confirmations, document receipts and reminders, payment reminders)
can be switched to send on their own in the register. **Every switch starts off.**

## Rules every agent follows

- Tells every client it is the firm's digital assistant.
- Never gives legal advice, quotes fees or makes commitments without the attorney.
- A client who replies **STOP** is never messaged again.
- Every message and change is logged in the register.
- If anything fails, nothing goes out to anyone except an alert to the attorneys.
- Never moves money, records payments, touches the trust account, or deletes a diary entry.

## What it costs

| | |
|---|---|
| **Once-off package** | **R15 000 – R25 000** — accounts set up in the firm's name, matters imported, five agents configured, POPIA paperwork, staff training, 14 days of support |
| **Running costs** | About **R1 000 – R2 000 a month**, paid by the firm directly to the providers (automation server, WhatsApp, AI, Google Workspace) |
| **Illustrative value** | About **R17 345 a month** in staff time saved and billable time recovered (2 attorneys, 1 secretary) — at R20 000 the package pays for itself in **1.3 months** |

*These figures are estimates. Use the [calculator](https://chedevs1111.github.io/bbcm-agents/)
with the firm's own numbers.*

## Built from tools the firm owns

- **n8n** runs the agents.
- The **WhatsApp Business Platform** carries the messages.
- **Google Sheets** is the firm's register, **Google Calendar** its diary and **Google Drive**
  its files.
- An **AI model** reads messages and drafts replies.

Every account is opened in the firm's name, so there is no lock-in to the installer.
**The agents run only once the firm's own accounts are set up** — this repository is the
install-ready package, not a hosted service.

## What's in this repository

```
workflows/            13 import-ready n8n workflows (generated — do not edit by hand)
register/             the 8 tabs of the firm's Google Sheet register
whatsapp/             the 7 WhatsApp message templates to register with Meta
src/deadlines.mjs     SA court-day, calendar-day and prescription maths
scripts/              the workflow builders and the n8n validator
docs/SETUP.md         install, test, go-live and handover guide
docs/index.html       the savings calculator
test/                 automated tests
```

The deadline maths in the n8n workflow is **the same code** the tests check, copied in byte
for byte at build time. The tests cover:

- weekends, public holidays and Sunday holidays observed on the Monday;
- Easter, year end and 29 February;
- that every client message passes an approval or auto-send gate;
- that every WhatsApp message is logged.

Every node is also validated against the real n8n node definitions.

## Installing

See **[docs/SETUP.md](docs/SETUP.md)**. In short:

```bash
npm install
```

```bash
npm test
```

```bash
npm run check:n8n
```

```bash
BBCM_SHEET_ID=the-firms-sheet-id npm run build
```

Then import `workflows/*.json` into the firm's n8n in the order given in SETUP.md.
