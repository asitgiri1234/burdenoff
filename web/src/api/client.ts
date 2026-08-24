import { ApiError, type FieldError } from '../lib/errors.ts';

const API_URL: string = import.meta.env['VITE_API_URL'] ?? 'http://localhost:4000/graphql';

const TOKEN_KEY = 'support-tracker-token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // A blocked localStorage only costs session persistence, not correctness.
  }
}

/** Called when the API reports the session is no longer valid. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

interface GraphQLErrorShape {
  message: string;
  extensions?: {
    code?: string;
    fieldErrors?: FieldError[];
  };
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLErrorShape[];
}

/**
 * Sends one GraphQL operation, attaching the stored bearer token.
 *
 * The first error is converted into an ApiError carrying `extensions.code`, so
 * every caller can branch on the same typed contract rather than string
 * matching. UNAUTHORIZED additionally clears the session and notifies the app
 * so it can send the user back to sign in.
 */
export async function request<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers['authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new Error('Cannot reach the server. Is it running?');
  }

  const body = (await response.json()) as GraphQLResponse<T>;

  const first = body.errors?.[0];
  if (first !== undefined) {
    const code = first.extensions?.code ?? 'UNKNOWN';

    if (code === 'UNAUTHORIZED') {
      setToken(null);
      onUnauthorized?.();
    }

    throw new ApiError(first.message, code, first.extensions?.fieldErrors ?? []);
  }

  if (body.data === null || body.data === undefined) {
    throw new Error('The server returned an empty response.');
  }

  return body.data;
}
