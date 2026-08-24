import { z } from 'zod';

/**
 * Environment schema. Parsed once at import time so a misconfigured process
 * dies at boot with a readable message instead of failing somewhere deep in a
 * request handler.
 */
const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    TEST_DATABASE_URL: z.string().min(1, 'TEST_DATABASE_URL is required'),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    BUSINESS_TIMEZONE: z.string().min(1),
    BUSINESS_START_HOUR: z.coerce.number().int().min(0).max(23),
    BUSINESS_END_HOUR: z.coerce.number().int().min(1).max(24),
    AGENT_SIGNUP_CODE: z.string().min(1, 'AGENT_SIGNUP_CODE is required'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .refine((value) => value.BUSINESS_START_HOUR < value.BUSINESS_END_HOUR, {
    message: 'BUSINESS_START_HOUR must be earlier than BUSINESS_END_HOUR',
    path: ['BUSINESS_START_HOUR'],
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${details}\n\nCopy server/.env.example to server/.env and fill in the missing values.`,
    );
  }

  return parsed.data;
}

/** Validated, immutable application configuration. */
export const env: Readonly<Env> = Object.freeze(loadEnv());
