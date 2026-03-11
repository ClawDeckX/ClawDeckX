import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { doctorApi } from '../services/api';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { TestCenterPanel } from '../components/maintenance';
import { subscribeManagerWS } from '../services/manager-ws';
import CustomSelect from '../components/CustomSelect';
import { saTranslate } from '../utils/saTranslate';
import { templateSystem } from '../services/template-system';
import type { KnowledgeItem } from '../services/template-system';
import type { ManagerWSStatus } from '../services/manager-ws';
import { copyToClipboard } from '../utils/clipboard';

type TabId = 'diagnose' | 'testing';
type TimeRange = '1h' | '6h' | '24h';

interface DoctorProps {
  language: Language;
}

interface CheckItem {
  id: string;
  code?: string;
  name: string;
  status: 'ok' | 'warn' | 'error';
  severity?: 'info' | 'warn' | 'error';
  category?: string;
  detail: string;
  suggestion?: string;
  remediation?: string;
  fixable?: boolean;
}

interface DiagResult {
  items: CheckItem[];
  summary: string;
  score: number;
}

interface OverviewPoint {
  timestamp: string;
  label: string;
  healthScore: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
  errors: number;
}

interface DoctorOverview {
  score: number;
  status: 'ok' | 'warn' | 'error';
  summary: string;
  updatedAt: string;
  cards: Array<{ id: string; label: string; value: number; unit?: string; trend?: number; status: 'ok' | 'warn' | 'error' }>;
  riskCounts: Record<string, number>;
  trend24h: OverviewPoint[];
  topIssues: Array<{ id: string; source: string; category: string; risk: string; title: string; detail?: string; timestamp: string }>;
  actions: Array<{ id: string; title: string; target: string; priority: 'high' | 'medium' | 'low' }>;
}

interface SecurityAuditItem {
  id: string;
  code?: string;
  name: string;
  status: 'ok' | 'warn' | 'error';
  severity?: 'info' | 'warn' | 'error';
  detail: string;
  suggestion?: string;
  remediation?: string;
  category?: string;
}

interface SecurityAuditSummary {
  critical: number;
  warn: number;
  info: number;
  total: number;
  items: SecurityAuditItem[];
}

interface DoctorSummary {
  score: number;
  status: 'ok' | 'warn' | 'error';
  summary: string;
  updatedAt: string;
  gateway: { running: boolean; detail: string };
  healthCheck: { enabled: boolean; failCount: number; maxFails: number; lastOk: string };
  exceptionStats: { medium5m: number; high5m: number; critical5m: number; total1h: number; total24h: number };
  sessionErrors: { totalErrors: number; sessionCount: number; errorSessions: number };
  recentIssues: Array<{ id: string; source: string; category: string; risk: string; title: string; detail?: string; timestamp: string }>;
  securityAudit?: SecurityAuditSummary;
}

interface LocalizedCheckItem extends CheckItem {
  displayName: string;
  displayDetail: string;
  displaySuggestion?: string;
}

interface CheckLocaleEntry {
  name?: string;
  detail?: string;
  suggestion?: string;
}

interface SummaryBucketEntry {
  ts: number;
  source: SummarySourceKey | 'seed';
}

interface SummaryWindowBuckets {
  medium: SummaryBucketEntry[];
  high: SummaryBucketEntry[];
  critical: SummaryBucketEntry[];
  hour: SummaryBucketEntry[];
  day: SummaryBucketEntry[];
}

interface DeductionItem {
  key: string;
  label: string;
  points: number;
  maxPoints: number;
  color: string;
}

type SummarySourceKey = 'all' | 'alert' | 'gateway' | 'cron' | 'chat' | 'tool' | 'doctor' | 'system' | 'security';
type SummaryRiskFilter = 'all' | 'critical' | 'high' | 'medium';

const SUMMARY_SOURCE_STORAGE_KEY = 'doctor.summarySourceFilter';
const SUMMARY_RISK_STORAGE_KEY = 'doctor.summaryRiskFilter';
const TIME_RANGE_STORAGE_KEY = 'doctor.timeRange';
const DOCTOR_HAS_RUN_KEY = 'doctor.hasRun';
const DOCTOR_RESULT_CACHE_KEY = 'doctor.resultCache';
const DOCTOR_LAST_SCORE_KEY = 'doctor.lastScore';
const SECURITY_AUDIT_CACHE_KEY = 'doctor.securityAuditCache';

function statusClass(status: 'ok' | 'warn' | 'error') {
  if (status === 'ok') return 'text-emerald-500 bg-emerald-500/10';
  if (status === 'warn') return 'text-amber-500 bg-amber-500/10';
  return 'text-red-500 bg-red-500/10';
}

function statusBarColor(status: 'ok' | 'warn' | 'error') {
  if (status === 'ok') return 'bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400';
  if (status === 'warn') return 'bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400';
  return 'bg-gradient-to-r from-red-400 via-red-500 to-red-400';
}

function gaugeColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  if (score >= 30) return '#f97316';
  return '#ef4444';
}

function relativeTime(ts: string, text: any): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return text.timelineJustNow || 'Just now';
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return (text.timelineMinAgo || '{n}m ago').replace('{n}', String(m));
  }
  const h = Math.floor(diff / 3_600_000);
  return (text.timelineHourAgo || '{n}h ago').replace('{n}', String(h));
}

function formatIssueTitle(raw?: string): string {
  if (!raw) return '';
  const s = raw.trim();
  // Not JSON — check for known prefixes with embedded JSON
  if (!s.startsWith('{') && !s.startsWith('[')) {
    // "Gateway error/warning: {JSON...}" → extract from JSON part
    const gwMatch = s.match(/^(Gateway (?:error|warning):\s*)(\{.+)/s);
    if (gwMatch) return `${gwMatch[1]}${formatIssueTitle(gwMatch[2])}`;
    // "Event error/warning [event]: {JSON...}" → extract from JSON part
    const evtMatch = s.match(/^(Event (?:error|warning) \[[^\]]+\]:\s*)(\{.+)/s);
    if (evtMatch) return `${evtMatch[1]}${formatIssueTitle(evtMatch[2])}`;
    // "Tool call: name → {JSON...}" → extract key params from JSON
    const toolMatch = s.match(/^(Tool call:\s*\S+)\s*→\s*(\{.+)/s);
    if (toolMatch) return `${toolMatch[1]} → ${formatIssueTitle(toolMatch[2])}`;
    // "[role] {JSON...}" → extract from JSON part
    const roleMatch = s.match(/^(\[[^\]]+\]\s*)(\{.+)/s);
    if (roleMatch) return `${roleMatch[1]}${formatIssueTitle(roleMatch[2])}`;
    // "component: {...} message: {...}: text" pattern
    const compMsgMatch = s.match(/^component:\s*\{[^}]*"?([^"}\s,]+)"?\}.*?message:\s*(?:\{[^}]*\}:\s*)?(.+)/i);
    if (compMsgMatch) return `[${compMsgMatch[1]}] ${compMsgMatch[2].slice(0, 80)}`;
    return s;
  }
  try {
    const obj = JSON.parse(s);
    if (typeof obj !== 'object' || obj === null) return s;
    const msg = obj.message || obj.msg || obj.error || obj.err || obj.errorMessage || obj.error_message;
    const comp = obj.component || obj.subsystem || obj.module || obj.source;
    if (msg && comp) return `[${comp}] ${String(msg).slice(0, 80)}`;
    if (msg) return String(msg).slice(0, 100);
    if (comp) return `[${comp}] ${obj.level || obj.status || obj.state || 'event'}`;
    // Fallback: pick first meaningful string value
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > 2 && v.length < 120) return `${k}: ${v}`;
    }
    return s.slice(0, 100);
  } catch {
    // Semi-JSON: try to extract message after colon
    const tailMatch = s.match(/\}[:\s]*(.{3,80})/);
    if (tailMatch) return tailMatch[1].trim();
    return s.slice(0, 100);
  }
}

function formatIssueDetail(raw?: string): string {
  if (!raw) return '';
  const s = raw.trim();
  if (!s.startsWith('{') && !s.startsWith('[')) return s;
  try {
    const obj = JSON.parse(s);
    if (typeof obj !== 'object' || obj === null) return s;
    const picks: string[] = [];
    const errMsg = obj.errorMessage || obj.error_message || obj.error || obj.message;
    if (errMsg) picks.push(String(errMsg));
    const state = obj.state || obj.status;
    if (state) picks.push(`state: ${state}`);
    const key = obj.sessionKey || obj.session_key;
    if (key) picks.push(`session: ${String(key).slice(0, 32)}`);
    const code = obj.statusCode ?? obj.status_code ?? obj.code;
    if (code !== undefined && code !== null) picks.push(`code: ${code}`);
    const runId = obj.runId || obj.run_id;
    if (runId) picks.push(`run: ${String(runId).slice(0, 12)}`);
    if (picks.length === 0) {
      const keys = Object.keys(obj).slice(0, 3);
      keys.forEach(k => { if (obj[k] !== null && obj[k] !== undefined) picks.push(`${k}: ${String(obj[k]).slice(0, 60)}`); });
    }
    return picks.join(' · ') || s;
  } catch {
    return s;
  }
}

function filterTrendByRange(trend: OverviewPoint[], range: TimeRange): OverviewPoint[] {
  if (!trend || trend.length === 0) return [];
  const now = Date.now();
  const ms = range === '1h' ? 3_600_000 : range === '6h' ? 21_600_000 : 86_400_000;
  const cutoff = now - ms;
  return trend.filter(p => new Date(p.timestamp).getTime() >= cutoff);
}

function detectScoreDrops(trend: OverviewPoint[], threshold = 15): number[] {
  const drops: number[] = [];
  for (let i = 1; i < trend.length; i++) {
    if (trend[i - 1].healthScore - trend[i].healthScore >= threshold) {
      drops.push(i);
    }
  }
  return drops;
}

