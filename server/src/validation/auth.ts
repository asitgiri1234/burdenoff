import { z } from 'zod';

/** Minimum password length accepted at registration. */
export const MIN_PASSWORD_LENGTH = 8;

export const userRoleSchema = z.enum(['REPORTER', 'AGENT']);

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
  role: userRoleSchema,
  /** Required only when registering as an AGENT; see authService.register. */
  agentSignupCode: z.string().min(1).nullish(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
