/**
 * Billing month end — on the last working day of the month, draft fee notes.
 *
 * Runs daily at 18:00 and stops unless no court day is left this month (the SA holiday
 * maths is src/deadlines.mjs, inlined). Confirmed time dated this month is grouped per
 * matter at the Settings "Hourly rate (R)". Each draft fee note waits for the attorney;
 * once approved it is marked issued and the client is told with the status_update
 * template. Nothing here moves money.
 */

import { readFileSync } from 'node:fs';
import { callWorkflow, code, gate, log, readSettings, schedule, sheets, waTemplate, workflow } from '../lib/n8n.mjs';

const MODULE = readFileSync(new URL('../../src/deadlines.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');

const LAST_DAY = `${MODULE}
// ---- Adapter: continue only on the last working day of the month ----
const settings = Object.fromEntries($('Read settings').all().map(i => [i.json.Key, String(i.json.Value ?? '')]));
const extra = String(settings['Extra public holidays'] || '').split(/[;,\\s]+/).filter(Boolean);
const today = $now.toISODate();
const [y, m] = today.split('-').map(Number);
const lastDate = new Date(Date.UTC(y, m, 0)).getUTCDate();
for (let day = Number(today.slice(8)) + 1; day <= lastDate; day += 1) {
  const iso = today.slice(0, 8) + String(day).padStart(2, '0');
  if (isCourtDay(iso, extra)) return [];
}
return [{ json: { lastWorkingDay: today } }];
`;

const DRAFT = [
  "const settings = Object.fromEntries($('Read settings').all().map(i => [i.json.Key, String(i.json.Value ?? '')]));",
  "const rate = Number(String(settings['Hourly rate (R)'] || '').replace(/[^0-9.]/g, ''));",
  'if (!rate) return [];',
  "const digits = s => String(s ?? '').replace(/[^0-9]/g, '');",
  "const firm = (settings['Firm name'] || 'our firm').replace(/\\.$/, '');",
  "const attorneyNumber = digits((settings['Attorney WhatsApp numbers'] || '').split(/[;,]/)[0].split('=').pop());",
  "const rand = n => 'R' + n.toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ');",
  'const month = $now.toISODate().slice(0, 7);',
  "const existing = new Set($('Read invoices').all().map(i => String(i.json['Invoice no.'])));",
  "const matters = Object.fromEntries($('Read matters').all().map(i => [i.json.MatterID, i.json]));",
  'const minutes = {};',
  "for (const t of $('Read time').all().map(i => i.json)) {",
  "  const confirmed = Number(t['Confirmed minutes'] || 0);",
  "  if (!t.MatterID || !confirmed || !String(t.Date ?? '').startsWith(month)) continue;",
  '  minutes[t.MatterID] = (minutes[t.MatterID] ?? 0) + confirmed;',
  '}',
  'return Object.entries(minutes).flatMap(([matterId, mins]) => {',
  "  const invoiceNo = `INV-${month.replace('-', '')}-${matterId}`;",
  '  if (existing.has(invoiceNo)) return [];',
  '  const amount = Math.round((mins / 60) * rate * 100) / 100;',
  '  const client = matters[matterId] ?? {};',
  '  return [{ json: {',
  '    invoiceNo, matterId, amount, amountText: rand(amount), minutes: mins, firm, attorneyNumber,',
  "    agent: 'Billing', recipient: digits(client['Client WhatsApp']), recipientName: client['Client name'] ?? 'client',",
  '    draft: `Fee note ${invoiceNo} for matter ${matterId}: ${mins} min at R${rate}/h = ${rand(amount)}`,',
  '  } }];',
  '});',
].join('\n');

const notice = "[$json.recipientName, $json.firm, 'your fee note ' + $json.invoiceNo + ' for ' + $json.amountText + ' has been issued', 'please settle it within 30 days']";

export function build() {
  const nodes = [
    schedule('Daily at 18:00', '0 18 * * *'),
    readSettings(),
    code('Last working day?', LAST_DAY),
    sheets('Read time', 'read', 'Time'),
    sheets('Read matters', 'read', 'Matters'),
    sheets('Read invoices', 'read', 'Invoices'),
    code('Draft fee notes', DRAFT),
    sheets('Record fee note', 'append', 'Invoices', {
      'Invoice no.': "={{ $('Draft fee notes').item.json.invoiceNo }}",
      MatterID: "={{ $('Draft fee notes').item.json.matterId }}",
      Amount: "={{ $('Draft fee notes').item.json.amount.toFixed(2) }}",
      Issued: '={{ $now.toISODate() }}',
      Due: "={{ $now.plus(30, 'days').toISODate() }}",
      Status: 'draft',
      'Reminders sent': '0',
    }),
    callWorkflow('Ask for approval', 'Request approval'),
    gate('Approved?', "['approved', 'edited'].includes($json.decision)"),
    waTemplate('Send to client', 'status_update', '$json.recipient', notice),
    log('Log fee note', 'Billing', 'fee_note_issued', "$('Approved?').item.json.invoiceNo", "$('Approved?').item.json.matterId"),
    sheets(
      'Mark issued',
      'update',
      'Invoices',
      { 'Invoice no.': "={{ $('Approved?').item.json.invoiceNo }}", Status: 'issued' },
      'Invoice no.',
    ),
  ];

  return workflow('Billing month end', nodes, [
    ['Daily at 18:00', 'Read settings'],
    ['Read settings', 'Last working day?'],
    ['Last working day?', 'Read time'],
    ['Read time', 'Read matters'],
    ['Read matters', 'Read invoices'],
    ['Read invoices', 'Draft fee notes'],
    ['Draft fee notes', 'Record fee note'],
    ['Draft fee notes', 'Ask for approval'],
    ['Ask for approval', 'Approved?'],
    ['Approved?', 'Send to client', 0],
    ['Send to client', 'Log fee note'],
    ['Log fee note', 'Mark issued'],
  ]);
}
