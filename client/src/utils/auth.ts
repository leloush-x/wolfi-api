/**
 * Admin token storage (sessionStorage — never persisted to disk).
 * Sent as `Authorization: Bearer <token>` once the server sets ADMIN_TOKEN.
 */

const KEY = 'wolfie_admin_token';

export function getToken(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
