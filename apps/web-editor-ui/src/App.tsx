import { useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useParams,
} from 'react-router-dom';
import UserForm from './components/UserForm';
import Dashboard from './components/Dashboard';
import { User } from '@frelated/types';

interface DashboardWrapperProps {
  user: User;
}

function DashboardWrapper({ user }: DashboardWrapperProps) {
  const { ownerEmail, projectId } = useParams<{
    ownerEmail: string;
    projectId: string;
  }>();
  return (
    <Dashboard user={user} owner={ownerEmail} initialProjectId={projectId} />
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUserSubmit = (userData: Record<string, any>) => {
    setIsLoading(true);
    setTimeout(() => {
      setUser({
        ...userData,
        id: Date.now().toString(),
        joinedAt: new Date().toISOString(),
      } as User);
      setIsLoading(false);
    }, 1000);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
          <p className="text-lg text-gray-700">Setting up your workspace...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <UserForm onUserSubmit={handleUserSubmit} />;
  }

  return (
    <Router>
      <Routes>
        {/* Normal dashboard access */}
        <Route path="/" element={<Dashboard user={user} />} />

        {/* Access via project link */}
        <Route
          path="/project/:ownerEmail/:projectId"
          element={<DashboardWrapper user={user} />}
        />
      </Routes>
    </Router>
  );
}

export default App;
