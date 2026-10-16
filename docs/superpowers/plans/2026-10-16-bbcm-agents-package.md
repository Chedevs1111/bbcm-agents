# BBCM Agents Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shareable, install-ready BBCM Agents package — n8n workflows for the five agents plus the approval loop, the Google Sheets register, the WhatsApp templates, the SA deadline maths, a savings calculator and the setup guide — verified and published on GitHub.

**Architecture:** Workflows are *generated* by small Node builder scripts (`scripts/`) into import-ready `workflows/*.json`, so the deadline code that is unit-tested is byte-for-byte the code inside the n8n Code node. Every generated node is checked against the real n8n node definitions (`n8n-nodes-base@2.43.5`). WhatsApp and Claude are called with n8n's HTTP Request node against their documented APIs; Google uses n8n's native nodes.

**Tech Stack:** Node ≥ 22 (`node --test`, ES modules, no runtime dependencies), n8n 2.43 node types, WhatsApp Business Platform (Cloud API), Anthropic Messages API, Google Sheets / Calendar / Drive, plain HTML for the calculator, GitHub + GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-16-bbcm-agents-design.md`

## Global Constraints

- Node ≥ 22; zero runtime dependencies; the only devDependency is `n8n-nodes-base@2.43.5` (exact).
- No secrets, account IDs, phone numbers or real client data in the repo. Credentials are referenced **by name only**: `BBCM Google` (Google OAuth), `BBCM WhatsApp` (HTTP Header Auth, `Authorization: Bearer …`), `BBCM Anthropic` (HTTP Header Auth, `x-api-key`).
- Claude: `POST https://api.anthropic.com/v1/messages`, header `anthropic-version: 2023-06-01`, model `claude-sonnet-5-5`, defined once in `scripts/lib/n8n.mjs`.
- WhatsApp: `POST https://graph.facebook.com/{GRAPH_API_VERSION}/{{PHONE_NUMBER_ID}}/messages`; `GRAPH_API_VERSION = 'v24.0'` defined once; SETUP.md tells the installer to check the current version.
- Timezone `Africa/Johannesburg` in every workflow's settings.
- Times and counts, verbatim from the spec: Morning brief 07:30 Mon–Fri · Billing 17:30 working days · approval expiry 24 h · edit window 30 min · client chase every 3 days, stop after 4 · payment reminders 7/14/30 days overdue · calendar reminders 7/3/1 days before.
- Sheet tab and column names exactly as spec §4 (including `Reminders sent`, `Edit until`).
- Approval buttons exactly `Approve` / `Edit` / `Reject`.
- Template names: `document_reminder`, `status_update`, `appointment_reminder`, `payment_reminder`, `morning_brief`, `approval_request`; language `en`; category `UTILITY`.
- Every client-facing message states it comes from the firm's digital assistant; `STOP` opts out.
- User preference: **stage, don't commit** after each task. One commit at publish (Task 9), which the user requested.

## Review Focus

1. **A trigger or deadline landing on a weekend, a public holiday, or a Sunday holiday observed on Monday** → the count must skip it, never land on it. Pinned in Task 1.
2. **A deadline across the 16 Dec–15 Jan festive period** → counts straight through by default; skips the period only when the rule sets `festiveDiesNon`. The attorney confirms either way. Pinned in Task 1; SETUP.md asks the firm which rules need it.
3. **29 February plus three years, and month-end dates** → 28 February, never an invalid date. Pinned in Task 1.
4. **A message to a client that bypasses approval** → impossible: every client-send node's only input is an `Approved?` or `Auto-send on?` gate. Pinned in Task 5 for all workflows.
5. **Running costs at or above the value delivered** → the calculator shows "does not pay back", never a negative or infinite payback. Pinned in Task 8.

---

## File Structure

