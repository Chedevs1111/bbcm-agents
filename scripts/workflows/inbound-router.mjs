/**
 * Inbound router — the only workflow that listens to WhatsApp.
 *
 * A WhatsApp app delivers every message to one webhook, so this workflow receives all
 * of them and hands each on. STOP is decided first, so opting out always works.
 *   0 approval   button taps, and texts from attorney numbers
 *   1 deadline   attorney texts starting "deadline:"
 *   2 client     numbers found in Matters
 *   3 reception  everyone else
 *   4 opt-out    STOP
 *   5 ignore     opted-out numbers, delivery receipts
 */

import {
  CRED, T, callWorkflow, code, log, node, readSettings, setting, sheets, waText, workflow,
} from '../lib/n8n.mjs';

const msg = "$('Classify message').first().json";

export function build() {
  const nodes = [
    node(
      'WhatsApp message',
      T.whatsAppTrigger,
      { updates: ['messages'], options: {} },
      { whatsAppTriggerApi: { name: CRED.whatsappApp } },
    ),
    readSettings(),
    sheets('Read matters', 'read', 'Matters'),
    code(
      'Classify message',
      [
        "const msg = $('WhatsApp message').first().json.messages?.[0];",
        'if (!msg) return [{ json: { route: 5 } }];',
        "const settings = Object.fromEntries($('Read settings').all().map(i => [i.json.Key, String(i.json.Value ?? '')]));",
        "const digits = s => String(s ?? '').replace(/[^0-9]/g, '');",
        "const list = key => (settings[key] ?? '').split(/[;,]/).map(p => digits(p.split('=').pop())).filter(Boolean);",
        'const from = digits(msg.from);',
        "const text = msg.type === 'text' ? String(msg.text?.body ?? '').trim() : '';",
        "const payload = msg.type === 'button' ? msg.button?.payload : (msg.interactive?.button_reply?.id ?? null);",
        'const base = {',
        "  from, text, payload, kind: payload ? 'button' : (text ? 'text' : 'media'),",
        '  mediaId: msg.image?.id ?? msg.document?.id ?? null, mediaType: msg.type,',
        '};',
        "if (/^stop$/i.test(text)) return [{ json: { ...base, route: 4, routeName: 'optout' } }];",
        "if (list('Opted-out numbers').includes(from)) return [{ json: { ...base, route: 5, routeName: 'ignore' } }];",
        "const attorney = list('Attorney WhatsApp numbers').includes(from);",
        'if (attorney && /^deadline:/i.test(text)) {',
        "  return [{ json: { ...base, route: 1, routeName: 'deadline', note: text.replace(/^deadline:\\s*/i, '') } }];",
        '}',
        "if (attorney || payload) return [{ json: { ...base, route: 0, routeName: 'approval' } }];",
        "const client = $('Read matters').all().some(i => digits(i.json['Client WhatsApp']) === from);",
        "return [{ json: { ...base, route: client ? 2 : 3, routeName: client ? 'client' : 'reception' } }];",
      ].join('\n'),
    ),
    node('Route message', T.switch, { mode: 'expression', numberOutputs: 6, output: '={{ $json.route }}' }),
    callWorkflow('To Approval replies', 'Approval replies'),
    callWorkflow('To Deadlines', 'Deadlines'),
    callWorkflow('To Client updates', 'Client updates'),
    callWorkflow('To Reception', 'Reception'),
    sheets(
      'Record opt-out',
      'update',
      'Settings',
      {
        Key: 'Opted-out numbers',
        Value: `={{ [${setting('Opted-out numbers')}, ${msg}.from].filter(Boolean).join(';') }}`,
      },
      'Key',
    ),
    waText(
      'Confirm opt-out',
      `${msg}.from`,
      "'Done — you will not receive further messages from this number. To start again, please call the office.'",
    ),
    log('Log opt-out', 'Inbound router', 'opted_out', `${msg}.from`),
    node('Ignore', T.noOp, {}),
  ];

  return workflow('Inbound router', nodes, [
    ['WhatsApp message', 'Read settings'],
    ['Read settings', 'Read matters'],
    ['Read matters', 'Classify message'],
    ['Classify message', 'Route message'],
    ['Route message', 'To Approval replies', 0],
    ['Route message', 'To Deadlines', 1],
    ['Route message', 'To Client updates', 2],
    ['Route message', 'To Reception', 3],
    ['Route message', 'Record opt-out', 4],
    ['Route message', 'Ignore', 5],
    ['Record opt-out', 'Confirm opt-out'],
    ['Confirm opt-out', 'Log opt-out'],
  ]);
}
