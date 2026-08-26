import { useState, type FormEvent } from 'react';
import type { UserRole } from '../api/types.ts';
import { useAuth } from '../auth/useAuth.ts';
import { ErrorBanner } from '../components/ErrorBanner.tsx';
import { FieldError } from '../components/FieldError.tsx';

export function LoginPage(): React.JSX.Element {
  const { login, register } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('REPORTER');
  const [agentSignupCode, setAgentSignupCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register({
          name,
          email,
          password,
          role,
          ...(role === 'AGENT' ? { agentSignupCode } : {}),
        });
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <h1 className="auth__title">Support Ticket &amp; SLA Tracker</h1>

      {/* Exposed as a tablist so the mode switchers are distinguishable from
          the form's submit button, which deliberately shares their wording. */}
      <div className="auth__tabs" role="tablist" aria-label="Authentication mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          className={mode === 'login' ? 'tab tab--active' : 'tab'}
          onClick={() => {
            setMode('login');
            setError(null);
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={mode === 'register' ? 'tab tab--active' : 'tab'}
          onClick={() => {
            setMode('register');
            setError(null);
          }}
        >
          Create account
        </button>
      </div>

      {/*
        Each <label> wraps only its caption and control. Hints and validation
        messages sit outside it, linked with aria-describedby, so they are
        announced as a description instead of being swallowed into the field's
        accessible name.
      */}
      <form className="auth__form" onSubmit={(event) => void onSubmit(event)}>
        <ErrorBanner error={error} />

        {mode === 'register' && (
          <div className="field">
            <label>
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                autoComplete="name"
                required
              />
            </label>
            <FieldError error={error} path="name" />
          </div>
        )}

        <div className="field">
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              autoComplete="email"
              required
            />
          </label>
          <FieldError error={error} path="email" />
        </div>

        <div className="field">
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </label>
          <FieldError error={error} path="password" />
        </div>

        {mode === 'register' && (
          <>
            <div className="field">
              <label>
                <span>Role</span>
                <select
                  value={role}
                  onChange={(event) => {
                    setRole(event.target.value as UserRole);
                  }}
                >
                  <option value="REPORTER">Reporter</option>
                  <option value="AGENT">Agent</option>
                </select>
              </label>
              <FieldError error={error} path="role" />
            </div>

            {/* Agent accounts can read and change every ticket, so creating one
                requires the invite code held by whoever runs the deployment. */}
            {role === 'AGENT' && (
              <div className="field">
                <label>
                  <span>Agent signup code</span>
                  <input
                    value={agentSignupCode}
                    onChange={(event) => {
                      setAgentSignupCode(event.target.value);
                    }}
                    aria-describedby="agent-signup-code-hint"
                    required
                  />
                </label>
                <FieldError error={error} path="agentSignupCode" />
                <p id="agent-signup-code-hint" className="field__hint">
                  Required to register as an agent.
                </p>
              </div>
            )}
          </>
        )}

        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p className="auth__hint">
        Seeded accounts: <code>agent@example.com</code> / <code>reporter@example.com</code>,
        password <code>password123</code>
      </p>
    </div>
  );
}
