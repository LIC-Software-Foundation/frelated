import { useEffect, useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useParams,
} from 'react-router-dom';

import type { User } from '@frelated/types';
import { appServices } from './services';
import type { LoginPayload, RegisterPayload } from './services/auth.types';
import {
  clearNotifications,
  connectNotifications,
  disconnectNotifications,
} from './services/notificationService';
import { readApiSession } from './services/api/sessionStorage';

const COLLAB_URL =
  (import.meta.env.VITE_COLLAB_SERVER_URL as string | undefined) ||
  'ws://localhost:8080';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ProjectsPage from './pages/ProjectsPage';
import Dashboard from './components/Dashboard';
import { ToastProvider } from './components/ui/Toast';

// ─── Auth guard ────────────────────────────────────────────────────────────────

const RequireAuth: React.FC<{
  user: User | null;
  children: React.ReactNode;
}> = ({ user, children }) =>
  user ? <>{children}</> : <Navigate to="/login" replace />;

// ─── Editor route ──────────────────────────────────────────────────────────────

interface EditorRouteProps {
  user: User;
}

const EditorRoute: React.FC<EditorRouteProps> = ({ user }) => {
  const { projectId } = useParams<{ projectId: string }>();
  return <Dashboard user={user} initialProjectId={projectId} />;
};

// ─── Shared project (access via /project/:ownerEmail/:projectId) ───────────────

interface SharedEntryProps {
  user: User | null;
  isSubmitting: boolean;
  onLogin: (p: LoginPayload) => Promise<void>;
}

const SharedProjectRoute: React.FC<SharedEntryProps> = ({
  user,
  isSubmitting,
  onLogin,
}) => {
  const { ownerEmail, projectId } = useParams<{
    ownerEmail: string;
    projectId: string;
  }>();
  const navigate = useNavigate();

  if (user) {
    return (
      <Dashboard user={user} owner={ownerEmail} initialProjectId={projectId} />
    );
  }

  return (
    <LoginPage
      onLogin={async (payload) => {
        await onLogin(payload);
        navigate(`/project/${ownerEmail}/${projectId}`);
      }}
      isSubmitting={isSubmitting}
    />
  );
};

// ─── App root ──────────────────────────────────────────────────────────────────

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapping, setBooting] = useState(true);
  const [isSubmitting, setSubmit] = useState(false);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      const restoredUser = await appServices.auth.restoreSession();

      if (!active) {
        return;
      }

      setUser(restoredUser);
      setBooting(false);

      // Connect notification WS if a session exists
      if (restoredUser) {
        const session = readApiSession();
        if (session?.token) {
          connectNotifications(COLLAB_URL, session.token);
        }
      }
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  // Logout immediately when any API call receives a 401
  useEffect(() => {
    const handleExpired = () => {
      disconnectNotifications();
      clearNotifications();
      setUser(null);
    };
    window.addEventListener('frelated:session-expired', handleExpired);
    return () =>
      window.removeEventListener('frelated:session-expired', handleExpired);
  }, []);

  const handleLogin = async (payload: LoginPayload) => {
    setSubmit(true);
    try {
      const u = await appServices.auth.login(payload);
      setUser(u);
      // Connect notification WS after login
      const session = readApiSession();
      if (session?.token) {
        connectNotifications(COLLAB_URL, session.token);
      }
    } finally {
      setSubmit(false);
    }
  };

  const handleRegister = async (payload: RegisterPayload) => {
    setSubmit(true);
    try {
      const u = await appServices.auth.register(payload);
      setUser(u);
    } finally {
      setSubmit(false);
    }
  };

  const handleLogout = () => {
    disconnectNotifications();
    clearNotifications();
    setUser(null);
  };

  // ── Bootstrap splash ──
  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-[#f0f4f2] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#2d6a4f] shadow-lg shadow-emerald-900/20 mb-5">
            <svg
              className="h-7 w-7 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </div>
          <p className="text-[15px] font-semibold text-slate-700">
            Chargement de Frelated…
          </p>
          <div className="mt-4 flex justify-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-[#2d6a4f]"
                style={{
                  animation: 'bounce 1s ease-in-out infinite',
                  animationDelay: `${i * 0.15}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <Router>
        <Routes>
          {/* ── Public ── */}
          <Route
            path="/"
            element={
              user ? <Navigate to="/projects" replace /> : <LandingPage />
            }
          />
          <Route
            path="/login"
            element={
              user ? (
                <Navigate to="/projects" replace />
              ) : (
                <LoginPage onLogin={handleLogin} isSubmitting={isSubmitting} />
              )
            }
          />
          <Route
            path="/register"
            element={
              user ? (
                <Navigate to="/projects" replace />
              ) : (
                <RegisterPage
                  onRegister={handleRegister}
                  isSubmitting={isSubmitting}
                />
              )
            }
          />

          {/* ── Protected ── */}
          <Route
            path="/projects"
            element={
              <RequireAuth user={user}>
                <ProjectsPage user={user!} onLogout={handleLogout} />
              </RequireAuth>
            }
          />
          <Route
            path="/editor/:projectId"
            element={
              <RequireAuth user={user}>
                <EditorRoute user={user!} />
              </RequireAuth>
            }
          />

          {/* ── Shared project link ── */}
          <Route
            path="/project/:ownerEmail/:projectId"
            element={
              <SharedProjectRoute
                user={user}
                isSubmitting={isSubmitting}
                onLogin={handleLogin}
              />
            }
          />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </ToastProvider>
  );
}

export default App;
