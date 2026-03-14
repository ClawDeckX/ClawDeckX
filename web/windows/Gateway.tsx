
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { eventsApi, gatewayApi, gatewayProfileApi, gwApi } from '../services/api';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useGatewayEvents } from '../hooks/useGatewayEvents';
import CustomSelect from '../components/CustomSelect';
import NumberStepper from '../components/NumberStepper';
import EventsPanel from './Gateway/EventsPanel';
import ChannelsPanel from './Gateway/ChannelsPanel';
import DebugPanel from './Gateway/DebugPanel';
import ServicePanel from './Gateway/ServicePanel';
import { copyToClipboard } from '../utils/clipboard';

interface OpenWindowDetail {
  id?: string;
  tab?: 'logs' | 'events' | 'debug' | 'channels' | 'service';
  eventRisk?: 'all' | 'low' | 'medium' | 'high' | 'critical';
  eventType?: 'all' | 'activity' | 'alert';
  eventSource?: string;
  eventKeyword?: string;
}

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
  const { confirm } = useConfirm();

  // 网关状态 & 日志
  const [status, setStatus] = useState<any>(null);
  const [initialDetecting, setInitialDetecting] = useState(false);
  const hasStartedInitialDetectingRef = useRef(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [clearTimestamp, setClearTimestamp] = useState<string | null>(null);
  const prevRunningRef = useRef<boolean | null>(null);
  const logCursorRef = useRef<number | undefined>(undefined);
  const logInitializedRef = useRef(false);

  // 日志增强
  const [logSearch, setLogSearch] = useState('');
  const [autoFollow, setAutoFollow] = useState(true);
  const [levelFilters, setLevelFilters] = useState<Record<string, boolean>>({ trace: true, debug: true, info: true, warn: true, error: true, fatal: true });
  const [logLimit, setLogLimit] = useState(120);
  const [expandedExtras, setExpandedExtras] = useState<Set<number>>(new Set());

  // Debug 面板
  const [activeTab, setActiveTab] = useState<'logs' | 'events' | 'debug' | 'channels' | 'service'>('logs');
  const [rpcMethod, setRpcMethod] = useState('');
  const [rpcParams, setRpcParams] = useState('{}');
  const [rpcResult, setRpcResult] = useState<string | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [rpcLoading, setRpcLoading] = useState(false);
  const [rpcHistory, setRpcHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('gw_rpcHistory') || '[]'); } catch { return []; }
  });
  const [debugStatus, setDebugStatus] = useState<any>(null);
  const [debugHealth, setDebugHealth] = useState<any>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventRisk, setEventRisk] = useState<'all' | 'low' | 'medium' | 'high' | 'critical'>('all');
  const [eventKeyword, setEventKeyword] = useState('');
  const [eventType, setEventType] = useState<'all' | 'activity' | 'alert'>('all');
  const [eventSource, setEventSource] = useState('all');
  const [eventPage, setEventPage] = useState(1);
  const [eventTotal, setEventTotal] = useState(0);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());
  const [presetExceptionFilter, setPresetExceptionFilter] = useState(false);

  // System Event
  const [sysEventText, setSysEventText] = useState('');
  const [sysEventSending, setSysEventSending] = useState(false);
  const [sysEventResult, setSysEventResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Channel 健康监控
  const [channelsList, setChannelsList] = useState<any[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelLogoutLoading, setChannelLogoutLoading] = useState<string | null>(null);

  const fetchChannels = useCallback((force = false) => {
    setChannelsLoading(true);
    gwApi.channels().then((data: any) => {
      let list: any[] = [];
      if (Array.isArray(data)) {
        list = data;
      } else if (data?.channelAccounts && typeof data.channelAccounts === 'object') {
        // channels.status RPC returns { channelAccounts: { channelId: [account, ...] } }
        for (const [channelId, accounts] of Object.entries(data.channelAccounts)) {
          if (Array.isArray(accounts)) {
            for (const acc of accounts) {
              list.push({ ...acc, name: acc.name || acc.label || channelId, channel: channelId });
            }
          }
        }
      } else if (Array.isArray(data?.channels)) {
        list = data.channels;
      }
      setChannelsList(list);
    }).catch(() => {
      setChannelsList([]);
    }).finally(() => setChannelsLoading(false));
  }, []);

  const handleChannelLogout = useCallback(async (channel: string) => {
    if (!(await confirm({
      title: gw.channelLogout || 'Logout',
      message: gw.channelLogoutConfirm || 'Logout from this channel?',
      confirmText: gw.channelLogout || 'Logout',
      cancelText: gw.cancel || 'Cancel',
      danger: true,
    }))) return;
    setChannelLogoutLoading(channel);
    try {
      await gwApi.channelsLogout(channel);
      toast('success', gw.channelLoggedOut || 'Logged out');
      fetchChannels(true);
    } catch {
      toast('error', gw.channelLogoutFailed || 'Logout failed');
    } finally {
      setChannelLogoutLoading(null);
    }
  }, [confirm, toast, gw, fetchChannels]);

  // 网关配置档案
  const [profiles, setProfiles] = useState<GatewayProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [editingProfile, setEditingProfile] = useState<GatewayProfile | null>(null);
  const [formData, setFormData] = useState({ name: '', host: '127.0.0.1', port: 18789, token: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // 看门狗
  const [healthCheckEnabled, setHealthCheckEnabled] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{ fail_count: number; last_ok: string } | null>(null);
  const [displayUptimeMs, setDisplayUptimeMs] = useState(0);
  const [watchdogIntervalSec, setWatchdogIntervalSec] = useState('30');
  const [watchdogMaxFails, setWatchdogMaxFails] = useState('3');
  const [watchdogBackoffCapMs, setWatchdogBackoffCapMs] = useState('30000');
  const [watchdogAdvancedOpen, setWatchdogAdvancedOpen] = useState(false);
  const [watchdogSaving, setWatchdogSaving] = useState(false);

  // WebSocket 连接状态（用于 tab 标题指示灯）
  const [gwWsConnected, setGwWsConnected] = useState<boolean | null>(null);

  // 按钮操作状态
  const [actionLoading, setActionLoading] = useState<string | null>(null);




  // 支持从仪表盘跳转时预设事件筛选
  useEffect(() => {
    const handler = (evt: Event) => {
      const ce = evt as CustomEvent<OpenWindowDetail>;
      const detail = ce?.detail;
      if (!detail || detail.id !== 'gateway') return;

      if (detail.tab) setActiveTab(detail.tab);
      if (detail.eventRisk) setEventRisk(detail.eventRisk);
      if (detail.eventType) setEventType(detail.eventType);
      if (detail.eventSource) setEventSource(detail.eventSource);
      if (typeof detail.eventKeyword === 'string') setEventKeyword(detail.eventKeyword);
      const hasPreset = detail.tab === 'events' || detail.eventRisk || detail.eventType || detail.eventSource || typeof detail.eventKeyword === 'string';
      if (hasPreset) {
        setEventPage(1);
        setPresetExceptionFilter(true);
      }
    };

    window.addEventListener('clawdeck:open-window', handler as EventListener);
    return () => window.removeEventListener('clawdeck:open-window', handler as EventListener);
  }, []);

  // 获取网关配置列表
  const fetchProfiles = useCallback((force = false) => {
    setProfilesLoading(true);
    gatewayProfileApi.listCached(15000, force).then((data: any) => {
      setProfiles(Array.isArray(data) ? data : []);
    }).catch(() => {}).finally(() => setProfilesLoading(false));
  }, []);

  const fetchStatus = useCallback((force = false) => {
    gatewayApi.statusCached(6000, force).then((data: any) => {
      setStatus((prev: any) => {
        // Detect running state changes for toast
        if (prev && prev.running !== data?.running) {
          if (data?.running) toast('success', gw.stateStarted || 'Gateway started');
          else toast('error', gw.stateStopped || 'Gateway stopped');
        }
        return data;
      });
    }).catch(() => {
      setStatus({ running: false, runtime: '', detail: '' });
    });
  }, [toast, gw]);

  const fetchLogs = useCallback((force = false) => {
    const isInitial = !logInitializedRef.current;
    const params: { cursor?: number; limit?: number; maxBytes?: number } = {
      limit: isInitial ? logLimit : 500,
    };
    if (!isInitial && logCursorRef.current != null) {
      params.cursor = logCursorRef.current;
    }
    gatewayApi.logTail(params).then((res) => {
      if (!res) return;
      const newLines = Array.isArray(res.lines) ? res.lines : [];
      if (typeof res.cursor === 'number') {
        logCursorRef.current = res.cursor;
      }
      if (isInitial || res.reset) {
        // First fetch or log file rotated: replace all lines
        logInitializedRef.current = true;
        setLogs(newLines);
      } else if (newLines.length > 0) {
        // Incremental: append new lines, cap at logLimit
        setLogs(prev => {
          const merged = [...prev, ...newLines];
          return merged.length > logLimit ? merged.slice(merged.length - logLimit) : merged;
        });
      }
    }).catch(() => {
      // Fallback: if logTail not available, use legacy full fetch
      if (isInitial) {
        gatewayApi.logCached(logLimit, 5000, force).then((res: any) => {
          let lines: string[] = [];
          if (res && Array.isArray(res.lines)) lines = res.lines;
          else if (res && Array.isArray(res)) lines = res;
          logInitializedRef.current = true;
          setLogs(lines);
        }).catch(() => {});
      }
    });
  }, [logLimit]);

  const fetchHealthCheck = useCallback((force = false) => {
    gatewayApi.getHealthCheckCached(6000, force).then((data: any) => {
      setHealthCheckEnabled(!!data?.enabled);
      setHealthStatus({ fail_count: data?.fail_count || 0, last_ok: data?.last_ok || '' });
      setWatchdogIntervalSec(String(data?.interval_sec ?? 30));
      setWatchdogMaxFails(String(data?.max_fails ?? 3));
      setWatchdogBackoffCapMs(String(data?.reconnect_backoff_cap_ms ?? 30000));
    }).catch(() => {});
  }, []);

  const fetchEvents = useCallback(async (page?: number) => {
    setEventsLoading(true);
    try {
      const p = page ?? eventPage;
      const data = await eventsApi.list({
        page: p,
        page_size: 50,
        risk: eventRisk,
        type: eventType,
        source: eventSource,
        keyword: eventKeyword.trim() || undefined,
      });
      setEvents(Array.isArray(data?.list) ? data.list : []);
      setEventTotal(data?.total || 0);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [eventKeyword, eventRisk, eventSource, eventType, eventPage]);

  // 初始加载 + 定时轮询（状态、日志、心跳全部轮询）
  useEffect(() => {
    if (!hasStartedInitialDetectingRef.current) {
      hasStartedInitialDetectingRef.current = true;
      setInitialDetecting(true);
      Promise.allSettled([
        Promise.resolve(fetchProfiles()),
        Promise.resolve(fetchStatus()),
        Promise.resolve(fetchHealthCheck()),
        Promise.resolve(fetchChannels()),
      ]).finally(() => {
        setInitialDetecting(false);
      });
    } else {
      fetchProfiles();
      fetchStatus();
      fetchHealthCheck();
      fetchChannels();
    }
    const deferTimer = setTimeout(() => {
      fetchLogs();
      if (activeTab === 'events') fetchEvents();
    }, 0);
    return () => clearTimeout(deferTimer);
  }, [fetchProfiles, fetchStatus, fetchHealthCheck, fetchLogs, fetchEvents, fetchChannels, activeTab]);

  // WS connection status polling + disconnect/reconnect toast + gateway uptime
  useEffect(() => {
    const pollWs = () => {
      gwApi.status().then((data: any) => {
        const connected = !!data?.connected;
        setGwWsConnected(prev => {
          if (prev !== null && prev !== connected) {
            if (connected) toast('success', gw.svcWsReconnected || 'WebSocket reconnected');
            else toast('error', gw.svcWsLost || 'WebSocket disconnected');
          }
          return connected;
        });
        // Gateway uptime from backend (auto-incremented server-side)
        const upMs = data?.gateway_uptime_ms || 0;
        setDisplayUptimeMs(upMs);
      }).catch(() => {});
    };
    pollWs();
    const wsTimer = setInterval(pollWs, 6000);
    return () => clearInterval(wsTimer);
  }, [toast, gw]);

  // Status + health polling with visibility pause
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
      fetchStatus();
      fetchHealthCheck();
    }, 8000);
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) { clearInterval(timer); timer = null; }
      } else {
        if (!timer) {
          timer = setInterval(() => { fetchStatus(); fetchHealthCheck(); }, 8000);
          fetchStatus(); fetchHealthCheck();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchStatus, fetchHealthCheck]);


  // Log polling with visibility pause (cursor-based incremental, 3s interval)
  useEffect(() => {
    if (activeTab !== 'logs') return;
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => fetchLogs(), 5000);
    const onVis = () => {
      if (document.hidden) { if (timer) { clearInterval(timer); timer = null; } }
      else if (!timer) { timer = setInterval(() => fetchLogs(), 5000); fetchLogs(); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [activeTab, fetchLogs]);

  // Event polling with visibility pause
  useEffect(() => {
    if (activeTab !== 'events') return;
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => fetchEvents(), 10000);
    const onVis = () => {
      if (document.hidden) { if (timer) { clearInterval(timer); timer = null; } }
      else if (!timer) { timer = setInterval(() => fetchEvents(), 10000); fetchEvents(); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => { if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [activeTab, fetchEvents]);


  // Real-time gateway events via WebSocket
  useGatewayEvents({
    health: () => { fetchStatus(true); fetchHealthCheck(true); fetchChannels(true); },
    shutdown: () => { fetchStatus(true); },
    cron: () => { if (activeTab === 'events') fetchEvents(); },
  });

  // 刷新所有状态
  const refreshAll = useCallback((force = false) => {
    fetchProfiles(force);
    fetchStatus(force);
    fetchHealthCheck(force);
    fetchChannels(force);
    if (activeTab === 'logs') { logCursorRef.current = undefined; logInitializedRef.current = false; fetchLogs(force); }
    if (activeTab === 'events') fetchEvents();
  }, [activeTab, fetchProfiles, fetchStatus, fetchLogs, fetchHealthCheck, fetchEvents, fetchChannels]);

  const actionLabels: Record<string, string> = {
    start: gw.start, stop: gw.stop, restart: gw.restart, kill: gw.kill || 'Kill',
  };

  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'kill') => {
    // Confirm for destructive actions
    if (action === 'stop' || action === 'restart' || action === 'kill') {
      const ok = await confirm({
        title: actionLabels[action],
        message: action === 'kill' ? (gw.confirmKill || 'Force kill the gateway process?') : `${gw.confirmAction || 'Confirm'} ${actionLabels[action]}?`,
        danger: action === 'kill',
        confirmText: actionLabels[action],
      });
      if (!ok) return;
    }
    setActionLoading(action);
    try {
      const result = await (gatewayApi as any)[action]();
      if (action === 'restart') {
        const durationMs = result?.observability?.duration_ms;
        const detail = result?.observability?.after?.detail || result?.observability?.before?.detail;
        const parts: string[] = [`${actionLabels[action]} ${gw.ok}`];
        if (typeof durationMs === 'number' && durationMs >= 0) parts.push(`${durationMs}ms`);
        if (detail) parts.push(String(detail));
        toast('success', parts.join(' · '));
      } else {
        toast('success', `${actionLabels[action]} ${gw.ok}`);
      }
      setTimeout(() => refreshAll(true), 1000);
      setTimeout(() => refreshAll(true), 3000);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (action === 'restart') {
        toast('error', `${actionLabels[action]} ${gw.failed}: ${msg}. ${gw.diagnose || 'Diagnose'}?`);
      } else {
        toast('error', `${actionLabels[action]} ${gw.failed}: ${msg}`);
      }
    } finally {
      setTimeout(() => setActionLoading(null), 1500);
    }
  };


  // 网关配置 CRUD — with validation
  const validateForm = useCallback(() => {
    const errs: Record<string, string> = {};
    if (!formData.name.trim()) errs.name = gw.required || 'Required';
    if (!formData.host.trim()) errs.host = gw.required || 'Required';
    if (formData.port < 1 || formData.port > 65535) errs.port = gw.portRange || '1-65535';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }, [formData, gw]);

  const handleSaveProfile = async () => {
    if (!validateForm()) return;
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
      setFormErrors({});
      setShowProfilePanel(false);
      toast('success', gw.profileSaved);
    } catch (err: any) {
      toast('error', err?.message || gw.saveFailed);
    } finally { setSaving(false); }
  };

  const handleDeleteProfile = async (id: number) => {
    const ok = await confirm({ title: gw.deleteProfile || gw.delete || 'Delete', message: gw.confirmDelete, danger: true });
    if (!ok) return;
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

  // Connection test — via backend proxy to avoid CORS issues with remote gateways
  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true);
    try {
      const res = await gatewayProfileApi.testConnection({ host: formData.host, port: formData.port, token: formData.token }) as any;
      const data = res?.data || res;
      if (data?.http && data?.ws) {
        toast('success', gw.connectionOk || 'Connection OK');
      } else if (data?.http && !data?.ws) {
        toast('warning', gw.connectionHttpOnlyWarn || 'HTTP OK but WebSocket failed — logs/dashboard may not work');
      } else if (!data?.http && data?.ws) {
        toast('success', gw.connectionOk || 'Connection OK');
      } else {
        toast('success', gw.connectionOk || 'Connection OK');
      }
    } catch { toast('error', gw.connectionFailed || 'Connection failed'); }
    setTestingConnection(false);
  }, [formData, toast, gw]);

  const openEditForm = (p: GatewayProfile) => {
    setEditingProfile(p);
    setFormData({ name: p.name, host: p.host, port: p.port, token: p.token });
    setFormErrors({});
    setShowProfilePanel(true);
  };

  const openAddForm = () => {
    setEditingProfile(null);
    setFormData({ name: '', host: '127.0.0.1', port: 18789, token: '' });
    setFormErrors({});
    setShowProfilePanel(true);
  };

  // Toggle watchdog
  const toggleHealthCheck = useCallback(async () => {
    try {
      const intervalSec = Number.parseInt(watchdogIntervalSec, 10);
      const maxFails = Number.parseInt(watchdogMaxFails, 10);
      const backoffCapMs = Number.parseInt(watchdogBackoffCapMs, 10);
      await gatewayApi.setHealthCheck({
        enabled: !healthCheckEnabled,
        interval_sec: Number.isFinite(intervalSec) ? intervalSec : 30,
        max_fails: Number.isFinite(maxFails) ? maxFails : 3,
        reconnect_backoff_cap_ms: Number.isFinite(backoffCapMs) ? backoffCapMs : 30000,
      });
      setHealthCheckEnabled(!healthCheckEnabled);
      toast('success', gw.patchOk || 'Saved');
    } catch (err: any) { toast('error', err?.message || ''); }
  }, [healthCheckEnabled, watchdogIntervalSec, watchdogMaxFails, watchdogBackoffCapMs, toast, gw]);

  const saveWatchdogAdvanced = useCallback(async () => {
    const intervalSec = Number.parseInt(watchdogIntervalSec, 10);
    const maxFails = Number.parseInt(watchdogMaxFails, 10);
    const backoffCapMs = Number.parseInt(watchdogBackoffCapMs, 10);

    if (!Number.isFinite(intervalSec) || intervalSec < 5 || intervalSec > 300) {
      toast('error', gw.watchdogIntervalInvalid || 'Interval must be between 5 and 300 seconds');
      return;
    }
    if (!Number.isFinite(maxFails) || maxFails < 1 || maxFails > 20) {
      toast('error', gw.watchdogMaxFailsInvalid || 'Max fails must be between 1 and 20');
      return;
    }
    if (!Number.isFinite(backoffCapMs) || backoffCapMs < 1000 || backoffCapMs > 120000) {
      toast('error', gw.watchdogBackoffInvalid || 'Backoff cap must be between 1000 and 120000 ms');
      return;
    }

    setWatchdogSaving(true);
    try {
      const data: any = await gatewayApi.setHealthCheck({
        enabled: healthCheckEnabled,
        interval_sec: intervalSec,
        max_fails: maxFails,
        reconnect_backoff_cap_ms: backoffCapMs,
      });
      setWatchdogIntervalSec(String(data?.interval_sec ?? intervalSec));
      setWatchdogMaxFails(String(data?.max_fails ?? maxFails));
      setWatchdogBackoffCapMs(String(data?.reconnect_backoff_cap_ms ?? backoffCapMs));
      setHealthCheckEnabled(!!data?.enabled);
      toast('success', gw.patchOk || 'Saved');
    } catch (err: any) {
      toast('error', err?.message || '');
    } finally {
      setWatchdogSaving(false);
    }
  }, [healthCheckEnabled, watchdogIntervalSec, watchdogMaxFails, watchdogBackoffCapMs, toast, gw]);

  // System Event — extracted to avoid duplicate code
  const handleSendSystemEvent = useCallback(async () => {
    if (!sysEventText.trim() || sysEventSending) return;
    setSysEventSending(true); setSysEventResult(null);
    try {
      await gwApi.systemEvent(sysEventText.trim());
      setSysEventResult({ ok: true, text: gw.systemEventOk });
      setSysEventText('');
      setTimeout(() => setSysEventResult(null), 3000);
    } catch (err: any) {
      setSysEventResult({ ok: false, text: gw.systemEventFailed + ': ' + (err?.message || '') });
    }
    setSysEventSending(false);
  }, [sysEventText, sysEventSending, gw]);

  // Copy log line
  const copyLogLine = useCallback((text: string) => {
    copyToClipboard(text).then(() => toast('success', gw.copied || 'Copied')).catch(() => {});
  }, [toast, gw]);

  // Export events CSV
  const exportEvents = useCallback(() => {
    const header = 'id,type,risk,source,category,title,detail,timestamp\n';
    const rows = events.map((ev: any) =>
      [ev.id || '', ev.type || '', ev.risk || '', ev.source || '', ev.category || '',
       `"${(ev.title || ev.summary || '').replace(/"/g, '""')}"`, `"${(ev.detail || '').replace(/"/g, '""')}"`,
       ev.timestamp || ev.created_at || ''].join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `events-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click(); URL.revokeObjectURL(url);
  }, [events]);

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
      // Save to history
      setRpcHistory(prev => {
        const m = rpcMethod.trim();
        const next = [m, ...prev.filter(h => h !== m)].slice(0, 20);
        try { localStorage.setItem('gw_rpcHistory', JSON.stringify(next)); } catch {}
        return next;
      });
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

  const activeProfile = useMemo(() => profiles.find(p => p.is_active) || null, [profiles]);

  const isLocal = (host: string) => ['127.0.0.1', 'localhost', '::1'].includes(host.trim());

  const fmtUptime = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}${gw.unitSec}`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}${gw.unitMin}`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}${gw.unitHr} ${m % 60}${gw.unitMin}`;
    const d = Math.floor(h / 24);
    return `${d}${gw.unitDay} ${h % 24}${gw.unitHr}`;
  };

  // 解析 JSON 格式日志行（tslog / zerolog / pino 等）
  const parseLogLine = useCallback((line: string): { time: string; level: string; message: string; component?: string; extra?: string } | null => {
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
  }, []);

  const parsedLogEntries = useMemo(() => {
    return visibleLogs.map((line) => ({ line, parsed: parseLogLine(line) }));
  }, [visibleLogs, parseLogLine]);

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

  // Log level stats for status bar
  const logStats = useMemo(() => {
    let errors = 0, warns = 0;
    parsedLogEntries.forEach(({ parsed }) => {
      if (!parsed) return;
      const lvl = parsed.level.toLowerCase();
      if (lvl === 'error' || lvl === 'fatal') errors++;
      else if (lvl === 'warn') warns++;
    });
    return { errors, warns };
  }, [parsedLogEntries]);

  // Limit rendered DOM rows to keep logs tab responsive.
  const renderedLogs = useMemo(() => filteredLogs.slice(-300), [filteredLogs]);
  const omittedLogCount = Math.max(0, filteredLogs.length - renderedLogs.length);

  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (autoFollow) logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [filteredLogs, autoFollow]);
  useEffect(() => {
    if (activeTab === 'events') fetchEvents();
  }, [activeTab, eventRisk, eventType, eventSource, eventKeyword, fetchEvents]);

  const eventsLabel = gw.events;

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
                {/* 状态指示 + WS + 远程/本地 + 进程 */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${p.is_active && status?.running ? 'bg-mac-green animate-pulse' : p.is_active ? 'bg-mac-yellow animate-pulse' : 'bg-slate-300 dark:bg-white/20'}`}></div>
                    <span className={`text-[11px] font-bold uppercase ${p.is_active && status?.running ? 'text-mac-green' : p.is_active ? 'text-mac-yellow' : 'text-slate-400 dark:text-white/40'}`}>
                      {p.is_active ? (status?.running ? gw.running : gw.stopped) : gw.inactive}
                    </span>
                    {p.is_active && status?.running && gwWsConnected !== null && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5 ${gwWsConnected ? 'bg-mac-green/10 text-mac-green' : 'bg-mac-red/10 text-mac-red'}`}>
                        <span className={`w-1 h-1 rounded-full ${gwWsConnected ? 'bg-mac-green' : 'bg-mac-red'}`} />
                        WS
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      isLocal(p.host)
                        ? 'bg-blue-500/10 text-blue-500'
                        : 'bg-purple-500/10 text-purple-500'
                    }`}>
                      {isLocal(p.host) ? gw.local : gw.remote}
                    </span>
                    {p.is_active && status?.running && status?.runtime && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/35">{(gw as any)[`runtime${status.runtime.charAt(0).toUpperCase()}${status.runtime.slice(1)}`] || status.runtime}</span>
                    )}
                  </div>
                </div>
                {/* 名称 */}
                <div className="flex items-center gap-1.5">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-white truncate">{isLocal(p.host) && (p.name === 'Local Gateway' || p.name === '本地网关') ? (gw.localGateway || p.name) : p.name}</h4>
                  {p.is_active && status?.running && displayUptimeMs > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-mac-green font-mono font-bold">{fmtUptime(displayUptimeMs)}</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 dark:text-white/40 font-mono mt-0.5 truncate">{p.host}:{p.port}</p>
                {/* 操作按钮 */}
                <div className="absolute top-2 end-2 hidden group-hover:flex items-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditForm(p); }}
                    className="w-5 h-5 rounded flex items-center justify-center bg-slate-200/80 dark:bg-white/10 hover:bg-primary/20 text-slate-500 dark:text-white/50 hover:text-primary transition-all"
                  >
                    <span className="material-symbols-outlined text-[12px]">edit</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteProfile(p.id); }}
                    className="w-5 h-5 rounded flex items-center justify-center bg-slate-200/80 dark:bg-white/10 hover:bg-mac-red/20 text-slate-500 dark:text-white/50 hover:text-mac-red transition-all"
                  >
                    <span className="material-symbols-outlined text-[12px]">close</span>
                  </button>
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
                    onChange={e => {
                      let v = e.target.value;
                      v = v.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
                      setFormData(f => ({ ...f, host: v }));
                    }}
                    placeholder={gw.hostPlaceholder}
                    className={`w-full h-9 px-3 bg-slate-100 dark:bg-black/20 border rounded-lg text-sm font-mono text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary outline-none transition-all ${formErrors.host ? 'border-mac-red' : 'border-slate-200 dark:border-white/10'}`}
                  />
                  {formErrors.host && <p className="text-[10px] text-mac-red mt-0.5">{formErrors.host}</p>}
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1 block">{gw.gwPort}</label>
                  <NumberStepper
                    min={1}
                    max={65535}
                    step={1}
                    value={formData.port}
                    onChange={v => setFormData(f => {
                      const n = Number(v);
                      if (Number.isNaN(n)) return { ...f, port: 18789 };
                      return { ...f, port: Math.max(1, Math.min(65535, Math.round(n))) };
                    })}
                    className={`w-full h-9 ${formErrors.port ? 'border-mac-red' : 'border-slate-200 dark:border-white/10'}`}
                    inputClassName="text-sm font-mono"
                  />
                  {formErrors.port && <p className="text-[10px] text-mac-red mt-0.5">{formErrors.port}</p>}
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
            <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50 dark:bg-white/[0.02]">
              <button onClick={handleTestConnection} disabled={testingConnection || !formData.host.trim()}
                className="px-3 py-1.5 text-xs font-bold text-slate-500 dark:text-white/50 hover:text-primary border border-slate-200 dark:border-white/10 rounded-lg transition-all disabled:opacity-40 flex items-center gap-1">
                <span className={`material-symbols-outlined text-[14px] ${testingConnection ? 'animate-spin' : ''}`}>{testingConnection ? 'progress_activity' : 'cable'}</span>
                {gw.testConnection || 'Test'}
              </button>
              <div className="flex items-center gap-2">
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
        </div>
      )}

      {/* 状态与控制区 — 紧凑布局 */}
      <div className="px-3 md:px-4 py-2 md:py-3 border-b border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01] shrink-0 space-y-2">
        {initialDetecting && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-primary animate-spin">progress_activity</span>
            <span className="text-[11px] font-medium text-slate-600 dark:text-white/60">{gw.detecting || gw.loading}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          </div>
        )}
        {/* 远程网关 WS 数据通道未连接提示 */}
        {!initialDetecting && status?.running && status?.remote && !status?.ws_connected && (
          <div className="rounded-xl border border-mac-yellow/30 bg-mac-yellow/5 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-mac-yellow">warning</span>
              <span className="text-[11px] font-bold text-mac-yellow">{gw.wsDisconnected || 'Data channel disconnected'}</span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-white/40 mt-1 ms-6 leading-relaxed">{gw.wsDisconnectedHint || 'WebSocket data channel is not established. Check token, firewall, and proxy settings.'}</p>
            {status?.ws_error && (
              <p className="text-[10px] text-mac-red/80 mt-1 ms-6 font-mono break-all">{status.ws_error}</p>
            )}
          </div>
        )}
        {/* Row 1: 状态信息 + 心跳 */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center text-primary border border-primary/20 shrink-0 animate-glow-breathe">
            <span className="material-symbols-outlined text-[20px]">router</span>
          </div>
          <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
            <h3 className="text-slate-800 dark:text-white font-bold text-sm">{activeProfile ? (isLocal(activeProfile.host) && (activeProfile.name === 'Local Gateway' || activeProfile.name === '本地网关') ? (gw.localGateway || activeProfile.name) : activeProfile.name) : gw.status}</h3>
            {/* 看门狗探测状态 */}
            {status?.running && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]">
                {(() => {
                  if (!healthStatus?.last_ok) return <><span className="material-symbols-outlined text-[12px] text-mac-yellow animate-spin">progress_activity</span><span className="text-[11px] text-slate-400 dark:text-white/40">{gw.hbProbing}</span></>;
                  if (healthStatus.fail_count > 0) return <><span className="material-symbols-outlined text-[12px] text-mac-red">heart_broken</span><span className="text-[11px] font-bold text-mac-red">{gw.hbUnhealthy} ({healthStatus.fail_count})</span></>;
                  return <><span className="material-symbols-outlined text-[12px] text-mac-green animate-pulse">favorite</span><span className="text-[11px] font-bold text-mac-green">{gw.hbHealthy}</span></>;
                })()}
              </div>
            )}
          </div>
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
                <span className={`material-symbols-outlined text-[14px] ${actionLoading === 'restart' ? 'animate-spin' : ''}`}>{actionLoading === 'restart' ? 'progress_activity' : 'refresh'}</span>{gw.restart}
              </button>
              <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-0.5" />
              {/* Watchdog toggle */}
              <button onClick={toggleHealthCheck} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${healthCheckEnabled ? 'bg-mac-green/10 text-mac-green' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                <span className="material-symbols-outlined text-[14px]">{healthCheckEnabled ? 'monitor_heart' : 'heart_minus'}</span>
                {gw.healthCheck || 'Watchdog'}
              </button>
              <button
                onClick={() => setWatchdogAdvancedOpen(v => !v)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${watchdogAdvancedOpen ? 'bg-primary/15 text-primary' : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/50'}`}
              >
                <span className="material-symbols-outlined text-[14px]">tune</span>
                {gw.watchdogAdvanced || 'Advanced'}
              </button>
            </div>
          );
        })()}
        {watchdogAdvancedOpen && (
          <div className="mt-1 rounded-lg border border-slate-200 dark:border-white/10 bg-white/70 dark:bg-white/[0.02] p-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <label className="text-[10px] text-slate-500 dark:text-white/50">
                {gw.watchdogInterval || 'Interval(s)'}
                <NumberStepper
                  value={watchdogIntervalSec}
                  onChange={setWatchdogIntervalSec}
                  min={5}
                  max={300}
                  step={1}
                  className="mt-1 h-7 max-w-[180px]"
                  inputClassName="text-[10px] px-1"
                  buttonClassName="!w-6 text-[11px]"
                />
              </label>
              <label className="text-[10px] text-slate-500 dark:text-white/50">
                {gw.watchdogMaxFails || 'Max fails'}
                <NumberStepper
                  value={watchdogMaxFails}
                  onChange={setWatchdogMaxFails}
                  min={1}
                  max={20}
                  step={1}
                  className="mt-1 h-7 max-w-[180px]"
                  inputClassName="text-[10px] px-1"
                  buttonClassName="!w-6 text-[11px]"
                />
              </label>
              <label className="text-[10px] text-slate-500 dark:text-white/50">
                {gw.watchdogBackoffCap || 'Backoff cap(ms)'}
                <NumberStepper
                  value={watchdogBackoffCapMs}
                  onChange={setWatchdogBackoffCapMs}
                  min={1000}
                  max={120000}
                  step={1000}
                  className="mt-1 h-7 max-w-[180px]"
                  inputClassName="text-[10px] px-1"
                  buttonClassName="!w-6 text-[11px]"
                />
              </label>
            </div>
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setWatchdogIntervalSec('30');
                  setWatchdogMaxFails('3');
                  setWatchdogBackoffCapMs('30000');
                }}
                className="px-2 py-1 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/60"
              >
                {gw.watchdogResetDefaults || 'Defaults'}
              </button>
              <button
                onClick={() => { void saveWatchdogAdvanced(); }}
                disabled={watchdogSaving}
                className="px-2 py-1 rounded text-[10px] font-bold bg-primary text-white disabled:opacity-50"
              >
                {watchdogSaving ? (gw.saving || 'Saving...') : (gw.watchdogApply || gw.save || 'Apply')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 日志 & 调试区 */}
      <div className="flex-1 flex flex-col bg-slate-900 dark:bg-[#0a0f14] border-t border-slate-200 dark:border-white/10 overflow-hidden sci-card">
        {/* Tab Bar + Search + Filters — 单行紧凑 */}
        <div className="shrink-0 min-h-9 flex items-center gap-1.5 px-3 bg-white/5 border-b border-white/5 overflow-x-auto scrollbar-none">
          {/* Tabs */}
          {(['logs', 'events', 'channels', 'service', 'debug'] as const).map(tab => {
            const icons: Record<string, string> = { logs: 'terminal', events: 'event_note', channels: 'cell_tower', service: 'settings_system_daydream', debug: 'bug_report' };
            const labels: Record<string, string> = { logs: gw.logs, events: eventsLabel, channels: gw.channels || 'Channels', service: gw.service || 'Service', debug: gw.debug };
            return (
              <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'debug') fetchDebugData(); if (tab === 'events') fetchEvents(); if (tab === 'channels') fetchChannels(true); }}
                className={`px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 ${activeTab === tab ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60'} flex items-center gap-1`}>
                <span className="material-symbols-outlined text-[12px] align-middle">{icons[tab]}</span>
                {labels[tab]}
                {tab === 'service' && gwWsConnected !== null && (
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${gwWsConnected ? 'bg-mac-green' : 'bg-mac-red animate-pulse'}`} />
                )}
                {tab === 'channels' && channelsList.length > 0 && (() => {
                  const now = Date.now();
                  const hasStuck = channelsList.some((c: any) => {
                    const busy = c.busy === true || (typeof c.activeRuns === 'number' && c.activeRuns > 0);
                    const lra = typeof c.lastRunActivityAt === 'number' ? c.lastRunActivityAt : null;
                    return busy && lra != null && (now - lra) > 25 * 60_000;
                  });
                  const hasDisconnected = channelsList.some((c: any) => c.enabled !== false && (c.lastError || c.connected === false) && c.running !== true);
                  if (!hasStuck && !hasDisconnected) return null;
                  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasStuck ? 'bg-mac-red animate-pulse' : 'bg-amber-500'}`} />;
                })()}
              </button>
            );
          })}

          {activeTab === 'logs' && (
            <>
              {/* Divider */}
              <div className="w-px h-4 bg-white/10 mx-0.5" />
              {/* Search */}
              <div className="relative flex-1 min-w-[100px] max-w-[200px]">
                <span className="material-symbols-outlined absolute start-1.5 top-1/2 -translate-y-1/2 text-white/20 text-[12px]">search</span>
                <input value={logSearch} onChange={e => setLogSearch(e.target.value)} placeholder={gw.search}
                  className="w-full h-6 ps-6 pe-2 bg-white/5 border border-white/5 rounded text-[11px] text-white/80 placeholder:text-white/20 focus:ring-1 focus:ring-primary/50 outline-none sci-input" />
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
              {/* Log limit switcher */}
              <div className="w-px h-4 bg-white/10 mx-0.5" />
              <div className="flex items-center gap-px">
                {[120, 500, 1000].map(n => (
                  <button key={n} onClick={() => { setLogLimit(n); logCursorRef.current = undefined; logInitializedRef.current = false; fetchLogs(true); }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${logLimit === n ? 'bg-white/10 text-white/70' : 'bg-white/5 text-white/15 hover:text-white/40'}`}>{n}</button>
                ))}
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
            <div className="flex-1 overflow-y-auto font-mono text-[11px] md:text-[12px] p-4 custom-scrollbar neon-scrollbar">
              {filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-white/15">
                  <span className="material-symbols-outlined text-[32px] mb-2">terminal</span>
                  <span className="text-[10px]">{gw.noLogs}</span>
                </div>
              ) : renderedLogs.map(({ line: log, parsed }, idx) => {
                const lineNum = omittedLogCount + idx + 1;
                const needle = logSearch.trim().toLowerCase();
                const highlightText = (text: string) => {
                  if (!needle || !text) return text;
                  const i = text.toLowerCase().indexOf(needle);
                  if (i === -1) return text;
                  return <>{text.slice(0, i)}<mark className="bg-yellow-400/30 text-inherit rounded px-0.5">{text.slice(i, i + needle.length)}</mark>{text.slice(i + needle.length)}</>;
                };
                if (!parsed) {
                  return (
                    <div key={idx} className="flex gap-2 md:gap-3 mb-0.5 group leading-relaxed hover:bg-white/[0.02] rounded px-1 -mx-1">
                      <span className="text-white/10 select-none w-6 md:w-8 text-end shrink-0 text-[10px]">{lineNum}</span>
                      <span className={`flex-1 text-white/60 break-all ${log.includes('ERROR') || log.includes('error') ? 'text-red-400' : log.includes('WARN') || log.includes('warn') ? 'text-yellow-400' : ''}`}>{highlightText(log)}</span>
                      <button onClick={() => copyLogLine(log)} className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-white shrink-0 transition-opacity" title="Copy">
                        <span className="material-symbols-outlined text-[12px]">content_copy</span>
                      </button>
                    </div>
                  );
                }
                const lvlColor = parsed.level === 'error' || parsed.level === 'fatal' ? 'text-red-400' : parsed.level === 'warn' ? 'text-yellow-400' : parsed.level === 'debug' || parsed.level === 'trace' ? 'text-white/30' : 'text-white/60';
                const lvlBg = parsed.level === 'error' || parsed.level === 'fatal' ? 'bg-red-500/15' : parsed.level === 'warn' ? 'bg-yellow-500/15' : parsed.level === 'info' ? 'bg-blue-500/10' : 'bg-white/5';
                const hasLongExtra = parsed.extra && parsed.extra.length > 80;
                const isExtraExpanded = expandedExtras.has(idx);
                return (
                  <div key={idx} className="flex gap-2 md:gap-3 mb-0.5 group leading-relaxed hover:bg-white/[0.02] rounded px-1 -mx-1">
                    <span className="text-white/10 select-none w-6 md:w-8 text-end shrink-0 text-[10px]">{lineNum}</span>
                    <div className="flex-1 break-all">
                      {parsed.time && <span className="text-cyan-400/50 me-2">{parsed.time}</span>}
                      <span className={`inline-block px-1 rounded text-[11px] font-bold uppercase me-2 ${lvlColor} ${lvlBg}`}>{parsed.level}</span>
                      {parsed.component && <span className="text-purple-400/60 me-2">[{parsed.component}]</span>}
                      <span className={lvlColor}>{highlightText(parsed.message)}</span>
                      {parsed.extra && (
                        hasLongExtra && !isExtraExpanded ? (
                          <button onClick={() => setExpandedExtras(prev => { const n = new Set(prev); n.add(idx); return n; })}
                            className="text-white/20 ms-2 text-[10px] hover:text-white/40">{parsed.extra.slice(0, 80)}… <span className="text-primary/50">▸</span></button>
                        ) : (
                          <span className="text-white/20 ms-2 text-[10px]">{parsed.extra}
                            {hasLongExtra && <button onClick={() => setExpandedExtras(prev => { const n = new Set(prev); n.delete(idx); return n; })} className="text-primary/50 ms-1">▾</button>}
                          </span>
                        )
                      )}
                    </div>
                    <button onClick={() => copyLogLine(log)} className="opacity-0 group-hover:opacity-100 text-white/20 hover:text-white shrink-0 transition-opacity" title="Copy">
                      <span className="material-symbols-outlined text-[12px]">content_copy</span>
                    </button>
                  </div>
                );
              })}
              <div ref={logEndRef} />
            </div>
            <div className="h-7 bg-black/40 px-4 flex items-center justify-between text-[11px] text-white/30 font-bold uppercase shrink-0">
              <div className="flex gap-4">
                <span>{filteredLogs.length}{filteredLogs.length !== visibleLogs.length ? `/${visibleLogs.length}` : ''} {gw.lines}</span>
                {omittedLogCount > 0 && <span>+{omittedLogCount}</span>}
                {logStats.errors > 0 && <span className="text-red-400">{logStats.errors} ERR</span>}
                {logStats.warns > 0 && <span className="text-yellow-400">{logStats.warns} WARN</span>}
                {activeProfile && <span className="text-primary/60">{activeProfile.host}:{activeProfile.port}</span>}
              </div>
              <div className="flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px]">terminal</span>
                <span>{gw.secure}</span>
              </div>
            </div>
          </>
        ) : activeTab === 'events' ? (
          <EventsPanel
            gw={gw} na={na} events={events} eventsLoading={eventsLoading}
            eventRisk={eventRisk} setEventRisk={setEventRisk}
            eventKeyword={eventKeyword} setEventKeyword={setEventKeyword}
            eventType={eventType} setEventType={setEventType}
            eventSource={eventSource} setEventSource={setEventSource}
            eventPage={eventPage} setEventPage={setEventPage} eventTotal={eventTotal}
            expandedEvents={expandedEvents} setExpandedEvents={setExpandedEvents}
            presetExceptionFilter={presetExceptionFilter} setPresetExceptionFilter={setPresetExceptionFilter}
            fetchEvents={fetchEvents} exportEvents={exportEvents}
          />
        ) : activeTab === 'channels' ? (
          <ChannelsPanel
            gw={gw} channelsList={channelsList} channelsLoading={channelsLoading}
            channelLogoutLoading={channelLogoutLoading}
            fetchChannels={fetchChannels} handleChannelLogout={handleChannelLogout}
          />
        ) : activeTab === 'service' ? (
          <ServicePanel
            status={status}
            healthCheckEnabled={healthCheckEnabled}
            healthStatus={healthStatus}
            gw={gw}
            onCopy={(text) => { copyToClipboard(text).then(() => toast('success', gw.serviceCopied || 'Copied')).catch(() => {}); }}
            toast={toast}
            remote={activeProfile ? !isLocal(activeProfile.host) : false}
          />
        ) : (
          <DebugPanel
            gw={gw}
            rpcMethod={rpcMethod} setRpcMethod={setRpcMethod}
            rpcParams={rpcParams} setRpcParams={setRpcParams}
            rpcResult={rpcResult} rpcError={rpcError} rpcLoading={rpcLoading}
            rpcHistory={rpcHistory} handleRpcCall={handleRpcCall}
            sysEventText={sysEventText} setSysEventText={setSysEventText}
            sysEventSending={sysEventSending} sysEventResult={sysEventResult}
            handleSendSystemEvent={handleSendSystemEvent}
            debugStatus={debugStatus} debugHealth={debugHealth}
            debugLoading={debugLoading} fetchDebugData={fetchDebugData}
          />
        )}
      </div>

    </div>
  );
};

export default Gateway;
