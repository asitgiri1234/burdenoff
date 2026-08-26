import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as api from '../api/operations.ts';
import {
  TICKET_STATUSES,
  type TicketDetail,
  type TicketStatus,
  type User,
} from '../api/types.ts';
import { useAuth } from '../auth/useAuth.ts';
import { ErrorBanner, SuccessBanner } from '../components/ErrorBanner.tsx';
import { SlaBadge } from '../components/SlaBadge.tsx';
import { formatDateTime, humanise } from '../lib/format.ts';

export function TicketDetailPage(): React.JSX.Element {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAgent = user?.role === 'AGENT';

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [agents, setAgents] = useState<User[]>([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const fresh = await api.fetchTicket(id);
    setTicket(fresh);
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      try {
        const fresh = await api.fetchTicket(id);
        if (!cancelled) {
          setTicket(fresh);
          setError(null);
        }
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
  }, [id]);

  useEffect(() => {
    if (!isAgent) return;
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const list = await api.fetchAgents();
        if (!cancelled) setAgents(list);
      } catch {
        // Non-fatal: the assign control just has no options.
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isAgent]);

  /** Runs a mutation, then refetches so SLA state comes from the server. */
  async function run(action: () => Promise<void>, message: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await action();
      await reload();
      setNotice(message);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function onComment(event: FormEvent): Promise<void> {
    event.preventDefault();
    await run(async () => {
      await api.addComment(id, comment);
      setComment('');
    }, 'Comment added.');
  }

  if (loading) return <p className="muted">Loading ticket…</p>;

  if (ticket === null) {
    return (
      <div className="page">
        <ErrorBanner error={error} />
        <p className="muted">
          This ticket does not exist, or you do not have access to it.{' '}
          <Link to="/">Back to dashboard</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/" className="back">
        ← Back to dashboard
      </Link>

      <h1>{ticket.title}</h1>

      <ErrorBanner error={error} />
      <SuccessBanner message={notice} />

      <section className="card">
        <dl className="meta">
          <div>
            <dt>Status</dt>
            <dd>{humanise(ticket.status)}</dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd>
              <span className={`chip chip--${ticket.priority.toLowerCase()}`}>
                {humanise(ticket.priority)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Reporter</dt>
            <dd>{ticket.reporter.name}</dd>
          </div>
          <div>
            <dt>Assignee</dt>
            <dd>{ticket.assignee?.name ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDateTime(ticket.createdAt)}</dd>
          </div>
          <div>
            <dt>First response</dt>
            <dd>{formatDateTime(ticket.firstResponseAt)}</dd>
          </div>
          <div>
            <dt>Resolved</dt>
            <dd>{formatDateTime(ticket.resolvedAt)}</dd>
          </div>
          <div>
            <dt>Closed</dt>
            <dd>{formatDateTime(ticket.closedAt)}</dd>
          </div>
        </dl>

        <p className="description">{ticket.description}</p>

        <div className="sla-row">
          <SlaBadge
            label="First response"
            state={ticket.sla.firstResponseState}
            remainingMinutes={ticket.sla.firstResponseRemainingMinutes}
          />
          <SlaBadge
            label="Resolution"
            state={ticket.sla.resolutionState}
            remainingMinutes={ticket.sla.resolutionRemainingMinutes}
          />
        </div>
        <p className="muted small">
          Due {formatDateTime(ticket.sla.firstResponseDueAt)} / {' '}
          {formatDateTime(ticket.sla.resolutionDueAt)}
        </p>
      </section>

      {/* Agent-only controls. Reporters still get the thread and comment box. */}
      {isAgent && (
        <section className="card">
          <h2>Agent actions</h2>
          <div className="actions">
            <label className="field field--inline">
              <span>Assign to</span>
              <select
                value={ticket.assignee?.id ?? ''}
                disabled={busy}
                onChange={(event) => {
                  const assigneeId = event.target.value;
                  if (assigneeId === '') return;
                  void run(
                    () => api.assignTicket(ticket.id, assigneeId),
                    'Ticket assigned.',
                  );
                }}
              >
                <option value="">Choose an agent…</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field field--inline">
              <span>Change status</span>
              <select
                value={ticket.status}
                disabled={busy}
                onChange={(event) => {
                  const status = event.target.value as TicketStatus;
                  if (status === ticket.status) return;
                  void run(
                    () => api.changeTicketStatus(ticket.id, status),
                    `Status changed to ${humanise(status)}.`,
                  );
                }}
              >
                {TICKET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {humanise(status)}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="button button--primary"
              disabled={busy || ticket.status === 'RESOLVED'}
              onClick={() => {
                void run(() => api.resolveTicket(ticket.id), 'Ticket resolved.');
              }}
            >
              Resolve
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Comments</h2>

        {ticket.comments.length === 0 ? (
          <p className="muted">No comments yet.</p>
        ) : (
          <ol className="thread">
            {ticket.comments.map((entry) => (
              <li key={entry.id} className="thread__item">
                <div className="thread__head">
                  <strong>{entry.author.name}</strong>
                  <span className="tag">{entry.author.role}</span>
                  <span className="muted small">{formatDateTime(entry.createdAt)}</span>
                </div>
                <p className="thread__body">{entry.content}</p>
              </li>
            ))}
          </ol>
        )}

        <form className="comment-form" onSubmit={(event) => void onComment(event)}>
          <label className="field">
            <span>Add a comment</span>
            <textarea
              value={comment}
              rows={3}
              onChange={(event) => {
                setComment(event.target.value);
              }}
              required
            />
          </label>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? 'Working…' : 'Post comment'}
          </button>
        </form>
      </section>
    </div>
  );
}
