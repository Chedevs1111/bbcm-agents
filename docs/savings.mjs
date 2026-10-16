/**
 * Savings and payback maths for the BBCM Agents calculator (docs/index.html).
 * Pure functions, no dependencies — the page and the tests import the same file.
 */

/** Spec §11 illustrative figures: 2 attorneys + 1 secretary. */
export const DEFAULTS = {
  attorneys: 2,
  staffMonthlySalary: 18000,
  staffHoursPerMonth: 165,
  hoursSaved: { reception: 20, chasing: 15, diary: 8, billing: 6 },
  recoveredHoursPerAttorney: 5,
  attorneyRate: 1200,
  runningCostPerMonth: 1500,
  price: 20000,
};

/**
 * Staff hours saved are valued at the staff member's hourly cost; recovered attorney
 * hours at the attorney's rate. Rand values round to whole rand; payback rounds to one
 * decimal, and is null when the agents cost as much as (or more than) they save.
 */
export function computeSavings(input) {
  const {
    attorneys,
    staffMonthlySalary,
    staffHoursPerMonth = 165,
    hoursSaved,
    recoveredHoursPerAttorney,
    attorneyRate,
    runningCostPerMonth,
    price,
  } = input;
  const staffHours = Object.values(hoursSaved).reduce((sum, h) => sum + Number(h || 0), 0);
  const staffValue = staffHours * (staffMonthlySalary / staffHoursPerMonth);
  const recoveredValue = attorneys * recoveredHoursPerAttorney * attorneyRate;
  const monthlyValue = staffValue + recoveredValue;
  const netMonthly = monthlyValue - runningCostPerMonth;
  return {
    staffHours,
    staffValue: Math.round(staffValue),
    recoveredValue: Math.round(recoveredValue),
    monthlyValue: Math.round(monthlyValue),
    netMonthly: Math.round(netMonthly),
    paybackMonths: netMonthly > 0 ? Math.round((price / netMonthly) * 10) / 10 : null,
  };
}

/** R17 345 — a space between thousands, by hand, so every browser shows the same. */
export function rand(value) {
  const digits = String(Math.abs(Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${value < 0 ? '-' : ''}R${digits}`;
}
