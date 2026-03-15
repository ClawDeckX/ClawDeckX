// ClawDeckX API 服务层 — 对应后端所有 REST API 端点
import { get, getCached, post, put, del, setToken, clearToken, ApiError } from './request';
import { translateApiError } from './errorCodes';

// ==================== 鉴权 ====================
export const authApi = {
  needsSetup: () => get<{ needs_setup: boolean; login_hint?: string }>('/api/v1/auth/needs-setup'),
  setup: (username: string, password: string) =>
    post('/api/v1/auth/setup', { username, password }),
  login: async (username: string, password: string) => {
    const data = await post<{
      token: string;
      expires_at: string;
      user: { id: number; username: string; role: string };
    }>('/api/v1/auth/login', { username, password });
    setToken(data.token);
    return data;
  },
  changePassword: (old_password: string, new_password: string) =>
    put('/api/v1/auth/password', { old_password, new_password }),
  changeUsername: (new_username: string, password: string) =>
    put('/api/v1/auth/username', { new_username, password }),
  me: () => get<{ id: number; username: string; role: string }>('/api/v1/auth/me'),
  logout: () => post('/api/v1/auth/logout').then(() => {
    clearToken();
  }),
};

// ==================== 宿主机信息 ====================
export const hostInfoApi = {
  get: () => get<any>('/api/v1/host-info'),
  checkUpdate: () => get<any>('/api/v1/host-info/check-update'),
  deviceId: () => get<{ deviceId: string }>('/api/v1/host-info/device-id'),
};

// ==================== 自更新 ====================
export interface SelfUpdateInfo {
  version: string; build: string; os: string; arch: string; platform: string;
  openclawCompat?: string; goVersion?: string;
}
export interface UpdateCheckResult {
  available: boolean; currentVersion: string; latestVersion: string;
  releaseNotes?: string; publishedAt?: string;
  assetName?: string; assetSize?: number; downloadUrl?: string; error?: string;
  channel?: string;
}
export interface UpdateHistoryEntry {
  id: number; user_id: number; username: string; action: string;
  result: string; detail: string; ip: string; created_at: string;
}
export const selfUpdateApi = {
  info: () => get<SelfUpdateInfo>('/api/v1/self-update/info'),
  check: () => get<UpdateCheckResult>('/api/v1/self-update/check'),
  checkChannel: (channel: string) => get<UpdateCheckResult>(`/api/v1/self-update/check-channel?channel=${channel}`),
  history: () => get<UpdateHistoryEntry[]>('/api/v1/self-update/history'),
  translateNotes: (text: string, lang: string, product?: string, version?: string) => post<{ translated: string; status: string }>('/api/v1/self-update/translate-notes', { text, lang, product, version }),
};

export const serviceApi = {
  status: () => get<{ openclaw_installed: boolean; clawdeckx_installed: boolean }>('/api/v1/service/status'),
  installOpenClaw: () => post<{ message: string }>('/api/v1/service/openclaw/install', {}),
  uninstallOpenClaw: () => post<{ message: string }>('/api/v1/service/openclaw/uninstall', {}),
  installClawDeckX: () => post<{ message: string }>('/api/v1/service/clawdeckx/install', {}),
  uninstallClawDeckX: () => post<{ message: string }>('/api/v1/service/clawdeckx/uninstall', {}),
};

// ==================== 服务器访问配置 ====================
export interface ServerConfig {
  bind: string;
  port: number;
  cors_origins: string[];
}
export const serverConfigApi = {
  get: () => get<ServerConfig>('/api/v1/server-config'),
  update: (data: ServerConfig) => put<ServerConfig & { restart: boolean }>('/api/v1/server-config', data),
};

// ==================== 总览 ====================
export const dashboardApi = {
  get: () => get<{
    gateway: { running: boolean; runtime: string; detail: string };
    onboarding: {
      installed: boolean; initialized: boolean; model_configured: boolean;
      notify_configured: boolean; gateway_started: boolean; monitor_enabled: boolean;
    };
    monitor_summary: { total_events: number; events_24h: number; risk_counts: Record<string, number> };
    recent_alerts: any[];
    ws_clients: number;
  }>('/api/v1/dashboard'),
};

// ==================== 网关管理 ====================
export const gatewayApi = {
  status: () => get<{ running: boolean; runtime: string; detail: string }>('/api/v1/gateway/status'),
  statusCached: (ttlMs = 6000, force = false) =>
    getCached<{ running: boolean; runtime: string; detail: string }>('/api/v1/gateway/status', ttlMs, force),
  start: () => post('/api/v1/gateway/start'),
  stop: () => post('/api/v1/gateway/stop'),
  restart: () => post('/api/v1/gateway/restart'),
  kill: () => post('/api/v1/gateway/kill'),
  daemonStatus: () => get<{ platform: string; installed: boolean; enabled: boolean; active: boolean; unitFile: string; detail: string }>('/api/v1/gateway/daemon/status'),
  daemonInstall: () => post<{ platform: string; installed: boolean; enabled: boolean; active: boolean; unitFile: string; detail: string }>('/api/v1/gateway/daemon/install'),
  daemonUninstall: () => post<{ platform: string; installed: boolean; enabled: boolean; active: boolean; unitFile: string; detail: string }>('/api/v1/gateway/daemon/uninstall'),
  log: (lines = 200) => get<{ lines: string[] }>(`/api/v1/gateway/log?lines=${lines}`),
  logCached: (lines = 200, ttlMs = 5000, force = false) =>
    getCached<{ lines: string[] }>(`/api/v1/gateway/log?lines=${lines}`, ttlMs, force),
  logTail: (params?: { cursor?: number; limit?: number; maxBytes?: number }) => {
    const qs = new URLSearchParams();
    if (params?.cursor != null) qs.set('cursor', String(params.cursor));
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.maxBytes != null) qs.set('maxBytes', String(params.maxBytes));
    return get<{ lines: string[]; cursor: number; size: number; truncated: boolean; reset: boolean; remote?: boolean; path?: string }>(
      `/api/v1/gateway/log?${qs.toString()}`
    );
  },
  getHealthCheck: () => get<{
    enabled: boolean;
    fail_count: number;
    max_fails: number;
    last_ok: string;
    interval_sec?: number;
    reconnect_backoff_cap_ms?: number;
  }>('/api/v1/gateway/health-check'),
  getHealthCheckCached: (ttlMs = 6000, force = false) =>
    getCached<{
      enabled: boolean;
      fail_count: number;
      max_fails: number;
      last_ok: string;
      interval_sec?: number;
      reconnect_backoff_cap_ms?: number;
    }>('/api/v1/gateway/health-check', ttlMs, force),
  setHealthCheck: (payload: {
    enabled: boolean;
    interval_sec?: number;
    max_fails?: number;
    reconnect_backoff_cap_ms?: number;
  }) => put('/api/v1/gateway/health-check', payload),
  diagnose: () => post<{
    items: Array<{
      name: string;
      label: string;
      labelEn: string;
      status: 'pass' | 'fail' | 'warn';
      detail: string;
      suggestion?: string;
    }>;
    summary: string;
    message: string;
  }>('/api/v1/gateway/diagnose'),
  lifecycle: (params?: { page?: number; page_size?: number; event_type?: string; since?: string; until?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.page_size) qs.set('page_size', String(params.page_size));
    if (params?.event_type) qs.set('event_type', params.event_type);
    if (params?.since) qs.set('since', params.since);
    if (params?.until) qs.set('until', params.until);
    return get<{
      records: Array<{
        id: number;
        timestamp: string;
        event_type: string;
        gateway_host: string;
        gateway_port: number;
        profile_name: string;
        is_remote: boolean;
        reason: string;
        error_detail: string;
        uptime_sec: number;
      }>;
      total: number;
      page: number;
      page_size: number;
    }>(`/api/v1/gateway/lifecycle?${qs.toString()}`);
  },
  lifecycleNotifyConfig: () => get<{ notify_shutdown: boolean }>('/api/v1/gateway/lifecycle/notify-config'),
  setLifecycleNotifyConfig: (config: { notify_shutdown: boolean }) =>
    put<{ notify_shutdown: boolean }>('/api/v1/gateway/lifecycle/notify-config', config),
};