```
package.json                 scripts: test, build, check:n8n
README.md                    what it is, what's in the box, the pitch
docs/index.html              savings calculator (GitHub Pages root)
docs/savings.mjs             savings + payback maths (pure)
docs/SETUP.md                install, go-live and handover guide
src/deadlines.mjs            SA court-day / calendar-day / year maths (pure)
register/*.csv               one CSV per Sheet tab (8)
whatsapp/templates.json      the six Meta message templates
scripts/lib/n8n.mjs          node/connection/workflow builders + shared node factories
scripts/workflows/*.mjs      one builder per workflow, each exports build()
scripts/build-workflows.mjs  runs every builder → workflows/*.json
scripts/check-n8n.mjs        validates workflows against n8n-nodes-base@2.43.5
workflows/*.json             generated, committed, import-ready
test/*.test.mjs              node --test suites
```

---

### Task 1: Project scaffold and the SA deadline maths

**Files:**
- Create: `package.json`, `.gitignore` (`node_modules/`), `src/deadlines.mjs`
- Test: `test/deadlines.test.mjs`

**Interfaces:**
- Produces (all dates are ISO `YYYY-MM-DD` strings; invalid input throws `RangeError`):
  - `holidaysFor(year: number, extra?: string[]): Set<string>` — Public Holidays Act 36 of 1994: 1 Jan, 21 Mar, Good Friday, Family Day (Easter Monday), 27 Apr, 1 May, 16 Jun, 9 Aug, 24 Sep, 16 Dec, 25 Dec, 26 Dec; a holiday on a Sunday adds the following Monday; plus `extra`.
  - `isCourtDay(iso: string, extra?: string[]): boolean` — not Saturday, Sunday or holiday.
  - `addCourtDays(iso: string, n: number, opts?: { extra?: string[], festiveDiesNon?: boolean }): string` — first day excluded; counts only court days; with `festiveDiesNon`, 16 Dec–15 Jan inclusive are not counted.
  - `addCalendarDays(iso: string, n: number, extra?: string[]): string` — Interpretation Act s4: if the last day is a Sunday or public holiday, move to the next day that is neither.
  - `addYears(iso: string, n: number): string` — 29 Feb → 28 Feb when the target year is not a leap year.
  - `RULES: Record<string, { type: 'court_days' | 'calendar_days' | 'years', n: number, festiveDiesNon?: boolean, label: string }>` with exactly `notice_of_intention_to_defend` (`court_days`, 10) and `prescription_debt` (`years`, 3).
  - `computeDeadline(rule: { type, n, festiveDiesNon? }, triggerIso: string, extra?: string[]): string`
  - The module must contain no `import` statements (it is inlined into an n8n Code node in Task 7).

- [ ] **Step 1: Scaffold.** `package.json`: `"type": "module"`, `"engines": { "node": ">=22" }`, scripts `"test": "node --test"`, `"build": "node scripts/build-workflows.mjs"`, `"check:n8n": "node scripts/check-n8n.mjs"`; devDependency `"n8n-nodes-base": "2.43.5"`. Run `npm install`.

- [ ] **Step 2: Write the failing tests** in `test/deadlines.test.mjs`:

```js
assert.ok(holidaysFor(2026).has('2026-04-03'));            // Good Friday
assert.ok(holidaysFor(2026).has('2026-04-06'));            // Family Day
assert.ok(holidaysFor(2026).has('2026-08-10'));            // 9 Aug is a Sunday → Monday
assert.ok(!holidaysFor(2026).has('2026-03-23'));           // 21 Mar is a Saturday → no Monday
assert.ok(holidaysFor(2026, ['2026-11-04']).has('2026-11-04'));
assert.equal(addCourtDays('2026-10-16', 10), '2026-10-30'); // plain fortnight
assert.equal(addCourtDays('2026-04-01', 3), '2026-04-08');  // skips Easter
assert.equal(addCourtDays('2026-12-30', 3), '2027-01-05');  // crosses New Year's Day
assert.equal(addCourtDays('2026-10-17', 1), '2026-10-19');  // Saturday trigger
assert.equal(addCourtDays('2026-12-14', 3, { festiveDiesNon: true }), '2027-01-19');
assert.equal(addCalendarDays('2026-08-05', 4), '2026-08-11'); // Sun 9th & Mon 10th
assert.equal(addYears('2028-02-29', 3), '2031-02-28');
assert.equal(addYears('2026-10-16', 3), '2029-10-16');
assert.equal(computeDeadline(RULES.notice_of_intention_to_defend, '2026-10-16'), '2026-10-30');
assert.throws(() => addCourtDays('2026-13-01', 1), RangeError);
assert.throws(() => addCourtDays('2026-10-16', 0), RangeError);
assert.throws(() => addCourtDays('2026-10-16', 1.5), RangeError);
assert.doesNotMatch(readFileSync('src/deadlines.mjs', 'utf8'), /^import /m);
```

