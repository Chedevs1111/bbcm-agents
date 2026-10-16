/**
 * Morning brief — at 07:30 on weekdays, one WhatsApp per attorney.
 *
 * Today's diary, deadlines in the next 7 days, approvals waiting (plus any that expired
 * unanswered since the last brief — spec §5.4), enquiries since the last brief and the
 * total overdue. "Today" also names clients not responding (4 document
 * reminders and still outstanding — see Document reminders). Sent with the morning_brief
 * template because it starts the conversation.
 */

import { CRED, T, code, log, node, readOnce, readSettings, schedule, sheets, waTemplate, workflow } from '../lib/n8n.mjs';

const COMPOSE = [
  "const settings = Object.fromEntries($('Read settings').all().map(i => [i.json.Key, String(i.json.Value ?? '')]));",
  "const digits = s => String(s ?? '').replace(/[^0-9]/g, '');",
  "const rows = name => $(name).all().map(i => i.json).filter(r => Object.keys(r).length);",
  "const amount = n => n.toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ');",
  'const today = $now.toISODate();',
  'const inWeek = $now.plus({ days: 7 }).toISODate();',
  "const diary = rows('Read diary').filter(e => e.id);",
  "const notResponding = rows('Read matters').filter(m => m.Status !== 'closed'",
  "  && String(m['Outstanding items'] ?? '').trim() && Number(m['Reminders sent'] || 0) >= 4);",
  "const deadlines = rows('Read deadlines')",
  "  .filter(d => { const due = String(d['Computed due date'] ?? '').slice(0, 10); return due >= today && due <= inWeek; })",
  "  .sort((a, b) => String(a['Computed due date']).localeCompare(String(b['Computed due date'])));",
  "// Since the last brief: Friday's on a Monday, otherwise yesterday's.",
  'const since = $now.minus({ days: $now.weekday === 1 ? 3 : 1 }).toISO();',
  "const approvals = rows('Read approvals');",
  "const pending = approvals.filter(a => ['pending', 'editing'].includes(a.Status)).length;",
  "const expired = approvals.filter(a => a.Status === 'expired' && String(a['Decided at'] ?? '') >= since).length;",
  "const waiting = expired ? `${pending} (+${expired} expired unanswered, nothing sent)` : String(pending);",
  "const enquiries = rows('Read enquiries').filter(e => String(e['Received at'] ?? '') >= since).length;",
  "const overdue = rows('Read invoices').filter(i => i.Status === 'issued' && String(i.Due ?? '').slice(0, 10) < today)",
  '  .reduce((sum, i) => sum + Number(i.Amount || 0), 0);',
  "const todayText = [`${diary.length} diary ${diary.length === 1 ? 'entry' : 'entries'}`,",
  "  ...diary.slice(0, 3).map(e => String(e.summary ?? 'untitled')),",
  "  `${notResponding.length} clients not responding` + (notResponding.length ? ' (' + notResponding.map(m => m.MatterID).join(', ') + ')' : ''),",
  "].join('; ');",
  "const next = deadlines[0];",
  "const deadlineText = deadlines.length",
  "  ? `${deadlines.length}, next ${String(next['Computed due date']).slice(0, 10)} ${next.Description ?? ''} (${next.MatterID ?? '?'})`",
  "  : 'none';",
  "return (settings['Attorney WhatsApp numbers'] || '').split(/[;,]/).map(s => s.trim()).filter(Boolean).map(entry => {",
  "  const [name, number] = entry.includes('=') ? entry.split('=') : ['', entry];",
  "  return { json: { attorneyName: name.trim() || 'Counsellor', recipient: digits(number),",
  '    params: [name.trim() || \'Counsellor\', todayText, deadlineText, waiting, String(enquiries), amount(overdue)] } };',
  "}).filter(i => i.json.recipient);",
].join('\n');

export function build() {
  const nodes = [
    schedule('Weekdays at 07:30', '30 7 * * 1-5'),
    readSettings(),
    readOnce(
      node(
        'Read diary',
        T.googleCalendar,
        {
          resource: 'event',
          operation: 'getAll',
          calendar: { __rl: true, mode: 'list', value: 'primary', cachedResultName: 'Firm diary' },
          returnAll: true,
          timeMin: "={{ $now.startOf('day').toISO() }}",
          timeMax: "={{ $now.endOf('day').toISO() }}",
          options: { singleEvents: true, orderBy: 'startTime' },
        },
        { googleCalendarOAuth2Api: { name: CRED.google } },
      ),
    ),
    sheets('Read deadlines', 'read', 'Deadlines'),
    sheets('Read approvals', 'read', 'Approvals'),
    sheets('Read enquiries', 'read', 'Enquiries'),
    sheets('Read invoices', 'read', 'Invoices'),
    sheets('Read matters', 'read', 'Matters'),
    code('Compose brief', COMPOSE),
    waTemplate('Send brief', 'morning_brief', '$json.recipient', '$json.params'),
    log('Log brief', 'Morning brief', 'morning_brief', "$('Compose brief').item.json.attorneyName"),
  ];

  return workflow('Morning brief', nodes, [
    ['Weekdays at 07:30', 'Read settings'],
    ['Read settings', 'Read diary'],
    ['Read diary', 'Read deadlines'],
    ['Read deadlines', 'Read approvals'],
    ['Read approvals', 'Read enquiries'],
    ['Read enquiries', 'Read invoices'],
    ['Read invoices', 'Read matters'],
    ['Read matters', 'Compose brief'],
    ['Compose brief', 'Send brief'],
    ['Send brief', 'Log brief'],
  ]);
}
