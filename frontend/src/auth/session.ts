/**
 * ONE session for all three roles (passenger, staff, admin).
 *
 * The landing page sign-in card is the only place that signs anybody in. The role tab decides which existing
 * backend login route is called. The result is stored under the same two keys for every role:
 *   rrms_token  the JWT
 *   rrms_user   the user object (always has `role`: PASSENGER, STAFF or ADMIN, and `token`)
 * Sign out removes both keys. The passenger area (frontend/public/user) reads the same keys.
 */
import { API_CONFIG } from '../admin/config/api.config';

export type Role = 'PASSENGER' | 'STAFF' | 'ADMIN';

export interface Session {
  role: Role;
  token: string;
  user: { name: string; role: Role; token: string; [key: string]: unknown };
}

/** Where each role lands after signing in. */
export const HOME_PATH: Record<Role, string> = {
  PASSENGER: '/passenger',
  STAFF: '/staff',
  ADMIN: '/admin',
};

export const ROLE_LABEL: Record<Role, string> = {
  PASSENGER: 'Passenger',
  STAFF: 'Staff / TC',
  ADMIN: 'Admin',
};

/**
 * Demo accounts of the seed data (checked against the live API). They are used only by the
 * "Use demo account" buttons. Nothing is pre-filled on its own.
 */
export const DEMO_ACCOUNTS: Record<Role, { id: string; password: string }> = {
  PASSENGER: { id: 'rahul.sharma@example.com', password: 'Password123!' },
  STAFF: { id: 'EMP-TC-101', password: 'StaffPassword123!' },
  ADMIN: { id: 'admin@railways.gov.in', password: 'AdminPassword123!' },
};

const TOKEN_KEY = API_CONFIG.STORAGE_KEYS.TOKEN;
const USER_KEY = API_CONFIG.STORAGE_KEYS.USER;

export function getSession(): Session | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(USER_KEY);
    if (!token || !raw) return null;
    const user = JSON.parse(raw);
    if (!user || !['PASSENGER', 'STAFF', 'ADMIN'].includes(user.role)) return null;
    return { role: user.role as Role, token, user };
  } catch {
    return null;
  }
}

/** Remove the stored token and user only (keeps a search typed on the landing page). */
function clearStoredSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* storage not available: nothing to remove */
  }
}

/** Sign out: remove the session and any search that was waiting for a sign-in. */
export function signOut(): void {
  clearStoredSession();
  try {
    sessionStorage.removeItem('rrms_pending_search');
  } catch {
    /* storage not available */
  }
}

async function post(path: string, body: unknown): Promise<{ status: number; data: any; error?: any }> {
  let res: Response;
  try {
    res = await fetch(`${API_CONFIG.BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Cannot reach the server. Please check that the backend is running.');
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, data: json && json.data, error: json && json.error };
}

function store(role: Role, data: any, extra: Record<string, unknown> = {}): Session {
  const user = { ...data, ...extra, role, token: data.token } as Session['user'];
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return { role, token: data.token, user };
}

/** Sign in with the login route that belongs to the chosen role. Throws an Error with a plain message. */
export async function signIn(role: Role, id: string, password: string): Promise<Session> {
  const who = id.trim();
  if (!who || !password) {
    throw new Error(role === 'STAFF' ? 'Please enter your Employee ID and password.' : 'Please enter your email and password.');
  }
  const [path, body] =
    role === 'STAFF'
      ? ['/api/auth/staff/login', { employeeId: who, password }]
      : role === 'ADMIN'
        ? ['/api/auth/admin/login', { email: who, password }]
        : ['/api/auth/passenger/login', { email: who, password }];

  const r = await post(path, body);
  if (r.status === 200 && r.data && r.data.token) {
    if (r.data.role && r.data.role !== role) {
      throw new Error(`This account is not a ${ROLE_LABEL[role]} account.`);
    }
    clearStoredSession();
    return store(role, r.data, role === 'PASSENGER' ? { email: who } : {});
  }
  if (r.status === 401) throw new Error(`Wrong ${role === 'STAFF' ? 'Employee ID' : 'email'} or password for the ${ROLE_LABEL[role]} sign-in.`);
  if (r.status === 403) throw new Error(r.error?.message || 'This account is not allowed to sign in.');
  throw new Error(r.error?.message || 'Sign-in failed. Please try again.');
}

/** Create a passenger account and sign in with it. */
export async function registerPassenger(input: { name: string; email: string; phone: string; password: string }): Promise<Session> {
  const r = await post('/api/auth/passenger/register', input);
  if (r.status === 201 && r.data && r.data.token) {
    clearStoredSession();
    return store('PASSENGER', r.data);
  }
  throw new Error(r.error?.message || 'Could not create the account. Please check the details.');
}
