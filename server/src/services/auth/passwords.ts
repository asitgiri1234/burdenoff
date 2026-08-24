/**
 * Password hashing.
 *
 * argon2id is Bun's default and the current OWASP recommendation: memory-hard,
 * so GPU cracking gains far less than it would against a plain SHA family hash.
 *
 * Hashes are never logged and never leave this module in either direction —
 * callers pass plaintext in and get a boolean or an opaque string back.
 */

/** Hashes a plaintext password with argon2id. */
export async function hashPassword(plaintext: string): Promise<string> {
  return Bun.password.hash(plaintext, 'argon2id');
}

/**
 * Verifies a plaintext password against a stored hash.
 *
 * Returns false rather than throwing when the stored value is not a hash Bun
 * recognises, so a corrupted row fails the login instead of 500-ing the API.
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(plaintext, hash);
  } catch {
    return false;
  }
}
