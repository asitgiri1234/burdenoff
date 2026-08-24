import type { z, ZodError, ZodType } from 'zod';
import { validationError, type FieldError } from '../graphql/errors.ts';

/**
 * Parses `input` against `schema`, converting any ZodError into our
 * VALIDATION_ERROR with populated `fieldErrors`.
 *
 * Every mutation runs its arguments through here, so a bad input can never
 * escape as an unhandled 500 — it always arrives at the client as a typed,
 * field-addressable validation failure.
 */
export function parseInput<Schema extends ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(input);

  if (result.success) {
    return result.data;
  }

  throw validationError('Invalid input', toFieldErrors(result.error));
}

/** Flattens a ZodError into the `{ path, message }` pairs clients render. */
function toFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
