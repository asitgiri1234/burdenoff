import { z } from 'zod';

export const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const ticketStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
export const slaStateSchema = z.enum(['ON_TRACK', 'AT_RISK', 'BREACHED', 'MET']);
export const ticketSortFieldSchema = z.enum([
  'CREATED_AT',
  'PRIORITY',
  'FIRST_RESPONSE_DUE_AT',
]);
export const sortDirectionSchema = z.enum(['ASC', 'DESC']);

/** Upper bound on a comment body, guarding against unbounded writes. */
export const MAX_COMMENT_LENGTH = 5000;

const id = z.string().trim().min(1, 'An id is required');

export const createTicketSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
  description: z.string().trim().min(1, 'Description is required'),
  priority: prioritySchema,
});

export const assignTicketSchema = z.object({
  ticketId: id,
  assigneeId: id,
});

export const changeTicketStatusSchema = z.object({
  ticketId: id,
  status: ticketStatusSchema,
});

export const resolveTicketSchema = z.object({
  ticketId: id,
});

export const addCommentSchema = z.object({
  ticketId: id,
  /**
   * Only trimmed here — the empty check lives in the service so it can raise
   * INVALID_COMMENT, the code the spec reserves for malformed comment bodies.
   */
  content: z.string().trim(),
});

export const ticketFiltersSchema = z.object({
  status: ticketStatusSchema.nullish(),
  priority: prioritySchema.nullish(),
  assigneeId: id.nullish(),
  slaState: slaStateSchema.nullish(),
  take: z.number().int().nullish(),
  cursor: z.string().min(1).nullish(),
  sortBy: ticketSortFieldSchema.nullish(),
  sortDirection: sortDirectionSchema.nullish(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;
export type ChangeTicketStatusInput = z.infer<typeof changeTicketStatusSchema>;
export type ResolveTicketInput = z.infer<typeof resolveTicketSchema>;
export type AddCommentInput = z.infer<typeof addCommentSchema>;
export type TicketFiltersInput = z.infer<typeof ticketFiltersSchema>;