const Doctor: React.FC<DoctorProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const dateLocale = useMemo(() => ({ zh: 'zh-CN', en: 'en-US' } as Record<string, string>)[language] || 'en-US', [language]);
  const common = (t.common || {}) as any;
  const dr = (t.dr || {}) as any;
  const maint = (t.maint || {}) as any;
  const text = dr;
  const na = common.na || '--';
  const formatText = useCallback((template: string, vars: Record<string, string | number>) => {
    return String(template || '').replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
  }, []);

  const [activeTab, setActiveTab] = useState<TabId>('diagnose');
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    if (typeof window === 'undefined') return '24h';
    const saved = window.localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return (['1h', '6h', '24h'] as TimeRange[]).includes(saved as TimeRange) ? (saved as TimeRange) : '24h';
  });
  const [result, setResult] = useState<DiagResult | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(DOCTOR_RESULT_CACHE_KEY);
      if (raw) return JSON.parse(raw) as DiagResult;
    } catch { /* ignore */ }
    return null;
  });
  const [isCachedResult, setIsCachedResult] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!window.localStorage.getItem(DOCTOR_RESULT_CACHE_KEY);
  });
  const [lastScanTime, setLastScanTime] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    try {
      const raw = window.localStorage.getItem(DOCTOR_RESULT_CACHE_KEY);
      if (raw) { const d = JSON.parse(raw); return d?._cachedAt || ''; }
    } catch { /* ignore */ }
    return '';
  });
  const [prevScore, setPrevScore] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const v = window.localStorage.getItem(DOCTOR_LAST_SCORE_KEY);
    return v !== null ? Number(v) : null;
  });
  const [overview, setOverview] = useState<DoctorOverview | null>(null);
  const [summary, setSummary] = useState<DoctorSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDiagnoseEntering, setIsDiagnoseEntering] = useState(false);
  const [isAutoDoctorPending, setIsAutoDoctorPending] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [fixResult, setFixResult] = useState<string[]>([]);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warn' | 'ok'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [onlyFixable, setOnlyFixable] = useState(false);
  const [fixingOne, setFixingOne] = useState<string>('');
  const [wsConnected, setWsConnected] = useState(true);
  const [showFirstRunPrompt, setShowFirstRunPrompt] = useState(false);
  const [showExceptionModal, setShowExceptionModal] = useState(false);
  const [summarySourceFilter, setSummarySourceFilter] = useState<SummarySourceKey>(() => {
    if (typeof window === 'undefined') return 'all';
    const saved = window.localStorage.getItem(SUMMARY_SOURCE_STORAGE_KEY);
    const allowed: SummarySourceKey[] = ['all', 'alert', 'gateway', 'cron', 'chat', 'tool', 'doctor', 'system'];
    return allowed.includes(saved as SummarySourceKey) ? (saved as SummarySourceKey) : 'all';
  });
  const [summaryRiskFilter, setSummaryRiskFilter] = useState<SummaryRiskFilter>(() => {
    if (typeof window === 'undefined') return 'all';
    const saved = window.localStorage.getItem(SUMMARY_RISK_STORAGE_KEY);
    const allowed: SummaryRiskFilter[] = ['all', 'critical', 'high', 'medium'];
    return allowed.includes(saved as SummaryRiskFilter) ? (saved as SummaryRiskFilter) : 'all';
  });
  const [expandedSummaryGroups, setExpandedSummaryGroups] = useState<string[]>([]);
  const [expandedSecurityItems, setExpandedSecurityItems] = useState<Set<string>>(new Set());
  const [securityAuditCollapsed, setSecurityAuditCollapsed] = useState(false);
  const [securityGuideDismissed, setSecurityGuideDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('doctor.securityGuideDismissed') === '1';
  });
  const [copiedCmd, setCopiedCmd] = useState<string>('');
  const [securityDiff, setSecurityDiff] = useState<{ newIds: Set<string>; fixedIds: Set<string> }>(
    { newIds: new Set(), fixedIds: new Set() }
  );
  const [sourceFilter, setSourceFilter] = useState<SummarySourceKey>('all');
  const [doctorFaqIndex, setDoctorFaqIndex] = useState<Map<string, KnowledgeItem[]>>(new Map());
  const summaryRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryBucketsRef = useRef<SummaryWindowBuckets>({ medium: [], high: [], critical: [], hour: [], day: [] });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
  }, [timeRange]);

  // Load Doctor ↔ FAQ reverse index
  useEffect(() => {
    templateSystem.getDoctorFaqIndex(language).then(idx => setDoctorFaqIndex(idx)).catch(() => {});
  }, [language]);

  // Security audit history comparison
  useEffect(() => {
    if (!summary?.securityAudit) return;
    const currentIds = new Set((summary.securityAudit.items || []).map(i => i.id));
    try {
      const prevRaw = window.localStorage.getItem(SECURITY_AUDIT_CACHE_KEY);
      if (prevRaw) {
        const prevIds = new Set<string>(JSON.parse(prevRaw) as string[]);
        const newIds = new Set<string>();
        const fixedIds = new Set<string>();
        currentIds.forEach(id => { if (!prevIds.has(id)) newIds.add(id); });
        prevIds.forEach(id => { if (!currentIds.has(id)) fixedIds.add(id); });
        setSecurityDiff({ newIds, fixedIds });
      }
      window.localStorage.setItem(SECURITY_AUDIT_CACHE_KEY, JSON.stringify(Array.from(currentIds)));
    } catch { /* ignore */ }
  }, [summary?.securityAudit]);

  const runDoctor = useCallback(async (force = false) => {
    const data = await doctorApi.runCached(60000, force) as DiagResult;
    setResult(data);
    setIsCachedResult(false);
    const now = new Date().toISOString();
    setLastScanTime(now);
    if (typeof window !== 'undefined') {
      try {
        const toCache = { ...data, _cachedAt: now };
        window.localStorage.setItem(DOCTOR_RESULT_CACHE_KEY, JSON.stringify(toCache));
      } catch { /* quota exceeded — ignore */ }
      if (typeof data?.score === 'number') {
        const prev = window.localStorage.getItem(DOCTOR_LAST_SCORE_KEY);
        if (prev !== null) setPrevScore(Number(prev));
        window.localStorage.setItem(DOCTOR_LAST_SCORE_KEY, String(data.score));
      }
    }
  }, []);

  const pruneSummaryBuckets = useCallback((nowMs = Date.now()) => {
    const cutoff5m = nowMs - (5 * 60 * 1000);
    const cutoff1h = nowMs - (60 * 60 * 1000);
    const cutoff24h = nowMs - (24 * 60 * 60 * 1000);
    const buckets = summaryBucketsRef.current;
    buckets.medium = buckets.medium.filter((entry) => entry.ts >= cutoff5m);
    buckets.high = buckets.high.filter((entry) => entry.ts >= cutoff5m);
    buckets.critical = buckets.critical.filter((entry) => entry.ts >= cutoff5m);
    buckets.hour = buckets.hour.filter((entry) => entry.ts >= cutoff1h);
    buckets.day = buckets.day.filter((entry) => entry.ts >= cutoff24h);
    return buckets;
  }, []);

  const seedSummaryBuckets = useCallback((data: DoctorSummary) => {
    const stamp = new Date(data?.updatedAt || Date.now()).getTime();
    const seedTs = Number.isFinite(stamp) ? stamp : Date.now();
    summaryBucketsRef.current = {
      medium: Array.from({ length: Math.max(0, data?.exceptionStats?.medium5m || 0) }, () => ({ ts: seedTs, source: 'seed' as const })),
      high: Array.from({ length: Math.max(0, data?.exceptionStats?.high5m || 0) }, () => ({ ts: seedTs, source: 'seed' as const })),
      critical: Array.from({ length: Math.max(0, data?.exceptionStats?.critical5m || 0) }, () => ({ ts: seedTs, source: 'seed' as const })),
      hour: Array.from({ length: Math.max(0, data?.exceptionStats?.total1h || 0) }, () => ({ ts: seedTs, source: 'seed' as const })),
      day: Array.from({ length: Math.max(0, data?.exceptionStats?.total24h || 0) }, () => ({ ts: seedTs, source: 'seed' as const })),
    };
    pruneSummaryBuckets();
  }, [pruneSummaryBuckets]);

  const countBucketEntries = useCallback((entries: SummaryBucketEntry[], scope: SummarySourceKey = 'all') => {
    if (scope === 'all') return entries.length;
    return entries.filter((entry) => entry.source === scope).length;
  }, []);

  const applyBucketCountsToSummary = useCallback((base: DoctorSummary) => {
    const buckets = pruneSummaryBuckets();
    const nextMedium = countBucketEntries(buckets.medium);
    const nextHigh = countBucketEntries(buckets.high);
    const nextCritical = countBucketEntries(buckets.critical);
    const nextHour = countBucketEntries(buckets.hour);
    const nextDay = countBucketEntries(buckets.day);
    const currentStats = base.exceptionStats || { medium5m: 0, high5m: 0, critical5m: 0, total1h: 0, total24h: 0 };
    if (
      currentStats.medium5m === nextMedium &&
      currentStats.high5m === nextHigh &&
      currentStats.critical5m === nextCritical &&
      currentStats.total1h === nextHour &&
      currentStats.total24h === nextDay
    ) {
      return base;
    }
    return {
      ...base,
      exceptionStats: {
        ...currentStats,
        medium5m: nextMedium,
        high5m: nextHigh,
        critical5m: nextCritical,
        total1h: nextHour,
        total24h: nextDay,
      },
    };
  }, [countBucketEntries, pruneSummaryBuckets]);

  const loadOverview = useCallback(async (force = false) => {
    const data = await doctorApi.overviewCached(12000, force) as DoctorOverview;
    setOverview(data);
    setIsDiagnoseEntering(false);
    setLastUpdate(new Date(data?.updatedAt || Date.now()).toLocaleString(dateLocale));
  }, [dateLocale]);

  const loadSummary = useCallback(async (force = false) => {
    setSummaryLoading(true);
    try {
      const data = await doctorApi.summaryCached(5000, force) as DoctorSummary;
      if (data?.recentIssues) {
        data.recentIssues = data.recentIssues.map(issue => ({
          ...issue,
          title: formatIssueTitle(issue.title) || issue.title,
        }));
      }
      seedSummaryBuckets(data);
      setSummary(applyBucketCountsToSummary(data));
      setIsDiagnoseEntering(false);
      if (!overview) {
        setLastUpdate(new Date(data?.updatedAt || Date.now()).toLocaleString(dateLocale));
      }
    } catch {
      // Keep summary loading non-blocking.
    } finally {
      setSummaryLoading(false);
    }
  }, [applyBucketCountsToSummary, dateLocale, overview, seedSummaryBuckets]);

  const fetchAll = useCallback(async (force = false) => {
    setLoading(force || (!result && !overview));
    setLoadError('');
    try {
      await Promise.all([runDoctor(force), loadOverview(force), loadSummary(force)]);
      if (typeof window !== 'undefined') window.localStorage.setItem(DOCTOR_HAS_RUN_KEY, '1');
      setShowFirstRunPrompt(false);
    } catch (err: any) {
      const msg = err?.message || '';
      const hint = msg ? `: ${msg}` : '';
      setLoadError(`${text.overviewLoadFail}${hint}`);
      toast('error', `${text.overviewLoadFail}${hint}`);
    } finally {
      setLoading(false);
    }
  }, [loadOverview, loadSummary, runDoctor, text.overviewLoadFail, toast]);

  const scheduleSummaryRefresh = useCallback((immediate = false) => {
    if (summaryRefreshTimerRef.current) {
      clearTimeout(summaryRefreshTimerRef.current);
      summaryRefreshTimerRef.current = null;
    }
    summaryRefreshTimerRef.current = setTimeout(() => {
      summaryRefreshTimerRef.current = null;
      loadSummary(true);
    }, immediate ? 0 : 900);
  }, [loadSummary]);

  function deriveSummary(base: DoctorSummary, sessErrors: { totalErrors: number; errorSessions: number } = { totalErrors: 0, errorSessions: 0 }): DoctorSummary {
    const stats = base.exceptionStats || { medium5m: 0, high5m: 0, critical5m: 0, total1h: 0, total24h: 0 };
    const gatewayRunning = !!base.gateway?.running;
    const health = base.healthCheck || { enabled: false, failCount: 0, maxFails: 0, lastOk: '' };

    let score = 100;
    if (!gatewayRunning) score -= 35;
    score -= Math.min(10, (stats.medium5m || 0) * 2);
    score -= Math.min(30, (stats.high5m || 0) * 10);
    score -= Math.min(50, (stats.critical5m || 0) * 25);
    if (health.enabled && (health.failCount || 0) > 0) {
      score -= Math.min(25, (health.failCount || 0) * 10);
    }
    // Session/chat errors deduction
    if (sessErrors.totalErrors > 0) {
      score -= Math.min(10, sessErrors.errorSessions * 3);
    }
    // Security audit: only critical findings impact score; warn-level are advisory only
    const secAudit = base.securityAudit;
    if (secAudit && secAudit.critical > 0) {
      score -= Math.min(40, secAudit.critical * 15);
    }
    if (score < 0) score = 0;

    let status: 'ok' | 'warn' | 'error' = 'ok';
    if (!gatewayRunning || (stats.critical5m || 0) > 0 || (health.enabled && (health.maxFails || 0) > 0 && (health.failCount || 0) >= (health.maxFails || 0))) {
      status = 'error';
    } else if ((stats.high5m || 0) > 0 || (stats.medium5m || 0) > 0 || (health.enabled && (health.failCount || 0) > 0)) {
      status = 'warn';
    }

    let summaryText = text.summaryStable || 'Stable, no recent exceptions';
    if (status === 'error') {
      if (!gatewayRunning) summaryText = text.summaryGatewayOffline || summaryText;
      else if ((stats.critical5m || 0) > 0) summaryText = formatText(text.summaryCriticalRecent || 'Critical exceptions in the last 5 minutes: {count}', { count: stats.critical5m || 0 });
      else summaryText = text.summaryHealthFailing || summaryText;
    } else if (status === 'warn') {
      if ((stats.high5m || 0) > 0 || (stats.medium5m || 0) > 0) summaryText = formatText(text.summaryRecentDetected || 'Recent exceptions detected ({count} in 1h)', { count: stats.total1h || 0 });
      else summaryText = text.summaryHealthFlaky || summaryText;
    }

    return {
      ...base,
      score,
      status,
      summary: summaryText,
      updatedAt: base.updatedAt || new Date().toISOString(),
    };
  }

  function normalizeEventRisk(value: string): 'low' | 'medium' | 'high' | 'critical' {
    const v = String(value || '').toLowerCase();
    if (v === 'critical' || v === 'error') return 'critical';
    if (v === 'high') return 'high';
    if (v === 'medium' || v === 'warn' || v === 'warning') return 'medium';
    return 'low';
  }

  function detectSummarySourceKey(source?: string, category?: string): SummarySourceKey {
    const s = String(source || '').toLowerCase();
    const c = String(category || '').toLowerCase();
    if (s.includes('security') || c.includes('security')) return 'security';
    if (s.includes('alert')) return 'alert';
    if (s.includes('gateway') || c.includes('gateway')) return 'gateway';
    if (s.includes('cron') || c.includes('cron')) return 'cron';
    if (s.includes('chat') || s.includes('session') || c.includes('message')) return 'chat';
    if (s.includes('tool') || c.includes('tool')) return 'tool';
    if (s.includes('doctor') || c.includes('doctor')) return 'doctor';
    return 'system';
  }

  // --- WebSocket event handling + periodic refresh ---
  useEffect(() => {
    if (activeTab !== 'diagnose') return;
    const timer = setInterval(() => {
      setSummary((prev) => {
        if (!prev) return prev;
        const next = applyBucketCountsToSummary(prev);
        return next === prev ? prev : { ...next, updatedAt: prev.updatedAt };
      });
    }, 10000);
    return () => clearInterval(timer);
  }, [activeTab, applyBucketCountsToSummary]);

  useEffect(() => {
    if (activeTab !== 'diagnose') {
      setIsDiagnoseEntering(false);
      return;
    }
    if (!summary && !overview) {
      setIsDiagnoseEntering(true);
    }
  }, [activeTab, summary, overview]);

  useEffect(() => {
    if (activeTab !== 'diagnose') return;
    loadSummary(false);
    loadOverview(false);
    const timer = setInterval(() => loadSummary(), 30000);
    const unsubscribe = subscribeManagerWS((msg: any) => {
      const typ = String(msg?.type || '');
      const data = (msg?.data || {}) as any;
      if (typ === 'activity') {
        setSummary((prev) => {
          if (!prev) {
            scheduleSummaryRefresh();
            return prev;
          }
          const risk = normalizeEventRisk(data?.risk);
          if (risk === 'low') return prev;

          const timestamp = data?.timestamp || new Date().toISOString();
          const tsMs = new Date(timestamp).getTime();
          const sourceKey = detectSummarySourceKey(data?.source, data?.category);
          const within5m = Number.isFinite(tsMs) && (Date.now() - tsMs) <= 5 * 60 * 1000;
          if (Number.isFinite(tsMs)) {
            summaryBucketsRef.current.hour.push({ ts: tsMs, source: sourceKey });
            summaryBucketsRef.current.day.push({ ts: tsMs, source: sourceKey });
          }
          if (within5m) {
            if (risk === 'critical') summaryBucketsRef.current.critical.push({ ts: tsMs, source: sourceKey });
            else if (risk === 'high') summaryBucketsRef.current.high.push({ ts: tsMs, source: sourceKey });
            else summaryBucketsRef.current.medium.push({ ts: tsMs, source: sourceKey });
          }
          const next: DoctorSummary = {
            ...prev,
            updatedAt: timestamp,
            exceptionStats: {
              ...prev.exceptionStats,
              total1h: prev.exceptionStats?.total1h || 0,
              total24h: prev.exceptionStats?.total24h || 0,
              medium5m: prev.exceptionStats?.medium5m || 0,
              high5m: prev.exceptionStats?.high5m || 0,
              critical5m: prev.exceptionStats?.critical5m || 0,
            },
            recentIssues: [
              {
                id: String(data?.event_id || `${timestamp}-${data?.summary || 'activity'}`),
                source: String(data?.source || ''),
                category: String(data?.category || ''),
                risk,
                title: formatIssueTitle(String(data?.summary || '')) || text.issuesTitle || 'Activity event',
                timestamp,
              },
              ...(prev.recentIssues || []).filter((item) => item.id !== String(data?.event_id || '')),
            ].slice(0, 16),
          };
          return deriveSummary(applyBucketCountsToSummary(next));
        });
        return;
      }
      if (typ === 'alert') {
        setSummary((prev) => {
          if (!prev) {
            scheduleSummaryRefresh();
            return prev;
          }
          let risk = normalizeEventRisk(data?.risk || data?.severity);
          if (risk === 'low') {
            risk = 'medium';
          }

          const timestamp = data?.createdAt || data?.created_at || data?.timestamp || new Date().toISOString();
          const tsMs = new Date(timestamp).getTime();
          if (Number.isFinite(tsMs)) {
            summaryBucketsRef.current.hour.push({ ts: tsMs, source: 'alert' });
            summaryBucketsRef.current.day.push({ ts: tsMs, source: 'alert' });
            if ((Date.now() - tsMs) <= 5 * 60 * 1000) {
              if (risk === 'critical') summaryBucketsRef.current.critical.push({ ts: tsMs, source: 'alert' });
              else if (risk === 'high') summaryBucketsRef.current.high.push({ ts: tsMs, source: 'alert' });
              else summaryBucketsRef.current.medium.push({ ts: tsMs, source: 'alert' });
            }
          }

          const alertID = String(data?.alert_id || data?.alertId || `${timestamp}-${data?.message || 'alert'}`);
          const next: DoctorSummary = {
            ...prev,
            updatedAt: timestamp,
            recentIssues: [
              {
                id: `alert:${alertID}`,
                source: String(data?.source || 'alert'),
                category: String(data?.category || 'security'),
                risk,
                title: String(data?.message || data?.title || text.actionReviewAlerts || 'Alert'),
                detail: String(data?.detail || ''),
                timestamp,
              },
              ...(prev.recentIssues || []).filter((item) => item.id !== `alert:${alertID}`),
            ].slice(0, 16),
          };
          return deriveSummary(applyBucketCountsToSummary(next));
        });
        return;
      }
      if (typ === 'health') {
        setSummary((prev) => {
          if (!prev) return prev;
          const snapshot = data?.snapshot || {};
          const policy = snapshot?.policy || {};
          const failCount = Number(
            data?.failCount ?? data?.fail_count ?? snapshot?.failCount ?? snapshot?.fail_count ?? policy?.failCount ?? policy?.fail_count ?? prev.healthCheck?.failCount ?? 0
          );
          const maxFails = Number(
            data?.maxFails ?? data?.max_fails ?? snapshot?.maxFails ?? snapshot?.max_fails ?? policy?.maxFails ?? policy?.max_fails ?? prev.healthCheck?.maxFails ?? 0
          );
          const lastOk = String(
            data?.lastOk ?? data?.last_ok ?? snapshot?.lastOk ?? snapshot?.last_ok ?? prev.healthCheck?.lastOk ?? ''
          );
          const enabled = Boolean(
            data?.enabled ?? data?.healthCheckEnabled ?? data?.health_check_enabled ?? snapshot?.enabled ?? snapshot?.healthCheckEnabled ?? snapshot?.health_check_enabled ?? prev.healthCheck?.enabled
          );
          return deriveSummary(applyBucketCountsToSummary({
            ...prev,
            updatedAt: new Date().toISOString(),
            gateway: {
              ...prev.gateway,
              running: true,
              detail: String(data?.status || snapshot?.status || prev.gateway?.detail || ''),
            },
            healthCheck: {
              enabled,
              failCount: Number.isFinite(failCount) ? failCount : (prev.healthCheck?.failCount || 0),
              maxFails: Number.isFinite(maxFails) ? maxFails : (prev.healthCheck?.maxFails || 0),
              lastOk: lastOk || prev.healthCheck?.lastOk || '',
            },
          }));
        });
        return;
      }
      if (typ === 'shutdown' || typ === 'kill_switch') {
        setSummary((prev) => {
          if (!prev) return prev;
          const timestamp = data?.timestamp || new Date().toISOString();
          const tsMs = new Date(timestamp).getTime();
          if (Number.isFinite(tsMs)) {
            const sourceKey: SummarySourceKey = typ === 'kill_switch' ? 'alert' : 'gateway';
            summaryBucketsRef.current.high.push({ ts: tsMs, source: sourceKey });
            summaryBucketsRef.current.hour.push({ ts: tsMs, source: sourceKey });
            summaryBucketsRef.current.day.push({ ts: tsMs, source: sourceKey });
          }
          const title = typ === 'kill_switch'
            ? (text.summaryKillSwitch || 'Kill switch triggered')
            : String(data?.reason || text.summaryGatewayShutdown || 'Gateway shutdown');
          const next: DoctorSummary = {
            ...prev,
            updatedAt: timestamp,
            gateway: { ...prev.gateway, running: false, detail: title },
            recentIssues: [
              {
                id: `${typ}:${timestamp}`,
                source: typ === 'kill_switch' ? 'alert' : 'gateway',
                category: 'gateway',
                risk: 'high',
                title,
                timestamp,
              },
              ...(prev.recentIssues || []),
            ].slice(0, 16),
          };
          return deriveSummary(applyBucketCountsToSummary(next));
        });
        scheduleSummaryRefresh();
        return;
      }
      if (typ === 'gateway_status') {
        setSummary((prev) => prev ? deriveSummary(applyBucketCountsToSummary({
          ...prev,
          updatedAt: new Date().toISOString(),
          gateway: {
            ...prev.gateway,
            running: data?.running !== false,
            detail: String(data?.detail || prev.gateway?.detail || ''),
          },
        })) : prev);
        return;
      }
      scheduleSummaryRefresh();
    }, (status: ManagerWSStatus) => {
      if (status === 'open') {
        setWsConnected(true);
        scheduleSummaryRefresh(true);
      } else if (status === 'closed') {
        setWsConnected(false);
      }
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
      if (summaryRefreshTimerRef.current) {
        clearTimeout(summaryRefreshTimerRef.current);
        summaryRefreshTimerRef.current = null;
      }
    };
  }, [activeTab, applyBucketCountsToSummary, language, loadOverview, loadSummary, scheduleSummaryRefresh, text.actionReviewAlerts, text.issuesTitle, text.summaryGatewayShutdown, text.summaryKillSwitch]);

  // Auto-run heavy diagnostics (runDoctor) after lightweight data is loaded.
  const autoRunTriggeredRef = useRef(false);
  useEffect(() => {
    if (activeTab !== 'diagnose') {
      setIsAutoDoctorPending(false);
      return;
    }
    if (autoRunTriggeredRef.current) return;
    const hasRun = typeof window !== 'undefined' && window.localStorage.getItem(DOCTOR_HAS_RUN_KEY) === '1';
    if (!hasRun && !result && !loading && !isCachedResult) {
      autoRunTriggeredRef.current = true;
      let cancelled = false;
      const runAutoDoctor = async () => {
        setIsAutoDoctorPending(true);
        setLoading(true);
        try {
          await runDoctor(true);
          if (typeof window !== 'undefined') window.localStorage.setItem(DOCTOR_HAS_RUN_KEY, '1');
        } catch { /* non-blocking */ }
        if (!cancelled) {
          setLoading(false);
          setIsAutoDoctorPending(false);
        }
      };
      void runAutoDoctor();
      return () => {
        cancelled = true;
        setIsAutoDoctorPending(false);
      };
    }
  }, [activeTab, result, loading, isCachedResult, runDoctor]);

  // Full diagnostics stay manual.

  const handleFix = useCallback(async () => {
    const shouldProceed = await confirm({
      title: text.fixConfirmTitle || '确认执行修复',
      message: text.fixConfirmMessage || '将尝试自动修复可修复项，是否继续？',
      confirmText: text.fixConfirmOk || text.ok || '确认',
      cancelText: text.fixConfirmCancel || text.cancel || '取消',
      danger: true,
    });
    if (!shouldProceed) return;

    setFixing(true);
    try {
      const data = await doctorApi.fix() as { fixed?: string[] };
      const fixed = Array.isArray(data?.fixed) ? data.fixed : [];
      setFixResult(fixed);
      toast('success', text.fixedOk);
      await fetchAll(true);
      await loadSummary(true);
    } catch (err: any) {
      toast('error', `${text.fixedFail}: ${err?.message || ''}`);
    } finally {
      setFixing(false);
    }
  }, [confirm, fetchAll, loadSummary, text.cancel, text.fixConfirmCancel, text.fixConfirmMessage, text.fixConfirmOk, text.fixConfirmTitle, text.fixedFail, text.fixedOk, text.ok, toast]);


  const jumpToWindow = useCallback((id: string, opts?: { section?: string }) => {
    window.dispatchEvent(new CustomEvent('clawdeck:open-window', { detail: { id, ...opts } }));
  }, []);

  const isSecurityItem = useCallback((item: CheckItem) => (item.category || 'other') === 'security' || String(item.id || item.code || '').startsWith('security.'), []);

  const detectSecurityAction = useCallback((item: CheckItem): 'settings' | 'exec' | 'manual' => {
    const id = String(item.id || item.code || '');
    const remediation = String(item.remediation || item.suggestion || '').toLowerCase();
    if (/set|enable|disable|configure|设置|启用|关闭|配置/.test(remediation) && !/chmod|permission|权限/.test(remediation)) {
      return 'settings';
    }
    if (/^security\.gateway\./.test(id)) return 'settings';
    if (/^security\.(fs\.|gateway\.)/.test(id) || item.fixable) return 'exec';
    return 'manual';
  }, []);

  const confirmFixAction = useCallback(async (item: CheckItem, mode: 'batch' | 'single'): Promise<boolean> => {
    const securityAction = isSecurityItem(item) ? detectSecurityAction(item) : 'exec';
    const title = mode === 'batch'
      ? (text.fixConfirmTitle || '确认执行修复')
      : (securityAction === 'settings'
          ? (text.securityAuditConfirmSettingsTitle || '确认跳转设置')
          : securityAction === 'manual'
            ? (text.securityAuditConfirmManualTitle || '确认查看修复指令')
            : (text.fixConfirmTitle || '确认执行修复'));
    const baseMessage = mode === 'batch'
      ? (text.fixConfirmMessage || '将尝试自动修复可修复项，是否继续？')
      : (securityAction === 'settings'
          ? (text.securityAuditConfirmSettingsMessage || '该项需要在设置中调整，确认后将跳转到设置界面。')
          : securityAction === 'manual'
            ? (text.securityAuditConfirmManualMessage || '当前环境无法自动修复，该项将显示手动修复指令。')
            : (text.fixConfirmOneMessage || '将执行该项修复操作，是否继续？'));
    const remediation = item.remediation || item.suggestion || '';
    const message = remediation && mode === 'single' ? `${baseMessage}\n\n${remediation}` : baseMessage;
    return await confirm({
      title,
      message,
      confirmText: text.fixConfirmOk || text.ok || '确认',
      cancelText: text.fixConfirmCancel || text.cancel || '取消',
      danger: securityAction !== 'settings',
    });
  }, [confirm, detectSecurityAction, isSecurityItem, text]);

  const handleSecurityAuditAction = useCallback(async (item: CheckItem) => {
    const action = detectSecurityAction(item);
    if (action === 'settings') {
      jumpToWindow('editor', { section: 'gateway' });
      return;
    }
    if (action === 'manual') {
      toast('info', item.remediation || item.suggestion || text.noFix);
      return;
    }

    const shouldProceed = await confirmFixAction(item, 'single');
    if (!shouldProceed) return;

    const key = item.id || item.code || item.name;
    setFixingOne(key);
    try {
      const data = await doctorApi.fix([item.id || item.code]) as { results?: Array<{ status: string; message: string }> };
      const r = data?.results?.[0];
      if (r?.status === 'success') {
        toast('success', text.fixedOk);
      } else if (r?.status === 'skipped') {
        toast('info', r?.message || text.noFix);
      } else {
        toast('error', r?.message || text.fixedFail);
      }
      await fetchAll(true);
      await loadSummary(true);
    } catch (err: any) {
      toast('error', `${text.fixedFail}: ${err?.message || ''}`);
    } finally {
      setFixingOne('');
    }
  }, [confirmFixAction, detectSecurityAction, fetchAll, jumpToWindow, loadSummary, text.fixedFail, text.fixedOk, text.noFix, toast]);

  const handleFixOne = useCallback(async (item: CheckItem) => {
    const shouldProceed = await confirmFixAction(item, 'single');
    if (!shouldProceed) return;

    const action = isSecurityItem(item) ? detectSecurityAction(item) : 'exec';
    if (action === 'settings') {
      jumpToWindow('editor', { section: 'gateway' });
      return;
    }
    if (action === 'manual') {
      toast('info', item.remediation || item.suggestion || text.noFix);
      return;
    }

    const key = item.id || item.code || item.name;
    setFixingOne(key);
    try {
      const data = await doctorApi.fix([item.id || item.code]) as { results?: Array<{ status: string; message: string }> };
      const r = data?.results?.[0];
      if (r?.status === 'success') {
        toast('success', text.fixedOk);
      } else if (r?.status === 'skipped') {
        toast('info', r?.message || text.noFix);
      } else {
        toast('error', r?.message || text.fixedFail);
      }
      await fetchAll(true);
      await loadSummary(true);
    } catch (err: any) {
      toast('error', `${text.fixedFail}: ${err?.message || ''}`);
    } finally {
      setFixingOne('');
    }
  }, [confirmFixAction, detectSecurityAction, fetchAll, isSecurityItem, jumpToWindow, loadSummary, text.fixedFail, text.fixedOk, text.noFix, toast]);

  const fixableCount = useMemo(() => {
    return (result?.items || []).filter((i) => i.fixable && (i.category || 'other') !== 'security').length;
  }, [result?.items]);

  const filteredItems = useMemo(() => {
    const all = result?.items || [];
    const severityOrder: Record<string, number> = { error: 0, warn: 1, ok: 2 };
    return all.filter((i) => {
      // Exclude security audit items — they are shown in the dedicated Security Audit section
      if ((i.category || 'other') === 'security') return false;
      if (severityFilter !== 'all' && i.status !== severityFilter) return false;
      if (categoryFilter !== 'all' && (i.category || 'other') !== categoryFilter) return false;
      if (onlyFixable && !i.fixable) return false;
      return true;
    }).sort((a, b) => (severityOrder[a.status] ?? 9) - (severityOrder[b.status] ?? 9));
  }, [categoryFilter, onlyFixable, result?.items, severityFilter]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    (result?.items || []).forEach((i) => {
      const cat = i.category || 'other';
      if (cat !== 'security') set.add(cat);
    });
    return ['all', ...Array.from(set)];
  }, [result?.items]);

  // Compute chat/session errors from bucket data (matches issue timeline)
  // NOTE: uses raw `summary` (not displaySummary) to avoid a circular dependency.
  const chatSessionErrors = useMemo(() => {
    const buckets = pruneSummaryBuckets();
    const chatHour = countBucketEntries(buckets.hour, 'chat');
    const chatDay = countBucketEntries(buckets.day, 'chat');
    const chatIssues = (summary?.recentIssues || []).filter(
      (issue) => detectSummarySourceKey(issue.source, issue.category) === 'chat'
    );
    const totalErrors = Math.max(chatHour, chatDay, chatIssues.length);
    const sessionSet = new Set<string>();
    chatIssues.forEach((issue) => {
      const detail = issue.detail || issue.title || '';
      const sessionMatch = detail.match(/session:\s*([^\s·]+)/i);
      if (sessionMatch) sessionSet.add(sessionMatch[1]);
      else sessionSet.add(issue.id);
    });
    return { totalErrors, errorSessions: sessionSet.size };
  }, [countBucketEntries, pruneSummaryBuckets, summary?.recentIssues]);

  const displaySummary = useMemo(() => summary ? deriveSummary(summary, chatSessionErrors) : null, [chatSessionErrors, language, summary]);

  const issueSourceMeta = useCallback((source?: string, category?: string) => {
    const key = detectSummarySourceKey(source, category);
    if (key === 'security') return { key, icon: 'shield', chip: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300', dot: 'bg-indigo-500', label: text.sourceSecurity || 'Security' };
    if (key === 'alert') return { key, icon: 'notifications_active', chip: 'bg-red-500/10 text-red-600 dark:text-red-300', dot: 'bg-red-500', label: text.sourceAlert || source || 'alert' };
    if (key === 'gateway') return { key, icon: 'router', chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-500', label: text.sourceGateway || source || 'gateway' };
    if (key === 'cron') return { key, icon: 'schedule', chip: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-300', dot: 'bg-cyan-500', label: text.sourceCron || source || 'cron' };
    if (key === 'chat') return { key, icon: 'chat', chip: 'bg-blue-500/10 text-blue-600 dark:text-blue-300', dot: 'bg-blue-500', label: text.sourceChat || source || 'chat' };
    if (key === 'tool') return { key, icon: 'build', chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-300', dot: 'bg-violet-500', label: text.sourceTool || source || 'tool' };
    if (key === 'doctor') return { key, icon: 'health_and_safety', chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-300', dot: 'bg-amber-500', label: text.sourceDoctor || source || 'doctor' };
    return { key, icon: 'info', chip: 'bg-slate-500/10 text-slate-600 dark:text-white/60', dot: 'bg-slate-400', label: text.sourceSystem || source || 'system' };
  }, [text.sourceAlert, text.sourceGateway, text.sourceCron, text.sourceChat, text.sourceTool, text.sourceDoctor, text.sourceSystem, text.sourceSecurity]);

  const summaryIssueAction = useCallback((source?: string, category?: string) => {
    const key = detectSummarySourceKey(source, category);
    if (key === 'security') return { target: 'doctor', label: text.securityAuditViewAll || 'View Security Audit' };
    if (key === 'alert') return { target: 'alerts', label: text.actionReviewAlerts || 'Open Alerts' };
    if (key === 'gateway') return { target: 'gateway', label: text.actionViewDetails || text.actionOpenEvents || 'View Details' };
    if (key === 'cron') return { target: 'scheduler', label: text.tabContext || 'Open Scheduler' };
    if (key === 'chat') return { target: 'sessions', label: text.actionOpenEvents || 'Open Sessions' };
    return { target: 'activity', label: text.actionOpenEvents || 'Open Events' };
  }, [text.actionOpenEvents, text.actionReviewAlerts, text.actionViewDetails, text.tabContext, text.securityAuditViewAll]);

  const summarySourceOptions = useMemo(() => {
    const seen = new Set<SummarySourceKey>(['all']);
    const options: Array<{ key: SummarySourceKey; label: string; icon: string; chip: string }> = [
      { key: 'all', label: text.all || 'All', icon: 'filter_alt', chip: 'bg-slate-500/10 text-slate-600 dark:text-white/60' },
    ];
    (displaySummary?.recentIssues || []).forEach((issue) => {
      const meta = issueSourceMeta(issue.source, issue.category);
      if (seen.has(meta.key)) return;
      seen.add(meta.key);
      options.push({ key: meta.key, label: meta.label, icon: meta.icon, chip: meta.chip });
    });
    return options;
  }, [displaySummary?.recentIssues, issueSourceMeta, text.all]);

  const sourceScopedSummaryIssues = useMemo(() => {
    const issues = displaySummary?.recentIssues || [];
    if (summarySourceFilter === 'all') return issues;
    return issues.filter((issue) => issueSourceMeta(issue.source, issue.category).key === summarySourceFilter);
  }, [displaySummary?.recentIssues, issueSourceMeta, summarySourceFilter]);

  const summaryRiskCounts = useMemo(() => {
    const issues = sourceScopedSummaryIssues;
    return {
      all: issues.length,
      critical: issues.filter((issue) => issue.risk === 'critical').length,
      high: issues.filter((issue) => issue.risk === 'high').length,
      medium: issues.filter((issue) => issue.risk === 'medium').length,
    };
  }, [sourceScopedSummaryIssues]);

  const filteredSummaryIssues = useMemo(() => {
    if (summaryRiskFilter === 'all') return sourceScopedSummaryIssues;
    return sourceScopedSummaryIssues.filter((issue) => issue.risk === summaryRiskFilter);
  }, [sourceScopedSummaryIssues, summaryRiskFilter]);

  const groupedSummaryIssues = useMemo(() => {
    const grouped = new Map<string, { key: string; issue: DoctorSummary['recentIssues'][number]; count: number; recentTimestamps: string[] }>();
    filteredSummaryIssues.forEach((issue) => {
      const key = [
        issueSourceMeta(issue.source, issue.category).key,
        issue.category || '',
        issue.risk || '',
        String(issue.title || '').trim().toLowerCase(),
      ].join('|');
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { key, issue, count: 1, recentTimestamps: [issue.timestamp] });
        return;
      }
      existing.count += 1;
      if (issue.timestamp) {
        existing.recentTimestamps = [issue.timestamp, ...existing.recentTimestamps]
          .filter((value, index, arr) => !!value && arr.indexOf(value) === index)
          .sort((a, b) => new Date(b || 0).getTime() - new Date(a || 0).getTime())
          .slice(0, 4);
      }
      const currentTs = new Date(existing.issue.timestamp || 0).getTime();
      const nextTs = new Date(issue.timestamp || 0).getTime();
      if (Number.isFinite(nextTs) && (!Number.isFinite(currentTs) || nextTs > currentTs)) {
        existing.issue = issue;
      }
    });
    return Array.from(grouped.values())
      .sort((a, b) => new Date(b.issue.timestamp || 0).getTime() - new Date(a.issue.timestamp || 0).getTime())
      .slice(0, 16);
  }, [filteredSummaryIssues, issueSourceMeta]);

  useEffect(() => {
    setExpandedSummaryGroups((prev) => prev.filter((key) => groupedSummaryIssues.some((item) => item.key === key)));
  }, [groupedSummaryIssues]);

  const scopedSummaryStats = useMemo(() => {
    if (!displaySummary) return null;
    if (summarySourceFilter === 'all') return displaySummary.exceptionStats;
    const buckets = pruneSummaryBuckets();
    return {
      medium5m: countBucketEntries(buckets.medium, summarySourceFilter),
      high5m: countBucketEntries(buckets.high, summarySourceFilter),
      critical5m: countBucketEntries(buckets.critical, summarySourceFilter),
      total1h: countBucketEntries(buckets.hour, summarySourceFilter),
      total24h: countBucketEntries(buckets.day, summarySourceFilter),
    };
  }, [countBucketEntries, displaySummary, pruneSummaryBuckets, summarySourceFilter]);

  useEffect(() => {
    if (summarySourceFilter === 'all') return;
    if (!summarySourceOptions.some((opt) => opt.key === summarySourceFilter)) {
      setSummarySourceFilter('all');
    }
  }, [summarySourceFilter, summarySourceOptions]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SUMMARY_SOURCE_STORAGE_KEY, summarySourceFilter);
  }, [summarySourceFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SUMMARY_RISK_STORAGE_KEY, summaryRiskFilter);
  }, [summaryRiskFilter]);

  const summaryView = useMemo(() => {
    if (!displaySummary) return null;
    if (summarySourceFilter === 'all' || !scopedSummaryStats) return displaySummary;
    return deriveSummary({
      ...displaySummary,
      exceptionStats: scopedSummaryStats,
    }, chatSessionErrors);
  }, [chatSessionErrors, displaySummary, language, scopedSummaryStats, summarySourceFilter]);

  const securityFixableItems = useMemo(() => {
    return (summaryView?.securityAudit?.items || []).filter((item) => detectSecurityAction(item as any) === 'exec');
  }, [summaryView?.securityAudit?.items, detectSecurityAction]);

  const [fixingSecurityBatch, setFixingSecurityBatch] = useState(false);
  const handleSecurityBatchFix = useCallback(async () => {
    if (securityFixableItems.length === 0) return;
    const shouldProceed = await confirm({
      title: text.securityAuditBatchFixTitle || '批量修复安全问题',
      message: (text.securityAuditBatchFixMessage || '将自动修复 {count} 项可修复的安全问题，是否继续？').replace('{count}', String(securityFixableItems.length)),
      confirmText: text.fixConfirmOk || text.ok || '确认',
      cancelText: text.fixConfirmCancel || text.cancel || '取消',
      danger: true,
    });
    if (!shouldProceed) return;
    setFixingSecurityBatch(true);
    try {
      const ids = securityFixableItems.map(i => i.id || (i as any).code);
      const data = await doctorApi.fix(ids) as { results?: Array<{ status: string; message: string }> };
      const results = data?.results || [];
      const successCount = results.filter(r => r.status === 'success').length;
      if (successCount > 0) {
        toast('success', (text.securityAuditBatchFixOk || '{count} 项已修复').replace('{count}', String(successCount)));
      } else {
        toast('info', text.noFix || 'No fixable items');
      }
      await fetchAll(true);
      await loadSummary(true);
    } catch (err: any) {
      toast('error', `${text.fixedFail}: ${err?.message || ''}`);
    } finally {
      setFixingSecurityBatch(false);
    }
  }, [confirm, securityFixableItems, fetchAll, loadSummary, text, toast]);

  // chatSessionErrors is now computed above displaySummary to avoid circular dependency

  const currentStatus = summaryView?.status || overview?.status || 'warn';
  const currentScore = summaryView?.score ?? overview?.score ?? result?.score ?? 0;
  const numericScore = typeof currentScore === 'number' ? currentScore : 0;

  const summaryTone = currentStatus === 'error'
    ? 'border-red-200/70 dark:border-red-500/20 bg-gradient-to-br from-red-50 via-white to-white dark:from-red-500/10 dark:via-white/[0.04] dark:to-white/[0.02]'
    : currentStatus === 'warn'
      ? 'border-amber-200/70 dark:border-amber-500/20 bg-gradient-to-br from-amber-50 via-white to-white dark:from-amber-500/10 dark:via-white/[0.04] dark:to-white/[0.02]'
      : 'border-emerald-200/70 dark:border-emerald-500/20 bg-gradient-to-br from-emerald-50 via-white to-white dark:from-emerald-500/10 dark:via-white/[0.04] dark:to-white/[0.02]';
  const summaryAccent = currentStatus === 'error'
    ? 'text-red-600 dark:text-red-300'
    : currentStatus === 'warn'
      ? 'text-amber-600 dark:text-amber-300'
      : 'text-emerald-600 dark:text-emerald-300';

  const statusLabel = currentStatus === 'ok' ? text.statusHealthy : currentStatus === 'warn' ? text.statusWarning : text.statusCritical;

  const riskText = useCallback((risk: string) => {
    if (risk === 'critical') return text.riskCritical;
    if (risk === 'high') return text.riskHigh;
    if (risk === 'medium') return text.riskMedium;
    return text.riskLow;
  }, [text.riskCritical, text.riskHigh, text.riskLow, text.riskMedium]);

  const priorityText = useCallback((p: 'high' | 'medium' | 'low') => {
    if (p === 'high') return text.priorityHigh;
    if (p === 'medium') return text.priorityMedium;
    return text.priorityLow;
  }, [text.priorityHigh, text.priorityLow, text.priorityMedium]);

  const actionText = useCallback((id: string, fallback: string) => {
    if (id === 'start-gateway') return text.actionViewDetails || text.actionStartGateway;
    if (id === 'run-fix') return text.actionRunFix;
    if (id === 'review-alerts') return text.actionReviewAlerts;
    if (id === 'open-events') return text.actionOpenEvents;
    return fallback;
  }, [text.actionOpenEvents, text.actionReviewAlerts, text.actionRunFix, text.actionStartGateway]);

  const cardLabel = useCallback((id: string, fallback: string) => {
    if (id === 'availability') return text.cardAvailability;
    if (id === 'events24h') return text.cardEvents24h;
    if (id === 'errors1h') return text.cardErrors1h;
    if (id === 'resource') return text.cardResource;
    return fallback;
  }, [text.cardAvailability, text.cardErrors1h, text.cardEvents24h, text.cardResource]);

  // --- Trend data filtered by time range ---
  const trend = useMemo(() => filterTrendByRange(overview?.trend24h || [], timeRange), [overview?.trend24h, timeRange]);
  const scoreDrops = useMemo(() => detectScoreDrops(trend), [trend]);

  const trendLinePoints = useMemo(() => {
    if (trend.length === 0) return '';
    return trend.map((p, i) => `${(i / Math.max(trend.length - 1, 1)) * 100},${100 - p.healthScore}`).join(' ');
  }, [trend]);

  const trendAreaPoints = useMemo(() => {
    if (trend.length === 0) return '';
    const line = trend.map((p, i) => `${(i / Math.max(trend.length - 1, 1)) * 100},${100 - p.healthScore}`).join(' ');
    return `${line} 100,100 0,100`;
  }, [trend]);

  // --- Deduction items ---
  const deductions = useMemo((): DeductionItem[] => {
    if (!summaryView) return [];
    const stats = summaryView.exceptionStats || { medium5m: 0, high5m: 0, critical5m: 0, total1h: 0, total24h: 0 };
    const gw = summaryView.gateway;
    const hc = summaryView.healthCheck;
    const items: DeductionItem[] = [];
    if (!gw?.running) items.push({ key: 'gateway', label: text.deductionGateway || 'Gateway Offline', points: 35, maxPoints: 35, color: '#ef4444' });
    const critPts = Math.min(50, (stats.critical5m || 0) * 25);
    if (critPts > 0) items.push({ key: 'critical', label: text.deductionCritical || 'Critical', points: critPts, maxPoints: 50, color: '#ef4444' });
    const highPts = Math.min(30, (stats.high5m || 0) * 10);
    if (highPts > 0) items.push({ key: 'high', label: text.deductionHigh || 'High', points: highPts, maxPoints: 30, color: '#f97316' });
    const medPts = Math.min(10, (stats.medium5m || 0) * 2);
    if (medPts > 0) items.push({ key: 'medium', label: text.deductionMedium || 'Medium', points: medPts, maxPoints: 10, color: '#f59e0b' });
    if (hc?.enabled && (hc.failCount || 0) > 0) {
      const hcPts = Math.min(25, (hc.failCount || 0) * 10);
      items.push({ key: 'healthcheck', label: text.deductionHealthCheck || 'Health Check', points: hcPts, maxPoints: 25, color: '#8b5cf6' });
    }
    if (chatSessionErrors.totalErrors > 0) {
      const sessPts = Math.min(10, chatSessionErrors.errorSessions * 3);
      items.push({ key: 'session', label: text.deductionSessionErrors || 'Session Errors', points: sessPts, maxPoints: 10, color: '#ec4899' });
    }
    const secAudit = summaryView.securityAudit;
    if (secAudit && secAudit.critical > 0) {
      const secPts = Math.min(40, secAudit.critical * 15);
      items.push({ key: 'security', label: text.deductionSecurity || 'Security Audit', points: secPts, maxPoints: 40, color: '#6366f1' });
    }
    return items.sort((a, b) => b.points - a.points);
  }, [summaryView, chatSessionErrors, text.deductionGateway, text.deductionCritical, text.deductionHigh, text.deductionMedium, text.deductionHealthCheck, text.deductionSessionErrors, text.deductionSecurity]);

  const totalDeduction = deductions.reduce((s, d) => s + d.points, 0);

  // --- Source distribution (donut chart data) ---
  const sourceDistribution = useMemo(() => {
    const issues = displaySummary?.recentIssues || [];
    const counts = new Map<SummarySourceKey, number>();
    issues.forEach(issue => {
      const key = detectSummarySourceKey(issue.source, issue.category);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const sourceColors: Record<string, string> = {
      security: '#6366f1', alert: '#ef4444', gateway: '#10b981', cron: '#06b6d4', chat: '#3b82f6', tool: '#8b5cf6', doctor: '#f59e0b', system: '#64748b',
    };
    const sourceLabels: Record<string, string> = {
      security: text.sourceSecurity || 'Security', alert: text.sourceAlert || 'Alerts', gateway: text.sourceGateway || 'Gateway', cron: text.sourceCron || 'Cron',
      chat: text.sourceChat || 'Chat', tool: text.sourceTool || 'Tools', doctor: text.sourceDoctor || 'Doctor', system: text.sourceSystem || 'System',
    };
    return Array.from(counts.entries())
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count, color: sourceColors[key] || '#64748b', label: sourceLabels[key] || key }));
  }, [displaySummary?.recentIssues, text.sourceAlert, text.sourceGateway, text.sourceCron, text.sourceChat, text.sourceTool, text.sourceDoctor, text.sourceSystem, text.sourceSecurity]);
  const sourceTotalCount = sourceDistribution.reduce((s, d) => s + d.count, 0);

  // --- Heatmap data: 24 cols (hours) × source rows ---
  const heatmapData = useMemo(() => {
    const issues = displaySummary?.recentIssues || [];
    const trendPoints = overview?.trend24h || [];
    const sources = Array.from(new Set(issues.map(i => detectSummarySourceKey(i.source, i.category))));
    if (sources.length === 0 && trendPoints.length === 0) return { sources: [] as string[], grid: [] as number[][], maxVal: 0 };
    const hourBuckets = 24;
    const grid: number[][] = sources.map(() => new Array(hourBuckets).fill(0));
    trendPoints.forEach(p => {
      const hour = new Date(p.timestamp).getHours();
      const total = p.medium + p.high + p.critical;
      if (total > 0 && sources.length > 0) {
        grid[0][hour] += total;
      }
    });
    issues.forEach(issue => {
      const srcIdx = sources.indexOf(detectSummarySourceKey(issue.source, issue.category));
      if (srcIdx >= 0) {
        const hour = new Date(issue.timestamp).getHours();
        grid[srcIdx][hour] += 1;
      }
    });
    const maxVal = Math.max(1, ...grid.flat());
    return { sources, grid, maxVal };
  }, [displaySummary?.recentIssues, overview?.trend24h]);

  // --- Localization for check items ---
  const fallbackCheckCatalog = useMemo<Record<string, CheckLocaleEntry>>(() => {
    if (language === 'zh') {
      return {
        openclaw_install: { name: 'OpenClaw 安装' }, config_file: { name: '配置文件' }, gateway_status: { name: '网关状态' },
        pid_lock: { name: 'PID 锁文件' }, port_default: { name: '端口检查' }, disk_space: { name: '磁盘空间' },
        gateway_diag_openclaw_installed: { name: 'OpenClaw 已安装' }, gateway_diag_config_exists: { name: '配置文件存在' },
        gateway_diag_config_valid: { name: '配置文件格式正确' }, gateway_diag_gateway_process: { name: 'Gateway 进程' },
        gateway_diag_port_reachable: { name: '端口可达性' }, gateway_diag_gateway_api: { name: 'Gateway API 响应' },
        gateway_diag_port_conflict: { name: '端口冲突检查' }, gateway_diag_auth_token: { name: '鉴权 Token 匹配' },
      };
    }
    return {
      openclaw_install: { name: 'OpenClaw Install' }, config_file: { name: 'Config File' }, gateway_status: { name: 'Gateway Status' },
      pid_lock: { name: 'PID Lock' }, port_default: { name: 'Port Check' }, disk_space: { name: 'Disk Space' },
      gateway_diag_openclaw_installed: { name: 'OpenClaw Installed' }, gateway_diag_config_exists: { name: 'Config File Exists' },
      gateway_diag_config_valid: { name: 'Config File Valid' }, gateway_diag_gateway_process: { name: 'Gateway Process' },
      gateway_diag_port_reachable: { name: 'Port Reachable' }, gateway_diag_gateway_api: { name: 'Gateway API Response' },
      gateway_diag_port_conflict: { name: 'Port Conflict Check' }, gateway_diag_auth_token: { name: 'Auth Token Match' },
    };
  }, [language]);

  const checkDetailTpl = useMemo(() => {
    if (language === 'zh') {
      return {
        openclawInstalled: '已安装: {path}', openclawNotFound: '未找到 openclaw 命令',
        configExistsSize: '配置存在，大小: {size}', configExists: '配置存在', configMissing: '未找到配置文件',
        gatewayNotRunning: '网关未运行', noStalePid: '没有陈旧 PID 文件', stalePid: '发现陈旧 PID 文件，网关未运行',
        portDefault: '默认端口 {port}', diskOk: '正常',
      };
    }
    return {
      openclawInstalled: 'installed: {path}', openclawNotFound: 'openclaw command not found',
      configExistsSize: 'exists, size: {size}', configExists: 'exists', configMissing: 'config file not found',
      gatewayNotRunning: 'gateway not running', noStalePid: 'no stale files', stalePid: 'stale PID file found but gateway not running',
      portDefault: 'default port {port}', diskOk: 'ok',
    };
  }, [language]);

  const formatTpl = useCallback((tpl: string, vars: Record<string, string>) => {
    return tpl.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  }, []);

  const localizeCheckItem = useCallback((item: CheckItem): LocalizedCheckItem => {
    const rawId = item.id || item.code || '';
    // Security audit items: use saTranslate (same as health center)
    if (rawId.startsWith('security.')) {
      return {
        ...item,
        displayName: saTranslate(text as any, rawId, 'sa', item.name),
        displayDetail: item.detail || '',
        displaySuggestion: saTranslate(text as any, rawId, 'saRem', item.remediation || item.suggestion || ''),
      };
    }
    const code = rawId.replace(/\./g, '_');
    const catalog = (text.checkCatalog || {}) as Record<string, CheckLocaleEntry>;
    const merged = { ...(fallbackCheckCatalog[code] || {}), ...(catalog[code] || {}) };
    let detail = item.detail || '';
    if (code === 'openclaw_install') {
      if (/^installed:\s*/i.test(detail)) detail = formatTpl(checkDetailTpl.openclawInstalled, { path: detail.replace(/^installed:\s*/i, '').trim() });
      else if (/openclaw command not found/i.test(detail)) detail = checkDetailTpl.openclawNotFound;
    } else if (code === 'config_file') {
      const sizeMatch = detail.match(/^exists,\s*size:\s*(.+)$/i);
      if (sizeMatch) detail = formatTpl(checkDetailTpl.configExistsSize, { size: sizeMatch[1].trim() });
      else if (/^exists$/i.test(detail)) detail = checkDetailTpl.configExists;
      else if (/config file not found/i.test(detail)) detail = checkDetailTpl.configMissing;
    } else if (code === 'gateway_status') {
      if (/gateway not running/i.test(detail)) detail = checkDetailTpl.gatewayNotRunning;
    } else if (code === 'pid_lock') {
      if (/^no stale files$/i.test(detail)) detail = checkDetailTpl.noStalePid;
      else if (/stale PID file found but gateway not running/i.test(detail)) detail = checkDetailTpl.stalePid;
    } else if (code === 'port_default') {
      const m = detail.match(/default port\s+(\d+)/i);
      if (m) detail = formatTpl(checkDetailTpl.portDefault, { port: m[1] });
    } else if (code === 'disk_space') {
      if (/^ok$/i.test(detail)) detail = checkDetailTpl.diskOk;
    }
    return { ...item, displayName: merged.name || item.name, displayDetail: merged.detail || detail, displaySuggestion: merged.suggestion || item.suggestion };
  }, [checkDetailTpl, fallbackCheckCatalog, formatTpl, text]);

  const localizedItems = useMemo(() => filteredItems.map(localizeCheckItem), [filteredItems, localizeCheckItem]);

  const tabs: { id: TabId; icon: string; label: string }[] = [
    { id: 'diagnose', icon: 'troubleshoot', label: maint.tabDiagnose || text.title || 'Diagnostics' },
    { id: 'testing', icon: 'science', label: text.tabTesting || 'Test Center' },
  ];

  // --- Gauge SVG helpers ---
  const gaugeRadius = 52;
  const gaugeCircumference = Math.PI * gaugeRadius; // semi-circle
  const gaugeOffset = gaugeCircumference - (numericScore / 100) * gaugeCircumference;
  const gColor = gaugeColor(numericScore);

  // --- Stacked area helpers ---
  const stackedAreaPaths = useMemo(() => {
    if (trend.length === 0) return { critical: '', high: '', medium: '' };
    const maxEvents = Math.max(1, ...trend.map(p => p.critical + p.high + p.medium));
    const xStep = (i: number) => (i / Math.max(trend.length - 1, 1)) * 100;
    const yScale = (v: number) => 100 - (v / maxEvents) * 90 - 5;
    const makePath = (getValue: (p: OverviewPoint, acc: number) => number, baseline: (p: OverviewPoint) => number) => {
      const top = trend.map((p, i) => `${xStep(i)},${yScale(getValue(p, baseline(p)))}`).join(' ');
      const bot = [...trend].reverse().map((p, i) => `${xStep(trend.length - 1 - i)},${yScale(baseline(p))}`).join(' ');
      return `${top} ${bot}`;
    };
    const critPath = makePath((p, acc) => acc + p.critical, () => 0);
    const highPath = makePath((p, acc) => acc + p.high, (p) => p.critical);
    const medPath = makePath((p, acc) => acc + p.medium, (p) => p.critical + p.high);
    return { critical: critPath, high: highPath, medium: medPath };
  }, [trend]);

  // --- Donut chart SVG path helpers ---
  const donutPaths = useMemo(() => {
    if (sourceTotalCount === 0 || sourceDistribution.length === 0) return [];
    const r = 40;
    const cx = 50, cy = 50;
    let startAngle = -90;
    return sourceDistribution.map(item => {
      const angle = (item.count / sourceTotalCount) * 360;
      const endAngle = startAngle + angle;
      const largeArc = angle > 180 ? 1 : 0;
      const rad1 = (startAngle * Math.PI) / 180;
      const rad2 = (endAngle * Math.PI) / 180;
      const x1 = cx + r * Math.cos(rad1);
      const y1 = cy + r * Math.sin(rad1);
      const x2 = cx + r * Math.cos(rad2);
      const y2 = cy + r * Math.sin(rad2);
      const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
      startAngle = endAngle;
      return { ...item, d };
    });
  }, [sourceDistribution, sourceTotalCount]);

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-transparent">
      {/* #10 Top Status Color Bar */}
      <div className={`h-[3px] w-full ${statusBarColor(currentStatus)} transition-all duration-700`} />

      {/* #14 WS Disconnect Banner */}
      {!wsConnected && (
        <div className="px-3 py-1.5 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/20 flex items-center gap-2">
          <span className="material-symbols-outlined text-[14px] text-amber-500">wifi_off</span>
          <span className="text-[11px] text-amber-700 dark:text-amber-300">{text.wsDisconnected}</span>
        </div>
      )}

      {/* Header */}
      <div className="p-3 md:p-4 border-b border-slate-200 dark:border-white/5 bg-white/70 dark:bg-white/[0.02] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm md:text-base font-bold text-slate-800 dark:text-white">{maint.title || text.title}</h2>
            <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5">{maint.subtitle || text.subtitle}</p>
          </div>
          {activeTab === 'diagnose' && (
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-[10px] font-bold ${statusClass(currentStatus)}`}>{statusLabel}</span>
              {summaryLoading && <span className="text-[10px] text-slate-400 dark:text-white/35 animate-pulse">...</span>}
              <button onClick={() => fetchAll(true)} disabled={loading} className="h-8 px-3 rounded-lg text-[11px] font-bold border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:border-amber-500/50 disabled:opacity-50 flex items-center gap-1.5">
                <span className={`material-symbols-outlined text-[14px] ${loading ? 'animate-spin' : ''}`}>{loading ? 'progress_activity' : 'troubleshoot'}</span>
                {loading ? text.running : text.run}
              </button>
              <button onClick={handleFix} disabled={fixing || fixableCount === 0} className="h-8 px-3 rounded-lg text-[11px] font-bold bg-primary text-white disabled:opacity-40">
                {fixing ? text.fixing : text.fix}
              </button>
            </div>
          )}
        </div>
        {/* Tab Navigation */}
        <div className="flex items-center gap-1 mt-3 overflow-x-auto pb-1">
          {tabs.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap transition-all ${activeTab === tab.id ? 'bg-primary/15 text-primary' : 'bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40 hover:bg-slate-200 dark:hover:bg-white/[0.06]'}`}>
              <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-3 md:p-4">
        {activeTab === 'testing' && <TestCenterPanel language={language} />}

        {activeTab === 'diagnose' && (
          <div className="space-y-3 max-w-6xl mx-auto">
            {(isDiagnoseEntering || isAutoDoctorPending) && (
              <div className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 flex items-center gap-2 text-[11px] text-primary">
                <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                <span className="font-semibold">{isAutoDoctorPending ? (text.autoDetecting || 'Running quick diagnostics...') : (text.preparingDetecting || 'Preparing diagnostic data...')}</span>
                <span className="ms-0.5 inline-block h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              </div>
            )}
            {loadError && (
              <div className="rounded-lg border border-red-300/50 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">{loadError}</div>
            )}

            {/* Auto-run indicator (replaces first-run prompt) */}
            {!result && !isCachedResult && loading && (
              <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-white to-white dark:from-primary/10 dark:via-white/[0.03] dark:to-transparent p-6 flex flex-col items-center text-center gap-3 shadow-sm">
                <span className="material-symbols-outlined text-[36px] text-primary/70 animate-spin">progress_activity</span>
                <p className="text-[14px] font-bold text-slate-700 dark:text-white/85">{text.firstRunTitle}</p>
                <p className="text-[12px] text-slate-500 dark:text-white/50 max-w-sm">{text.firstRunMessage}</p>
              </div>
            )}

            {/* === ROW 1: Gauge + Summary + Time Range === */}
            {summaryView && (
              <div className={`rounded-2xl border p-3 md:p-4 shadow-sm ${summaryTone}`}>
                <div className="flex flex-col sm:flex-row items-start gap-4">
                  {/* #3 Health Score Gauge */}
                  <div className="shrink-0 flex flex-col items-center">
                    <svg viewBox="0 0 120 70" className="w-28 sm:w-32">
                      <path d="M 10 65 A 52 52 0 0 1 110 65" fill="none" stroke="currentColor" strokeWidth="8" className="text-slate-200 dark:text-white/10" strokeLinecap="round" />
                      <path d="M 10 65 A 52 52 0 0 1 110 65" fill="none" stroke={gColor} strokeWidth="8" strokeLinecap="round"
                        strokeDasharray={gaugeCircumference} strokeDashoffset={gaugeOffset} className="transition-all duration-700" />
                      <text x="60" y="52" textAnchor="middle" className="fill-slate-800 dark:fill-white" style={{ fontSize: '22px', fontWeight: 900 }}>{numericScore}</text>
                      <text x="60" y="66" textAnchor="middle" style={{ fontSize: '8px', fill: gColor, fontWeight: 700 }}>{statusLabel}</text>
                    </svg>
                    {prevScore !== null && prevScore !== numericScore && (
                      <p className={`text-[10px] font-bold mt-1 ${numericScore > prevScore ? 'text-emerald-500' : 'text-red-500'}`}>
                        {numericScore > prevScore
                          ? formatText(text.scoreUp || '+{n}', { n: numericScore - prevScore })
                          : formatText(text.scoreDown || '-{n}', { n: prevScore - numericScore })}
                      </p>
                    )}
                  </div>

                  {/* Summary text + time range */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400 dark:text-white/40">{text.healthSnapshot}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${statusClass(summaryView.status)}`}>{statusLabel}</span>
                      {summarySourceFilter !== 'all' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-primary/15 text-primary">
                          {summarySourceOptions.find((opt) => opt.key === summarySourceFilter)?.label || summarySourceFilter}
                        </span>
                      )}
                    </div>
                    <button type="button" onClick={() => setShowExceptionModal(true)} className="text-[14px] md:text-[15px] font-bold text-slate-700 dark:text-white/85 hover:underline decoration-dotted underline-offset-2 text-start">{summaryView.summary}</button>
                    <p className="text-[10px] text-slate-400 dark:text-white/35 mt-1">{text.lastUpdate}: {new Date(summaryView.updatedAt || Date.now()).toLocaleString(dateLocale)}</p>

                    {/* #9 Time Range Selector */}
                    <div className="flex items-center gap-1 mt-2">
                      {(['1h', '6h', '24h'] as TimeRange[]).map(r => (
                        <button key={r} onClick={() => setTimeRange(r)} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${timeRange === r ? 'bg-primary/15 text-primary' : 'bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40 hover:bg-slate-200 dark:hover:bg-white/[0.06]'}`}>
                          {r === '1h' ? text.timeRange1h : r === '6h' ? text.timeRange6h : text.timeRange24h}
                        </button>
                      ))}
                      <span className="text-[10px] text-slate-400 dark:text-white/25 ms-1.5 hidden sm:inline">{text.timeRangeNote}</span>
                    </div>
                  </div>
                </div>

                {/* #11 Snapshot Cards with Trend Arrows */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 mt-3">
                  <button type="button" onClick={() => jumpToWindow('gateway')} className="rounded-xl bg-white/80 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/10 p-3 text-start hover:border-primary/30 transition-colors">
                    <p className="text-[10px] text-slate-400 dark:text-white/35 uppercase tracking-wider">{text.summaryGateway}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <p className={`text-[12px] font-bold ${summaryView.gateway?.running ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{summaryView.gateway?.running ? text.ok : text.error}</p>
                      <span className={`material-symbols-outlined text-[12px] ${summaryView.gateway?.running ? 'text-emerald-500' : 'text-red-500'}`}>{summaryView.gateway?.running ? 'arrow_upward' : 'arrow_downward'}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-white/40 mt-1 break-all leading-relaxed line-clamp-1">{summaryView.gateway?.detail || na}</p>
                  </button>
                  <button type="button" onClick={() => jumpToWindow('gateway')} className="rounded-xl bg-white/80 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/10 p-3 text-start hover:border-primary/30 transition-colors">
                    <p className="text-[10px] text-slate-400 dark:text-white/35 uppercase tracking-wider">{text.summaryHealthCheck}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <p className="text-[12px] font-bold text-slate-700 dark:text-white/75">
                        {summaryView.healthCheck?.enabled ? `${summaryView.healthCheck.failCount || 0}/${summaryView.healthCheck.maxFails || 0}` : (text.summaryOff)}
                      </p>
                      {summaryView.healthCheck?.enabled && <span className="text-[10px] text-slate-400 dark:text-white/30">{text.healthCheckLabel}</span>}
                      {summaryView.healthCheck?.enabled && (summaryView.healthCheck.failCount || 0) > 0 && (
                        <span className="material-symbols-outlined text-[12px] text-red-500">trending_up</span>
                      )}
                    </div>
                    {/* #7 Health Check mini bar */}
                    {summaryView.healthCheck?.enabled && summaryView.healthCheck.maxFails > 0 && (
                      <div className="h-1 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden mt-1.5">
                        <div className="h-full rounded-full transition-all duration-500" style={{
                          width: `${Math.min(100, ((summaryView.healthCheck.failCount || 0) / summaryView.healthCheck.maxFails) * 100)}%`,
                          background: (summaryView.healthCheck.failCount || 0) >= summaryView.healthCheck.maxFails ? '#ef4444' : '#f59e0b',
                        }} />
                      </div>
                    )}
                    <p className="text-[10px] text-slate-500 dark:text-white/40 mt-1">{summaryView.healthCheck?.lastOk ? new Date(summaryView.healthCheck.lastOk).toLocaleTimeString(dateLocale) : na}</p>
                  </button>
                  <div className="rounded-xl bg-white/80 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/10 p-3 text-start">
                    <p className="text-[10px] text-slate-400 dark:text-white/35 uppercase tracking-wider">{text.summaryExceptions5m}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <p className="text-[12px] font-bold text-slate-700 dark:text-white/75">
                        {scopedSummaryStats?.critical5m || 0}/{scopedSummaryStats?.high5m || 0}/{scopedSummaryStats?.medium5m || 0}
                      </p>
                      {((scopedSummaryStats?.critical5m || 0) + (scopedSummaryStats?.high5m || 0)) > 0 && (
                        <span className="material-symbols-outlined text-[12px] text-red-500">arrow_upward</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-white/40 mt-1">{text.summaryRiskMix}</p>
                  </div>
                  <div className="rounded-xl bg-white/80 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/10 p-3 text-start">
                    <p className="text-[10px] text-slate-400 dark:text-white/35 uppercase tracking-wider">{text.summaryRecentVolume}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <p className="text-[12px] font-bold text-slate-700 dark:text-white/75">{scopedSummaryStats?.total1h || 0} / {scopedSummaryStats?.total24h || 0}</p>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-white/40 mt-1">{text.summaryRecentWindow}</p>
                  </div>
                  <button type="button" onClick={() => jumpToWindow('sessions')} className="rounded-xl bg-white/80 dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/10 p-3 text-start hover:border-primary/30 transition-colors">
                    <p className="text-[10px] text-slate-400 dark:text-white/35 uppercase tracking-wider">{text.summarySessionErrors}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <p className={`text-[12px] font-bold ${chatSessionErrors.totalErrors > 0 ? 'text-pink-600 dark:text-pink-400' : 'text-slate-700 dark:text-white/75'}`}>
                        {chatSessionErrors.totalErrors}
                      </p>
                      {chatSessionErrors.totalErrors > 0 && (
                        <span className="material-symbols-outlined text-[12px] text-pink-500">error</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-white/40 mt-1">
                      {formatText(text.summarySessionErrorsDetail || '{errors} errors / {sessions} sessions', { errors: chatSessionErrors.totalErrors, sessions: chatSessionErrors.errorSessions })}
                    </p>
                  </button>
                </div>

                {/* #8 Score Deduction Panel — compact arc chips */}
                {deductions.length > 0 && (
                  <div className="mt-3 rounded-xl bg-white/75 dark:bg-white/[0.02] border border-slate-200/70 dark:border-white/10 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">analytics</span>
                        {text.deductionTitle} <span className="font-bold text-red-500">-{totalDeduction}</span>
                      </p>
                      <p className="text-[10px] text-slate-400 dark:text-white/30">{text.deductionHint}</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {deductions.map(d => {
                        const pct = Math.min(1, d.points / d.maxPoints);
                        const r = 18; const circ = Math.PI * r;
                        return (
                          <div key={d.key} className="flex items-center gap-2 min-w-[100px] sm:min-w-[120px]" title={d.key === 'gateway' ? text.deductionRuleGateway : d.key === 'critical' ? text.deductionRuleCritical : d.key === 'high' ? text.deductionRuleHigh : d.key === 'medium' ? text.deductionRuleMedium : d.key === 'session' ? text.deductionRuleSession : d.key === 'security' ? text.deductionRuleSecurity : text.deductionRuleHealthCheck}>
                            <svg viewBox="0 0 44 26" className="w-10 h-6 shrink-0">
                              <path d="M 4 24 A 18 18 0 0 1 40 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-slate-200 dark:text-white/10" strokeLinecap="round" />
                              <path d="M 4 24 A 18 18 0 0 1 40 24" fill="none" stroke={d.color} strokeWidth="4" strokeLinecap="round"
                                strokeDasharray={circ} strokeDashoffset={circ - pct * circ} className="transition-all duration-500" />
                            </svg>
                            <div className="min-w-0">
                              <p className="text-[10px] text-slate-600 dark:text-white/55 truncate leading-tight">{d.label}</p>
                              <p className="text-[12px] font-black leading-tight" style={{ color: d.color }}>-{d.points}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {deductions.length === 0 && summaryView.score >= 100 && (
                  <div className="mt-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-500/5 border border-emerald-200/50 dark:border-emerald-500/10 p-3 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-emerald-500">check_circle</span>
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-300 font-bold">{text.deductionNone}</span>
                  </div>
                )}
              </div>
            )}

            {/* === ROW 2: Trend Charts (Health Score Area + Stacked Exceptions) === */}
            {!overview && summaryView && (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 animate-pulse">
                <div className="xl:col-span-2 rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-3">
                  <div className="h-3 w-24 bg-slate-200 dark:bg-white/10 rounded mb-3" />
                  <div className="h-28 bg-slate-100 dark:bg-white/[0.03] rounded-lg" />
                  <div className="h-20 bg-slate-100 dark:bg-white/[0.03] rounded-lg mt-2" />
                </div>
                <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-3">
                  <div className="h-3 w-20 bg-slate-200 dark:bg-white/10 rounded mb-3" />
                  <div className="flex justify-center"><div className="w-24 h-24 rounded-full bg-slate-100 dark:bg-white/[0.03]" /></div>
                  <div className="mt-3 space-y-2">
                    <div className="h-3 bg-slate-100 dark:bg-white/[0.03] rounded" />
                    <div className="h-3 bg-slate-100 dark:bg-white/[0.03] rounded w-2/3" />
                  </div>
                </div>
              </div>
            )}
            {overview && (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                <div className="xl:col-span-2 rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">{text.trendTitle}</p>
                      <p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5">{text.trendHint}</p>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-white/35">{text.lastUpdate}: {lastUpdate || na}</p>
                  </div>
                  {trend.length === 0 ? (
                    <p className="text-[11px] text-slate-400 dark:text-white/40 py-6 text-center">{text.empty}</p>
                  ) : (
                    <div className="space-y-2">
                      {/* #1 Health Score Area Chart with threshold lines + drop markers */}
                      <div className="h-28 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200/70 dark:border-white/10 p-2 relative">
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                          <defs>
                            <linearGradient id="hsg" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={gColor} stopOpacity="0.25" />
                              <stop offset="100%" stopColor={gColor} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          {/* Threshold lines */}
                          <line x1="0" y1="40" x2="100" y2="40" stroke="#f59e0b" strokeWidth="0.3" strokeDasharray="2,2" opacity="0.5" />
                          <line x1="0" y1="70" x2="100" y2="70" stroke="#ef4444" strokeWidth="0.3" strokeDasharray="2,2" opacity="0.5" />
                          {/* Area fill */}
                          <polygon points={trendAreaPoints} fill="url(#hsg)" />
                          {/* Line */}
                          <polyline points={trendLinePoints} fill="none" stroke={gColor} strokeWidth="1.5" strokeLinecap="round" />
                          {/* Drop markers */}
                          {scoreDrops.map(idx => {
                            const x = (idx / Math.max(trend.length - 1, 1)) * 100;
                            const y = 100 - trend[idx].healthScore;
                            return <circle key={`drop-${idx}`} cx={x} cy={y} r="2" fill="#ef4444" stroke="white" strokeWidth="0.5" />;
                          })}
                        </svg>
                        <div className="absolute top-1 start-2 text-[10px] text-slate-400 dark:text-white/30">{text.healthScore}</div>
                        <div className="absolute top-[38%] end-1 text-[7px] text-amber-500/60">60</div>
                        <div className="absolute top-[68%] end-1 text-[7px] text-red-500/60">30</div>
                      </div>
                      {/* #2 Stacked Area Chart for exceptions */}
                      <div className="h-20 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200/70 dark:border-white/10 p-2 relative">
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                          {stackedAreaPaths.critical && <polygon points={stackedAreaPaths.critical} fill="#ef4444" opacity="0.6" />}
                          {stackedAreaPaths.high && <polygon points={stackedAreaPaths.high} fill="#f97316" opacity="0.5" />}
                          {stackedAreaPaths.medium && <polygon points={stackedAreaPaths.medium} fill="#f59e0b" opacity="0.4" />}
                        </svg>
                        <div className="absolute top-1 start-2 text-[10px] text-slate-400 dark:text-white/30">{text.eventCount}</div>
                        <div className="absolute bottom-1 end-2 flex items-center gap-2 text-[10px]">
                          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-sm bg-red-500/60" />{text.riskCritical}</span>
                          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-sm bg-orange-500/50" />{text.riskHigh}</span>
                          <span className="flex items-center gap-0.5"><span className="w-1.5 h-1.5 rounded-sm bg-amber-500/40" />{text.riskMedium}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {/* #5 Source Distribution Donut */}
                <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">{text.sourceDistTitle || text.riskTitle}</p>
                  {sourceTotalCount > 0 ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="relative w-24 h-24">
                        <svg viewBox="0 0 100 100" className="w-full h-full">
                          {donutPaths.map((seg, i) => (
                            <path key={`seg-${i}`} d={seg.d} fill="none" stroke={seg.color} strokeWidth="10" strokeLinecap="round"
                              className="cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={() => setSummarySourceFilter(seg.key as SummarySourceKey)} />
                          ))}
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-lg font-black text-slate-700 dark:text-white/80">{sourceTotalCount}</span>
                          <span className="text-[10px] text-slate-400 dark:text-white/35">{text.sourceTotal}</span>
                        </div>
                      </div>
                      <div className="w-full space-y-1">
                        {sourceDistribution.map(s => (
                          <button key={s.key} onClick={() => setSummarySourceFilter(s.key as SummarySourceKey)}
                            className={`w-full flex items-center gap-2 px-2 py-1 rounded-lg text-[10px] transition-all ${summarySourceFilter === s.key ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03] text-slate-600 dark:text-white/55'}`}>
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                            <span className="flex-1 text-start truncate">{s.label}</span>
                            <span className="font-bold">{s.count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 dark:text-white/40 py-4 text-center">{text.noRiskData}</p>
                  )}
                </div>
              </div>
            )}

            {/* === ROW 3: Heatmap === */}
            {heatmapData.sources.length > 0 && (
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">grid_on</span>{text.heatmapTitle}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-white/30">{text.heatmapHint}</p>
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[480px]">
                    <div className="flex items-center mb-1 ps-16 sm:ps-20">
                      {Array.from({ length: 24 }, (_, i) => (
                        <div key={`h-${i}`} className="flex-1 text-center text-[7px] text-slate-400 dark:text-white/25">{i % 4 === 0 ? `${String(i).padStart(2, '0')}` : ''}</div>
                      ))}
                    </div>
                    {heatmapData.sources.map((src, ri) => {
                      const meta = issueSourceMeta(src);
                      return (
                        <div key={`row-${ri}`} className="flex items-center gap-1 mb-0.5">
                          <span className="w-16 sm:w-20 text-[10px] text-slate-500 dark:text-white/45 truncate text-end pe-1">{meta.label}</span>
                          <div className="flex-1 flex gap-px">
                            {heatmapData.grid[ri].map((val, ci) => (
                              <div key={`c-${ri}-${ci}`} className="flex-1 h-4 rounded-sm transition-colors" title={`${String(ci).padStart(2, '0')}:00 - ${val}`}
                                style={{ background: val === 0 ? 'transparent' : `rgba(239, 68, 68, ${Math.max(0.1, (val / heatmapData.maxVal) * 0.8)})`, border: val === 0 ? '1px solid rgba(148,163,184,0.15)' : 'none' }} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* === ROW 4: Issue Timeline + Actions === */}
            {summaryView && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">timeline</span>{text.timelineTitle || text.issuesTitle}
                    </p>
                  </div>
                  {summarySourceOptions.length > 1 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {summarySourceOptions.map((opt) => (
                        <button key={opt.key} onClick={() => setSummarySourceFilter(opt.key)}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all ${summarySourceFilter === opt.key ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : `${opt.chip} hover:opacity-80`}`}>
                          <span className="material-symbols-outlined text-[12px]">{opt.icon}</span>
                          <span className="truncate max-w-[88px]">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {([
                      { key: 'all' as const, label: common.all || text.all || 'All', tone: 'bg-slate-100 text-slate-600 dark:bg-white/[0.04] dark:text-white/55', count: summaryRiskCounts.all },
                      { key: 'critical' as const, label: riskText('critical'), tone: 'bg-red-500/10 text-red-600 dark:text-red-300', count: summaryRiskCounts.critical },
                      { key: 'high' as const, label: riskText('high'), tone: 'bg-orange-500/10 text-orange-600 dark:text-orange-300', count: summaryRiskCounts.high },
                      { key: 'medium' as const, label: riskText('medium'), tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-300', count: summaryRiskCounts.medium },
                    ]).map((opt) => (
                      <button key={opt.key} onClick={() => setSummaryRiskFilter(opt.key)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-all ${summaryRiskFilter === opt.key ? 'bg-primary/15 text-primary ring-1 ring-primary/30' : `${opt.tone} hover:opacity-80`}`}>
                        <span>{opt.label}</span><span className="opacity-70">{opt.count}</span>
                      </button>
                    ))}
                  </div>
                  {groupedSummaryIssues.length === 0 ? (
                    <p className="text-[11px] text-slate-400 dark:text-white/40">{text.noIssues}</p>
                  ) : (
                    <div className="relative ps-4 border-s-2 border-slate-200 dark:border-white/10 space-y-2 max-h-[340px] overflow-y-auto pe-1">
                      {groupedSummaryIssues.map(({ key, issue: i, count, recentTimestamps }) => {
                        const srcMeta = issueSourceMeta(i.source, i.category);
                        const quickAction = summaryIssueAction(i.source, i.category);
                        const isExpanded = expandedSummaryGroups.includes(key);
                        const detailText = i.detail ? formatIssueDetail(i.detail) : '';
                        const dedupedDetail = (() => {
                          if (!detailText || !i.title) return detailText;
                          const titleLower = i.title.toLowerCase();
                          const segments = detailText.split(' · ').filter(seg => {
                            const segLower = seg.trim().toLowerCase();
                            if (!segLower) return false;
                            if (titleLower.includes(segLower)) return false;
                            if (segLower.length > 8 && titleLower.includes(segLower.slice(0, Math.floor(segLower.length * 0.7)))) return false;
                            return true;
                          });
                          return segments.join(' · ');
                        })();
                        const showDetail = !!dedupedDetail;
                        return (
                          <div key={i.id} className="relative">
                            <div className={`absolute -start-[21px] top-2.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${srcMeta.dot}`} />
                            <div className="rounded-lg border border-slate-200/80 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.02] p-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${srcMeta.chip}`}>
                                    <span className="material-symbols-outlined text-[14px]">{srcMeta.icon}</span>
                                  </span>
                                  <p className="text-[12px] font-bold text-slate-700 dark:text-white/75 truncate">{i.title}</p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {count > 1 && <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-primary/15 text-primary">x{count}</span>}
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${i.risk === 'critical' ? 'bg-red-500/10 text-red-500' : i.risk === 'high' ? 'bg-orange-500/10 text-orange-500' : 'bg-amber-500/10 text-amber-500'}`}>{riskText(i.risk)}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-slate-400 dark:text-white/35">{relativeTime(i.timestamp, text)}</span>
                                {count > 1 && (
                                  <div className="flex items-center gap-px">
                                    {recentTimestamps.slice(0, 4).map((ts, ti) => (
                                      <div key={`f-${ti}`} className="w-1 h-3 rounded-sm bg-red-400/60" title={new Date(ts).toLocaleString(dateLocale)} />
                                    ))}
                                    {count > 4 && <span className="text-[10px] text-slate-400 ms-0.5">+{count - 4}</span>}
                                  </div>
                                )}
                              </div>
                              {showDetail && <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1 break-all line-clamp-1">{dedupedDetail}</p>}
                              {count > 1 && (
                                <div className="mt-1.5">
                                  <button onClick={() => setExpandedSummaryGroups((prev) => prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key])}
                                    className="text-[10px] font-bold text-primary hover:opacity-80 flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[12px]">{isExpanded ? 'expand_less' : 'expand_more'}</span>
                                    <span>{isExpanded ? text.collapse : text.expand}</span>
                                  </button>
                                  {isExpanded && (
                                    <div className="mt-1.5 rounded-lg border border-slate-200/70 dark:border-white/10 bg-white/70 dark:bg-white/[0.02] px-2 py-1.5">
                                      <div className="flex items-center justify-between gap-2">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/35">{text.lastUpdate}</p>
                                        <button onClick={() => jumpToWindow(quickAction.target)} className="text-[10px] font-bold text-primary hover:opacity-80">{quickAction.label}</button>
                                      </div>
                                      <div className="mt-1 space-y-1">
                                        {recentTimestamps.map((ts) => (
                                          <p key={`${key}:${ts}`} className="text-[10px] text-slate-500 dark:text-white/45">{new Date(ts).toLocaleString(dateLocale)}</p>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* Actions + Overview Cards */}
                <div className="space-y-3">
                  {(overview?.cards || []).length > 0 && (
                    <div className="grid grid-cols-2 gap-2.5">
                      {(overview?.cards || []).map((c) => {
                        let hint = '';
                        if (c.id === 'events24h') hint = text.cardEvents24hHint;
                        else if (c.id === 'errors1h') hint = text.cardErrors1hHint;
                        else if (c.id === 'availability') hint = text.cardAvailabilityHint;
                        else if (c.id === 'resource') hint = text.cardResourceHint;
                        return (
                          <div key={c.id} className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.03] p-3" title={hint}>
                            <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">{cardLabel(c.id, c.label)}</p>
                            <div className="mt-1 flex items-end justify-between gap-2">
                              <p className="text-xl font-black text-slate-700 dark:text-white/80">{Number.isInteger(c.value) ? c.value : c.value.toFixed(1)}{c.unit || ''}</p>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${statusClass(c.status)}`}>{c.status === 'ok' ? text.ok : c.status === 'warn' ? text.warn : text.error}</span>
                            </div>
                            {hint && <p className="text-[10px] text-slate-400 dark:text-white/30 mt-1">{hint}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">{text.actionsTitle}</p>
                    {(overview?.actions || []).length === 0 ? (
                      <p className="text-[11px] text-slate-400 dark:text-white/40">{text.noActions}</p>
                    ) : (
                      <div className="space-y-2">
                        {(overview?.actions || []).map((a) => (
                          <button key={a.id} onClick={() => a.id === 'run-fix' ? handleFix() : jumpToWindow(a.target)} disabled={a.id === 'run-fix' && (fixing || fixableCount === 0)}
                            className="w-full text-start rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] px-2.5 py-2 hover:border-primary/30 transition-colors disabled:opacity-50">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12px] font-bold text-slate-700 dark:text-white/75">{actionText(a.id, a.title)}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${a.priority === 'high' ? 'bg-red-500/10 text-red-500' : a.priority === 'medium' ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-500/10 text-slate-500'}`}>{priorityText(a.priority)}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* === SECURITY AUDIT PANEL === */}
            {summaryView?.securityAudit && (
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
                {/* Header */}
                <button type="button" onClick={() => setSecurityAuditCollapsed(v => !v)}
                  className="w-full flex items-center justify-between gap-2 p-3 md:p-4 hover:bg-slate-50/50 dark:hover:bg-white/[0.01] transition-colors">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${summaryView.securityAudit.critical > 0 ? 'bg-red-500/10' : summaryView.securityAudit.warn > 0 ? 'bg-amber-500/10' : 'bg-emerald-500/10'}`}>
                      <span className={`material-symbols-outlined text-[18px] ${summaryView.securityAudit.critical > 0 ? 'text-red-500' : summaryView.securityAudit.warn > 0 ? 'text-amber-500' : 'text-emerald-500'}`}>shield</span>
                    </span>
                    <div className="text-start">
                      <p className="text-[12px] font-bold text-slate-700 dark:text-white/80">{text.securityAuditTitle || 'Security Audit'}</p>
                      <p className="text-[10px] text-slate-400 dark:text-white/35">{text.securityAuditSubtitle || 'OpenClaw security audit engine'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {summaryView.securityAudit.critical > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/10 text-red-500">
                        {(text.securityAuditCritical || '{count} critical').replace('{count}', String(summaryView.securityAudit.critical))}
                      </span>
                    )}
                    {summaryView.securityAudit.warn > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-500">
                        {(text.securityAuditWarn || '{count} warning(s)').replace('{count}', String(summaryView.securityAudit.warn))}
                      </span>
                    )}
                    {(summaryView.securityAudit.info || 0) > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-sky-500/10 text-sky-500">
                        {(text.securityAuditInfo || '{count} info').replace('{count}', String(summaryView.securityAudit.info))}
                      </span>
                    )}
                    {summaryView.securityAudit.total === 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-500">
                        {text.securityAuditPassed || 'All passed'}
                      </span>
                    )}
                    {securityDiff.fixedIds.size > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-500">
                        ✓ {securityDiff.fixedIds.size} fixed
                      </span>
                    )}
                    {securityDiff.newIds.size > 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-500/10 text-blue-500">
                        +{securityDiff.newIds.size} new
                      </span>
                    )}
                    {securityFixableItems.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleSecurityBatchFix(); }}
                        disabled={fixingSecurityBatch}
                        className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-lg font-bold bg-blue-500/10 text-blue-600 dark:text-blue-300 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[13px]">{fixingSecurityBatch ? 'hourglass_top' : 'build'}</span>
                        {(text.securityAuditBatchFix || '批量修复 ({count})').replace('{count}', String(securityFixableItems.length))}
                      </button>
                    )}
                    <span className={`material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30 transition-transform ${securityAuditCollapsed ? '' : 'rotate-180'}`}>expand_more</span>
                  </div>
                </button>

                {/* Guide banner for new users */}
                {!securityAuditCollapsed && !securityGuideDismissed && summaryView.securityAudit.total > 0 && (
                  <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-500/5 border border-blue-200/50 dark:border-blue-500/10 flex items-start gap-2">
                    <span className="material-symbols-outlined text-[16px] text-blue-500 mt-0.5 shrink-0">info</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300">{text.securityAuditGuideTitle || 'Security Check Notice'}</p>
                      <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5">
                        {(text.securityAuditGuideMessage || 'Detected {count} suggestion(s).').replace('{count}', String(summaryView.securityAudit.total))}
                      </p>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setSecurityGuideDismissed(true); if (typeof window !== 'undefined') window.localStorage.setItem('doctor.securityGuideDismissed', '1'); }}
                      className="text-[10px] font-bold text-blue-500 hover:text-blue-700 shrink-0 px-2 py-0.5">
                      {text.securityAuditGuideDismiss || 'Got it'}
                    </button>
                  </div>
                )}

                {/* Findings list */}
                {!securityAuditCollapsed && (
                  <div className="px-3 pb-3 space-y-2">
                    {summaryView.securityAudit.total === 0 ? (
                      <div className="flex items-center gap-2 py-3 justify-center">
                        <span className="material-symbols-outlined text-[18px] text-emerald-500">verified_user</span>
                        <span className="text-[12px] font-bold text-emerald-600 dark:text-emerald-400">{text.securityAuditEmpty || 'No security issues detected'}</span>
                      </div>
                    ) : (
                      (summaryView.securityAudit.items || []).map((item) => {
                        const isExpanded = expandedSecurityItems.has(item.id);
                        const sevLabel = item.severity === 'error'
                          ? (text.securityAuditSeverityCritical || 'Critical')
                          : item.severity === 'info'
                            ? (text.securityAuditSeverityInfo || 'Info')
                            : (text.securityAuditSeverityWarn || 'Warning');
                        const sevCls = item.severity === 'error'
                          ? 'bg-red-500/10 text-red-500'
                          : item.severity === 'info'
                            ? 'bg-sky-500/10 text-sky-500'
                            : 'bg-amber-500/10 text-amber-500';
                        const borderCls = item.severity === 'error'
                          ? 'border-red-200/50 dark:border-red-500/15'
                          : item.severity === 'info'
                            ? 'border-sky-200/50 dark:border-sky-500/15'
                            : 'border-amber-200/50 dark:border-amber-500/15';
                        const cmdMatch = item.remediation?.match(/`([^`]+)`|(?:Run|run|Execute|execute)[:\s]+(.+?)(?:\.|$)/);
                        const extractedCmd = cmdMatch ? (cmdMatch[1] || cmdMatch[2])?.trim() : null;
                        return (
                          <div key={item.id} className={`rounded-lg border ${borderCls} bg-slate-50/50 dark:bg-white/[0.015] overflow-hidden`}>
                            <button type="button" onClick={() => setExpandedSecurityItems(prev => {
                              const next = new Set(prev);
                              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                              return next;
                            })} className="w-full flex items-start gap-2.5 p-2.5 text-start hover:bg-slate-100/50 dark:hover:bg-white/[0.02] transition-colors">
                              <span className={`material-symbols-outlined text-[16px] mt-0.5 shrink-0 ${item.severity === 'error' ? 'text-red-500' : item.severity === 'info' ? 'text-sky-500' : 'text-amber-500'}`}>
                                {item.severity === 'error' ? 'gpp_bad' : item.severity === 'info' ? 'info' : 'gpp_maybe'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-[12px] font-bold text-slate-700 dark:text-white/75">{saTranslate(text, item.id, 'sa', item.name)}</p>
                                  {securityDiff.newIds.has(item.id) && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-blue-500/10 text-blue-500 animate-pulse">NEW</span>
                                  )}
                                </div>
                                {!isExpanded && item.detail && (
                                  <p className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5 truncate">{item.detail}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${sevCls}`}>{sevLabel}</span>
                                <span className={`material-symbols-outlined text-[14px] text-slate-400 dark:text-white/30 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>expand_more</span>
                              </div>
                            </button>
                            {isExpanded && (
                              <div className="px-2.5 pb-2.5 pt-0 space-y-2 border-t border-slate-200/50 dark:border-white/5">
                                {item.detail && (
                                  <div className="mt-2">
                                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-1">{text.saDetailLabel || 'Detail'}</p>
                                    <p className="text-[11px] text-slate-600 dark:text-white/55 break-all">{item.detail}</p>
                                  </div>
                                )}
                                {item.remediation && (
                                  <div className="rounded-lg bg-blue-50/80 dark:bg-blue-500/5 border border-blue-200/40 dark:border-blue-500/10 p-2.5">
                                    <div className="flex items-center justify-between mb-1">
                                      <p className="text-[10px] uppercase tracking-wider text-blue-500 dark:text-blue-400 flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[12px]">build</span>
                                        {text.securityAuditRemediation || 'Remediation'}
                                      </p>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleSecurityAuditAction(item);
                                        }}
                                        disabled={fixingOne === (item.id || item.code || item.name)}
                                        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-300 hover:bg-blue-500/15 disabled:opacity-50"
                                      >
                                        <span className="material-symbols-outlined text-[12px]">{detectSecurityAction(item) === 'settings' ? 'settings' : detectSecurityAction(item) === 'manual' ? 'description' : 'build'}</span>
                                        {fixingOne === (item.id || item.code || item.name)
                                          ? (text.fixingOne || '...')
                                          : detectSecurityAction(item) === 'settings'
                                            ? (text.securityAuditGoSettings || '去设置')
                                            : detectSecurityAction(item) === 'manual'
                                              ? (text.securityAuditViewFixCommand || '查看修复指令')
                                              : (text.securityAuditAutoFix || '一键修复')}
                                      </button>
                                    </div>
                                    <p className="text-[11px] text-blue-700 dark:text-blue-300">{saTranslate(text, item.id, 'saRem', item.remediation!)}</p>
                                    {extractedCmd && (
                                      <button onClick={(e) => {
                                        e.stopPropagation();
                                        copyToClipboard(extractedCmd);
                                        setCopiedCmd(item.id);
                                        setTimeout(() => setCopiedCmd(''), 2000);
                                      }} className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 bg-blue-100/60 dark:bg-blue-500/10 px-2 py-1 rounded">
                                        <span className="material-symbols-outlined text-[12px]">{copiedCmd === item.id ? 'check' : 'content_copy'}</span>
                                        <code className="font-mono text-[10px]">{extractedCmd}</code>
                                        <span className="ms-1">{copiedCmd === item.id ? (text.securityAuditCopied || 'Copied') : (text.securityAuditCopyCmd || 'Copy')}</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                                {item.suggestion && item.suggestion !== item.remediation && (
                                  <p className="text-[11px] text-amber-600 dark:text-amber-400">{item.suggestion}</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {/* === ROW 5: Diagnostics Check List === */}
            <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">{text.sectionChecks}</p>
                {lastScanTime && (
                  <p className="text-[10px] text-slate-400 dark:text-white/30 flex items-center gap-1">
                    {isCachedResult && <span className="material-symbols-outlined text-[12px]">cached</span>}
                    {text.cachedResultLabel}: {new Date(lastScanTime).toLocaleString(dateLocale)}
                  </p>
                )}
              </div>
              {isCachedResult && result && (
                <div className="mb-2.5 px-2.5 py-1.5 rounded-lg bg-amber-50/80 dark:bg-amber-500/5 border border-amber-200/50 dark:border-amber-500/10 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] text-amber-500">info</span>
                  <span className="text-[10px] text-amber-700 dark:text-amber-300">{text.cachedResultHint}</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1 mb-2.5">
                {(['all', 'error', 'warn', 'ok'] as const).map(k => (
                  <button key={k} onClick={() => setSeverityFilter(k)} className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all ${severityFilter === k ? 'bg-primary/15 text-primary' : 'bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40'}`}>
                    {k === 'all' ? text.all : k === 'ok' ? text.ok : k === 'warn' ? text.warn : text.error}
                  </button>
                ))}
                <CustomSelect
                  value={categoryFilter}
                  onChange={(v) => setCategoryFilter(v)}
                  options={categories.map((c) => ({ value: c, label: c === 'all' ? text.all : c === 'other' ? text.other : c }))}
                  className="h-6 px-2 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40"
                />
                <button onClick={() => setOnlyFixable((v) => !v)} className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all ${onlyFixable ? 'bg-blue-500/15 text-blue-500' : 'bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40'}`}>
                  {text.fixable}
                </button>
              </div>
              {localizedItems.length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-white/40 py-4 text-center">{text.empty}</p>
              ) : (
                <div className="space-y-2">
                  {localizedItems.map((item, idx) => {
                    const st = item.status === 'ok' ? text.ok : item.status === 'warn' ? text.warn : text.error;
                    const checkId = item.id || item.code || '';
                    const relatedFaqs = item.status !== 'ok' ? (doctorFaqIndex.get(checkId) || []) : [];
                    return (
                      <div key={`${item.name}-${idx}`} className="rounded-lg border border-slate-200 dark:border-white/10 p-2.5 bg-slate-50 dark:bg-white/[0.02]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[12px] font-bold text-slate-700 dark:text-white/75 truncate">{item.displayName}</p>
                            <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5 break-all">{item.displayDetail}</p>
                            {item.displaySuggestion && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{item.displaySuggestion}</p>}
                          </div>
                          <div className="shrink-0 flex items-center gap-1.5">
                            {item.fixable && (
                              <button onClick={() => handleFixOne(item)} disabled={fixingOne === (item.id || item.code || item.name)} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 disabled:opacity-50">
                                {fixingOne === (item.id || item.code || item.name) ? text.fixingOne : text.fix}
                              </button>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${statusClass(item.status)}`}>{st}</span>
                          </div>
                        </div>
                        {relatedFaqs.length > 0 && (
                          <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-white/5">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="material-symbols-outlined text-[11px] text-indigo-400">menu_book</span>
                              <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-wider">{text.relatedFaq || 'Related FAQ'}</span>
                              {relatedFaqs.map(faq => (
                                <button
                                  key={faq.id}
                                  onClick={() => window.dispatchEvent(new CustomEvent('clawdeck:open-window', { detail: { id: 'knowledge', expandItem: faq.id } }))}
                                  className="text-[10px] text-indigo-500 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 hover:underline underline-offset-2 flex items-center gap-0.5"
                                >
                                  <span className="material-symbols-outlined text-[10px]">help_outline</span>
                                  {faq.content.question || faq.metadata.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-slate-200 dark:border-white/10">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">{text.fix}</p>
                {fixResult.length === 0 ? (
                  <p className="text-[11px] text-slate-400 dark:text-white/40">{text.noFix}</p>
                ) : (
                  <div className="space-y-1">
                    {fixResult.map((line, idx) => (
                      <p key={`${line}-${idx}`} className="text-[11px] text-emerald-600 dark:text-emerald-400">- {line}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Exception Detail Modal */}
      {showExceptionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowExceptionModal(false)}>
          <div className="w-full max-w-lg max-h-[80vh] mx-4 rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10">
              <p className="text-[13px] font-bold text-slate-700 dark:text-white/85 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-red-500">warning</span>
                {text.exceptionModalTitle} ({(displaySummary?.recentIssues || []).length})
              </p>
              <button onClick={() => setShowExceptionModal(false)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/[0.06]">
                <span className="material-symbols-outlined text-[16px] text-slate-400">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {(displaySummary?.recentIssues || []).length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-white/40 py-8 text-center">{text.exceptionModalEmpty}</p>
              ) : (
                (displaySummary?.recentIssues || []).map((issue, idx) => {
                  const srcMeta = issueSourceMeta(issue.source, issue.category);
                  const action = summaryIssueAction(issue.source, issue.category);
                  return (
                    <div key={`${issue.id}-${idx}`} className="rounded-lg border border-slate-200/80 dark:border-white/10 bg-slate-50/80 dark:bg-white/[0.02] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex items-center gap-2">
                          <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${srcMeta.chip}`}>
                            <span className="material-symbols-outlined text-[14px]">{srcMeta.icon}</span>
                          </span>
                          <p className="text-[12px] font-bold text-slate-700 dark:text-white/75 truncate">{issue.title}</p>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${issue.risk === 'critical' ? 'bg-red-500/10 text-red-500' : issue.risk === 'high' ? 'bg-orange-500/10 text-orange-500' : 'bg-amber-500/10 text-amber-500'}`}>{riskText(issue.risk)}</span>
                      </div>
                      {issue.detail && <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1 break-all">{formatIssueDetail(issue.detail)}</p>}
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-slate-400 dark:text-white/35">{new Date(issue.timestamp).toLocaleString(dateLocale)}</span>
                        <button onClick={() => { setShowExceptionModal(false); jumpToWindow(action.target); }} className="text-[10px] font-bold text-primary hover:opacity-80 flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                          {text.exceptionModalJump}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-between">
              <button onClick={() => { setShowExceptionModal(false); jumpToWindow('activity'); }} className="text-[11px] font-bold text-primary hover:opacity-80 flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                {text.exceptionModalViewAll || text.viewAllEvents}
              </button>
              <button onClick={() => setShowExceptionModal(false)} className="h-8 px-3 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                {text.exceptionModalClose}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Doctor;
