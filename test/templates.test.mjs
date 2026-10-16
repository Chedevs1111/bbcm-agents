import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const templates = JSON.parse(
  readFileSync(new URL('../whatsapp/templates.json', import.meta.url), 'utf8'),
);

const NAMES = [
  'document_reminder', 'status_update', 'appointment_reminder', 'payment_reminder',
  'morning_brief', 'approval_request', 'system_alert',
];
const STAFF_ONLY = new Set(['morning_brief', 'approval_request', 'system_alert']);

test('exactly the spec templates plus system_alert', () => {
  assert.deepEqual(templates.map((t) => t.name), NAMES);
});

for (const t of templates) {
  test(`${t.name} meets Meta's template rules`, () => {
    assert.match(t.name, /^[a-z0-9_]+$/);
    assert.equal(t.language, 'en');
    assert.equal(t.category, 'UTILITY');

    const body = t.components.find((c) => c.type === 'BODY');
    assert.ok(body, 'has a body');
    assert.ok(body.text.length <= 1024, 'body within 1024 characters');
    assert.doesNotMatch(body.text, /^\s*\{\{\d+\}\}/, 'must not start with a variable');
    assert.doesNotMatch(body.text, /\{\{\d+\}\}\s*$/, 'must not end with a variable');

    const vars = [...body.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    assert.deepEqual(vars, vars.map((_, i) => i + 1), 'variables are 1..k in order');
    const examples = body.example.body_text[0];
    assert.equal(examples.length, vars.length, 'one example per variable');
    for (const value of examples) assert.doesNotMatch(value, /\n/, 'no newlines in parameters');

    if (!STAFF_ONLY.has(t.name)) assert.match(body.text, /digital assistant/);
  });
}

test('approval_request carries exactly Approve / Edit / Reject quick replies', () => {
  const t = templates.find((x) => x.name === 'approval_request');
  const buttons = t.components.find((c) => c.type === 'BUTTONS').buttons;
  assert.deepEqual(buttons, [
    { type: 'QUICK_REPLY', text: 'Approve' },
    { type: 'QUICK_REPLY', text: 'Edit' },
    { type: 'QUICK_REPLY', text: 'Reject' },
  ]);
});
