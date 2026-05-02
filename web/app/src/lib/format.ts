/**
 * Display formatting helpers, fully localized.
 *
 * Single source of truth for how dates, numbers, durations, and units
 * appear in the UI. Every call uses the user's browser locale by default
 * (`navigator.language`) — no more hardcoded `'en-US'` sprinkled in pages.
 *
 * Why: A1DE will have non-US users (family members in different locales,
 * eventual iOS app abroad). Hardcoding 'en-US' makes "Apr 15" for someone
 * who'd write "15 Apr" — small papercut on every screen.
 *
 * Server-rendered pages need the locale at render time. Until we wire
 * Accept-Language through middleware, server-side calls fall back to the
 * default ICU formatting (which uses 'en-US' under the hood). The client
 * components re-render with the right locale on hydrate.
 */

/** Resolve the user's locale from the browser. SSR-safe. */
export function getLocale(): string {
  if (typeof navigator === 'undefined') return 'en-US';
  return navigator.language || navigator.languages?.[0] || 'en-US';
}

/**
 * Whether the user's locale prefers imperial measurements.
 * Used to decide whether to display weight in lbs vs kg, height in in vs cm.
 *
 * Heuristic: only en-US, en-LR, en-MM use imperial day-to-day. Everything
 * else is metric. We don't try to be exhaustive — when we add a profile
 * setting later it'll override this.
 */
export function prefersImperial(locale = getLocale()): boolean {
  const tag = locale.toLowerCase();
  return tag === 'en-us' || tag.startsWith('en-us-') || tag === 'en-lr' || tag === 'en-mm';
}

// ──────────────────────────────────────────────────────────────────────
// Numbers + counts
// ──────────────────────────────────────────────────────────────────────

const numberCache = new Map<string, Intl.NumberFormat>();

function getNumberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + JSON.stringify(options);
  let f = numberCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    numberCache.set(key, f);
  }
  return f;
}

/** "1,234" in en-US, "1.234" in de-DE. Use for any user-visible count. */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return getNumberFormat(getLocale(), options ?? {}).format(n);
}

/** "12.34%" — value is the raw percentage, not a fraction. */
export function formatPercent(value: number, fractionDigits = 0): string {
  return getNumberFormat(getLocale(), {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  }).format(value) + '%';
}

// ──────────────────────────────────────────────────────────────────────
// Dates + times
// ──────────────────────────────────────────────────────────────────────

const dateCache = new Map<string, Intl.DateTimeFormat>();

function getDateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(options);
  let f = dateCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    dateCache.set(key, f);
  }
  return f;
}

function asDate(input: string | Date): Date {
  return input instanceof Date ? input : new Date(input);
}

/** "Apr 15" / "15 Apr" — month + day only. */
export function formatShortDate(input: string | Date): string {
  return getDateFormat(getLocale(), { month: 'short', day: 'numeric' }).format(asDate(input));
}

/** "Apr 15, 2026" / "15 Apr 2026" — month + day + year. */
export function formatDate(input: string | Date): string {
  return getDateFormat(getLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(asDate(input));
}

/** "Wed, Apr 15" — full weekday + short date. Good for calendar rows. */
export function formatWeekdayDate(input: string | Date): string {
  return getDateFormat(getLocale(), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(asDate(input));
}

/** "3:45 PM" / "15:45" — time only, locale's preferred 12/24 hour. */
export function formatTime(input: string | Date): string {
  return getDateFormat(getLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  }).format(asDate(input));
}

/** "Apr 15, 3:45 PM" — concise date + time, no year. */
export function formatDateTime(input: string | Date): string {
  return getDateFormat(getLocale(), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(asDate(input));
}

// ──────────────────────────────────────────────────────────────────────
// Relative time ("5m ago", "2 days ago")
// ──────────────────────────────────────────────────────────────────────

const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

function getRelativeFormat(locale: string): Intl.RelativeTimeFormat {
  let f = relativeCache.get(locale);
  if (!f) {
    f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    relativeCache.set(locale, f);
  }
  return f;
}

const RELATIVE_THRESHOLDS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: 'second', ms: 1000 },
  { unit: 'minute', ms: 60 * 1000 },
  { unit: 'hour', ms: 60 * 60 * 1000 },
  { unit: 'day', ms: 24 * 60 * 60 * 1000 },
  { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
];

/**
 * "now", "5m ago", "2h ago", "3 days ago", "last week".
 * Uses `numeric: 'auto'` so the locale picks "yesterday" over "1 day ago"
 * when natural.
 */
export function formatRelative(input: string | Date): string {
  const date = asDate(input);
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);

  if (absMs < 5000) return 'just now';

  // Pick the largest unit where |value| >= 1.
  let chosenUnit: Intl.RelativeTimeFormatUnit = 'second';
  let chosenValue = diffMs / 1000;
  for (const { unit, ms } of RELATIVE_THRESHOLDS) {
    if (absMs >= ms) {
      chosenUnit = unit;
      chosenValue = diffMs / ms;
    }
  }
  return getRelativeFormat(getLocale()).format(Math.round(chosenValue), chosenUnit);
}

