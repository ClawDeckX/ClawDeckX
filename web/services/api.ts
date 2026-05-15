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
  // 与 selfUpdateApi.releases 对称；返回 GitHub openclaw/openclaw 最近 release 列表。
  // 10 分钟缓存，减少 GitHub API 调用避免限流；force=true 由刷新按钮触发。
  openclawReleases: (limit = 20, force = false) => getCached<ReleaseSummary[]>(`/api/v1/host-info/openclaw-releases?limit=${limit}`, 10 * 60 * 1000, force),
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
export interface UpdateOverviewProductStatus {
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable: boolean;
  error?: string;
}
export interface UpdateOverviewCompatibility {
  currentVersion?: string;
  required?: string;
  compatible: boolean;
}
export interface UpdateOverview {
  checkedAt?: string;
  nextCheckAt?: string;
  clawdeckx: UpdateOverviewProductStatus;
  openclaw: UpdateOverviewProductStatus;
  compatibility: UpdateOverviewCompatibility;
}
export interface UpdateHistoryEntry {
  id: number; user_id: number; username: string; action: string;
  result: string; detail: string; ip: string; created_at: string;
}
export interface ReleaseSummary {
  tagName: string;
  name: string;
  prerelease: boolean;
  publishedAt: string;
  hasAsset: boolean;
  isCurrent?: boolean;
  isOlder?: boolean;
}
export const selfUpdateApi = {
  info: () => get<SelfUpdateInfo>('/api/v1/self-update/info'),
  overview: (force = false) => get<UpdateOverview>(`/api/v1/self-update/overview${force ? '?force=1' : ''}`),
  /** 无 tag = 最新 stable；传 tag 则精确拉取该版本的 release（支持降级）。 */
  check: (tag?: string) => get<UpdateCheckResult>(`/api/v1/self-update/check${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`),
  checkChannel: (channel: string) => get<UpdateCheckResult>(`/api/v1/self-update/check-channel?channel=${channel}`),
  /** 列出最近 N 个 release（含 prerelease），用于"指定版本升级"下拉。10 分钟缓存。 */
  releases: (limit = 20, force = false) => getCached<ReleaseSummary[]>(`/api/v1/self-update/releases?limit=${limit}`, 10 * 60 * 1000, force),
  history: () => get<UpdateHistoryEntry[]>('/api/v1/self-update/history'),
  translateNotes: (text: string, lang: string, product?: string, version?: string) => post<{ translated: string; status: string }>('/api/v1/self-update/translate-notes', { text, lang, product, version }),
  dismissUpdate: async (product: 'clawdeckx' | 'openclaw', version: string) => {
    const key = product === 'clawdeckx' ? 'dismissed_clawdeckx_version' : 'dismissed_openclaw_version';
    await put('/api/v1/settings', { [key]: version });
  },
  undismissUpdate: async (product: 'clawdeckx' | 'openclaw') => {
    const key = product === 'clawdeckx' ? 'dismissed_clawdeckx_version' : 'dismissed_openclaw_version';
    await put('/api/v1/settings', { [key]: '' });
  },
  getDismissedVersions: () => get<Record<string, string>>('/api/v1/settings'),
};

export const serviceApi = {
  status: () => get<{ openclaw_installed: boolean; clawdeckx_installed: boolean; is_docker: boolean }>('/api/v1/service/status'),
  installOpenClaw: () => post<{ message: string }>('/api/v1/service/openclaw/install', {}),
  uninstallOpenClaw: () => post<{ message: string }>('/api/v1/service/openclaw/uninstall', {}),
  installClawDeckX: () => post<{ message: string }>('/api/v1/service/clawdeckx/install', {}),
  uninstallClawDeckX: () => post<{ message: string }>('/api/v1/service/clawdeckx/uninstall', {}),
};

// ==================== Docker 运行时覆盖 ====================
export interface RuntimeComponentStatus {
  component: string;
  active_version: string;
  image_version: string;
  runtime_version?: string;
  source?: string;
  installed_at?: string;
  prev_version?: string;
  using_overlay: boolean;
  overlay_mismatch?: boolean;
}
export interface RuntimeStatus {
  is_docker: boolean;
  clawdeckx: RuntimeComponentStatus;
  openclaw: RuntimeComponentStatus;
}
export const runtimeApi = {
  status: () => get<RuntimeStatus>('/api/v1/runtime/status'),
  rollback: (component: string) => post<{ message: string; status: RuntimeComponentStatus }>('/api/v1/runtime/rollback', { component }),
  restart: () => post<{ message: string }>('/api/v1/runtime/restart'),
};

