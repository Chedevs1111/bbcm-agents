/**
 * Request approval — the one way any agent gets a human decision.
 *
 * Input:  { agent, matterId, recipient, recipientName, draft, attorneyNumber }
 * Output: { decision: 'approved' | 'edited' | 'rejected' | 'expired', text }
 *
 * The draft is recorded in Approvals with this execution's resume URL, the attorney
 * gets Approve / Edit / Reject buttons, and the workflow waits. "Approval replies"
 * resumes it with the decision; after 24 hours with no answer it expires and nothing
 * is sent.
 */

import { T, code, gate, log, node, readSettings, sheets, subWorkflowTrigger, waTemplate, workflow } from '../lib/n8n.mjs';

const input = "$('Prepare approval').first().json";

export function build() {
  const nodes = [
    subWorkflowTrigger(),
    readSettings(),
    code(
      'Prepare approval',
      [
        "const input = $('When called').first().json;",
        "const draft = String(input.draft ?? '').replace(/\\s*\\n\\s*/g, ' / ').slice(0, 900);",
        "return [{ json: { ...input, draft, approvalId: 'A-' + Date.now() } }];",
      ].join('\n'),
    ),
    sheets('Record approval', 'append', 'Approvals', {
      ApprovalID: `={{ ${input}.approvalId }}`,
      Agent: `={{ ${input}.agent }}`,
      MatterID: `={{ ${input}.matterId }}`,
      Recipient: `={{ ${input}.recipientName }} ({{ ${input}.recipient }})`,
      'Draft text': `={{ ${input}.draft }}`,
      Status: 'pending',
      'Resume URL': '={{ $execution.resumeUrl }}',
    }),
    waTemplate(
      'Ask attorney',
      'approval_request',
      `${input}.attorneyNumber`,
      `[${input}.agent, ${input}.recipientName, ${input}.draft]`,
      `['approve', 'edit', 'reject'].map(a => ${input}.approvalId + '|' + a)`,
    ),
    log('Log approval request', 'Request approval', 'approval_requested', `${input}.approvalId`, `${input}.matterId`),
    node('Wait for decision', T.wait, {
      resume: 'webhook',
      httpMethod: 'POST',
      limitWaitTime: true,
      limitType: 'afterTimeInterval',
      resumeAmount: 24,
      resumeUnit: 'hours',
      options: {},
    }),
    gate('Decided?', "$json.body?.decision !== undefined"),
    // The caller's fields come back with the decision, so the next step knows who to send to.
    code(
      'Return decision',
      "return [{ json: { ...$('Prepare approval').first().json, decision: $json.body.decision, text: String($json.body.text ?? '') } }];",
    ),
    sheets(
      'Mark expired',
      'update',
      'Approvals',
      { ApprovalID: `={{ ${input}.approvalId }}`, Status: 'expired', 'Decided at': '={{ $now.toISO() }}' },
      'ApprovalID',
    ),
    code('Return expired', "return [{ json: { ...$('Prepare approval').first().json, decision: 'expired', text: '' } }];"),
  ];

  return workflow('Request approval', nodes, [
    ['When called', 'Read settings'],
    ['Read settings', 'Prepare approval'],
    ['Prepare approval', 'Record approval'],
    ['Record approval', 'Ask attorney'],
    ['Ask attorney', 'Log approval request'],
    ['Log approval request', 'Wait for decision'],
    ['Wait for decision', 'Decided?'],
    ['Decided?', 'Return decision', 0],
    ['Decided?', 'Mark expired', 1],
    ['Mark expired', 'Return expired'],
  ]);
}
