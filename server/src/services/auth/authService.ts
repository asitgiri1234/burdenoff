import { forbidden, unauthorized, validationError } from '../../graphql/errors.ts';
import {
  EmailAlreadyExistsError,
  type UserRecord,
  type UserRepository,
  type UserRole,
} from '../../repositories/userRepository.ts';
import type { LoginInput, RegisterInput } from '../../validation/auth.ts';
import { hashPassword, verifyPassword } from './passwords.ts';
import { signToken } from './tokens.ts';

/** A user as it is safe to hand to a client — never carries the password hash. */
export interface PublicUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: UserRole;
  readonly createdAt: Date;
}

export interface AuthPayload {
  readonly token: string;
  readonly user: PublicUser;
}

/**
 * Collaborators injected into the service.
 *
 * `agentSignupCode` is passed in rather than read from the environment here, so
 * the service stays a pure function of its inputs and tests can vary it.
 */
export interface AuthDeps {
  readonly users: UserRepository;
  readonly agentSignupCode: string;
}

/** Strips the password hash before a user crosses the service boundary. */
export function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

/**
 * A throwaway hash used to keep failed logins roughly as expensive as
 * successful ones. Without it, "no such email" would return noticeably faster
 * than "wrong password" and leak which addresses are registered.
 *
 * Computed lazily once, then reused.
 */
let placeholderHash: Promise<string> | null = null;
function getPlaceholderHash(): Promise<string> {
  placeholderHash ??= hashPassword('placeholder-password-never-matches');
  return placeholderHash;
}

/**
 * Registers a new user and returns a signed session.
 *
 * Role restriction: signing up as a REPORTER is open to anyone, but creating an
 * AGENT requires the shared `AGENT_SIGNUP_CODE`. Support agents can read and
 * modify every ticket in the system, so self-service agent creation would let
 * any visitor grant themselves full access. The invite code keeps agent
 * provisioning in the hands of whoever operates the deployment.
 */
export async function register(input: RegisterInput, deps: AuthDeps): Promise<AuthPayload> {
  if (input.role === 'AGENT') {
    const supplied = input.agentSignupCode ?? '';
    if (supplied !== deps.agentSignupCode) {
      throw forbidden('A valid agent signup code is required to register as an agent');
    }
  }

  const passwordHash = await hashPassword(input.password);

  let created: UserRecord;
  try {
    created = await deps.users.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
    });
  } catch (error) {
    // Surfaced as a field-level validation failure rather than an unhandled
    // Prisma crash, so the signup form can highlight the email input.
    if (error instanceof EmailAlreadyExistsError) {
      throw validationError('Email already registered', [
        { path: 'email', message: 'Email already registered' },
      ]);
    }
    throw error;
  }

  const token = await signToken({ sub: created.id, role: created.role });
  return { token, user: toPublicUser(created) };
}

/**
 * Exchanges credentials for a signed session.
 *
 * An unknown email and a wrong password produce the identical UNAUTHORIZED
 * response, so the endpoint cannot be used to enumerate registered addresses.
 */
export async function login(input: LoginInput, deps: AuthDeps): Promise<AuthPayload> {
  const genericFailure = unauthorized('Invalid email or password');

  const user = await deps.users.findByEmail(input.email);

  if (user === null) {
    // Still do the hashing work, then fail identically to a wrong password.
    await verifyPassword(input.password, await getPlaceholderHash());
    throw genericFailure;
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw genericFailure;
  }

  const token = await signToken({ sub: user.id, role: user.role });
  return { token, user: toPublicUser(user) };
}

/**
 * Users the caller is allowed to see.
 *
 * Agents get the full directory. Reporters only ever get AGENTs — they need
 * that list to make sense of ticket assignees, but there is no reason to expose
 * every other reporter's name and email to them.
 */
export async function listVisibleUsers(
  viewerRole: UserRole,
  roleFilter: UserRole | null,
  deps: AuthDeps,
): Promise<PublicUser[]> {
  const effectiveRole: UserRole | null = viewerRole === 'AGENT' ? roleFilter : 'AGENT';

  // A reporter asking for REPORTERs gets an empty list rather than an error:
  // the filter is simply intersected with what they are allowed to see.
  if (viewerRole === 'REPORTER' && roleFilter !== null && roleFilter !== 'AGENT') {
    return [];
  }

  const users = await deps.users.listByRole(effectiveRole);
  return users.map(toPublicUser);
}