// ==================== 网关配置档案（多网关管理） ====================
export const gatewayProfileApi = {
  list: () => get<any[]>('/api/v1/gateway/profiles'),
  listCached: (ttlMs = 15000, force = false) => getCached<any[]>('/api/v1/gateway/profiles', ttlMs, force),
  create: (data: { name: string; host: string; port: number; token: string }) =>
    post('/api/v1/gateway/profiles', data),
  update: (id: number, data: { name?: string; host?: string; port?: number; token?: string }) =>
    put(`/api/v1/gateway/profiles?id=${id}`, data),
  remove: (id: number) => del(`/api/v1/gateway/profiles?id=${id}`),
  activate: (id: number) => post(`/api/v1/gateway/profiles/activate?id=${id}`),
  testConnection: (data: { host: string; port: number; token: string }) =>
    post('/api/v1/gateway/profiles/test', data),
};

// ==================== 活动流 ====================
export const activityApi = {
  list: (params?: { page?: number; page_size?: number; category?: string; risk?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.page_size) qs.set('page_size', String(params.page_size));
    if (params?.category) qs.set('category', params.category);
    if (params?.risk) qs.set('risk', params.risk);
    return get<{ list: any[]; total: number; page: number; page_size: number }>(
      `/api/v1/activities?${qs.toString()}`
    );
  },
};

// ==================== 统一事件流 ====================
export const eventsApi = {
  list: (params?: {
    page?: number;
    page_size?: number;
    risk?: string;
    type?: 'all' | 'activity' | 'alert';
    source?: string;
    keyword?: string;
    start_time?: string;
    end_time?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.page_size) qs.set('page_size', String(params.page_size));
    if (params?.risk) qs.set('risk', params.risk);
    if (params?.type) qs.set('type', params.type);
    if (params?.source) qs.set('source', params.source);
    if (params?.keyword) qs.set('keyword', params.keyword);
    if (params?.start_time) qs.set('start_time', params.start_time);
    if (params?.end_time) qs.set('end_time', params.end_time);
    return get<{ list: any[]; total: number; page: number; page_size: number }>(`/api/v1/events?${qs.toString()}`);
  },
};

// ==================== 监控统计 ====================
export const monitorApi = {
  stats: () => get('/api/v1/monitor/stats'),
  getConfig: () => get('/api/v1/monitor/config'),
  updateConfig: (data: any) => put('/api/v1/monitor/config', data),
  start: () => post('/api/v1/monitor/start'),
  stop: () => post('/api/v1/monitor/stop'),
};

// ==================== 系统设置 ====================
export const settingsApi = {
  getAll: () => get('/api/v1/settings'),
  update: (data: any) => put('/api/v1/settings', data),
  getGateway: () => get('/api/v1/settings/gateway'),
  updateGateway: (data: any) => put('/api/v1/settings/gateway', data),
  getLanguage: () => get<{ language: string }>('/api/v1/settings/language'),
  setLanguage: (language: string) => put<{ language: string }>('/api/v1/settings/language', { language }),
};

// ==================== 配对管理 ====================
export const pairingApi = {
  list: (channel: string) => get<{ channel: string; requests: any[]; error?: string }>(`/api/v1/pairing/list?channel=${channel}`),
  approve: (channel: string, code: string) => post<{ message: string; status: string }>('/api/v1/pairing/approve', { channel, code }),
};

// ==================== 通知配置 ====================
export interface NotifyConfigResponse {
  config: Record<string, string>;
  active_channels: string[];
  available_channels: Array<{ type: string; has_token: boolean }>;
}
export interface NotifyUpdateResponse {
  message: string;
  active_channels: string[];
}
export const notifyApi = {
  getConfig: () => get<NotifyConfigResponse>('/api/v1/notify/config'),
  getConfigCached: (ttlMs = 15000, force = false) => getCached<NotifyConfigResponse>('/api/v1/notify/config', ttlMs, force),
  updateConfig: (data: Record<string, string>) => put<NotifyUpdateResponse>('/api/v1/notify/config', data),
  testSend: (message?: string, channel?: string) => post('/api/v1/notify/test', { message: message || '', ...(channel ? { channel } : {}) }),
};

// ==================== 告警 ====================
export const alertApi = {
  list: (params?: { page?: number; page_size?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.page_size) qs.set('page_size', String(params.page_size));
    return get<{ list: any[]; total: number; page: number; page_size: number }>(
      `/api/v1/alerts?${qs.toString()}`
    );
  },
  markAllRead: () => post('/api/v1/alerts/read-all'),
  markRead: (id: string) => post(`/api/v1/alerts/${id}`),
};

