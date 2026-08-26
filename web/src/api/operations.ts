import { request } from './client.ts';
import type {
  AuthPayload,
  Comment,
  Dashboard,
  Priority,
  TicketConnection,
  TicketDetail,
  TicketFilters,
  TicketStatus,
  User,
  UserRole,
} from './types.ts';

const USER_FIELDS = `
  id
  name
  email
  role
`;

const SLA_FIELDS = `
  firstResponseDueAt
  resolutionDueAt
  firstResponseState
  resolutionState
  firstResponseRemainingMinutes
  resolutionRemainingMinutes
`;

const TICKET_SUMMARY_FIELDS = `
  id
  title
  priority
  status
  createdAt
  reporter { ${USER_FIELDS} }
  assignee { ${USER_FIELDS} }
  sla { ${SLA_FIELDS} }
`;

export async function login(email: string, password: string): Promise<AuthPayload> {
  const data = await request<{ login: AuthPayload }>(
    `mutation ($email: String!, $password: String!) {
      login(email: $email, password: $password) {
        token
        user { ${USER_FIELDS} }
      }
    }`,
    { email, password },
  );
  return data.login;
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  agentSignupCode?: string;
}): Promise<AuthPayload> {
  const data = await request<{ register: AuthPayload }>(
    `mutation ($name: String!, $email: String!, $password: String!, $role: UserRole!, $code: String) {
      register(name: $name, email: $email, password: $password, role: $role, agentSignupCode: $code) {
        token
        user { ${USER_FIELDS} }
      }
    }`,
    {
      name: input.name,
      email: input.email,
      password: input.password,
      role: input.role,
      code: input.agentSignupCode ?? null,
    },
  );
  return data.register;
}

export async function fetchMe(): Promise<User | null> {
  const data = await request<{ me: User | null }>(`query { me { ${USER_FIELDS} } }`);
  return data.me;
}

export async function fetchDashboard(): Promise<Dashboard> {
  const data = await request<{ dashboard: Dashboard }>(
    `query {
      dashboard {
        openTickets
        inProgressTickets
        resolvedTickets
        atRiskTickets
        breachedTickets
      }
    }`,
  );
  return data.dashboard;
}

export async function fetchTickets(filters: TicketFilters): Promise<TicketConnection> {
  const data = await request<{ tickets: TicketConnection }>(
    `query (
      $status: TicketStatus
      $priority: Priority
      $assigneeId: ID
      $slaState: SLAState
      $take: Int
      $cursor: String
      $sortBy: TicketSortField
      $sortDirection: SortDirection
    ) {
      tickets(
        status: $status
        priority: $priority
        assigneeId: $assigneeId
        slaState: $slaState
        take: $take
        cursor: $cursor
        sortBy: $sortBy
        sortDirection: $sortDirection
      ) {
        nodes { ${TICKET_SUMMARY_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { ...filters },
  );
  return data.tickets;
}

export async function fetchTicket(id: string): Promise<TicketDetail | null> {
  const data = await request<{ ticket: TicketDetail | null }>(
    `query ($id: ID!) {
      ticket(id: $id) {
        ${TICKET_SUMMARY_FIELDS}
        description
        firstResponseAt
        resolvedAt
        closedAt
        comments {
          id
          content
          createdAt
          author { ${USER_FIELDS} }
        }
      }
    }`,
    { id },
  );
  return data.ticket;
}

export async function fetchAgents(): Promise<User[]> {
  const data = await request<{ users: User[] }>(
    `query { users(role: AGENT) { ${USER_FIELDS} } }`,
  );
  return data.users;
}

export async function createTicket(input: {
  title: string;
  description: string;
  priority: Priority;
}): Promise<{ id: string }> {
  const data = await request<{ createTicket: { id: string } }>(
    `mutation ($title: String!, $description: String!, $priority: Priority!) {
      createTicket(title: $title, description: $description, priority: $priority) { id }
    }`,
    input,
  );
  return data.createTicket;
}

export async function addComment(ticketId: string, content: string): Promise<Comment> {
  const data = await request<{ addComment: Comment }>(
    `mutation ($ticketId: ID!, $content: String!) {
      addComment(ticketId: $ticketId, content: $content) {
        id
        content
        createdAt
        author { ${USER_FIELDS} }
      }
    }`,
    { ticketId, content },
  );
  return data.addComment;
}

export async function assignTicket(ticketId: string, assigneeId: string): Promise<void> {
  await request(
    `mutation ($ticketId: ID!, $assigneeId: ID!) {
      assignTicket(ticketId: $ticketId, assigneeId: $assigneeId) { id }
    }`,
    { ticketId, assigneeId },
  );
}

export async function changeTicketStatus(
  ticketId: string,
  status: TicketStatus,
): Promise<void> {
  await request(
    `mutation ($ticketId: ID!, $status: TicketStatus!) {
      changeTicketStatus(ticketId: $ticketId, status: $status) { id }
    }`,
    { ticketId, status },
  );
}

export async function resolveTicket(ticketId: string): Promise<void> {
  await request(`mutation ($ticketId: ID!) { resolveTicket(ticketId: $ticketId) { id } }`, {
    ticketId,
  });
}
