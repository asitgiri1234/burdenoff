import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { env } from '../../src/config/env.ts';
import { disconnectDatabase, resetDatabase, testPrisma } from './helpers/db.ts';
import { TEST_PASSWORD } from './helpers/factories.ts';
import { createTestServer, errorCode, type TestServer } from './helpers/testServer.ts';

const REGISTER = /* GraphQL */ `
  mutation ($name: String!, $email: String!, $password: String!, $role: UserRole!, $code: String) {
    register(name: $name, email: $email, password: $password, role: $role, agentSignupCode: $code) {
      token
      user {
        id
        name
        email
        role
        createdAt
      }
    }
  }
`;

const LOGIN = /* GraphQL */ `
  mutation ($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      token
      user {
        id
        email
        role
      }
    }
  }
`;

const ME = /* GraphQL */ `
  query {
    me {
      id
      email
      role
    }
  }
`;

const CREATE_TICKET = /* GraphQL */ `
  mutation {
    createTicket(title: "T", description: "D", priority: LOW) {
      id
    }
  }
`;

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('authentication end to end', () => {
  it('registers a reporter, logs in and resolves me', async () => {
    const registered = await server.execute<{
      register: { token: string; user: { id: string; email: string } };
    }>(REGISTER, {
      name: 'Rhea Reporter',
      email: 'rhea@example.com',
      password: TEST_PASSWORD,
      role: 'REPORTER',
    });

    expect(registered.errors).toBeUndefined();
    const userId = registered.data?.register.user.id;
    expect(userId).toBeDefined();

    // The row really exists, with a hashed password.
    const row = await testPrisma.user.findUniqueOrThrow({ where: { email: 'rhea@example.com' } });
    expect(row.role).toBe('REPORTER');
    expect(row.passwordHash).toStartWith('$argon2id$');
    expect(row.passwordHash).not.toContain(TEST_PASSWORD);

    const loggedIn = await server.execute<{ login: { token: string } }>(LOGIN, {
      email: 'rhea@example.com',
      password: TEST_PASSWORD,
    });
    expect(loggedIn.errors).toBeUndefined();

    const token = loggedIn.data?.login.token;
    const me = await server.execute<{ me: { id: string; email: string } }>(ME, {}, token);

    expect(me.errors).toBeUndefined();
    expect(me.data?.me.id).toBe(userId ?? '');
    expect(me.data?.me.email).toBe('rhea@example.com');
  });

  it('rejects a duplicate email with VALIDATION_ERROR', async () => {
    const variables = {
      name: 'Rhea',
      email: 'dupe@example.com',
      password: TEST_PASSWORD,
      role: 'REPORTER',
    };

    const first = await server.execute(REGISTER, variables);
    expect(first.errors).toBeUndefined();

    const second = await server.execute(REGISTER, variables);
    expect(errorCode(second)).toBe('VALIDATION_ERROR');

    // Field-addressable, and no second row was written.
    const fieldErrors = second.errors?.[0]?.extensions?.['fieldErrors'];
    expect(JSON.stringify(fieldErrors)).toContain('email');
    expect(await testPrisma.user.count()).toBe(1);
  });

  it('refuses agent registration without the signup code', async () => {
    const response = await server.execute(REGISTER, {
      name: 'Sneaky',
      email: 'sneaky@example.com',
      password: TEST_PASSWORD,
      role: 'AGENT',
    });

    expect(errorCode(response)).toBe('FORBIDDEN');
    expect(await testPrisma.user.count()).toBe(0);
  });

  it('refuses agent registration with a wrong signup code', async () => {
    const response = await server.execute(REGISTER, {
      name: 'Sneaky',
      email: 'sneaky@example.com',
      password: TEST_PASSWORD,
      role: 'AGENT',
      code: 'not-the-code',
    });

    expect(errorCode(response)).toBe('FORBIDDEN');
    expect(await testPrisma.user.count()).toBe(0);
  });

  it('allows agent registration with the correct signup code', async () => {
    const response = await server.execute<{ register: { user: { role: string } } }>(REGISTER, {
      name: 'Ava Agent',
      email: 'ava@example.com',
      password: TEST_PASSWORD,
      role: 'AGENT',
      code: env.AGENT_SIGNUP_CODE,
    });

    expect(response.errors).toBeUndefined();
    expect(response.data?.register.user.role).toBe('AGENT');

    const row = await testPrisma.user.findUniqueOrThrow({ where: { email: 'ava@example.com' } });
    expect(row.role).toBe('AGENT');
  });

  it('rejects a short password with field-level errors', async () => {
    const response = await server.execute(REGISTER, {
      name: 'Rhea',
      email: 'short@example.com',
      password: 'abcd',
      role: 'REPORTER',
    });

    expect(errorCode(response)).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(response.errors?.[0]?.extensions?.['fieldErrors'])).toContain('password');
    expect(await testPrisma.user.count()).toBe(0);
  });

  it('returns the same generic failure for a wrong password and an unknown email', async () => {
    await server.execute(REGISTER, {
      name: 'Rhea',
      email: 'rhea@example.com',
      password: TEST_PASSWORD,
      role: 'REPORTER',
    });

    const wrongPassword = await server.execute(LOGIN, {
      email: 'rhea@example.com',
      password: 'wrong-password',
    });
    const unknownEmail = await server.execute(LOGIN, {
      email: 'nobody@example.com',
      password: TEST_PASSWORD,
    });

    expect(errorCode(wrongPassword)).toBe('UNAUTHORIZED');
    expect(errorCode(unknownEmail)).toBe('UNAUTHORIZED');
    expect(unknownEmail.errors?.[0]?.message).toBe(wrongPassword.errors?.[0]?.message);
    expect(wrongPassword.errors?.[0]?.message).toBe('Invalid email or password');
  });
});

describe('anonymous requests', () => {
  it('resolves me to null rather than erroring', async () => {
    const response = await server.execute<{ me: null }>(ME);

    expect(response.errors).toBeUndefined();
    expect(response.data?.me).toBeNull();
    expect(response.status).toBe(200);
  });

  it('resolves me to null for a malformed token without a 500', async () => {
    const response = await server.execute<{ me: null }>(ME, {}, 'not-a-real-token');

    expect(response.errors).toBeUndefined();
    expect(response.data?.me).toBeNull();
    expect(response.status).toBe(200);
  });

  it('rejects a protected mutation with UNAUTHORIZED', async () => {
    const response = await server.execute(CREATE_TICKET);

    expect(errorCode(response)).toBe('UNAUTHORIZED');
    expect(await testPrisma.ticket.count()).toBe(0);
  });

  it('rejects a protected query with UNAUTHORIZED', async () => {
    const response = await server.execute('{ tickets { nodes { id } } }');
    expect(errorCode(response)).toBe('UNAUTHORIZED');
  });
});
