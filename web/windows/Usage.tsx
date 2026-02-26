
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi } from '../services/api';

interface UsageProps {
  language: Language;
  onNavigateToSession?: (sessionKey: string) => void;
}

type DateRange = 'today' | '7d' | '30d' | 'custom';

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
}

interface SessionEntry {
  key: string;
  label?: string;
  lastActiveAt?: number;
  updatedAt?: number;
  totals?: UsageTotals;
  usage?: {
    totalTokens?: number;
    totalCost?: number;
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    inputCost?: number;
    outputCost?: number;
    cacheReadCost?: number;
    cacheWriteCost?: number;
    messageCounts?: { total: number; user: number; assistant: number; toolCalls: number; toolResults: number; errors: number };
  };
  messages?: { total: number; user: number; assistant: number; toolCalls: number; errors: number };
}

interface DailyEntry {
  date: string;
  tokens: number;
  cost: number;
  messages?: number;
  toolCalls?: number;
  errors?: number;
}

interface ModelEntry {
  provider?: string;
  model?: string;
  count: number;
  totals: UsageTotals;
}

interface UsageData {
  totals: UsageTotals;
  sessions: SessionEntry[];
  aggregates: {
    messages: { total: number; user: number; assistant: number; toolCalls: number; toolResults: number; errors: number };
    tools: { totalCalls: number; uniqueTools: number; tools: Array<{ name: string; count: number }> };
    byModel: ModelEntry[];
    byProvider: ModelEntry[];
    daily: DailyEntry[];
    latency?: { count: number; avgMs: number; p95Ms: number; minMs: number; maxMs: number };
  };
}

interface CostData {
  totals: UsageTotals;
  daily: Array<UsageTotals & { date: string }>;
  days: number;
}

// Format helpers
function fmtTokens(n: number | undefined | null): string {
  const v = n || 0;
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return v.toFixed(0);
}

function fmtCost(n: number | undefined | null): string {
  const v = n || 0;
  if (v === 0) return '$0.00';
  if (v < 0.01) return '<$0.01';
  return '$' + v.toFixed(2);
}

function fmtMs(n: number | undefined | null): string {
  const v = n || 0;
  if (v >= 1000) return (v / 1000).toFixed(1) + 's';
  return v.toFixed(0) + 'ms';
}

function fmtDate(d: string): string {
  const parts = d.split('-');
  if (parts.length === 3) return `${parts[1]}/${parts[2]}`;
  return d;
}

function fmtTimestamp(ts: string | number | undefined | null, u?: any): string {
  if (!ts) return '-';
  const date = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(date.getTime())) return String(ts);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (isToday) return time;
  if (isYesterday) return `${u?.yesterday} ${time}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

function fmtRelativeTime(ts: string | number | undefined | null, u?: any): string {
  if (!ts) return '-';
  const date = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(date.getTime())) return String(ts);
  const now = Date.now();
  const diff = now - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return u?.justNow;
  if (mins < 60) return `${mins}${u?.minutesAgo}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}${u?.hoursAgo}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}${u?.daysAgo}`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getDateRange(range: DateRange, customStart: string, customEnd: string): { startDate: string; endDate: string } {
  const now = new Date();
  const end = now.toISOString().split('T')[0];
  if (range === 'custom') return { startDate: customStart || end, endDate: customEnd || end };
  const days = range === 'today' ? 0 : range === '7d' ? 6 : 29;
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return { startDate: start.toISOString().split('T')[0], endDate: end };
}

// Mini sparkline SVG chart
function Sparkline({ data, color, height = 40, width = 120 }: { data: number[]; color: string; height?: number; width?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const areaPoints = points + ` ${width},${height} 0,${height}`;
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#grad-${color.replace('#', '')})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Animated bar for breakdown charts
function AnimatedBar({ value, max, color, label, sublabel, rightLabel }: { value: number; max: number; color: string; label: string; sublabel?: string; rightLabel: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 0.5) : 0;
  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[11px] font-semibold truncate dark:text-white/90 text-slate-700">{label}</span>
          {sublabel && <span className="text-[10px] text-slate-400 dark:text-white/40 truncate">{sublabel}</span>}
        </div>
        <span className="text-[11px] font-mono font-bold tabular-nums ml-2 shrink-0 dark:text-white/70 text-slate-500">{rightLabel}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}cc)` }}
        />
      </div>
    </div>
  );
}

