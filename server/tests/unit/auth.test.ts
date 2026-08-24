import { beforeEach, describe, expect, it } from 'bun:test';
import { GraphQLError } from 'graphql';
import { SignJWT } from 'jose';
import { requireAgent, requireUser } from '../../src/auth/guards.ts';
import { env } from '../../src/config/env.ts';
import type { CurrentUser } from '../../src/graphql/context.ts';
import {
  hashPassword,
  listVisibleUsers,
  login,
  register,
  signToken,
  verifyPassword,
  verifyToken,
  type AuthDeps,
} from '../../src/services/auth/index.ts';
import { loginSchema, parseInput, registerSchema } from '../../src/validation/index.ts';
import { FakeUserRepository } from './fakeUserRepository.ts';

const AGENT_CODE = 'test-agent-code';

let deps: AuthDeps;

beforeEach(() => {
  deps = { users: new FakeUserRepository(), agentSignupCode: AGENT_CODE };
});

/** Runs `fn`, expecting it to throw, and returns the thrown value. */
async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to throw, but it resolved');
}

/** Reads `extensions.code` off a GraphQLError. */
function codeOf(error: unknown): string | undefined {
  if (!(error instanceof GraphQLError)) return undefined;
  const code = error.extensions['code'];
  return typeof code === 'string' ? code : undefined;
}

function fieldErrorsOf(error: unknown): { path: string; message: string }[] {
  if (!(error instanceof GraphQLError)) return [];
  const fieldErrors = error.extensions['fieldErrors'];
  return Array.isArray(fieldErrors) ? (fieldErrors as { path: string; message: string }[]) : [];
}

/** Splits a JWT into its three segments, failing loudly if it is malformed. */
function splitToken(token: string): { header: string; payload: string; signature: string } {
  const [header, payload, signature] = token.split('.');
  if (header === undefined || payload === undefined || signature === undefined) {
    throw new Error(`Malformed JWT: ${token}`);
  }
  return { header, payload, signature };
}

const reporterInput = {
  name: 'Rhea Reporter',
  email: 'rhea@example.com',
  password: 'password123',
  role: 'REPORTER' as const,
  agentSignupCode: null,
};

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('password123');
    expect(await verifyPassword('password123', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('password123');
    expect(await verifyPassword('not-the-password', hash)).toBe(false);
  });

  it('produces an argon2id hash that is not the plaintext', async () => {
    const hash = await hashPassword('password123');
    expect(hash).toStartWith('$argon2id$');
    expect(hash).not.toContain('password123');
  });

  it('returns false rather than throwing on a malformed stored hash', async () => {
    expect(await verifyPassword('password123', 'not-a-hash')).toBe(false);
  });
});

