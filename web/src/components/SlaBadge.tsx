import type { SlaState } from '../api/types.ts';
import { formatRemaining } from '../lib/format.ts';

/**
 * Renders an SLA clock.
 *
 * IMPORTANT: the backend is the sole source of truth for SLA state. This
 * component only displays `state` and `remainingMinutes` exactly as the API
 * returned them. It must never compute business hours, decide whether a
 * deadline has passed, or derive a percentage consumed — the business-hours
 * calendar, holidays and the 75% at-risk boundary all live server-side.
 *
 * A local countdown may tick the displayed minutes down between polls, but it
 * must not flip ON_TRACK into AT_RISK or BREACHED on its own; the page refetches
 * to learn about a state change instead.
 */
export function SlaBadge({
  state,
  remainingMinutes,
  label,
}: {
  state: SlaState;
  remainingMinutes: number;
  label?: string;
}): React.JSX.Element {
  const text: Record<SlaState, string> = {
    ON_TRACK: 'On track',
    AT_RISK: 'At risk',
    BREACHED: 'Breached',
    MET: 'Met',
  };

  return (
    <span className="sla">
      {label !== undefined && <span className="sla__label">{label}</span>}
      <span className={`badge badge--${state.toLowerCase().replace('_', '-')}`}>
        {text[state]}
      </span>
      {/* A met clock has stopped, so a countdown would be meaningless. */}
      {state !== 'MET' && (
        <span className="sla__remaining">{formatRemaining(remainingMinutes)}</span>
      )}
    </span>
  );
}
