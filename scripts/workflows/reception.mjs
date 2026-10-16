/**
 * Reception — answers people who are not yet clients.
 *
 * Input (from the Inbound router): { from, text, kind }
 *   1. Claude reads the message (it never advises): name, matter type, summary, opposing
 *      party, whether they want advice or ask about fees, and any slot number they picked.
 *   2. Conflict check against Matters; three free consultation slots from the diary.
 *   3. A reply that starts "This is the digital assistant of …". Conflicts, advice and
 *      fee questions always go to the attorney; anything else goes out on its own only
 *      when "Auto-send booking confirmations" is Yes.
 *   4. Replying "1", "2" or "3" to offered slots books that consultation.
 */

import {
  T, callWorkflow, claude, code, gate, log, node, readOnce, readSettings, setting, sheets, waText, workflow,
} from '../lib/n8n.mjs';

const plan = "$('Plan reply').first().json";

const SYSTEM =
  'You are the reception assistant of a South African law firm. Read the WhatsApp message and reply with JSON only: ' +
  '{"name": string|null, "matterType": string, "summary": string, "opposingParty": string|null, ' +
  '"wantsAdvice": boolean, "asksFees": boolean, "pickedSlot": 1|2|3|null}. ' +
  'wantsAdvice is true when they ask what they should do legally. Never give legal advice.';

const PLAN = [
  "const input = $('When called').first().json;",
  "const settings = Object.fromEntries($('Read settings').all().map(i => [i.json.Key, String(i.json.Value ?? '')]));",
  "let ai = {};",
  "try { ai = JSON.parse($('Understand enquiry').first().json.content[0].text); } catch { ai = { summary: input.text, wantsAdvice: true }; }",
  "const low = s => String(s ?? '').toLowerCase().trim();",
  "const names = [low(ai.name), low(ai.opposingParty)].filter(Boolean);",
  "const conflict = $('Read matters').all().some(i => names.some(n => n && (low(i.json['Client name']) === n || low(i.json['Opposing party']) === n)));",
  "const firm = (settings['Firm name'] || 'our firm').replace(/\\.$/, '');",
  "const attorneyNumber = (settings['Attorney WhatsApp numbers'] || '').split(/[;,]/)[0].split('=').pop().replace(/[^0-9]/g, '');",
  "const offered = $('Read enquiries').all().map(i => i.json).filter(r => String(r.WhatsApp) === input.from && r.Status === 'slots offered').pop();",
  "if (offered && ai.pickedSlot) {",
  "  const slot = String(offered['Consultation slot']).split(' | ')[ai.pickedSlot - 1];",
  "  if (slot) {",
  "    const start = new Date(slot);",
  "    const end = new Date(start.getTime() + 60 * 60 * 1000);",
  "    return [{ json: { ...ai, from: input.from, conflict, booking: { start: start.toISOString(), end: end.toISOString() },",
  "      slots: slot, status: 'booked', agent: 'Reception', matterId: '', recipient: input.from, recipientName: ai.name || 'client', attorneyNumber,",
  "      draft: `This is the digital assistant of ${firm}. Your consultation is booked for ${start.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Please bring your ID.` } }];",
  "  }",
  "}",
  "const busy = $('Read diary').all().map(i => i.json).filter(e => e.start).map(e => [new Date(e.start.dateTime || e.start.date), new Date(e.end.dateTime || e.end.date)]);",
  "// $now is in the workflow's Africa/Johannesburg zone; the server clock may be UTC.",
  "const times = String(settings['Consultation slot rules'] ?? '').match(/\\b\\d{1,2}:\\d{2}\\b/g) ?? ['09:00', '11:00', '14:00'];",
  "const slots = [];",
  "let day = $now.startOf('day');",
  "while (slots.length < 3) {",
  "  day = day.plus({ days: 1 });",
  "  if (day.weekday > 5) continue;",
  "  for (const time of times) {",
  "    const [hour, minute] = time.split(':').map(Number);",
  "    const start = day.set({ hour, minute }).toJSDate();",
  "    const end = new Date(start.getTime() + 60 * 60 * 1000);",
  "    if (!busy.some(([s, e]) => s < end && e > start) && slots.length < 3) slots.push(start);",
  "  }",
  "}",
  "const fmt = d => d.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });",
  "const draft = `This is the digital assistant of ${firm}. Thank you${ai.name ? ', ' + ai.name : ''} — we can see you for a free consultation. Reply 1, 2 or 3: ` +",
  "  slots.map((s, i) => `${i + 1}) ${fmt(s)}`).join('; ') + '. An attorney will answer any legal questions at the consultation.';",
  "return [{ json: { ...ai, from: input.from, conflict, booking: null, slots: slots.map(s => s.toISOString()).join(' | '), status: 'slots offered',",
  "  agent: 'Reception', matterId: '', recipient: input.from, recipientName: ai.name || 'client', attorneyNumber, draft } }];",
].join('\n');