- [ ] **Step 3: Run** `npm test` — expect failures (module missing).
- [ ] **Step 4: Implement** `src/deadlines.mjs`. Easter by the anonymous Gregorian (Meeus/Jones/Butcher) algorithm. Do date arithmetic in UTC (`Date.UTC`) so no timezone shifts a day.
- [ ] **Step 5: Run** `npm test` — all deadline tests pass.
- [ ] **Step 6: Stage** `git add package.json package-lock.json .gitignore src test`.

---

### Task 2: The Sheets register

**Files:**
- Create: `register/Matters.csv`, `Enquiries.csv`, `Deadlines.csv`, `Time.csv`, `Invoices.csv`, `Approvals.csv`, `Log.csv`, `Settings.csv`
- Test: `test/register.test.mjs`

**Interfaces:**
- Produces: header rows exactly as spec §4 (comma-separated, quoted where a name contains a comma or bracket); `Settings.csv` is `Key,Value` with these keys in order: `Firm name`, `Attorney WhatsApp numbers`, `Office hours`, `Consultation slot rules`, `Extra public holidays`, `Auto-send booking confirmations`, `Auto-send document reminders`, `Auto-send payment reminders`, `Opted-out numbers`. Auto-send values default to `No`.
- Later tasks read and write these exact column names.

- [ ] **Step 1: Write the failing test.** For each tab, parse line 1 and `assert.deepEqual` it with the spec §4 column array (inline in the test). For Settings, assert the key column equals the list above and every `Auto-send …` value is `No`. Assert no CSV has data rows except Settings.
- [ ] **Step 2: Run** `npm test` — expect failures.
- [ ] **Step 3: Create** the eight CSV files.
- [ ] **Step 4: Run** `npm test` — pass.
- [ ] **Step 5: Stage** `git add register test/register.test.mjs`.

---

### Task 3: WhatsApp message templates

**Files:**
- Create: `whatsapp/templates.json`
- Test: `test/templates.test.mjs`

**Interfaces:**
- Produces: an array of six objects in Meta's message-template shape: `{ name, language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text, example: { body_text: [[...]] } }, ...] }`. `approval_request` adds `{ type: 'BUTTONS', buttons: [{type:'QUICK_REPLY',text:'Approve'},{type:'QUICK_REPLY',text:'Edit'},{type:'QUICK_REPLY',text:'Reject'}] }`.
- Exact bodies (variables in order):
  - `document_reminder`: `Hello {{1}}, this is the digital assistant of {{2}}. To keep your matter moving we still need: {{3}}. You can reply here with a photo or PDF. Reply STOP to stop these reminders.`
  - `status_update`: `Hello {{1}}, this is the digital assistant of {{2}} with an update on your matter: {{3}}. Next step: {{4}}. Reply here if you have any questions.`
  - `appointment_reminder`: `Hello {{1}}, this is the digital assistant of {{2}}. A reminder of your consultation on {{3}} at {{4}}. Please bring your ID. Reply here to change the time.`
  - `payment_reminder`: `Hello {{1}}, this is the digital assistant of {{2}}. Invoice {{3}} for R{{4}} was due on {{5}}. If you have already paid, please reply and we will update our records.`
  - `morning_brief`: `Good morning {{1}}. Today: {{2}}. Deadlines in the next 7 days: {{3}}. Approvals waiting: {{4}}. New enquiries: {{5}}. Overdue invoices: R{{6}}.`
  - `approval_request`: `Approval needed. {{1}} wants to send this to {{2}}: "{{3}}"`
- Task 5 sends the approval button payload as `<ApprovalID>|approve`, `|edit`, `|reject`.

