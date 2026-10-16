/**
 * Billing reminders — every day at 08:00, remind clients about unpaid fee notes.
 *
 * An issued invoice qualifies on exactly 7, 14 and 30 days past its due date, at most
 * 3 times. Reminders use the payment_reminder template; with the Settings switch
 * "Auto-send payment reminders" off (the default) each one waits for the attorney.
 * Nothing here records payments or moves money — the firm marks invoices paid by hand.
 */

import { callWorkflow, code, gate, log, readSettings, schedule, setting, sheets, waTemplate, workflow } from '../lib/n8n.mjs';

const OVERDUE = [
  "const settings = Object.fromEntries($('Read settings').all().map(i => [i.json.Key, String(i.json.Value ?? '')]));",
  "const digits = s => String(s ?? '').replace(/[^0-9]/g, '');",
  "const firm = (settings['Firm name'] || 'our firm').replace(/\\.$/, '');",
  "const attorneyNumber = digits((settings['Attorney WhatsApp numbers'] || '').split(/[;,]/)[0].split('=').pop());",
  "const amount = n => Number(n || 0).toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' ');",
  "const matters = Object.fromEntries($('Read matters').all().map(i => [i.json.MatterID, i.json]));",
  'const today = DateTime.fromISO($now.toISODate());',
  "return $('Read invoices').all().map(i => i.json)",
  "  .filter(inv => inv['Invoice no.'] && inv.Status === 'issued' && inv.Due)",
  "  .map(inv => ({ inv, days: Math.round(today.diff(DateTime.fromISO(String(inv.Due).slice(0, 10)), 'days').days) }))",
  "  .filter(({ inv, days }) => [7, 14, 30].includes(days) && Number(inv['Reminders sent'] || 0) < 3)",
  '  .map(({ inv, days }) => {',
  '    const client = matters[inv.MatterID] ?? {};',
  '    return { json: {',
  "      invoiceNo: inv['Invoice no.'], matterId: inv.MatterID, amount: amount(inv.Amount), days,",
  "      due: DateTime.fromISO(String(inv.Due).slice(0, 10)).toFormat('d LLLL yyyy'),",
  "      remindersSent: Number(inv['Reminders sent'] || 0), firm, attorneyNumber, agent: 'Billing',",
  "      recipient: digits(client['Client WhatsApp']), recipientName: client['Client name'] ?? 'client',",
  "      draft: `Payment reminder to ${client['Client name'] ?? 'client'}: invoice ${inv['Invoice no.']} for R${amount(inv.Amount)} is ${days} days overdue`,",
  '    } };',
  '  });',
].join('\n');

const params = '[$json.recipientName, $json.firm, $json.invoiceNo, $json.amount, $json.due]';
const count = (from) => ({
  'Invoice no.': `={{ $('${from}').item.json.invoiceNo }}`,
  'Reminders sent': `={{ $('${from}').item.json.remindersSent + 1 }}`,
});

export function build() {
  const nodes = [
    schedule('Daily at 08:00', '0 8 * * *'),
    readSettings(),
    sheets('Read invoices', 'read', 'Invoices'),
    sheets('Read matters', 'read', 'Matters'),
    code('Overdue invoices', OVERDUE),
    gate('Auto-send on?', `${setting('Auto-send payment reminders')} === 'Yes'`),
    waTemplate('Send to client (auto)', 'payment_reminder', '$json.recipient', params),
    log('Log reminder (auto)', 'Billing', 'payment_reminder', "$('Overdue invoices').item.json.invoiceNo + ' (automatic)'", "$('Overdue invoices').item.json.matterId"),
    sheets('Count reminder (auto)', 'update', 'Invoices', count('Overdue invoices'), 'Invoice no.'),
    callWorkflow('Ask for approval', 'Request approval'),
    gate('Approved?', "['approved', 'edited'].includes($json.decision)"),
    waTemplate('Send to client', 'payment_reminder', '$json.recipient', params),
    log('Log reminder', 'Billing', 'payment_reminder', "$('Approved?').item.json.invoiceNo + ' (approved)'", "$('Approved?').item.json.matterId"),
    sheets('Count reminder', 'update', 'Invoices', count('Approved?'), 'Invoice no.'),
  ];

  return workflow('Billing reminders', nodes, [
    ['Daily at 08:00', 'Read settings'],
    ['Read settings', 'Read invoices'],
    ['Read invoices', 'Read matters'],
    ['Read matters', 'Overdue invoices'],
    ['Overdue invoices', 'Auto-send on?'],
    ['Auto-send on?', 'Send to client (auto)', 0],
    ['Auto-send on?', 'Ask for approval', 1],
    ['Send to client (auto)', 'Log reminder (auto)'],
    ['Log reminder (auto)', 'Count reminder (auto)'],
    ['Ask for approval', 'Approved?'],
    ['Approved?', 'Send to client', 0],
    ['Send to client', 'Log reminder'],
    ['Log reminder', 'Count reminder'],
  ]);
}
