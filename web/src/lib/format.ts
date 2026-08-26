/**
 * Renders a business-minute count as "2h 14m".
 *
 * The number comes straight from the API — the frontend never derives it.
 */
export function formatRemaining(minutes: number): string {
  if (minutes <= 0) return 'overdue';

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${String(rest)}m`;
  if (rest === 0) return `${String(hours)}h`;
  return `${String(hours)}h ${String(rest)}m`;
}

/** Formats an ISO timestamp in the viewer's own timezone. */
export function formatDateTime(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

/** Turns an enum value like IN_PROGRESS into "In progress". */
export function humanise(value: string): string {
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