describe('JWT tokens', () => {
  it('round-trips a signed token', async () => {
    const token = await signToken({ sub: 'user-1', role: 'AGENT' });
    expect(await verifyToken(token)).toEqual({ sub: 'user-1', role: 'AGENT' });
  });

  it('returns null for a tampered signature', async () => {
    const { header, payload, signature } = splitToken(
      await signToken({ sub: 'user-1', role: 'REPORTER' }),
    );

    // The FIRST signature character is flipped rather than the last: a 256-bit
    // HMAC encodes to 43 base64url chars, so the final char carries only 4
    // significant bits and some substitutions decode to identical bytes.
    const flipped = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;

    expect(await verifyToken(`${header}.${payload}.${flipped}`)).toBeNull();
  });

  it('returns null when the payload is edited to escalate role', async () => {
    // A reporter must not be able to promote themselves by rewriting the
    // unsigned payload and keeping the original signature.
    const { header, signature } = splitToken(
      await signToken({ sub: 'user-1', role: 'REPORTER' }),
    );

    const forged = Buffer.from(
      JSON.stringify({
        sub: 'user-1',
        role: 'AGENT',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');

    expect(await verifyToken(`${header}.${forged}.${signature}`)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const expired = await new SignJWT({ role: 'AGENT' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(env.JWT_SECRET));

    expect(await verifyToken(expired)).toBeNull();
  });

  it('returns null for a token signed with a different secret', async () => {
    const foreign = await new SignJWT({ role: 'AGENT' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-completely-different-secret-value'));

    expect(await verifyToken(foreign)).toBeNull();
  });

  it('returns null for garbage input', async () => {
    expect(await verifyToken('not.a.token')).toBeNull();
    expect(await verifyToken('')).toBeNull();
  });
});

describe('register', () => {
  it('creates a reporter without any signup code', async () => {
    const result = await register(reporterInput, deps);

    expect(result.user.email).toBe('rhea@example.com');
    expect(result.user.role).toBe('REPORTER');
    expect(await verifyToken(result.token)).toEqual({ sub: result.user.id, role: 'REPORTER' });
  });

  it('never returns the password hash', async () => {
    const result = await register(reporterInput, deps);
    expect(Object.keys(result.user)).not.toContain('passwordHash');
    expect(JSON.stringify(result)).not.toContain('argon2');
  });

  it('rejects an AGENT registration with no signup code (FORBIDDEN)', async () => {
    const error = await captureError(() =>
      register({ ...reporterInput, email: 'a@example.com', role: 'AGENT' }, deps),
    );

    expect(codeOf(error)).toBe('FORBIDDEN');
  });

  it('rejects an AGENT registration with the wrong signup code (FORBIDDEN)', async () => {
    const error = await captureError(() =>
      register(
        { ...reporterInput, email: 'a@example.com', role: 'AGENT', agentSignupCode: 'guess' },
        deps,
      ),
    );

    expect(codeOf(error)).toBe('FORBIDDEN');
  });

  it('accepts an AGENT registration with the correct signup code', async () => {
    const result = await register(
      { ...reporterInput, email: 'ava@example.com', role: 'AGENT', agentSignupCode: AGENT_CODE },
      deps,
    );

    expect(result.user.role).toBe('AGENT');
    expect(await verifyToken(result.token)).toEqual({ sub: result.user.id, role: 'AGENT' });
  });

  it('reports a duplicate email as VALIDATION_ERROR, not a crash', async () => {
    await register(reporterInput, deps);
    const error = await captureError(() => register(reporterInput, deps));

    expect(codeOf(error)).toBe('VALIDATION_ERROR');
    expect(error).toBeInstanceOf(GraphQLError);
    expect(fieldErrorsOf(error)).toEqual([
      { path: 'email', message: 'Email already registered' },
    ]);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await register(reporterInput, deps);
  });

  it('returns a token for correct credentials', async () => {
    const result = await login({ email: 'rhea@example.com', password: 'password123' }, deps);
    expect(result.user.email).toBe('rhea@example.com');
    expect(await verifyToken(result.token)).not.toBeNull();
  });

  it('rejects a wrong password with the generic UNAUTHORIZED message', async () => {
    const error = await captureError(() =>
      login({ email: 'rhea@example.com', password: 'wrong-password' }, deps),
    );

    expect(codeOf(error)).toBe('UNAUTHORIZED');
    expect((error as GraphQLError).message).toBe('Invalid email or password');
  });

  it('gives an unknown email the identical response, leaking nothing', async () => {
    const wrongPassword = await captureError(() =>
      login({ email: 'rhea@example.com', password: 'wrong-password' }, deps),
    );
    const unknownEmail = await captureError(() =>
      login({ email: 'nobody@example.com', password: 'password123' }, deps),
    );

    expect(codeOf(unknownEmail)).toBe(codeOf(wrongPassword));
    expect((unknownEmail as GraphQLError).message).toBe(
      (wrongPassword as GraphQLError).message,
    );
  });
});

describe('input validation', () => {
  it('rejects a 4-character password with field-level errors', () => {
    let thrown: unknown;
    try {
      parseInput(registerSchema, { ...reporterInput, password: 'abcd' });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe('VALIDATION_ERROR');
    const fields = fieldErrorsOf(thrown);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.path).toBe('password');
    expect(fields[0]?.message).toBe('Password must be at least 8 characters');
  });

  it('rejects a malformed email', () => {
    let thrown: unknown;
    try {
      parseInput(registerSchema, { ...reporterInput, email: 'not-an-email' });
    } catch (error) {
      thrown = error;
    }

    expect(codeOf(thrown)).toBe('VALIDATION_ERROR');
    expect(fieldErrorsOf(thrown)[0]?.path).toBe('email');
  });

  it('reports every invalid field at once', () => {
    let thrown: unknown;
    try {
      parseInput(registerSchema, { name: '', email: 'nope', password: 'abc', role: 'REPORTER' });
    } catch (error) {
      thrown = error;
    }

    expect(fieldErrorsOf(thrown).map((f) => f.path).sort()).toEqual([
      'email',
      'name',
      'password',
    ]);
  });

  it('normalises email casing and trims whitespace', () => {
    const parsed = parseInput(loginSchema, {
      email: '  Rhea@Example.COM ',
      password: 'password123',
    });
    expect(parsed.email).toBe('rhea@example.com');
  });
});

describe('guards', () => {
  const reporter: CurrentUser = { id: 'user-1', role: 'REPORTER' };
  const agent: CurrentUser = { id: 'user-2', role: 'AGENT' };

  it('requireUser returns the user when authenticated', () => {
    expect(requireUser({ currentUser: reporter })).toEqual(reporter);
  });

  it('requireUser throws UNAUTHORIZED for an anonymous context', () => {
    let thrown: unknown;
    try {
      requireUser({ currentUser: null });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('UNAUTHORIZED');
  });

  it('requireAgent returns the agent when the role matches', () => {
    expect(requireAgent({ currentUser: agent }).role).toBe('AGENT');
  });

  it('requireAgent throws FORBIDDEN for a reporter', () => {
    let thrown: unknown;
    try {
      requireAgent({ currentUser: reporter });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('FORBIDDEN');
  });

  it('requireAgent throws UNAUTHORIZED (not FORBIDDEN) for an anonymous context', () => {
    // Anonymous callers should be told to log in, not that they are barred.
    let thrown: unknown;
    try {
      requireAgent({ currentUser: null });
    } catch (error) {
      thrown = error;
    }
    expect(codeOf(thrown)).toBe('UNAUTHORIZED');
  });
});

describe('listVisibleUsers', () => {
  beforeEach(async () => {
    await register(reporterInput, deps);
    await register(
      { ...reporterInput, name: 'Ava Agent', email: 'ava@example.com', role: 'AGENT', agentSignupCode: AGENT_CODE },
      deps,
    );
  });

  it('lets an agent see everyone', async () => {
    const users = await listVisibleUsers('AGENT', null, deps);
    expect(users.map((u) => u.email).sort()).toEqual(['ava@example.com', 'rhea@example.com']);
  });

  it('lets an agent filter by role', async () => {
    const users = await listVisibleUsers('AGENT', 'REPORTER', deps);
    expect(users.map((u) => u.email)).toEqual(['rhea@example.com']);
  });

  it('shows a reporter only agents, even when asking for everyone', async () => {
    const users = await listVisibleUsers('REPORTER', null, deps);
    expect(users.map((u) => u.email)).toEqual(['ava@example.com']);
  });

  it('returns an empty list when a reporter asks for reporters', async () => {
    expect(await listVisibleUsers('REPORTER', 'REPORTER', deps)).toEqual([]);
  });
});
