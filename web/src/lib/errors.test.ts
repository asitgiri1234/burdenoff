import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage, fieldErrorFor } from './errors.ts';

describe('errorMessage', () => {
  it('explains UNAUTHORIZED as needing to sign in', () => {
    expect(errorMessage(new ApiError('nope', 'UNAUTHORIZED'))).toBe(
      'You need to sign in to do that.',
    );
  });

  it('explains FORBIDDEN as a permission problem', () => {
    expect(errorMessage(new ApiError('nope', 'FORBIDDEN'))).toBe(
      "You don't have permission to do that.",
    );
  });

  it('shows the server message verbatim for an invalid status transition', () => {
    // The server owns the transition rules, so its wording is shown unchanged
    // rather than paraphrased into something that could drift from them.
    const message = 'Ticket cannot transition from CLOSED to IN_PROGRESS.';
    expect(errorMessage(new ApiError(message, 'INVALID_STATUS_TRANSITION'))).toBe(message);
  });

  it('shows the server message verbatim for an invalid comment', () => {
    expect(errorMessage(new ApiError('Comment cannot be empty', 'INVALID_COMMENT'))).toBe(
      'Comment cannot be empty',
    );
  });

  it('points at the highlighted fields when validation carries field errors', () => {
    const error = new ApiError('Invalid input', 'VALIDATION_ERROR', [
      { path: 'password', message: 'Password must be at least 8 characters' },
    ]);
    expect(errorMessage(error)).toBe('Please correct the highlighted fields.');
  });

  it('falls back to the server message when validation has no field errors', () => {
    expect(errorMessage(new ApiError('Something specific', 'VALIDATION_ERROR'))).toBe(
      'Something specific',
    );
  });

  it('handles the not-found codes', () => {
    expect(errorMessage(new ApiError('x', 'TICKET_NOT_FOUND'))).toBe(
      'That ticket no longer exists.',
    );
    expect(errorMessage(new ApiError('x', 'USER_NOT_FOUND'))).toBe(
      'That user no longer exists.',
    );
  });

  it('uses a generic fallback for an unrecognised code', () => {
    expect(errorMessage(new ApiError('boom', 'SOMETHING_NEW'))).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('surfaces the message of a plain Error, such as a network failure', () => {
    expect(errorMessage(new Error('Cannot reach the server. Is it running?'))).toBe(
      'Cannot reach the server. Is it running?',
    );
  });

  it('never returns an empty string for an unknown thrown value', () => {
    expect(errorMessage(null)).toBe('Something went wrong. Please try again.');
    expect(errorMessage('a string')).toBe('Something went wrong. Please try again.');
    expect(errorMessage(new Error(''))).toBe('Something went wrong. Please try again.');
  });
});

describe('fieldErrorFor', () => {
  const error = new ApiError('Invalid input', 'VALIDATION_ERROR', [
    { path: 'email', message: 'Enter a valid email address' },
    { path: 'password', message: 'Password must be at least 8 characters' },
  ]);

  it('finds the message for a field', () => {
    expect(fieldErrorFor(error, 'email')).toBe('Enter a valid email address');
    expect(fieldErrorFor(error, 'password')).toBe('Password must be at least 8 characters');
  });

  it('returns undefined for a field with no error', () => {
    expect(fieldErrorFor(error, 'name')).toBeUndefined();
  });

  it('returns undefined for a non-ApiError', () => {
    expect(fieldErrorFor(new Error('boom'), 'email')).toBeUndefined();
    expect(fieldErrorFor(null, 'email')).toBeUndefined();
  });
});
