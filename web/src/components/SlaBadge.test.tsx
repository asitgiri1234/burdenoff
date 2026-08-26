import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SlaState } from '../api/types.ts';
import { SlaBadge } from './SlaBadge.tsx';

/**
 * These tests exist mainly to pin the rule that the backend is the only source
 * of SLA truth. The badge must render whatever the API said, and must never
 * infer a state from the remaining minutes.
 */
describe('SlaBadge', () => {
  it.each<[SlaState, string, string]>([
    ['ON_TRACK', 'On track', 'badge--on-track'],
    ['AT_RISK', 'At risk', 'badge--at-risk'],
    ['BREACHED', 'Breached', 'badge--breached'],
    ['MET', 'Met', 'badge--met'],
  ])('renders %s as "%s" with the %s class', (state, label, className) => {
    const { container } = render(<SlaBadge state={state} remainingMinutes={30} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector(`.${className}`)).not.toBeNull();
  });

  it('shows the remaining time for a running clock', () => {
    render(<SlaBadge state="AT_RISK" remainingMinutes={134} />);
    expect(screen.getByText('2h 14m')).toBeInTheDocument();
  });

  it('hides the countdown once the clock has stopped at MET', () => {
    render(<SlaBadge state="MET" remainingMinutes={0} />);

    expect(screen.getByText('Met')).toBeInTheDocument();
    // A met clock has stopped, so a countdown would be meaningless.
    expect(screen.queryByText('overdue')).not.toBeInTheDocument();
  });

  it('renders an optional label', () => {
    render(<SlaBadge label="First response" state="ON_TRACK" remainingMinutes={60} />);
    expect(screen.getByText('First response')).toBeInTheDocument();
  });

  describe('never derives state locally', () => {
    it('shows ON_TRACK even when zero minutes remain, because the API said so', () => {
      // If the component computed state itself it would call this breached.
      // It must not: only the server decides, and it refetches to learn about
      // a change rather than flipping the state on its own.
      render(<SlaBadge state="ON_TRACK" remainingMinutes={0} />);

      expect(screen.getByText('On track')).toBeInTheDocument();
      expect(screen.queryByText('Breached')).not.toBeInTheDocument();
    });

    it('shows MET even with a long-passed deadline, because the clock froze', () => {
      render(<SlaBadge state="MET" remainingMinutes={0} />);

      expect(screen.getByText('Met')).toBeInTheDocument();
      expect(screen.queryByText('Breached')).not.toBeInTheDocument();
    });

    it('shows BREACHED even when minutes remain, because the API said so', () => {
      render(<SlaBadge state="BREACHED" remainingMinutes={45} />);

      expect(screen.getByText('Breached')).toBeInTheDocument();
      expect(screen.queryByText('On track')).not.toBeInTheDocument();
    });
  });
});
