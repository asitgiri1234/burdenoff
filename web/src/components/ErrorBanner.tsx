import { errorMessage } from '../lib/errors.ts';

/**
 * Shared failure renderer. Every failed request goes through here, so a
 * mutation can never fail silently.
 */
export function ErrorBanner({ error }: { error: unknown }): React.JSX.Element | null {
  if (error === null || error === undefined) return null;

  return (
    <div className="banner banner--error" role="alert">
      {errorMessage(error)}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string | null }): React.JSX.Element | null {
  if (message === null) return null;
  return (
    <div className="banner banner--success" role="status">
      {message}
    </div>
  );
}
