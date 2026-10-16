/**
 * South African deadline arithmetic.
 *
 * Self-contained on purpose — no imports — because the Deadlines and Billing
 * workflows inline this exact source into an n8n Code node. The code the tests
 * check is the code the agents run.
 *
 * Dates are ISO strings (YYYY-MM-DD) and all arithmetic is done in UTC, so no
 * timezone can shift a deadline by a day. Anything unparseable throws RangeError:
 * a deadline is never guessed.
 */

const DAY = 86_400_000;

// Public Holidays Act 36 of 1994, fixed-date holidays (month-day).
const FIXED_HOLIDAYS = [
  '01-01', '03-21', '04-27', '05-01', '06-16', '08-09', '09-24', '12-16', '12-25', '12-26',
];

function parseIso(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new RangeError(`Invalid date: ${iso}`);
  }
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const check = new Date(t);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Invalid date: ${iso}`);
  }
  return t;
}

function toIso(t) {
  return new Date(t).toISOString().slice(0, 10);
}

function weekday(t) {
  return new Date(t).getUTCDay();
}

function requireCount(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Invalid number: ${n}`);
}

/** Easter Sunday — anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

/**
 * Every public holiday in a year. A holiday on a Sunday makes the next day that is
 * not already a holiday a holiday too — usually the Monday, but the Tuesday when a
 * Sunday Christmas is followed by the Day of Goodwill. `extra` adds ad hoc days the
 * President declares (election days and the like).
 */
export function holidaysFor(year, extra = []) {
  const easter = easterSunday(year);
  const base = [
    ...FIXED_HOLIDAYS.map((md) => parseIso(`${year}-${md}`)),
    easter - 2 * DAY, // Good Friday
    easter + DAY, // Family Day
  ].sort((x, y) => x - y);

  const days = new Set(base.map(toIso));
  for (const t of base) {
    if (weekday(t) !== 0) continue;
    let next = t + DAY;
    while (days.has(toIso(next))) next += DAY;
    days.add(toIso(next));
  }
  for (const iso of extra) {
    parseIso(iso);
    days.add(iso);
  }
  return days;
}

function isHoliday(t, extra) {
  return holidaysFor(new Date(t).getUTCFullYear(), extra).has(toIso(t));
}

/** Not a Saturday, Sunday or public holiday. */
export function isCourtDay(iso, extra = []) {
  const t = parseIso(iso);
  const wd = weekday(t);
  return wd !== 0 && wd !== 6 && !isHoliday(t, extra);
}

function inFestivePeriod(t) {
  const d = new Date(t);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return (month === 12 && day >= 16) || (month === 1 && day <= 15);
}

/**
 * The date `n` court days after `iso`. The first day is excluded; only court days
 * count. With `festiveDiesNon`, 16 December to 15 January are not counted either.
 */
export function addCourtDays(iso, n, { extra = [], festiveDiesNon = false } = {}) {
  let t = parseIso(iso);
  requireCount(n);
  let counted = 0;
  while (counted < n) {
    t += DAY;
    if (!isCourtDay(toIso(t), extra)) continue;
    if (festiveDiesNon && inFestivePeriod(t)) continue;
    counted += 1;
  }
  return toIso(t);
}

/**
 * The date `n` calendar days after `iso` (Interpretation Act 33 of 1957, s4): when the
 * last day is a Sunday or public holiday, it moves to the next day that is neither.
 */
export function addCalendarDays(iso, n, extra = []) {
  requireCount(n);
  let t = parseIso(iso) + n * DAY;
  while (weekday(t) === 0 || isHoliday(t, extra)) t += DAY;
  return toIso(t);
}

/** The same date `n` years later; 29 February becomes 28 February in a common year. */
export function addYears(iso, n) {
  const t = parseIso(iso);
  requireCount(n);
  const d = new Date(t);
  const year = d.getUTCFullYear() + n;
  const month = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toIso(Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay)));
}

export const RULES = {
  notice_of_intention_to_defend: {
    type: 'court_days',
    n: 10,
    label: 'Notice of intention to defend — 10 court days after service',
  },
  prescription_debt: {
    type: 'years',
    n: 3,
    label: 'Prescription of an ordinary debt — 3 years (Prescription Act 68 of 1969)',
  },
};

/** Apply a rule ({ type, n, festiveDiesNon? }) to a trigger date. */
export function computeDeadline(rule, triggerIso, extra = []) {
  switch (rule?.type) {
    case 'court_days':
      return addCourtDays(triggerIso, rule.n, { extra, festiveDiesNon: Boolean(rule.festiveDiesNon) });
    case 'calendar_days':
      return addCalendarDays(triggerIso, rule.n, extra);
    case 'years':
      return addYears(triggerIso, rule.n);
    default:
      throw new RangeError(`Unknown rule type: ${rule?.type}`);
  }
}
