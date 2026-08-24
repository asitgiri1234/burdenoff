import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getToken, setToken, setUnauthorizedHandler } from '../api/client.ts';
import * as api from '../api/operations.ts';
import type { User, UserRole } from '../api/types.ts';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  agentSignupCode?: string;
}

export interface AuthContextValue {
  user: User | null;
  /** True while the stored token is being exchanged for the current user. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback((): void => {
    setToken(null);
    setUser(null);
  }, []);

  // Any UNAUTHORIZED from anywhere in the app drops the session; the router
  // then renders the sign-in screen because `user` is null.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  // Restore the session from a stored token on first load.
  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<void> {
      if (getToken() === null) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const me = await api.fetchMe();
        if (!cancelled) setUser(me);
      } catch {
        // A stale or rejected token just means signed out.
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const payload = await api.login(email, password);
    setToken(payload.token);
    setUser(payload.user);
  }, []);

  const register = useCallback(async (input: RegisterInput): Promise<void> => {
    const payload = await api.register(input);
    setToken(payload.token);
    setUser(payload.user);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
