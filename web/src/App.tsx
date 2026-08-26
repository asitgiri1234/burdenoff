import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/useAuth.ts';
import { Layout } from './components/Layout.tsx';
import { CreateTicketPage } from './pages/CreateTicketPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { TicketDetailPage } from './pages/TicketDetailPage.tsx';

export function App(): React.JSX.Element {
  const { user, loading } = useAuth();

  if (loading) {
    return <p className="muted centered">Loading…</p>;
  }

  // Everything below requires a session. An UNAUTHORIZED from any request
  // clears `user`, which lands the viewer back here.
  if (user === null) {
    return <LoginPage />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tickets/new" element={<CreateTicketPage />} />
        <Route path="/tickets/:id" element={<TicketDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
