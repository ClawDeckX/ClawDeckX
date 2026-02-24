// Unified HTTP request wrapper with JWT token (via Cookie) and error code translation.

import { translateApiError } from './errorCodes';

export function getToken(): string | null {
  return null; // Token is now HttpOnly cookie
}

export function setToken(token: string): void {
  // No-op: Token is set via HttpOnly cookie by backend
}

export function clearToken(): void {
  // No-op: Logout should be handled by backend clearing the cookie
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error_code?: string;
  timestamp: string;
  request_id: string;
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  // Credentials 'include' ensures cookies are sent with the request
  const res = await fetch(url, { ...options, headers, credentials: 'include' });

  // 401 → reload only if previously authenticated (or let the app handle it)
  if (res.status === 401) {
    // If we get 401, it means the cookie is invalid or missing.
    // We can just reload to force a re-login flow if needed, or throw.
    if (!url.includes('/auth/login') && !url.includes('/auth/needs-setup')) {
      window.location.reload();
    }
    throw new ApiError('AUTH_UNAUTHORIZED', translateApiError('AUTH_UNAUTHORIZED', 'session expired'), 401);
  }

  const json: ApiResponse<T> = await res.json();

  if (!json.success) {
    const code = json.error_code || 'UNKNOWN';
    const msg = translateApiError(code, json.message || 'Request failed');
    throw new ApiError(code, msg, res.status);
  }

  return json.data as T;
}

export function get<T = any>(url: string): Promise<T> {
  return request<T>(url, { method: 'GET' });
}

export function post<T = any>(url: string, body?: any): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function put<T = any>(url: string, body?: any): Promise<T> {
  return request<T>(url, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function del<T = any>(url: string): Promise<T> {
  return request<T>(url, { method: 'DELETE' });
}