// ==================== 审计日志 ====================
export const auditApi = {
  list: (params?: { page?: number; page_size?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.page_size) qs.set('page_size', String(params.page_size));
    return get<{ list: any[]; total: number; page: number; page_size: number }>(
      `/api/v1/audit-logs?${qs.toString()}`
    );
  },
};

// ==================== OpenClaw 配置 ====================
export const configApi = {
  get: () => get<{ config: Record<string, any>; path: string; parsed: boolean }>('/api/v1/config'),
  update: (config: Record<string, any>) => put('/api/v1/config', { config }),
  validate: (config: Record<string, any>) => post<{
    ok: boolean;
    code: string;
    summary: string;
    issues: Array<{ path: string; level: string; message: string; hint?: string }>;
    meta?: { duration_ms?: number; validated_at?: string };
  }>('/api/v1/config/validate', { config }),
  generateDefault: () => post<{ message: string; path: string }>('/api/v1/config/generate-default'),
  setKey: (key: string, value: string, json = true) => post<{ message: string; key: string }>('/api/v1/config/set-key', { key, value, json }),
  unsetKey: (key: string) => post<{ message: string; key: string }>('/api/v1/config/unset-key', { key }),
  getKey: (key: string) => get<{ key: string; value: any }>(`/api/v1/config/get-key?key=${encodeURIComponent(key)}`),
};

// ==================== 快照管理 ====================
export interface SnapshotScheduleConfig {
  enabled: boolean;
  time: string;
  retentionCount: number;
  timezone: string;
  passwordSet: boolean;
}

export interface SnapshotScheduleStatus {
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastStatus: 'success' | 'failed' | 'skipped' | 'never';
  lastError?: string;
  lastSnapshotId?: string;
  running: boolean;
}

export interface SnapshotStatsResponse {
  total_count: number;
  total_size_bytes: number;
  latest_backup_at: string | null;
  oldest_backup_at: string | null;
  manual_count: number;
  scheduled_count: number;
  import_count: number;
  days_since_backup: number;
  schedule_enabled: boolean;
}

export interface OpenClawImportResult {
  snapshot_id: string;
  resource_count: number;
  size_bytes: number;
  platform?: string;
  runtime_version?: string;
  created_at?: string;
}

export interface VerifyIntegrityResult {
  ok: boolean;
  resource_count: number;
  verified_count: number;
  total_size_bytes: number;
  error?: string;
}

export interface FileDiffResult {
  logical_path: string;
  backup_content: string;
  current_content: string;
  backup_exists: boolean;
  current_exists: boolean;
}

