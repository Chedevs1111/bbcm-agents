/**
 * Billing time — at 17:30 on weekdays, turn the day's logged work into suggested time.
 *
 * Today's Log rows are grouped per matter (6 minutes per message, 12 per document or
 * diary entry). The attorney approves the batch; only then is it written to Time —
 * approved entries with Confirmed minutes filled in, edited batches left blank for the
 * attorney to adjust in the Sheet. Nothing here touches money.
 */

import { callWorkflow, code, gate, readSettings, schedule, sheets, workflow } from '../lib/n8n.mjs';

const SUGGEST = [
  "const settings = Object.fromEntries($('Read settings').all().map(i => [i.json.Key, String(i.json.Value ?? '')]));",
  "const attorneyNumber = (settings['Attorney WhatsApp numbers'] || '').split(/[;,]/)[0].split('=').pop().replace(/[^0-9]/g, '');",
  'const today = $now.toISODate();',
  "const minutesFor = action => (/document|deadline|diary/.test(action) ? 12 : 6);",
  'const byMatter = {};',
  "for (const r of $('Read log').all().map(i => i.json)) {",
  "  if (!r.MatterID || String(r.Timestamp ?? '').slice(0, 10) !== today) continue;",
  "  byMatter[r.MatterID] ??= { minutes: 0, actions: [] };",
  '  byMatter[r.MatterID].minutes += minutesFor(String(r.Action));',
  '  byMatter[r.MatterID].actions.push(r.Action);',
  '}',
  'const entries = Object.entries(byMatter).map(([matterId, v]) => ({ matterId, minutes: v.minutes, activity: [...new Set(v.actions)].join(", ") }));',
  'if (!entries.length) return [];',
  'return [{ json: {',
  "  agent: 'Billing', matterId: '', recipient: attorneyNumber, recipientName: 'the time sheet', attorneyNumber, entries,",
  "  draft: 'Time today: ' + entries.map(e => `${e.matterId} ${e.minutes} min (${e.activity})`).join('; '),",
  '} }];',
].join('\n');

const ENTRIES = [
  "const decision = $('Ask for approval').first().json.decision;",
  "return $('Suggest time').first().json.entries.map(e => ({ json: {",
  '  ...e, confirmed: decision === \'approved\' ? e.minutes : \'\',',
  '} }));',
].join('\n');

export function build() {
  const nodes = [
    schedule('Weekdays at 17:30', '30 17 * * 1-5'),
    readSettings(),
    sheets('Read log', 'read', 'Log'),
    code('Suggest time', SUGGEST),
    callWorkflow('Ask for approval', 'Request approval'),
    gate('Approved?', "['approved', 'edited'].includes($json.decision)"),
    code('Approved entries', ENTRIES),
    sheets('Record time', 'append', 'Time', {
      Date: '={{ $now.toISODate() }}',
      MatterID: '={{ $json.matterId }}',
      Activity: '={{ $json.activity }}',
      'Suggested minutes': '={{ $json.minutes }}',
      'Confirmed minutes': '={{ $json.confirmed }}',
      Billed: 'N',
    }),
  ];

  return workflow('Billing time', nodes, [
    ['Weekdays at 17:30', 'Read settings'],
    ['Read settings', 'Read log'],
    ['Read log', 'Suggest time'],
    ['Suggest time', 'Ask for approval'],
    ['Ask for approval', 'Approved?'],
    ['Approved?', 'Approved entries', 0],
    ['Approved entries', 'Record time'],
  ]);
}
