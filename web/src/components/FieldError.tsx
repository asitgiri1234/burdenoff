import { fieldErrorFor } from '../lib/errors.ts';

/** Shows the server's message for one field, directly under its input. */
export function FieldError({
  error,
  path,
}: {
  error: unknown;
  path: string;
}): React.JSX.Element | null {
  const message = fieldErrorFor(error, path);
  if (message === undefined) return null;

  return <p className="field-error">{message}</p>;
}
