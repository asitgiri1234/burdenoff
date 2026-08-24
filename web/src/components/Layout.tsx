import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/useAuth.ts';

export function Layout({ children }: { children: ReactNode }): React.JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="app__header">
        <Link to="/" className="app__brand">
          Support&nbsp;Tracker
        </Link>

        <nav className="app__nav">
          <Link to="/">Dashboard</Link>
          <Link to="/tickets/new">New ticket</Link>
        </nav>

        {user !== null && (
          <div className="app__user">
            <span className="app__whoami">
              {user.name} <span className="tag">{user.role}</span>
            </span>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                logout();
                void navigate('/');
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      <main className="app__main">{children}</main>
    </div>
  );
}
