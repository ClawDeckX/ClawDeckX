import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { doctorApi } from '../services/api';
import { useToast } from '../components/Toast';
import { ContextBudgetPanel } from '../components/maintenance';

type TabId = 'diagnose' | 'context';

interface DoctorProps {
  language: Language;
}

interface CheckItem {
  id: string;
  code: string;
  name: string;
  status: 'ok' | 'warn' | 'error';
  severity?: 'info' | 'warn' | 'error';
  category?: string;
  detail: string;
  suggestion?: string;
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

function statusClass(status: 'ok' | 'warn' | 'error') {
  if (status === 'ok') return 'text-emerald-500 bg-emerald-500/10';
  if (status === 'warn') return 'text-amber-500 bg-amber-500/10';
  return 'text-red-500 bg-red-500/10';
}

const Doctor: React.FC<DoctorProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const { toast } = useToast();
  const dateLocale = useMemo(() => ({ zh: 'zh-CN', en: 'en-US' } as Record<string, string>)[language] || 'en-US', [language]);
  const common = (t.common || {}) as any;
  const dr = (t.dr || {}) as any;
  const maint = (t.maint || {}) as any;
  const text = dr;
  const na = common.na || '--';

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('diagnose');

  const [result, setResult] = useState<DiagResult | null>(null);
  const [overview, setOverview] = useState<DoctorOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [fixResult, setFixResult] = useState<string[]>([]);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'error' | 'warn' | 'ok'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [onlyFixable, setOnlyFixable] = useState(false);
  const [fixingOne, setFixingOne] = useState<string>('');

  const runDoctor = useCallback(async (force = false) => {
    const data = await doctorApi.runCached(12000, force) as DiagResult;
    setResult(data);
  }, []);

  const loadOverview = useCallback(async (force = false) => {
    const data = await doctorApi.overviewCached(12000, force) as DoctorOverview;
    setOverview(data);
    setLastUpdate(new Date(data?.updatedAt || Date.now()).toLocaleString(dateLocale));
  }, [dateLocale]);

  const fetchAll = useCallback(async (force = false) => {
    setLoading(force || (!result && !overview));
    setLoadError('');
    try {
      await Promise.all([runDoctor(force), loadOverview(force)]);
    } catch (err: any) {
      const msg = err?.message || '';
      const hint = msg ? `: ${msg}` : '';
      setLoadError(`${text.overviewLoadFail}${hint}`);
      toast('error', `${text.overviewLoadFail}${hint}`);
    } finally {
      setLoading(false);
    }
  }, [loadOverview, runDoctor, text.overviewLoadFail, toast]);

  // Don't auto-run on mount - wait for user to click "立即体检" button
  // This prevents slow startup experience
  // useEffect(() => {
  //   fetchAll(false);
  // }, [fetchAll]);

  const handleFix = useCallback(async () => {
    setFixing(true);
    try {
      const data = await doctorApi.fix() as { fixed?: string[] };
      const fixed = Array.isArray(data?.fixed) ? data.fixed : [];
      setFixResult(fixed);
      toast('success', text.fixedOk);
      await fetchAll(true);
    } catch (err: any) {
      toast('error', `${text.fixedFail}: ${err?.message || ''}`);
    } finally {
      setFixing(false);
    }
  }, [fetchAll, text.fixedFail, text.fixedOk, toast]);

