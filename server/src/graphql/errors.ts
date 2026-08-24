import { GraphQLError } from 'graphql';

/**
 * Machine-readable error codes surfaced to clients as `extensions.code`.
 *
 * UNAUTHORIZED and FORBIDDEN are deliberately distinct:
 *   UNAUTHORIZED — no valid session; the client should log in.
 *   FORBIDDEN    — a valid session that is not permitted to do this.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  TICKET_NOT_FOUND: 'TICKET_NOT_FOUND',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  INVALID_PRIORITY: 'INVALID_PRIORITY',
  INVALID_COMMENT: 'INVALID_COMMENT',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** A single field-level validation failure, shaped for direct form rendering. */
export interface FieldError {
  /** Dot-joined path to the offending input field, e.g. `password`. */
  readonly path: string;
  readonly message: string;
}

/**
 * Base factory. Every error thrown by this API carries a code, so clients
 * branch on `extensions.code` rather than on message text.
 */
function apiError(
  code: ErrorCode,
  message: string,
  extensions: Readonly<Record<string, unknown>> = {},
): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code, ...extensions },
  });
}

/**
 * Input failed validation. Carries `extensions.fieldErrors` so the frontend can
 * attach messages to individual form fields instead of showing one banner.
 */
export function validationError(
  message: string,
  fieldErrors: readonly FieldError[] = [],
): GraphQLError {
  return apiError(ERROR_CODES.VALIDATION_ERROR, message, { fieldErrors });
}

/** Not authenticated — no token, or a token that did not verify. */
export function unauthorized(message = 'You must be signed in to do that'): GraphQLError {
  return apiError(ERROR_CODES.UNAUTHORIZED, message);
}

/** Authenticated, but not permitted to perform this action. */
export function forbidden(message = 'You do not have permission to do that'): GraphQLError {
  return apiError(ERROR_CODES.FORBIDDEN, message);
}

export function ticketNotFound(id: string): GraphQLError {
  return apiError(ERROR_CODES.TICKET_NOT_FOUND, `Ticket ${id} not found`, { id });
}

export function userNotFound(id: string): GraphQLError {
  return apiError(ERROR_CODES.USER_NOT_FOUND, `User ${id} not found`, { id });
}

/** Generic not-found dispatcher for the two entities that have their own code. */
export function notFound(entity: 'ticket' | 'user', id: string): GraphQLError {
  return entity === 'ticket' ? ticketNotFound(id) : userNotFound(id);
}

export function invalidStatusTransition(from: string, to: string): GraphQLError {
  return apiError(
    ERROR_CODES.INVALID_STATUS_TRANSITION,
    `Cannot move a ticket from ${from} to ${to}`,
    { from, to },
  );
}

export function invalidPriority(priority: string): GraphQLError {
  return apiError(ERROR_CODES.INVALID_PRIORITY, `Invalid priority "${priority}"`, { priority });
}

export function invalidComment(message = 'Comment is not valid'): GraphQLError {
  return apiError(ERROR_CODES.INVALID_COMMENT, message);
}

/**
 * True for errors this API raised on purpose.
 *
 * Used by the Yoga error mask: our own errors are already safe to show and must
 * keep their codes, while anything else (a Prisma failure, a TypeError) is an
 * internal detail and gets masked in production.
 */
export function isApiError(error: unknown): error is GraphQLError {
  if (!(error instanceof GraphQLError)) return false;
  const code = error.extensions['code'];
  return typeof code === 'string' && code in ERROR_CODES;
}