export function build() {
  const diary = readOnce(
    node(
      'Read diary',
      T.googleCalendar,
      {
        resource: 'event',
        operation: 'getAll',
        calendar: { __rl: true, mode: 'list', value: 'primary', cachedResultName: 'Firm diary' },
        returnAll: true,
        options: {},
      },
      { googleCalendarOAuth2Api: { name: 'BBCM Google' } },
    ),
  );

  const nodes = [
    node('When called', T.executeWorkflowTrigger, { inputSource: 'passthrough' }),
    readSettings(),
    sheets('Read matters', 'read', 'Matters'),
    sheets('Read enquiries', 'read', 'Enquiries'),
    diary,
    claude('Understand enquiry', SYSTEM, "$('When called').first().json.text"),
    code('Plan reply', PLAN),
    sheets('Record enquiry', 'append', 'Enquiries', {
      'Received at': '={{ $now.toISO() }}',
      Name: `={{ ${plan}.name }}`,
      WhatsApp: `={{ ${plan}.from }}`,
      'Matter type': `={{ ${plan}.matterType }}`,
      Summary: `={{ ${plan}.summary }}`,
      'Conflict result': `={{ ${plan}.conflict ? 'possible conflict' : 'clear' }}`,
      'Consultation slot': `={{ ${plan}.slots }}`,
      Status: `={{ ${plan}.status }}`,
    }),
    gate('Is booking?', `${plan}.booking !== null`),
    node(
      'Book consultation',
      T.googleCalendar,
      {
        resource: 'event',
        operation: 'create',
        calendar: { __rl: true, mode: 'list', value: 'primary', cachedResultName: 'Firm diary' },
        start: `={{ ${plan}.booking.start }}`,
        end: `={{ ${plan}.booking.end }}`,
        additionalFields: { summary: `=Consultation — {{ ${plan}.recipientName }}`, description: `={{ ${plan}.summary }}` },
      },
      { googleCalendarOAuth2Api: { name: 'BBCM Google' } },
    ),
    gate('Needs approval?', `${plan}.conflict || ${plan}.wantsAdvice || ${plan}.asksFees`),
    gate('Auto-send on?', `${setting('Auto-send booking confirmations')} === 'Yes'`),
    callWorkflow('Ask for approval', 'Request approval'),
    gate('Approved?', "['approved', 'edited'].includes($json.decision)"),
    waText('Send to client', `${plan}.from`, '$json.text'),
    log('Log approved reply', 'Reception', 'reply_sent', "'approved reply'"),
    waText('Send to client (auto)', `${plan}.from`, `${plan}.draft`),
    log('Log auto reply', 'Reception', 'reply_sent', "'automatic reply'"),
  ];

  return workflow('Reception', nodes, [
    ['When called', 'Read settings'],
    ['Read settings', 'Read matters'],
    ['Read matters', 'Read enquiries'],
    ['Read enquiries', 'Read diary'],
    ['Read diary', 'Understand enquiry'],
    ['Understand enquiry', 'Plan reply'],
    ['Plan reply', 'Record enquiry'],
    ['Plan reply', 'Is booking?'],
    ['Plan reply', 'Needs approval?'],
    ['Is booking?', 'Book consultation', 0],
    ['Needs approval?', 'Ask for approval', 0],
    ['Needs approval?', 'Auto-send on?', 1],
    ['Auto-send on?', 'Send to client (auto)', 0],
    ['Auto-send on?', 'Ask for approval', 1],
    ['Ask for approval', 'Approved?'],
    ['Approved?', 'Send to client', 0],
    ['Send to client', 'Log approved reply'],
    ['Send to client (auto)', 'Log auto reply'],
  ]);
}
