/**
 * Error alert — set as the error workflow of every other workflow (see SETUP.md).
 *
 * When any agent fails, each attorney gets a system_alert template naming the workflow
 * and the step. A failure therefore sends nothing to a client — only this alert.
 * A template is used because attorneys are usually outside WhatsApp's 24-hour window.
 */

import { T, code, log, node, readSettings, waTemplate, workflow } from '../lib/n8n.mjs';

const error = "$('On error').first().json";

export function build() {
  const nodes = [
    node('On error', T.errorTrigger, {}),
    readSettings(),
    code(
      'Attorney numbers',
      [
        "const raw = $('Read settings').all().find(i => i.json.Key === 'Attorney WhatsApp numbers')?.json.Value ?? '';",
        'return String(raw).split(/[;,]/)',
        "  .map(p => p.split('=').pop().replace(/[^0-9]/g, ''))",
        '  .filter(Boolean)',
        '  .map(number => ({ json: { number } }));',
      ].join('\n'),
    ),
    waTemplate(
      'Alert attorneys',
      'system_alert',
      '$json.number',
      `[${error}.workflow?.name ?? 'An agent', ${error}.execution?.lastNodeExecuted ?? 'unknown', String(${error}.execution?.error?.message ?? 'unknown error').slice(0, 200)]`,
    ),
    log('Log alert', 'Error alert', 'error_alert', `${error}.workflow?.name`),
  ];

  return workflow('Error alert', nodes, [
    ['On error', 'Read settings'],
    ['Read settings', 'Attorney numbers'],
    ['Attorney numbers', 'Alert attorneys'],
    ['Alert attorneys', 'Log alert'],
  ]);
}