// Donut chart
function DonutChart({ segments, size = 100 }: { segments: Array<{ value: number; color: string; label: string }>; size?: number }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;
  const r = (size - 8) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      {segments.filter(s => s.value > 0).map((seg, i) => {
        const pct = seg.value / total;
        const dashLen = pct * circumference;
        const dashOffset = -offset * circumference;
        offset += pct;
        return (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth="6"
            strokeDasharray={`${dashLen} ${circumference - dashLen}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        );
      })}
    </svg>
  );
}

// Daily trend area chart
function TrendChart({ data, height = 140 }: { data: DailyEntry[]; height?: number }) {
  if (!data.length) return null;
  const width = 100; // percentage-based
  const maxTokens = Math.max(...data.map(d => d.tokens), 1);
  const maxCost = Math.max(...data.map(d => d.cost), 0.001);

  const tokenPoints = data.map((d, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * width;
    const y = 100 - (d.tokens / maxTokens) * 85 - 5;
    return `${x},${y}`;
  }).join(' ');

  const costPoints = data.map((d, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * width;
    const y = 100 - (d.cost / maxCost) * 85 - 5;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div style={{ height }} className="relative w-full">
      <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" className="w-full h-full">
        <defs>
          <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 25, 50, 75].map(y => (
          <line key={y} x1="0" y1={y} x2={width} y2={y} stroke="currentColor" strokeOpacity="0.06" strokeWidth="0.3" />
        ))}
        {/* Token area */}
        <polygon points={`${tokenPoints} ${width},100 0,100`} fill="url(#tokenGrad)" />
        <polyline points={tokenPoints} fill="none" stroke="#6366f1" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" />
        {/* Cost area */}
        <polygon points={`${costPoints} ${width},100 0,100`} fill="url(#costGrad)" />
        <polyline points={costPoints} fill="none" stroke="#f59e0b" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2,1" />
      </svg>
      {/* X-axis labels */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1">
        {data.length > 0 && <span className="text-[11px] text-slate-400 dark:text-white/35">{fmtDate(data[0].date)}</span>}
        {data.length > 1 && <span className="text-[11px] text-slate-400 dark:text-white/35">{fmtDate(data[data.length - 1].date)}</span>}
      </div>
    </div>
  );
}

// Budget settings interface
interface BudgetSettings {
  dailyLimit: number;
  monthlyLimit: number;
  alertThreshold: number; // percentage (0-100)
  action: 'warn' | 'pause' | 'continue';
}

const Usage: React.FC<UsageProps> = ({ language, onNavigateToSession }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const u = (t as any).usage as any;
  const es = (t as any).es as any;

  const [range, setRange] = useState<DateRange>('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [costData, setCostData] = useState<CostData | null>(null);
  const [tab, setTab] = useState<'overview' | 'models' | 'sessions' | 'timeseries' | 'logs'>('overview');

  // Budget settings (persisted in localStorage)
  const [budget, setBudget] = useState<BudgetSettings>(() => {
    const saved = localStorage.getItem('openclaw-budget');
    if (saved) {
      try { return JSON.parse(saved); } catch { /* ignore */ }
    }
    return { dailyLimit: 0, monthlyLimit: 0, alertThreshold: 80, action: 'warn' };
  });
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [editBudget, setEditBudget] = useState<BudgetSettings>(budget);

  // Save budget to localStorage
  const saveBudget = useCallback(() => {
    setBudget(editBudget);
    localStorage.setItem('openclaw-budget', JSON.stringify(editBudget));
    setShowBudgetModal(false);
  }, [editBudget]);

  // Session detail (timeseries + logs)
  const [selectedSessionKey, setSelectedSessionKey] = useState('');

  // Timeseries
  const [tsData, setTsData] = useState<any[] | null>(null);
  const [tsLoading, setTsLoading] = useState(false);

  // Usage logs
  const [logsData, setLogsData] = useState<any[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  // Pagination
  const [sessionsPage, setSessionsPage] = useState(1);
  const [logsPage, setLogsPage] = useState(1);
  const PAGE_SIZE = 20;

  // Model filter (click on donut to filter)
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Cost trend view
  const [trendView, setTrendView] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const fetchSeqRef = useRef(0);

  const fetchData = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const { startDate, endDate } = getDateRange(range, customStart, customEnd);
      const [sessionsRes, costRes] = await Promise.all([
        gwApi.sessionsUsage({ startDate, endDate, limit: 200 }),
        gwApi.usageCost({ startDate, endDate }),
      ]);
      if (seq !== fetchSeqRef.current) return;
      setUsageData(sessionsRes as any);
      setCostData(costRes as any);
    } catch (err: any) {
      if (seq !== fetchSeqRef.current) return;
      setError(err?.message || String(err));
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [range, customStart, customEnd]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { fetchData(); });
    return () => cancelAnimationFrame(raf);
  }, [fetchData]);

  // Fetch timeseries for a specific session
  const fetchTimeseries = useCallback(async (key?: string) => {
    const k = key || selectedSessionKey;
    if (!k) return;
    setTsLoading(true);
    try {
      const res = await gwApi.sessionsUsageTimeseries(k) as any;
      setTsData(Array.isArray(res?.points) ? res.points : Array.isArray(res) ? res : []);
    } catch { setTsData([]); }
    setTsLoading(false);
  }, [selectedSessionKey]);

  // Fetch logs for a specific session
  const fetchLogs = useCallback(async (key?: string) => {
    const k = key || selectedSessionKey;
    if (!k) return;
    setLogsLoading(true);
    try {
      const res = await gwApi.sessionsUsageLogs(k, { limit: 100 }) as any;
      setLogsData(Array.isArray(res?.logs) ? res.logs : Array.isArray(res) ? res : []);
    } catch { setLogsData([]); }
    setLogsLoading(false);
  }, [selectedSessionKey]);

  // Open session detail (timeseries or logs)
  const openSessionDetail = useCallback((key: string, view: 'timeseries' | 'logs') => {
    setSelectedSessionKey(key);
    setTsData(null);
    setLogsData(null);
    setTab(view);
    if (view === 'timeseries') fetchTimeseries(key);
    else fetchLogs(key);
  }, [fetchTimeseries, fetchLogs]);

  useEffect(() => { if (tab === 'timeseries' && tsData === null && selectedSessionKey) fetchTimeseries(); }, [tab, tsData, selectedSessionKey, fetchTimeseries]);
  useEffect(() => { if (tab === 'logs' && logsData === null && selectedSessionKey) fetchLogs(); }, [tab, logsData, selectedSessionKey, fetchLogs]);

  const totals = usageData?.totals || costData?.totals || { totalTokens: 0, totalCost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0 };
  const daily = usageData?.aggregates?.daily || costData?.daily?.map(d => ({ date: d.date, tokens: d.totalTokens, cost: d.totalCost })) || [];
  const models = usageData?.aggregates?.byModel || [];
  const sessions = usageData?.sessions || [];
  const agg = usageData?.aggregates;
  const maxModelTokens = Math.max(...models.map(m => m.totals?.totalTokens || 0), 1);
  const maxSessionTokens = Math.max(...sessions.map(s => s.totals?.totalTokens || s.usage?.totalTokens || 0), 1);

  const MODEL_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

  const tokenSegments = models.slice(0, 6).map((m, i) => ({
    value: m.totals?.totalTokens || 0,
    color: MODEL_COLORS[i % MODEL_COLORS.length],
    label: m.model || m.provider || u.unknown,
  }));

  // Aggregate daily data by week/month for trend view
  const trendData = useMemo(() => {
    if (trendView === 'daily') return daily;
    const grouped: Record<string, { date: string; tokens: number; cost: number }> = {};
    daily.forEach(d => {
      const date = new Date(d.date);
      let key: string;
      if (trendView === 'weekly') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().split('T')[0];
      } else {
        key = d.date.substring(0, 7); // YYYY-MM
      }
      if (!grouped[key]) grouped[key] = { date: key, tokens: 0, cost: 0 };
      grouped[key].tokens += d.tokens || 0;
      grouped[key].cost += d.cost || 0;
    });
    return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
  }, [daily, trendView]);

  // Helper to get session tokens (supports both totals and usage fields from Gateway)
  const getSessionTokens = useCallback((s: SessionEntry) => {
    return s.totals?.totalTokens || s.usage?.totalTokens || 0;
  }, []);
  const getSessionCost = useCallback((s: SessionEntry) => {
    return s.totals?.totalCost || s.usage?.totalCost || 0;
  }, []);
  const getSessionMessages = useCallback((s: SessionEntry) => {
    return s.messages || s.usage?.messageCounts || { total: 0, user: 0, assistant: 0, toolCalls: 0, errors: 0 };
  }, []);
  const getSessionLastActive = useCallback((s: SessionEntry) => {
    return s.lastActiveAt || s.updatedAt;
  }, []);

  // Filter sessions by selected model
  const filteredSessions = useMemo(() => {
    let list = sessions.filter(s => getSessionTokens(s) > 0);
    if (selectedModel) {
      // Note: session doesn't have model info directly, this is a placeholder
      // In real implementation, you'd need to track which models were used in each session
    }
    return list.sort((a, b) => getSessionTokens(b) - getSessionTokens(a));
  }, [sessions, selectedModel, getSessionTokens]);

  // Paginated sessions
  const paginatedSessions = useMemo(() => {
    const start = (sessionsPage - 1) * PAGE_SIZE;
    return filteredSessions.slice(start, start + PAGE_SIZE);
  }, [filteredSessions, sessionsPage]);
  const totalSessionPages = Math.ceil(filteredSessions.length / PAGE_SIZE);

  // Reset page when data changes
  useEffect(() => { setSessionsPage(1); }, [usageData]);
  useEffect(() => { setLogsPage(1); }, [logsData]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#1a1c20]">
      {/* Header */}
      <header className="shrink-0 border-b border-slate-200 dark:border-white/5 bg-slate-50/80 dark:bg-white/[0.02]">
        <div className="px-5 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold dark:text-white/90 text-slate-800">{u.title}</h1>
            <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{u.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Date range pills */}
            <div className="flex bg-slate-100 dark:bg-white/[0.06] p-0.5 rounded-lg border border-slate-200/50 dark:border-white/5">
              {(['today', '7d', '30d', 'custom'] as DateRange[]).map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${
                    range === r
                      ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-white/60'
                  }`}
                >
                  {r === 'today' ? u.today : r === '7d' ? u.last7d : r === '30d' ? u.last30d : u.custom}
                </button>
              ))}
            </div>
            {range === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                  className="px-2 py-1 text-[10px] rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white/70" />
                <span className="text-[10px] text-slate-400">–</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                  className="px-2 py-1 text-[10px] rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 dark:text-white/70" />
              </div>
            )}
            <button onClick={fetchData} disabled={loading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40">
              <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
            </button>
          </div>
        </div>
        {/* Sub-tabs */}
        <div className="px-5 flex gap-0.5">
          {(['overview', 'models', 'sessions', 'timeseries', 'logs'] as const).map(tb => (
            <button key={tb} onClick={() => setTab(tb)}
              className={`px-4 py-2 text-[11px] font-bold border-b-2 transition-all ${
                tab === tb
                  ? 'border-primary text-primary'
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-white/50'
              }`}>
              {tb === 'overview' ? u.title : tb === 'models' ? u.byModel : tb === 'sessions' ? u.bySession : tb === 'timeseries' ? u.timeseries : u.usageLogs}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-[11px] text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {loading && !usageData && (
          <div className="flex items-center justify-center h-48 text-slate-400 dark:text-white/40">
            <div className="flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-3xl animate-spin">progress_activity</span>
              <span className="text-[11px]">{u.loading}</span>
            </div>
          </div>
        )}

        {!loading && !usageData && !error && (
          <div className="flex items-center justify-center h-48 text-slate-400 dark:text-white/40">
            <div className="flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-3xl">analytics</span>
              <span className="text-[11px]">{u.noData}</span>
            </div>
          </div>
        )}

        {totals && tab === 'overview' && (
          <div className="space-y-4 max-w-5xl mx-auto animate-in fade-in duration-300">
            {/* KPI Cards Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Total Tokens */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-gradient-to-br from-indigo-50/50 to-white dark:from-indigo-500/[0.06] dark:to-transparent p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-wider">{u.totalTokens}</p>
                    <p className="text-xl font-black tabular-nums mt-1 dark:text-white text-slate-800">{fmtTokens(totals.totalTokens)}</p>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-indigo-500 text-[18px]">token</span>
                  </div>
                </div>
                <div className="mt-2">
                  <Sparkline data={daily.map(d => d.tokens)} color="#6366f1" height={28} width={100} />
                </div>
              </div>

              {/* Total Cost */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-gradient-to-br from-amber-50/50 to-white dark:from-amber-500/[0.06] dark:to-transparent p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-wider">{u.totalCost}</p>
                    <p className="text-xl font-black tabular-nums mt-1 dark:text-white text-slate-800">{fmtCost(totals.totalCost)}</p>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-amber-500 text-[18px]">payments</span>
                  </div>
                </div>
                <div className="mt-2">
                  <Sparkline data={daily.map(d => d.cost)} color="#f59e0b" height={28} width={100} />
                </div>
              </div>

              {/* Messages */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-gradient-to-br from-emerald-50/50 to-white dark:from-emerald-500/[0.06] dark:to-transparent p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-wider">{u.messages}</p>
                    <p className="text-xl font-black tabular-nums mt-1 dark:text-white text-slate-800">{fmtTokens(agg?.messages?.total || 0)}</p>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-emerald-500 text-[18px]">chat</span>
                  </div>
                </div>
                <div className="flex gap-3 mt-3 text-[10px]">
                  <span className="text-slate-400 dark:text-white/40">{u.toolCalls}: <b className="text-slate-600 dark:text-white/60">{agg?.tools?.totalCalls || 0}</b></span>
                  <span className="text-slate-400 dark:text-white/40">{u.errors}: <b className="text-red-400">{agg?.messages?.errors || 0}</b></span>
                </div>
              </div>

              {/* Latency */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-gradient-to-br from-violet-50/50 to-white dark:from-violet-500/[0.06] dark:to-transparent p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[10px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-wider">{u.avgLatency}</p>
                    <p className="text-xl font-black tabular-nums mt-1 dark:text-white text-slate-800">{agg?.latency ? fmtMs(agg.latency.avgMs) : '—'}</p>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-violet-500 text-[18px]">speed</span>
                  </div>
                </div>
                <div className="flex gap-3 mt-3 text-[10px]">
                  <span className="text-slate-400 dark:text-white/40">P95: <b className="text-slate-600 dark:text-white/60">{agg?.latency ? fmtMs(agg.latency.p95Ms) : '—'}</b></span>
                  <span className="text-slate-400 dark:text-white/40">{u.sessions}: <b className="text-slate-600 dark:text-white/60">{sessions.length}</b></span>
                </div>
              </div>
            </div>

            {/* Budget Card */}
            {(() => {
              const hasBudget = budget.dailyLimit > 0 || budget.monthlyLimit > 0;
              const todayCost = daily.length > 0 ? daily[daily.length - 1]?.cost || 0 : 0;
              const monthCost = totals.totalCost || 0;
              const dailyPct = budget.dailyLimit > 0 ? Math.min((todayCost / budget.dailyLimit) * 100, 100) : 0;
              const monthlyPct = budget.monthlyLimit > 0 ? Math.min((monthCost / budget.monthlyLimit) * 100, 100) : 0;
              const isOverDaily = budget.dailyLimit > 0 && todayCost >= budget.dailyLimit;
              const isOverMonthly = budget.monthlyLimit > 0 && monthCost >= budget.monthlyLimit;
              const isNearDaily = budget.dailyLimit > 0 && dailyPct >= budget.alertThreshold;
              const isNearMonthly = budget.monthlyLimit > 0 && monthlyPct >= budget.alertThreshold;

              return (
                <div className={`rounded-2xl border p-4 ${
                  isOverDaily || isOverMonthly 
                    ? 'border-red-300 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5' 
                    : isNearDaily || isNearMonthly 
                      ? 'border-amber-300 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5'
                      : 'border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`material-symbols-outlined text-[16px] ${isOverDaily || isOverMonthly ? 'text-red-500' : isNearDaily || isNearMonthly ? 'text-amber-500' : 'text-emerald-500'}`}>
                        {isOverDaily || isOverMonthly ? 'warning' : 'account_balance_wallet'}
                      </span>
                      <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{es.budget}</h3>
                    </div>
                    <button onClick={() => { setEditBudget(budget); setShowBudgetModal(true); }}
                      className="text-[10px] font-bold text-primary hover:underline flex items-center gap-0.5">
                      <span className="material-symbols-outlined text-[12px]">settings</span>
                      {es.setBudget}
                    </button>
                  </div>
                  
                  {hasBudget ? (
                    <div className="grid grid-cols-2 gap-4">
                      {/* Daily Budget */}
                      {budget.dailyLimit > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-slate-400 dark:text-white/40">{es.dailyBudget}</span>
                            <span className={`text-[10px] font-bold ${isOverDaily ? 'text-red-500' : isNearDaily ? 'text-amber-500' : 'text-slate-600 dark:text-white/60'}`}>
                              {fmtCost(todayCost)} / {fmtCost(budget.dailyLimit)}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-500 ${isOverDaily ? 'bg-red-500' : isNearDaily ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${dailyPct}%` }} />
                          </div>
                        </div>
                      )}
                      {/* Monthly Budget */}
                      {budget.monthlyLimit > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-slate-400 dark:text-white/40">{es.monthlyBudget}</span>
                            <span className={`text-[10px] font-bold ${isOverMonthly ? 'text-red-500' : isNearMonthly ? 'text-amber-500' : 'text-slate-600 dark:text-white/60'}`}>
                              {fmtCost(monthCost)} / {fmtCost(budget.monthlyLimit)}
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 dark:bg-white/[0.06] overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-500 ${isOverMonthly ? 'bg-red-500' : isNearMonthly ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${monthlyPct}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 dark:text-white/40 text-center py-2">{es.noBudgetSet}</p>
                  )}
                </div>
              );
            })()}

            {/* Daily Trend + Token Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Daily Trend Chart */}
              <div className="lg:col-span-2 rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{u.costTrend}</h3>
                    <div className="flex bg-slate-100 dark:bg-white/[0.06] p-0.5 rounded-md">
                      {(['daily', 'weekly', 'monthly'] as const).map(v => (
                        <button key={v} onClick={() => setTrendView(v)}
                          className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all ${
                            trendView === v ? 'bg-white dark:bg-primary shadow-sm text-slate-700 dark:text-white' : 'text-slate-400 hover:text-slate-600'
                          }`}>
                          {v === 'daily' ? u.day : v === 'weekly' ? u.week : u.month}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" />{u.tokens}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-amber-500 rounded" style={{ width: 8 }} />{u.cost}</span>
                  </div>
                </div>
                <TrendChart data={trendData} height={160} />
                {/* Daily summary below chart */}
                {daily.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {daily.slice(-5).map(d => (
                      <div key={d.date} className="text-center">
                        <p className="text-[11px] text-slate-400 dark:text-white/35">{fmtDate(d.date)}</p>
                        <p className="text-[11px] font-bold tabular-nums dark:text-white/70 text-slate-600">{fmtTokens(d.tokens)}</p>
                        <p className="text-[11px] font-mono text-amber-500">{fmtCost(d.cost)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Token Distribution Donut */}
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{u.byModel}</h3>
                  {selectedModel && (
                    <button onClick={() => setSelectedModel(null)}
                      className="text-[9px] px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                      ✕ {u.clearFilter}
                    </button>
                  )}
                </div>
                <div className="flex justify-center mb-3">
                  <div className="relative cursor-pointer" onClick={() => setSelectedModel(null)}>
                    <DonutChart segments={tokenSegments} size={110} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[10px] text-slate-400 dark:text-white/40">{u.total}</span>
                      <span className="text-sm font-black tabular-nums dark:text-white text-slate-700">{fmtTokens(totals.totalTokens)}</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {tokenSegments.map((seg, i) => (
                    <button key={i} onClick={() => setSelectedModel(selectedModel === seg.label ? null : seg.label)}
                      className={`w-full flex items-center gap-2 text-[10px] px-2 py-1 rounded-lg transition-all ${
                        selectedModel === seg.label ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                      }`}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: seg.color }} />
                      <span className="truncate flex-1 text-left text-slate-600 dark:text-white/50">{seg.label}</span>
                      <span className="font-mono font-bold tabular-nums text-slate-500 dark:text-white/40">{fmtTokens(seg.value)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Token I/O Breakdown */}
            <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
              <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3">Token I/O</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: u.inputTokens, value: totals.input, cost: totals.inputCost, color: '#6366f1' },
                  { label: u.outputTokens, value: totals.output, cost: totals.outputCost, color: '#f59e0b' },
                  { label: u.cacheRead, value: totals.cacheRead, cost: totals.cacheReadCost, color: '#10b981' },
                  { label: u.cacheWrite, value: totals.cacheWrite, cost: totals.cacheWriteCost, color: '#8b5cf6' },
                ].map(item => (
                  <div key={item.label} className="text-center">
                    <div className="w-10 h-10 mx-auto rounded-xl flex items-center justify-center mb-2" style={{ background: `${item.color}15` }}>
                      <span className="text-lg font-black tabular-nums" style={{ color: item.color }}>{fmtTokens(item.value)}</span>
                    </div>
                    <p className="text-[10px] font-medium text-slate-500 dark:text-white/40">{item.label}</p>
                    <p className="text-[10px] font-mono text-slate-400 dark:text-white/35">{fmtCost(item.cost)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Tools */}
            {agg?.tools && agg.tools.tools.length > 0 && (
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
                <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3">{u.toolCalls} ({agg.tools.uniqueTools})</h3>
                <div className="space-y-2">
                  {agg.tools.tools.slice(0, 8).map((tool, i) => (
                    <AnimatedBar
                      key={tool.name}
                      value={tool.count}
                      max={agg.tools.tools[0]?.count || 1}
                      color={MODEL_COLORS[i % MODEL_COLORS.length]}
                      label={tool.name}
                      rightLabel={String(tool.count)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Models Tab */}
        {totals && tab === 'models' && (() => {
          const filteredModels = models.filter(m => (m.totals?.totalTokens || 0) > 0);
          return (
          <div className="space-y-3 max-w-4xl mx-auto animate-in fade-in duration-300">
            {filteredModels.length === 0 ? (
              <div className="text-center py-12 text-slate-400 dark:text-white/40 text-[11px]">{u.noData}</div>
            ) : (
              filteredModels.map((m, i) => (
                <div key={i} className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-3 h-3 rounded-full" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[12px] font-bold dark:text-white/90 text-slate-700 truncate">{m.model || u.unknown}</h4>
                      <p className="text-[10px] text-slate-400 dark:text-white/40">{m.provider || ''} · {m.count} {u.count}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black tabular-nums dark:text-white text-slate-700">{fmtTokens(m.totals?.totalTokens || 0)}</p>
                      <p className="text-[10px] font-mono text-amber-500">{fmtCost((m.totals?.totalCost || 0))}</p>
                    </div>
                  </div>
                  <AnimatedBar value={m.totals?.totalTokens || 0} max={maxModelTokens} color={MODEL_COLORS[i % MODEL_COLORS.length]}
                    label={`${u.input}: ${fmtTokens((m.totals?.input || 0))}`} sublabel={`${u.output}: ${fmtTokens((m.totals?.output || 0))}`}
                    rightLabel={`${(((m.totals?.totalTokens || 0) / (totals?.totalTokens || 1)) * 100).toFixed(1)}%`} />
                </div>
              ))
            )}
          </div>
        );})()}

        {/* Sessions Tab */}
        {totals && tab === 'sessions' && (
          <div className="space-y-2 max-w-4xl mx-auto animate-in fade-in duration-300">
            {/* Header with count and model filter indicator */}
            <div className="flex items-center justify-between px-1 mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-500 dark:text-white/50">
                  {u.sessionsCount}: {filteredSessions.length}
                  {selectedModel && <span className="text-primary ml-1">· {u.filterByModel}: {selectedModel}</span>}
                </span>
              </div>
              {totalSessionPages > 1 && (
                <span className="text-[10px] text-slate-400 dark:text-white/40">
                  {u.pageXofY?.replace('{current}', String(sessionsPage)).replace('{total}', String(totalSessionPages)) || `${sessionsPage}/${totalSessionPages}`}
                </span>
              )}
            </div>
            {paginatedSessions.length === 0 ? (
              <div className="text-center py-12 text-slate-400 dark:text-white/40 text-[11px]">{u.noData}</div>
            ) : (
              <>
              {paginatedSessions
                .map((s, i) => (
                  <div key={s.key} className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] px-4 py-3 hover:border-primary/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-white/[0.06] flex items-center justify-center text-[10px] font-bold text-slate-400 dark:text-white/40">
                        {(sessionsPage - 1) * PAGE_SIZE + i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-bold dark:text-white/80 text-slate-700 truncate">{s.label || s.key}</p>
                          {getSessionLastActive(s) && <span className="text-[10px] text-slate-400 dark:text-white/35">{fmtRelativeTime(getSessionLastActive(s), u)}</span>}
                        </div>
                        <div className="flex gap-3 mt-0.5 text-[10px] text-slate-400 dark:text-white/35">
                          <span>{u.messages}: {getSessionMessages(s).total || 0}</span>
                          <span>{u.toolCalls}: {getSessionMessages(s).toolCalls || 0}</span>
                          {(getSessionMessages(s).errors || 0) > 0 && <span className="text-red-400">{u.errors}: {getSessionMessages(s).errors}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className="text-right mr-1">
                          <p className="text-[12px] font-bold tabular-nums dark:text-white/80 text-slate-600">{fmtTokens(getSessionTokens(s))}</p>
                          <p className="text-[10px] font-mono text-amber-500">{fmtCost(getSessionCost(s))}</p>
                        </div>
                        <button onClick={() => openSessionDetail(s.key, 'timeseries')}
                          className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 flex items-center justify-center transition-colors"
                          title={u.timeseries}>
                          <span className="material-symbols-outlined text-[14px]">timeline</span>
                        </button>
                        <button onClick={() => openSessionDetail(s.key, 'logs')}
                          className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 flex items-center justify-center transition-colors"
                          title={u.usageLogs}>
                          <span className="material-symbols-outlined text-[14px]">receipt_long</span>
                        </button>
                        {onNavigateToSession && (
                          <button onClick={() => onNavigateToSession(s.key)}
                            className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 flex items-center justify-center transition-colors"
                            title={u.goToSession}>
                            <span className="material-symbols-outlined text-[14px]">chat</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/[0.04] overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-400 transition-all duration-500"
                          style={{ width: `${Math.max((getSessionTokens(s) / maxSessionTokens) * 100, 0.5)}%` }} />
                      </div>
                    </div>
                  </div>
                ))}
              {/* Pagination */}
              {totalSessionPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                  <button onClick={() => setSessionsPage(p => Math.max(1, p - 1))} disabled={sessionsPage === 1}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/[0.1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    ← {u.prevPage}
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalSessionPages) }, (_, i) => {
                      let page: number;
                      if (totalSessionPages <= 5) page = i + 1;
                      else if (sessionsPage <= 3) page = i + 1;
                      else if (sessionsPage >= totalSessionPages - 2) page = totalSessionPages - 4 + i;
                      else page = sessionsPage - 2 + i;
                      return (
                        <button key={page} onClick={() => setSessionsPage(page)}
                          className={`w-7 h-7 rounded-lg text-[11px] font-bold transition-colors ${
                            sessionsPage === page
                              ? 'bg-primary text-white'
                              : 'bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/[0.1]'
                          }`}>
                          {page}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => setSessionsPage(p => Math.min(totalSessionPages, p + 1))} disabled={sessionsPage === totalSessionPages}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/[0.1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {u.nextPage} →
                  </button>
                </div>
              )}
              </>
            )}
          </div>
        )}

        {/* Timeseries Tab */}
        {tab === 'timeseries' && (
          <div className="max-w-4xl mx-auto animate-in fade-in duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <button onClick={() => setTab('sessions')} className="p-1 text-slate-400 hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                </button>
                <h3 className="text-[12px] font-bold text-slate-700 dark:text-white/80">{u.timeseries}</h3>
                {selectedSessionKey && <span className="text-[10px] font-mono text-slate-400 dark:text-white/35 truncate max-w-[200px]">{selectedSessionKey}</span>}
              </div>
              <button onClick={() => { setTsData(null); fetchTimeseries(); }} disabled={tsLoading}
                className="text-[10px] text-primary hover:underline disabled:opacity-40">{u.refresh}</button>
            </div>
            {tsLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <span className="material-symbols-outlined text-[20px] animate-spin mr-2">progress_activity</span>
                <span className="text-[11px]">{u.timeseriesLoading}</span>
              </div>
            ) : tsData && tsData.length > 0 ? (() => {
              const filtered = tsData.filter((pt: any) => (pt.tokens || pt.value || 0) > 0);
              const maxVal = Math.max(...filtered.map((p: any) => p.tokens || p.value || 1), 1);
              return filtered.length > 0 ? (
              <div className="space-y-1">
                {filtered.map((pt: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white dark:bg-white/[0.02] border border-slate-200/40 dark:border-white/[0.04]">
                    <span className="text-[10px] font-mono text-slate-400 dark:text-white/40 w-32 shrink-0">{fmtTimestamp(pt.timestamp || pt.date || pt.t, u)}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-white/[0.04] overflow-hidden">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, ((pt.tokens || pt.value || 0) / maxVal) * 100)}%` }} />
                    </div>
                    <span className="text-[10px] font-mono font-bold text-slate-600 dark:text-white/60 w-16 text-right">{fmtTokens(pt.tokens || pt.value || 0)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="text-center py-16 text-slate-400 dark:text-white/40 text-[11px]">{u.timeseriesEmpty}</div>;})() : (
              <div className="text-center py-16 text-slate-400 dark:text-white/40 text-[11px]">{u.timeseriesEmpty}</div>
            )}
          </div>
        )}

        {/* Logs Tab */}
        {tab === 'logs' && (() => {
          const filtered = (logsData || []).filter((log: any) => (log.tokens || 0) > 0 || log.error);
          const totalLogsPages = Math.ceil(filtered.length / PAGE_SIZE);
          const paginatedLogs = filtered.slice((logsPage - 1) * PAGE_SIZE, logsPage * PAGE_SIZE);
          return (
          <div className="max-w-4xl mx-auto animate-in fade-in duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <button onClick={() => setTab('sessions')} className="p-1 text-slate-400 hover:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                </button>
                <h3 className="text-[12px] font-bold text-slate-700 dark:text-white/80">{u.usageLogs}</h3>
                {selectedSessionKey && <span className="text-[10px] font-mono text-slate-400 dark:text-white/35 truncate max-w-[200px]">{selectedSessionKey}</span>}
                {filtered.length > 0 && <span className="text-[10px] text-slate-400 dark:text-white/40">({filtered.length} {u.rowsCount})</span>}
              </div>
              <button onClick={() => { setLogsData(null); setLogsPage(1); fetchLogs(); }} disabled={logsLoading}
                className="text-[10px] text-primary hover:underline disabled:opacity-40">{u.loadLogs}</button>
            </div>
            {logsLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <span className="material-symbols-outlined text-[20px] animate-spin mr-2">progress_activity</span>
                <span className="text-[11px]">{u.logsLoading}</span>
              </div>
            ) : paginatedLogs.length > 0 ? (
              <>
              <div className="space-y-1">
                {paginatedLogs.map((log: any, i: number) => (
                  <div key={i} className="px-3 py-2 rounded-lg bg-white dark:bg-white/[0.02] border border-slate-200/40 dark:border-white/[0.04]">
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="font-mono text-slate-400 dark:text-white/40 w-32 shrink-0">{fmtTimestamp(log.timestamp || log.date || log.ts, u)}</span>
                      {log.model && <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-bold truncate max-w-[100px]">{log.model}</span>}
                      {log.session && <span className="text-slate-400 dark:text-white/35 truncate max-w-[100px]">{log.session}</span>}
                      <span className="ml-auto font-mono font-bold text-slate-600 dark:text-white/60">{fmtTokens(log.tokens || 0)}</span>
                      {log.cost != null && <span className="font-mono text-amber-500">{fmtCost(log.cost)}</span>}
                    </div>
                    {log.error && <p className="text-[11px] text-red-400 mt-0.5">{log.error}</p>}
                  </div>
                ))}
              </div>
              {/* Logs Pagination */}
              {totalLogsPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-4">
                  <button onClick={() => setLogsPage(p => Math.max(1, p - 1))} disabled={logsPage === 1}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/[0.1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    ← {u.prevPage}
                  </button>
                  <span className="text-[10px] text-slate-400 dark:text-white/40">
                    {logsPage} / {totalLogsPages}
                  </span>
                  <button onClick={() => setLogsPage(p => Math.min(totalLogsPages, p + 1))} disabled={logsPage === totalLogsPages}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-white/[0.06] text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/[0.1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {u.nextPage} →
                  </button>
                </div>
              )}
              </>
            ) : (
              <div className="text-center py-16 text-slate-400 dark:text-white/40 text-[11px]">{u.noLogs}</div>
            )}
          </div>
        );})()}
      </div>

      {/* Budget Settings Modal */}
      {showBudgetModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowBudgetModal(false)}>
          <div className="bg-white dark:bg-[#1e2028] rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-amber-500">account_balance_wallet</span>
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">{es.budget}</h3>
            </div>
            
            <div className="space-y-4">
              {/* Daily Limit */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.dailyBudget} ($)</label>
                <input type="number" step="0.01" min="0" value={editBudget.dailyLimit || ''} 
                  onChange={e => setEditBudget({ ...editBudget, dailyLimit: Number(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full h-9 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg px-3 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-primary" />
                <p className="text-[10px] text-slate-400 mt-0.5">{es.budgetDailyHint}</p>
              </div>

              {/* Monthly Limit */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.monthlyBudget} ($)</label>
                <input type="number" step="0.01" min="0" value={editBudget.monthlyLimit || ''} 
                  onChange={e => setEditBudget({ ...editBudget, monthlyLimit: Number(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="w-full h-9 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-lg px-3 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-primary" />
                <p className="text-[10px] text-slate-400 mt-0.5">{es.budgetMonthlyHint}</p>
              </div>

              {/* Alert Threshold */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 mb-1 block">{es.budgetThreshold} (%)</label>
                <div className="flex items-center gap-3">
                  <input type="range" min="50" max="100" step="5" value={editBudget.alertThreshold}
                    onChange={e => setEditBudget({ ...editBudget, alertThreshold: Number(e.target.value) })}
                    className="flex-1 h-2 bg-slate-200 dark:bg-white/10 rounded-full appearance-none cursor-pointer accent-primary" />
                  <span className="text-xs font-bold text-slate-600 dark:text-white/60 w-10 text-right">{editBudget.alertThreshold}%</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">{es.budgetThresholdHint}</p>
              </div>

              {/* Action */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 mb-1.5 block">{es.budgetAction}</label>
                <div className="flex gap-2">
                  {(['warn', 'pause', 'continue'] as const).map(action => (
                    <button key={action} onClick={() => setEditBudget({ ...editBudget, action })}
                      className={`flex-1 px-3 py-2 rounded-lg text-[11px] font-bold border-2 transition-all ${
                        editBudget.action === action 
                          ? 'border-primary bg-primary/5 text-primary' 
                          : 'border-slate-200 dark:border-white/10 text-slate-500 hover:border-slate-300'
                      }`}>
                      {action === 'warn' ? es.budgetActionWarn : 
                       action === 'pause' ? es.budgetActionPause : 
                       es.budgetActionContinue}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
              <button onClick={() => setShowBudgetModal(false)} 
                className="px-4 h-9 text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                {es.cancel}
              </button>
              <button onClick={saveBudget} 
                className="px-5 h-9 bg-primary text-white text-[11px] font-bold rounded-lg hover:bg-primary/90 transition-colors">
                {es.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Usage;