// ==================== 服务器访问配置 ====================
export interface ServerConfig {
  bind: string;
  port: number;
  cors_origins: string[];
  clawhub_query_url: string;
  clawhub_source: 'convex' | 'volces';
  skillhub_data_url: string;
}
export const serverConfigApi = {
  get: () => get<ServerConfig>('/api/v1/server-config'),
  update: (data: ServerConfig) => put<ServerConfig & { restart: boolean }>('/api/v1/server-config', data),
  restart: () => post<{ message: string }>('/api/v1/server-config/restart'),
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
  getReadyz: () => get<{
    status: string;
    eventLoop?: {
      delay?: { p50?: number; p99?: number; max?: number };
      utilization?: number;
      degraded?: boolean;
    };
    [key: string]: any;
  }>('/api/v1/gateway/readyz'),
  getHealthCheck: () => get<{
    enabled: boolean;
    fail_count: number;
    max_fails: number;
    last_ok: string;
    interval_sec?: number;
    reconnect_backoff_cap_sec?: number;
    reconnect_backoff_cap_ms?: number;
    restart_grace_sec?: number;
  }>('/api/v1/gateway/health-check'),
  getHealthCheckCached: (ttlMs = 6000, force = false) =>
    getCached<{
      enabled: boolean;
      fail_count: number;
      max_fails: number;
      last_ok: string;
      interval_sec?: number;
      reconnect_backoff_cap_sec?: number;
      reconnect_backoff_cap_ms?: number;
      restart_grace_sec?: number;
    }>('/api/v1/gateway/health-check', ttlMs, force),
  setHealthCheck: (payload: {
    enabled: boolean;
    interval_sec?: number;
    max_fails?: number;
    reconnect_backoff_cap_sec?: number;
    reconnect_backoff_cap_ms?: number;
    restart_grace_sec?: number;
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
  create: (data: { name: string; host: string; port: number; path?: string; token: string }) =>
    post('/api/v1/gateway/profiles', data),
  update: (id: number, data: { name?: string; host?: string; port?: number; path?: string; token?: string }) =>
    put(`/api/v1/gateway/profiles?id=${id}`, data),
  remove: (id: number) => del(`/api/v1/gateway/profiles?id=${id}`),
  activate: (id: number) => post(`/api/v1/gateway/profiles/activate?id=${id}`),
  testConnection: (data: { host: string; port: number; path?: string; token: string }) =>
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
export interface NotifyEventItem {
  event: string;
  enabled: boolean;
  channels?: string[];
}
export interface NotifyEventConfigResponse {
  events: NotifyEventItem[];
  active_channels: string[];
}
export const notifyApi = {
  getConfig: () => get<NotifyConfigResponse>('/api/v1/notify/config'),
  getConfigCached: (ttlMs = 15000, force = false) => getCached<NotifyConfigResponse>('/api/v1/notify/config', ttlMs, force),
  updateConfig: (data: Record<string, string>) => put<NotifyUpdateResponse>('/api/v1/notify/config', data),
  testSend: (message?: string, channel?: string) => post('/api/v1/notify/test', { message: message || '', ...(channel ? { channel } : {}) }),
  getEventConfig: () => get<NotifyEventConfigResponse>('/api/v1/notify/events'),
  updateEventConfig: (events: Array<{ event: string; enabled?: boolean; channels?: string[] }>) =>
    put<{ message: string }>('/api/v1/notify/events', { events }),
};

// ==================== 每日汇报 ====================
export interface DigestConfigResponse {
  config: Record<string, string>;
  sections: Array<{ id: string }>;
  timezone: string;
  local_time: string;
}
export interface DigestPreviewResponse {
  date: string;
  subject: string;
  content: string;
  sections: Array<{ id: string; title: string; empty: boolean; lines: string[] }>;
}
export interface DigestSendResponse {
  date: string;
  status: string; // success | partial | empty | failed | preview
  subject: string;
  content: string;
  errors?: string[];
}
export interface DigestHistoryItem {
  id: number;
  digest_date: string;
  generated_at: string;
  channels: string;
  sections: string;
  status: string;
  subject: string;
  content: string;
  error_detail?: string;
}
export const digestApi = {
  getConfig: () => get<DigestConfigResponse>('/api/v1/notify/digest/config'),
  updateConfig: (data: Record<string, string>) =>
    put<{ message: string }>('/api/v1/notify/digest/config', data),
  preview: () => post<DigestPreviewResponse>('/api/v1/notify/digest/preview', {}),
  testSend: () => post<DigestSendResponse>('/api/v1/notify/digest/test', {}),
  history: (limit = 7) =>
    get<{ list: DigestHistoryItem[] }>(`/api/v1/notify/digest/history?limit=${limit}`),
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
  directUpdate: (config: Record<string, any>) => put('/api/v1/config/direct', { config }),
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
  scope: string;
  resourceIds?: string[];
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

export interface SnapshotScanResource {
  id: string;
  type: string;
  displayName: string;
  logicalPath: string;
  scope: string;
  required: boolean;
  exists: boolean;
  sizeBytes: number;
}

export interface SnapshotScanGroup {
  id: string;
  title: string;
  resources: SnapshotScanResource[];
}

export interface SnapshotScanResult {
  scope: string;
  summary: {
    totalResources: number;
    existingResources: number;
    missingResources: number;
    totalBytes: number;
  };
  groups: SnapshotScanGroup[];
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
  scan: (scope?: string) => get<SnapshotScanResult>(`/api/v1/snapshots/scan${scope ? `?scope=${encodeURIComponent(scope)}` : ''}`),
  create: (data: { note?: string; trigger?: string; resourceIds?: string[]; password: string; scope?: string }) => post('/api/v1/snapshots', data),
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
  updateSchedule: (data: { enabled: boolean; time: string; retentionCount: number; timezone?: string; password?: string; scope?: string; resourceIds?: string[] }) =>
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

// ==================== OpenClaw 原生备份 ====================
export interface OcBackupArchive {
  name: string;
  path: string;
  size: number;
  modTime: string;
}
export interface OcBackupCreateResult {
  createdAt: string;
  archiveRoot: string;
  archivePath: string;
  dryRun: boolean;
  includeWorkspace: boolean;
  onlyConfig: boolean;
  verified: boolean;
  assets: { kind: string; sourcePath: string; displayPath: string }[];
}
export interface BackupConfigInfo {
  directory: string;
  effective: string;
  default_directory: string;
  is_docker: boolean;
  env_locked: boolean;
}
export const backupConfigApi = {
  get: () => get<BackupConfigInfo>('/api/v1/backup-config'),
  update: (directory: string) => put<{ directory: string; effective: string }>('/api/v1/backup-config', { directory }),
};

export const ocBackupApi = {
  create: (data: { includeWorkspace?: boolean; onlyConfig?: boolean; verify?: boolean }) =>
    post<OcBackupCreateResult>('/api/v1/openclaw-backup/create', data),
  list: () => get<{ backupDir: string; archives: OcBackupArchive[]; installed: boolean }>('/api/v1/openclaw-backup/list'),
  download: async (path: string): Promise<void> => {
    const res = await fetch('/api/v1/openclaw-backup/download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new ApiError(json.error_code || 'DOWNLOAD_FAILED', json.message || 'Download failed', res.status);
    }
    const disp = res.headers.get('content-disposition') || '';
    const fnMatch = disp.match(/filename="?([^";\s]+)"?/);
    const filename = fnMatch?.[1] || 'openclaw-backup.tar.gz';
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },
  remove: (path: string) => post<{ deleted: boolean }>('/api/v1/openclaw-backup/delete', { path }),
};

// ==================== 配置备份 (.bak) ====================
export interface ConfigBackupFile {
  name: string;
  path: string;
  size: number;
  modTime: string;
  index: number;
}
export const configBackupApi = {
  list: () => get<{ configPath: string; backups: ConfigBackupFile[] }>('/api/v1/config-backups'),
  preview: (path: string) => post<{ content: string; valid: boolean }>('/api/v1/config-backups/preview', { path }),
  restore: (path: string) => post<{ restored: boolean }>('/api/v1/config-backups/restore', { path }),
  diff: (path: string) => post<{ current: string; backup: string; diffLines: { type: 'equal' | 'add' | 'remove' | 'separator'; text: string }[]; jsonChanges?: { path: string; type: 'changed' | 'added' | 'removed'; oldValue?: string; newValue?: string }[] }>('/api/v1/config-backups/diff', { path }),
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
  cliFix: () => post<{ exitCode: number; output: string; success: boolean }>('/api/v1/doctor/cli-fix', {}),
  tasksMaintenance: () => post<{ exitCode: number; output: string; success: boolean }>('/api/v1/doctor/tasks-maintenance', {}),
  tasksList: (opts?: { runtime?: string; status?: string }) => {
    const params = new URLSearchParams();
    if (opts?.runtime) params.set('runtime', opts.runtime);
    if (opts?.status) params.set('status', opts.status);
    const qs = params.toString();
    return get<{ count: number; tasks: any[] }>(`/api/v1/doctor/tasks-list${qs ? `?${qs}` : ''}`);
  },
  tasksShow: (id: string) => get<any>(`/api/v1/doctor/tasks-show?id=${encodeURIComponent(id)}`),
  tasksCancel: (id: string) => post<{ exitCode: number; output: string; success: boolean }>('/api/v1/doctor/tasks-cancel', { id }),
  tasksAudit: (severity?: string) => {
    const qs = severity ? `?severity=${encodeURIComponent(severity)}` : '';
    return get<{ count: number; findings: any[]; summary: any }>(`/api/v1/doctor/tasks-audit${qs}`);
  },
};

// ==================== Recipe 步骤操作 ====================
export const recipeApi = {
  applyStep: (data: { action: 'append' | 'replace'; file: string; content: string; target?: string }) =>
    post<{ success: boolean; backupPath?: string; message: string }>('/api/v1/recipe/apply-step', data),
};

// ==================== Claude / Hermes 一键迁移（OpenClaw 2026.4.26+）====================
export interface MigrateProvider {
  id: string;
  title?: string;
  description?: string;
  source?: string;
  pluginId?: string;
}
export interface MigrateItem {
  id: string;
  kind: string;
  action: string;
  status: string;
  target?: string;
  sensitive?: boolean;
  message?: string;
  reason?: string;
}
export interface MigrateSummary {
  total: number;
  conflicts: number;
  sensitive: number;
  errors?: number;
  applied?: number;
  skipped?: number;
  archived?: number;
  manualOnly?: number;
}
export interface MigratePlan {
  providerId: string;
  source: string;
  target?: string;
  summary: MigrateSummary;
  items: MigrateItem[];
  warnings?: string[];
  nextSteps?: string[];
}
export interface MigrateApplyResult extends MigratePlan {
  backupPath?: string;
  reportDir?: string;
}
export interface MigrateDetectResult {
  provider: string;
  path: string;
  exists: boolean;
}
export interface MigratePlanRequest {
  provider: string;
  from?: string;
  includeSecrets?: boolean;
  overwrite?: boolean;
}
export interface MigrateApplyRequest extends MigratePlanRequest {
  noBackup?: boolean;
  force?: boolean;
  backupOutput?: string;
}
export interface RemoteOpenClawImportRequest {
  mode: 'clawdeckx' | 'gateway';
  baseUrl?: string;
  username?: string;
  loginPassword?: string;
  host?: string;
  port?: number;
  token?: string;
  cookie?: string;
  gatewayPath?: string;
  password: string;
  note?: string;
  scope?: string;
  resourceIds?: string[];
}
export interface RemoteOpenClawImportResult {
  snapshotId: string;
  resourceCount: number;
  sizeBytes: number;
}
export const migrateApi = {
  list: () => get<{ providers: MigrateProvider[] }>('/api/v1/migrate/list'),
  detect: () => get<{ results: MigrateDetectResult[] }>('/api/v1/migrate/detect'),
  plan: (data: MigratePlanRequest) => post<MigratePlan>('/api/v1/migrate/plan', data),
  apply: (data: MigrateApplyRequest) =>
    post<{ ok: boolean; error?: string; result: MigrateApplyResult }>('/api/v1/migrate/apply', data),
  importRemoteOpenClaw: (data: RemoteOpenClawImportRequest) =>
    post<RemoteOpenClawImportResult>('/api/v1/migrate/remote-openclaw/import', data),
};

// ==================== Prometheus 可观测 ====================
export interface PromMetricValue {
  labels: Record<string, string>;
  value: number;
  suffix?: string;
}
export interface PromMetric {
  name: string;
  type: string;
  help: string;
  values: PromMetricValue[];
}
export interface PromParseResult {
  metrics: PromMetric[];
  raw: string;
}
export interface PromScrapeConfig {
  scrapeUrl: string;
  target: string;
  metricsPath: string;
  token: string;
  yamlSnippet: string;
}
export type GatewayObservedPhase =
  | 'stopped'
  | 'starting'
  | 'tcp_open'
  | 'http_live'
  | 'http_ready'
  | 'pairing'
  | 'auth_refresh'
  | 'ws_connected'
  | 'rpc_ready'
  | 'restarting'
  | 'grace';
export interface GatewayObservedState {
  phase: GatewayObservedPhase | string;
  ready: boolean;
  recovering: boolean;
  checked_at: string;
  host: string;
  port: number;
  remote: boolean;
  service?: Record<string, any>;
  watchdog?: Record<string, any>;
  ws?: Record<string, any>;
  probe?: Record<string, any>;
  rpc?: { ready?: boolean; error?: string };
  grace_remaining_sec?: number;
}
export const observabilityApi = {
  metricsJson: () => get<PromParseResult>('/api/v1/observability/metrics?format=json'),
  metricsJsonCached: (ttlMs = 5000, force = false) =>
    getCached<PromParseResult>('/api/v1/observability/metrics?format=json', ttlMs, force),
  gatewayState: () => get<GatewayObservedState>('/api/v1/observability/gateway-state'),
  gatewayStateCached: (ttlMs = 3000, force = false) =>
    getCached<GatewayObservedState>('/api/v1/observability/gateway-state', ttlMs, force),
  scrapeConfig: () => get<PromScrapeConfig>('/api/v1/observability/scrape-config'),
  enablePlugin: () => post<{ enabled?: boolean; already_enabled?: boolean; metrics_available?: boolean; was_toggle?: boolean; restart_triggered?: boolean; restart_required?: boolean; version_too_low?: boolean; current_version?: string; min_version?: string }>('/api/v1/observability/enable-plugin'),
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

// Model Auth Status (v2026.4.15+ — gateway RPC `models.authStatus`)
// Mirrors `ModelAuthStatusResult` / `ModelAuthStatusProvider` in
// openclaw/src/gateway/server-methods/models-auth-status.ts
export type ModelAuthProviderStatus = 'ok' | 'expiring' | 'expired' | 'missing' | 'static';
export type ModelAuthProfileStatus = 'ok' | 'expiring' | 'expired' | 'missing' | 'static';
export type ModelAuthCredentialType = 'oauth' | 'token' | 'api_key';

export interface ModelAuthExpiry {
  at: number;
  remainingMs: number;
  label: string;
}

export interface ModelAuthStatusProfile {
  profileId: string;
  type: ModelAuthCredentialType;
  status: ModelAuthProfileStatus;
  expiry?: ModelAuthExpiry;
}

export interface ModelAuthUsageWindow {
  label?: string;
  windowMs?: number;
  percentUsed?: number;
  limit?: number;
  used?: number;
  resetsAt?: number;
  [k: string]: unknown;
}

export interface ModelAuthStatusProvider {
  provider: string;
  displayName: string;
  status: ModelAuthProviderStatus;
  expiry?: ModelAuthExpiry;
  profiles: ModelAuthStatusProfile[];
  usage?: {
    windows: ModelAuthUsageWindow[];
    plan?: string;
  };
}

export interface ModelAuthStatusResult {
  ts: number;
  providers: ModelAuthStatusProvider[];
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
  latestVersion?: string;
  updateAvailable?: boolean;
  description?: string;
  kind?: string;
  category?: 'channel' | 'inference' | 'provider' | 'utility' | string;
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
  install: (spec: string, opts?: { force?: boolean; dangerouslyForce?: boolean }) => post<{ success: boolean; spec: string; output: string }>('/api/v1/plugins/install', {
    spec,
    force: !!opts?.force,
    dangerouslyForce: !!opts?.dangerouslyForce,
  }),
  uninstall: (id: string) => post<{ success: boolean; id: string; output: string }>('/api/v1/plugins/uninstall', { id }),
  update: (id?: string, all?: boolean) => post<{ success: boolean; id: string; all: boolean; output: string }>('/api/v1/plugins/update', { id, all }),
};

// Weixin (openclaw-weixin) QR login — bypasses the plugin's missing
// web.login.start gateway method by talking to iLink's public HTTP API
// through the ClawDeckX backend.
export interface WeixinQRStartResponse { qrcode: string; qrImgUrl: string; status: string; }
export interface WeixinQRPollResponse {
  status: 'wait' | 'scaned' | 'refreshed' | 'confirmed' | 'expired' | 'error' | 'timeout' | 'cancelled';
  message?: string;
  qrImgUrl?: string;
  qrcode?: string;
  accountId?: string;
  rawAccountId?: string;
  userId?: string;
  baseUrl?: string;
}
export const weixinQRApi = {
  start: () => post<WeixinQRStartResponse>('/api/v1/plugins/weixin/qr-start', {}),
  poll: () => post<WeixinQRPollResponse>('/api/v1/plugins/weixin/qr-poll', {}),
  cancel: () => post<{ cancelled: boolean }>('/api/v1/plugins/weixin/qr-cancel', {}),
};

// Local / Container PTY shell — only enabled automatically inside Docker,
// or when CLAWDECKX_ENABLE_LOCAL_TERMINAL=1 is set on the host.
export interface LocalTerminalAvailability {
  available: boolean;
  reason?: string;
  inDocker: boolean;
  shell?: string;
  label?: string;
}
export const localTerminalApi = {
  available: () => get<LocalTerminalAvailability>('/api/v1/terminal/local/available'),
};

export interface WallpaperRandomResponse {
  provider: 'wallhaven';
  id: string;
  url: string;
  image_url: string;
  thumb_url: string;
  resolution: string;
  ratio: string;
  category: string;
  purity: string;
  colors: string[];
  seed?: string;
  page?: number;
  total?: number;
  pool_remaining?: number;
}

export interface BingWallpaperResponse {
  provider: 'bing';
  image_url: string;
  title?: string;
  copyright?: string;
  start_date?: string;
  full_start_date?: string;
  pool_size?: number;
}

export interface UnsplashWallpaperResponse {
  provider: 'unsplash';
  image_url: string;
  title?: string;
  photographer?: string;
}

export const wallpaperApi = {
  wallhavenRandom: (params?: { q?: string; atleast?: string; ratios?: string; categories?: string; purity?: string; page?: number; seed?: string; apiKey?: string; exclude?: string[] }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.atleast) qs.set('atleast', params.atleast);
    if (params?.ratios) qs.set('ratios', params.ratios);
    if (params?.categories) qs.set('categories', params.categories);
    if (params?.purity) qs.set('purity', params.purity);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.seed) qs.set('seed', params.seed);
    if (params?.apiKey) qs.set('apikey', params.apiKey);
    params?.exclude?.forEach(value => {
      if (value) qs.append('exclude', value);
    });
    const query = qs.toString();
    return get<WallpaperRandomResponse>(`/api/v1/wallpaper/wallhaven/random${query ? `?${query}` : ''}`);
  },
  bingDaily: (params?: { exclude?: string[] }) => {
    const qs = new URLSearchParams();
    params?.exclude?.forEach(value => {
      if (value) qs.append('exclude', value);
    });
    const query = qs.toString();
    return get<BingWallpaperResponse>(`/api/v1/wallpaper/bing/daily${query ? `?${query}` : ''}`);
  },
  unsplashRandom: (params?: { q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    const query = qs.toString();
    return get<UnsplashWallpaperResponse>(`/api/v1/wallpaper/unsplash/random${query ? `?${query}` : ''}`);
  },
};

// ==================== Gateway 代理 API ====================
// 统一通过 GenericProxy (/api/v1/gw/proxy) 透传 JSON-RPC 到 Gateway。
// 仅保留少量 REST 路由：status（本地连接检查）、sessionsUsage / usageCost（Go 层有额外参数/超时）、
// skillsConfig / skillsConfigure（Go 层有复杂聚合逻辑）。
// Retry-aware RPC: automatically retries on gateway connectivity errors (502 / GW_PROXY_FAILED)
// caused by transient WebSocket disconnections during gateway reload.
// Only gateway-unavailable errors are retried; business logic errors propagate immediately.
const GW_RETRY_COUNT = 3;
const GW_RETRY_DELAY_MS = 1500;

const isGatewayTransientError = (e: any): boolean => {
  if (e?.code === 'GW_RPC_ERROR' || e?.status === 422) return false;
  return e?.status === 502 || e?.code === 'GW_PROXY_FAILED' || /gateway.*not.*connect/i.test(e?.message || '');
};

// --- Config write serialisation & patch coalescing ---
// All config writes are serialised through a single queue. configSafePatch
// additionally coalesces rapid patches arriving within COALESCE_WINDOW_MS into
// a single config.patch call, drastically reducing write count against
// OpenClaw's 3-per-60s control-plane rate limit.

let configWriteQueue: Promise<unknown> = Promise.resolve();

const withConfigWriteQueue = async <T>(run: () => Promise<T>): Promise<T> => {
  const task = configWriteQueue.then(run, run);
  configWriteQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
};

const COALESCE_WINDOW_MS = 150;

function deepMergePatch(a: Record<string, any>, b: Record<string, any>): Record<string, any> {
  const result = { ...a };
  for (const key of Object.keys(b)) {
    if (
      b[key] && typeof b[key] === 'object' && !Array.isArray(b[key])
      && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])
    ) {
      result[key] = deepMergePatch(result[key], b[key]);
    } else {
      result[key] = b[key];
    }
  }
  return result;
}

function buildMergePatch(prev: any, next: any): any {
  if (JSON.stringify(prev) === JSON.stringify(next)) return undefined;
  if (prev == null || next == null || typeof prev !== 'object' || typeof next !== 'object' || Array.isArray(prev) || Array.isArray(next)) {
    return next;
  }
  const patch: Record<string, any> = {};
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of allKeys) {
    if (!(key in next)) {
      patch[key] = null;
      continue;
    }
    const childPatch = buildMergePatch(prev[key], next[key]);
    if (childPatch !== undefined) {
      patch[key] = childPatch;
    }
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

async function applyRawViaPatch(raw: string): Promise<any> {
  const next = JSON.parse(raw);
  const current = await rpc<any>('config.get');
  const prev = current?.parsed || current?.config || current;
  const patch = buildMergePatch(prev, next);
  if (!patch) return current;
  await rpc('config.patch', { raw: JSON.stringify(patch) });
  return rpc('config.get');
}

let _pendingPatch: Record<string, any> | null = null;
let _patchResolvers: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];
let _patchTimer: ReturnType<typeof setTimeout> | null = null;

function _flushPatches() {
  _patchTimer = null;
  const patch = _pendingPatch;
  const resolvers = _patchResolvers;
  _pendingPatch = null;
  _patchResolvers = [];
  if (!patch || resolvers.length === 0) return;
  withConfigWriteQueue(async () => {
    const raw = JSON.stringify(patch);
    await rpc('config.patch', { raw });
    return rpc('config.get');
  }).then(
    res => resolvers.forEach(r => r.resolve(res)),
    err => resolvers.forEach(r => r.reject(err)),
  );
}

function coalescedPatch(patch: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    _pendingPatch = _pendingPatch ? deepMergePatch(_pendingPatch, patch) : { ...patch };
    _patchResolvers.push({ resolve, reject });
    if (!_patchTimer) {
      _patchTimer = setTimeout(_flushPatches, COALESCE_WINDOW_MS);
    }
  });
}

