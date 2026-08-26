export {
  allowedTransitions,
  assertValidTransition,
  canTransition,
  type TicketStatus,
} from './statusMachine.ts';
export { toSlaView, type SlaView } from './slaView.ts';
export {
  assertCanViewTicket,
  assignTicket,
  changeTicketStatus,
  createTicket,
  getTicket,
  listTickets,
  requireTicket,
  resolveTicket,
  type TicketDeps,
} from './ticketService.ts';
export { addComment } from './commentService.ts';
