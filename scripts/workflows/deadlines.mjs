/**
 * Deadlines — turns an attorney's note into a confirmed diary entry.
 *
 * Input (from the Inbound router): { from, note }, e.g. "summons served 3 Oct, matter 2026-014".
 * Claude extracts the event, date and rule; the date maths is src/deadlines.mjs, inlined
 * here byte for byte (the tested code is the running code). Every deadline goes to the
 * attorney for approval — there is no auto-send path — and only then enters the diary,
 * with reminders 7, 3 and 1 days before. Nothing here deletes or moves a diary entry.
 */

import { readFileSync } from 'node:fs';
import { T, callWorkflow, claude, code, gate, log, node, readSettings, sheets, waText, workflow } from '../lib/n8n.mjs';

const MODULE = readFileSync(new URL('../../src/deadlines.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');

const ADAPTER = `
// ---- Adapter: n8n items in, one deadline out ----
const input = $('When called').first().json;
const settings = Object.fromEntries($('Read settings').all().map(i => [i.json.Key, String(i.json.Value ?? '')]));
const extra = String(settings['Extra public holidays'] || '').split(/[;,\\s]+/).filter(Boolean);
let ai = {};
try { ai = JSON.parse($('Understand note').first().json.content[0].text); } catch {}
const rule = RULES[ai.ruleKey]
  ?? (ai.courtDays ? { type: 'court_days', n: ai.courtDays, label: ai.courtDays + ' court days' }
  : ai.calendarDays ? { type: 'calendar_days', n: ai.calendarDays, label: ai.calendarDays + ' calendar days' } : null);
let due = null;
try { if (rule && ai.triggerDate) due = computeDeadline(rule, ai.triggerDate, extra); } catch {}
const base = { agent: 'Deadlines', recipient: input.from, recipientName: 'the diary', attorneyNumber: input.from };
if (!due) return [{ json: { ...base, ok: false } }];
return [{ json: { ...base, ok: true, deadlineId: 'D-' + Date.now(), matterId: ai.matterId ?? '', event: ai.event ?? input.note,
  triggerDate: ai.triggerDate, rule: rule.label, due,
  draft: \`Diary: matter \${ai.matterId ?? '?'} — \${ai.event ?? input.note} on \${ai.triggerDate} → due \${due} (\${rule.label})\` } }];
`;

const SYSTEM =
  "Extract a legal deadline from a South African attorney's note. Dates are day-first. Reply with JSON only: " +
  '{"matterId": string|null, "event": string, "triggerDate": "YYYY-MM-DD"|null, ' +
  '"ruleKey": "notice_of_intention_to_defend"|"prescription_debt"|null, "courtDays": number|null, "calendarDays": number|null}.';

const d = "$('Compute deadline').first().json";

export function build() {
  const nodes = [
    node('When called', T.executeWorkflowTrigger, { inputSource: 'passthrough' }),
    readSettings(),
    claude('Understand note', SYSTEM, "$('When called').first().json.note"),
    code('Compute deadline', `${MODULE}\n${ADAPTER}`),
    gate('Understood?', '$json.ok === true'),
    sheets('Record deadline', 'append', 'Deadlines', {
      DeadlineID: `={{ ${d}.deadlineId }}`,
      MatterID: `={{ ${d}.matterId }}`,
      Description: `={{ ${d}.event }}`,
      'Trigger date': `={{ ${d}.triggerDate }}`,
      Rule: `={{ ${d}.rule }}`,
      'Computed due date': `={{ ${d}.due }}`,
      Confirmed: 'N',
    }),
    callWorkflow('Ask for approval', 'Request approval'),
    gate('Approved?', "['approved', 'edited'].includes($json.decision)"),
    node(
      'Add to diary',
      T.googleCalendar,
      {
        resource: 'event',
        operation: 'create',
        calendar: { __rl: true, mode: 'list', value: 'primary', cachedResultName: 'Firm diary' },
        start: `={{ ${d}.due }}T08:00:00`,
        end: `={{ ${d}.due }}T09:00:00`,
        useDefaultReminders: false,
        additionalFields: {
          summary: `=DEADLINE: {{ ${d}.event }} ({{ ${d}.matterId }})`,
          description: `={{ ${d}.draft }}`,
        },
        remindersUi: {
          remindersValues: [
            { method: 'popup', minutes: 10080 },
            { method: 'popup', minutes: 4320 },
            { method: 'popup', minutes: 1440 },
          ],
        },
      },
      { googleCalendarOAuth2Api: { name: 'BBCM Google' } },
    ),
    sheets(
      'Mark confirmed',
      'update',
      'Deadlines',
      { DeadlineID: `={{ ${d}.deadlineId }}`, Confirmed: 'Y', 'Calendar event ID': '={{ $json.id }}' },
      'DeadlineID',
    ),
    waText(
      'Ask attorney to rephrase',
      "$('When called').first().json.from",
      "'I could not work out a date from that note. Please send: deadline: <event> on <date>, matter <number>.'",
    ),
    log('Log unclear note', 'Deadlines', 'note_unclear', "$('When called').first().json.note"),
  ];

  return workflow('Deadlines', nodes, [
    ['When called', 'Read settings'],
    ['Read settings', 'Understand note'],
    ['Understand note', 'Compute deadline'],
    ['Compute deadline', 'Understood?'],
    ['Understood?', 'Record deadline', 0],
    ['Understood?', 'Ask attorney to rephrase', 1],
    ['Record deadline', 'Ask for approval'],
    ['Ask for approval', 'Approved?'],
    ['Approved?', 'Add to diary', 0],
    ['Add to diary', 'Mark confirmed'],
    ['Ask attorney to rephrase', 'Log unclear note'],
  ]);
}
