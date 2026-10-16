import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (tab) =>
  readFileSync(new URL(`../register/${tab}.csv`, import.meta.url), 'utf8').trim().split('\n');

// Spec §4 column names, without the descriptive hints in brackets.
const TABS = {
  Matters: [
    'MatterID', 'Client name', 'Client WhatsApp', 'Client email', 'Matter type', 'Opposing party',
    'Stage', 'Responsible attorney', 'Outstanding items', 'Reminders sent', 'Next step',
    'Last client update', 'Drive folder link', 'Opened', 'Status',
  ],
  Enquiries: [
    'Received at', 'Name', 'WhatsApp', 'Matter type', 'Summary', 'Conflict result',
    'Consultation slot', 'Status',
  ],
  Deadlines: [
    'DeadlineID', 'MatterID', 'Description', 'Trigger date', 'Rule', 'Computed due date',
    'Confirmed', 'Calendar event ID',
  ],
  Time: ['Date', 'MatterID', 'Activity', 'Suggested minutes', 'Confirmed minutes', 'Billed'],
  Invoices: ['Invoice no.', 'MatterID', 'Amount', 'Issued', 'Due', 'Status', 'Reminders sent'],
  Approvals: [
    'ApprovalID', 'Agent', 'MatterID', 'Recipient', 'Draft text', 'Status', 'Edit until',
    'Decided at', 'Decided by', 'Resume URL',
  ],
  Log: ['Timestamp', 'Agent', 'MatterID', 'Action', 'Detail'],
};

const SETTINGS_KEYS = [
  'Firm name', 'Attorney WhatsApp numbers', 'Office hours', 'Consultation slot rules',
  'Extra public holidays', 'Auto-send booking confirmations', 'Auto-send document reminders',
  'Auto-send payment reminders', 'Opted-out numbers', 'WhatsApp phone number ID', 'Hourly rate (R)',
];

for (const [tab, columns] of Object.entries(TABS)) {
  test(`${tab} tab has exactly the spec's columns and no data`, () => {
    const lines = read(tab);
    assert.deepEqual(lines[0].split(','), columns);
    assert.equal(lines.length, 1, 'no sample data rows');
  });
}

test('Settings is a key/value tab with every switch off by default', () => {
  const [header, ...rows] = read('Settings');
  assert.equal(header, 'Key,Value');
  const pairs = rows.map((row) => {
    const comma = row.indexOf(',');
    return [row.slice(0, comma), row.slice(comma + 1)];
  });
  assert.deepEqual(pairs.map(([key]) => key), SETTINGS_KEYS);
  for (const [key, value] of pairs) {
    if (key.startsWith('Auto-send')) assert.equal(value, 'No', key);
  }
});