export const snapshotApi = {
  list: () => get<any[]>('/api/v1/snapshots'),
  listCached: (ttlMs = 10000, force = false) => getCached<any[]>('/api/v1/snapshots', ttlMs, force),
  create: (data: { note?: string; trigger?: string; resourceIds?: string[]; password: string }) => post('/api/v1/snapshots', data),
  unlockPreview: (id: string, password: string) => post(`/api/v1/snapshots/${id}/unlock-preview`, { password }),
  restorePlan: (id: string, data: { previewToken: string; restoreSelections: { files?: string[]; config_paths?: string[]; configPaths?: string[] } }) =>
    post(`/api/v1/snapshots/${id}/restore-plan`, data),
  restore: (id: string, data: { previewToken: string; restorePlan: { files?: string[]; config_paths?: string[]; configPaths?: string[] }; createPreRestoreSnapshot?: boolean; password?: string }) =>
    post(`/api/v1/snapshots/${id}/restore`, data),
  restoreStream: (id: string, data: { previewToken: string; restorePlan: { files?: string[]; config_paths?: string[] }; createPreRestoreSnapshot?: boolean; password?: string }, onProgress: (evt: { phase: string; current: number; total: number; file?: string; error?: string }) => void): Promise<any> => {
    return new Promise(async (resolve, reject) => {
      try {
        const res = await fetch(`/api/v1/snapshots/${id}/restore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ...data, stream: true }),
        });
        if (!res.ok || !res.body) {
          const json = await res.json().catch(() => ({}));
          const code = json.error_code || 'SNAPSHOT_RESTORE_FAILED';
          const msg = translateApiError(code, json.message || 'Restore failed');
          reject(new ApiError(code, msg, res.status));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result: any = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('event: result')) {
              continue;
            }
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                if (parsed.phase === 'error') {
                  const code = 'SNAPSHOT_RESTORE_FAILED';
                  const msg = translateApiError(code, `backup restore failed: ${parsed.error}`);
                  reject(new ApiError(code, msg, 500));
                  return;
                }
                if (parsed.restored_resources !== undefined) {
                  result = parsed;
                } else {
                  onProgress(parsed);
                }
              } catch {}
            }
          }
        }
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  },
  remove: (id: string) => del(`/api/v1/snapshots/${id}`),
  exportUrl: (id: string) => `/api/v1/snapshots/${id}/export`,
  importFile: async (file: File): Promise<{ snapshotId: string; resourceCount: number; sizeBytes: number }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/v1/snapshots/import', { method: 'POST', body: form, credentials: 'include' });
    const json = await res.json();
    if (!json.success) {
      const code = json.error_code || 'SNAPSHOT_IMPORT_FAILED';
      const msg = translateApiError(code, json.message || 'Import failed');
      throw new ApiError(code, msg, res.status);
    }
    return json.data;
  },
  getSchedule: () => get<SnapshotScheduleConfig>('/api/v1/snapshots/schedule'),
  updateSchedule: (data: { enabled: boolean; time: string; retentionCount: number; timezone?: string; password?: string }) =>
    put('/api/v1/snapshots/schedule', data),
  getScheduleStatus: () => get<SnapshotScheduleStatus>('/api/v1/snapshots/schedule/status'),
  scheduleRunNow: () => post<{ snapshotId: string }>('/api/v1/snapshots/schedule/run-now', {}),
  stats: () => get<SnapshotStatsResponse>('/api/v1/snapshots/stats'),
  importOpenClaw: async (file: File, password: string, note?: string): Promise<OpenClawImportResult> => {
    const form = new FormData();
    form.append('file', file);
    form.append('password', password);
    if (note) form.append('note', note);
    const res = await fetch('/api/v1/snapshots/import-openclaw', { method: 'POST', body: form, credentials: 'include' });
    const json = await res.json();
    if (!json.success) {
      const code = json.error_code || 'SNAPSHOT_IMPORT_FAILED';
      const msg = translateApiError(code, json.message || 'Import failed');
      throw new ApiError(code, msg, res.status);
    }
    return json.data;
  },
  exportOpenClaw: async (id: string, password: string): Promise<void> => {
    const res = await fetch(`/api/v1/snapshots/${id}/export-openclaw`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new ApiError(json.error_code || 'SNAPSHOT_EXPORT_FAILED', json.message || 'Export failed', res.status);
    }
    const disp = res.headers.get('content-disposition') || '';
    const fnMatch = disp.match(/filename="?([^";\s]+)"?/);
    const filename = fnMatch?.[1] || `openclaw-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
  verify: (id: string, password: string) => post<VerifyIntegrityResult>(`/api/v1/snapshots/${id}/verify`, { password }),
  previewFile: (id: string, previewToken: string, logicalPath: string) =>
    post<{ logical_path: string; content: string; size: number }>(`/api/v1/snapshots/${id}/preview-file`, { previewToken, logicalPath }),
  diffFile: (id: string, previewToken: string, logicalPath: string) =>
    post<FileDiffResult>(`/api/v1/snapshots/${id}/diff-file`, { previewToken, logicalPath }),
  batchDelete: (ids: string[]) => post<{ deleted: string[]; errors: string[] }>('/api/v1/snapshots/batch-delete', { ids }),
  pruneKeepN: (keepN: number) => post<{ deleted: string[]; kept: number }>('/api/v1/snapshots/prune', { keepN }),
};

// ==================== 诊断修复 ====================
export const doctorApi = {
  run: () => get('/api/v1/doctor'),
  runCached: (ttlMs = 10000, force = false) => getCached('/api/v1/doctor', ttlMs, force),
  summary: () => get<{
    score: number;
    status: 'ok' | 'warn' | 'error';
    summary: string;
    updatedAt: string;
    gateway: { running: boolean; detail: string };
    healthCheck: { enabled: boolean; failCount: number; maxFails: number; lastOk: string };
    exceptionStats: { medium5m: number; high5m: number; critical5m: number; total1h: number; total24h: number };
    recentIssues: Array<{ id: string; source: string; category: string; risk: string; title: string; detail?: string; timestamp: string }>;
  }>('/api/v1/doctor/summary'),
  summaryCached: (ttlMs = 5000, force = false) => getCached<{
    score: number;
    status: 'ok' | 'warn' | 'error';
    summary: string;
    updatedAt: string;
    gateway: { running: boolean; detail: string };
    healthCheck: { enabled: boolean; failCount: number; maxFails: number; lastOk: string };
    exceptionStats: { medium5m: number; high5m: number; critical5m: number; total1h: number; total24h: number };
    recentIssues: Array<{ id: string; source: string; category: string; risk: string; title: string; detail?: string; timestamp: string }>;
  }>('/api/v1/doctor/summary', ttlMs, force),
  overview: () => get<{
    score: number;
    status: 'ok' | 'warn' | 'error';
    summary: string;
    updatedAt: string;
    cards: Array<{ id: string; label: string; value: number; unit?: string; trend?: number; status: 'ok' | 'warn' | 'error' }>;
    riskCounts: Record<string, number>;
    trend24h: Array<{
      timestamp: string;
      label: string;
      healthScore: number;
      low: number;
      medium: number;
      high: number;
      critical: number;
      errors: number;
    }>;
    topIssues: Array<{ id: string; source: string; category: string; risk: string; title: string; detail?: string; timestamp: string }>;
    actions: Array<{ id: string; title: string; target: string; priority: 'high' | 'medium' | 'low' }>;
  }>('/api/v1/doctor/overview'),
  overviewCached: (ttlMs = 10000, force = false) => getCached<{
    score: number;
    status: 'ok' | 'warn' | 'error';
    summary: string;
    updatedAt: string;
    cards: Array<{ id: string; label: string; value: number; unit?: string; trend?: number; status: 'ok' | 'warn' | 'error' }>;
    riskCounts: Record<string, number>;
    trend24h: Array<{
      timestamp: string;
      label: string;
      healthScore: number;
      low: number;
      medium: number;
      high: number;
      critical: number;
      errors: number;
    }>;
    topIssues: Array<{ id: string; source: string; category: string; risk: string; title: string; detail?: string; timestamp: string }>;
    actions: Array<{ id: string; title: string; target: string; priority: 'high' | 'medium' | 'low' }>;
  }>('/api/v1/doctor/overview', ttlMs, force),
  fix: (checks?: string[]) => post('/api/v1/doctor/fix', checks && checks.length > 0 ? { checks } : {}),
};

// ==================== Recipe 步骤操作 ====================
export const recipeApi = {
  applyStep: (data: { action: 'append' | 'replace'; file: string; content: string; target?: string }) =>
    post<{ success: boolean; backupPath?: string; message: string }>('/api/v1/recipe/apply-step', data),
};

// ==================== LLM 供应商健康 ====================
export interface LlmProviderStatus {
  provider: string;
  model: string;
  profileId?: string;
  label?: string;
  source?: string;
  mode?: string;
  authStatus: 'ok' | 'expiring' | 'expired' | 'missing' | 'static';
  authType?: 'api-key' | 'token' | 'oauth';
  expiresAt?: number;
  remainingMs?: number;
}

export interface LlmProbeResult {
  provider: string;
  model: string;
  profileId?: string;
  label?: string;
  source?: string;
  mode?: string;
  status: 'ok' | 'auth' | 'rate_limit' | 'billing' | 'timeout' | 'format' | 'unknown' | 'no_model';
  error?: string;
  latencyMs?: number;
}

export interface LlmAuthHealthSummary {
  profiles: LlmProviderStatus[];
  providers: Array<{
    provider: string;
    status: 'ok' | 'expiring' | 'expired' | 'missing' | 'static';
    profileCount: number;
  }>;
}

export interface LlmProbeSummary {
  results: LlmProbeResult[];
  totalMs: number;
  okCount: number;
  failCount: number;
}

export interface LlmModelsStatusResponse {
  providers: LlmAuthHealthSummary;
  models: Array<{
    provider: string;
    model: string;
    role?: string;
    source?: string;
  }>;
  fallbacks: Array<{
    role: string;
    chain: Array<{ provider: string; model: string }>;
  }>;
}

export interface CliExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ExecCapability {
  mode: 'local' | 'remote' | 'unavailable';
  is_remote: boolean;
  local_cli: boolean;
  gw_connected: boolean;
}

export const llmApi = {
  modelsStatus: () => get<LlmModelsStatusResponse>('/api/v1/llm/models-status'),
  modelsStatusCached: (ttlMs = 15000, force = false) =>
    getCached<LlmModelsStatusResponse>('/api/v1/llm/models-status', ttlMs, force),
  probe: (params?: { provider?: string; profileId?: string; timeoutMs?: number; concurrency?: number; maxTokens?: number }) =>
    post<LlmProbeSummary>('/api/v1/llm/probe', params || {}),
  authHealth: () => get<LlmAuthHealthSummary>('/api/v1/llm/auth-health'),
  authHealthCached: (ttlMs = 15000, force = false) =>
    getCached<LlmAuthHealthSummary>('/api/v1/llm/auth-health', ttlMs, force),
  exec: (command: string, args: string[] = [], timeoutMs = 30000) =>
    post<CliExecResult>('/api/v1/llm/exec', { command, args, timeoutMs }),
  execCapability: () => get<ExecCapability>('/api/v1/llm/exec-capability'),
  execCapabilityCached: (ttlMs = 10000, force = false) =>
    getCached<ExecCapability>('/api/v1/llm/exec-capability', ttlMs, force),
};

// ==================== 用户管理 ====================
export const userApi = {
  list: () => get<any[]>('/api/v1/users'),
  create: (data: any) => post('/api/v1/users', data),
  remove: (id: string) => del(`/api/v1/users/${id}`),
};

// ==================== 技能审计（已废弃，统一使用 gwApi.skills()）====================
// @deprecated 使用 gwApi.skills() 替代，后端已改为走 skills.status RPC
export const skillsApi = {
  list: () => get<any[]>('/api/v1/skills'),
};

// ==================== 模板管理 ====================
export const templateApi = {
  list: (targetFile?: string) => get<any[]>(targetFile ? `/api/v1/templates?target_file=${encodeURIComponent(targetFile)}` : '/api/v1/templates'),
  get: (id: number) => get<any>(`/api/v1/templates/?id=${id}`),
  create: (data: { template_id: string; target_file: string; icon: string; category: string; tags: string; author: string; i18n: string }) => post<any>('/api/v1/templates', data),
  update: (data: { id: number; template_id?: string; target_file?: string; icon?: string; category?: string; tags?: string; author?: string; i18n?: string }) => put<any>('/api/v1/templates', data),
  remove: (id: number) => del<any>(`/api/v1/templates/?id=${id}`),
};

// ==================== 插件安装 ====================
export interface PluginListItem {
  id: string;
  spec?: string;
  installed: boolean;
  enabled: boolean;
}
export interface PluginListResponse {
  plugins: PluginListItem[];
  can_install: boolean;
  is_remote: boolean;
}
export interface PluginStatusPlugin {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  kind?: string;
  source?: string;
  origin?: string;
  status: 'loaded' | 'disabled' | 'error';
  error?: string;
  enabled?: boolean;
  installed?: boolean;
  spec?: string;
  installSource?: string;
  installPath?: string;
  installedAt?: string;
  toolNames?: string[];
  hookNames?: string[];
  channelIds?: string[];
  providerIds?: string[];
  gatewayMethods?: string[];
  cliCommands?: string[];
  services?: string[];
  commands?: string[];
  httpRoutes?: number;
  hookCount?: number;
  configSchema?: boolean;
}
export interface PluginDiagnostic {
  level: 'error' | 'warn';
  pluginId?: string;
  source?: string;
  message: string;
}
export interface PluginStatusResponse {
  plugins: PluginStatusPlugin[];
  diagnostics: PluginDiagnostic[];
  slots: Record<string, string>;
  allow: string[];
  deny: string[];
  can_install: boolean;
  is_remote: boolean;
}
export const pluginApi = {
  list: () => get<PluginListResponse>('/api/v1/plugins/list'),
  status: () => get<PluginStatusResponse>('/api/v1/plugins/status'),
  canInstall: () => get<{ can_install: boolean; is_remote: boolean }>('/api/v1/plugins/can-install'),
  checkInstalled: (spec: string) => get<{ installed: boolean; spec: string }>(`/api/v1/plugins/check?spec=${encodeURIComponent(spec)}`),
  install: (spec: string) => post<{ success: boolean; spec: string; output: string }>('/api/v1/plugins/install', { spec }),
  uninstall: (id: string) => post<{ success: boolean; id: string; output: string }>('/api/v1/plugins/uninstall', { id }),
  update: (id?: string, all?: boolean) => post<{ success: boolean; id: string; all: boolean; output: string }>('/api/v1/plugins/update', { id, all }),
};

// ==================== Gateway 代理 API ====================
// 统一通过 GenericProxy (/api/v1/gw/proxy) 透传 JSON-RPC 到 Gateway。
// 仅保留少量 REST 路由：status（本地连接检查）、sessionsUsage / usageCost（Go 层有额外参数/超时）、
// skillsConfig / skillsConfigure（Go 层有复杂聚合逻辑）。
const rpc = <T = any>(method: string, params?: any): Promise<T> =>
  post<T>('/api/v1/gw/proxy', { method, params: params ?? {} });

export const gwApi = {
  // --- 保留 REST（Go 层有额外逻辑） ---
  status: () => get('/api/v1/gw/status'),
  reconnect: () => post('/api/v1/gw/reconnect'),
  sessionsUsage: (params?: { startDate?: string; endDate?: string; limit?: number; key?: string }) => {
    const qs = new URLSearchParams();
    if (params?.startDate) qs.set('startDate', params.startDate);
    if (params?.endDate) qs.set('endDate', params.endDate);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.key) qs.set('key', params.key);
    const q = qs.toString();
    return get(`/api/v1/gw/sessions/usage${q ? '?' + q : ''}`);
  },
  usageCost: (params?: { startDate?: string; endDate?: string; days?: number }) => {
    const qs = new URLSearchParams();
    if (params?.startDate) qs.set('startDate', params.startDate);
    if (params?.endDate) qs.set('endDate', params.endDate);
    if (params?.days) qs.set('days', String(params.days));
    const q = qs.toString();
    return get(`/api/v1/gw/usage/cost${q ? '?' + q : ''}`);
  },
  skillsConfig: () => get('/api/v1/gw/skills/config'),
  skillsConfigure: (data: any) => post('/api/v1/gw/skills/configure', data),

  // --- 全部走 JSON-RPC proxy ---
  // Health & Status
  health: () => rpc('health', { probe: false }),
  info: () => rpc('status'),
  // Sessions
  sessions: () => rpc<any[]>('sessions.list'),
  sessionsPreview: (key: string, opts?: { limit?: number; maxChars?: number }) =>
    rpc('sessions.preview', { keys: [key], limit: opts?.limit ?? 12, maxChars: opts?.maxChars ?? 240 }),
  sessionsMessages: (key: string, limit = 20) =>
    rpc('sessions.preview', { keys: [key], limit, maxChars: 500 }),
  sessionsHistory: (key: string) =>
    rpc('chat.history', { sessionKey: key }),
  sessionsReset: (key: string) =>
    rpc('sessions.reset', { key }),
  sessionsDelete: (key: string, deleteTranscript = false) =>
    rpc('sessions.delete', { key, deleteTranscript }),
  sessionsPatch: (key: string, patch: { label?: string | null; thinkingLevel?: string | null; verboseLevel?: string | null; reasoningLevel?: string | null }) =>
    rpc('sessions.patch', { key, ...patch }),
  sessionsResolve: (key: string) =>
    rpc('sessions.resolve', { key }),
  sessionsCompact: (key: string) =>
    rpc('sessions.compact', { key }),
  sessionsUsageTimeseries: (key: string, params?: { startDate?: string; endDate?: string; granularity?: string }) =>
    rpc('sessions.usage.timeseries', { key, ...params }),
  sessionsUsageLogs: (key: string, params?: { startDate?: string; endDate?: string; limit?: number; offset?: number }) =>
    rpc('sessions.usage.logs', { key, ...params }),
  // Models
  models: () => rpc<any[]>('models.list'),
  // Usage
  usageStatus: () => rpc('usage.status'),
  // Skills
  skills: () => rpc<any[]>('skills.status'),
  skillsUpdate: (params: { skillKey: string; enabled?: boolean; apiKey?: string }) =>
    rpc('skills.update', params),
  // Config
  configGet: () => rpc('config.get'),
  configSet: (key: string, value: any) => {
    const patch: Record<string, any> = {};
    const parts = key.split('.');
    let obj = patch;
    for (let i = 0; i < parts.length - 1; i++) { obj[parts[i]] = {}; obj = obj[parts[i]]; }
    obj[parts[parts.length - 1]] = value;
    return rpc('config.patch', { raw: JSON.stringify(patch) });
  },
  configSetAll: (config: Record<string, any>) => rpc('config.set', { raw: JSON.stringify(config, null, 2) }),
  configReload: () => Promise.resolve({ ok: true }),
  configApply: (raw: string, baseHash: string) =>
    rpc('config.apply', { raw, baseHash }),
  configPatch: (raw: string, baseHash: string) =>
    rpc('config.patch', { raw, baseHash }),
  configSchema: () => rpc('config.schema'),
  // Agents
  agents: () => rpc<any[]>('agents.list'),
  agentIdentity: (agentId: string) =>
    rpc('agent.identity.get', { agentId }),
  agentWait: (runId: string, timeoutMs = 120000) =>
    rpc('agent.wait', { runId, timeoutMs }),
  agentFilesList: (agentId: string) =>
    rpc('agents.files.list', { agentId }),
  agentFileGet: (agentId: string, name: string) =>
    rpc('agents.files.get', { agentId, name }),
  agentFileSet: (agentId: string, name: string, content: string) =>
    rpc('agents.files.set', { agentId, name, content }),
  agentSkills: (agentId: string) =>
    rpc('skills.status', { agentId }),
  // Cron
  cron: () => rpc<any[]>('cron.list', { includeDisabled: true }),
  cronList: (opts?: {
    includeDisabled?: boolean; limit?: number; offset?: number;
    query?: string; enabled?: 'all' | 'enabled' | 'disabled';
    sortBy?: 'nextRunAtMs' | 'updatedAtMs' | 'name'; sortDir?: 'asc' | 'desc';
  }) => rpc('cron.list', { includeDisabled: true, ...opts }),
  cronStatus: () => rpc('cron.status'),
  cronAdd: (job: any) => rpc('cron.add', job),
  cronUpdate: (id: string, patch: any) =>
    rpc('cron.update', { id, patch }),
  cronRun: (id: string, mode: 'force' | 'due' = 'force') =>
    rpc('cron.run', { id, mode }),
  cronRemove: (id: string) =>
    rpc('cron.remove', { id }),
  cronRuns: (id: string, limit = 50, opts?: {
    offset?: number; status?: string; statuses?: string[];
    deliveryStatus?: string; deliveryStatuses?: string[];
    query?: string; sortDir?: 'asc' | 'desc';
  }) => rpc('cron.runs', { id, limit, ...opts }),
  cronRunsAll: (opts?: {
    limit?: number; offset?: number; status?: string; statuses?: string[];
    deliveryStatus?: string; query?: string; sortDir?: 'asc' | 'desc';
  }) => rpc('cron.runs', { scope: 'all', ...opts }),
  // Exec Approvals
  execApprovalsGet: (target?: { kind: string; nodeId?: string }) => {
    const method = target?.kind === 'node' ? 'exec.approvals.node.get' : 'exec.approvals.get';
    const params = target?.kind === 'node' ? { nodeId: target.nodeId } : {};
    return rpc(method, params);
  },
  execApprovalsSet: (file: any, baseHash: string, target?: { kind: string; nodeId?: string }) => {
    const method = target?.kind === 'node' ? 'exec.approvals.node.set' : 'exec.approvals.set';
    const params = target?.kind === 'node' ? { file, baseHash, nodeId: target.nodeId } : { file, baseHash };
    return rpc(method, params);
  },
  execApprovalDecision: (id: string, decision: string) =>
    rpc('exec.approval.resolve', { id, decision }),
  // Nodes
  nodeList: () => rpc('node.list'),
  nodeDescribe: (nodeId: string) => rpc('node.describe', { nodeId }),
  nodeRename: (nodeId: string, displayName: string) => rpc('node.rename', { nodeId, displayName }),
  nodePairRequest: (params: { nodeId: string; displayName?: string; platform?: string }) =>
    rpc('node.pair.request', params),
  nodePairList: () => rpc('node.pair.list'),
  nodePairApprove: (requestId: string) =>
    rpc('node.pair.approve', { requestId }),
  nodePairReject: (requestId: string) =>
    rpc('node.pair.reject', { requestId }),
  nodePairVerify: (nodeId: string, token: string) =>
    rpc('node.pair.verify', { nodeId, token }),
  // Devices
  devicePairList: () => rpc('device.pair.list'),
  devicePairApprove: (requestId: string) =>
    rpc('device.pair.approve', { requestId }),
  devicePairReject: (requestId: string) =>
    rpc('device.pair.reject', { requestId }),
  deviceTokenRotate: (deviceId: string, role: string, scopes?: string[]) =>
    rpc('device.token.rotate', { deviceId, role, scopes }),
  deviceTokenRevoke: (deviceId: string, role: string) =>
    rpc('device.token.revoke', { deviceId, role }),
  // Channels
  channels: () => rpc('channels.status'),
  channelsLogout: (channel: string) =>
    rpc('channels.logout', { channel }),
  // Logs
  logsTail: (limit = 100) => rpc('logs.tail', { limit }),
  // System
  lastHeartbeat: () => rpc('last-heartbeat'),
  setHeartbeats: (enabled: boolean) =>
    rpc('set-heartbeats', { enabled }),
  systemEvent: (text: string) =>
    rpc('system-event', { text }),
  // Talk mode
  talkMode: (enabled: boolean, phase?: string) =>
    rpc('talk.mode', { enabled, ...(phase ? { phase } : {}) }),
  // Browser
  browserRequest: (method: string, path: string) =>
    rpc('browser.request', { method, path }),
  // Wizard
  wizardStart: (params: any) => rpc('wizard.start', params),
  wizardNext: (sessionId: string, input: any, stepId?: string) =>
    rpc('wizard.next', { sessionId, answer: input != null ? { stepId: stepId || '', value: input } : undefined }),
  wizardCancel: (sessionId: string) =>
    rpc('wizard.cancel', { sessionId }),
  wizardStatus: (sessionId: string) =>
    rpc('wizard.status', { sessionId }),
  // Update
  updateRun: (params?: { sessionKey?: string; note?: string; restartDelayMs?: number; timeoutMs?: number }) =>
    rpc('update.run', params),
  // Web (WhatsApp) login
  webLoginStart: (params?: { force?: boolean; timeoutMs?: number; accountId?: string }) =>
    rpc('web.login.start', params),
  webLoginWait: (params?: { timeoutMs?: number; accountId?: string }) =>
    rpc('web.login.wait', params),
  // Doctor: Memory status
  memoryStatus: () => rpc<{
    agentId: string;
    provider?: string;
    embedding: { ok: boolean; error?: string };
  }>('doctor.memory.status'),
  // Tools catalog
  toolsCatalog: (params?: { agentId?: string; includePlugins?: boolean }) =>
    rpc<{
      agentId: string;
      profiles: Array<{ id: string; label: string }>;
      groups: Array<{
        id: string;
        label: string;
        source: 'core' | 'plugin';
        pluginId?: string;
        tools: Array<{
          id: string;
          label: string;
          description: string;
          source: 'core' | 'plugin';
          pluginId?: string;
          optional?: boolean;
          defaultProfiles: string[];
        }>;
      }>;
    }>('tools.catalog', params),
  // Generic proxy (escape hatch)
  proxy: (method: string, params?: any) => rpc(method, params),
};

// ==================== 技能翻译 ====================
export const skillTranslationApi = {
  get: (lang: string, keys: string[]) =>
    get<any[]>(`/api/v1/skills/translations?lang=${encodeURIComponent(lang)}&keys=${encodeURIComponent(keys.join(','))}`),
  translate: (lang: string, skills: { skill_key: string; name: string; description: string }[], engine?: string) =>
    post<any>('/api/v1/skills/translations', { lang, skills, ...(engine ? { engine } : {}) }),
};

// ==================== ClawHub 技能市场 ====================
export interface ClawHubListResponse {
  items: any[];
  nextCursor?: string;
  _rateLimit?: {
    limit: string;
    remaining: string;
    reset: string;
  };
}
export const clawHubApi = {
  list: (sort = 'newest', limit = 20, cursor?: string) => {
    let url = `/api/v1/clawhub/list?sort=${sort}&limit=${limit}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    return get<ClawHubListResponse>(url);
  },
  search: (q: string) => get<any[]>(`/api/v1/clawhub/search?q=${encodeURIComponent(q)}`),
  detail: (slug: string) => get(`/api/v1/clawhub/skill?slug=${encodeURIComponent(slug)}`),
  install: (slug: string) => post('/api/v1/clawhub/install', { slug }),
  uninstall: (slug: string) => post('/api/v1/clawhub/uninstall', { slug }),
  update: (slug: string) => post('/api/v1/clawhub/update', { slug }),
  updateAll: () => post('/api/v1/clawhub/update', { all: true }),
  installed: () => get<any[]>('/api/v1/clawhub/installed'),
};

// ==================== 数据导出 ====================
export const exportApi = {
  activities: () => '/api/v1/export/activities',
  alerts: () => '/api/v1/export/alerts',
  auditLogs: () => '/api/v1/export/audit-logs',
};

// ==================== 角标计数 ====================
export const badgeApi = {
  counts: () => get<Record<string, number>>('/api/v1/badges'),
};

// ==================== 健康检查 ====================
export const healthApi = {
  check: () => get<{ status: string; version: string }>('/api/v1/health'),
};

// ==================== 上下文预算分析 ====================
export interface ContextFile {
  fileName: string;
  size: number;
  tokenEstimate: number;
  percentage: number;
  status: 'ok' | 'warn' | 'critical';
  lastModified: string;
}

export interface ContextBudgetAnalysis {
  totalSize: number;
  totalTokens: number;
  budgetLimit: number;
  usagePercentage: number;
  status: 'ok' | 'warn' | 'critical';
  files: ContextFile[];
  suggestions: Array<{ file: string; issue: string; action: string; estimatedSaving: number }>;
}

export interface OptimizeResult {
  file: string;
  originalSize: number;
  newSize: number;
  savedTokens: number;
  changes: string[];
}

export const contextBudgetApi = {
  analyze: (agentId?: string) => get<ContextBudgetAnalysis>(`/api/v1/maintenance/context/analyze${agentId ? `?agent=${agentId}` : ''}`),
  analyzeCached: (agentId?: string, ttlMs = 30000, force = false) => 
    getCached<ContextBudgetAnalysis>(`/api/v1/maintenance/context/analyze${agentId ? `?agent=${agentId}` : ''}`, ttlMs, force),
  optimize: (fileName: string, agentId?: string) => 
    post<OptimizeResult>('/api/v1/maintenance/context/optimize', { fileName, agentId }),
  optimizeAll: (agentId?: string) => 
    post<{ results: OptimizeResult[]; totalSaved: number }>('/api/v1/maintenance/context/optimize-all', { agentId }),
};

// ==================== 多 Agent 部署 ====================
export interface MultiAgentDeployRequest {
  template: {
    id: string;
    name: string;
    description: string;
    agents: Array<{
      id: string;
      name: string;
      role: string;
      description?: string;
      icon?: string;
      color?: string;
      soul?: string;
      heartbeat?: string;
      tools?: string;
      skills?: string[];
      env?: Record<string, string>;
    }>;
    workflow: {
      type: 'sequential' | 'parallel' | 'collaborative' | 'event-driven' | 'routing';
      description?: string;
      steps: Array<{
        agent?: string;
        agents?: string[];
        action: string;
        parallel?: boolean;
        condition?: string;
      }>;
    };
    bindings?: Array<{
      agentId: string;
      match: Record<string, any>;
    }>;
  };
  prefix?: string;
  skipExisting?: boolean;
  dryRun?: boolean;
}

export interface MultiAgentDeployResult {
  success: boolean;
  deployedCount: number;
  skippedCount: number;
  agents: Array<{
    id: string;
    name: string;
    status: 'created' | 'skipped' | 'failed' | 'preview';
    workspace?: string;
    error?: string;
  }>;
  bindings?: Array<{
    agentId: string;
    status: 'configured' | 'failed';
    error?: string;
  }>;
  errors?: string[];
  coordinatorUpdated?: boolean;
  coordinatorError?: string;
}

export interface MultiAgentStatus {
  totalAgents: number;
  deployments: Record<string, string[]>;
  standalone: string[];
}

export const multiAgentApi = {
  deploy: (request: MultiAgentDeployRequest) => 
    post<MultiAgentDeployResult>('/api/v1/multi-agent/deploy', request),
  previewDeploy: (request: MultiAgentDeployRequest) => 
    post<MultiAgentDeployResult>('/api/v1/multi-agent/preview', { ...request, dryRun: true }),
  status: () => get<MultiAgentStatus>('/api/v1/multi-agent/status'),
  remove: (prefix?: string, agents?: string[]) => 
    post<{ removed: number; agents: Record<string, boolean> }>('/api/v1/multi-agent/delete', { prefix, agents }),
};

// Workflow Orchestration API
export interface WorkflowExecutionStep {
  agent: string;
  action: string;
  parallel?: boolean;
  condition?: string;
  timeout?: number;
}

export interface WorkflowExecutionDefinition {
  id: string;
  name: string;
  description: string;
  type: 'sequential' | 'parallel' | 'collaborative' | 'event-driven' | 'routing';
  steps: WorkflowExecutionStep[];
  agents: string[];
}

export interface StepResult {
  stepIndex: number;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  runId?: string;
  sessionKey?: string;
  output?: string;
  error?: string;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  currentStep: number;
  startedAt: string;
  completedAt?: string;
  stepResults: StepResult[];
  error?: string;
  definition: WorkflowExecutionDefinition;
}

export interface StartWorkflowRequest {
  definition: WorkflowExecutionDefinition;
  initialTask: string;
  prefix?: string;
}

export const workflowApi = {
  start: (request: StartWorkflowRequest) =>
    post<{ instanceId: string; status: string }>('/api/v1/workflow/start', request),
  status: (instanceId?: string) =>
    get<WorkflowInstance | { workflows: WorkflowInstance[]; count: number }>(
      instanceId ? `/api/v1/workflow/status?id=${instanceId}` : '/api/v1/workflow/status'
    ),
  stop: (instanceId: string) =>
    post<{ instanceId: string; status: string }>('/api/v1/workflow/stop', { instanceId }),
};

// ==================== SkillHub ====================
export interface SkillHubCLIStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface SkillHubSkill {
  slug: string;
  name: string;
  homepage: string;
  version: string;
  description: string;
  description_zh?: string;
  stars: number;
  downloads: number;
  installs: number;
  tags: string[];
  updated_at: number;
  score: number;
}

export interface SkillHubData {
  total: number;
  generated_at: string;
  featured: string[];
  categories: Record<string, string[]>;
  skills: SkillHubSkill[];
}

export interface SkillHubPageResponse {
  skills: SkillHubSkill[];
  total: number;
  page: number;
  size: number;
  hasMore: boolean;
  categories: Record<string, string[]>;
  featured: string[];
}

export interface SkillHubSearchResponse {
  skills: SkillHubSkill[];
  total: number;
  query: string;
}

export const skillHubApi = {
  cliStatus: () => get<SkillHubCLIStatus>('/api/v1/skillhub/cli-status'),
  install: () => post<{ success: boolean; output: string }>('/api/v1/skillhub/install', {}),
  installSkill: (slug: string) => post<{ success: boolean; output: string; slug: string }>('/api/v1/skillhub/install-skill', { slug }),
  getData: (url?: string) => {
    const endpoint = url ? `/api/v1/skillhub/data?url=${encodeURIComponent(url)}` : '/api/v1/skillhub/data';
    return get<SkillHubData>(endpoint);
  },
  listSkills: (page = 1, size = 60, sort = 'newest', category = 'all', featured = false) => {
    let url = `/api/v1/skillhub/skills?page=${page}&size=${size}&sort=${sort}`;
    if (category && category !== 'all') url += `&category=${encodeURIComponent(category)}`;
    if (featured) url += '&featured=true';
    return get<SkillHubPageResponse>(url);
  },
  searchSkills: (q: string, limit = 20) =>
    get<SkillHubSearchResponse>(`/api/v1/skillhub/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  getInstalledSkills: () => get<{ skills: string[] }>('/api/v1/skillhub/installed'),
};
