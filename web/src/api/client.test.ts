import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/errors.ts';
import {
  getToken,
  request,
  setToken,
  setUnauthorizedHandler,
} from './client.ts';

/** Builds a fetch stub returning one GraphQL response body. */
function mockFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  setToken(null);
  setUnauthorizedHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('token storage', () => {
  it('round-trips a token through localStorage', () => {
    expect(getToken()).toBeNull();
    setToken('abc.def.ghi');
    expect(getToken()).toBe('abc.def.ghi');
  });

  it('clears the token', () => {
    setToken('abc');
    setToken(null);
    expect(getToken()).toBeNull();
  });
});

describe('request', () => {
  it('posts the query and variables as JSON', async () => {
    const fetchMock = mockFetch({ data: { health: 'ok' } });

    const data = await request<{ health: string }>('{ health }', { a: 1 });

    expect(data).toEqual({ health: 'ok' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ query: '{ health }', variables: { a: 1 } });
  });

  it('omits the Authorization header when signed out', async () => {
    const fetchMock = mockFetch({ data: {} });
    await request('{ health }');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBeUndefined();
  });

  it('attaches the bearer token when signed in', async () => {
    setToken('my-token');
    const fetchMock = mockFetch({ data: {} });

    await request('{ health }');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer my-token');
  });

  it('converts the first GraphQL error into a typed ApiError', async () => {
    mockFetch({
      errors: [
        {
          message: 'Ticket cannot transition from CLOSED to IN_PROGRESS.',
          extensions: { code: 'INVALID_STATUS_TRANSITION' },
        },
      ],
      data: null,
    });

    await expect(request('mutation { x }')).rejects.toThrow(ApiError);

    try {
      await request('mutation { x }');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('INVALID_STATUS_TRANSITION');
      expect((error as ApiError).message).toBe(
        'Ticket cannot transition from CLOSED to IN_PROGRESS.',
      );
    }
  });

  it('carries fieldErrors through on a validation failure', async () => {
    mockFetch({
      errors: [
        {
          message: 'Invalid input',
          extensions: {
            code: 'VALIDATION_ERROR',
            fieldErrors: [{ path: 'password', message: 'Password must be at least 8 characters' }],
          },
        },
      ],
    });

    try {
      await request('mutation { register }');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).fieldErrors).toEqual([
        { path: 'password', message: 'Password must be at least 8 characters' },
      ]);
    }
  });

  it('uses a placeholder code when the server sends none', async () => {
    mockFetch({ errors: [{ message: 'boom' }] });

    try {
      await request('{ x }');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('UNKNOWN');
    }
  });

  describe('on UNAUTHORIZED', () => {
    it('clears the stored token and notifies the app', async () => {
      setToken('stale-token');
      const onUnauthorized = vi.fn();
      setUnauthorizedHandler(onUnauthorized);

      mockFetch({ errors: [{ message: 'nope', extensions: { code: 'UNAUTHORIZED' } }] });

      await expect(request('{ me }')).rejects.toThrow(ApiError);

      // A dead session must not linger, and the app needs to know so it can
      // send the viewer back to sign in.
      expect(getToken()).toBeNull();
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });

    it('does not fire the handler for other error codes', async () => {
      setToken('good-token');
      const onUnauthorized = vi.fn();
      setUnauthorizedHandler(onUnauthorized);

      mockFetch({ errors: [{ message: 'nope', extensions: { code: 'FORBIDDEN' } }] });

      await expect(request('{ x }')).rejects.toThrow(ApiError);

      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(getToken()).toBe('good-token');
    });
  });

  it('reports an unreachable server in plain language', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(request('{ health }')).rejects.toThrow('Cannot reach the server. Is it running?');
  });

  it('rejects an empty response body rather than returning undefined', async () => {
    mockFetch({ data: null });
    await expect(request('{ health }')).rejects.toThrow('The server returned an empty response.');
  });
});