- [ ] **Step 1: Write the failing test.** For every template, assert:
  - the name matches `/^[a-z0-9_]+$/` and the category is `UTILITY`
  - the body is ≤ 1024 characters and neither starts nor ends with a `{{n}}`
  - the variables are exactly `1..k` in order, and `example.body_text[0].length === k`
  - no example value contains `\n`
  - the six names equal the Global Constraints list
  - `approval_request` has exactly the three quick-reply buttons
  - every body except `morning_brief` and `approval_request` (which go to staff) contains `digital assistant`
- [ ] **Step 2: Run** — fail. **Step 3: Create** `whatsapp/templates.json`. **Step 4: Run** — pass.
- [ ] **Step 5: Stage** `git add whatsapp test/templates.test.mjs`.

---

### Task 4: Workflow builders and the n8n validator

**Files:**
- Create: `scripts/lib/n8n.mjs`, `scripts/build-workflows.mjs`, `scripts/check-n8n.mjs`
- Test: `test/workflows.test.mjs` (grows in Tasks 5–7)

**Interfaces:**
- Produces in `scripts/lib/n8n.mjs`:
  - `T` — pinned `{ type, typeVersion }` for: `whatsAppTrigger`, `httpRequest`, `googleSheets`, `googleCalendar`, `googleDrive`, `code`, `if`, `switch`, `wait`, `scheduleTrigger`, `executeWorkflow`, `executeWorkflowTrigger`, `errorTrigger`, `respondToWebhook`, `noOp`. Versions come from Step 1.
  - `node(name: string, t: {type, typeVersion}, parameters: object): Node` — auto-positions; `credentials` entries carry `{ name }` only.
  - `connect(...names: string[]): Connections` (linear chain), `branch(from: string, outputIndex: number, to: string)`.
  - `workflow(name: string, nodes: Node[], connections: Connections): Workflow` — sets `settings.timezone = 'Africa/Johannesburg'`, `settings.executionOrder = 'v1'`, `active: false`.
  - `claude(name: string, system: string, userExpr: string): Node` — HTTP Request to Anthropic per Global Constraints, credential `BBCM Anthropic`, `max_tokens` 1024.
  - `waTemplate(name: string, template: string, toExpr: string, paramsExpr: string, buttonPayloadsExpr?: string): Node` and `waText(name, toExpr, textExpr): Node` — HTTP Request to the Graph API, credential `BBCM WhatsApp`.
  - `sheets(name: string, operation: 'append'|'update'|'read', tab: string, fields?: object): Node` — Google Sheets node bound to a document chosen at install (`documentId` left as an n8n resource-locator placeholder), credential `BBCM Google`.
- `scripts/build-workflows.mjs`: imports every `scripts/workflows/*.mjs`, calls `build()`, writes `workflows/<kebab-name>.json` (2-space JSON).
- `scripts/check-n8n.mjs [--list <names…>]`: loads every node listed in `node_modules/n8n-nodes-base/package.json` → `n8n.nodes` (skip those that fail to load); maps `name → versions → top-level property names`. With `--list`, prints the latest version of each named node. Otherwise it validates each `workflows/*.json`: the type exists, the `typeVersion` is supported, and every top-level parameter key is a property of that version. Exits non-zero listing every problem.

- [ ] **Step 1:** Run `node scripts/check-n8n.mjs --list whatsAppTrigger httpRequest googleSheets googleCalendar googleDrive code if switch wait scheduleTrigger executeWorkflow executeWorkflowTrigger errorTrigger respondToWebhook noOp` (implement `--list` first) and pin the printed versions in `T`.
- [ ] **Step 2: Write the failing tests** in `test/workflows.test.mjs`. They run `npm run build` once, then for every `workflows/*.json` assert:
  - it parses and node names are unique
  - every connection source and target exists
  - no `credentials` value has an `id`
  - `settings.timezone === 'Africa/Johannesburg'`
  - no string contains `sk-ant-`, `EAA` (a Meta token prefix) or `+27`
- [ ] **Step 3:** Implement `scripts/lib/n8n.mjs`, `build-workflows.mjs` and `check-n8n.mjs`.
- [ ] **Step 4: Run** `npm test` — pass, with zero workflows so far. **Step 5: Stage.**

---

### Task 5: The approval loop and the Inbound router

**Files:**
- Create: `scripts/workflows/request-approval.mjs`, `approval-replies.mjs`, `inbound-router.mjs`
- Modify: `test/workflows.test.mjs`

