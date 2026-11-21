import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../admin/auth/AuthContext';
import { Role } from './session';

/**
 * The one route guard. Signed out, or signed in with another role: back to the landing page ("/").
 * A signed-in user of the wrong role is sent to the landing page too, where "Go to my portal" takes them home.
 */
export const RoleRoute: React.FC<{ role: Role }> = ({ role }) => {
  const { session } = useAuth();
  if (!session || session.role !== role) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
};

/**
 * /passenger: the passenger area is the document /user/index.html (same site, same session).
 * Signed in as a passenger: go there at once. Anyone else: landing page.
 */
export const PassengerEntry: React.FC = () => {
  const { session } = useAuth();
  React.useEffect(() => {
    if (session && session.role === 'PASSENGER') {
      window.location.replace('/user/index.html');
    }
  }, [session]);
  if (!session || session.role !== 'PASSENGER') {
    return <Navigate to="/" replace />;
  }
  return <div className="p-8 text-sm" style={{ color: 'var(--rrms-text-muted)' }}>Opening the passenger area...</div>;
};
