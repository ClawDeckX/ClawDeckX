
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { eventsApi, gatewayApi, gatewayProfileApi, gwApi } from '../services/api';
import { useToast } from '../components/Toast';

interface GatewayProfile {
  id: number;
  name: string;
  host: string;
  port: number;
  token: string;
  is_active: boolean;
}

interface GatewayProps {
  language: Language;
}

const Gateway: React.FC<GatewayProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const gw = t.gw as any;
  const na = (t as any).na as string;
  const { toast } = useToast();

  // 网关状态 & 日志
  const [status, setStatus] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [clearTimestamp, setClearTimestamp] = useState<string | null>(null);

  // 日志增强
  const [logSearch, setLogSearch] = useState('');
  const [autoFollow, setAutoFollow] = useState(true);
  const [levelFilters, setLevelFilters] = useState<Record<string, boolean>>({ trace: true, debug: true, info: true, warn: true, error: true, fatal: true });

  // Debug 面板
  const [activeTab, setActiveTab] = useState<'logs' | 'events' | 'debug'>('logs');
  const [rpcMethod, setRpcMethod] = useState('');
  const [rpcParams, setRpcParams] = useState('{}');
  const [rpcResult, setRpcResult] = useState<string | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [rpcLoading, setRpcLoading] = useState(false);
  const [debugStatus, setDebugStatus] = useState<any>(null);
  const [debugHealth, setDebugHealth] = useState<any>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventRisk, setEventRisk] = useState<'all' | 'low' | 'medium' | 'high' | 'critical'>('all');
  const [eventKeyword, setEventKeyword] = useState('');
  const [eventType, setEventType] = useState<'all' | 'activity' | 'alert'>('all');
  const [eventSource, setEventSource] = useState('all');

  // System Event
  const [sysEventText, setSysEventText] = useState('');
  const [sysEventSending, setSysEventSending] = useState(false);
  const [sysEventResult, setSysEventResult] = useState<{ ok: boolean; text: string } | null>(null);

  // 网关配置档案
  const [profiles, setProfiles] = useState<GatewayProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [editingProfile, setEditingProfile] = useState<GatewayProfile | null>(null);
  const [formData, setFormData] = useState({ name: '', host: '127.0.0.1', port: 18789, token: '' });
  const [saving, setSaving] = useState(false);

  // 心跳健康检查
  const [healthCheckEnabled, setHealthCheckEnabled] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{ fail_count: number; last_ok: string } | null>(null);

  // 按钮操作状态
  const [actionLoading, setActionLoading] = useState<string | null>(null);


  const activeProfile = profiles.find(p => p.is_active);

  // 获取网关配置列表
  const fetchProfiles = useCallback((force = false) => {
    setProfilesLoading(true);
    gatewayProfileApi.listCached(15000, force).then((data: any) => {
      setProfiles(Array.isArray(data) ? data : []);
    }).catch(() => {}).finally(() => setProfilesLoading(false));
  }, []);

  const fetchStatus = useCallback((force = false) => {
    gatewayApi.statusCached(6000, force).then((data: any) => {
      setStatus(data);
    }).catch(() => {
      setStatus({ running: false, runtime: '', detail: '' });
    });
  }, []);

  const fetchLogs = useCallback((limit = 120, force = false) => {
    gatewayApi.logCached(limit, 5000, force).then((res: any) => {
      let lines: string[] = [];
      if (res && Array.isArray(res.lines)) lines = res.lines;
      else if (res && Array.isArray(res)) lines = res;
      setLogs(lines);
    }).catch(() => {});
  }, []);

  const fetchHealthCheck = useCallback((force = false) => {
    gatewayApi.getHealthCheckCached(6000, force).then((data: any) => {
      setHealthCheckEnabled(!!data?.enabled);
      setHealthStatus({ fail_count: data?.fail_count || 0, last_ok: data?.last_ok || '' });
    }).catch(() => {});
  }, []);

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const data = await eventsApi.list({
        page: 1,
        page_size: 120,
        risk: eventRisk,
        type: eventType,
        source: eventSource,
        keyword: eventKeyword.trim() || undefined,
      });
      setEvents(Array.isArray(data?.list) ? data.list : []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [eventKeyword, eventRisk, eventSource, eventType]);

  // 初始加载 + 定时轮询（状态、日志、心跳全部轮询）
  useEffect(() => {
    fetchProfiles();
    fetchStatus();
    fetchHealthCheck();
    const deferTimer = setTimeout(() => {
      fetchLogs(120);
      if (activeTab === 'events') fetchEvents();
    }, 0);
    return () => clearTimeout(deferTimer);
  }, [fetchProfiles, fetchStatus, fetchHealthCheck, fetchLogs, fetchEvents, activeTab]);

  useEffect(() => {
    const timer = setInterval(() => {
      fetchStatus();
      fetchHealthCheck();
    }, 5000);
    return () => clearInterval(timer);
  }, [fetchStatus, fetchHealthCheck]);

  useEffect(() => {
    if (activeTab !== 'logs') return;
    const timer = setInterval(() => fetchLogs(120), 8000);
    return () => clearInterval(timer);
  }, [activeTab, fetchLogs]);

  useEffect(() => {
    if (activeTab !== 'events') return;
    const timer = setInterval(() => fetchEvents(), 10000);
    return () => clearInterval(timer);
  }, [activeTab, fetchEvents]);

  // 刷新所有状态
  const refreshAll = useCallback((force = false) => {
    fetchProfiles(force);
    fetchStatus(force);
    fetchHealthCheck(force);
    if (activeTab === 'logs') fetchLogs(120, force);
    if (activeTab === 'events') fetchEvents();
  }, [activeTab, fetchProfiles, fetchStatus, fetchLogs, fetchHealthCheck, fetchEvents]);

  const actionLabels: Record<string, string> = {
    start: gw.start, stop: gw.stop, restart: gw.restart,
  };

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    setActionLoading(action);
    try {
      await gatewayApi[action]();
      toast('success', `${actionLabels[action]} ${gw.ok}`);
      setTimeout(() => refreshAll(true), 1000);
      setTimeout(() => refreshAll(true), 3000);
    } catch (err: any) {
      toast('error', `${actionLabels[action]} ${gw.failed}: ${err?.message || err}`);
    } finally {
      setTimeout(() => setActionLoading(null), 1500);
    }
  };

  // 网关配置 CRUD
  const handleSaveProfile = async () => {
    if (!formData.name.trim() || !formData.host.trim()) return;
    setSaving(true);
    try {
      if (editingProfile) {
        await gatewayProfileApi.update(editingProfile.id, formData);
      } else {
        await gatewayProfileApi.create({ ...formData, port: formData.port || 18789 });
      }
      fetchProfiles(true);
      setEditingProfile(null);
      setFormData({ name: '', host: '127.0.0.1', port: 18789, token: '' });
      setShowProfilePanel(false);
      toast('success', gw.profileSaved);
    } catch (err: any) {
      toast('error', err?.message || gw.saveFailed);
    } finally { setSaving(false); }
  };

  const handleDeleteProfile = async (id: number) => {
    if (!confirm(gw.confirmDelete)) return;
    try {
      await gatewayProfileApi.remove(id);
      fetchProfiles(true);
      toast('success', gw.deleted);
    } catch (err: any) {
      toast('error', err?.message || gw.deleteFailed);
    }
  };

  const handleActivateProfile = async (id: number) => {
    try {
      await gatewayProfileApi.activate(id);
      fetchProfiles(true);
      setTimeout(() => refreshAll(true), 1500);
      toast('success', gw.switched);
    } catch (err: any) {
      toast('error', err?.message || gw.switchFailed);
    }
  };

  const openEditForm = (p: GatewayProfile) => {
    setEditingProfile(p);
    setFormData({ name: p.name, host: p.host, port: p.port, token: p.token });
    setShowProfilePanel(true);
  };

  const openAddForm = () => {
    setEditingProfile(null);
    setFormData({ name: '', host: '127.0.0.1', port: 18789, token: '' });
    setShowProfilePanel(true);
  };

  // Debug 面板操作
  const fetchDebugData = useCallback(async () => {
    setDebugLoading(true);
    const settle = (p: Promise<any>) => p.catch(() => null);
    const [st, hl] = await Promise.all([settle(gwApi.status()), settle(gwApi.health())]);
    if (st) setDebugStatus(st);
    if (hl) setDebugHealth(hl);
    setDebugLoading(false);
  }, []);

  const handleRpcCall = useCallback(async () => {
    if (!rpcMethod.trim()) return;
    setRpcLoading(true);
    setRpcResult(null);
    setRpcError(null);
    try {
      const params = JSON.parse(rpcParams || '{}');
      const res = await gwApi.proxy(rpcMethod.trim(), params);
      setRpcResult(JSON.stringify(res, null, 2));
    } catch (err: any) {
      setRpcError(err?.message || String(err));
    } finally {
      setRpcLoading(false);
    }
  }, [rpcMethod, rpcParams]);

  // 日志清空：记录清除时间戳，过滤掉之前的日志
  const handleClearLogs = useCallback(() => {
    setClearTimestamp(new Date().toISOString());
  }, []);

  // 可见日志 = 清空时间之后的日志
  const visibleLogs = useMemo(() => {
    if (!clearTimestamp) return logs;
    const clearTime = new Date(clearTimestamp).getTime();
    return logs.filter(line => {
      // 尝试从日志行解析时间戳
      if (!line.startsWith('{')) return true;
      try {
        const obj = JSON.parse(line);
        const ts = obj.time || obj.timestamp || obj.ts || obj.t || obj._meta?.date;
        if (ts) {
          const logTime = typeof ts === 'number' ? ts : new Date(ts).getTime();
          return logTime > clearTime;
        }
      } catch { /* ignore */ }
      return true;
    });
  }, [logs, clearTimestamp]);

  const isLocal = (host: string) => ['127.0.0.1', 'localhost', '::1'].includes(host.trim());

  // 解析 JSON 格式日志行（tslog / zerolog / pino 等）
  const parseLogLine = (line: string): { time: string; level: string; message: string; component?: string; extra?: string } | null => {
    if (!line.startsWith('{')) return null;
    try {
      const obj = JSON.parse(line);
      const meta = obj._meta;

      // tslog 格式: { "0": "消息", "1": {...}, "_meta": { logLevelName, name, date }, "time": "..." }
      if (meta && typeof meta === 'object') {
        const level = (meta.logLevelName || 'INFO').toLowerCase();
        let time = '';
        const ts = obj.time || meta.date;
        if (typeof ts === 'string') {
          try { time = new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { time = ts; }
        }
        let component = '';
        if (typeof meta.name === 'string') {
          try {
            const nameObj = JSON.parse(meta.name);
            component = nameObj.subsystem || nameObj.module || nameObj.name || '';
          } catch { component = meta.name; }
        }
        let message = '';
        if (typeof obj['0'] === 'string') {
          try {
            const parsed = JSON.parse(obj['0']);
            if (typeof parsed === 'object' && parsed !== null) {
              component = component || parsed.subsystem || parsed.module || '';
            }
          } catch { /* not JSON, use as-is */ }
          message = typeof obj['0'] === 'string' ? obj['0'] : '';
        }
        if (message.startsWith('{') && typeof obj['1'] === 'string') {
          message = obj['1'];
        } else if (message.startsWith('{')) {
          try {
            const p = JSON.parse(message);
            message = Object.entries(p).map(([k, v]) => `${k}=${v}`).join(' ');
          } catch { /* keep as-is */ }
        }
        const extraParts: string[] = [];
        for (let i = 1; i <= 9; i++) {
          const val = obj[String(i)];
          if (val === undefined) break;
          if (typeof val === 'string') {
            if (val !== message) extraParts.push(val);
          } else if (typeof val === 'object') {
            extraParts.push(Object.entries(val).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' '));
          }
        }
        return { time, level, message, component: component || undefined, extra: extraParts.length > 0 ? extraParts.join(' | ') : undefined };
      }

      // zerolog / pino / bunyan 格式
      let level = '';
      if (typeof obj.level === 'number') {
        level = obj.level <= 10 ? 'trace' : obj.level <= 20 ? 'debug' : obj.level <= 30 ? 'info' : obj.level <= 40 ? 'warn' : obj.level <= 50 ? 'error' : 'fatal';
      } else if (typeof obj.level === 'string') {
        level = obj.level.toLowerCase();
      }
      let time = '';
      const ts = obj.time || obj.timestamp || obj.ts || obj.t;
      if (typeof ts === 'number') {
        time = new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      } else if (typeof ts === 'string') {
        try { time = new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { time = ts; }
      }
      const message = obj.msg || obj.message || obj.text || '';
      const component = obj.module || obj.component || obj.name || obj.subsystem || '';
      const skipKeys = new Set(['level', 'time', 'timestamp', 'ts', 't', 'msg', 'message', 'text', 'module', 'component', 'name', 'subsystem', 'v', 'pid', 'hostname']);
      const extras = Object.entries(obj).filter(([k]) => !skipKeys.has(k));
      const extra = extras.length > 0 ? extras.map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ') : '';
      return { time, level: level || 'info', message, component: component || undefined, extra: extra || undefined };
    } catch {
      return null;
    }
  };

  const parsedLogEntries = useMemo(() => {
    return visibleLogs.map((line) => ({ line, parsed: parseLogLine(line) }));
  }, [visibleLogs]);

  // 日志过滤
  const filteredLogs = useMemo(() => {
    const needle = logSearch.trim().toLowerCase();
    return parsedLogEntries.filter(({ line, parsed }) => {
      if (parsed && parsed.level) {
        const lvl = parsed.level.toLowerCase();
        if (lvl in levelFilters && !levelFilters[lvl]) return false;
      }
      if (needle && !line.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [parsedLogEntries, logSearch, levelFilters]);

  // Limit rendered DOM rows to keep logs tab responsive.
  const renderedLogs = useMemo(() => filteredLogs.slice(-300), [filteredLogs]);
  const omittedLogCount = Math.max(0, filteredLogs.length - renderedLogs.length);

  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (autoFollow) logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [filteredLogs, autoFollow]);
  useEffect(() => {
    if (activeTab === 'events') fetchEvents();
  }, [activeTab, eventRisk, eventType, eventSource, eventKeyword, fetchEvents]);

  const filteredEvents = events;
  const eventSources = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e: any) => {
      const s = String(e?.source || '').trim();
      if (s) set.add(s);
    });
    return ['all', ...Array.from(set).slice(0, 12)];
  }, [events]);

  const eventsLabel = gw.events;
  const eventRiskLabel = gw.eventRisk;
  const eventSourceLabel = gw.eventSource;
  const eventCategoryLabel = gw.eventCategory;
  const eventNoneLabel = gw.noEvents;
  const openRelatedLabel = gw.openRelated;
  const preferLabelEn = !!gw.preferLabelEn;

  const jumpToWindow = useCallback((id: string) => {
    window.dispatchEvent(new CustomEvent('clawdeck:open-window', { detail: { id } }));
  }, []);

  const suggestJumpWindow = useCallback((ev: any): 'gateway' | 'alerts' | 'activity' | 'maintenance' | 'editor' => {
    const typ = String(ev?.type || '').toLowerCase();
    const cat = String(ev?.category || '').toLowerCase();
    const src = String(ev?.source || '').toLowerCase();
    if (typ === 'alert' || cat.includes('security')) return 'alerts';
    if (cat.includes('gateway') || src.includes('gateway')) return 'gateway';
    if (cat.includes('config') || cat.includes('model')) return 'editor';
    if (cat.includes('doctor') || cat.includes('health')) return 'maintenance';
    return 'activity';
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-transparent">
      {/* 网关选择区 */}
      <div className="p-3 md:p-4 border-b border-slate-200 dark:border-white/5 bg-slate-50/80 dark:bg-white/[0.02] shrink-0">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-[10px] md:text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-widest">{gw.profiles}</h3>
          <button onClick={openAddForm} className="flex items-center gap-1 px-2.5 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-[10px] md:text-[11px] font-bold transition-all border border-primary/20">
            <span className="material-symbols-outlined text-[14px]">add</span> {gw.addGateway}
          </button>
        </div>

        {profilesLoading && profiles.length === 0 ? (
          <div className="w-full py-4 border border-slate-200 dark:border-white/10 rounded-xl text-slate-400 dark:text-white/40 text-xs flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
            {gw.loading}
          </div>
        ) : profiles.length === 0 ? (
          <button onClick={openAddForm} className="w-full py-4 border-2 border-dashed border-slate-300 dark:border-white/10 rounded-xl text-slate-400 dark:text-white/40 text-xs font-medium hover:border-primary hover:text-primary transition-all">
            <span className="material-symbols-outlined text-[20px] block mb-1">add_circle</span>
            {gw.noProfiles}
          </button>
        ) : (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {profiles.map(p => (
              <div
                key={p.id}
                className={`group relative flex-shrink-0 w-44 md:w-52 rounded-xl border p-3 cursor-pointer transition-all ${
                  p.is_active
                    ? 'bg-primary/5 dark:bg-primary/10 border-primary/30 shadow-sm shadow-primary/10'
                    : 'bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/10 hover:border-primary/20'
                }`}
                onClick={() => !p.is_active && handleActivateProfile(p.id)}
              >
                {/* 状态指示 */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${p.is_active && status?.running ? 'bg-mac-green animate-pulse' : p.is_active ? 'bg-mac-yellow animate-pulse' : 'bg-slate-300 dark:bg-white/20'}`}></div>
                    <span className={`text-[11px] font-bold uppercase ${p.is_active && status?.running ? 'text-mac-green' : p.is_active ? 'text-mac-yellow' : 'text-slate-400 dark:text-white/40'}`}>
                      {p.is_active ? (status?.running ? gw.running : gw.stopped) : gw.inactive}
                    </span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                    isLocal(p.host)
                      ? 'bg-blue-500/10 text-blue-500'
                      : 'bg-purple-500/10 text-purple-500'
                  }`}>
                    {isLocal(p.host) ? gw.local : gw.remote}
                  </span>
                </div>
                {/* 名称 */}
                <h4 className="text-xs font-bold text-slate-800 dark:text-white truncate">{p.name}</h4>
                <p className="text-[11px] text-slate-400 dark:text-white/40 font-mono mt-0.5 truncate">{p.host}:{p.port}</p>
                {/* 操作按钮 */}
                <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditForm(p); }}
                    className="w-5 h-5 rounded flex items-center justify-center bg-slate-200/80 dark:bg-white/10 hover:bg-primary/20 text-slate-500 dark:text-white/50 hover:text-primary transition-all"
                  >
                    <span className="material-symbols-outlined text-[12px]">edit</span>
                  </button>
                  {!p.is_active && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteProfile(p.id); }}
                      className="w-5 h-5 rounded flex items-center justify-center bg-slate-200/80 dark:bg-white/10 hover:bg-mac-red/20 text-slate-500 dark:text-white/50 hover:text-mac-red transition-all"
                    >
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 网关配置表单弹窗 */}
      {showProfilePanel && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowProfilePanel(false)}>
          <div className="w-[90%] max-w-md bg-white dark:bg-[#1c1f26] rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">{editingProfile ? gw.editGateway : gw.addGateway}</h3>
              <button onClick={() => setShowProfilePanel(false)} className="w-6 h-6 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center text-slate-500 dark:text-white/50 hover:bg-mac-red hover:text-white transition-all">
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1 block">{gw.gwName}</label>
                <input
                  value={formData.name}
                  onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                  placeholder={gw.namePlaceholder}
                  className="w-full h-9 px-3 bg-slate-100 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-mono text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary outline-none transition-all"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1 block">{gw.gwHost}</label>
                  <input
                    value={formData.host}
                    onChange={e => setFormData(f => ({ ...f, host: e.target.value }))}
                    placeholder={gw.hostPlaceholder}
                    className="w-full h-9 px-3 bg-slate-100 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-mono text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1 block">{gw.gwPort}</label>
                  <input
                    type="number"
                    value={formData.port}
                    onChange={e => setFormData(f => ({ ...f, port: parseInt(e.target.value) || 18789 }))}
                    className="w-full h-9 px-3 bg-slate-100 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-mono text-slate-800 dark:text-white focus:ring-1 focus:ring-primary outline-none transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1 block">{gw.gwToken}</label>
                <input
                  type="password"
                  value={formData.token}
                  onChange={e => setFormData(f => ({ ...f, token: e.target.value }))}
                  placeholder={gw.tokenPlaceholder}
                  className="w-full h-9 px-3 bg-slate-100 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm font-mono text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary outline-none transition-all"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-end gap-2 bg-slate-50 dark:bg-white/[0.02]">
              <button onClick={() => setShowProfilePanel(false)} className="px-4 py-1.5 text-xs font-bold text-slate-500 dark:text-white/50 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-all">
                {gw.cancel}
              </button>
              <button
                onClick={handleSaveProfile}
                disabled={saving || !formData.name.trim() || !formData.host.trim()}
                className="px-4 py-1.5 bg-primary text-white text-xs font-bold rounded-lg shadow-lg shadow-primary/20 disabled:opacity-50 transition-all"
              >
                {saving ? '...' : gw.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 状态与控制区 — 紧凑布局 */}
      <div className="px-3 md:px-4 py-2 md:py-3 border-b border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01] shrink-0 space-y-2">
        {/* Row 1: 状态信息 + 心跳 */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center text-primary border border-primary/20 shrink-0">
            <span className="material-symbols-outlined text-[20px]">router</span>
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            <h3 className="text-slate-800 dark:text-white font-bold text-sm">{activeProfile?.name || gw.status}</h3>
            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-bold ${status?.running ? 'bg-mac-green/10 border-mac-green/20 text-mac-green' : 'bg-slate-500/10 border-slate-500/20 text-slate-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${status?.running ? 'bg-mac-green animate-pulse' : 'bg-slate-400'}`} />
              {status?.running ? gw.running : gw.stopped}
            </div>
            {activeProfile && <span className="text-[10px] text-slate-400 dark:text-white/40 font-mono">{activeProfile.host}:{activeProfile.port}</span>}
            <span className="text-[10px] text-slate-400 dark:text-white/40">{gw.runtime}: <span className="text-mac-green font-mono">{status?.runtime || na}</span></span>
          </div>
          {/* 健康探测状态 (自动启用) */}
          {status?.running && (
            <div className="flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-full border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]">
              {(() => {
                if (!healthStatus?.last_ok) return <><span className="material-symbols-outlined text-[12px] text-mac-yellow animate-spin">progress_activity</span><span className="text-[11px] text-slate-400 dark:text-white/40">{gw.hbProbing}</span></>;
                if (healthStatus.fail_count > 0) return <><span className="material-symbols-outlined text-[12px] text-mac-red">heart_broken</span><span className="text-[11px] font-bold text-mac-red">{gw.hbUnhealthy} ({healthStatus.fail_count})</span></>;
                return <><span className="material-symbols-outlined text-[12px] text-mac-green animate-pulse">favorite</span><span className="text-[11px] font-bold text-mac-green">{gw.hbHealthy}</span></>;
              })()}
            </div>
          )}
        </div>

        {/* Row 2: 操作按钮 — 单行紧凑 */}
        {(() => {
          const remote = activeProfile ? !isLocal(activeProfile.host) : false;
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              {!remote && (
                <button onClick={() => handleAction('start')} disabled={!!actionLoading || status?.running} className="flex items-center gap-1 px-2.5 py-1 bg-mac-green/15 text-mac-green rounded-lg font-bold text-[10px] transition-all disabled:opacity-40">
                  <span className={`material-symbols-outlined text-[14px] ${actionLoading === 'start' ? 'animate-spin' : ''}`}>{actionLoading === 'start' ? 'progress_activity' : 'play_arrow'}</span>{gw.start}
                </button>
              )}
              {!remote && (
                <button onClick={() => handleAction('stop')} disabled={!!actionLoading || !status?.running} className="flex items-center gap-1 px-2.5 py-1 bg-slate-600 text-white rounded-lg font-bold text-[10px] transition-all disabled:opacity-40">
                  <span className={`material-symbols-outlined text-[14px] ${actionLoading === 'stop' ? 'animate-spin' : ''}`}>{actionLoading === 'stop' ? 'progress_activity' : 'stop'}</span>{gw.stop}
                </button>
              )}
              <button onClick={() => handleAction('restart')} disabled={!!actionLoading} className="flex items-center gap-1 px-2.5 py-1 bg-primary text-white rounded-lg font-bold text-[10px] transition-all disabled:opacity-40">
                <span className={`material-symbols-outlined text-[14px] ${actionLoading === 'restart' ? 'animate-spin' : ''}`}>{actionLoading === 'restart' ? 'progress_activity' : 'refresh'}</span>{remote ? gw.reload : gw.restart}
              </button>
            </div>
          );
        })()}
      </div>

      {/* 日志 & 调试区 */}
      <div className="flex-1 flex flex-col bg-slate-900 dark:bg-[#0a0f14] border-t border-slate-200 dark:border-white/10 md:mx-4 md:mb-4 md:rounded-xl overflow-hidden shadow-inner">
        {/* Tab Bar + Search + Filters — 单行紧凑 */}
        <div className="shrink-0 h-9 flex items-center gap-1.5 px-3 bg-white/5 border-b border-white/5">
          {/* Tabs */}
          {(['logs', 'events', 'debug'] as const).map(tab => (
            <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'debug') fetchDebugData(); if (tab === 'events') fetchEvents(); }}
              className={`px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-all ${activeTab === tab ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'}`}>
              <span className="material-symbols-outlined text-[12px] align-middle mr-0.5">{tab === 'logs' ? 'terminal' : tab === 'events' ? 'event_note' : 'bug_report'}</span>
              {tab === 'logs' ? gw.logs : tab === 'events' ? eventsLabel : gw.debug}
            </button>
          ))}

          {activeTab === 'logs' && (
            <>
              {/* Divider */}
              <div className="w-px h-4 bg-white/10 mx-0.5" />
              {/* Search */}
              <div className="relative flex-1 min-w-[100px] max-w-[200px]">
                <span className="material-symbols-outlined absolute left-1.5 top-1/2 -translate-y-1/2 text-white/20 text-[12px]">search</span>
                <input value={logSearch} onChange={e => setLogSearch(e.target.value)} placeholder={gw.search}
                  className="w-full h-6 pl-6 pr-2 bg-white/5 border border-white/5 rounded text-[11px] text-white/80 placeholder:text-white/20 focus:ring-1 focus:ring-primary/50 outline-none" />
              </div>
              {/* Level Filters */}
              <div className="flex items-center gap-px">
                {['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map(lvl => {
                  const colors: Record<string, string> = { trace: 'bg-slate-500', debug: 'bg-slate-400', info: 'bg-blue-500', warn: 'bg-yellow-500', error: 'bg-red-500', fatal: 'bg-red-700' };
                  return (
                    <button key={lvl} onClick={() => setLevelFilters(f => ({ ...f, [lvl]: !f[lvl] }))}
                      className={`px-1.5 py-0.5 rounded text-[11px] font-bold uppercase transition-all ${levelFilters[lvl] ? `${colors[lvl]}/20 text-white/70` : 'bg-white/5 text-white/15 line-through'}`}>
                      {lvl.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
              {/* Spacer */}
              <div className="flex-1" />
              {/* Actions */}
              <button onClick={handleClearLogs} className="text-white/30 hover:text-white transition-colors" title={gw.clear}>
                <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
              </button>
              <button onClick={() => { const blob = new Blob([filteredLogs.map(item => item.line).join('\n')], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gateway-logs-${Date.now()}.txt`; a.click(); }}
                className="text-white/30 hover:text-white transition-colors" title={gw.export}>
                <span className="material-symbols-outlined text-[14px]">download</span>
              </button>
              <button onClick={() => setAutoFollow(!autoFollow)}
                className={`p-0.5 rounded transition-all ${autoFollow ? 'text-primary' : 'text-white/30'}`} title={gw.autoFollow}>
                <span className="material-symbols-outlined text-[14px]">{autoFollow ? 'vertical_align_bottom' : 'pause'}</span>
              </button>
            </>
          )}
        </div>

        {/* Content Area */}
        {activeTab === 'logs' ? (
          <>
            <div className="flex-1 overflow-y-auto font-mono text-[11px] md:text-[12px] p-4 custom-scrollbar">
              {filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-white/15">
                  <span className="material-symbols-outlined text-[32px] mb-2">terminal</span>
                  <span className="text-[10px]">{gw.noLogs}</span>
                </div>
              ) : renderedLogs.map(({ line: log, parsed }, idx) => {
                if (!parsed) {
                  return (
                    <div key={idx} className="flex gap-2 md:gap-3 mb-0.5 group leading-relaxed hover:bg-white/[0.02] rounded px-1 -mx-1">
                      <span className="text-white/10 select-none w-6 md:w-8 text-right shrink-0 text-[10px]">{idx + 1}</span>
                      <span className={`text-white/60 break-all ${log.includes('ERROR') || log.includes('error') ? 'text-red-400' : log.includes('WARN') || log.includes('warn') ? 'text-yellow-400' : ''}`}>{log}</span>
                    </div>
                  );
                }
                const lvlColor = parsed.level === 'error' || parsed.level === 'fatal' ? 'text-red-400' : parsed.level === 'warn' ? 'text-yellow-400' : parsed.level === 'debug' || parsed.level === 'trace' ? 'text-white/30' : 'text-white/60';
                const lvlBg = parsed.level === 'error' || parsed.level === 'fatal' ? 'bg-red-500/15' : parsed.level === 'warn' ? 'bg-yellow-500/15' : parsed.level === 'info' ? 'bg-blue-500/10' : 'bg-white/5';
                return (
                  <div key={idx} className="flex gap-2 md:gap-3 mb-0.5 group leading-relaxed hover:bg-white/[0.02] rounded px-1 -mx-1">
                    <span className="text-white/10 select-none w-6 md:w-8 text-right shrink-0 text-[10px]">{idx + 1}</span>
                    <div className="flex-1 break-all">
                      {parsed.time && <span className="text-cyan-400/50 mr-2">{parsed.time}</span>}
                      <span className={`inline-block px-1 rounded text-[11px] font-bold uppercase mr-2 ${lvlColor} ${lvlBg}`}>{parsed.level}</span>
                      {parsed.component && <span className="text-purple-400/60 mr-2">[{parsed.component}]</span>}
                      <span className={lvlColor}>{parsed.message}</span>
                      {parsed.extra && <span className="text-white/20 ml-2 text-[10px]">{parsed.extra}</span>}
                    </div>
                  </div>
                );
              })}
              <div ref={logEndRef} />
            </div>
            <div className="h-7 bg-black/40 px-4 flex items-center justify-between text-[11px] text-white/30 font-bold uppercase shrink-0">
              <div className="flex gap-4">
                <span>{filteredLogs.length}{filteredLogs.length !== visibleLogs.length ? `/${visibleLogs.length}` : ''} {gw.lines}</span>
                {omittedLogCount > 0 && <span>+{omittedLogCount}</span>}
                {activeProfile && <span className="text-primary/60">{activeProfile.host}:{activeProfile.port}</span>}
              </div>
              <div className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px]">terminal</span>
                <span>{gw.secure}</span>
              </div>
            </div>
          </>
        ) : activeTab === 'events' ? (
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-[220px]">
                <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-white/20 text-[12px]">search</span>
                <input
                  value={eventKeyword}
                  onChange={e => setEventKeyword(e.target.value)}
                  placeholder={gw.search}
                  className="w-full h-8 pl-7 pr-2 bg-white/5 border border-white/5 rounded text-[11px] text-white/80 placeholder:text-white/20 focus:ring-1 focus:ring-primary/50 outline-none"
                />
              </div>
              <div className="flex items-center gap-1">
                {(['all', 'low', 'medium', 'high', 'critical'] as const).map(risk => (
                  <button
                    key={risk}
                    onClick={() => setEventRisk(risk)}
                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all ${eventRisk === risk ? 'bg-white/10 text-white' : 'bg-white/5 text-white/40 hover:text-white/70'}`}
                  >
                    {risk}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                {(['all', 'activity', 'alert'] as const).map(tp => (
                  <button
                    key={tp}
                    onClick={() => setEventType(tp)}
                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all ${eventType === tp ? 'bg-white/10 text-white' : 'bg-white/5 text-white/40 hover:text-white/70'}`}
                  >
                    {tp}
                  </button>
                ))}
              </div>
              <select
                value={eventSource}
                onChange={(e) => setEventSource(e.target.value)}
                className="h-8 px-2 bg-white/5 border border-white/10 rounded text-[11px] text-white/80"
              >
                {eventSources.map((s) => (
                  <option key={s} value={s} className="text-slate-800">
                    {s}
                  </option>
                ))}
              </select>
              <button
                onClick={fetchEvents}
                disabled={eventsLoading}
                className="ml-auto px-2 py-1 rounded text-[10px] font-bold bg-white/5 text-white/60 hover:text-white disabled:opacity-40"
              >
                <span className={`material-symbols-outlined text-[12px] align-middle mr-1 ${eventsLoading ? 'animate-spin' : ''}`}>{eventsLoading ? 'progress_activity' : 'refresh'}</span>
                      {gw.refresh}
              </button>
            </div>

            {eventsLoading && filteredEvents.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-white/30 text-[11px]">
                <span className="material-symbols-outlined text-[18px] animate-spin mr-2">progress_activity</span>
                    {gw.loading}
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-white/20 text-[11px]">{eventNoneLabel}</div>
            ) : (
              <div className="space-y-2">
                {filteredEvents.map((ev, idx) => {
                  const risk = String(ev?.risk || 'low').toLowerCase();
                  const jumpTarget = suggestJumpWindow(ev);
                  const riskCls = risk === 'critical' || risk === 'high'
                    ? 'text-red-400 bg-red-500/10'
                    : risk === 'medium'
                      ? 'text-amber-400 bg-amber-500/10'
                      : 'text-emerald-400 bg-emerald-500/10';
                  const ts = ev?.timestamp || ev?.created_at;
                  return (
                    <div key={`${ev?.id || idx}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[12px] font-bold text-white/85 break-all">{ev?.title || ev?.summary || na}</p>
                          {ev?.detail && <p className="text-[11px] text-white/45 mt-1 break-all">{ev.detail}</p>}
                        </div>
                        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${riskCls}`}>{risk}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-white/35">
                        <span>{eventSourceLabel}: {ev?.source || na}</span>
                        <span>{eventCategoryLabel}: {ev?.category || na}</span>
                        <span>{eventRiskLabel}: {risk}</span>
                        <span>{ev?.type || na}</span>
                        <span>{ts ? new Date(ts).toLocaleString() : na}</span>
                        <button
                          onClick={() => jumpToWindow(jumpTarget)}
                          className="ml-auto px-1.5 py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25"
                        >
                          {openRelatedLabel}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Debug Panel */
          <div className="flex-1 overflow-y-auto p-4 md:p-5 custom-scrollbar space-y-4">
            {/* System Event */}
            <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-indigo-400">campaign</span>
                <h3 className="text-[11px] font-bold text-white/80 uppercase tracking-wider">{gw.systemEvent}</h3>
              </div>
              <div className="p-4 space-y-2">
                <p className="text-[10px] text-white/30">{gw.systemEventDesc}</p>
                <div className="flex gap-2">
                  <input value={sysEventText} onChange={e => setSysEventText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sysEventText.trim() && !sysEventSending && (async () => {
                      setSysEventSending(true); setSysEventResult(null);
                      try { await gwApi.systemEvent(sysEventText.trim()); setSysEventResult({ ok: true, text: gw.systemEventOk }); setSysEventText(''); setTimeout(() => setSysEventResult(null), 3000); }
                      catch (err: any) { setSysEventResult({ ok: false, text: gw.systemEventFailed + ': ' + (err?.message || '') }); }
                      setSysEventSending(false);
                    })()}
                    placeholder={gw.systemEventPlaceholder}
                    className="flex-1 h-8 px-3 bg-white/5 border border-white/5 rounded-lg text-[11px] text-white/80 placeholder:text-white/20 focus:ring-1 focus:ring-primary/50 outline-none" />
                  <button onClick={async () => {
                    if (!sysEventText.trim() || sysEventSending) return;
                    setSysEventSending(true); setSysEventResult(null);
                    try { await gwApi.systemEvent(sysEventText.trim()); setSysEventResult({ ok: true, text: gw.systemEventOk }); setSysEventText(''); setTimeout(() => setSysEventResult(null), 3000); }
                    catch (err: any) { setSysEventResult({ ok: false, text: gw.systemEventFailed + ': ' + (err?.message || '') }); }
                    setSysEventSending(false);
                  }} disabled={sysEventSending || !sysEventText.trim()}
                    className="h-8 px-3 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1.5 transition-all">
                    <span className="material-symbols-outlined text-[14px]">{sysEventSending ? 'progress_activity' : 'send'}</span>
                    {sysEventSending ? '...' : gw.systemEventSend}
                  </button>
                </div>
                {sysEventResult && (
                  <div className={`px-2 py-1.5 rounded-lg text-[10px] font-bold ${sysEventResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                    {sysEventResult.text}
                  </div>
                )}
              </div>
            </div>

            {/* Manual RPC */}
            <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/5 flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-primary">code</span>
                <h3 className="text-[11px] font-bold text-white/80 uppercase tracking-wider">{gw.rpc}</h3>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-1 block">{gw.rpcMethod}</label>
                  <input value={rpcMethod} onChange={e => setRpcMethod(e.target.value)} placeholder="system-presence"
                    className="w-full h-8 px-3 bg-white/5 border border-white/5 rounded-lg text-[11px] font-mono text-white/80 placeholder:text-white/20 focus:ring-1 focus:ring-primary/50 outline-none"
                    onKeyDown={e => e.key === 'Enter' && handleRpcCall()} />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-1 block">{gw.rpcParams}</label>
                  <textarea value={rpcParams} onChange={e => setRpcParams(e.target.value)} rows={4}
                    className="w-full px-3 py-2 bg-white/5 border border-white/5 rounded-lg text-[11px] font-mono text-white/80 placeholder:text-white/20 focus:ring-1 focus:ring-primary/50 outline-none resize-none" />
                </div>
                <button onClick={handleRpcCall} disabled={rpcLoading || !rpcMethod.trim()}
                  className="px-4 py-1.5 bg-primary text-white text-[11px] font-bold rounded-lg disabled:opacity-40 transition-all">
                  {rpcLoading ? <span className="material-symbols-outlined text-[14px] animate-spin align-middle">progress_activity</span> : gw.rpcCall}
                </button>
                {rpcError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <p className="text-[10px] font-bold text-red-400 mb-1">{gw.rpcError}</p>
                    <pre className="text-[10px] text-red-300/80 font-mono whitespace-pre-wrap break-all">{rpcError}</pre>
                  </div>
                )}
                {rpcResult && (
                  <div className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
                    <p className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-1">{gw.rpcResult}</p>
                    <pre className="text-[10px] text-emerald-400/80 font-mono whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto custom-scrollbar">{rpcResult}</pre>
                  </div>
                )}
              </div>
            </div>

            {/* Snapshots */}
            <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-amber-400">monitoring</span>
                  <h3 className="text-[11px] font-bold text-white/80 uppercase tracking-wider">{gw.snapshots}</h3>
                </div>
                <button onClick={fetchDebugData} disabled={debugLoading}
                  className="text-white/30 hover:text-white text-[10px] font-bold flex items-center gap-1 transition-colors">
                  <span className={`material-symbols-outlined text-[14px] ${debugLoading ? 'animate-spin' : ''}`}>{debugLoading ? 'progress_activity' : 'refresh'}</span>
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-1.5">{gw.status}</p>
                  <pre className="text-[10px] text-white/50 font-mono whitespace-pre-wrap break-all bg-white/[0.02] rounded-lg p-3 max-h-[200px] overflow-y-auto custom-scrollbar border border-white/5">
                    {debugStatus ? JSON.stringify(debugStatus, null, 2) : '{}'}
                  </pre>
                </div>
                <div>
                  <p className="text-[11px] font-bold text-white/30 uppercase tracking-wider mb-1.5">{gw.gwHealth}</p>
                  <pre className="text-[10px] text-white/50 font-mono whitespace-pre-wrap break-all bg-white/[0.02] rounded-lg p-3 max-h-[200px] overflow-y-auto custom-scrollbar border border-white/5">
                    {debugHealth ? JSON.stringify(debugHealth, null, 2) : '{}'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Gateway;
