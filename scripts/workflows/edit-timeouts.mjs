/**
 * Edit timeouts — every 10 minutes, an approval left in "editing" past its 30-minute
 * window goes back to "pending" and the attorney gets the buttons again, so a draft
 * is never stuck half-edited.
 */

import { code, log, readSettings, schedule, sheets, waTemplate, workflow } from '../lib/n8n.mjs';

const row = "$('Find lapsed edits').item.json";

export function build() {
  const nodes = [
    schedule('Every 10 minutes', '*/10 * * * *'),
    readSettings(),
    sheets('Read approvals', 'read', 'Approvals'),
    code(
      'Find lapsed edits',
      [
        'const now = new Date();',
        "return $('Read approvals').all()",
        "  .map(i => i.json)",
        "  .filter(r => r.Status === 'editing' && new Date(r['Edit until']) <= now)",
        '  .map(r => ({ json: r }));',
      ].join('\n'),
    ),
    sheets(
      'Back to pending',
      'update',
      'Approvals',
      { ApprovalID: `={{ ${row}.ApprovalID }}`, Status: 'pending', 'Edit until': '' },
      'ApprovalID',
    ),
    waTemplate(
      'Ask attorney again',
      'approval_request',
      `${row}['Decided by']`,
      `[${row}.Agent, ${row}.Recipient, ${row}['Draft text']]`,
      `['approve', 'edit', 'reject'].map(a => ${row}.ApprovalID + '|' + a)`,
    ),
    log('Log re-ask', 'Edit timeouts', 'approval_reasked', `${row}.ApprovalID`, `${row}.MatterID`),
  ];

  return workflow('Edit timeouts', nodes, [
    ['Every 10 minutes', 'Read settings'],
    ['Read settings', 'Read approvals'],
    ['Read approvals', 'Find lapsed edits'],
    ['Find lapsed edits', 'Back to pending'],
    ['Back to pending', 'Ask attorney again'],
    ['Ask attorney again', 'Log re-ask'],
  ]);
}
