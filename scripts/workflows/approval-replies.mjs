/**
 * Approval replies — turns an attorney's tap or corrected text into a decision.
 *
 * Input (from the Inbound router): { from, kind: 'button' | 'text', payload?, text? }
 *   Approve / Reject → record it and resume the waiting Request approval run.
 *   Edit             → open a 30-minute window and ask for the corrected text.
 *   Text in window   → that text becomes the approved message; resume.
 * Taps on decided or unknown approvals are ignored, so a stale button does nothing.
 */

import {
  T, code, log, node, readSettings, sheets, subWorkflowTrigger, waText, workflow,
} from '../lib/n8n.mjs';

const decided = "$('Decide').first().json";

export function build() {
  const nodes = [
    subWorkflowTrigger(),
    readSettings(),
    sheets('Read approvals', 'read', 'Approvals'),
    code(
      'Decide',
      [
        "const input = $('When called').first().json;",
        "const rows = $('Read approvals').all().map(i => i.json);",
        "const from = String(input.from ?? '');",
        "if (input.kind === 'button') {",
        "  const [id, action] = String(input.payload ?? '').split('|');",
        '  const row = rows.find(r => r.ApprovalID === id);',
        "  if (!row || !['pending', 'editing'].includes(row.Status)) return [{ json: { route: 2 } }];",
        "  if (action === 'edit') return [{ json: { route: 1, id, from } }];",
        "  const decision = action === 'approve' ? 'approved' : 'rejected';",
        "  return [{ json: { route: 0, id, from, decision, text: row['Draft text'], resumeUrl: row['Resume URL'] } }];",
        '}',
        'const now = new Date();',
        'const editing = rows.find(r =>',
        "  r.Status === 'editing' && String(r['Decided by']) === from && new Date(r['Edit until']) > now);",
        'if (!editing) return [{ json: { route: 2 } }];',
        "return [{ json: { route: 0, id: editing.ApprovalID, from, decision: 'edited', text: String(input.text ?? ''), resumeUrl: editing['Resume URL'] } }];",
      ].join('\n'),
    ),
    node('Route decision', T.switch, { mode: 'expression', numberOutputs: 3, output: '={{ $json.route }}' }),
    sheets(
      'Record decision',
      'update',
      'Approvals',
      {
        ApprovalID: `={{ ${decided}.id }}`,
        Status: `={{ ${decided}.decision }}`,
        'Draft text': `={{ ${decided}.text }}`,
        'Decided at': '={{ $now.toISO() }}',
        'Decided by': `={{ ${decided}.from }}`,
      },
      'ApprovalID',
    ),
    node('Resume waiting run', T.httpRequest, {
      method: 'POST',
      url: `={{ ${decided}.resumeUrl }}`,
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ decision: ${decided}.decision, text: ${decided}.text }) }}`,
      options: {},
    }),
    sheets(
      'Start edit',
      'update',
      'Approvals',
      {
        ApprovalID: `={{ ${decided}.id }}`,
        Status: 'editing',
        'Edit until': "={{ $now.plus(30, 'minutes').toISO() }}",
        'Decided by': `={{ ${decided}.from }}`,
      },
      'ApprovalID',
    ),
    waText(
      'Ask for corrected text',
      `${decided}.from`,
      `'Send the corrected text for approval ' + ${decided}.id + ' within 30 minutes.'`,
    ),
    log('Log edit request', 'Approval replies', 'edit_requested', `${decided}.id`),
    node('Ignore', T.noOp, {}),
  ];

  return workflow('Approval replies', nodes, [
    ['When called', 'Read settings'],
    ['Read settings', 'Read approvals'],
    ['Read approvals', 'Decide'],
    ['Decide', 'Route decision'],
    ['Route decision', 'Record decision', 0],
    ['Route decision', 'Start edit', 1],
    ['Route decision', 'Ignore', 2],
    ['Record decision', 'Resume waiting run'],
    ['Start edit', 'Ask for corrected text'],
    ['Ask for corrected text', 'Log edit request'],
  ]);
}