**Interfaces:**
- **`Request approval`** (sub-workflow, Execute Workflow Trigger). Input: `{ agent, matterId, recipient, recipientName, draft, attorneyNumber }`. Output: `{ decision: 'approved'|'edited'|'rejected'|'expired', text: string }`. Steps:
  1. A Code node flattens the draft (newlines → ` / `, truncated to 900 characters) and sets `ApprovalID = 'A-' + Date.now()`.
  2. Sheets append to Approvals: status `pending`, `Resume URL = {{$execution.resumeUrl}}`.
  3. `waTemplate` sends `approval_request` with button payloads `<ApprovalID>|approve|edit|reject`.
  4. A Wait node resumes on webhook call, with a 24-hour limit.
  5. On timeout: update the row to `expired` and return `expired`.
- **`Approval replies`** (sub-workflow). Input: `{ from, kind: 'button'|'text', payload?, text? }`.
  - **approve / reject:** update the row (`Decided at`, `Decided by`) and POST `{decision, text: draft}` to the Resume URL.
  - **edit:** set the row to `editing` with `Edit until = now + 30 min`, then `waText` "Send the corrected text for approval <ID>".
  - **text from an attorney with an `editing` row whose Edit until is in the future:** set the row to `edited` and POST `{decision:'edited', text}`.
  - **Second trigger, schedule every 10 minutes:** rows still `editing` past Edit until go back to `pending` and the `approval_request` template is re-sent.
- **`Inbound router`**, the only workflow containing a `whatsAppTrigger`. It routes each message:
  - button reply, or text from a number in Settings `Attorney WhatsApp numbers` → `Approval replies`
  - number in Settings `Opted-out numbers` → no reply
  - text `STOP` → append the number to Opted-out numbers and confirm once
  - number found in Matters `Client WhatsApp` → `Client updates`
  - anything else → `Reception`
- **`Error alert`**: an Error Trigger that sends the attorney numbers from Settings a WhatsApp naming the failed workflow and node. SETUP.md sets it as every workflow's error workflow, so a failure sends nothing externally except this alert (spec §7).
- **Gate rule for all workflows:** a node whose name starts with `Send to client` has exactly one incoming connection, and it comes from a node named `Approved?` or `Auto-send on?`.
- **Log rule for all workflows:** every node that sends WhatsApp (`waTemplate`/`waText`) connects onward to a Sheets append on `Log`.

- [ ] **Step 1: Write the failing tests.**
  - Exactly one workflow contains a `whatsAppTrigger`, and it is `Inbound router`.
  - In `Request approval`, the Wait node's limit is 24 hours, and the Approvals append writes `Resume URL` from `$execution.resumeUrl`.
  - `Approval replies` contains the literal `30` (minutes) and a 10-minute schedule.
  - The gate rule and the Log rule hold for every workflow.
  - `Error alert` contains an `errorTrigger`.
  - `npm run check:n8n` exits 0.
- [ ] **Step 2: Run** — fail. **Step 3: Implement** the four builders (including `scripts/workflows/error-alert.mjs`). **Step 4: Run** `npm test && npm run check:n8n` — pass. **Step 5: Stage.**

---

### Task 6: Reception and Client updates

**Files:**
- Create: `scripts/workflows/reception.mjs`, `client-updates.mjs`
- Modify: `test/workflows.test.mjs`

**Interfaces:**
- Consumes: `Request approval`, the Task 4 node factories, and the Matters / Enquiries / Settings / Log columns.
- **`Reception`** (sub-workflow; input `{ from, text, media? }`):
  1. `claude` classifies the message as `{ matterType, name, summary, wantsAdvice: boolean, asksFees: boolean, opposingParty }` as JSON.
  2. A Code node runs the conflict check, a case-insensitive match of opposing party and client name against Matters `Client name` / `Opposing party`.
  3. `Approved?` path when `conflict || wantsAdvice || asksFees`; otherwise `Auto-send on?` (Settings `Auto-send booking confirmations`).
  4. Google Calendar free-slot lookup, then append to Enquiries and Log.
  5. Every reply opens with "This is the digital assistant of {Firm name}."