const rpc = async <T = any>(method: string, params?: any): Promise<T> => {
  let lastErr: any;
  for (let attempt = 0; attempt <= GW_RETRY_COUNT; attempt++) {
    try {
      return await post<T>('/api/v1/gw/proxy', { method, params: params ?? {} });
    } catch (e: any) {
      lastErr = e;
      if (!isGatewayTransientError(e) || attempt === GW_RETRY_COUNT) break;
      await new Promise(r => setTimeout(r, GW_RETRY_DELAY_MS));
    }
  }
  throw lastErr;
};

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
    return getCached(`/api/v1/gw/sessions/usage${q ? '?' + q : ''}`, 15_000);
  },
  usageCost: (params?: { startDate?: string; endDate?: string; days?: number }) => {
    const qs = new URLSearchParams();
    if (params?.startDate) qs.set('startDate', params.startDate);
    if (params?.endDate) qs.set('endDate', params.endDate);
    if (params?.days) qs.set('days', String(params.days));
    const q = qs.toString();
    return getCached(`/api/v1/gw/usage/cost${q ? '?' + q : ''}`, 15_000);
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
  sessionsHistory: (key: string, opts?: { limit?: number; maxChars?: number }) =>
    rpc('chat.history', { sessionKey: key, ...(opts?.limit ? { limit: opts.limit } : {}), ...(opts?.maxChars ? { maxChars: opts.maxChars } : {}) }),
  sessionsHistoryPaginated: (key: string, limit?: number, cursor?: string, maxChars?: number) => {
    const qs = new URLSearchParams();
    qs.set('key', key);
    if (limit) qs.set('limit', String(limit));
    if (cursor) qs.set('cursor', cursor);
    if (maxChars) qs.set('maxChars', String(maxChars));
    return get<{ sessionKey: string; messages: any[]; hasMore: boolean; nextCursor?: string }>(`/api/v1/gw/sessions/history-paginated?${qs.toString()}`);
  },
  sessionsReset: (key: string) =>
    rpc('sessions.reset', { key }),
  sessionsDelete: (key: string, deleteTranscript = false) =>
    rpc('sessions.delete', { key, deleteTranscript }),
  sessionsPatch: (key: string, patch: { label?: string | null; thinkingLevel?: string | null; verboseLevel?: string | null; reasoningLevel?: string | null; sendPolicy?: string | null; fastMode?: boolean | null; model?: string | null }) =>
    rpc('sessions.patch', { key, ...patch }),
  sessionsResolve: (key: string) =>
    rpc('sessions.resolve', { key }),
  sessionsCompact: (key: string) =>
    rpc('sessions.compact', { key }),
  sessionsCreate: (params: { agentId?: string; label?: string; key?: string }) =>
    rpc('sessions.create', params),
  sessionsSend: (key: string, message: string, params?: { thinking?: string; attachments?: any[]; timeoutMs?: number; idempotencyKey?: string }) =>
    rpc('sessions.send', { key, message, ...params }),
  sessionsAbort: (key: string, runId?: string) =>
    rpc('sessions.abort', { key, ...(runId ? { runId } : {}) }),
  sessionsSubscribe: () =>
    rpc('sessions.subscribe', {}),
  sessionsUnsubscribe: () =>
    rpc('sessions.unsubscribe', {}),
  sessionsMessagesSubscribe: (key: string) =>
    rpc('sessions.messages.subscribe', { key }),
  sessionsMessagesUnsubscribe: (key: string) =>
    rpc('sessions.messages.unsubscribe', { key }),
  gatewayIdentity: () =>
    rpc('gateway.identity.get', {}),
  sessionsUsageTimeseries: (key: string, params?: { startDate?: string; endDate?: string; granularity?: string }) =>
    rpc('sessions.usage.timeseries', { key, ...params }),
  sessionsUsageLogs: (key: string, params?: { startDate?: string; endDate?: string; limit?: number; offset?: number }) =>
    rpc('sessions.usage.logs', { key, ...params }),
  // Commands (4.10+)
  commandsList: (params?: { agentId?: string; scope?: 'native' | 'text' | 'both'; includeArgs?: boolean }) =>
    rpc<{ commands: Array<{ name: string; nativeName?: string; textAliases?: string[]; description: string; category?: string; source: string; scope: string; acceptsArgs: boolean; args?: any[] }> }>('commands.list', { scope: 'text', includeArgs: false, ...params }),
  // Models
  models: () => rpc<any[]>('models.list'),
  // Model Auth Status (v2026.4.15+)
  modelsAuthStatus: (params?: { refresh?: boolean }) =>
    rpc<ModelAuthStatusResult>('models.authStatus', params || {}),
  // Usage
  usageStatus: () => rpc('usage.status'),
  // Skills
  skills: () => rpc<any[]>('skills.status'),
  skillsUpdate: (params: { skillKey: string; enabled?: boolean; apiKey?: string }) =>
    rpc('skills.update', params),
  skillsInstall: (params: { name: string; installId: string; timeoutMs?: number }) =>
    rpc<{ ok: boolean; message: string }>('skills.install', params),
  skillsBins: () =>
    rpc<Array<{ name: string; path: string; version?: string }>>('skills.bins'),
  // Config
  configGet: () => rpc('config.get'),
  configSet: async (key: string, value: any) => {
    const patch: Record<string, any> = {};
    const parts = key.split('.');
    let obj = patch;
    for (let i = 0; i < parts.length - 1; i++) { obj[parts[i]] = {}; obj = obj[parts[i]]; }
    obj[parts[parts.length - 1]] = value;
    return gwApi.configSafePatch(patch);
  },
  configSetAll: async (config: Record<string, any>): Promise<any> => withConfigWriteQueue(async () => {
    const raw = JSON.stringify(config, null, 2);
    return rpc('config.set', { raw });
  }),
  configReload: () => Promise.resolve({ ok: true }),
  configApply: (raw: string, baseHash: string) =>
    rpc('config.apply', { raw, baseHash }),
  configPatch: (raw: string, baseHash: string) =>
    rpc('config.patch', { raw, baseHash }),
  /**
   * Safe config patch with 150ms coalescing window.
   * Rapid successive patches are merged into one config.patch write.
   * Go backend handles baseHash refresh, conflict retry, and rate-limit wait.
   */
  configSafePatch: (patch: Record<string, any>): Promise<any> => coalescedPatch(patch),
  /**
   * Safe config apply: sends full config JSON.
   * Go backend handles baseHash refresh, conflict retry, and rate-limit wait.
   */
  configSafeApply: (raw: string): Promise<any> => withConfigWriteQueue(async () => {
    try {
      return await applyRawViaPatch(raw);
    } catch {
      return rpc('config.apply', { raw });
    }
  }),
  configSchema: () => rpc('config.schema'),
  configSchemaLookup: (path: string) => rpc('config.schema.lookup', { path }),
  secretsReload: () => rpc('secrets.reload'),
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
    agentId?: string;
  }) => rpc('cron.list', { includeDisabled: true, ...opts }),
  cronStatus: () => rpc('cron.status'),
  cronGet: (id: string) => rpc('cron.get', { id }),
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
    deliveryStatus?: string; deliveryStatuses?: string[];
    query?: string; sortDir?: 'asc' | 'desc';
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
  // Remove a stale gateway-owned node pairing record (OpenClaw 2026.4.26+).
  // Accepts node id, name, or IP — server resolves to the pairing record.
  nodePairRemove: (params: { node: string }) =>
    rpc<{ removed: boolean; node?: string }>('node.pair.remove', params),
  // Devices
  devicePairList: () => rpc('device.pair.list'),
  devicePairApprove: (requestId: string) =>
    rpc('device.pair.approve', { requestId }),
  devicePairReject: (requestId: string) =>
    rpc('device.pair.reject', { requestId }),
  devicePairRemove: (deviceId: string) =>
    rpc('device.pair.remove', { deviceId }),
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
  systemPresence: () =>
    rpc<Array<{
      host?: string; ip?: string; version?: string; mode?: string;
      reason?: string; platform?: string; deviceFamily?: string;
      roles?: string[]; scopes?: string[]; ts: number;
    }>>('system-presence'),
  // Talk mode
  talkMode: (enabled: boolean, phase?: string) =>
    rpc('talk.mode', { enabled, ...(phase ? { phase } : {}) }),
  talkConfig: () =>
    rpc<{ enabled?: boolean; provider?: string; voice?: string; speed?: number; language?: string }>('talk.config'),
  talkSpeak: (text: string, params?: { voice?: string; provider?: string; sessionKey?: string }) =>
    rpc('talk.speak', { text, ...params }),
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
  webLoginWait: (params?: { timeoutMs?: number; accountId?: string; sessionKey?: string }) =>
    rpc('web.login.wait', params),
  // Doctor: Memory status
  memoryStatus: () => rpc<{
    agentId: string;
    provider?: string;
    embedding: { ok: boolean; error?: string };
  }>('doctor.memory.status'),
  // Doctor: Memory dream diary backfill / reset
  memoryBackfillDreamDiary: (params?: { path?: string }) =>
    rpc<{ ok: boolean; message?: string }>('doctor.memory.backfillDreamDiary', params),
  memoryResetDreamDiary: () =>
    rpc<{ ok: boolean; message?: string }>('doctor.memory.resetDreamDiary'),
  memoryResetGroundedShortTerm: () =>
    rpc<{ ok: boolean; message?: string }>('doctor.memory.resetGroundedShortTerm'),
  memoryRemHarness: () =>
    rpc<{ path?: string; found: boolean; content?: string }>('doctor.memory.remHarness'),
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
  // Skills search & detail
  skillsSearch: (params: { query?: string; category?: string; limit?: number; offset?: number }) =>
    rpc<{ skills: Array<{ key: string; name: string; description: string; category?: string; installed?: boolean }>; total: number }>('skills.search', params),
  skillsDetail: (params: { key: string }) =>
    rpc<{ key: string; name: string; description: string; readme?: string; version?: string; author?: string; homepage?: string; installed?: boolean; config?: Record<string, unknown> }>('skills.detail', params),
  // Exec approval (single)
  execApprovalGet: (id: string) =>
    rpc('exec.approval.get', { id }),
  // Session compaction history
  sessionsCompactionList: (key: string) =>
    rpc<{ checkpoints: Array<{ id: string; createdAt: string; tokensBefore: number; tokensAfter: number; messagesBefore: number; messagesAfter: number }> }>('sessions.compaction.list', { key }),
  sessionsCompactionGet: (key: string, checkpointId: string) =>
    rpc<{ id: string; createdAt: string; tokensBefore: number; tokensAfter: number; messagesBefore: number; messagesAfter: number; summary?: string }>('sessions.compaction.get', { key, checkpointId }),
  sessionsCompactionBranch: (key: string, checkpointId: string) =>
    rpc<{ sessionKey: string }>('sessions.compaction.branch', { key, checkpointId }),
  sessionsCompactionRestore: (key: string, checkpointId: string) =>
    rpc<{ ok: boolean }>('sessions.compaction.restore', { key, checkpointId }),
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
export interface ClawHubCLIStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
  latestVersion?: string | null;
  updateAvailable?: boolean;
}
export const clawHubApi = {
  cliStatus: () => get<ClawHubCLIStatus>('/api/v1/clawhub/cli-status'),
  list: (sort = 'newest', limit = 20, cursor?: string) => {
    let url = `/api/v1/clawhub/list?sort=${sort}&limit=${limit}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    return get<ClawHubListResponse>(url);
  },
  search: (q: string) => get<any[]>(`/api/v1/clawhub/search?q=${encodeURIComponent(q)}`),
  detail: (slug: string) => get(`/api/v1/clawhub/skill?slug=${encodeURIComponent(slug)}`),
  install: (slug: string) => post('/api/v1/clawhub/install', { slug }),
  installRecipe: (recipe: { recipeId: string; kind: string; package?: string; formula?: string; bins?: string[]; label?: string; skillKey?: string }) =>
    post<{ success: boolean; recipeId: string; kind: string; output: string; verifiedBins: Record<string, boolean> }>('/api/v1/clawhub/install-recipe', recipe),
  uninstall: (slug: string) => post('/api/v1/clawhub/uninstall', { slug }),
  update: (slug: string) => post('/api/v1/clawhub/update', { slug }),
  updateAll: () => post('/api/v1/clawhub/update', { all: true }),
  installed: () => get<any[]>('/api/v1/clawhub/installed'),
  upgradeCli: () => post<{ success: boolean; output: string }>('/api/v1/clawhub/upgrade-cli', {}),
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

// ==================== 工作区记忆日志 ====================
export interface MemoryFileEntry {
  name: string;
  size: number;
  modTime: string;
}
export const workspaceMemoryApi = {
  list: (agentId?: string) =>
    get<{ files: MemoryFileEntry[]; dir: string }>(`/api/v1/workspace/memory${agentId ? `?agent=${agentId}` : ''}`),
  getFile: (name: string, agentId?: string) =>
    get<{ name: string; content: string }>(`/api/v1/workspace/memory/file?name=${encodeURIComponent(name)}${agentId ? `&agent=${agentId}` : ''}`),
  setFile: (name: string, content: string, agentId?: string) =>
    put<{ name: string; size: number }>(`/api/v1/workspace/memory/file?name=${encodeURIComponent(name)}${agentId ? `&agent=${agentId}` : ''}`, { content }),
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
      agentsMd?: string;
      userMd?: string;
      identityMd?: string;
      heartbeat?: string;
      tools?: string;
      skills?: string[];
      env?: Record<string, string>;
    }>;
    workflow: {
      type: 'sequential' | 'parallel' | 'collaborative' | 'event-driven' | 'routing';
      description: string;
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

export interface MultiAgentGenerateRequest {
  scenarioName: string;
  description: string;
  teamSize?: 'small' | 'medium' | 'large';
  workflowType?: 'sequential' | 'parallel' | 'collaborative' | 'event-driven' | 'routing';
  language?: string;
}

export interface MultiAgentGenerateResult {
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
      agentsMd?: string;
      userMd?: string;
      identityMd?: string;
      heartbeat?: string;
    }>;
    workflow: {
      type: 'sequential' | 'parallel' | 'collaborative' | 'event-driven' | 'routing';
      description: string;
      steps: Array<{
        agent?: string;
        agents?: string[];
        action: string;
        parallel?: boolean;
        condition?: string;
      }>;
    };
  };
  reasoning: string;
}

export type GenTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled';

export interface GenTask {
  id: string;
  status: GenTaskStatus;
  phase?: string;
  elapsed?: number;
  result?: MultiAgentGenerateResult;
  errorCode?: string;
  errorMsg?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WizardStep1Request {
  scenarioName: string;
  description: string;
  teamSize: string;
  workflowType: string;
  language: string;
  modelId?: string;
  customPrompt?: string;
}

export interface WizardStep2Request {
  agentId: string;
  agentName: string;
  agentRole: string;
  agentDesc: string;
  scenarioName: string;
  language: string;
  modelId?: string;
  customPrompt?: string;
}

export const multiAgentApi = {
  generate: (request: MultiAgentGenerateRequest, timeoutMs = 600_000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    return post<MultiAgentGenerateResult>('/api/v1/multi-agent/generate', request, { signal: ctrl.signal })
      .finally(() => clearTimeout(timer));
  },
  generateAsync: (request: MultiAgentGenerateRequest & { directLlm?: boolean }) =>
    post<{ taskId: string }>('/api/v1/multi-agent/generate-async', request),
  /** SSE fetch for wizard step 1. Returns an AbortController so caller can stop early. */
  wizardStep1: (req: WizardStep1Request, onToken: (t: string) => void, onDone: (parsed: any) => void, onError: (code: string, msg: string) => void): AbortController => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const resp = await fetch('/api/v1/multi-agent/wizard-step1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
          signal: ctrl.signal,
          credentials: 'include',
        });
        if (!resp.ok || !resp.body) { onError('HTTP_ERROR', `HTTP ${resp.status}`); return; }
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          let event = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
            if (line.startsWith('data: ')) {
              try {
                const d = JSON.parse(line.slice(6));
                if (event === 'token') onToken(d.token ?? '');
                else if (event === 'done') onDone(d);
                else if (event === 'error') onError(d.code ?? 'ERROR', d.msg ?? 'Unknown error');
              } catch { /* ignore parse errors */ }
              event = '';
            }
          }
        }
        // Flush any remaining data in buffer after stream closes
        if (buf.trim()) {
          const remaining = buf.split('\n');
          let event = '';
          for (const line of remaining) {
            if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
            if (line.startsWith('data: ')) {
              try {
                const d = JSON.parse(line.slice(6));
                if (event === 'token') onToken(d.token ?? '');
                else if (event === 'done') onDone(d);
                else if (event === 'error') onError(d.code ?? 'ERROR', d.msg ?? 'Unknown error');
              } catch { /* ignore parse errors */ }
              event = '';
            }
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') onError('FETCH_ERROR', e?.message ?? 'Fetch failed');
      }
    })();
    return ctrl;
  },
  /** SSE fetch for wizard step 2 (single agent). Returns an AbortController. */
  wizardStep2: (req: WizardStep2Request, onToken: (t: string, agentId: string) => void, onDone: (data: any) => void, onError: (code: string, msg: string) => void): AbortController => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const resp = await fetch('/api/v1/multi-agent/wizard-step2', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
          signal: ctrl.signal,
          credentials: 'include',
        });
        if (!resp.ok || !resp.body) { onError('HTTP_ERROR', `HTTP ${resp.status}`); return; }
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          let event = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
            if (line.startsWith('data: ')) {
              try {
                const d = JSON.parse(line.slice(6));
                if (event === 'token') onToken(d.token ?? '', d.agentId ?? '');
                else if (event === 'done') onDone(d);
                else if (event === 'error') onError(d.code ?? 'ERROR', d.msg ?? 'Unknown error');
              } catch { /* ignore parse errors */ }
              event = '';
            }
          }
        }
        // Flush any remaining data in buffer after stream closes
        if (buf.trim()) {
          const remaining = buf.split('\n');
          let event = '';
          for (const line of remaining) {
            if (line.startsWith('event: ')) { event = line.slice(7).trim(); continue; }
            if (line.startsWith('data: ')) {
              try {
                const d = JSON.parse(line.slice(6));
                if (event === 'token') onToken(d.token ?? '', d.agentId ?? '');
                else if (event === 'done') onDone(d);
                else if (event === 'error') onError(d.code ?? 'ERROR', d.msg ?? 'Unknown error');
              } catch { /* ignore parse errors */ }
              event = '';
            }
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') onError('FETCH_ERROR', e?.message ?? 'Fetch failed');
      }
    })();
    return ctrl;
  },
  getGenerateTask: (taskId: string) =>
    get<GenTask>(`/api/v1/multi-agent/generate-task?taskId=${encodeURIComponent(taskId)}`),
  cancelGenerateTask: (taskId: string) =>
    post<{ taskId: string; status: string }>('/api/v1/multi-agent/generate-cancel', { taskId }),
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
  latestVersion?: string | null;
  updateAvailable?: boolean;
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

interface RemoteSkillHubResponse {
  code: number;
  data: {
    skills: Array<{
      category: string;
      description: string;
      description_zh?: string;
      downloads: number;
      homepage: string;
      installs: number;
      name: string;
      ownerName: string;
      score: number;
      slug: string;
      stars: number;
      tags: string[] | null;
      updated_at: number;
      version: string;
    }>;
    total: number;
  };
  message: string;
}

type RemoteSortBy = 'score' | 'downloads' | 'stars' | 'installs' | 'name';
type RemoteOrder = 'asc' | 'desc';

function mapRemoteSkill(s: RemoteSkillHubResponse['data']['skills'][number]): SkillHubSkill {
  return {
    slug: s.slug,
    name: s.name,
    homepage: s.homepage,
    version: s.version,
    description: s.description,
    description_zh: s.description_zh,
    stars: s.stars,
    downloads: s.downloads,
    installs: s.installs,
    tags: s.tags ?? [],
    updated_at: s.updated_at,
    score: s.score,
  };
}

export const skillHubRemoteApi = {
  listSkills: async (
    page = 1,
    pageSize = 24,
    sortBy: RemoteSortBy = 'score',
    order: RemoteOrder = 'desc',
    category?: string,
  ): Promise<SkillHubPageResponse> => {
    let url = `/api/v1/skillhub/remote/skills?page=${page}&pageSize=${pageSize}&sortBy=${sortBy}&order=${order}`;
    if (category && category !== 'all') url += `&category=${encodeURIComponent(category)}`;
    const json = await get<RemoteSkillHubResponse>(url);
    const skills = json.data.skills.map(mapRemoteSkill);
    const total = json.data.total;
    const hasMore = page * pageSize < total;
    return {
      skills,
      total,
      page,
      size: pageSize,
      hasMore,
      categories: {},
      featured: [],
    };
  },
  searchSkills: async (q: string, pageSize = 24, category?: string): Promise<SkillHubSearchResponse> => {
    let url = `/api/v1/skillhub/remote/search?q=${encodeURIComponent(q)}&pageSize=${pageSize}`;
    if (category && category !== 'all') url += `&category=${encodeURIComponent(category)}`;
    const json = await get<RemoteSkillHubResponse>(url);
    return {
      skills: json.data.skills.map(mapRemoteSkill),
      total: json.data.total,
      query: q,
    };
  },
  topSkills: async (): Promise<SkillHubSkill[]> => {
    const json = await get<RemoteSkillHubResponse>('/api/v1/skillhub/remote/top');
    return json.data.skills.map(mapRemoteSkill);
  },
};

export const skillHubApi = {
  cliStatus: () => get<SkillHubCLIStatus>('/api/v1/skillhub/cli-status'),
  install: () => post<{ success: boolean; output: string }>('/api/v1/skillhub/install', {}),
  installSkill: (slug: string) => post<{ success: boolean; output: string; slug: string }>('/api/v1/skillhub/install-skill', { slug }),
  uninstallSkill: (slug: string) => post<{ success: boolean; output: string; slug: string }>('/api/v1/skillhub/uninstall-skill', { slug }),
  getInstalledSkills: () => get<{ skills: string[] }>('/api/v1/skillhub/installed'),
  upgradeCli: () => post<{ success: boolean; output: string }>('/api/v1/skillhub/upgrade-cli', {}),
};

// ==================== MCP ====================
export interface McpServerConfig {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  baseUrl?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  /** HTTP transport type for remote MCP servers. */
  transport?: 'sse' | 'streamable-http';
  /** Optional connection timeout in milliseconds (per-server). */
  connectionTimeoutMs?: number;
  /** Working directory for stdio server. */
  cwd?: string;
  /** Alias for cwd. */
  workingDirectory?: string;
  [key: string]: unknown;
}

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;
}

export interface McpListResponse {
  servers: McpServerEntry[];
  path: string;
}

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
}

export interface McpServerTestResult {
  name: string;
  type: string;
  ok: boolean;
  category?: string;
  stage?: string;
  statusCode?: number;
  statusText?: string;
  message: string;
  resolvedPath?: string;
  target?: string;
  protocol?: string;
  protocolOk?: boolean;
  serverName?: string;
  serverVersion?: string;
  tools?: McpToolInfo[];
  details?: Record<string, string>;
}

export const mcpApi = {
  list: () => get<McpListResponse>('/api/v1/mcp/servers'),
  set: (name: string, config: McpServerConfig, oldName?: string) =>
    put<{ name: string; config: McpServerConfig; path: string }>('/api/v1/mcp/servers', { name, config, ...(oldName && oldName !== name ? { oldName } : {}) }),
  delete: (name: string) =>
    post<{ removed: boolean; name: string; path: string }>('/api/v1/mcp/servers/delete', { name }),
  test: (name: string) =>
    post<McpServerTestResult>('/api/v1/mcp/servers/test', { name }),
};

export interface MirrorConfig {
  preset: string;        // "cn" | "global" | "custom"
  npmRegistry: string;
  githubProxy: string;
  dockerMirror: string;
  pipIndex: string;
  goProxy: string;
  clawHubRegistry: string; // ClawHub mirror URL, "" = use default
}

export interface SystemMirrorStatus {
  npmRegistry: string;
  goProxy: string;
  pipIndex: string;
  githubProxy: string;
  dockerMirror: string;
}

export interface MirrorApplyResult {
  tool: string;
  ok: boolean;
  message: string;
}

export const mirrorConfigApi = {
  get: () => get<MirrorConfig>('/api/v1/mirror-config'),
  set: (cfg: MirrorConfig) => put<{ message: string }>('/api/v1/mirror-config', cfg),
  detect: () => get<SystemMirrorStatus>('/api/v1/mirror-config/detect'),
  apply: (tools: string[], config: MirrorConfig) =>
    post<{ results: MirrorApplyResult[] }>('/api/v1/mirror-config/apply', { tools, config }),
  probeUrl: (url: string) =>
    get<{ status: number; latencyMs: number; reachable: boolean }>(
      `/api/v1/network/test-mirror?url=${encodeURIComponent(url)}`
    ),
};

export interface SkillFileReadResponse {
  content: string;
  exists: boolean;
  path: string;
}

export const skillFileApi = {
  read: (baseDir: string) =>
    get<SkillFileReadResponse>(`/api/v1/skills/file?baseDir=${encodeURIComponent(baseDir)}`),
  write: (baseDir: string, content: string) =>
    put<{ saved: boolean; path: string }>('/api/v1/skills/file', { baseDir, content }),
};