  const handleFixOne = useCallback(async (item: CheckItem) => {
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
    } catch (err: any) {
      toast('error', `${text.fixedFail}: ${err?.message || ''}`);
    } finally {
      setFixingOne('');
    }
  }, [fetchAll, text.fixedFail, text.fixedOk, text.noFix, toast]);

  const jumpToWindow = useCallback((id: string) => {
    window.dispatchEvent(new CustomEvent('clawdeck:open-window', { detail: { id } }));
  }, []);

  const fixableCount = (result?.items || []).filter(i => i.fixable).length;
  const filteredItems = useMemo(() => {
    const all = result?.items || [];
    return all.filter((i) => {
      if (severityFilter !== 'all' && i.status !== severityFilter) return false;
      if (categoryFilter !== 'all' && (i.category || 'other') !== categoryFilter) return false;
      if (onlyFixable && !i.fixable) return false;
      return true;
    });
  }, [categoryFilter, onlyFixable, result?.items, severityFilter]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    (result?.items || []).forEach((i) => set.add(i.category || 'other'));
    return ['all', ...Array.from(set)];
  }, [result?.items]);

  const trend = overview?.trend24h || [];
  const points = useMemo(() => {
    if (trend.length === 0) return '';
    return trend.map((p, i) => `${(i / Math.max(trend.length - 1, 1)) * 100},${100 - p.healthScore}`).join(' ');
  }, [trend]);

  const totalRisk = useMemo(() => {
    const r = overview?.riskCounts || {};
    return (r.low || 0) + (r.medium || 0) + (r.high || 0) + (r.critical || 0);
  }, [overview?.riskCounts]);

  const statusLabel = overview?.status === 'ok'
    ? text.statusHealthy
    : overview?.status === 'warn'
      ? text.statusWarning
      : text.statusCritical;

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
    if (id === 'start-gateway') return text.actionStartGateway;
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

  const fallbackCheckCatalog = useMemo<Record<string, CheckLocaleEntry>>(() => {
    if (language === 'zh') {
      return {
        openclaw_install: { name: 'OpenClaw 安装' },
        config_file: { name: '配置文件' },
        gateway_status: { name: '网关状态' },
        pid_lock: { name: 'PID 锁文件' },
        port_default: { name: '端口检查' },
        disk_space: { name: '磁盘空间' },
        gateway_diag_openclaw_installed: { name: 'OpenClaw 已安装' },
        gateway_diag_config_exists: { name: '配置文件存在' },
        gateway_diag_config_valid: { name: '配置文件格式正确' },
        gateway_diag_gateway_process: { name: 'Gateway 进程' },
        gateway_diag_port_reachable: { name: '端口可达性' },
        gateway_diag_gateway_api: { name: 'Gateway API 响应' },
        gateway_diag_port_conflict: { name: '端口冲突检查' },
        gateway_diag_auth_token: { name: '鉴权 Token 匹配' },
      };
    }

    return {
      openclaw_install: { name: 'OpenClaw Install' },
      config_file: { name: 'Config File' },
      gateway_status: { name: 'Gateway Status' },
      pid_lock: { name: 'PID Lock' },
      port_default: { name: 'Port Check' },
      disk_space: { name: 'Disk Space' },
      gateway_diag_openclaw_installed: { name: 'OpenClaw Installed' },
      gateway_diag_config_exists: { name: 'Config File Exists' },
      gateway_diag_config_valid: { name: 'Config File Valid' },
      gateway_diag_gateway_process: { name: 'Gateway Process' },
      gateway_diag_port_reachable: { name: 'Port Reachable' },
      gateway_diag_gateway_api: { name: 'Gateway API Response' },
      gateway_diag_port_conflict: { name: 'Port Conflict Check' },
      gateway_diag_auth_token: { name: 'Auth Token Match' },
    };
  }, [language]);

  const checkDetailTpl = useMemo(() => {
    if (language === 'zh') {
      return {
        openclawInstalled: '已安装: {path}',
        openclawNotFound: '未找到 openclaw 命令',
        configExistsSize: '配置存在，大小: {size}',
        configExists: '配置存在',
        configMissing: '未找到配置文件',
        gatewayNotRunning: '网关未运行',
        noStalePid: '没有陈旧 PID 文件',
        stalePid: '发现陈旧 PID 文件，网关未运行',
        portDefault: '默认端口 {port}',
        diskOk: '正常',
      };
    }
    return {
      openclawInstalled: 'installed: {path}',
      openclawNotFound: 'openclaw command not found',
      configExistsSize: 'exists, size: {size}',
      configExists: 'exists',
      configMissing: 'config file not found',
      gatewayNotRunning: 'gateway not running',
      noStalePid: 'no stale files',
      stalePid: 'stale PID file found but gateway not running',
      portDefault: 'default port {port}',
      diskOk: 'ok',
    };
  }, [language]);

  const formatTpl = useCallback((tpl: string, vars: Record<string, string>) => {
    return tpl.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  }, []);

  const localizeCheckItem = useCallback((item: CheckItem): LocalizedCheckItem => {
    const code = (item.code || item.id || '').replace(/\./g, '_');
    const catalog = (text.checkCatalog || {}) as Record<string, CheckLocaleEntry>;
    const merged = { ...(fallbackCheckCatalog[code] || {}), ...(catalog[code] || {}) };

    let detail = item.detail || '';
    if (code === 'openclaw_install') {
      if (/^installed:\s*/i.test(detail)) {
        const path = detail.replace(/^installed:\s*/i, '').trim();
        detail = formatTpl(checkDetailTpl.openclawInstalled, { path });
      } else if (/openclaw command not found/i.test(detail)) {
        detail = checkDetailTpl.openclawNotFound;
      }
    } else if (code === 'config_file') {
      const sizeMatch = detail.match(/^exists,\s*size:\s*(.+)$/i);
      if (sizeMatch) {
        detail = formatTpl(checkDetailTpl.configExistsSize, { size: sizeMatch[1].trim() });
      } else if (/^exists$/i.test(detail)) {
        detail = checkDetailTpl.configExists;
      } else if (/config file not found/i.test(detail)) {
        detail = checkDetailTpl.configMissing;
      }
    } else if (code === 'gateway_status') {
      if (/gateway not running/i.test(detail)) {
        detail = checkDetailTpl.gatewayNotRunning;
      }
    } else if (code === 'pid_lock') {
      if (/^no stale files$/i.test(detail)) {
        detail = checkDetailTpl.noStalePid;
      } else if (/stale PID file found but gateway not running/i.test(detail)) {
        detail = checkDetailTpl.stalePid;
      }
    } else if (code === 'port_default') {
      const m = detail.match(/default port\s+(\d+)/i);
      if (m) {
        detail = formatTpl(checkDetailTpl.portDefault, { port: m[1] });
      }
    } else if (code === 'disk_space') {
      if (/^ok$/i.test(detail)) {
        detail = checkDetailTpl.diskOk;
      }
    }

    return {
      ...item,
      displayName: merged.name || item.name,
      displayDetail: merged.detail || detail,
      displaySuggestion: merged.suggestion || item.suggestion,
    };
  }, [checkDetailTpl, fallbackCheckCatalog, formatTpl, text.checkCatalog]);

  const localizedItems = useMemo(() => filteredItems.map(localizeCheckItem), [filteredItems, localizeCheckItem]);

  const tabs: { id: TabId; icon: string; label: string }[] = [
    { id: 'diagnose', icon: 'troubleshoot', label: maint.tabDiagnose || text.title || 'Diagnostics' },
    { id: 'context', icon: 'data_usage', label: maint.tabContext || 'Context' },
  ];

  return (
    <div className="h-full overflow-y-auto bg-slate-50 dark:bg-transparent">
      {/* Header */}
      <div className="p-3 md:p-4 border-b border-slate-200 dark:border-white/5 bg-white/70 dark:bg-white/[0.02] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm md:text-base font-bold text-slate-800 dark:text-white">{maint.title || text.title}</h2>
            <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5">{maint.subtitle || text.subtitle}</p>
          </div>
          {activeTab === 'diagnose' && (
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-[10px] font-bold ${statusClass(overview?.status || 'warn')}`}>{statusLabel}</span>
              <span className="text-[13px] font-black text-primary">{overview?.score ?? result?.score ?? na}</span>
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
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-primary/15 text-primary'
                  : 'bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40 hover:bg-slate-200 dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-3 md:p-4">
        {/* Context Tab */}
        {activeTab === 'context' && (
          <ContextBudgetPanel language={language} />
        )}

        {/* Diagnose Tab (Original Content) */}
        {activeTab === 'diagnose' && (
          <div className="space-y-3">
            {loadError && (
              <div className="rounded-lg border border-red-300/50 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
                {loadError}
              </div>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(overview?.cards || []).map((c) => {
            // Add explanatory text for each card
            let hint = '';
            if (c.id === 'events24h') {
              hint = text.cardEvents24hHint || '活动事件总数（包含所有级别）';
            } else if (c.id === 'errors1h') {
              hint = text.cardErrors1hHint || '高风险和严重事件数';
            } else if (c.id === 'availability') {
              hint = text.cardAvailabilityHint || '网关诊断检查通过率';
            } else if (c.id === 'resource') {
              hint = text.cardResourceHint || '系统内存使用率';
            }
            return (
              <div key={c.id} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3" title={hint}>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">{cardLabel(c.id, c.label)}</p>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <p className="text-xl font-black text-slate-700 dark:text-white/80">
                    {Number.isInteger(c.value) ? c.value : c.value.toFixed(1)}{c.unit || ''}
                  </p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${statusClass(c.status)}`}>{c.status === 'ok' ? text.ok : c.status === 'warn' ? text.warn : text.error}</span>
                </div>
                {hint && <p className="text-[9px] text-slate-400 dark:text-white/30 mt-1">{hint}</p>}
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="xl:col-span-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">{text.trendTitle}</p>
                <p className="text-[9px] text-slate-400 dark:text-white/30 mt-0.5">{text.trendHint || '上：健康分数 / 下：事件数量'}</p>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-white/35">{text.lastUpdate}: {lastUpdate || na}</p>
            </div>
            {trend.length === 0 ? (
              <p className="text-[11px] text-slate-400 dark:text-white/40 py-6 text-center">{text.empty}</p>
            ) : (
              <div className="space-y-2">
                <div className="h-24 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200/70 dark:border-white/10 p-2 relative">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
                    <polyline points={points} fill="none" stroke="currentColor" className="text-primary" strokeWidth="1.5" />
                  </svg>
                  <div className="absolute top-1 left-2 text-[9px] text-slate-400 dark:text-white/30">{text.healthScore || '健康分数'}</div>
                </div>
                <div className="relative">
                  <div className="grid grid-cols-6 gap-1">
                    {trend.slice(-12).map((p, idx) => {
                      const total = p.low + p.medium + p.high + p.critical;
                      const barH = Math.min(100, total * 8);
                      return (
                        <div key={`${p.timestamp}-${idx}`} className="h-14 flex flex-col items-center justify-end">
                          <div className="w-full flex flex-col items-center justify-end" style={{ height: '100%' }}>
                            <div className="w-3 rounded-t" style={{ 
                              height: `${Math.max(6, barH)}%`,
                              background: total === 0 ? '#cbd5e1' : `linear-gradient(to top, ${p.critical > 0 ? '#ef4444' : p.high > 0 ? '#f97316' : p.medium > 0 ? '#f59e0b' : '#10b981'}, #64748b)`
                            }} title={`${p.label}\n低: ${p.low} 中: ${p.medium}\n高: ${p.high} 严重: ${p.critical}`} />
                          </div>
                          <p className="text-[8px] text-slate-400 dark:text-white/30 mt-0.5">{p.label.split(':')[0]}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="absolute -left-1 top-0 text-[9px] text-slate-400 dark:text-white/30">{text.eventCount || '事件数'}</div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">{text.riskTitle}</p>
              <p className="text-[9px] text-slate-400 dark:text-white/30">{text.riskHint || '24小时内'}</p>
            </div>
            {totalRisk > 0 ? (
              <div className="space-y-2">
                {[
                  { key: 'low', color: 'bg-emerald-500', label: text.riskLow, count: overview?.riskCounts?.low || 0 },
                  { key: 'medium', color: 'bg-amber-500', label: text.riskMedium, count: overview?.riskCounts?.medium || 0 },
                  { key: 'high', color: 'bg-orange-500', label: text.riskHigh, count: overview?.riskCounts?.high || 0 },
                  { key: 'critical', color: 'bg-red-500', label: text.riskCritical, count: overview?.riskCounts?.critical || 0 },
                ].map(({ key, color, label, count }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${color} shrink-0`}></span>
                    <span className="text-[11px] text-slate-600 dark:text-white/70 w-8">{label}</span>
                    <div className="flex-1 h-4 bg-slate-100 dark:bg-white/[0.04] rounded overflow-hidden">
                      <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, (count / totalRisk) * 100)}%` }} />
                    </div>
                    <span className="text-[11px] font-bold text-slate-700 dark:text-white/80 w-10 text-right">{count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 dark:text-white/40 py-4 text-center">{text.noRiskData || '暂无数据'}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">{text.actionsTitle}</p>
            {(overview?.actions || []).length === 0 ? (
              <p className="text-[11px] text-slate-400 dark:text-white/40">{text.noActions}</p>
            ) : (
              <div className="space-y-2">
                {(overview?.actions || []).map((a) => (
                  <button key={a.id} onClick={() => jumpToWindow(a.target)} className="w-full text-left rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] px-2.5 py-2 hover:border-primary/30">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-bold text-slate-700 dark:text-white/75">{actionText(a.id, a.title)}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${a.priority === 'high' ? 'bg-red-500/10 text-red-500' : a.priority === 'medium' ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-500/10 text-slate-500'}`}>{priorityText(a.priority)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">{text.issuesTitle}</p>
            {(overview?.topIssues || []).length === 0 ? (
              <p className="text-[11px] text-slate-400 dark:text-white/40">{text.noIssues}</p>
            ) : (
              <div className="space-y-2">
                {(overview?.topIssues || []).map((i) => (
                  <div key={i.id} className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-bold text-slate-700 dark:text-white/75 truncate">{i.title}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${i.risk === 'critical' ? 'bg-red-500/10 text-red-500' : i.risk === 'high' ? 'bg-orange-500/10 text-orange-500' : i.risk === 'medium' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>{riskText(i.risk)}</span>
                    </div>
                    {i.detail && <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5 break-all">{i.detail}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">{text.sectionChecks}</p>
          <div className="flex flex-wrap items-center gap-1 mb-2.5">
            {(['all', 'error', 'warn', 'ok'] as const).map(k => (
              <button key={k} onClick={() => setSeverityFilter(k)} className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all ${severityFilter === k ? 'bg-primary/15 text-primary' : 'bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40'}`}>
                {k === 'all' ? text.all : k === 'ok' ? text.ok : k === 'warn' ? text.warn : text.error}
              </button>
            ))}
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label={text.category} className="h-6 px-2 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40">
              {categories.map((c) => (
                <option key={c} value={c}>{c === 'all' ? text.all : c === 'other' ? text.other : c}</option>
              ))}
            </select>
            <button onClick={() => setOnlyFixable((v) => !v)} className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all ${onlyFixable ? 'bg-blue-500/15 text-blue-500' : 'bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40'}`}>
              {text.fixable}
            </button>
          </div>

          {localizedItems.length === 0 ? (
            <p className="text-[11px] text-slate-400 dark:text-white/40 py-4 text-center">{text.empty}</p>
          ) : (
            <div className="space-y-2">
              {localizedItems.map((item, idx) => {
                const statusText = item.status === 'ok' ? text.ok : item.status === 'warn' ? text.warn : text.error;
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
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${statusClass(item.status)}`}>{statusText}</span>
                      </div>
                    </div>
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
    </div>
  );
};

export default Doctor;