- **`Client updates`** (sub-workflow for inbound, plus a daily 09:00 schedule):
  - **Inbound media:** Drive upload to the matter's folder, remove the matching Outstanding item, log.
  - **Inbound text:** `claude` answers from Stage / Next step only. Routine status replies go through `Auto-send on?`; anything else through `Approved?`.
  - **Schedule:** for matters with Outstanding items, `Reminders sent < 4`, and 3 days since the last reminder: send `document_reminder` via `Auto-send on?` (Settings `Auto-send document reminders`), increment `Reminders sent`, log. At 4, `waText` the responsible attorney instead.

- [ ] **Step 1: Write the failing tests.**
  - Reception's Approved? condition references `conflict`, `wantsAdvice` and `asksFees`.
  - Reception's reply text contains `digital assistant`.
  - Client updates' reminder branch compares `Reminders sent` with `4` and uses a 3-day interval.
  - Neither workflow has a Google Calendar `delete` or `update` operation.
  - The gate rule and `check:n8n` still pass.
- [ ] **Step 2: Run** — fail. **Step 3: Implement.** **Step 4: Run** — pass. **Step 5: Stage.**

---

### Task 7: Deadlines, Billing and Morning brief

**Files:**
- Create: `scripts/workflows/deadlines.mjs`, `billing.mjs`, `morning-brief.mjs`
- Modify: `test/workflows.test.mjs`

**Interfaces:**
- Consumes: `src/deadlines.mjs` (Task 1), `Request approval` (Task 5).
- **`Deadlines`.**
  - Triggers: Drive new file in the matters root folder; a sub-workflow input `{ note, matterId }` from attorney text routed by the Inbound router (texts starting `deadline:`); daily 06:00 scan.
  - Steps:
    1. `claude` extracts `{ event, triggerDate, ruleKey }`.
    2. A Code node computes the date. Its `jsCode` is the full text of `src/deadlines.mjs` with `export ` removed, plus an adapter that reads Settings `Extra public holidays`.
    3. Append to Deadlines with `Confirmed = N`.
    4. `Request approval` goes to the responsible attorney (**always**; no auto-send path).
    5. On `approved`/`edited`: create a Google Calendar event with popup reminders at 10080, 4320 and 1440 minutes, then update `Confirmed = Y` and `Calendar event ID`.
- **`Billing`.** Schedules:
  - 17:30 Mon–Fri: suggest time entries from today's Log rows per matter, appended to Time; `Request approval` covers the batch.
  - Daily 18:00: if today is the last working day of the month (via `isCourtDay` from the inlined module), draft fee notes for confirmed unbilled Time and append to Invoices. `Request approval` per note; on approval, send to the client.
  - Daily 08:00: invoices 7, 14 or 30 days overdue → `payment_reminder` via `Auto-send on?` (Settings `Auto-send payment reminders`); increment `Reminders sent` on Invoices.
- **`Morning brief`.** A 07:30 Mon–Fri schedule reads Calendar (today), Deadlines (next 7 days, Confirmed = Y), Approvals (`pending`), Enquiries (since yesterday 07:30) and Invoices (overdue sum), then sends `morning_brief` to each attorney number.

- [ ] **Step 1: Write the failing tests.**
  - The Deadlines Code node's `jsCode` contains the exact source of `computeDeadline` from `src/deadlines.mjs`.
  - Deadlines has no `Auto-send on?` node.
  - The Calendar event reminders are `[10080, 4320, 1440]`.
  - No workflow has a Google Calendar `delete`/`update` operation.
  - Billing schedules include `17:30` on weekdays only, and its reminder branch checks `7`, `14` and `30`.
  - No Billing node's URL or operation mentions `payment`, except the `payment_reminder` template name.
  - Morning brief runs at `07:30` Mon–Fri and sends `morning_brief`.
  - The gate rule and `check:n8n` pass.
- [ ] **Step 2: Run** — fail. **Step 3: Implement.** **Step 4: Run** `npm test && npm run check:n8n` — pass. **Step 5: Stage** `git add scripts workflows test`.

---

### Task 8: Savings calculator

**Files:**
- Create: `docs/savings.mjs`, `docs/index.html`
- Test: `test/savings.test.mjs`

