// ClawDeckX API 服务层 — 对应后端所有 REST API 端点
import { get, getCached, post, put, del, setToken, clearToken } from './request';

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
    // Optional: reload page to ensure state references are cleared
    window.location.reload();
  }),
};

// ==================== 宿主机信息 ====================
export const hostInfoApi = {
  get: () => get<any>('/api/v1/host-info'),
  checkUpdate: () => get<any>('/api/v1/host-info/check-update'),
};

// ==================== 自更新 ====================
export const selfUpdateApi = {
  info: () => get<{ version: string; build: string; os: string; arch: string; platform: string }>('/api/v1/self-update/info'),
  check: () => get<{
    available: boolean; currentVersion: string; latestVersion: string;
    releaseNotes?: string; publishedAt?: string;
    assetName?: string; assetSize?: number; downloadUrl?: string; error?: string;
  }>('/api/v1/self-update/check'),
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
  log: (lines = 200) => get<{ lines: string[] }>(`/api/v1/gateway/log?lines=${lines}`),
  logCached: (lines = 200, ttlMs = 5000, force = false) =>
    getCached<{ lines: string[] }>(`/api/v1/gateway/log?lines=${lines}`, ttlMs, force),
  getHealthCheck: () => get<{ enabled: boolean; fail_count: number; max_fails: number; last_ok: string }>('/api/v1/gateway/health-check'),
  getHealthCheckCached: (ttlMs = 6000, force = false) =>
    getCached<{ enabled: boolean; fail_count: number; max_fails: number; last_ok: string }>('/api/v1/gateway/health-check', ttlMs, force),
  setHealthCheck: (enabled: boolean) => put('/api/v1/gateway/health-check', { enabled }),
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
export const notifyApi = {
  getConfig: () => get<any>('/api/v1/notify/config'),
  updateConfig: (data: Record<string, string>) => put('/api/v1/notify/config', data),
  testSend: (message?: string) => post('/api/v1/notify/test', { message: message || '' }),
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
  generateDefault: () => post<{ message: string; path: string }>('/api/v1/config/generate-default'),
  setKey: (key: string, value: string, json = true) => post<{ message: string; key: string }>('/api/v1/config/set-key', { key, value, json }),
  unsetKey: (key: string) => post<{ message: string; key: string }>('/api/v1/config/unset-key', { key }),
  getKey: (key: string) => get<{ key: string; value: any }>(`/api/v1/config/get-key?key=${encodeURIComponent(key)}`),
};

// ==================== 备份管理 ====================
export const backupApi = {
  list: () => get<any[]>('/api/v1/backups'),
  create: () => post('/api/v1/backups'),
  restore: (id: string) => post(`/api/v1/backups/${id}`),
  remove: (id: string) => del(`/api/v1/backups/${id}`),
  download: (id: string) => `/api/v1/backups/${id}`,
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

// ==================== 用户管理 ====================
export const userApi = {
  list: () => get<any[]>('/api/v1/users'),
  create: (data: any) => post('/api/v1/users', data),
  remove: (id: string) => del(`/api/v1/users/${id}`),
};

// ==================== 技能审计 ====================
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

// ==================== OpenClaw 安装/初始化 ====================
export const openclawApi = {
  detect: () => get('/api/v1/openclaw/detect'),
  install: () => post('/api/v1/openclaw/install'),
  update: () => post('/api/v1/openclaw/update'),
  init: (data: any) => post('/api/v1/openclaw/init', data),
};

// ==================== 插件安装 ====================
export const pluginApi = {
  canInstall: () => get<{ can_install: boolean; is_remote: boolean }>('/api/v1/plugins/can-install'),
  checkInstalled: (spec: string) => get<{ installed: boolean; spec: string }>(`/api/v1/plugins/check?spec=${encodeURIComponent(spec)}`),
  install: (spec: string) => post<{ success: boolean; spec: string; output: string }>('/api/v1/plugins/install', { spec }),
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
  configSet: (key: string, value: any) => rpc('config.set', { key, value }),
  configSetAll: (config: Record<string, any>) => rpc('config.set', { config }),
  configReload: () => rpc('config.reload'),
  configApply: (raw: string, baseHash: string) =>
    rpc('config.apply', { raw, baseHash }),
  configPatch: (raw: string, baseHash: string) =>
    rpc('config.patch', { raw, baseHash }),
  configSchema: () => rpc('config.schema'),
  // Agents
  agents: () => rpc<any[]>('agents.list'),
  agentCreate: (params: { name: string; workspace?: string; emoji?: string; avatar?: string }) =>
    post('/api/v1/gw/agents', params),
  agentUpdate: (params: { agentId: string; name?: string; workspace?: string; model?: string; avatar?: string }) =>
    put('/api/v1/gw/agents', params),
  agentDelete: (agentId: string, deleteFiles = true) =>
    post('/api/v1/gw/agents/delete', { agentId, deleteFiles }),
  agentsBatchDelete: (params: { agentIds?: string[]; prefix?: string; deleteFiles?: boolean }) =>
    post<{ deleted: number; total: number; results: Record<string, { ok: boolean; error?: string }>; errors: string[] }>(
      '/api/v1/gw/agents/batch-delete', 
      { agentIds: params.agentIds || [], prefix: params.prefix, deleteFiles: params.deleteFiles ?? true }
    ),
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
  cronStatus: () => rpc('cron.status'),
  cronAdd: (job: any) => rpc('cron.add', job),
  cronUpdate: (id: string, patch: any) =>
    rpc('cron.update', { id, patch }),
  cronRun: (id: string) =>
    rpc('cron.run', { id, mode: 'force' }),
  cronRemove: (id: string) =>
    rpc('cron.remove', { id }),
  cronRuns: (id: string, limit = 50) =>
    rpc('cron.runs', { id, limit }),
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
  nodePairList: () => rpc('node.pair.list'),
  nodePairApprove: (nodeId: string) =>
    rpc('node.pair.approve', { nodeId }),
  nodePairReject: (nodeId: string) =>
    rpc('node.pair.reject', { nodeId }),
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
  logsTail: (lines = 100) => rpc('logs.tail', { lines }),
  // System
  lastHeartbeat: () => rpc('last-heartbeat'),
  setHeartbeats: (enabled: boolean) =>
    rpc('set-heartbeats', { enabled }),
  systemEvent: (text: string) =>
    rpc('system-event', { text }),
  // Talk mode
  talkMode: (mode: string) =>
    rpc('talk.mode', { mode }),
  // Browser
  browserRequest: (method: string, path: string) =>
    rpc('browser.request', { method, path }),
  // Wizard
  wizardStart: (params: any) => rpc('wizard.start', params),
  wizardNext: (sessionId: string, input: any) =>
    rpc('wizard.next', { sessionId, input }),
  wizardCancel: (sessionId: string) =>
    rpc('wizard.cancel', { sessionId }),
  wizardStatus: (sessionId: string) =>
    rpc('wizard.status', { sessionId }),
  // Update
  updateRun: (params?: { force?: boolean }) =>
    rpc('update.run', params),
  // Web (WhatsApp) login
  webLoginStart: (params?: { force?: boolean; timeoutMs?: number; accountId?: string }) =>
    rpc('web.login.start', params),
  webLoginWait: (params?: { timeoutMs?: number; accountId?: string }) =>
    rpc('web.login.wait', params),
  // Generic proxy (escape hatch)
  proxy: (method: string, params?: any) => rpc(method, params),
};

// ==================== 技能翻译 ====================
export const skillTranslationApi = {
  get: (lang: string, keys: string[]) =>
    get<any[]>(`/api/v1/skills/translations?lang=${encodeURIComponent(lang)}&keys=${encodeURIComponent(keys.join(','))}`),
  translate: (lang: string, skills: { skill_key: string; name: string; description: string }[]) =>
    post<any>('/api/v1/skills/translations', { lang, skills }),
};

// ==================== ClawHub 技能市场 ====================
export const clawHubApi = {
  list: (sort = 'newest', limit = 20, cursor?: string) => {
    let url = `/api/v1/clawhub/list?sort=${sort}&limit=${limit}`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
    return get<any>(url);
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

// ==================== 场景库 ====================
export interface ScenarioTemplate {
  id: string;
  category: 'social' | 'creative' | 'devops' | 'productivity' | 'research' | 'finance' | 'family';
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  icon: string;
  color: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  configs: {
    soul?: { zh: string; en: string };
    user?: { zh: string; en: string };
    memory?: { zh: string; en: string };
    heartbeat?: { zh: string; en: string };
  };
  requirements?: {
    skills?: string[];
    channels?: string[];
    models?: string[];
  };
  automations?: Array<{
    cron: string;
    name: { zh: string; en: string };
    command: string;
  }>;
  examples?: Array<{
    title: { zh: string; en: string };
    input: string;
    output: string;
  }>;
  community?: {
    author: string;
    downloads: number;
    stars: number;
    lastUpdated: string;
  };
}

export interface QuickSetupStep {
  type: 'config' | 'skill' | 'channel' | 'cron' | 'verify';
  description: { zh: string; en: string };
  status: 'pending' | 'running' | 'success' | 'failed';
  error?: string;
}

export interface QuickSetupResult {
  success: boolean;
  steps: QuickSetupStep[];
  appliedConfigs: string[];
  installedSkills: string[];
  createdCronJobs: string[];
  errors: string[];
}

export const scenarioApi = {
  list: (category?: string) => 
    get<ScenarioTemplate[]>(`/api/v1/scenarios${category ? `?category=${category}` : ''}`),
  listCached: (category?: string, ttlMs = 300000, force = false) => 
    getCached<ScenarioTemplate[]>(`/api/v1/scenarios${category ? `?category=${category}` : ''}`, ttlMs, force),
  get: (id: string) => get<ScenarioTemplate>(`/api/v1/scenarios/${id}`),
  preview: (id: string, language: 'zh' | 'en') => 
    get<{ configs: Record<string, string>; automations: any[] }>(`/api/v1/scenarios/${id}/preview?lang=${language}`),
  quickSetup: (id: string, agentId: string, options?: { skipSkills?: boolean; skipCron?: boolean }) => 
    post<QuickSetupResult>(`/api/v1/scenarios/${id}/quick-setup`, { agentId, ...options }),
  checkRequirements: (id: string) => 
    get<{ satisfied: boolean; missing: { skills: string[]; channels: string[]; models: string[] } }>(`/api/v1/scenarios/${id}/check-requirements`),
};

// ==================== 多 Agent 协作模板 ====================
export interface AgentRole {
  id: string;
  role: { zh: string; en: string };
  description: { zh: string; en: string };
  icon: string;
  color: string;
  configs: {
    soul?: { zh: string; en: string };
    tools?: string[];
    skills?: string[];
  };
  dependencies: string[];
}

export interface WorkflowStep {
  step: number;
  agentRole: string;
  action: { zh: string; en: string };
  trigger: 'manual' | 'previous_complete' | 'schedule' | 'event';
  triggerConfig?: any;
  nextStep?: number;
}

export interface MultiAgentTemplate {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  icon: string;
  category: 'content' | 'research' | 'devops' | 'support' | 'automation';
  difficulty: 'medium' | 'hard' | 'expert';
  agents: AgentRole[];
  workflow: WorkflowStep[];
  communication: {
    protocol: 'lan-api' | 'shared-session' | 'message-queue';
    config?: any;
  };
  examples?: Array<{
    title: { zh: string; en: string };
    description: { zh: string; en: string };
  }>;
  community?: {
    author: string;
    downloads: number;
    stars: number;
  };
}

export interface DeployResult {
  success: boolean;
  createdAgents: Array<{ id: string; role: string }>;
  configuredWorkflow: boolean;
  errors: string[];
}

// Multi-Agent Deployment Types
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
  // Template-based APIs (legacy)
  templates: () => get<MultiAgentTemplate[]>('/api/v1/multi-agent/templates'),
  templatesCached: (ttlMs = 300000, force = false) => 
    getCached<MultiAgentTemplate[]>('/api/v1/multi-agent/templates', ttlMs, force),
  get: (id: string) => get<MultiAgentTemplate>(`/api/v1/multi-agent/templates/${id}`),
  preview: (id: string, language: 'zh' | 'en') => 
    get<{ agents: any[]; workflow: any[] }>(`/api/v1/multi-agent/templates/${id}/preview?lang=${language}`),
  checkDeployment: (id: string) => 
    get<{ deployed: boolean; agents: Array<{ id: string; role: string; status: string }> }>(`/api/v1/multi-agent/templates/${id}/check`),
  workflowStatus: () => 
    get<{ active: boolean; currentStep: number; agents: Array<{ id: string; status: string; lastAction: string }> }>('/api/v1/multi-agent/workflow/status'),
  
  // New deployment APIs
  deploy: (request: MultiAgentDeployRequest) => 
    post<MultiAgentDeployResult>('/api/v1/multi-agent/deploy', request),
  previewDeploy: (request: MultiAgentDeployRequest) => 
    post<MultiAgentDeployResult>('/api/v1/multi-agent/preview', { ...request, dryRun: true }),
  status: () => get<MultiAgentStatus>('/api/v1/multi-agent/status'),
  remove: (prefix?: string, agents?: string[]) => 
    post<{ removed: number; agents: Record<string, boolean> }>('/api/v1/multi-agent/delete', { prefix, agents }),
};

// Template Management API
export interface TemplateManifest {
  version: string;
  name: string;
  description: string;
  categories: Array<{
    id: string;
    name: string;
    description: string;
    path: string;
  }>;
  languages: string[];
  lastUpdated: string;
}

export interface TemplateUpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  changelog?: string[];
}

export const templateManagerApi = {
  getManifest: () => get<TemplateManifest>('/api/v1/template-manager/manifest'),
  checkUpdates: () => get<TemplateUpdateInfo>('/api/v1/template-manager/update-check'),
  update: () => post<{ success: boolean; updated: string[] }>('/api/v1/template-manager/update', {}),
  validate: (template: any) => post<{ valid: boolean; errors: string[] }>('/api/v1/template-manager/validate', template),
  install: (source: string, templateId: string) => 
    post<{ success: boolean; templateId: string }>('/api/v1/template-manager/install', { source, templateId }),
  uninstall: (type: string, id: string) => 
    del<{ success: boolean }>(`/api/v1/template-manager/${type}/${id}`),
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
