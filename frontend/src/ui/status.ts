/**
 * ONE mapping from a status word to a colour chip, used the same way on every page:
 * confirmed = green, RAC = amber, waiting = orange, cancelled = red, delayed = violet, everything else = blue (info).
 * The chip classes live in public/rrms-theme.css (rrms-badge-confirmed, -rac, -waiting, -cancelled, -delayed, -info).
 */
export function statusChip(status: string | null | undefined): string {
  const s = String(status || '').toUpperCase().replace(/\s+/g, '_');
  if (['CONFIRMED', 'AVAILABLE', 'ON_TIME', 'RUNNING', 'ACTIVE', 'APPROVED', 'SUCCESS', 'PAID', 'RESOLVED', 'ON_DUTY', 'BOARDED', 'VALID', 'DONE', 'PROCESSED', 'COMPLETED'].includes(s)) return 'rrms-badge-confirmed';
  if (s.startsWith('RAC') || ['UNDER_REVIEW', 'PENDING', 'ATTENDING', 'IN_PROGRESS', 'MODERATE', 'MEDIUM', 'PAYMENT_PENDING', 'MISMATCH', 'NEW'].includes(s)) return 'rrms-badge-rac';
  if (s.startsWith('WL') || s === 'WAITING_LIST' || s === 'WAITING') return 'rrms-badge-waiting';
  if (['CANCELLED', 'SUSPENDED', 'FAILED', 'REJECTED', 'UNPAID', 'CRITICAL', 'HIGH', 'OVERCROWDED', 'NO_SHOW', 'INVALID', 'NOT_AVAILABLE'].includes(s)) return 'rrms-badge-cancelled';
  if (s === 'DELAYED') return 'rrms-badge-delayed';
  return 'rrms-badge-info';
}