**Interfaces:**
- Produces: `computeSavings(input) → { staffHours, staffValue, recoveredValue, monthlyValue, netMonthly, paybackMonths }`.
  - Input: `{ attorneys, staffMonthlySalary, staffHoursPerMonth = 165, hoursSaved: { reception, chasing, diary, billing }, recoveredHoursPerAttorney, attorneyRate, runningCostPerMonth, price }`.
  - Rand values are rounded to whole rand; `paybackMonths` is rounded to one decimal, or `null` when `netMonthly <= 0`.
- `DEFAULTS` (spec §11): `{ attorneys: 2, staffMonthlySalary: 18000, hoursSaved: { reception: 20, chasing: 15, diary: 8, billing: 6 }, recoveredHoursPerAttorney: 5, attorneyRate: 1200, runningCostPerMonth: 1500, price: 20000 }`.

- [ ] **Step 1: Write the failing tests.**
  - `computeSavings(DEFAULTS)` gives `staffHours 49`, `staffValue 5345`, `recoveredValue 12000`, `monthlyValue 17345`, `netMonthly 15845`, `paybackMonths 1.3`.
  - With `price: 15000`, payback is `0.9`.
  - With `runningCostPerMonth: 20000`, payback is `null`.
- [ ] **Step 2: Run** — fail. **Step 3: Implement** `docs/savings.mjs`, and `docs/index.html`.
  - **The page:** one form whose inputs are pre-filled with `DEFAULTS`, plus a results panel that recomputes on input.
  - **Results:** monthly value, running costs, net, and payback ("does not pay back" when `null`). R amounts are formatted by hand as `R17 345`, not with `toLocaleString`.
  - **Footer:** the pitch line and a note that these figures are estimates.
  - **Look:** navy and gold, matching BBCM.
- [ ] **Step 4: Run** — pass; open `docs/index.html` in the browser and confirm the defaults show `R17 345` and `1.3 months`. **Step 5: Stage.**

---

### Task 9: Guide, README, verify, publish and open

**Files:**
- Create: `README.md`, `docs/SETUP.md`

**Interfaces:**
- **`docs/SETUP.md`** follows spec §12 step by step:
  - Meta verification on day 1; number choice (spec §8); registering the six templates.
  - Creating the three named credentials.
  - Importing `register/*.csv` as tabs of one Sheet and pointing every Sheets node at it.
  - Importing `workflows/*.json` in the order Error alert → Request approval → Approval replies → Reception → Client updates → Deadlines → Billing → Morning brief → Inbound router, re-linking the Execute Workflow nodes, and setting Error alert as each workflow's error workflow.
  - Setting the Anthropic spend limit, and checking `GRAPH_API_VERSION`.
  - The POPIA checklist (spec §9), the sandbox and go-live checklists (spec §10), the festive-period question per rule (Review Focus 2), and the handover checklist.
- **`README.md`:** the problem, the five agents, how approval works, what's in the repo, running costs and price (spec §11), a link to the calculator (GitHub Pages) and to SETUP.md, and an "estimates" note.

- [ ] **Step 1:** Write `docs/SETUP.md` and `README.md`.
- [ ] **Step 2: Verify** `npm test && npm run check:n8n` — all pass. Record the counts.
- [ ] **Step 3: Leak scan** `git grep -nE "sk-ant-|EAA[A-Za-z0-9]{10}|\+27[0-9]{9}|@gmail\.com"` → no matches.
- [ ] **Step 4: Commit** (user-requested publish): `git add -A && git commit -m "BBCM Agents — install-ready package"`.
- [ ] **Step 5: Publish:** `gh repo create Chedevs1111/bbcm-agents --public --source . --push`, then enable Pages from `main` `/docs` with `gh api -X POST repos/Chedevs1111/bbcm-agents/pages -f 'source[branch]=main' -f 'source[path]=/docs'`.
- [ ] **Step 6: Confirm** the repo shows the README and the Pages URL `https://chedevs1111.github.io/bbcm-agents/` serves the calculator (allow up to a few minutes for Pages to build).
- [ ] **Step 7: Open** both URLs in the user's browser (`open <url>`).
