import React, { createContext, useContext, useState } from 'react';
import { AdminAuthUser } from '../types/user';
import { Role, Session, getSession, signIn as sessionSignIn, signOut as sessionSignOut } from '../../auth/session';

/**
 * The one auth context of the site. It holds the single session (any role).
 * `user`, `isAuthenticated`, `login` and `logout` are kept for the admin screens: they only apply when the
 * signed-in role is ADMIN.
 */
interface AuthContextType {
  session: Session | null;
  role: Role | null;
  user: AdminAuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  signIn: (role: Role, id: string, password: string) => Promise<Session>;
  signOut: () => void;
  login: (email: string, password: string) => Promise<AdminAuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(() => getSession());
  const [loading] = useState(false);

  React.useEffect(() => {
    // The http client dispatches this when the server answers 401 (expired or bad token)
    const handleUnauthorized = () => setSession(null);
    // Another tab signed in or out: follow it
    const handleStorage = () => setSession(getSession());
    window.addEventListener('admin:unauthorized', handleUnauthorized);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('admin:unauthorized', handleUnauthorized);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const signIn = async (role: Role, id: string, password: string): Promise<Session> => {
    const next = await sessionSignIn(role, id, password);
    setSession(next);
    return next;
  };

  const signOut = () => {
    sessionSignOut();
    setSession(null);
  };

  const adminUser = session && session.role === 'ADMIN' ? (session.user as unknown as AdminAuthUser) : null;

  return (
    <AuthContext.Provider
      value={{
        session,
        role: session ? session.role : null,
        user: adminUser,
        isAuthenticated: !!adminUser,
        loading,
        signIn,
        signOut,
        login: async (email, password) => (await signIn('ADMIN', email, password)).user as unknown as AdminAuthUser,
        logout: signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
