import { useState } from 'react';
import type { UserProfile } from './domain/types';
import { setAuthToken } from './services/api';
import { AuthPortal } from './components/AuthPortal';
import { StudentPortal } from './components/StudentPortal';
import { LibrarianPortal } from './components/LibrarianPortal';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);

  const handleLogout = () => {
    setAuthToken(null);
    setUser(null);
  };

  if (!user) {
    return <AuthPortal onAuthenticated={setUser} />;
  }

  if (user.role === 'LIBRARIAN') {
    return <LibrarianPortal user={user} onLogout={handleLogout} />;
  }

  return (
    <StudentPortal
      user={user}
      onUserUpdated={setUser}
      onLogout={handleLogout}
    />
  );
}
