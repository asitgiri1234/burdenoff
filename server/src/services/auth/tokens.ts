import { jwtVerify, SignJWT } from 'jose';
import { env } from '../../config/env.ts';

/** Roles carried in a token, mirroring the Prisma UserRole enum. */
export type TokenRole = 'REPORTER' | 'AGENT';

/** The claims this API puts in — and trusts out of — a JWT. */
export interface TokenPayload {
  readonly sub: string;
  readonly role: TokenRole;
}

const TOKEN_TTL = '7d';
const ALGORITHM = 'HS256';

/** HMAC key derived from the validated env config. */
const secretKey = new TextEncoder().encode(env.JWT_SECRET);

/** Signs a 7-day access token for a user. */
export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secretKey);
}

/**
 * Verifies a token and returns its claims, or null.
 *
 * Returns null rather than throwing for every failure mode — bad signature,
 * expired, malformed, wrong algorithm — because callers (notably the request
 * context) treat "no valid token" as an anonymous request, not as an error.
 */
export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: [ALGORITHM] });

    const sub = payload.sub;
    const role = payload['role'];

    if (typeof sub !== 'string' || sub.length === 0) return null;
    if (role !== 'REPORTER' && role !== 'AGENT') return null;

    return { sub, role };
  } catch {
    return null;
  }
}

/**
 * Extracts a bearer token from an Authorization header value.
 * Returns null when the header is absent or not a well-formed bearer scheme.
 */
export function extractBearerToken(headerValue: string | null | undefined): string | null {
  if (typeof headerValue !== 'string') return null;

  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  const token = match?.[1]?.trim();

  return token !== undefined && token.length > 0 ? token : null;
}
