import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  RULES,
  addCalendarDays,
  addCourtDays,
  addYears,
  computeDeadline,
  holidaysFor,
  isCourtDay,
} from '../src/deadlines.mjs';

test('statutory SA holidays for 2026, including Easter and the Sunday rule', () => {
  const h = holidaysFor(2026);
  assert.ok(h.has('2026-04-03'), 'Good Friday');
  assert.ok(h.has('2026-04-06'), 'Family Day');
  assert.ok(h.has('2026-08-10'), '9 Aug is a Sunday, so Monday is a holiday');
  assert.ok(!h.has('2026-03-23'), '21 Mar is a Saturday: no Monday holiday');
  assert.ok(holidaysFor(2026, ['2026-11-04']).has('2026-11-04'), 'extra declared day');
  assert.ok(holidaysFor(2022).has('2022-12-27'), 'Sunday Christmas: Monday is already Goodwill, so Tuesday');
});

test('court days skip weekends and public holidays', () => {
  assert.equal(addCourtDays('2026-10-16', 10), '2026-10-30');
  assert.equal(addCourtDays('2026-04-01', 3), '2026-04-08');
  assert.equal(addCourtDays('2026-12-30', 3), '2027-01-05');
  assert.equal(addCourtDays('2026-10-17', 1), '2026-10-19');
  assert.equal(isCourtDay('2026-04-03'), false);
  assert.equal(isCourtDay('2026-10-19'), true);
});

test('festive dies non skips 16 Dec to 15 Jan only when the rule asks', () => {
  assert.equal(addCourtDays('2026-12-14', 3, { festiveDiesNon: true }), '2027-01-19');
});

test('calendar days move a Sunday or holiday end to the next ordinary day', () => {
  assert.equal(addCalendarDays('2026-08-05', 4), '2026-08-11');
});

test('years keep the date, and 29 February becomes 28 February', () => {
  assert.equal(addYears('2028-02-29', 3), '2031-02-28');
  assert.equal(addYears('2026-10-16', 3), '2029-10-16');
});

test('named rules compute through computeDeadline', () => {
  assert.equal(computeDeadline(RULES.notice_of_intention_to_defend, '2026-10-16'), '2026-10-30');
  assert.equal(computeDeadline(RULES.prescription_debt, '2026-10-16'), '2029-10-16');
  assert.deepEqual(Object.keys(RULES).sort(), ['notice_of_intention_to_defend', 'prescription_debt']);
});

test('invalid input is refused, never guessed', () => {
  assert.throws(() => addCourtDays('2026-13-01', 1), RangeError);
  assert.throws(() => addCourtDays('2026-02-30', 1), RangeError);
  assert.throws(() => addCourtDays('2026-10-16', 0), RangeError);
  assert.throws(() => addCourtDays('2026-10-16', 1.5), RangeError);
});

test('the module is self-contained so it can be inlined into an n8n Code node', () => {
  assert.doesNotMatch(readFileSync(new URL('../src/deadlines.mjs', import.meta.url), 'utf8'), /^import /m);
});
