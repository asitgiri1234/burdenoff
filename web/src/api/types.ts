/**
 * Narrow response shapes, hand-written to mirror the server schema.
 *
 * Kept deliberately minimal — each interface describes only the fields the
 * corresponding operation actually selects.
 */

export type UserRole = 'REPORTER' | 'AGENT';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type SlaState = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'MET';
export type TicketSortField = 'CREATED_AT' | 'PRIORITY' | 'FIRST_RESPONSE_DUE_AT';
export type SortDirection = 'ASC' | 'DESC';

export const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const TICKET_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
export const SLA_STATES: SlaState[] = ['ON_TRACK', 'AT_RISK', 'BREACHED', 'MET'];

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt?: string;
}

export interface SlaInfo {
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstResponseState: SlaState;
  resolutionState: SlaState;
  firstResponseRemainingMinutes: number;
  resolutionRemainingMinutes: number;
}

export interface Comment {
  id: string;
  content: string;
  createdAt: string;
  author: User;
}

export interface TicketSummary {
  id: string;
  title: string;
  priority: Priority;
  status: TicketStatus;
  createdAt: string;
  reporter: User;
  assignee: User | null;
  sla: SlaInfo;
}

export interface TicketDetail extends TicketSummary {
  description: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  comments: Comment[];
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface TicketConnection {
  nodes: TicketSummary[];
  pageInfo: PageInfo;
}

export interface Dashboard {
  openTickets: number;
  inProgressTickets: number;
  resolvedTickets: number;
  atRiskTickets: number;
  breachedTickets: number;
}

export interface AuthPayload {
  token: string;
  user: User;
}

export interface TicketFilters {
  status?: TicketStatus | null;
  priority?: Priority | null;
  assigneeId?: string | null;
  slaState?: SlaState | null;
  sortBy?: TicketSortField;
  sortDirection?: SortDirection;
  take?: number;
  cursor?: string | null;
}
