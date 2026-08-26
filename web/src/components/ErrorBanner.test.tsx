import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/errors.ts';
import { ErrorBanner, SuccessBanner } from './ErrorBanner.tsx';
import { FieldError } from './FieldError.tsx';

describe('ErrorBanner', () => {
  it('renders nothing when there is no error', () => {
    const { container } = render(<ErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for undefined', () => {
    const { container } = render(<ErrorBanner error={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces a failure to assistive technology', () => {
    render(<ErrorBanner error={new ApiError('nope', 'FORBIDDEN')} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("You don't have permission to do that.");
  });

  it('shows a transition error using the server wording', () => {
    const message = 'Ticket cannot transition from CLOSED to IN_PROGRESS.';
    render(<ErrorBanner error={new ApiError(message, 'INVALID_STATUS_TRANSITION')} />);

    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('never leaves an unrecognised failure silent', () => {
    render(<ErrorBanner error={new Error('kaboom')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('kaboom');
  });
});

describe('SuccessBanner', () => {
  it('renders nothing without a message', () => {
    const { container } = render(<SuccessBanner message={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a status message', () => {
    render(<SuccessBanner message="Comment added." />);
    expect(screen.getByRole('status')).toHaveTextContent('Comment added.');
  });
});

describe('FieldError', () => {
  const error = new ApiError('Invalid input', 'VALIDATION_ERROR', [
    { path: 'password', message: 'Password must be at least 8 characters' },
  ]);

  it('shows the server message for the matching field', () => {
    render(<FieldError error={error} path="password" />);
    expect(
      screen.getByText('Password must be at least 8 characters'),
    ).toBeInTheDocument();
  });

  it('renders nothing for a field the server did not flag', () => {
    const { container } = render(<FieldError error={error} path="email" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when there is no error at all', () => {
    const { container } = render(<FieldError error={null} path="password" />);
    expect(container).toBeEmptyDOMElement();
  });
});
