/**
 * Document reminders — every weekday at 09:00, chase clients for outstanding documents.
 *
 * A matter qualifies when it is open, has Outstanding items, has had fewer than 4
 * reminders, and was last updated 3 or more days ago. After the 4th reminder chasing
 * stops; the Morning brief then lists the matter as "not responding".
 * Reminders use the document_reminder template (they usually start a conversation).
 */

import { callWorkflow, code, gate, log, readSettings, schedule, setting, sheets, waTemplate, workflow } from '../lib/n8n.mjs';

const DUE = [
  "const settings = Object.fromEntries($('Read settings').all().map(i => [i.json.Key, String(i.json.Value ?? '')]));",
  "const digits = s => String(s ?? '').replace(/[^0-9]/g, '');",
  "const firm = (settings['Firm name'] || 'our firm').replace(/\\.$/, '');",
  "const attorneyNumber = digits((settings['Attorney WhatsApp numbers'] || '').split(/[;,]/)[0].split('=').pop());",
  'const now = Date.now();',
  "return $('Read matters').all().map(i => i.json)",
  "  .filter(m => m.MatterID && m.Status !== 'closed' && String(m['Outstanding items'] ?? '').trim())",
  "  .map(m => ({ m, daysSince: m['Last client update'] ? (now - new Date(m['Last client update']).getTime()) / 86400000 : Infinity }))",
  "  .filter(({ m, daysSince }) => Number(m['Reminders sent'] || 0) < 4 && daysSince >= 3)",
  '  .map(({ m }) => ({ json: {',
  "    ...m, firm, attorneyNumber, agent: 'Document reminders', matterId: m.MatterID,",
  "    recipient: digits(m['Client WhatsApp']), recipientName: m['Client name'],",
  "    draft: `Document reminder to ${m['Client name']}: still needed — ${m['Outstanding items']}`,",
  '  } }));',
].join('\n');

const params = "[$json.recipientName, $json.firm, $json['Outstanding items']]";
const count = {
  MatterID: '={{ $json.MatterID }}',
  'Reminders sent': "={{ Number($('Read matters').all().find(i => i.json.MatterID === $json.MatterID)?.json['Reminders sent'] || 0) + 1 }}",
  'Last client update': '={{ $now.toISO() }}',
};

export function build() {
  const nodes = [
    schedule('Weekdays at 09:00', '0 9 * * 1-5'),
    readSettings(),
    sheets('Read matters', 'read', 'Matters'),
    code('Due reminders', DUE),
    gate('Auto-send on?', `${setting('Auto-send document reminders')} === 'Yes'`),
    waTemplate('Send to client (auto)', 'document_reminder', '$json.recipient', params),
    log('Log reminder (auto)', 'Document reminders', 'document_reminder', "'automatic'", "$('Due reminders').item.json.MatterID"),
    callWorkflow('Ask for approval', 'Request approval'),
    gate('Approved?', "['approved', 'edited'].includes($json.decision)"),
    waTemplate('Send to client', 'document_reminder', '$json.recipient', params),
    log('Log reminder', 'Document reminders', 'document_reminder', "'approved'", "$('Approved?').item.json.matterId"),
    sheets('Count reminder', 'update', 'Matters', count, 'MatterID'),
  ];

  return workflow('Document reminders', nodes, [
    ['Weekdays at 09:00', 'Read settings'],
    ['Read settings', 'Read matters'],
    ['Read matters', 'Due reminders'],
    ['Due reminders', 'Auto-send on?'],
    ['Auto-send on?', 'Send to client (auto)', 0],
    ['Auto-send on?', 'Ask for approval', 1],
    ['Send to client (auto)', 'Log reminder (auto)'],
    ['Ask for approval', 'Approved?'],
    ['Approved?', 'Send to client', 0],
    ['Send to client', 'Log reminder'],
    ['Log reminder (auto)', 'Count reminder'],
    ['Log reminder', 'Count reminder'],
  ]);
}
