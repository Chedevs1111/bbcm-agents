import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULTS, computeSavings, rand } from '../docs/savings.mjs';

test('the spec §11 illustrative figures: R17 345 a month, paid back in 1.3 months', () => {
  assert.deepEqual(computeSavings(DEFAULTS), {
    staffHours: 49,
    staffValue: 5345,
    recoveredValue: 12000,
    monthlyValue: 17345,
    netMonthly: 15845,
    paybackMonths: 1.3,
  });
});

test('at R15 000 the package pays back in under a month', () => {
  assert.equal(computeSavings({ ...DEFAULTS, price: 15000 }).paybackMonths, 0.9);
});

test('running costs at or above the value delivered never pay back — no negative or infinite payback', () => {
  assert.equal(computeSavings({ ...DEFAULTS, runningCostPerMonth: 20000 }).paybackMonths, null);
  // R16 500 / 165 h = R100 an hour → 49 h = R4 900; + R12 000 recovered = R16 900 exactly.
  const even = computeSavings({ ...DEFAULTS, staffMonthlySalary: 16500, runningCostPerMonth: 16900 });
  assert.equal(even.netMonthly, 0);
  assert.equal(even.paybackMonths, null);
});

test('rand amounts are written with a space between thousands', () => {
  assert.equal(rand(17345), 'R17 345');
  assert.equal(rand(1500), 'R1 500');
  assert.equal(rand(950), 'R950');
  assert.equal(rand(-2655), '-R2 655');
});