// ──────────────────────────────────────────────────────────────────────
// Units (weight, height, distance)
// ──────────────────────────────────────────────────────────────────────

const KG_TO_LB = 2.20462;
const CM_TO_IN = 0.393701;
const KM_TO_MI = 0.621371;

interface UnitFormatted {
  display: string;
  value: number;
  unit: string;
}

/**
 * Display a weight, converting between kg/lb based on the user's locale.
 * Pass the value in whichever unit your data is in (`unit: 'kg'` or `'lb'`).
 */
export function formatWeight(value: number, unit: 'kg' | 'lb' = 'kg', locale = getLocale()): UnitFormatted {
  const imperial = prefersImperial(locale);
  const targetUnit = imperial ? 'lb' : 'kg';
  let v = value;
  if (unit === 'kg' && imperial) v = value * KG_TO_LB;
  if (unit === 'lb' && !imperial) v = value / KG_TO_LB;
  const display =
    formatNumber(v, { maximumFractionDigits: 1 }) + ` ${targetUnit}`;
  return { display, value: v, unit: targetUnit };
}

/** Height, cm or in. */
export function formatHeight(value: number, unit: 'cm' | 'in' = 'cm', locale = getLocale()): UnitFormatted {
  const imperial = prefersImperial(locale);
  const targetUnit = imperial ? 'in' : 'cm';
  let v = value;
  if (unit === 'cm' && imperial) v = value * CM_TO_IN;
  if (unit === 'in' && !imperial) v = value / CM_TO_IN;
  const display =
    formatNumber(v, { maximumFractionDigits: 1 }) + ` ${targetUnit}`;
  return { display, value: v, unit: targetUnit };
}

/** Distance, km or mi. */
export function formatDistance(value: number, unit: 'km' | 'mi' = 'km', locale = getLocale()): UnitFormatted {
  const imperial = prefersImperial(locale);
  const targetUnit = imperial ? 'mi' : 'km';
  let v = value;
  if (unit === 'km' && imperial) v = value * KM_TO_MI;
  if (unit === 'mi' && !imperial) v = value / KM_TO_MI;
  const display =
    formatNumber(v, { maximumFractionDigits: 2 }) + ` ${targetUnit}`;
  return { display, value: v, unit: targetUnit };
}

/**
 * Generic health-metric display. Compact, locale-aware.
 * Matches the units our health_metrics rows use.
 */
export function formatHealthValue(metric: string, value: number, unit: string): string {
  if (unit === '%') return formatNumber(value, { maximumFractionDigits: 0 }) + '%';
  if (unit === 'bpm') return formatNumber(value, { maximumFractionDigits: 0 }) + ' bpm';
  if (unit === 'ms') return formatNumber(value, { maximumFractionDigits: 0 }) + ' ms';
  if (unit === 'hours') return formatNumber(value, { maximumFractionDigits: 1 }) + 'h';
  if (unit === 'whoop_strain') return formatNumber(value, { maximumFractionDigits: 1 });
  if (unit === 'kJ') return formatNumber(Math.round(value)) + ' kJ';
  if (unit === 'breaths/min') return formatNumber(value, { maximumFractionDigits: 1 }) + ' br/min';
  return `${formatNumber(value)} ${unit}`;
}
