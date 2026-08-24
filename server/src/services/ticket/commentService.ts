import { invalidComment } from '../../graphql/errors.ts';
import type { CommentRecord } from '../../repositories/commentRepository.ts';
import type { Viewer } from '../../repositories/ticketRepository.ts';
import { MAX_COMMENT_LENGTH, type AddCommentInput } from '../../validation/ticket.ts';
import { assertCanViewTicket, requireTicket, type TicketDeps } from './ticketService.ts';

/**
 * Adds a comment, stamping the first response when one is due.
 *
 * Reporters may only comment on their own tickets; agents on any.
 *
 * First response rule: the clock stops on the first comment from somebody other
 * than the reporter. A reporter adding detail to their own ticket is not a
 * response, and once `firstResponseAt` is set it is never moved — the SLA is
 * frozen at the moment it was actually met.
 */
export async function addComment(
  input: AddCommentInput,
  viewer: Viewer,
  deps: TicketDeps,
): Promise<CommentRecord> {
  const content = input.content.trim();
  if (content.length === 0) {
    throw invalidComment('Comment cannot be empty');
  }
  if (content.length > MAX_COMMENT_LENGTH) {
    throw invalidComment(`Comment cannot be longer than ${String(MAX_COMMENT_LENGTH)} characters`);
  }

  const ticket = await requireTicket(input.ticketId, deps);
  assertCanViewTicket(ticket, viewer);

  const stampsFirstResponse =
    ticket.firstResponseAt === null && viewer.id !== ticket.reporterId;

  // Comment insert and first-response stamp move together: a crash between them
  // would leave a ticket whose SLA says unanswered while a reply is visible.
  const [comment] = await deps.prisma.$transaction([
    deps.prisma.comment.create({
      data: { ticketId: ticket.id, authorId: viewer.id, content },
    }),
    ...(stampsFirstResponse
      ? [
          deps.prisma.ticket.update({
            where: { id: ticket.id },
            data: { firstResponseAt: deps.now },
          }),
        ]
      : []),
  ]);

  return comment;
}
