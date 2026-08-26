import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../api/operations.ts';
import {
  PRIORITIES,
  SLA_STATES,
  TICKET_STATUSES,
  type Dashboard,
  type Priority,
  type SlaState,
  type SortDirection,
  type TicketSortField,
  type TicketStatus,
  type TicketSummary,
  type User,
} from '../api/types.ts';
import { useAuth } from '../auth/useAuth.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { SlaBadge } from '../components/SlaBadge.tsx';
import { formatDateTime, humanise } from '../lib/format.ts';

const PAGE_SIZE = 10;

interface Filters {
  status: TicketStatus | '';
  priority: Priority | '';
  assigneeId: string;
  slaState: SlaState | '';
  sortBy: TicketSortField;
  sortDirection: SortDirection;
}

const INITIAL_FILTERS: Filters = {
  status: '',
  priority: '',
  assigneeId: '',
  slaState: '',
  sortBy: 'CREATED_AT',
  sortDirection: 'DESC',
};

export function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();

  const [counts, setCounts] = useState<Dashboard | null>(null);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [agents, setAgents] = useState<User[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  /** Turns the form state into API arguments, dropping empty selections. */
  const toArgs = useCallback(
    (next: string | null) => ({
      status: filters.status === '' ? null : filters.status,
      priority: filters.priority === '' ? null : filters.priority,
      assigneeId: filters.assigneeId === '' ? null : filters.assigneeId,
      slaState: filters.slaState === '' ? null : filters.slaState,
      sortBy: filters.sortBy,
      sortDirection: filters.sortDirection,
      take: PAGE_SIZE,
      cursor: next,
    }),
    [filters],
  );

  // Reload the first page whenever a filter or the sort changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load(): Promise<void> {
      try {
        const [dashboard, page] = await Promise.all([
          api.fetchDashboard(),
          api.fetchTickets(toArgs(null)),
        ]);

        if (cancelled) return;
        setCounts(dashboard);
        setTickets(page.nodes);
        setCursor(page.pageInfo.endCursor);
        setHasNextPage(page.pageInfo.hasNextPage);
        setError(null);
      } catch (caught) {
        if (!cancelled) setError(caught);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [toArgs]);

  // Agents get an assignee filter, so they need the agent directory.
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const list = await api.fetchAgents();
        if (!cancelled) setAgents(list);
      } catch {
        // Non-fatal: the filter simply stays empty.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMore(): Promise<void> {
    try {
      const page = await api.fetchTickets(toArgs(cursor));
      setTickets((current) => [...current, ...page.nodes]);
      setCursor(page.pageInfo.endCursor);
      setHasNextPage(page.pageInfo.hasNextPage);
    } catch (caught) {
      setError(caught);
    }
  }

  function update<K extends keyof Filters>(key: K, value: Filters[K]): void {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="page">
      <h1>Dashboard</h1>

      <ErrorBanner error={error} />

      <section className="stats" aria-label="Ticket counts">
        <Stat label="Open" value={counts?.openTickets} />
        <Stat label="In progress" value={counts?.inProgressTickets} />
        <Stat label="Resolved" value={counts?.resolvedTickets} />
        <Stat label="At risk" value={counts?.atRiskTickets} tone="warn" />
        <Stat label="Breached" value={counts?.breachedTickets} tone="danger" />
      </section>

      <section className="filters" aria-label="Filters">
        <label className="field field--inline">
          <span>Status</span>
          <select
            value={filters.status}
            onChange={(event) => {
              update('status', event.target.value as TicketStatus | '');
            }}
          >
            <option value="">Any</option>
            {TICKET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {humanise(status)}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span>Priority</span>
          <select
            value={filters.priority}
            onChange={(event) => {
              update('priority', event.target.value as Priority | '');
            }}
          >
            <option value="">Any</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {humanise(priority)}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span>SLA</span>
          <select
            value={filters.slaState}
            onChange={(event) => {
              update('slaState', event.target.value as SlaState | '');
            }}
          >
            <option value="">Any</option>
            {SLA_STATES.map((state) => (
              <option key={state} value={state}>
                {humanise(state)}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span>Assignee</span>
          <select
            value={filters.assigneeId}
            onChange={(event) => {
              update('assigneeId', event.target.value);
            }}
          >
            <option value="">Anyone</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--inline">
          <span>Sort by</span>
          <select
            value={filters.sortBy}
            onChange={(event) => {
              update('sortBy', event.target.value as TicketSortField);
            }}
          >
            <option value="CREATED_AT">Created</option>
            <option value="PRIORITY">Priority</option>
            <option value="FIRST_RESPONSE_DUE_AT">First response due</option>
          </select>
        </label>

        <label className="field field--inline">
          <span>Order</span>
          <select
            value={filters.sortDirection}
            onChange={(event) => {
              update('sortDirection', event.target.value as SortDirection);
            }}
          >
            <option value="DESC">Descending</option>
            <option value="ASC">Ascending</option>
          </select>
        </label>

        <button
          type="button"
          className="button button--ghost"
          onClick={() => {
            setFilters(INITIAL_FILTERS);
          }}
        >
          Reset
        </button>
      </section>

      {loading ? (
        <p className="muted">Loading tickets…</p>
      ) : tickets.length === 0 ? (
        <p className="muted">
          No tickets match these filters.{' '}
          {user?.role === 'REPORTER' && 'You only see tickets you reported.'}
        </p>
      ) : (
        <TicketTable tickets={tickets} />
      )}

      {hasNextPage && (
        <button
          type="button"
          className="button"
          onClick={() => {
            void loadMore();
          }}
        >
          Load more
        </button>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone?: 'warn' | 'danger';
}): React.JSX.Element {
  return (
    <div className={tone === undefined ? 'stat' : `stat stat--${tone}`}>
      <span className="stat__value">{value ?? '—'}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

/**
 * Renders as a table on desktop and as stacked cards below 768px. The `data-label`
 * attributes supply the row headings the CSS shows in card mode.
 */
function TicketTable({ tickets }: { tickets: TicketSummary[] }): React.JSX.Element {
  return (
    <table className="tickets">
      <thead>
        <tr>
          <th>Title</th>
          <th>Priority</th>
          <th>Status</th>
          <th>Assignee</th>
          <th>First response</th>
          <th>Resolution</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {tickets.map((ticket) => (
          <tr key={ticket.id}>
            <td data-label="Title">
              <Link to={`/tickets/${ticket.id}`}>{ticket.title}</Link>
              <span className="tickets__id">{ticket.id}</span>
            </td>
            <td data-label="Priority">
              <span className={`chip chip--${ticket.priority.toLowerCase()}`}>
                {humanise(ticket.priority)}
              </span>
            </td>
            <td data-label="Status">{humanise(ticket.status)}</td>
            <td data-label="Assignee">{ticket.assignee?.name ?? 'Unassigned'}</td>
            <td data-label="First response">
              <SlaBadge
                state={ticket.sla.firstResponseState}
                remainingMinutes={ticket.sla.firstResponseRemainingMinutes}
              />
            </td>
            <td data-label="Resolution">
              <SlaBadge
                state={ticket.sla.resolutionState}
                remainingMinutes={ticket.sla.resolutionRemainingMinutes}
              />
            </td>
            <td data-label="Created">{formatDateTime(ticket.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
