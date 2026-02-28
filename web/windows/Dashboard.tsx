
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { dashboardApi, gwApi, hostInfoApi, configApi } from '../services/api';
import { useGatewayEvents } from '../hooks/useGatewayEvents';

interface DashboardProps {
  language: Language;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(0);
}

function fmtCost(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return '<$0.01';
  return '$' + n.toFixed(2);
}

function fmtUptime(ms: number, units: { d: string; h: string; m: string; s: string }): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}${units.s}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${units.m}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${units.h} ${m % 60}${units.m}`;
  const d = Math.floor(h / 24);
  return `${d}${units.d} ${h % 24}${units.h}`;
}

function fmtPresenceAge(
  ts: number,
  labels: { justNow: string; minAgo: string; hourAgo: string; dayAgo: string },
): string {
  const diff = Date.now() - ts;
  const format = (tpl: string, n: number) => tpl.replace('{{n}}', String(n));
  if (diff < 60_000) return labels.justNow;
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return format(labels.minAgo, mins);
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return format(labels.hourAgo, hrs);
  return format(labels.dayAgo, Math.round(hrs / 24));
}

function MiniSparkline({ data, color, h = 32, w = 80 }: { data: number[]; color: string; h?: number; w?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / Math.max(data.length - 1, 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs><linearGradient id={`dg-${color.replace(/[^a-z0-9]/gi,'')}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.25"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      <polygon points={`${pts} ${w},${h} 0,${h}`} fill={`url(#dg-${color.replace(/[^a-z0-9]/gi,'')})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function fmtUptimeYMDH(ms: number, units: { y: string; mo: string; d: string; h: string }): string {
  const totalSec = Math.floor(ms / 1000);
  const totalMin = Math.floor(totalSec / 60);
  const totalHr = Math.floor(totalMin / 60);
  const totalDay = Math.floor(totalHr / 24);
  const years = Math.floor(totalDay / 365);
  const months = Math.floor((totalDay % 365) / 30);
  const days = (totalDay % 365) % 30;
  const hours = totalHr % 24;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}${units.y}`);
  if (months > 0) parts.push(`${months}${units.mo}`);
  if (days > 0) parts.push(`${days}${units.d}`);
  parts.push(`${hours}${units.h}`);
  return parts.join(' ');
}

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(1) + ' GB';
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(1) + ' MB';
  if (b >= 1_024) return (b / 1_024).toFixed(1) + ' KB';
  return b + ' B';
}

function HealthDot({ ok }: { ok: boolean }) {
  return <div className={`w-2.5 h-2.5 rounded-full ${ok ? 'bg-mac-green motion-safe:animate-pulse' : 'bg-slate-400'} shadow-sm`} />;
}

const Dashboard: React.FC<DashboardProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const d = (t as any).dash as any;
  const locale = String(language || 'en');
  const HOST_INFO_CACHE_KEY = 'dashboard.hostInfo.cache.v1';

  const readCachedHostInfo = (): any | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(HOST_INFO_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const writeCachedHostInfo = (data: any) => {
    if (typeof window === 'undefined' || !data) return;
    try {
      window.localStorage.setItem(HOST_INFO_CACHE_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage errors and keep UI responsive.
    }
  };

  // O2: Single state object - one setState call per fetch cycle.
  interface DashState {
    data: any; gwStatus: any; sessions: any[]; models: any[]; skills: any[];
    agents: any[]; cronStatus: any; channels: any; usageCost: any; health: any;
    instances: any[]; hostInfo: any; userConfig: any;
  }
  const [ds, setDs] = useState<DashState>({
    data: null, gwStatus: null, sessions: [], models: [], skills: [],
    agents: [], cronStatus: null, channels: null, usageCost: null, health: null,
    instances: [], hostInfo: readCachedHostInfo(), userConfig: null,
  });
  // O1+O4: Split loading state into initial load and refresh.
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [hasPartialFailure, setHasPartialFailure] = useState(false);
  const [hasFetchError, setHasFetchError] = useState(false);

  // O3: Abort flag - skip setState after unmount.
  const abortRef = useRef(false);
  const fastFetchingRef = useRef(false);
  const slowFetchingRef = useRef(false);
  const hostFetchingRef = useRef(false);
  const bootstrappedRef = useRef(false);

  const fetchFast = useCallback(async () => {
    if (fastFetchingRef.current) return;
    fastFetchingRef.current = true;
    const settle = async <T,>(p: Promise<T>): Promise<{ ok: true; data: T } | { ok: false; data: null }> => {
      try {
        return { ok: true, data: await p };
      } catch {
        return { ok: false, data: null };
      }
    };

    try {
      const [dashRes, gwStatusRes, channelsRes, healthRes, presenceRes] = await Promise.all([
        settle(dashboardApi.get()),
        settle(gwApi.status()),
        settle(gwApi.channels()),
        settle(gwApi.health()),
        settle(gwApi.proxy('system-presence', {})),
      ]);
      if (abortRef.current) return;

      const results = [dashRes, gwStatusRes, channelsRes, healthRes, presenceRes];
      const hadFailure = results.some((r) => !r.ok);
      const allFailed = results.every((r) => !r.ok);
      setHasPartialFailure(hadFailure && !allFailed);
      setHasFetchError(allFailed);

      setDs(prev => ({
        ...prev,
        data: dashRes.data ?? prev.data,
        gwStatus: gwStatusRes.data ?? prev.gwStatus,
        channels: channelsRes.data ?? prev.channels,
        health: healthRes.data ?? prev.health,
        instances: presenceRes.data ? (Array.isArray(presenceRes.data) ? presenceRes.data : []) : prev.instances,
      }));
      setLastUpdate(new Date());
      if (!bootstrappedRef.current) {
        bootstrappedRef.current = true;
        setInitialLoading(false);
      }
    } catch {
      if (!abortRef.current) {
        setHasFetchError(true);
        setInitialLoading(false);
      }
    } finally {
      fastFetchingRef.current = false;
    }
  }, []);

  const fetchSlow = useCallback(async () => {
    if (slowFetchingRef.current) return;
    slowFetchingRef.current = true;
    const settle = async <T,>(p: Promise<T>): Promise<{ ok: true; data: T } | { ok: false; data: null }> => {
      try {
        return { ok: true, data: await p };
      } catch {
        return { ok: false, data: null };
      }
    };

    try {
      const [sessRes, modelsRes, skillsRes, agentsRes, cronRes, costRes, gwCfgRes] = await Promise.all([
        settle(gwApi.sessions()),
        settle(gwApi.models()),
        settle(gwApi.skills()),
        settle(gwApi.agents()),
        settle(gwApi.cronStatus()),
        settle(gwApi.usageCost({ days: 7 })),
        settle(gwApi.configGet()),
      ]);
      if (abortRef.current) return;

      let cfgObj = gwCfgRes.data?.config || gwCfgRes.data;
      if (!cfgObj || typeof cfgObj !== 'object' || !cfgObj.models) {
        const localCfgRes = await settle(configApi.get());
        cfgObj = localCfgRes.data?.config || localCfgRes.data;
      }
      if (abortRef.current) return;

      const results = [sessRes, modelsRes, skillsRes, agentsRes, cronRes, costRes];
      const hadFailure = results.some((r) => !r.ok);
      if (hadFailure) setHasPartialFailure(true);

      const sessData = sessRes.data as any;
      const modelsData = modelsRes.data as any;
      const skillsData = skillsRes.data as any;
      const agentsData = agentsRes.data as any;
      setDs(prev => ({
        ...prev,
        sessions: sessData ? (Array.isArray(sessData) ? sessData : sessData?.sessions || []) : prev.sessions,
        models: modelsData ? (Array.isArray(modelsData) ? modelsData : modelsData?.list || modelsData?.models || []) : prev.models,
        skills: skillsData ? (Array.isArray(skillsData) ? skillsData : skillsData?.skills || []) : prev.skills,
        agents: agentsData ? (Array.isArray(agentsData) ? agentsData : agentsData?.agents || []) : prev.agents,
        cronStatus: cronRes.data ?? prev.cronStatus,
        usageCost: costRes.data ?? prev.usageCost,
        userConfig: cfgObj ?? prev.userConfig,
      }));
    } finally {
      slowFetchingRef.current = false;
    }
  }, []);

  const fetchHostInfo = useCallback(async () => {
    if (hostFetchingRef.current) return;
    hostFetchingRef.current = true;
    try {
      const hostRes = await hostInfoApi.get();
      if (abortRef.current || !hostRes) return;
      setDs(prev => ({ ...prev, hostInfo: hostRes }));
      writeCachedHostInfo(hostRes);
    } catch {
      setHasPartialFailure(true);
    } finally {
      hostFetchingRef.current = false;
    }
  }, []);

  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchFast();
      void fetchSlow();
      void fetchHostInfo();
    } finally {
      if (!abortRef.current) setRefreshing(false);
    }
  }, [fetchFast, fetchHostInfo, fetchSlow, refreshing]);

  useEffect(() => {
    abortRef.current = false;
    fetchFast();
    // Defer heavier requests to keep first paint responsive.
    const slowBootTimer = setTimeout(() => { fetchSlow(); }, 300);
    const hostBootTimer = setTimeout(() => { fetchHostInfo(); }, 800);
    let fastTimer: ReturnType<typeof setInterval> | null = setInterval(fetchFast, 15000);
    let slowTimer: ReturnType<typeof setInterval> | null = setInterval(fetchSlow, 90000);
    let hostTimer: ReturnType<typeof setInterval> | null = setInterval(fetchHostInfo, 300000);
    const onVisibility = () => {
      if (document.hidden) {
        if (fastTimer) { clearInterval(fastTimer); fastTimer = null; }
        if (slowTimer) { clearInterval(slowTimer); slowTimer = null; }
        if (hostTimer) { clearInterval(hostTimer); hostTimer = null; }
      } else {
        if (!fastTimer) fastTimer = setInterval(fetchFast, 15000);
        if (!slowTimer) slowTimer = setInterval(fetchSlow, 90000);
        if (!hostTimer) hostTimer = setInterval(fetchHostInfo, 300000);
        fetchFast();
        setTimeout(() => { if (!abortRef.current) fetchSlow(); }, 200);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      abortRef.current = true;
      fastFetchingRef.current = false;
      slowFetchingRef.current = false;
      hostFetchingRef.current = false;
      clearTimeout(slowBootTimer);
      clearTimeout(hostBootTimer);
      if (fastTimer) clearInterval(fastTimer);
      if (slowTimer) clearInterval(slowTimer);
      if (hostTimer) clearInterval(hostTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchFast, fetchHostInfo, fetchSlow]);

  // Real-time gateway events: shutdown marks offline, health updates snapshot.
  useGatewayEvents(useMemo(() => ({
    shutdown: () => {
      setDs(prev => ({ ...prev, gwStatus: { ...prev.gwStatus, running: false, connected: false }, health: null }));
    },
    health: (p) => {
      setDs(prev => ({ ...prev, health: p ?? prev.health }));
    },
    cron: () => {
      gwApi.cronStatus().then(d => { if (!abortRef.current) setDs(prev => ({ ...prev, cronStatus: d ?? prev.cronStatus })); }).catch(() => {});
    },
  }), []));

  // Destructure for downstream compatibility
  const { data, gwStatus, sessions, models, skills, agents, cronStatus, channels, usageCost, health, instances, hostInfo, userConfig } = ds;
  const loading = initialLoading || refreshing;

  const gwRunning = gwStatus?.running || gwStatus?.connected || data?.gateway?.running || false;
  const uptimeMs = health?.snapshot?.uptimeMs || health?.uptimeMs || 0;
  const tickMs = health?.snapshot?.policy?.tickIntervalMs || 0;
  const alerts = (data?.recent_alerts || []).slice(0, 4);
  const dailyCost = usageCost?.daily || [];
  const totalCostVal = usageCost?.totals?.totalCost || 0;
  const totalTokensVal = usageCost?.totals?.totalTokens || 0;
  const todayCostEntry = dailyCost.length > 0 ? dailyCost[dailyCost.length - 1] : null;
  const channelsRaw = channels?.channels ?? channels?.list ?? channels;
  const channelsList = useMemo(() => {
    if (Array.isArray(channelsRaw)) return channelsRaw;
    if (channelsRaw && typeof channelsRaw === 'object') {
      return Object.entries(channelsRaw).map(([name, item]) => (
        item && typeof item === 'object'
          ? { name, ...(item as Record<string, any>) }
          : { name, value: item }
      ));
    }
    return [];
  }, [channelsRaw]);
  const configuredChannels = useMemo(() => {
    const cfgChannels = userConfig?.channels;
    if (!cfgChannels || typeof cfgChannels !== 'object') return [];
    return Object.keys(cfgChannels).filter((k) => cfgChannels[k]?.enabled !== false);
  }, [userConfig]);
  const activeChannels = channelsList.filter((c: any) => {
    const s = String(c?.status || c?.state || '').toLowerCase();
    return c?.enabled !== false && (c?.connected || c?.running || s === 'connected' || s === 'running' || s === 'ready' || s === 'online');
  }).length;
  const totalChannels = channelsList.length > 0 ? channelsList.length : configuredChannels.length;
  const cronJobs = cronStatus?.jobs || cronStatus?.schedules || [];
  const cronEnabled = cronStatus?.enabled ?? (Array.isArray(cronJobs) && cronJobs.length > 0);
  const eligibleSkills = Array.isArray(skills) ? skills.filter((s: any) => s.eligible || s.enabled).length : 0;
  const presenceLabels = {
    justNow: d.presenceJustNow,
    minAgo: d.presenceMinAgo,
    hourAgo: d.presenceHourAgo,
    dayAgo: d.presenceDayAgo,
  };
  const uptimeUnits = {
    d: d.unitDay,
    h: d.unitHour,
    m: d.unitMinute,
    s: d.unitSecond,
  };
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  );
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    [locale],
  );

  // User-configured models (from openclaw.json).
  const userProviderModels = useMemo(() => {
    const result: { provider: string; models: { id: string; name?: string }[] }[] = [];
    const providers = userConfig?.models?.providers;
    if (providers && typeof providers === 'object') {
      for (const [pName, pCfg] of Object.entries(providers) as [string, any][]) {
        const ms = Array.isArray(pCfg?.models) ? pCfg.models : [];
        const modelList = ms.map((m: any) => ({ id: typeof m === 'string' ? m : m?.id, name: typeof m === 'object' ? m?.name : undefined })).filter((m: any) => m.id);
        if (modelList.length > 0) result.push({ provider: pName, models: modelList });
      }
    }
    return result;
  }, [userConfig]);
  const userModelCount = userProviderModels.reduce((sum, p) => sum + p.models.length, 0);

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-5 custom-scrollbar bg-slate-50/50 dark:bg-transparent">
      {/* Header */}
      <div className="flex items-start sm:items-center justify-between gap-2 mb-4">
        <div>
          <h1 className="text-base font-bold dark:text-white/90 text-slate-800">{d.overview}</h1>
          {lastUpdate && <p className="text-[10px] text-slate-400 dark:text-white/35 mt-0.5">{d.lastUpdate}: {timeFormatter.format(lastUpdate)}</p>}
        </div>
        <button aria-label={d.refresh} title={d.refresh} onClick={refreshAll} disabled={loading} className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40 shrink-0">
          <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
        </button>
      </div>
      {(hasFetchError || hasPartialFailure) && (
        <div className={`mb-4 rounded-xl border px-3 py-2 text-[11px] flex items-start sm:items-center gap-2 ${hasFetchError ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'}`}>
          <span className="material-symbols-outlined text-[14px] mt-0.5 sm:mt-0">{hasFetchError ? 'error' : 'info'}</span>
          <span className="leading-4">{hasFetchError ? d.fetchFailed : d.partialData}</span>
        </div>
      )}

      <div className="space-y-4 max-w-6xl mx-auto">
        {/* Gateway Status Hero */}
        <div className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 ${gwRunning ? 'border-mac-green/20 bg-gradient-to-r from-emerald-50/80 to-white dark:from-emerald-500/[0.06] dark:to-transparent' : 'border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'}`}>
          <div className="flex items-start sm:items-center gap-3 sm:gap-4">
            <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shadow-inner shrink-0 ${gwRunning ? 'bg-mac-green/15' : 'bg-slate-100 dark:bg-white/5'}`}>
              <span className={`material-symbols-outlined text-[28px] ${gwRunning ? 'text-mac-green' : 'text-slate-400'}`}>router</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black dark:text-white text-slate-800">{d.gwStatus}</h2>
                <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ${gwRunning ? 'bg-mac-green/15' : 'bg-slate-200 dark:bg-white/10'}`}>
                  <HealthDot ok={gwRunning} />
                  <span className={`text-[10px] font-bold uppercase ${gwRunning ? 'text-mac-green' : 'text-slate-400'}`}>{gwRunning ? d.running : d.stopped}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1.5 text-[11px]">
                {uptimeMs > 0 && <span className="text-slate-500 dark:text-white/40">{d.uptime}: <b className="text-slate-700 dark:text-white/70 font-mono">{fmtUptime(uptimeMs, uptimeUnits)}</b></span>}
                {tickMs > 0 && <span className="text-slate-500 dark:text-white/40">{d.tickLabel}: <b className="text-slate-700 dark:text-white/70 font-mono">{tickMs}{d.unitMillisecond}</b></span>}
                {gwStatus?.runtime && <span className="text-slate-500 dark:text-white/40">{d.runtimeLabel}: <b className="text-slate-700 dark:text-white/70 font-mono">{gwStatus.runtime}</b></span>}
              </div>
            </div>
            {/* Mini cost sparkline */}
            {dailyCost.length > 1 && (
              <div className="hidden md:block shrink-0">
                <p className="text-[11px] text-slate-400 dark:text-white/35 text-right mb-1">{d.todayCost}</p>
                <MiniSparkline data={dailyCost.map((dc: any) => dc.totalCost || dc.cost || 0)} color="#f59e0b" h={36} w={100} />
              </div>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { icon: 'forum', label: d.sessions, value: data !== null ? sessions.length : '--', color: '#6366f1', gradient: 'from-indigo-50/50 dark:from-indigo-500/[0.06]' },
            { icon: 'token', label: d.todayTokens, value: todayCostEntry ? fmtTokens(todayCostEntry.totalTokens || 0) : (usageCost !== null ? '0' : '--'), color: '#8b5cf6', gradient: 'from-violet-50/50 dark:from-violet-500/[0.06]' },
            { icon: 'payments', label: d.totalCost, value: usageCost !== null ? fmtCost(totalCostVal) : '--', color: '#f59e0b', gradient: 'from-amber-50/50 dark:from-amber-500/[0.06]' },
            { icon: 'smart_toy', label: d.models, value: userConfig !== null ? userModelCount : (data !== null ? models.length : '--'), color: '#10b981', gradient: 'from-emerald-50/50 dark:from-emerald-500/[0.06]' },
            { icon: 'extension', label: d.skills, value: data !== null ? (skills.length > 0 ? `${eligibleSkills}/${skills.length}` : '0') : '--', color: '#ec4899', gradient: 'from-pink-50/50 dark:from-pink-500/[0.06]' },
            { icon: 'devices', label: d.instances, value: data !== null ? instances.length : '--', color: '#0ea5e9', gradient: 'from-sky-50/50 dark:from-sky-500/[0.06]' },
          ].map(kpi => (
            <div key={kpi.label} className={`relative overflow-hidden rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-gradient-to-br ${kpi.gradient} to-white dark:to-transparent p-3.5`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-wider">{kpi.label}</p>
                  <p className="text-base sm:text-lg font-black tabular-nums mt-0.5 dark:text-white text-slate-800">{kpi.value}</p>
                </div>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}15` }}>
                  <span className="material-symbols-outlined text-[16px]" style={{ color: kpi.color }}>{kpi.icon}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Host Info Card - O6: always mounted, skeleton while loading */}
        {(() => {
          const hi = (t as any).hi as any;
          if (!hostInfo) {
            return (
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/5 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-white/5 animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-24 bg-slate-100 dark:bg-white/5 rounded animate-pulse" />
                    <div className="h-2.5 w-32 bg-slate-100 dark:bg-white/5 rounded animate-pulse" />
                  </div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 p-3 flex items-center gap-3">
                        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-white/5 animate-pulse shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-2.5 w-16 bg-slate-100 dark:bg-white/5 rounded animate-pulse" />
                          <div className="h-2 w-20 bg-slate-100 dark:bg-white/5 rounded animate-pulse" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          }
          const mem = hostInfo.memStats || {};
          const disks: any[] = hostInfo.diskUsage || [];
          const env = hostInfo.env || {};
          const osIcon = hostInfo.os === 'darwin' ? 'laptop_mac' : hostInfo.os === 'linux' ? 'dns' : hostInfo.os === 'windows' ? 'laptop_windows' : 'computer';
          return (
            <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
              {/* Header */}
              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/15 to-blue-600/15 flex items-center justify-center border border-cyan-500/10">
                  <span className="material-symbols-outlined text-cyan-500 text-[20px]">{osIcon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[12px] font-bold text-slate-800 dark:text-white">{hi.title}</h3>
                  <p className="text-[10px] text-slate-400 dark:text-white/40 font-mono truncate">{hostInfo.hostname || '-'}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-bold">{hostInfo.platform}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-bold">{hostInfo.arch}</span>
                </div>
              </div>

              <div className="p-4">
                {/* CPU + system memory + disk gauges in 3 columns */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  {/* CPU Usage Gauge */}
                  {(() => {
                    const cpuPct = hostInfo.cpuUsage || 0;
                    const cpuColor = cpuPct > 90 ? '#ef4444' : cpuPct > 70 ? '#f59e0b' : '#3b82f6';
                    const r = 36; const c = 2 * Math.PI * r; const offset = c - (cpuPct / 100) * c;
                    return (
                      <div className="rounded-xl bg-gradient-to-br from-blue-50/80 to-white dark:from-blue-500/[0.06] dark:to-transparent border border-blue-100/50 dark:border-blue-500/10 p-3 flex items-center gap-3">
                        <div className="relative w-16 h-16 shrink-0">
                          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                            <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-slate-100 dark:text-white/5" />
                            <circle cx="40" cy="40" r={r} fill="none" stroke={cpuColor} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} className="transition-all duration-700" />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-sm font-black tabular-nums" style={{ color: cpuColor }}>{cpuPct.toFixed(0)}%</span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-blue-500 dark:text-blue-400 uppercase tracking-wider">{hi.cpuUsage}</p>
                          <p className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5">{hostInfo.numCpu} {hi.cores} &middot; {hostInfo.arch}</p>
                          <p className="text-[10px] text-slate-400 dark:text-white/35 mt-0.5">{hi.goroutines}: {hostInfo.numGoroutine || 0} &middot; {hi.gc}: {mem.numGC || 0}</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* System Memory Gauge */}
                  {(() => {
                    const sm = hostInfo.sysMem || {};
                    const memPct = sm.usedPct || 0;
                    const memColor = memPct > 90 ? '#ef4444' : memPct > 70 ? '#f59e0b' : '#8b5cf6';
                    const r = 36; const c = 2 * Math.PI * r; const offset = c - (memPct / 100) * c;
                    return (
                      <div className="rounded-xl bg-gradient-to-br from-violet-50/80 to-white dark:from-violet-500/[0.06] dark:to-transparent border border-violet-100/50 dark:border-violet-500/10 p-3 flex items-center gap-3">
                        <div className="relative w-16 h-16 shrink-0">
                          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                            <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-slate-100 dark:text-white/5" />
                            <circle cx="40" cy="40" r={r} fill="none" stroke={memColor} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} className="transition-all duration-700" />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-sm font-black tabular-nums" style={{ color: memColor }}>{memPct.toFixed(0)}%</span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-violet-500 dark:text-violet-400 uppercase tracking-wider">{hi.sysMem}</p>
                          {sm.total > 0 && (
                            <>
                              <p className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5">{fmtBytes(sm.used || 0)} / {fmtBytes(sm.total)}</p>
                              <div className="h-1 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden mt-1">
                                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(memPct, 100)}%`, background: memColor }} />
                              </div>
                              <p className="text-[10px] text-slate-400 dark:text-white/20 mt-0.5">{hi.freeRam}: {fmtBytes(sm.free || 0)}</p>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Disk Space Gauge */}
                  {(() => {
                    const mainDisk = disks.length > 0 ? disks[0] : null;
                    const diskPct = mainDisk?.usedPct || 0;
                    const diskColor = diskPct > 90 ? '#ef4444' : diskPct > 70 ? '#f59e0b' : '#10b981';
                    const r = 36; const c = 2 * Math.PI * r; const offset = c - (diskPct / 100) * c;
                    return (
                      <div className="rounded-xl bg-gradient-to-br from-emerald-50/80 to-white dark:from-emerald-500/[0.06] dark:to-transparent border border-emerald-100/50 dark:border-emerald-500/10 p-3 flex items-center gap-3">
                        <div className="relative w-16 h-16 shrink-0">
                          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                            <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-slate-100 dark:text-white/5" />
                            <circle cx="40" cy="40" r={r} fill="none" stroke={diskColor} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} className="transition-all duration-700" />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-sm font-black tabular-nums" style={{ color: diskColor }}>{diskPct.toFixed(0)}%</span>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-bold text-emerald-500 dark:text-emerald-400 uppercase tracking-wider">{hi.disk}</p>
                          {mainDisk && mainDisk.total > 0 ? (
                            <>
                              <p className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5">{fmtBytes(mainDisk.used || 0)} / {fmtBytes(mainDisk.total)}</p>
                              <div className="h-1 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden mt-1">
                                <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(diskPct, 100)}%`, background: diskColor }} />
                              </div>
                              <p className="text-[10px] text-slate-400 dark:text-white/20 mt-0.5">{hi.free}: {fmtBytes(mainDisk.free || 0)}{mainDisk.path ? ` (${mainDisk.path})` : ''}</p>
                            </>
                          ) : (
                            <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">--</p>
                          )}
                          {disks.length > 1 && (
                            <p className="text-[10px] text-slate-400 dark:text-white/20 mt-0.5">+{disks.length - 1} {(t as any).menu?.partitions}</p>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Quick Stats Row */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 p-3 text-center">
                    <p className="text-lg font-black text-emerald-500 tabular-nums">{hostInfo.numGoroutine || 0}</p>
                    <p className="text-[10px] font-bold text-slate-400 dark:text-white/35 uppercase mt-0.5">{hi.goroutines}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 p-3 text-center">
                    <p className="text-lg font-black text-amber-500 tabular-nums">{fmtUptime(hostInfo.uptimeMs || 0, uptimeUnits)}</p>
                    <p className="text-[10px] font-bold text-slate-400 dark:text-white/35 uppercase mt-0.5">{hi.uptime}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 p-3 text-center">
                    <p className="text-base font-black text-blue-500 tabular-nums">{fmtUptimeYMDH(hostInfo.serverUptimeMs || hostInfo.uptimeMs || 0, { y: d.unitYear, mo: d.unitMonth, d: d.unitDay, h: d.unitHour })}</p>
                    <p className="text-[10px] font-bold text-slate-400 dark:text-white/35 uppercase mt-0.5">{hi.serverUptime}</p>
                  </div>
                </div>

                {/* Memory Detail + Environment */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Memory Breakdown */}
                  <div className="rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 p-3">
                    <p className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[12px]">memory</span>{hi.memory}
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
                      {[
                        [hi.heap, fmtBytes(mem.heapInuse || 0), 'text-violet-500'],
                        [hi.stack, fmtBytes(mem.stackInuse || 0), 'text-blue-500'],
                        [hi.sysAlloc, fmtBytes(mem.sys || 0), 'text-slate-500'],
                        [hi.gc, String(mem.numGC || 0), 'text-emerald-500'],
                      ].map(([label, val, color]) => (
                        <div key={label as string} className="flex items-center justify-between">
                          <span className="text-slate-400 dark:text-white/35">{label}</span>
                          <span className={`font-bold font-mono ${color}`}>{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Environment */}
                  <div className="rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5 p-3">
                    <p className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[12px]">terminal</span>{hi.env}
                    </p>
                    <div className="space-y-1.5 text-[10px]">
                      {env.user && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 dark:text-white/35">{hi.user}</span>
                          <span className="font-bold text-slate-600 dark:text-white/60 font-mono">{env.user}</span>
                        </div>
                      )}
                      {env.shell && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 dark:text-white/35">{hi.shell}</span>
                          <span className="font-bold text-slate-600 dark:text-white/60 font-mono truncate ml-2 max-w-[140px]">{env.shell.split(/[/\\]/).pop()}</span>
                        </div>
                      )}
                      {env.workDir && (
                        <div className="flex items-center justify-between">
                          <span className="text-slate-400 dark:text-white/35 shrink-0">{hi.workDir}</span>
                          <span className="font-bold text-slate-600 dark:text-white/60 font-mono truncate ml-2 max-w-[140px] text-right">{env.workDir}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* System Health + Alerts row uses items-stretch for bottom alignment */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
          {/* Expanded System Health panel */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
            <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-primary">monitoring</span>
              {d.systemHealth}
            </h3>
            {/* Health Status Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <HealthDot ok={gwRunning} />
                  <span className="text-[10px] font-bold text-slate-600 dark:text-white/50 uppercase">{d.gwStatus}</span>
                </div>
                <p className={`text-xs font-bold ${gwRunning ? 'text-mac-green' : 'text-slate-400'}`}>{gwRunning ? d.healthy : d.offline}</p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <HealthDot ok={agents.length > 0} />
                  <span className="text-[10px] font-bold text-slate-600 dark:text-white/50 uppercase">{d.agents}</span>
                </div>
                <p className="text-xs font-bold text-slate-700 dark:text-white/70">{agents.length || 0}</p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <HealthDot ok={!!cronEnabled} />
                  <span className="text-[10px] font-bold text-slate-600 dark:text-white/50 uppercase">{d.cron}</span>
                </div>
                <p className="text-xs font-bold text-slate-700 dark:text-white/70">{cronEnabled ? d.enabled : d.disabled}</p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <HealthDot ok={activeChannels > 0} />
                  <span className="text-[10px] font-bold text-slate-600 dark:text-white/50 uppercase">{d.channels}</span>
                </div>
                <p className="text-xs font-bold text-slate-700 dark:text-white/70">{activeChannels}/{totalChannels}</p>
              </div>
            </div>

            {/* Provider / API Key Health (from user config) */}
            {userProviderModels.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {userProviderModels.map(p => {
                  const gwModels = models.filter((m: any) => (m.provider || m.providerId) === p.provider);
                  const hasError = gwModels.some((m: any) => m.error || m.authError);
                  const ok = gwModels.length > 0 ? !hasError : true;
                  return (
                    <div key={p.provider} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5">
                      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-[10px] font-medium text-slate-600 dark:text-white/60 capitalize">{p.provider}</span>
                      <span className="text-[11px] text-slate-400 dark:text-white/40">{p.models.length}</span>
                    </div>
                  );
                })}
                <span className="text-[11px] text-slate-400 dark:text-white/35 self-center ml-1">{d.providerHealth}</span>
              </div>
            )}

            {/* Cost Trend */}
            {dailyCost.length > 1 && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase">{d.todayCost} {d.trend}</span>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" />{d.tokenLegend}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-amber-500 rounded" style={{ width: 8 }} />{(t as any).menu?.cost}</span>
                  </div>
                </div>
                <div className="h-28 relative w-full">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                    <defs>
                      <linearGradient id="dtg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity="0.2"/><stop offset="100%" stopColor="#6366f1" stopOpacity="0"/></linearGradient>
                    </defs>
                    {[25, 50, 75].map(y => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="currentColor" strokeOpacity="0.05" strokeWidth="0.3"/>)}
                    {(() => {
                      const maxT = Math.max(...dailyCost.map((dc: any) => dc.totalTokens || 0), 1);
                      const pts = dailyCost.map((dc: any, i: number) => {
                        const x = (i / Math.max(dailyCost.length - 1, 1)) * 100;
                        const y = 100 - ((dc.totalTokens || 0) / maxT) * 85 - 5;
                        return `${x},${y}`;
                      }).join(' ');
                      return <>
                        <polygon points={`${pts} 100,100 0,100`} fill="url(#dtg)"/>
                        <polyline points={pts} fill="none" stroke="#6366f1" strokeWidth="0.8" strokeLinecap="round"/>
                      </>;
                    })()}
                    {(() => {
                      const maxC = Math.max(...dailyCost.map((dc: any) => dc.totalCost || 0), 0.001);
                      const pts = dailyCost.map((dc: any, i: number) => {
                        const x = (i / Math.max(dailyCost.length - 1, 1)) * 100;
                        const y = 100 - ((dc.totalCost || 0) / maxC) * 85 - 5;
                        return `${x},${y}`;
                      }).join(' ');
                      return <polyline points={pts} fill="none" stroke="#f59e0b" strokeWidth="0.6" strokeDasharray="2,1" strokeLinecap="round"/>;
                    })()}
                  </svg>
                  <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1">
                    {dailyCost.length > 0 && <span className="text-[10px] text-slate-400 dark:text-white/20">{(dailyCost[0]?.date || '').slice(5)}</span>}
                    {dailyCost.length > 1 && <span className="text-[10px] text-slate-400 dark:text-white/20">{(dailyCost[dailyCost.length - 1]?.date || '').slice(5)}</span>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right column alerts uses flex-col h-full to stretch to bottom */}
          <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 flex flex-col">
            <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-mac-yellow">notifications_active</span>
              {d.recentAlerts}
            </h3>
            <div className="flex-1">
              {alerts.length > 0 ? (
                <div className="space-y-2">
                  {alerts.map((alert: any, i: number) => (
                    <div key={alert.id || i} className="flex items-start gap-2 p-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5">
                      <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${alert.risk === 'critical' || alert.risk === 'high' ? 'bg-mac-red' : alert.risk === 'medium' ? 'bg-mac-yellow' : 'bg-mac-green'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold text-slate-700 dark:text-white/70 truncate">{alert.message || alert.title}</p>
                        <p className="text-[10px] text-slate-400 dark:text-white/35 mt-0.5">{alert.created_at ? dateTimeFormatter.format(new Date(alert.created_at)) : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-white/20">
                  <span className="material-symbols-outlined text-xl mb-1">check_circle</span>
                  <span className="text-[10px]">{d.noAlerts}</span>
                  <span className="text-[10px] mt-1 opacity-75 text-center">{d.noAlertsHint}</span>
                </div>
              )}
            </div>
            {/* Token I/O mini summary */}
            {totalTokensVal > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 dark:text-white/35 flex items-center gap-1"><span className="material-symbols-outlined text-[11px] text-violet-500">token</span>{d.tokens7d}</span>
                  <span className="font-bold text-slate-600 dark:text-white/60 font-mono">{fmtTokens(totalTokensVal)}</span>
                  <span className="font-mono text-amber-500">{fmtCost(totalCostVal)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Connected Instances - full width like gateway status */}
        {instances.length > 0 ? (
          <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
            <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-sky-500">devices</span>
              {d.connectedInstances} ({instances.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {instances.map((inst: any, i: number) => {
                const host = inst.host || d.unknownHost;
                const mode = inst.mode || '';
                const version = inst.version || '';
                const roles: string[] = Array.isArray(inst.roles) ? inst.roles.filter(Boolean) : [];
                const scopes: string[] = Array.isArray(inst.scopes) ? inst.scopes.filter(Boolean) : [];
                const rolesVisible = roles.slice(0, 2);
                const rolesOverflow = roles.length - rolesVisible.length;
                const lastInput = inst.lastInputSeconds != null ? `${inst.lastInputSeconds}${d.unitSecond}` : null;
                const age = inst.ts ? fmtPresenceAge(inst.ts, presenceLabels) : null;
                return (
                  <div key={inst.instanceId || i} className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[14px] text-sky-500">
                          {inst.platform === 'darwin' ? 'laptop_mac' : inst.platform === 'linux' ? 'dns' : inst.platform === 'win32' ? 'laptop_windows' : 'devices'}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold text-slate-700 dark:text-white/70 truncate">{host}</p>
                        {inst.ip && <p className="text-[11px] text-slate-400 dark:text-white/35 font-mono">{inst.ip}</p>}
                      </div>
                      <div className="w-2 h-2 rounded-full bg-mac-green shrink-0" />
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {mode && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 font-bold">{mode}</span>}
                      {rolesVisible.map(r => <span key={r} className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-bold">{r}</span>)}
                      {rolesOverflow > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-bold">+{rolesOverflow}</span>}
                      {inst.platform && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40">{inst.platform}</span>}
                      {inst.deviceFamily && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40">{inst.deviceFamily}</span>}
                      {version && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40">v{version}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 mt-1.5 text-[11px] text-slate-400 dark:text-white/35">
                      {scopes.length > 0 && <span>{scopes.length > 2 ? `${scopes.length} ${d.scopes}` : scopes.join(', ')}</span>}
                      {lastInput && <span>{d.lastInput}: {lastInput}</span>}
                      {age && <span>{age}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-700 dark:text-white/70">{d.connectedInstances}: 0</p>
              <p className="text-[11px] text-slate-400 dark:text-white/35 mt-1">{d.instancesEmptyHint}</p>
            </div>
            <button onClick={refreshAll} className="shrink-0 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-white/10 text-[11px] font-medium text-slate-600 dark:text-white/65 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors">
              {d.refresh}
            </button>
          </div>
        )}

        {/* Recent Sessions - full width */}
        {sessions.length > 0 ? (
          <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
            <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-indigo-500">forum</span>
              {d.recentSessions}
            </h3>
            <div className="space-y-1.5">
              {sessions.slice(0, 6).map((s: any, i: number) => {
                const label = s.label || s.key || s.id || `${d.sessionDefault} ${i + 1}`;
                return (
                  <div key={i} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                    <div className="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center text-[10px] font-bold text-indigo-500">{i + 1}</div>
                    <span className="text-[11px] font-medium text-slate-700 dark:text-white/60 truncate flex-1">{label}</span>
                    {(s.lastActiveAt || s.updatedAt) && <span className="text-[11px] text-slate-400 dark:text-white/35 shrink-0">{timeFormatter.format(new Date(s.lastActiveAt || s.updatedAt))}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-5">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-700 dark:text-white/70">{d.recentSessions}</p>
              <p className="text-[11px] text-slate-400 dark:text-white/35 mt-1">{d.sessionsEmptyHint}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

export default Dashboard;
