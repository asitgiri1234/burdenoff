import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../api/operations.ts';
import { PRIORITIES, type Priority } from '../api/types.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { FieldError } from '../components/FieldError.tsx';
import { humanise } from '../lib/format.ts';

export function CreateTicketPage(): React.JSX.Element {
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const created = await api.createTicket({ title, description, priority });
      await navigate(`/tickets/${created.id}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page--narrow">
      <h1>New ticket</h1>

      {/* Labels wrap only the caption and control; hints and errors sit outside
          so they do not become part of the field's accessible name. */}
      <form className="card" onSubmit={(event) => void onSubmit(event)}>
        <ErrorBanner error={error} />

        <div className="field">
          <label>
            <span>Title</span>
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              required
            />
          </label>
          <FieldError error={error} path="title" />
        </div>

        <div className="field">
          <label>
            <span>Description</span>
            <textarea
              value={description}
              rows={6}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
              required
            />
          </label>
          <FieldError error={error} path="description" />
        </div>

        <div className="field">
          <label>
            <span>Priority</span>
            <select
              value={priority}
              onChange={(event) => {
                setPriority(event.target.value as Priority);
              }}
              aria-describedby="priority-hint"
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {humanise(value)}
                </option>
              ))}
            </select>
          </label>
          <FieldError error={error} path="priority" />
          <p id="priority-hint" className="field__hint">
            Priority sets the SLA budget. The server computes the deadlines from
            business hours when the ticket is created.
          </p>
        </div>

        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create ticket'}
        </button>
      </form>
    </div>
  );
}
