import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketDetail, User, UserRole } from '../api/types.ts';
import { ApiError } from '../lib/errors.ts';
import { TicketDetailPage } from './TicketDetailPage.tsx';

const fetchTicket = vi.fn();
const fetchAgents = vi.fn();
const addComment = vi.fn();
const changeTicketStatus = vi.fn();
const assignTicket = vi.fn();
const resolveTicket = vi.fn();

vi.mock('../api/operations.ts', () => ({
  fetchTicket: (...args: unknown[]) => fetchTicket(...args) as unknown,
  fetchAgents: (...args: unknown[]) => fetchAgents(...args) as unknown,
  addComment: (...args: unknown[]) => addComment(...args) as unknown,
  changeTicketStatus: (...args: unknown[]) => changeTicketStatus(...args) as unknown,
  assignTicket: (...args: unknown[]) => assignTicket(...args) as unknown,
  resolveTicket: (...args: unknown[]) => resolveTicket(...args) as unknown,
}));

let currentRole: UserRole = 'AGENT';

vi.mock('../auth/useAuth.ts', () => ({
  useAuth: () => ({
    user: { id: 'u-agent', name: 'Ava Agent', email: 'ava@example.com', role: currentRole },
    loading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  }),
}));

const reporter: User = {
  id: 'u-reporter',
  name: 'Rhea Reporter',
  email: 'rhea@example.com',
  role: 'REPORTER',
};

const agent: User = {
  id: 'u-agent',
  name: 'Ava Agent',
  email: 'ava@example.com',
  role: 'AGENT',
};

function ticketFixture(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 't-1',
    title: 'Checkout fails with a 500',
    description: 'A server error at the payment step.',
    priority: 'URGENT',
    status: 'OPEN',
    createdAt: '2026-03-02T04:30:00.000Z',
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    reporter,
    assignee: null,
    comments: [
      {
        id: 'c-1',
        content: 'Any update on this?',
        createdAt: '2026-03-02T05:00:00.000Z',
        author: reporter,
      },
    ],
    sla: {
      firstResponseDueAt: '2026-03-02T05:30:00.000Z',
      resolutionDueAt: '2026-03-02T08:30:00.000Z',
      firstResponseState: 'AT_RISK',
      resolutionState: 'ON_TRACK',
      firstResponseRemainingMinutes: 12,
      resolutionRemainingMinutes: 180,
    },
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/tickets/t-1']}>
      <Routes>
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  currentRole = 'AGENT';
  fetchTicket.mockReset().mockResolvedValue(ticketFixture());
  fetchAgents.mockReset().mockResolvedValue([agent]);
  addComment.mockReset().mockResolvedValue({ id: 'c-2' });
  changeTicketStatus.mockReset().mockResolvedValue(undefined);
  assignTicket.mockReset().mockResolvedValue(undefined);
  resolveTicket.mockReset().mockResolvedValue(undefined);
});

describe('ticket detail', () => {
  it('renders the ticket, its SLA states and the thread', async () => {
    renderPage();

    expect(await screen.findByText('Checkout fails with a 500')).toBeInTheDocument();
    // Appears twice: once as the reporter in the metadata, once as a comment author.
    expect(screen.getAllByText('Rhea Reporter')).toHaveLength(2);
    expect(screen.getByText('Any update on this?')).toBeInTheDocument();

    // Both SLA clocks come straight from the API payload.
    expect(screen.getByText('At risk')).toBeInTheDocument();
    expect(screen.getByText('On track')).toBeInTheDocument();
    expect(screen.getByText('12m')).toBeInTheDocument();
  });

  it('shows a helpful message when the ticket is not visible', async () => {
    fetchTicket.mockResolvedValue(null);
    renderPage();

    expect(
      await screen.findByText(/does not exist, or you do not have access/i),
    ).toBeInTheDocument();
  });
});

describe('agent controls', () => {
  it('are shown to an agent', async () => {
    renderPage();
    expect(await screen.findByText('Agent actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument();
  });

  it('are hidden from a reporter, who keeps the comment box', async () => {
    currentRole = 'REPORTER';
    renderPage();

    await screen.findByText('Checkout fails with a 500');

    // Presentation only — the server enforces the same rule — but a reporter
    // should not be shown controls that would always fail.
    expect(screen.queryByText('Agent actions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Post comment' })).toBeInTheDocument();
  });

  it('resolves a ticket and refetches so SLA state comes from the server', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Agent actions');
    expect(fetchTicket).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => {
      expect(resolveTicket).toHaveBeenCalledWith('t-1');
    });
    // Refetched rather than patching local state.
    await waitFor(() => {
      expect(fetchTicket).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the server message verbatim when a transition is rejected', async () => {
    changeTicketStatus.mockRejectedValue(
      new ApiError(
        'Ticket cannot transition from CLOSED to IN_PROGRESS.',
        'INVALID_STATUS_TRANSITION',
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Agent actions');
    await user.selectOptions(screen.getByLabelText('Change status'), 'IN_PROGRESS');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ticket cannot transition from CLOSED to IN_PROGRESS.',
    );
  });
});

describe('commenting', () => {
  it('posts a comment and confirms it', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Agent actions');
    await user.type(screen.getByLabelText('Add a comment'), 'Looking into it now.');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() => {
      expect(addComment).toHaveBeenCalledWith('t-1', 'Looking into it now.');
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Comment added.');
  });

  it('surfaces INVALID_COMMENT from the server', async () => {
    addComment.mockRejectedValue(new ApiError('Comment cannot be empty', 'INVALID_COMMENT'));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Agent actions');
    await user.type(screen.getByLabelText('Add a comment'), '   ');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Comment cannot be empty');
  });
});
