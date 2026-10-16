/**
 * Client updates — answers existing clients (inbound only; chasing is "Document reminders").
 *
 * Input (from the Inbound router): { from, kind, text, mediaId, mediaType }
 *   Photo or PDF → saved in the matter's Drive folder; the Outstanding item is ticked off
 *                  only when exactly one is outstanding (otherwise the attorney decides).
 *   Question     → Claude answers from Stage and Next step only; anything else needs the
 *                  attorney. Routine replies go out alone only when auto-send is on.
 */

import {
  CRED, GRAPH_API_VERSION, T, callWorkflow, claude, code, gate, log, node, readSettings, setting, sheets, waText, workflow,
} from '../lib/n8n.mjs';

const found = "$('Find matter').first().json";

const FIND = [
  "const input = $('When called').first().json;",
  "const settings = Object.fromEntries($('Read settings').all().map(i => [i.json.Key, String(i.json.Value ?? '')]));",
  "const digits = s => String(s ?? '').replace(/[^0-9]/g, '');",
  "const matter = $('Read matters').all().map(i => i.json)",
  "  .filter(m => digits(m['Client WhatsApp']) === input.from && m.Status !== 'closed').pop() ?? {};",
  'return [{ json: {',
  '  ...matter, ...input,',
  "  firm: (settings['Firm name'] || 'our firm').replace(/\\.$/, ''),",
  "  attorneyNumber: digits((settings['Attorney WhatsApp numbers'] || '').split(/[;,]/)[0].split('=').pop()),",
  "  isMedia: input.kind === 'media' && Boolean(input.mediaId),",
  "  agent: 'Client updates', matterId: matter.MatterID ?? '', recipient: input.from, recipientName: matter['Client name'] ?? 'client',",
  '} }];',
].join('\n');

const RECEIPT = [
  `const m = ${found};`,
  "const items = String(m['Outstanding items'] ?? '').split(',').map(s => s.trim()).filter(Boolean);",
  "const remaining = items.length === 1 ? '' : items.join(', ');",
  'return [{ json: { ...m, remaining, routine: true,',
  "  draft: `This is the digital assistant of ${m.firm}. Thank you — we have received your document and filed it with your matter.` } }];",
].join('\n');

const ANSWER = [
  `const m = ${found};`,
  'let ai = {};',
  "try { ai = JSON.parse($('Answer from file').first().json.content[0].text); } catch { ai = { reply: '', routine: false }; }",
  'return [{ json: { ...m, routine: ai.routine === true,',
  "  draft: `This is the digital assistant of ${m.firm}. ${ai.reply || 'An attorney will reply to you shortly.'}` } }];",
].join('\n');

const SYSTEM =
  "You are the digital assistant of a South African law firm replying to an existing client on WhatsApp. " +
  'Answer ONLY from the matter stage and next step provided. Never give legal advice. If the question needs advice ' +
  'or anything not in those facts, set routine to false. Reply with JSON only: {"reply": string, "routine": boolean}.';

export function build() {
  const nodes = [
    node('When called', T.executeWorkflowTrigger, { inputSource: 'passthrough' }),
    readSettings(),
    sheets('Read matters', 'read', 'Matters'),
    code('Find matter', FIND),
    gate('Is document?', `${found}.isMedia`),
    node(
      'Get media link',
      T.httpRequest,
      {
        method: 'GET',
        url: `=https://graph.facebook.com/${GRAPH_API_VERSION}/{{ ${found}.mediaId }}`,
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        options: {},
      },
      { httpHeaderAuth: { name: CRED.whatsapp } },
    ),
    node(
      'Download media',
      T.httpRequest,
      {
        method: 'GET',
        url: '={{ $json.url }}',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpHeaderAuth',
        options: { response: { response: { responseFormat: 'file' } } },
      },
      { httpHeaderAuth: { name: CRED.whatsapp } },
    ),
    node(
      'Save to matter folder',
      T.googleDrive,
      {
        resource: 'file',
        operation: 'upload',
        name: `={{ ${found}.matterId }}-{{ $now.toFormat('yyyyLLdd-HHmmss') }}`,
        driveId: { __rl: true, mode: 'list', value: 'My Drive' },
        folderId: { __rl: true, mode: 'url', value: `={{ ${found}['Drive folder link'] }}` },
        inputDataFieldName: 'data',
        options: {},
      },
      { googleDriveOAuth2Api: { name: CRED.google } },
    ),
    code('Draft receipt', RECEIPT),
    sheets(
      'Update matter',
      'update',
      'Matters',
      { MatterID: '={{ $json.MatterID }}', 'Outstanding items': '={{ $json.remaining }}', 'Last client update': '={{ $now.toISO() }}' },
      'MatterID',
    ),
    claude(
      'Answer from file',
      SYSTEM,
      `JSON.stringify({ question: ${found}.text, stage: ${found}.Stage, nextStep: ${found}['Next step'] })`,
    ),
    code('Draft answer', ANSWER),
    gate('Routine?', '$json.routine === true'),
    gate('Auto-send on?', `${setting('Auto-send document reminders')} === 'Yes'`),
    waText('Send to client (auto)', '$json.recipient', '$json.draft'),
    log('Log reply (auto)', 'Client updates', 'reply_sent', "'automatic'", `${found}.matterId`),
    callWorkflow('Ask for approval', 'Request approval'),
    gate('Approved?', "['approved', 'edited'].includes($json.decision)"),
    waText('Send to client', '$json.recipient', '$json.text'),
    log('Log reply', 'Client updates', 'reply_sent', "'approved'", `${found}.matterId`),
  ];

  return workflow('Client updates', nodes, [
    ['When called', 'Read settings'],
    ['Read settings', 'Read matters'],
    ['Read matters', 'Find matter'],
    ['Find matter', 'Is document?'],
    ['Is document?', 'Get media link', 0],
    ['Is document?', 'Answer from file', 1],
    ['Get media link', 'Download media'],
    ['Download media', 'Save to matter folder'],
    ['Save to matter folder', 'Draft receipt'],
    ['Draft receipt', 'Update matter'],
    ['Draft receipt', 'Routine?'],
    ['Answer from file', 'Draft answer'],
    ['Draft answer', 'Routine?'],
    ['Routine?', 'Auto-send on?', 0],
    ['Routine?', 'Ask for approval', 1],
    ['Auto-send on?', 'Send to client (auto)', 0],
    ['Auto-send on?', 'Ask for approval', 1],
    ['Send to client (auto)', 'Log reply (auto)'],
    ['Ask for approval', 'Approved?'],
    ['Approved?', 'Send to client', 0],
    ['Send to client', 'Log reply'],
  ]);
}
