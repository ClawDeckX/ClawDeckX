// Unified HTTP request wrapper with JWT token (via Cookie) and error code translation.

import { translateApiError } from './errorCodes';

const TOKEN_STORAGE_KEY = 'claw_ws_token';
let wsTokenCache: string | null = null;

export function getToken(): string | null {
  if (wsTokenCache) return wsTokenCache;
  try {
    wsTokenCache = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    return wsTokenCache;
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  wsTokenCache = token || null;
  try {
    if (token) window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

export function clearToken(): void {
  wsTokenCache = null;
  try {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error_code?: string;
  timestamp: string;
  request_id: string;
}

interface GetCacheEntry<T = any> {
  expiresAt: number;
  value?: T;
  inflight?: Promise<T>;
}

const getCache = new Map<string, GetCacheEntry<any>>();

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

export function getCached<T = any>(url: string, ttlMs = 5000, force = false): Promise<T> {
  const now = Date.now();
  const cached = getCache.get(url) as GetCacheEntry<T> | undefined;

  if (!force && cached && cached.value !== undefined && cached.expiresAt > now) {
    return Promise.resolve(cached.value);
  }

  if (cached?.inflight) {
    return cached.inflight;
  }

  const inflight = get<T>(url)
    .then((value) => {
      getCache.set(url, {
        value,
        expiresAt: Date.now() + Math.max(0, ttlMs),
      });
      return value;
    })
    .catch((err) => {
      // Keep previous cached value on failures, if any.
      if (cached?.value !== undefined) {
        getCache.set(url, {
          value: cached.value,
          expiresAt: cached.expiresAt,
        });
      } else {
        getCache.delete(url);
      }
      throw err;
    });

  getCache.set(url, {
    value: cached?.value,
    expiresAt: cached?.expiresAt || 0,
    inflight,
  });

  return inflight;
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
