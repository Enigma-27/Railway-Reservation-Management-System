/**
 * Unified Formatting Utilities for Railway Reservation & Management System
 * Enforces strict date and currency conventions:
 * 1. All date-times from API are India time strings "YYYY-MM-DD HH:MM:SS" without Z.
 *    NEVER pass them to new Date() and never convert time zones.
 *    Formatted as: "27 Oct 2026, 14:30" or "27 Oct 2026".
 * 2. Money formatted with ₹ prefix and Indian number grouping (e.g. ₹1,234.50).
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatIndiaDateTime(dateStr: string | null | undefined): string {
  if (!dateStr || typeof dateStr !== 'string') return '—';
  const cleaned = dateStr.replace(/Z$/, '').trim();
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return dateStr;
  const [, year, month, day, hour, min] = match;
  const monthName = MONTH_NAMES[parseInt(month, 10) - 1] || month;
  const dayNum = parseInt(day, 10);
  if (hour !== undefined && min !== undefined) {
    return `${dayNum} ${monthName} ${year}, ${hour}:${min}`;
  }
  return `${dayNum} ${monthName} ${year}`;
}

/**
 * India-time helpers for the staff portal. The browser's own time zone is never used:
 * every value is formatted with timeZone 'Asia/Kolkata', and no "Z" / ISO string is produced.
 */
function indiaParts(now: Date): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const map: Record<string, string> = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  return map;
}

/** Today's date in India as "YYYY-MM-DD". */
export function todayIndiaDate(now: Date = new Date()): string {
  const p = indiaParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Current India date and time as "YYYY-MM-DD HH:MM:SS" (same shape the server sends). */
export function nowIndiaDateTime(now: Date = new Date()): string {
  const p = indiaParts(now);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Clock text for headers, for example "19 Nov 2026  13:45:10" (India time). */
export function indiaClockLabel(now: Date = new Date()): string {
  const p = indiaParts(now);
  return `${parseInt(p.day, 10)} ${MONTH_NAMES[parseInt(p.month, 10) - 1]} ${p.year}  ${p.hour}:${p.minute}:${p.second}`;
}

export function formatCurrency(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '₹0.00';
  const num = Number(amount);
  if (isNaN(num)) return '₹0.00';
  return '₹' + num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
