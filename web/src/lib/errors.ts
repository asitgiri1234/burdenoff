/** Field-level validation failure, as the server sends it. */
export interface FieldError {
  path: string;
  message: string;
}

/**
 * An error the API raised deliberately, carrying its machine-readable code.
 *
 * Clients branch on `code`, never on the message text.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly fieldErrors: FieldError[];

  constructor(message: string, code: string, fieldErrors: FieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

/** Looks up the message for a single field, if the server reported one. */
export function fieldErrorFor(error: unknown, path: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  return error.fieldErrors.find((entry) => entry.path === path)?.message;
}

/**
 * Turns any thrown value into the banner text to show.
 *
 * Codes are handled explicitly so the user gets something actionable:
 * permission problems read as permission problems, and a rejected status
 * transition shows the server's own wording rather than a paraphrase that
 * could drift from the rules.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }
    return 'Something went wrong. Please try again.';
  }

  switch (error.code) {
    case 'UNAUTHORIZED':
      return 'You need to sign in to do that.';
    case 'FORBIDDEN':
      return "You don't have permission to do that.";
    case 'INVALID_STATUS_TRANSITION':
      // Shown verbatim: the server owns the transition rules.
      return error.message;
    case 'INVALID_COMMENT':
      return error.message;
    case 'TICKET_NOT_FOUND':
      return 'That ticket no longer exists.';
    case 'USER_NOT_FOUND':
      return 'That user no longer exists.';
    case 'VALIDATION_ERROR':
      return error.fieldErrors.length > 0
        ? 'Please correct the highlighted fields.'
        : error.message;
    default:
      return 'Something went wrong. Please try again.';
  }
}
