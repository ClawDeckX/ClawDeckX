
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Language, OpenWindowDetail } from '../types';
import { getTranslation } from '../locales';
import { eventsApi, gatewayApi, gatewayProfileApi, gwApi, observabilityApi, GatewayObservedState } from '../services/api';
import { useVisibilityPolling } from '../hooks/useVisibilityPolling';
import { settle as settlePromise } from '../utils/settle';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useGatewayEvents } from '../hooks/useGatewayEvents';
import CustomSelect from '../components/CustomSelect';
import NumberStepper from '../components/NumberStepper';
import EventsPanel from './Gateway/EventsPanel';
import OptimizeWizard from './Gateway/OptimizeWizard';
import ChannelsPanel from './Gateway/ChannelsPanel';
import DebugPanel from './Gateway/DebugPanel';
import DreamsPanel from './Gateway/DreamsPanel';
import ServicePanel from './Gateway/ServicePanel';
import { copyToClipboard } from '../utils/clipboard';

interface GatewayProfile {
  id: number;
  name: string;
  host: string;
  port: number;
  path: string;
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
  const [gatewayObservedState, setGatewayObservedState] = useState<GatewayObservedState | null>(null);
  const [initialDetecting, setInitialDetecting] = useState(false);
  const hasStartedInitialDetectingRef = useRef(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [clearTimestamp, setClearTimestamp] = useState<string | null>(null);
  const prevRunningRef = useRef<boolean | null>(null);
  const logCursorRef = useRef<number | undefined>(undefined);
  const logInitializedRef = useRef(false);
  const wsIndicatorRef = useRef<HTMLDivElement>(null);

  // 日志增强
  const [logSearch, setLogSearch] = useState('');
  const [autoFollow, setAutoFollow] = useState(true);
  const [levelFilters, setLevelFilters] = useState<Set<string>>(new Set());
  const [logLimit, setLogLimit] = useState(120);
  const [expandedExtras, setExpandedExtras] = useState<Set<number>>(new Set());

  // Debug 面板
  const [activeTab, setActiveTab] = useState<'logs' | 'events' | 'debug' | 'channels' | 'service' | 'dreams'>('logs');
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
  const [channelStopLoading, setChannelStopLoading] = useState<string | null>(null);

  const fetchChannels = useCallback((force = false) => {
    setChannelsLoading(true);
    gwApi.channels().then((data: any) => {
      let list: any[] = [];
      if (Array.isArray(data)) {
        list = data;
      } else if (data?.channelAccounts && typeof data.channelAccounts === 'object') {
        // channels.status RPC returns { channelAccounts, channelLabels, channelMeta }
        const labels: Record<string, string> = data.channelLabels || {};
        const meta: any[] = Array.isArray(data.channelMeta) ? data.channelMeta : [];
        for (const [channelId, accounts] of Object.entries(data.channelAccounts)) {
          if (Array.isArray(accounts)) {
            const metaEntry = meta.find((m: any) => m.id === channelId);
            const displayLabel = metaEntry?.label || labels[channelId] || '';
            for (const acc of accounts) {
              list.push({ ...acc, name: acc.name || acc.label || channelId, channel: channelId, displayLabel: acc.displayLabel || displayLabel });
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

  const handleChannelStop = useCallback(async (channel: string) => {
    if (!(await confirm({
      title: gw.channelStop || 'Stop Channel',
      message: gw.channelStopConfirm || 'Gracefully stop this channel? It can be restarted via gateway restart.',
      confirmText: gw.channelStop || 'Stop',
      cancelText: gw.cancel || 'Cancel',
    }))) return;
    setChannelStopLoading(channel);
    try {
      await gwApi.channelsStop(channel);
      toast('success', gw.channelStopped || 'Channel stopped');
      fetchChannels(true);
    } catch {
      toast('error', gw.channelStopFailed || 'Failed to stop channel');
    } finally {
      setChannelStopLoading(null);
    }
  }, [confirm, toast, gw, fetchChannels]);

  // 网关配置档案
  const [profiles, setProfiles] = useState<GatewayProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [editingProfile, setEditingProfile] = useState<GatewayProfile | null>(null);
  const [formData, setFormData] = useState({ name: '', host: '127.0.0.1', port: 18789, path: '/', token: '' });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // 看门狗
  const [healthCheckEnabled, setHealthCheckEnabled] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{
    fail_count: number;
    last_ok: string;
    last_check: string;
    max_fails: number;
    interval_sec: number;
    reconnect_backoff_cap_sec: number;
    restart_grace_sec: number;
    grace_until: string;
    grace_remaining_sec: number;
    restarting: boolean;
    next_check_in_sec: number;
    phase: 'healthy' | 'probing' | 'degraded' | 'restarting' | 'grace' | 'starting' | 'disabled';
    notify_channels: string[];
    notify_sending: boolean;
    notify_last_event: string;
    notify_last_at: string;
    notify_last_ago_sec: number;
    probe?: {
      tcp_reachable?: boolean;
      tcp_latency_ms?: number;
      tcp_error?: string;
      stage?: 'port' | 'http_live' | 'http_ready' | 'ready' | string;
      summary?: string;
      live?: { ok?: boolean; status_code?: number; latency_ms?: number; error?: string };
      ready?: { ok?: boolean; status_code?: number; latency_ms?: number; error?: string; body?: Record<string, unknown> };
    };
  } | null>(null);
  const [displayUptimeMs, setDisplayUptimeMs] = useState(0);
  const [watchdogIntervalSec, setWatchdogIntervalSec] = useState('30');
  const [watchdogMaxFails, setWatchdogMaxFails] = useState('3');
  const [watchdogBackoffCapSec, setWatchdogBackoffCapSec] = useState('30');
  const [watchdogGraceSec, setWatchdogGraceSec] = useState('120');
  const [watchdogAdvancedOpen, setWatchdogAdvancedOpen] = useState(false);
  const [gatewayDetailsOpen, setGatewayDetailsOpen] = useState(false);
  const [watchdogSaving, setWatchdogSaving] = useState(false);
  const gatewayRecoveringRef = useRef(false);

  // 恢复/未就绪过程计时：从横幅出现到全绿持续多久
  const recoveryStartRef = useRef<number | null>(null);
  const [recoveryElapsedSec, setRecoveryElapsedSec] = useState(0);

  // WebSocket 连接状态（用于 tab 标题指示灯 + 头部指示器）
  const [gwWsConnected, setGwWsConnected] = useState<boolean | null>(null);
  const [gwWsDetail, setGwWsDetail] = useState<{ host?: string; port?: number; reconnect_count?: number; backoff_ms?: number; last_error?: string; pairing_auto_approve?: boolean; auth_refresh_pending?: boolean; phase?: 'connected' | 'pairing' | 'auth_refresh' | 'reconnecting' | 'disconnected' } | null>(null);
  const [wsIndicatorOpen, setWsIndicatorOpen] = useState(false);
  const [wsReconnecting, setWsReconnecting] = useState(false);
  const [wsDiagResult, setWsDiagResult] = useState<{
    items: Array<{ name: string; label: string; labelEn: string; status: 'pass' | 'fail' | 'warn'; detail: string; suggestion?: string }>;
    summary: string;
    message: string;
  } | null>(null);
  const [wsDiagLoading, setWsDiagLoading] = useState(false);
  const [wsDiagExpanded, setWsDiagExpanded] = useState(false);

  // 按钮操作状态
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showOptimizeWizard, setShowOptimizeWizard] = useState(false);




  // 支持从仪表盘跳转时预设事件筛选
  useEffect(() => {
    const handler = (evt: Event) => {
      const ce = evt as CustomEvent<OpenWindowDetail>;
      const detail = ce?.detail;
      if (!detail || detail.id !== 'gateway') return;

      if (detail.tab) setActiveTab(detail.tab as typeof activeTab);
      if (detail.eventRisk) setEventRisk(detail.eventRisk as typeof eventRisk);
      if (detail.eventType) setEventType(detail.eventType as typeof eventType);
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

  const watchdogAdvancedOpenRef = useRef(false);
  watchdogAdvancedOpenRef.current = watchdogAdvancedOpen;

  const fetchHealthCheck = useCallback((force = false) => {
    gatewayApi.getHealthCheckCached(6000, force).then((data: any) => {
      setHealthCheckEnabled(!!data?.enabled);
      setHealthStatus({
        fail_count: data?.fail_count || 0,
        last_ok: data?.last_ok || '',
        last_check: data?.last_check || '',
        max_fails: data?.max_fails || 3,
        interval_sec: data?.interval_sec || 30,
        reconnect_backoff_cap_sec: data?.reconnect_backoff_cap_sec ?? (data?.reconnect_backoff_cap_ms ? Math.round(data.reconnect_backoff_cap_ms / 1000) : 30),
        restart_grace_sec: data?.restart_grace_sec ?? 120,
        grace_until: data?.grace_until || '',
        grace_remaining_sec: data?.grace_remaining_sec || 0,
        restarting: !!data?.restarting,
        next_check_in_sec: data?.next_check_in_sec || 0,
        phase: data?.phase || 'disabled',
        notify_channels: data?.notify_channels || [],
        notify_sending: !!data?.notify_sending,
        notify_last_event: data?.notify_last_event || '',
        notify_last_at: data?.notify_last_at || '',
        notify_last_ago_sec: data?.notify_last_ago_sec || 0,
        probe: data?.probe,
      });
      if (!watchdogAdvancedOpenRef.current) {
        setWatchdogIntervalSec(String(data?.interval_sec ?? 30));
        setWatchdogMaxFails(String(data?.max_fails ?? 3));
        setWatchdogBackoffCapSec(String(data?.reconnect_backoff_cap_sec ?? (data?.reconnect_backoff_cap_ms ? Math.round(data.reconnect_backoff_cap_ms / 1000) : 30)));
        setWatchdogGraceSec(String(data?.restart_grace_sec ?? 120));
      }
    }).catch(() => {});
  }, []);

  const fetchGatewayObservedState = useCallback((force = false) => {
    observabilityApi.gatewayStateCached(3000, force).then((data) => {
      setGatewayObservedState(data);
      gatewayRecoveringRef.current = !!data?.recovering || data?.phase === 'restarting' || data?.phase === 'grace' || data?.phase === 'starting';
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
        Promise.resolve(fetchGatewayObservedState()),
        Promise.resolve(fetchChannels()),
      ]).finally(() => {
        setInitialDetecting(false);
      });
    } else {
      fetchProfiles();
      fetchStatus();
      fetchHealthCheck();
      fetchGatewayObservedState();
      fetchChannels();
    }
    const deferTimer = setTimeout(() => {
      fetchLogs();
      if (activeTab === 'events') fetchEvents();
    }, 0);
    return () => clearTimeout(deferTimer);
  }, [fetchProfiles, fetchStatus, fetchHealthCheck, fetchGatewayObservedState, fetchLogs, fetchEvents, fetchChannels, activeTab]);

  // WS connection status polling + disconnect/reconnect toast + gateway uptime
  useEffect(() => {
    const pollWs = () => {
      gwApi.status().then((data: any) => {
        const connected = !!data?.connected;
        setGwWsConnected(prev => {
          if (prev !== null && prev !== connected) {
            if (connected) toast('success', gw.svcWsReconnected || 'WebSocket reconnected');
            else if (!gatewayRecoveringRef.current) toast('error', gw.svcWsLost || 'WebSocket disconnected');
          }
          return connected;
        });
        setGwWsDetail({
          host: data?.host,
          port: data?.port,
          reconnect_count: data?.reconnect_count ?? 0,
          backoff_ms: data?.backoff_ms ?? 0,
          last_error: data?.last_error,
          pairing_auto_approve: data?.pairing_auto_approve,
          auth_refresh_pending: data?.auth_refresh_pending,
          phase: data?.phase,
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

  // Auto-diagnose when WS is disconnected — debounced + cooldown to avoid repeated calls
  const wsDiagCooldownRef = useRef(0); // timestamp of last completed diagnose
  useEffect(() => {
    if (gatewayRecoveringRef.current || gatewayObservedState?.recovering) return;
    if (gwWsConnected === true) {
      setWsDiagResult(null);
      return;
    }
    if (gwWsConnected !== false || wsDiagResult || wsDiagLoading) return;
    // Cooldown: skip if diagnosed within last 30s
    if (Date.now() - wsDiagCooldownRef.current < 30_000) return;
    // Debounce: wait 2s to confirm WS is truly disconnected (not a transient glitch)
    const timer = setTimeout(() => {
      setWsDiagLoading(true);
      gatewayApi.diagnose().then((data: any) => {
        setWsDiagResult(data);
      }).catch(() => {}).finally(() => {
        setWsDiagLoading(false);
        wsDiagCooldownRef.current = Date.now();
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [gwWsConnected, wsDiagResult, wsDiagLoading, gatewayObservedState]);

  // Close WS indicator popover on click-outside
  useEffect(() => {
    if (!wsIndicatorOpen) return;
    const handler = (e: MouseEvent) => {
      if (wsIndicatorRef.current && !wsIndicatorRef.current.contains(e.target as Node)) {
        setWsIndicatorOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [wsIndicatorOpen]);

  const handleWsReconnect = useCallback(async () => {
    setWsReconnecting(true);
    try {
      await gwApi.reconnect();
      toast('success', gw.svcWsReconnecting || 'Reconnecting...');
    } catch (err: any) {
      toast('error', err?.message || gw.svcWsReconnectFailed || 'Reconnect failed');
    } finally {
      setWsReconnecting(false);
    }
  }, [toast, gw]);

  // Status + health polling with visibility pause
  const fetchStatusAndHealth = useCallback(() => { fetchStatus(); fetchHealthCheck(); fetchGatewayObservedState(); }, [fetchStatus, fetchHealthCheck, fetchGatewayObservedState]);
  useVisibilityPolling(fetchStatusAndHealth, 8000);


  // Log polling with visibility pause (cursor-based incremental, 5s interval)
  useVisibilityPolling(fetchLogs, 5000, activeTab === 'logs');

  // Event polling with visibility pause
  useVisibilityPolling(fetchEvents, 10000, activeTab === 'events');


  // Real-time gateway events via WebSocket
  useGatewayEvents({
    health: () => { fetchStatus(true); fetchHealthCheck(true); fetchGatewayObservedState(true); fetchChannels(true); },
    shutdown: () => { fetchStatus(true); fetchGatewayObservedState(true); },
    cron: () => { if (activeTab === 'events') fetchEvents(); },
  });

  // 刷新所有状态
  const refreshAll = useCallback((force = false) => {
    fetchProfiles(force);
    fetchStatus(force);
    fetchHealthCheck(force);
    fetchGatewayObservedState(force);
    fetchChannels(force);
    if (activeTab === 'logs') { logCursorRef.current = undefined; logInitializedRef.current = false; fetchLogs(force); }
    if (activeTab === 'events') fetchEvents();
  }, [activeTab, fetchProfiles, fetchStatus, fetchLogs, fetchHealthCheck, fetchGatewayObservedState, fetchEvents, fetchChannels]);

  const actionLabels: Record<string, string> = {
    start: gw.start, stop: gw.stop, restart: gw.restart, kill: gw.kill || 'Kill',
  };

  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'kill') => {
    // Smart restart: try preflight → safe restart if RPC reachable, hard restart otherwise
    if (action === 'restart') {
      setActionLoading('restart');
      try {
        const preflight = await gwApi.gatewayRestartPreflight() as any;
        // RPC reachable — show preflight info and do safe restart
        const activeSessions = preflight?.activeSessions ?? 0;
        const pendingTasks = preflight?.pendingTasks ?? 0;
        const warnings: string[] = [];
        if (activeSessions > 0) warnings.push(`${activeSessions} ${gw.safeRestartActiveSessions || 'active session(s)'}`);
        if (pendingTasks > 0) warnings.push(`${pendingTasks} ${gw.safeRestartPendingTasks || 'pending task(s)'}`);
        const detail = warnings.length > 0
          ? `${gw.safeRestartWarn || 'Warning'}: ${warnings.join(', ')}.\n${gw.safeRestartContinue || 'Continue with restart?'}`
          : (gw.safeRestartReady || 'Gateway is ready for a safe restart. Proceed?');
        if (!(await confirm({
          title: `${gw.restart} (${gw.safeRestart || 'Safe'})`,
          message: detail,
          confirmText: gw.restart,
          cancelText: gw.cancel || 'Cancel',
          danger: warnings.length > 0,
        }))) { setActionLoading(null); return; }
        await gwApi.gatewayRestartRequest({ reason: 'ClawDeckX user-initiated restart' });
        toast('success', `${gw.restart} ${gw.ok} (${gw.safeRestart || 'Safe'})`);
        setTimeout(() => refreshAll(true), 3000);
        setTimeout(() => refreshAll(true), 8000);
      } catch {
        // RPC unreachable — fall back to hard restart
        const ok = await confirm({
          title: `${gw.restart} (${gw.smartRestartHard || 'Hard'})`,
          message: gw.smartRestartFallback || 'Gateway RPC is not responding. A hard process restart will be performed.',
          confirmText: gw.restart,
          cancelText: gw.cancel || 'Cancel',
          danger: true,
        });
        if (!ok) { setActionLoading(null); return; }
        try {
          const result = await gatewayApi.restart();
          const durationMs = (result as any)?.observability?.duration_ms;
          const parts: string[] = [`${gw.restart} ${gw.ok}`];
          if (typeof durationMs === 'number' && durationMs >= 0) parts.push(`${durationMs}ms`);
          toast('success', parts.join(' · '));
          setTimeout(() => refreshAll(true), 1000);
          setTimeout(() => refreshAll(true), 3000);
        } catch (err: any) {
          toast('error', `${gw.restart} ${gw.failed}: ${err?.message || String(err)}`);
        }
      }
      setTimeout(() => setActionLoading(null), 1500);
      return;
    }
    // Non-restart actions (start / stop / kill)
    if (action === 'stop' || action === 'kill') {
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
      await (gatewayApi as any)[action]();
      toast('success', `${actionLabels[action]} ${gw.ok}`);
      setTimeout(() => refreshAll(true), 1000);
      setTimeout(() => refreshAll(true), 3000);
    } catch (err: any) {
      toast('error', `${actionLabels[action]} ${gw.failed}: ${err?.message || String(err)}`);
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
      setFormData({ name: '', host: '127.0.0.1', port: 18789, path: '/', token: '' });
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
      const res = await gatewayProfileApi.testConnection({ host: formData.host, port: formData.port, path: formData.path, token: formData.token }) as any;
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
    setFormData({ name: p.name, host: p.host, port: p.port, path: p.path || '/', token: p.token });
    setFormErrors({});
    setShowProfilePanel(true);
  };

  const openAddForm = () => {
    setEditingProfile(null);
    setFormData({ name: '', host: '127.0.0.1', port: 18789, path: '/', token: '' });
    setFormErrors({});
    setShowProfilePanel(true);
  };

  // Toggle watchdog
  const toggleHealthCheck = useCallback(async () => {
    try {
      const intervalSec = Number.parseInt(watchdogIntervalSec, 10);
      const maxFails = Number.parseInt(watchdogMaxFails, 10);
      const backoffCapSec = Number.parseInt(watchdogBackoffCapSec, 10);
      const graceSec = Number.parseInt(watchdogGraceSec, 10);
      const data: any = await gatewayApi.setHealthCheck({
        enabled: !healthCheckEnabled,
        interval_sec: Number.isFinite(intervalSec) ? intervalSec : 30,
        max_fails: Number.isFinite(maxFails) ? maxFails : 3,
        reconnect_backoff_cap_sec: Number.isFinite(backoffCapSec) ? backoffCapSec : 30,
        restart_grace_sec: Number.isFinite(graceSec) ? graceSec : 120,
      });
      setHealthCheckEnabled(!!data?.enabled);
      setHealthStatus({
        fail_count: data?.fail_count || 0,
        last_ok: data?.last_ok || '',
        last_check: data?.last_check || '',
        max_fails: data?.max_fails || 3,
        interval_sec: data?.interval_sec || 30,
        reconnect_backoff_cap_sec: data?.reconnect_backoff_cap_sec ?? 30,
        restart_grace_sec: data?.restart_grace_sec ?? 120,
        grace_until: data?.grace_until || '',
        grace_remaining_sec: data?.grace_remaining_sec || 0,
        restarting: !!data?.restarting,
        next_check_in_sec: data?.next_check_in_sec || 0,
        phase: data?.phase || 'disabled',
        notify_channels: data?.notify_channels || [],
        notify_sending: !!data?.notify_sending,
        notify_last_event: data?.notify_last_event || '',
        notify_last_at: data?.notify_last_at || '',
        notify_last_ago_sec: data?.notify_last_ago_sec || 0,
        probe: data?.probe,
      });
      setWatchdogIntervalSec(String(data?.interval_sec ?? intervalSec));
      setWatchdogMaxFails(String(data?.max_fails ?? maxFails));
      setWatchdogBackoffCapSec(String(data?.reconnect_backoff_cap_sec ?? backoffCapSec));
      setWatchdogGraceSec(String(data?.restart_grace_sec ?? graceSec));
      toast('success', gw.patchOk || 'Saved');
    } catch (err: any) { toast('error', err?.message || ''); }
  }, [healthCheckEnabled, watchdogIntervalSec, watchdogMaxFails, watchdogBackoffCapSec, watchdogGraceSec, toast, gw]);

  const saveWatchdogAdvanced = useCallback(async () => {
    const intervalSec = Number.parseInt(watchdogIntervalSec, 10);
    const maxFails = Number.parseInt(watchdogMaxFails, 10);
    const backoffCapSec = Number.parseInt(watchdogBackoffCapSec, 10);
    const graceSec = Number.parseInt(watchdogGraceSec, 10);

    if (!Number.isFinite(intervalSec) || intervalSec < 5 || intervalSec > 300) {
      toast('error', gw.watchdogIntervalInvalid || 'Interval must be between 5 and 300 seconds');
      return;
    }
    if (!Number.isFinite(maxFails) || maxFails < 1 || maxFails > 20) {
      toast('error', gw.watchdogMaxFailsInvalid || 'Max fails must be between 1 and 20');
      return;
    }
    if (!Number.isFinite(backoffCapSec) || backoffCapSec < 1 || backoffCapSec > 6000) {
      toast('error', gw.watchdogBackoffInvalid || 'Backoff cap must be between 1 and 6000 seconds');
      return;
    }
    if (!Number.isFinite(graceSec) || graceSec < 10 || graceSec > 600) {
      toast('error', gw.watchdogGraceInvalid || 'Restart grace must be between 10 and 600 seconds');
      return;
    }

    setWatchdogSaving(true);
    try {
      const data: any = await gatewayApi.setHealthCheck({
        enabled: healthCheckEnabled,
        interval_sec: intervalSec,
        max_fails: maxFails,
        reconnect_backoff_cap_sec: backoffCapSec,
        restart_grace_sec: graceSec,
      });
      setWatchdogIntervalSec(String(data?.interval_sec ?? intervalSec));
      setWatchdogMaxFails(String(data?.max_fails ?? maxFails));
      setWatchdogBackoffCapSec(String(data?.reconnect_backoff_cap_sec ?? backoffCapSec));
      setWatchdogGraceSec(String(data?.restart_grace_sec ?? graceSec));
      setHealthCheckEnabled(!!data?.enabled);
      toast('success', gw.patchOk || 'Saved');
    } catch (err: any) {
      toast('error', err?.message || '');
    } finally {
      setWatchdogSaving(false);
    }
  }, [healthCheckEnabled, watchdogIntervalSec, watchdogMaxFails, watchdogBackoffCapSec, watchdogGraceSec, toast, gw]);

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
    const [st, hl] = await Promise.all([settlePromise(gwApi.status()), settlePromise(gwApi.health())]);
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
  const localGatewayHost = '127.0.0.1';
  const localGatewayPort = gwWsDetail?.port || status?.port || activeProfile?.port || 18789;
  const gatewayProbeState = useMemo(() => {
    const phase = healthStatus?.phase || 'probing';
    const probe = healthStatus?.probe;
    const tcpOk = probe?.tcp_reachable === true;
    const liveOk = probe?.live?.ok === true;
    const readyOk = probe?.ready?.ok === true;
    const hasProbe = !!probe;
    const fullyHealthy = liveOk || (phase === 'healthy' && tcpOk);
    const hasFailedProbe = hasProbe && (!tcpOk || !liveOk);
    return { phase, hasProbe, tcpOk, liveOk, readyOk, fullyHealthy, hasFailedProbe };
  }, [healthStatus]);

  const gatewayObservedView = useMemo(() => {
    const state = gatewayObservedState;
    const phase = state?.phase || 'stopped';
    const probe = state?.probe || {};
    const ws = state?.ws || {};
    const rpc = state?.rpc || {};
    // WS 已连接 ⇒ 网关 HTTP 服务一定可用，TCP/health/ready 不应因为
    // 一帧探针抖动而显示为灰（grace 期间网关繁忙时偶发探针超时常见）。
    const wsLive = !!ws.connected;
    const phaseImpliesHttp = ['http_ready', 'ws_connected', 'rpc_ready'].includes(phase);
    // RPC 通道走 WS：WS 连通且没有明确 RPC 错误 ⇒ RPC 已可用（仅是后端那一帧的 2s
    // health RPC 还没等到回包，常发生在 grace 早期网关刚起、handler 还在注册时）。
    const rpcInferOk = wsLive && !rpc.error;
    const steps = [
      { key: 'tcp', label: 'TCP', ok: !!probe.tcp_reachable || wsLive || ['http_live', 'http_ready', 'ws_connected', 'rpc_ready'].includes(phase), active: phase === 'tcp_open' },
      { key: 'health', label: '/health', ok: !!probe.live?.ok || wsLive || phaseImpliesHttp, active: phase === 'http_live' },
      { key: 'ready', label: '/ready', ok: !!probe.ready?.ok || wsLive || ['ws_connected', 'rpc_ready'].includes(phase), active: phase === 'http_ready' },
      { key: 'ws', label: 'WebSocket', ok: wsLive || phase === 'rpc_ready', active: phase === 'pairing' || phase === 'auth_refresh' || phase === 'ws_connected' },
      { key: 'rpc', label: 'RPC', ok: !!rpc.ready || rpcInferOk || phase === 'rpc_ready' || !!state?.ready, active: phase === 'rpc_ready' },
    ];
    const allGreen = steps.every(s => s.ok);
    const recovering = !!state?.recovering || phase === 'restarting' || phase === 'grace' || phase === 'starting';
    const ready = !!state?.ready || phase === 'rpc_ready' || allGreen;
    const title = ready
      ? (gw.obReady || 'Gateway ready')
      : recovering
        ? (gw.obRecovering || 'Gateway recovering...')
        : phase === 'stopped'
          ? (gw.obStopped || 'Gateway stopped')
          : (gw.obDegraded || 'Gateway not fully ready');
    const descMap: Record<string, string> = {
      restarting: gw.obRestartingDesc || 'Gateway is restarting; transient WebSocket and readiness errors are suppressed.',
      grace: `${gw.obGraceDesc || 'Restart grace period is active; waiting for the gateway to stabilize.'}${state?.grace_remaining_sec ? ` ${state.grace_remaining_sec}s` : ''}`,
      starting: gw.obStartingDesc || 'Gateway process is starting; waiting for health and WebSocket readiness.',
      tcp_open: gw.obTcpDesc || 'TCP port is open; waiting for HTTP health.',
      http_live: gw.obHealthDesc || 'HTTP health is available; waiting for readiness.',
      http_ready: gw.obReadyDesc || 'HTTP ready is available; waiting for WebSocket/RPC.',
      pairing: gw.obPairingDesc || 'Device pairing is being approved automatically.',
      auth_refresh: gw.obAuthDesc || 'Gateway token is being refreshed automatically.',
      ws_connected: gw.obWsDesc || 'WebSocket is connected; waiting for RPC health.',
      rpc_ready: gw.obRpcDesc || 'Gateway RPC is ready.',
      stopped: gw.obStoppedDesc || 'Gateway is not running or not reachable.',
    };
    const phaseLabelMap: Record<string, string> = {
      stopped: gw.obPhaseStopped || 'stopped',
      starting: gw.obPhaseStarting || 'starting',
      tcp_open: gw.obPhaseTcpOpen || 'tcp',
      http_live: gw.obPhaseHttpLive || 'health',
      http_ready: gw.obPhaseHttpReady || 'ready',
      pairing: gw.obPhasePairing || 'pairing',
      auth_refresh: gw.obPhaseAuth || 'auth',
      ws_connected: gw.obPhaseWs || 'ws',
      rpc_ready: gw.obPhaseRpc || 'rpc',
      restarting: gw.obPhaseRestarting || 'restarting',
      grace: gw.obPhaseGrace || 'grace',
    };
    return { phase, phaseLabel: phaseLabelMap[phase] || phase, steps, recovering, ready, allGreen, title, desc: descMap[phase] || descMap.stopped };
  }, [gatewayObservedState, gw]);

  // 看门狗状态摘要（用于顶部统一状态卡片的副标签）
  const watchdogChip = useMemo(() => {
    if (!healthCheckEnabled) {
      return { tone: 'muted' as const, icon: 'shield_off', label: gw.serviceWatchdogInactive || 'Watchdog inactive', spin: false };
    }
    if (!healthStatus) return null;
    const wdPhase = healthStatus.phase;
    if (wdPhase === 'restarting') return { tone: 'danger' as const, icon: 'progress_activity', label: gw.wdRestarting || 'Restarting...', spin: true };
    if (wdPhase === 'grace') return { tone: 'warn' as const, icon: 'hourglass_top', label: `${gw.wdGraceShort || 'Grace'}${(healthStatus.grace_remaining_sec ?? 0) > 0 ? ` ${healthStatus.grace_remaining_sec}s` : ''}`, spin: false };
    if (wdPhase === 'degraded') return { tone: 'danger' as const, icon: 'heart_broken', label: `${gw.hbUnhealthy || 'Unhealthy'} (${healthStatus.fail_count}/${healthStatus.max_fails})`, spin: false };
    if (wdPhase === 'probing') return { tone: 'info' as const, icon: 'progress_activity', label: gw.hbProbing || 'Probing...', spin: true };
    if (wdPhase === 'starting') return { tone: 'info' as const, icon: 'progress_activity', label: gw.hbProbing || 'Probing...', spin: true };
    if (wdPhase === 'healthy') {
      const next = healthStatus.next_check_in_sec ?? 0;
      return { tone: 'ok' as const, icon: 'shield', label: `${gw.hbHealthy || 'Healthy'}${next > 0 ? ` · ${next}s` : ''}`, spin: false };
    }
    return null;
  }, [healthCheckEnabled, healthStatus, gw]);

  // 计时管理：horn 状态进入「未就绪」时记录起点，全绿后清空，未就绪期间每秒刷新
  const allGreen = gatewayObservedView.allGreen;
  useEffect(() => {
    if (!gatewayObservedState) return;
    if (allGreen) {
      if (recoveryStartRef.current !== null) {
        recoveryStartRef.current = null;
        setRecoveryElapsedSec(0);
      }
      return;
    }
    if (recoveryStartRef.current === null) {
      recoveryStartRef.current = Date.now();
      setRecoveryElapsedSec(0);
    }
    const tick = () => {
      if (recoveryStartRef.current !== null) {
        setRecoveryElapsedSec(Math.floor((Date.now() - recoveryStartRef.current) / 1000));
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [allGreen, gatewayObservedState]);

  const fmtElapsed = useCallback((sec: number): string => {
    if (sec < 60) return `${sec}${gw.unitSec || 's'}`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m < 60) {
      const ss = s.toString().padStart(2, '0');
      return `${m}:${ss}`;
    }
    const h = Math.floor(m / 60);
    const mm = (m % 60).toString().padStart(2, '0');
    const ss = s.toString().padStart(2, '0');
    return `${h}:${mm}:${ss}`;
  }, [gw]);

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

  // 日志过滤（包含模式：空集合=全部显示，非空=只显示选中级别）
  const filteredLogs = useMemo(() => {
    const needle = logSearch.trim().toLowerCase();
    const hasLevelFilter = levelFilters.size > 0;
    return parsedLogEntries.filter(({ line, parsed }) => {
      if (hasLevelFilter && parsed && parsed.level) {
        if (!levelFilters.has(parsed.level.toLowerCase())) return false;
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
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface)] dark:bg-transparent">
      {/* 网关配置表单弹窗 */}
      {showProfilePanel && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowProfilePanel(false)}>
          <div className="w-[90%] max-w-md rounded-2xl shadow-2xl theme-panel overflow-hidden sci-card" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[var(--color-text)] dark:text-white">{editingProfile ? gw.editGateway : gw.addGateway}</h3>
              <button onClick={() => setShowProfilePanel(false)} className="w-6 h-6 rounded-full theme-field flex items-center justify-center theme-text-secondary hover:bg-mac-red hover:text-white transition-all">
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-[11px] font-bold theme-text-secondary uppercase tracking-wider mb-1 block">{gw.gwName}</label>
                <input
                  value={formData.name}
                  onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                  placeholder={gw.namePlaceholder}
                  className="w-full h-9 px-3 theme-field rounded-lg text-sm font-mono placeholder:text-slate-400 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary outline-none transition-all sci-input"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-[11px] font-bold theme-text-secondary uppercase tracking-wider mb-1 block">{gw.gwHost}</label>
                  <input
                    value={formData.host}
                    onChange={e => {
                      let v = e.target.value;
                      // Auto-parse full URLs: ws://host:port/path or http://host:port/path
                      const urlMatch = v.match(/^(?:wss?|https?):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/i);
                      if (urlMatch) {
                        const [, h, p, pathPart] = urlMatch;
                        setFormData(f => ({
                          ...f,
                          host: h,
                          port: p ? Math.max(1, Math.min(65535, Number(p))) : f.port,
                          path: pathPart && pathPart !== '/' ? pathPart : f.path,
                        }));
                        return;
                      }
                      v = v.replace(/^https?:\/\//i, '').replace(/^wss?:\/\//i, '');
                      setFormData(f => ({ ...f, host: v }));
                    }}
                    placeholder={gw.hostPlaceholder || '192.168.1.100 or ws://host:port/path'}
                    className={`w-full h-9 px-3 theme-field rounded-lg text-sm font-mono placeholder:text-slate-400 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary outline-none transition-all sci-input ${formErrors.host ? 'border-mac-red' : ''}`}
                  />
                  {formErrors.host && <p className="text-[10px] text-mac-red mt-0.5">{formErrors.host}</p>}
                </div>
                <div>
                  <label className="text-[11px] font-bold theme-text-secondary uppercase tracking-wider mb-1 block">{gw.gwPort}</label>
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
                <label className="text-[11px] font-bold theme-text-secondary uppercase tracking-wider mb-1 block">{gw.gwPath || 'PATH'}</label>
                <input
                  value={formData.path}
                  onChange={e => setFormData(f => ({ ...f, path: e.target.value }))}
                  placeholder={gw.pathPlaceholder || '/ (default) or /hg3x47'}
                  className="w-full h-9 px-3 theme-field rounded-lg text-sm font-mono placeholder:text-slate-400 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary outline-none transition-all sci-input"
                />
                <p className="text-[9px] theme-text-muted mt-0.5">{gw.pathHint || 'WebSocket path suffix, e.g. /hg3x47. Leave as / for standard connections.'}</p>
              </div>
              <div>
                <label className="text-[11px] font-bold theme-text-secondary uppercase tracking-wider mb-1 block">{gw.gwToken}</label>
                <input
                  type="password"
                  value={formData.token}
                  onChange={e => setFormData(f => ({ ...f, token: e.target.value }))}
                  placeholder={gw.tokenPlaceholder}
                  className="w-full h-9 px-3 theme-field rounded-lg text-sm font-mono placeholder:text-slate-400 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary outline-none transition-all sci-input"
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-between theme-panel">
              <button onClick={handleTestConnection} disabled={testingConnection || !formData.host.trim()}
                className="px-3 py-1.5 text-xs font-bold theme-text-secondary hover:text-primary border border-slate-200 dark:border-white/10 rounded-lg transition-all disabled:opacity-40 flex items-center gap-1">
                <span className={`material-symbols-outlined text-[14px] ${testingConnection ? 'animate-spin' : ''}`}>{testingConnection ? 'progress_activity' : 'cable'}</span>
                {gw.testConnection || 'Test'}
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowProfilePanel(false)} className="px-4 py-1.5 text-xs font-bold theme-text-secondary hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-all">
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

      {/* 一键优化向导 */}
      {showOptimizeWizard && (
        <OptimizeWizard
          language={language}
          t={t}
          wsConnected={gwWsConnected === true}
          onClose={() => setShowOptimizeWizard(false)}
          onApplied={() => refreshAll(true)}
        />
      )}

      {/* 状态与控制区 — 紧凑布局 */}
      <div className="px-3 md:px-4 py-2 md:py-3 border-b border-slate-200 dark:border-white/5 theme-panel shrink-0 space-y-2">
        {initialDetecting && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-primary animate-spin">progress_activity</span>
            <span className="text-[11px] font-medium theme-text-secondary">{gw.detecting || gw.loading}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          </div>
        )}
        {/* 统一网关观测状态机 — 全绿即关闭，状态退回再恢复显示 */}
        {!initialDetecting && gatewayObservedState && !gatewayObservedView.allGreen && (
          <div className={`rounded-xl border px-3 py-2.5 animate-fade-in ${
            gatewayObservedView.recovering
              ? 'border-amber-500/25 bg-amber-500/5'
              : 'border-mac-red/25 bg-mac-red/5'
          }`}>
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                gatewayObservedView.recovering ? 'bg-amber-500/15' : 'bg-mac-red/15'
              }`}>
                <span className={`material-symbols-outlined text-[18px] ${
                  gatewayObservedView.recovering ? 'text-amber-500 animate-spin' : 'text-mac-red'
                }`}>
                  {gatewayObservedView.recovering ? 'progress_activity' : 'troubleshoot'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-[11px] font-bold ${gatewayObservedView.recovering ? 'text-amber-600 dark:text-amber-400' : 'text-mac-red'}`}>
                    {gatewayObservedView.title}
                  </p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-md font-mono theme-field theme-text-muted">{gatewayObservedView.phaseLabel}</span>
                  <span
                    className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md font-mono font-bold border border-slate-200/60 dark:border-white/10 theme-field theme-text-secondary"
                    title={gw.obElapsed || 'Elapsed'}
                  >
                    <span className="material-symbols-outlined text-[11px]">timer</span>
                    {fmtElapsed(recoveryElapsedSec)}
                  </span>
                  {watchdogChip && (() => {
                    const toneCls = watchdogChip.tone === 'ok' ? 'border-mac-green/30 bg-mac-green/5 text-mac-green'
                      : watchdogChip.tone === 'warn' ? 'border-amber-500/30 bg-amber-500/5 text-amber-500'
                      : watchdogChip.tone === 'danger' ? 'border-mac-red/30 bg-mac-red/5 text-mac-red'
                      : watchdogChip.tone === 'info' ? 'border-primary/30 bg-primary/5 text-primary'
                      : 'border-slate-200/60 dark:border-white/10 theme-field theme-text-muted';
                    return (
                      <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md font-bold border ${toneCls}`} title={gw.serviceWatchdog || 'Watchdog'}>
                        <span className={`material-symbols-outlined text-[11px] ${watchdogChip.spin ? 'animate-spin' : ''}`}>{watchdogChip.icon}</span>
                        {watchdogChip.label}
                      </span>
                    );
                  })()}
                </div>
                <p className="text-[10px] theme-text-secondary mt-0.5 leading-relaxed">{gatewayObservedView.desc}</p>
              </div>
              <button
                onClick={() => refreshAll(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg theme-field theme-text-secondary font-bold text-[10px] hover:text-primary transition-all shrink-0"
              >
                <span className="material-symbols-outlined text-[13px]">refresh</span>
                {gw.refresh || 'Refresh'}
              </button>
            </div>
            <div className="mt-2 ms-[42px] flex items-center gap-1 flex-wrap">
              {gatewayObservedView.steps.map((step, i) => (
                <span key={step.key} className="contents">
                  <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold ${
                    step.ok
                      ? 'text-mac-green'
                      : step.active
                        ? 'text-amber-500'
                        : 'theme-text-muted'
                  }`}>
                    <span className={`material-symbols-outlined text-[11px] ${step.active && !step.ok ? 'animate-spin' : ''}`}>
                      {step.ok ? 'check_circle' : step.active ? 'progress_activity' : 'radio_button_unchecked'}
                    </span>
                    {step.label}
                  </span>
                  {i < gatewayObservedView.steps.length - 1 && (
                    <span className="material-symbols-outlined text-[8px] theme-text-muted mx-0.5">chevron_right</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
        {/* WS 数据通道未连接提示 — 恢复窗口外才显示错误 */}
        {!initialDetecting && !gatewayObservedView.recovering && gwWsConnected === false && (
          <div className="rounded-xl border border-mac-red/30 bg-mac-red/5 px-3 py-2.5 animate-fade-in">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-mac-red/15 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[18px] text-mac-red">link_off</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-mac-red">{gw.wsDisconnected || 'Data channel disconnected'}</p>
                <p className="text-[10px] theme-text-secondary mt-0.5 leading-relaxed">{gw.wsDisconnectedDesc || 'Real-time logs, events, and chat will not work until the WebSocket connection is restored.'}</p>
              </div>
              <button
                onClick={handleWsReconnect}
                disabled={wsReconnecting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mac-red/15 text-mac-red font-bold text-[10px] transition-all hover:bg-mac-red/25 disabled:opacity-40 shrink-0"
              >
                <span className={`material-symbols-outlined text-[14px] ${wsReconnecting ? 'animate-spin' : ''}`}>
                  {wsReconnecting ? 'progress_activity' : 'refresh'}
                </span>
                {gw.svcWsReconnect || 'Reconnect'}
              </button>
            </div>
            {/* 紧凑详情区：连接步骤 + 错误摘要 + 诊断摘要（可展开） */}
            <div className="mt-2 ms-[42px] space-y-1">
              {/* 连接步骤可视化 */}
              {(() => {
                const phase = gwWsDetail?.phase || 'disconnected';
                const rc = gwWsDetail?.reconnect_count ?? 0;
                const bms = gwWsDetail?.backoff_ms ?? 0;
                const bFmt = bms >= 1000 ? `${(bms / 1000).toFixed(1)}s` : `${bms}ms`;
                const steps: { key: string; icon: string; label: string; active: boolean; color: string }[] = [
                  {
                    key: 'connect',
                    icon: phase === 'reconnecting' ? 'progress_activity' : phase === 'disconnected' ? 'cloud_off' : 'cloud_done',
                    label: phase === 'reconnecting'
                      ? `${gw.wsRetrying || 'Auto-reconnecting'}${rc > 0 ? ` #${rc}` : ''}${bms > 0 ? ` — ${bFmt} ${gw.wsRetryDelay || 'delay'}` : ''}`
                      : phase === 'disconnected'
                        ? (gw.wsWaitingRetry || 'Waiting for auto-reconnect...')
                        : (gw.wsStepConnected || 'TCP connected'),
                    active: phase === 'reconnecting' || phase === 'disconnected',
                    color: phase === 'reconnecting' ? 'text-amber-500 dark:text-amber-400' : phase === 'disconnected' ? 'theme-text-muted' : 'text-mac-green',
                  },
                  {
                    key: 'pairing',
                    icon: phase === 'pairing' ? 'progress_activity' : (phase === 'connected' ? 'check_circle' : 'radio_button_unchecked'),
                    label: phase === 'pairing'
                      ? (gw.wsPhasePairing || 'Auto-approving device pairing...')
                      : (gw.wsStepPairing || 'Device pairing'),
                    active: phase === 'pairing',
                    color: phase === 'pairing' ? 'text-amber-500 dark:text-amber-400' : (phase === 'connected' ? 'text-mac-green' : 'theme-text-muted'),
                  },
                  {
                    key: 'auth',
                    icon: phase === 'auth_refresh' ? 'progress_activity' : (phase === 'connected' ? 'check_circle' : 'radio_button_unchecked'),
                    label: phase === 'auth_refresh'
                      ? (gw.wsPhaseAuthRefresh || 'Refreshing auth token...')
                      : (gw.wsStepAuth || 'Authentication'),
                    active: phase === 'auth_refresh',
                    color: phase === 'auth_refresh' ? 'text-amber-500 dark:text-amber-400' : (phase === 'connected' ? 'text-mac-green' : 'theme-text-muted'),
                  },
                ];
                return (
                  <div className="flex items-center gap-1 flex-wrap">
                    {steps.map((step, i) => (
                      <span key={step.key} className="contents">
                        <span className={`flex items-center gap-0.5 text-[9px] ${step.color} ${step.active ? 'font-bold' : ''}`}>
                          <span className={`material-symbols-outlined text-[11px] ${step.active && step.icon === 'progress_activity' ? 'animate-spin' : ''}`}>{step.icon}</span>
                          {step.label}
                        </span>
                        {i < steps.length - 1 && (
                          <span className="material-symbols-outlined text-[8px] theme-text-muted mx-0.5">chevron_right</span>
                        )}
                      </span>
                    ))}
                  </div>
                );
              })()}
              {/* 诊断摘要行（可点击展开详情） */}
              {(() => {
                // Determine what to show: structured result, loading, or fallback hint
                const diagItems = wsDiagResult?.items;
                const problems = diagItems?.filter(it => it.status === 'fail' || it.status === 'warn') || [];
                const passed = diagItems?.filter(it => it.status === 'pass') || [];
                const errStr = (gwWsDetail?.last_error || '').toLowerCase();
                // Fallback hint for when diagnose hasn't returned yet
                let fallbackHint = '';
                if (!diagItems) {
                  if (errStr.includes('actively refused') || errStr.includes('connection refused') || errStr.includes('connectex')) {
                    fallbackHint = gw.wsDiagRefused || 'Gateway port is not listening. Check if the gateway process is running and the port is correct.';
                  } else if (errStr.includes('forcibly closed') || errStr.includes('connection reset') || errStr.includes('wsarecv')) {
                    fallbackHint = gw.wsDiagForceClosed || 'Connection rejected by remote host. Check token, TLS/SSL, or firewall.';
                  } else if (errStr.includes('timeout') || errStr.includes('timed out') || errStr.includes('deadline exceeded')) {
                    fallbackHint = gw.wsDiagTimeout || 'Connection timed out. Gateway may be overloaded or blocked by firewall.';
                  } else if (errStr.includes('no such host') || errStr.includes('dns') || errStr.includes('getaddrinfo')) {
                    fallbackHint = gw.wsDiagDns || 'DNS resolution failed. Check hostname and DNS settings.';
                  } else if (errStr.includes('certificate') || errStr.includes('tls') || errStr.includes('x509')) {
                    fallbackHint = gw.wsDiagTls || 'TLS/SSL certificate error.';
                  } else if (errStr.includes('401') || errStr.includes('403') || errStr.includes('unauthorized') || errStr.includes('forbidden')) {
                    fallbackHint = gw.wsDiagAuth || 'Authentication failed. Verify gateway token.';
                  } else if (errStr.includes('network is unreachable') || errStr.includes('no route')) {
                    fallbackHint = gw.wsDiagNetwork || 'Network unreachable.';
                  }
                }

                // Summary icon + text
                const summaryIcon = wsDiagLoading ? 'progress_activity'
                  : diagItems ? (problems.length > 0 ? 'cancel' : 'check_circle')
                  : (fallbackHint ? 'lightbulb' : null);
                const summaryColor = wsDiagLoading ? 'text-primary'
                  : diagItems ? (problems.length > 0 ? 'text-mac-red' : 'text-mac-green')
                  : 'text-amber-500';
                const summaryText = wsDiagLoading ? (gw.wsDiagRunning || 'Running diagnostics...')
                  : diagItems ? (problems.length > 0
                    ? `${gw.wsDiagTitle || 'Diagnostics'}: ${problems.length} ${gw.wsDiagIssues || 'issue(s)'}`
                    : `${gw.wsDiagTitle || 'Diagnostics'}: ${gw.wsDiagAllPass || 'All checks passed'}`)
                  : fallbackHint || null;

                if (!summaryIcon && !summaryText && !gwWsDetail?.last_error) return null;

                return (
                  <div className="space-y-1">
                    {/* Error message (always visible, one line truncated) */}
                    {gwWsDetail?.last_error && (
                      <p className="text-[11px] text-mac-red/70 font-mono truncate" title={gwWsDetail.last_error}>
                        <span className="material-symbols-outlined text-[11px] align-middle me-0.5">error</span>
                        {gwWsDetail.last_error}
                      </p>
                    )}
                    {/* Clickable diagnosis summary line */}
                    {summaryText && (
                      <button
                        onClick={() => setWsDiagExpanded(prev => !prev)}
                        className="flex items-center gap-1.5 w-full text-start group"
                      >
                        <span className={`material-symbols-outlined text-[13px] shrink-0 ${summaryColor} ${wsDiagLoading ? 'animate-spin' : ''}`}>{summaryIcon}</span>
                        <span className={`text-[11px] font-medium ${summaryColor} flex-1 min-w-0 truncate`}>{summaryText}</span>
                        {diagItems && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-primary shrink-0">
                            <span className={`material-symbols-outlined text-[13px] transition-transform ${wsDiagExpanded ? 'rotate-180' : ''}`}>expand_more</span>
                            {wsDiagExpanded ? (gw.wsDiagCollapse || 'Collapse') : (gw.wsDiagExpand || 'Details')}
                          </span>
                        )}
                        {diagItems && (
                          <span
                            onClick={(e) => { e.stopPropagation(); setWsDiagResult(null); setWsDiagLoading(false); wsDiagCooldownRef.current = 0; }}
                            className="text-[10px] text-primary/60 hover:text-primary hover:underline shrink-0 ms-1"
                          >{gw.wsDiagRerun || 'Re-run'}</span>
                        )}
                      </button>
                    )}
                    {/* Expandable diagnosis detail */}
                    {wsDiagExpanded && diagItems && (
                      <div className="rounded-lg border border-slate-200/60 dark:border-white/[0.06] overflow-hidden animate-fade-in">
                        <div className="max-h-[200px] overflow-y-auto neon-scrollbar divide-y divide-slate-200/40 dark:divide-white/[0.04]">
                          {problems.map((item) => (
                            <div key={item.name} className="px-2.5 py-1.5 flex items-start gap-2 bg-mac-red/[0.02]">
                              <span className={`material-symbols-outlined text-[13px] mt-px shrink-0 ${item.status === 'warn' ? 'text-amber-500' : 'text-mac-red'}`}>
                                {item.status === 'warn' ? 'warning' : 'cancel'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <span className="text-[11px] font-medium theme-text">{item.labelEn || item.label}</span>
                                {item.detail && <p className="text-[10px] theme-text-muted font-mono break-all mt-0.5">{item.detail}</p>}
                                {item.suggestion && (
                                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-start gap-0.5">
                                    <span className="material-symbols-outlined text-[11px] mt-px shrink-0">lightbulb</span>
                                    {item.suggestion}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                          {passed.length > 0 && (
                            <div className="px-2.5 py-1.5 flex items-center gap-1.5 flex-wrap">
                              {passed.map((item) => (
                                <span key={item.name} className="inline-flex items-center gap-0.5 text-[10px] theme-text-muted" title={item.detail}>
                                  <span className="material-symbols-outlined text-[11px] text-mac-green">check_circle</span>
                                  {item.labelEn || item.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
        {/* 看门狗异常处理过程提示 — degraded / restarting / grace 时显示 */}
        {false && !initialDetecting && healthCheckEnabled && healthStatus && (healthStatus.phase === 'degraded' || healthStatus.phase === 'restarting' || healthStatus.phase === 'grace') && (() => {
          const phase = healthStatus.phase;
          const fc = healthStatus.fail_count;
          const mf = healthStatus.max_fails;
          const intSec = healthStatus.interval_sec;
          const nxtSec = healthStatus.next_check_in_sec;
          const graceSec = healthStatus.grace_remaining_sec;

          // Banner config per phase
          const cfgMap: Record<string, { border: string; bg: string; icon: string; iconColor: string; spin: boolean; title: string; desc: string }> = {
            degraded: {
              border: 'border-mac-red/30', bg: 'bg-mac-red/5', icon: 'heart_broken', iconColor: 'text-mac-red', spin: false,
              title: `${gw.hbUnhealthy || 'Unhealthy'} (${fc}/${mf} ${gw.wdFails || 'fails'})`,
              desc: fc < mf
                ? `${gw.wdRestartIn || 'Restart after'} ${mf - fc} ${gw.wdMoreFails || 'more failures'} · ${gw.wdNextCheck || 'Next check in'} ${nxtSec > 0 ? `${nxtSec}s` : `${intSec}s`}`
                : gw.wdRestartImminent || 'Restart imminent...',
            },
            restarting: {
              border: 'border-mac-red/30', bg: 'bg-mac-red/5', icon: 'progress_activity', iconColor: 'text-mac-red', spin: true,
              title: gw.wdRestarting || 'Restarting gateway...',
              desc: gw.wdRestartingDesc || 'Watchdog triggered a restart due to consecutive health check failures',
            },
            grace: {
              border: 'border-amber-500/30', bg: 'bg-amber-500/5', icon: 'hourglass_top', iconColor: 'text-amber-500', spin: false,
              title: `${gw.wdGracePeriod || 'Grace Period Active'}${graceSec > 0 ? ` — ${graceSec}s` : ''}`,
              desc: gw.wdGraceDesc || 'Health checks paused, waiting for gateway to stabilize after restart',
            },
          };
          const cfg = cfgMap[phase] || cfgMap.degraded;

          return (
            <div className={`rounded-xl border ${cfg.border} ${cfg.bg} px-3 py-2.5 animate-fade-in`}>
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-lg ${phase === 'grace' ? 'bg-amber-500/15' : 'bg-mac-red/15'} flex items-center justify-center shrink-0`}>
                  <span className={`material-symbols-outlined text-[18px] ${cfg.iconColor} ${cfg.spin ? 'animate-spin' : ''}`}>{cfg.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] font-bold ${cfg.iconColor}`}>{cfg.title}</p>
                  <p className="text-[10px] theme-text-secondary mt-0.5 leading-relaxed">{cfg.desc}</p>
                </div>
              </div>
              {/* 多阶段过程链 */}
              <div className="mt-2 ms-[42px]">
                <div className="flex items-center gap-1 flex-wrap">
                  {[
                    {
                      key: 'monitor',
                      icon: 'check_circle',
                      label: gw.wdStepMonitorOk || 'Monitored',
                      active: false,
                      color: 'text-mac-green',
                    },
                    {
                      key: 'degrade',
                      icon: phase === 'degraded' ? 'warning' : 'check_circle',
                      label: phase === 'degraded'
                        ? `${gw.wdStepDegraded || 'Degraded'} ${fc}/${mf}`
                        : (gw.wdStepHealthCheck || 'Health check'),
                      active: phase === 'degraded',
                      color: phase === 'degraded' ? 'text-mac-red' : 'text-mac-green',
                    },
                    {
                      key: 'restart',
                      icon: phase === 'restarting' ? 'progress_activity' : phase === 'grace' ? 'check_circle' : 'radio_button_unchecked',
                      label: phase === 'restarting'
                        ? (gw.wdStepRestarting || 'Restarting...')
                        : (gw.wdStepRestart || 'Restart'),
                      active: phase === 'restarting',
                      color: phase === 'restarting' ? 'text-mac-red' : phase === 'grace' ? 'text-mac-green' : 'theme-text-muted',
                    },
                    {
                      key: 'grace',
                      icon: phase === 'grace' ? 'hourglass_top' : 'radio_button_unchecked',
                      label: phase === 'grace'
                        ? `${gw.wdStepGrace || 'Grace'} ${graceSec > 0 ? `${graceSec}s` : ''}`
                        : (gw.wdStepGrace || 'Grace'),
                      active: phase === 'grace',
                      color: phase === 'grace' ? 'text-amber-500' : 'theme-text-muted',
                    },
                  ].map((step, i, arr) => (
                    <span key={step.key} className="contents">
                      <span className={`flex items-center gap-0.5 text-[9px] ${step.color} ${step.active ? 'font-bold' : ''}`}>
                        <span className={`material-symbols-outlined text-[11px] ${step.active && step.icon === 'progress_activity' ? 'animate-spin' : ''}`}>{step.icon}</span>
                        {step.label}
                      </span>
                      {i < arr.length - 1 && (
                        <span className="material-symbols-outlined text-[8px] theme-text-muted mx-0.5">chevron_right</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
        {/* 异常通知发送过程 banner — 有通知渠道且（正在发送 或 最近60s内发过 或 异常阶段中） */}
        {!initialDetecting && healthStatus && healthStatus.notify_channels.length > 0 && (
          healthStatus.notify_sending || (healthStatus.notify_last_ago_sec > 0 && healthStatus.notify_last_ago_sec < 60)
        ) && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 animate-fade-in">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <span className={`material-symbols-outlined text-[16px] text-primary ${healthStatus.notify_sending ? 'animate-spin' : ''}`}>
                  {healthStatus.notify_sending ? 'progress_activity' : 'notifications_active'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-bold text-primary">
                    {healthStatus.notify_sending
                      ? (gw.nfySending || 'Sending notification...')
                      : healthStatus.notify_last_ago_sec > 0 && healthStatus.notify_last_ago_sec < 60
                        ? (gw.nfySent || 'Notification sent')
                        : (gw.nfyReady || 'Notification ready')}
                  </span>
                  {healthStatus.notify_channels.map((ch) => (
                    <span key={ch} className="text-[9px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium">{ch}</span>
                  ))}
                </div>
                <p className="text-[10px] theme-text-secondary mt-0.5">
                  {healthStatus.notify_sending
                    ? (gw.nfySendingDesc || 'Dispatching anomaly alert to configured channels')
                    : healthStatus.notify_last_ago_sec > 0 && healthStatus.notify_last_ago_sec < 60
                      ? `${gw.nfySentDesc || 'Last notified'} ${healthStatus.notify_last_ago_sec}s ${gw.nfyAgo || 'ago'}`
                      : (gw.nfyReadyDesc || 'Will notify when anomaly triggers configured events')}
                </p>
              </div>
              {healthStatus.notify_last_ago_sec > 0 && healthStatus.notify_last_ago_sec < 60 && !healthStatus.notify_sending && (
                <span className="material-symbols-outlined text-[16px] text-mac-green">check_circle</span>
              )}
            </div>
          </div>
        )}
        {/* Row 1: 本地网关状态卡片 — 全部信息融合 */}
        <div className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] theme-panel px-3 py-2.5 space-y-2">
          {/* Header: icon + name + badges */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center text-primary border border-primary/20 shrink-0 animate-glow-breathe">
              <span className="material-symbols-outlined text-[18px]">router</span>
            </div>
            <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
              <h3 className="text-[var(--color-text)] dark:text-white font-bold text-sm leading-none">{gw.localGateway || 'Local Gateway'}</h3>
              {(() => {
                if (!status?.running) {
                  return (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-mac-yellow/10 text-mac-yellow">
                      <span className="w-1.5 h-1.5 rounded-full bg-mac-yellow" />
                      {gw.stopped}
                    </span>
                  );
                }
                // 进程在跑，但要根据统一观测状态显示真实就绪/恢复/降级
                if (gatewayObservedView.allGreen) {
                  return (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-mac-green/10 text-mac-green">
                      <span className="w-1.5 h-1.5 rounded-full bg-mac-green animate-pulse" />
                      {gw.running}
                    </span>
                  );
                }
                if (gatewayObservedView.recovering) {
                  return (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-amber-500/10 text-amber-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      {gw.obRecovering || 'Gateway recovering...'}
                    </span>
                  );
                }
                return (
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-bold bg-mac-red/10 text-mac-red">
                    <span className="w-1.5 h-1.5 rounded-full bg-mac-red animate-pulse" />
                    {gw.obDegraded || 'Gateway not fully ready'}
                  </span>
                );
              })()}
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500 font-bold font-mono">{localGatewayHost}:{localGatewayPort}</span>
              {status?.runtime && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md theme-field theme-text-muted">{(gw as any)[`runtime_${status.runtime}`] || status.runtime}</span>
              )}
              {status?.running && displayUptimeMs > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-mac-green font-mono font-bold">{fmtUptime(displayUptimeMs)}</span>
              )}
            </div>
            <button
              onClick={() => setGatewayDetailsOpen(v => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg theme-field theme-text-secondary hover:text-primary transition-colors shrink-0 text-[10px] font-bold"
              title={gatewayDetailsOpen ? (gw.collapse || 'Collapse') : (gw.details || 'Details')}
            >
              <span className={`material-symbols-outlined text-[14px] transition-transform ${gatewayDetailsOpen ? 'rotate-180' : ''}`}>expand_more</span>
              {gatewayDetailsOpen ? (gw.collapse || 'Collapse') : (gw.details || 'Details')}
            </button>
            {/* 编辑网关连接参数 */}
            <button
              onClick={() => {
                if (activeProfile) {
                  openEditForm(activeProfile);
                } else {
                  openAddForm();
                }
              }}
              className="p-1.5 rounded-lg hover:bg-slate-200/60 dark:hover:bg-white/[0.06] transition-colors shrink-0"
              title={gw.editGateway || 'Edit Gateway'}
            >
              <span className="material-symbols-outlined text-[16px] theme-text-secondary">edit</span>
            </button>
          </div>
          {/* Detail row: watchdog + WS + probe chips */}
          {gatewayDetailsOpen && (
          <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-200/60 dark:border-white/[0.06]">
            {/* 看门狗探测状态 */}
            {status?.running && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-slate-200/60 dark:border-white/[0.06] theme-panel">
                {(() => {
                  if (!healthCheckEnabled) return <><span className="material-symbols-outlined text-[12px] theme-text-muted">shield_question</span><span className="text-[11px] theme-text-muted">{gw.serviceWatchdogInactive || 'Watchdog inactive'}</span></>;
                  const phase = gatewayProbeState.phase;
                  if (phase === 'restarting') return <><span className="material-symbols-outlined text-[12px] text-mac-red animate-spin">progress_activity</span><span className="text-[11px] font-bold text-mac-red">{gw.wdRestarting || 'Restarting...'}</span></>;
                  if (phase === 'grace') return <><span className="material-symbols-outlined text-[12px] text-amber-500">hourglass_top</span><span className="text-[11px] font-bold text-amber-500">{gw.wdGraceShort || 'Grace'} {(healthStatus?.grace_remaining_sec ?? 0) > 0 ? `${healthStatus!.grace_remaining_sec}s` : ''}</span></>;
                  if (phase === 'degraded') return <><span className="material-symbols-outlined text-[12px] text-mac-red">heart_broken</span><span className="text-[11px] font-bold text-mac-red">{gw.hbUnhealthy} ({healthStatus!.fail_count}/{healthStatus!.max_fails})</span></>;
                  if (gatewayProbeState.fullyHealthy) return <><span className="material-symbols-outlined text-[12px] text-mac-green animate-pulse">favorite</span><span className="text-[11px] font-bold text-mac-green">{gw.hbHealthy}{!gatewayProbeState.readyOk ? <span className="font-normal theme-text-muted ms-1 text-[9px]">Ready...</span> : (healthStatus?.next_check_in_sec ?? 0) > 0 ? <span className="font-normal theme-text-muted ms-1 text-[9px] font-mono">{healthStatus!.next_check_in_sec}s</span> : null}</span></>;
                  if (phase === 'probing') return <><span className="material-symbols-outlined text-[12px] text-mac-yellow animate-spin">progress_activity</span><span className="text-[11px] theme-text-muted">{gw.hbProbing}</span></>;
                  if (!gatewayProbeState.fullyHealthy) return <><span className="material-symbols-outlined text-[12px] text-amber-500">warning</span><span className="text-[11px] font-bold text-amber-500">{gatewayProbeState.hasFailedProbe ? (gw.hbUnhealthy || 'Unhealthy') : (gw.hbProbing || 'Probing')}</span></>;
                  return <><span className="material-symbols-outlined text-[12px] text-mac-green animate-pulse">favorite</span><span className="text-[11px] font-bold text-mac-green">{gw.hbHealthy}{(healthStatus?.next_check_in_sec ?? 0) > 0 ? <span className="font-normal theme-text-muted ms-1 text-[9px] font-mono">{healthStatus!.next_check_in_sec}s</span> : ''}</span></>;
                })()}
              </div>
            )}
            {/* WS 数据通道状态指示器 */}
            {status?.running && gwWsConnected !== null && (
              <div className="relative" ref={wsIndicatorRef}>
                <button
                  onClick={() => setWsIndicatorOpen(v => !v)}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                    gwWsConnected
                      ? 'border-mac-green/30 bg-mac-green/5 hover:bg-mac-green/10'
                      : 'border-mac-red/30 bg-mac-red/5 hover:bg-mac-red/10 animate-pulse'
                  }`}
                  title={gwWsConnected ? (gw.wsConnectedTip || 'WebSocket data channel connected') : (gw.wsDisconnectedTip || 'WebSocket data channel disconnected — click for details')}
                >
                  <span className={`material-symbols-outlined text-[12px] ${gwWsConnected ? 'text-mac-green' : 'text-mac-red'}`}>
                    {gwWsConnected ? 'link' : 'link_off'}
                  </span>
                  <span className={`text-[11px] font-bold ${gwWsConnected ? 'text-mac-green' : 'text-mac-red'}`}>
                    {gwWsConnected ? 'WS' : (gw.wsOff || 'WS Off')}
                  </span>
                  {!gwWsConnected && (gwWsDetail?.reconnect_count ?? 0) > 0 && (
                    <span className="text-[9px] font-mono text-mac-red/70">×{gwWsDetail!.reconnect_count}</span>
                  )}
                  <span className={`material-symbols-outlined text-[10px] transition-transform ${wsIndicatorOpen ? 'rotate-180' : ''} ${gwWsConnected ? 'text-mac-green/60' : 'text-mac-red/60'}`}>expand_more</span>
                </button>
                {/* Expanded detail panel */}
                {wsIndicatorOpen && gwWsDetail && (
                  <div className="absolute top-full mt-1.5 start-0 z-50 w-72 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1c1e24] shadow-xl p-3 space-y-2.5 animate-fade-in" onClick={e => e.stopPropagation()}>
                    {/* Connection status header */}
                    <div className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg ${gwWsConnected ? 'bg-mac-green/5 border border-mac-green/20' : 'bg-mac-red/5 border border-mac-red/20'}`}>
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${gwWsConnected ? 'bg-mac-green/15' : 'bg-mac-red/15'}`}>
                        <span className={`material-symbols-outlined text-[18px] ${gwWsConnected ? 'text-mac-green' : 'text-mac-red'}`}>
                          {gwWsConnected ? 'link' : 'link_off'}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[11px] font-bold ${gwWsConnected ? 'text-mac-green' : 'text-mac-red'}`}>
                          {gwWsConnected ? (gw.svcWsConnected || 'Connected') : (gw.svcWsDisconnected || 'Disconnected')}
                        </p>
                        <p className="text-[9px] text-slate-400 dark:text-white/35 font-mono mt-0.5">
                          {gwWsDetail.host}:{gwWsDetail.port}
                        </p>
                      </div>
                      <button
                        onClick={handleWsReconnect}
                        disabled={wsReconnecting}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/50 font-bold text-[10px] transition-all hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-700 dark:hover:text-white disabled:opacity-40 shrink-0"
                      >
                        <span className={`material-symbols-outlined text-[13px] ${wsReconnecting ? 'animate-spin' : ''}`}>
                          {wsReconnecting ? 'progress_activity' : 'refresh'}
                        </span>
                        {gw.svcWsReconnect || 'Reconnect'}
                      </button>
                    </div>
                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/50 dark:border-white/[0.05]">
                        <p className="text-[8px] text-slate-400 dark:text-white/30 uppercase tracking-wider">{gw.svcWsReconnects || 'Reconnects'}</p>
                        <p className="text-[11px] font-bold font-mono text-slate-600 dark:text-white/70">{gwWsDetail.reconnect_count ?? 0}</p>
                      </div>
                      <div className="px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/50 dark:border-white/[0.05]">
                        <p className="text-[8px] text-slate-400 dark:text-white/30 uppercase tracking-wider">{gw.svcWsBackoff || 'Backoff'}</p>
                        <p className="text-[11px] font-bold font-mono text-slate-600 dark:text-white/70">
                          {(gwWsDetail.backoff_ms ?? 0) >= 1000 ? `${((gwWsDetail.backoff_ms ?? 0) / 1000).toFixed(1)}s` : `${gwWsDetail.backoff_ms ?? 0}ms`}
                        </p>
                      </div>
                    </div>
                    {/* Auto-approve pairing */}
                    {gwWsDetail.pairing_auto_approve && (
                      <div className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[13px] text-amber-400 animate-spin">progress_activity</span>
                        <p className="text-[10px] font-bold text-amber-400">{gw.svcWsAutoApproving || 'Auto-approving device pairing...'}</p>
                      </div>
                    )}
                    {/* Last error + diagnostic hint */}
                    {gwWsDetail.last_error && !gwWsDetail.pairing_auto_approve && (
                      <div className="px-2.5 py-1.5 rounded-lg bg-mac-red/5 border border-mac-red/15 space-y-1">
                        <p className="text-[8px] text-slate-400 dark:text-white/30 uppercase tracking-wider mb-0.5">{gw.svcWsLastError || 'Last Error'}</p>
                        <p className="text-[9px] font-mono text-mac-red/80 break-all leading-relaxed">{gwWsDetail.last_error}</p>
                        {(() => {
                          const err = (gwWsDetail.last_error || '').toLowerCase();
                          let hint = '';
                          if (err.includes('actively refused') || err.includes('connection refused') || err.includes('connectex')) {
                            hint = gw.wsDiagRefused || 'Gateway port is not listening. Check if the gateway process is running and the port is correct.';
                          } else if (err.includes('forcibly closed') || err.includes('connection reset') || err.includes('wsarecv')) {
                            hint = gw.wsDiagForceClosed || 'Connection was rejected by the remote host. Check token, TLS/SSL settings, or firewall/proxy configuration.';
                          } else if (err.includes('timeout') || err.includes('timed out') || err.includes('deadline exceeded')) {
                            hint = gw.wsDiagTimeout || 'Connection timed out. The gateway may be overloaded, or a firewall/NAT is blocking the connection.';
                          } else if (err.includes('no such host') || err.includes('dns') || err.includes('getaddrinfo')) {
                            hint = gw.wsDiagDns || 'DNS resolution failed. Check hostname spelling and network DNS settings.';
                          } else if (err.includes('certificate') || err.includes('tls') || err.includes('x509')) {
                            hint = gw.wsDiagTls || 'TLS/SSL certificate error. Verify the gateway SSL configuration or switch to non-TLS connection.';
                          } else if (err.includes('401') || err.includes('403') || err.includes('unauthorized') || err.includes('forbidden')) {
                            hint = gw.wsDiagAuth || 'Authentication failed. Verify the gateway token in profile settings.';
                          } else if (err.includes('network is unreachable') || err.includes('no route')) {
                            hint = gw.wsDiagNetwork || 'Network unreachable. Check your network connection and gateway host address.';
                          }
                          if (!hint) return null;
                          return (
                            <p className="text-[9px] text-amber-600 dark:text-amber-400 leading-relaxed flex items-start gap-1">
                              <span className="material-symbols-outlined text-[10px] text-amber-500 mt-px shrink-0">lightbulb</span>
                              {hint}
                            </p>
                          );
                        })()}
                      </div>
                    )}
                    {/* 多阶段连接过程 */}
                    {!gwWsConnected && (
                      <div className="px-2.5 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/15 space-y-1">
                        {(() => {
                          const phase = gwWsDetail.phase || 'disconnected';
                          const rc = gwWsDetail.reconnect_count ?? 0;
                          const bms = gwWsDetail.backoff_ms ?? 0;
                          const bFmt = bms >= 1000 ? `${(bms / 1000).toFixed(1)}s` : `${bms}ms`;
                          const steps: { key: string; icon: string; label: string; active: boolean; color: string }[] = [
                            {
                              key: 'connect', active: phase === 'reconnecting' || phase === 'disconnected',
                              icon: phase === 'reconnecting' ? 'progress_activity' : phase === 'disconnected' ? 'cloud_off' : 'cloud_done',
                              label: phase === 'reconnecting' ? `${gw.wsRetrying || 'Auto-reconnecting'}${rc > 0 ? ` #${rc}` : ''}${bms > 0 ? ` — ${bFmt} ${gw.wsRetryDelay || 'delay'}` : ''}` : phase === 'disconnected' ? (gw.wsWaitingRetry || 'Waiting for auto-reconnect...') : (gw.wsStepConnected || 'TCP connected'),
                              color: phase === 'reconnecting' ? 'text-amber-500 dark:text-amber-400' : phase === 'disconnected' ? 'theme-text-muted' : 'text-mac-green',
                            },
                            {
                              key: 'pairing', active: phase === 'pairing',
                              icon: phase === 'pairing' ? 'progress_activity' : 'radio_button_unchecked',
                              label: phase === 'pairing' ? (gw.wsPhasePairing || 'Auto-approving device pairing...') : (gw.wsStepPairing || 'Device pairing'),
                              color: phase === 'pairing' ? 'text-amber-500 dark:text-amber-400' : 'theme-text-muted',
                            },
                            {
                              key: 'auth', active: phase === 'auth_refresh',
                              icon: phase === 'auth_refresh' ? 'progress_activity' : 'radio_button_unchecked',
                              label: phase === 'auth_refresh' ? (gw.wsPhaseAuthRefresh || 'Refreshing auth token...') : (gw.wsStepAuth || 'Authentication'),
                              color: phase === 'auth_refresh' ? 'text-amber-500 dark:text-amber-400' : 'theme-text-muted',
                            },
                          ];
                          return steps.map(step => (
                            <div key={step.key} className={`flex items-center gap-1 text-[9px] ${step.color} ${step.active ? 'font-bold' : ''}`}>
                              <span className={`material-symbols-outlined text-[10px] ${step.active && step.icon === 'progress_activity' ? 'animate-spin' : ''}`}>{step.icon}</span>
                              {step.label}
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* Probe chips — inline with other status indicators */}
            {!initialDetecting && healthCheckEnabled && healthStatus?.probe && [
              {
                key: 'tcp',
                label: `TCP${healthStatus.probe.tcp_latency_ms != null ? ` ${healthStatus.probe.tcp_latency_ms}ms` : ''}`,
                ok: !!healthStatus.probe.tcp_reachable,
                detail: healthStatus.probe.tcp_error,
              },
              {
                key: 'health',
                label: `/health${healthStatus.probe.live?.status_code ? ` ${healthStatus.probe.live.status_code}` : ''}`,
                ok: !!healthStatus.probe.live?.ok,
                detail: healthStatus.probe.live?.error,
              },
              {
                key: 'ready',
                label: `/ready${healthStatus.probe.ready?.status_code ? ` ${healthStatus.probe.ready.status_code}` : ''}`,
                ok: !!healthStatus.probe.ready?.ok,
                detail: healthStatus.probe.ready?.error,
              },
            ].map(step => (
              <span
                key={step.key}
                className={`inline-flex items-center gap-1 text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border transition-colors ${
                  step.ok
                    ? 'border-mac-green/25 bg-mac-green/5 text-mac-green'
                    : 'border-amber-500/25 bg-amber-500/5 text-amber-500'
                } ${step.detail ? 'cursor-help' : ''}`}
                title={step.detail || ''}
              >
                <span className="material-symbols-outlined text-[11px]">{step.ok ? 'check_circle' : 'warning'}</span>
                {step.label}
              </span>
            ))}
          </div>
          )}
        </div>

        {/* Row 2: 操作按钮 — 单行紧凑 */}
        {(() => {
          const remote = false;
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
              <button onClick={() => handleAction('restart')} disabled={!!actionLoading}
                className="flex items-center gap-1 px-2.5 py-1 bg-primary text-white rounded-lg font-bold text-[10px] transition-all disabled:opacity-40"
                title={gw.smartRestartTip || 'Smart restart: safe when RPC is online, hard restart as fallback'}>
                <span className={`material-symbols-outlined text-[14px] ${actionLoading === 'restart' ? 'animate-spin' : ''}`}>{actionLoading === 'restart' ? 'progress_activity' : 'refresh'}</span>{gw.restart}
              </button>
              <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-0.5" />
              {/* Watchdog toggle */}
              <button onClick={toggleHealthCheck} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${healthCheckEnabled ? 'bg-mac-green/10 text-mac-green' : 'theme-field theme-text-muted'}`}>
                <span className="material-symbols-outlined text-[14px]">{healthCheckEnabled ? 'monitor_heart' : 'heart_minus'}</span>
                {gw.healthCheck || 'Watchdog'}
              </button>
              <button
                onClick={() => setWatchdogAdvancedOpen(v => !v)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${watchdogAdvancedOpen ? 'bg-primary/15 text-primary' : 'theme-field theme-text-secondary'}`}
              >
                <span className="material-symbols-outlined text-[14px]">tune</span>
                {gw.watchdogAdvanced || 'Advanced'}
              </button>
              <div className="w-px h-4 bg-slate-200 dark:bg-white/10 mx-0.5" />
              <button
                onClick={() => setShowOptimizeWizard(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-all"
              >
                <span className="material-symbols-outlined text-[14px]">bolt</span>
                {gw.optimize?.btn || 'Optimize'}
              </button>
            </div>
          );
        })()}
        {watchdogAdvancedOpen && (
          <div className="mt-1 rounded-lg border border-slate-200 dark:border-white/10 theme-panel p-1.5">
            <div className="flex flex-wrap items-end gap-x-2 gap-y-1.5">
              <label className="text-[10px] theme-text-secondary whitespace-nowrap">
                <span className="block mb-0.5">{gw.watchdogInterval || 'Interval(s)'}</span>
                <NumberStepper
                  value={watchdogIntervalSec}
                  onChange={setWatchdogIntervalSec}
                  min={5} max={300} step={1}
                  className="h-6 w-[100px]"
                  inputClassName="text-[10px] px-0.5"
                  buttonClassName="!w-5 text-[10px]"
                />
              </label>
              <label className="text-[10px] theme-text-secondary whitespace-nowrap">
                <span className="block mb-0.5">{gw.watchdogMaxFails || 'Max fails'}</span>
                <NumberStepper
                  value={watchdogMaxFails}
                  onChange={setWatchdogMaxFails}
                  min={1} max={20} step={1}
                  className="h-6 w-[80px]"
                  inputClassName="text-[10px] px-0.5"
                  buttonClassName="!w-5 text-[10px]"
                />
              </label>
              <label className="text-[10px] theme-text-secondary whitespace-nowrap">
                <span className="block mb-0.5">{gw.watchdogBackoffCap || 'Backoff cap(s)'}</span>
                <NumberStepper
                  value={watchdogBackoffCapSec}
                  onChange={setWatchdogBackoffCapSec}
                  min={1} max={6000} step={5}
                  className="h-6 w-[100px]"
                  inputClassName="text-[10px] px-0.5"
                  buttonClassName="!w-5 text-[10px]"
                />
              </label>
              <label className="text-[10px] theme-text-secondary whitespace-nowrap">
                <span className="block mb-0.5">{gw.watchdogGrace || 'Restart grace(s)'}</span>
                <NumberStepper
                  value={watchdogGraceSec}
                  onChange={setWatchdogGraceSec}
                  min={10} max={600} step={10}
                  className="h-6 w-[100px]"
                  inputClassName="text-[10px] px-0.5"
                  buttonClassName="!w-5 text-[10px]"
                />
              </label>
              <div className="flex items-end gap-1.5 ms-auto">
                <button
                  onClick={() => {
                    setWatchdogIntervalSec('30');
                    setWatchdogMaxFails('3');
                    setWatchdogBackoffCapSec('30');
                    setWatchdogGraceSec('120');
                  }}
                  className="h-6 px-2 rounded text-[10px] font-bold theme-field theme-text-secondary whitespace-nowrap"
                >
                  {gw.watchdogResetDefaults || 'Defaults'}
                </button>
                <button
                  onClick={() => { void saveWatchdogAdvanced(); }}
                  disabled={watchdogSaving}
                  className="h-6 px-2 rounded text-[10px] font-bold bg-primary text-white disabled:opacity-50 whitespace-nowrap"
                >
                  {watchdogSaving ? (gw.saving || '...') : (gw.watchdogApply || gw.save || 'Apply')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 日志 & 调试区 */}
      <div className="flex-1 flex flex-col theme-panel border-t border-slate-200 dark:border-white/10 overflow-hidden sci-card">
        {/* Tab Bar + Search + Filters — 单行紧凑 */}
        <div className="shrink-0 min-h-9 flex items-center gap-1.5 px-3 theme-field border-b border-slate-200 dark:border-white/5 overflow-x-auto scrollbar-none">
          {/* Tabs */}
          {(['logs', 'events', 'channels', 'dreams', 'service', 'debug'] as const).map(tab => {
            const icons: Record<string, string> = { logs: 'terminal', events: 'event_note', channels: 'cell_tower', dreams: 'nights_stay', service: 'settings_system_daydream', debug: 'bug_report' };
            const labels: Record<string, string> = { logs: gw.logs, events: eventsLabel, channels: gw.channels || 'Channels', dreams: gw.dreams?.tab || 'Dreams', service: gw.service || 'Service', debug: gw.debug };
            return (
              <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'debug') fetchDebugData(); if (tab === 'events') fetchEvents(); if (tab === 'channels') fetchChannels(true); }}
                className={`px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-all whitespace-nowrap shrink-0 ${activeTab === tab ? 'bg-primary/15 text-primary' : 'theme-text-muted hover:text-[var(--color-text)] dark:hover:text-white/60'} flex items-center gap-1`}>
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
              <div className="w-px h-4 theme-divider mx-0.5" />
              {/* Search */}
              <div className="relative flex-1 min-w-[100px] max-w-[200px]">
                <span className="material-symbols-outlined absolute start-1.5 top-1/2 -translate-y-1/2 theme-text-muted text-[12px]">search</span>
                <input value={logSearch} onChange={e => setLogSearch(e.target.value)} placeholder={gw.search}
                  className="w-full h-6 ps-6 pe-2 theme-field rounded text-[11px] theme-text-secondary placeholder:theme-text-muted focus:ring-1 focus:ring-primary/50 outline-none sci-input" />
              </div>
              {/* Level Filters — 包含模式：空=全显示，单击独选，Ctrl/Cmd+点击多选 */}
              <div className="flex items-center gap-px">
                {['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map(lvl => {
                  const colors: Record<string, string> = { trace: 'bg-slate-500', debug: 'bg-slate-400', info: 'bg-blue-500', warn: 'bg-yellow-500', error: 'bg-red-500', fatal: 'bg-red-700' };
                  const isActive = levelFilters.has(lvl);
                  const hasFilter = levelFilters.size > 0;
                  return (
                    <button key={lvl} onClick={(e) => setLevelFilters(prev => {
                      if (e.ctrlKey || e.metaKey) {
                        const next = new Set(prev);
                        if (next.has(lvl)) next.delete(lvl); else next.add(lvl);
                        return next;
                      }
                      if (prev.size === 1 && prev.has(lvl)) return new Set();
                      return new Set([lvl]);
                    })}
                      className={`px-1.5 py-0.5 rounded text-[11px] font-bold uppercase transition-all ${!hasFilter ? `${colors[lvl]}/20 theme-text-secondary` : isActive ? `${colors[lvl]}/20 theme-text-secondary ring-1 ring-current` : 'theme-field theme-text-muted opacity-40'}`}>
                      {lvl.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
              {/* Log limit switcher */}
              <div className="w-px h-4 theme-divider mx-0.5" />
              <div className="flex items-center gap-px">
                {[120, 500, 1000].map(n => (
                  <button key={n} onClick={() => { setLogLimit(n); logCursorRef.current = undefined; logInitializedRef.current = false; fetchLogs(true); }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${logLimit === n ? 'bg-primary/10 text-primary' : 'theme-field theme-text-muted hover:text-[var(--color-text-secondary)]'}`}>{n}</button>
                ))}
              </div>
              {/* Spacer */}
              <div className="flex-1" />
              {/* Actions */}
              <button onClick={handleClearLogs} className="theme-text-muted hover:text-[var(--color-text)] transition-colors" title={gw.clear}>
                <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
              </button>
              <button onClick={() => { const blob = new Blob([filteredLogs.map(item => item.line).join('\n')], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `gateway-logs-${Date.now()}.txt`; a.click(); }}
                className="theme-text-muted hover:text-[var(--color-text)] transition-colors" title={gw.export}>
                <span className="material-symbols-outlined text-[14px]">download</span>
              </button>
              <button onClick={() => setAutoFollow(!autoFollow)}
                className={`p-0.5 rounded transition-all ${autoFollow ? 'text-primary' : 'theme-text-muted hover:text-[var(--color-text)]'}`} title={gw.autoFollow}>
                <span className="material-symbols-outlined text-[14px]">{autoFollow ? 'vertical_align_bottom' : 'pause'}</span>
              </button>
            </>
          )}
        </div>

        {/* Content Area */}
        {activeTab === 'logs' ? (
          <>
            <div className="flex-1 overflow-y-auto font-mono text-[11px] md:text-[12px] p-4 custom-scrollbar neon-scrollbar bg-[var(--color-surface)] dark:bg-transparent">
              {filteredLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full theme-text-muted/50">
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
                    <div key={idx} className="flex gap-2 md:gap-3 mb-0.5 group leading-relaxed hover:bg-slate-100 dark:hover:bg-white/[0.02] rounded px-1 -mx-1">
                      <span className="text-slate-300 dark:text-white/10 select-none w-6 md:w-8 text-end shrink-0 text-[10px]">{lineNum}</span>
                      <span className={`flex-1 text-slate-600 dark:text-white/60 break-all ${log.includes('ERROR') || log.includes('error') ? 'text-red-500 dark:text-red-400' : log.includes('WARN') || log.includes('warn') ? 'text-amber-500 dark:text-yellow-400' : ''}`}>{highlightText(log)}</span>
                      <button onClick={() => copyLogLine(log)} className="opacity-0 group-hover:opacity-100 text-slate-300 dark:text-white/20 hover:text-slate-700 dark:hover:text-white shrink-0 transition-opacity" title="Copy">
                        <span className="material-symbols-outlined text-[12px]">content_copy</span>
                      </button>
                    </div>
                  );
                }
                const lvlColor = parsed.level === 'error' || parsed.level === 'fatal' ? 'text-red-500 dark:text-red-400' : parsed.level === 'warn' ? 'text-amber-500 dark:text-yellow-400' : parsed.level === 'debug' || parsed.level === 'trace' ? 'text-slate-400 dark:text-white/30' : 'text-slate-600 dark:text-white/60';
                const lvlBg = parsed.level === 'error' || parsed.level === 'fatal' ? 'bg-red-500/15' : parsed.level === 'warn' ? 'bg-yellow-500/15' : parsed.level === 'info' ? 'bg-blue-500/10' : 'bg-slate-100 dark:bg-white/5';
                const hasLongExtra = parsed.extra && parsed.extra.length > 80;
                const isExtraExpanded = expandedExtras.has(idx);
                return (
                  <div key={idx} className="flex gap-2 md:gap-3 mb-0.5 group leading-relaxed hover:bg-slate-100 dark:hover:bg-white/[0.02] rounded px-1 -mx-1">
                    <span className="text-slate-300 dark:text-white/10 select-none w-6 md:w-8 text-end shrink-0 text-[10px]">{lineNum}</span>
                    <div className="flex-1 break-all">
                      {parsed.time && <span className="text-cyan-600/70 dark:text-cyan-400/50 me-2">{parsed.time}</span>}
                      <span className={`inline-block px-1 rounded text-[11px] font-bold uppercase me-2 ${lvlColor} ${lvlBg}`}>{parsed.level}</span>
                      {parsed.component && <span className="text-purple-600/70 dark:text-purple-400/60 me-2">[{parsed.component}]</span>}
                      <span className={lvlColor}>{highlightText(parsed.message)}</span>
                      {parsed.extra && (
                        hasLongExtra && !isExtraExpanded ? (
                          <button onClick={() => setExpandedExtras(prev => { const n = new Set(prev); n.add(idx); return n; })}
                            className="text-slate-400 dark:text-white/20 ms-2 text-[10px] hover:text-slate-500 dark:hover:text-white/40">{parsed.extra.slice(0, 80)}… <span className="text-primary/60">▸</span></button>
                        ) : (
                          <span className="text-slate-400 dark:text-white/20 ms-2 text-[10px]">{parsed.extra}
                            {hasLongExtra && <button onClick={() => setExpandedExtras(prev => { const n = new Set(prev); n.delete(idx); return n; })} className="text-primary/60 ms-1">▾</button>}
                          </span>
                        )
                      )}
                    </div>
                    <button onClick={() => copyLogLine(log)} className="opacity-0 group-hover:opacity-100 text-slate-300 dark:text-white/20 hover:text-slate-700 dark:hover:text-white shrink-0 transition-opacity" title="Copy">
                      <span className="material-symbols-outlined text-[12px]">content_copy</span>
                    </button>
                  </div>
                );
              })}
              <div ref={logEndRef} />
            </div>
            <div className="h-7 theme-field px-4 flex items-center justify-between text-[11px] theme-text-muted font-bold uppercase shrink-0 border-t border-slate-200 dark:border-white/5">
              <div className="flex gap-4">
                <span>{filteredLogs.length}{filteredLogs.length !== visibleLogs.length ? `/${visibleLogs.length}` : ''} {gw.lines}</span>
                {omittedLogCount > 0 && <span>+{omittedLogCount}</span>}
                {logStats.errors > 0 && <span className="text-red-500 dark:text-red-400">{logStats.errors} ERR</span>}
                {logStats.warns > 0 && <span className="text-amber-500 dark:text-yellow-400">{logStats.warns} WARN</span>}
                <span className="text-primary">{localGatewayHost}:{localGatewayPort}</span>
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
            channelLogoutLoading={channelLogoutLoading} channelStopLoading={channelStopLoading}
            fetchChannels={fetchChannels} handleChannelLogout={handleChannelLogout} handleChannelStop={handleChannelStop}
          />
        ) : activeTab === 'dreams' ? (
          <DreamsPanel gw={gw} toast={toast} />
        ) : activeTab === 'service' ? (
          <ServicePanel
            status={status}
            healthCheckEnabled={healthCheckEnabled}
            healthStatus={healthStatus}
            gw={gw}
            onCopy={(text) => { copyToClipboard(text).then(() => toast('success', gw.serviceCopied || 'Copied')).catch(() => {}); }}
            toast={toast}
            remote={false}
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
