
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Language, dispatchOpenWindow } from '../types';
import { getTranslation } from '../locales';
import { observabilityApi, PromMetric, PromParseResult, PromScrapeConfig } from '../services/api';
import { useToast } from '../components/Toast';

interface ObservabilityProps {
  language: Language;
}

// ── Helpers ────────────────────────────────────────────────────────
function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(1) + ' GB';
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(1) + ' MB';
  if (b >= 1_024) return (b / 1_024).toFixed(1) + ' KB';
  return b.toFixed(0) + ' B';
}

function fmtMs(sec: number): string {
  const ms = sec * 1000;
  if (ms < 1) return '<1ms';
  if (ms < 1000) return ms.toFixed(0) + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

function findMetric(metrics: PromMetric[], name: string): PromMetric | undefined {
  return metrics.find(m => m.name === name);
}

function sumValues(m: PromMetric | undefined, filter?: (labels: Record<string, string>) => boolean): number {
  if (!m) return 0;
  return m.values
    .filter(v => !v.suffix && (!filter || filter(v.labels)))
    .reduce((s, v) => s + v.value, 0);
}

function gaugeLatest(m: PromMetric | undefined, filter?: (labels: Record<string, string>) => boolean): number {
  if (!m) return 0;
  const match = m.values.filter(v => !v.suffix && (!filter || filter(v.labels)));
  return match.length > 0 ? match[match.length - 1].value : 0;
}

function histP95(m: PromMetric | undefined, filter?: (labels: Record<string, string>) => boolean): number {
  if (!m) return 0;
  const buckets = m.values.filter(v => v.suffix === 'bucket' && (!filter || filter(v.labels)));
  const countVal = m.values.find(v => v.suffix === 'count' && (!filter || filter(v.labels)));
  if (!countVal || countVal.value === 0) return 0;
  const total = countVal.value;
  const target = total * 0.95;
  for (const b of buckets) {
    const le = b.labels['le'];
    if (le && b.value >= target) return parseFloat(le);
  }
  return 0;
}

function groupBy<T>(arr: T[], key: (v: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const v of arr) {
    const k = key(v);
    (out[k] ??= []).push(v);
  }
  return out;
}

// ── Sub-components ─────────────────────────────────────────────────
function MetricBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 truncate text-text-secondary font-medium">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-surface-sunken overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-16 text-end tabular-nums text-text font-mono">{fmtNum(value)}</span>
    </div>
  );
}

function StatCard({ icon, title, value, sub, color }: { icon: string; title: string; value: string; sub?: string; color: string }) {
  return (
    <div className="sci-card p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: color + '18' }}>
        <span className="material-symbols-outlined text-lg" style={{ color }}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-text-muted font-medium truncate">{title}</p>
        <p className="text-base font-bold tabular-nums text-text truncate">{value}</p>
        {sub && <p className="text-[10px] text-text-secondary truncate">{sub}</p>}
      </div>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-bold text-text mb-2">
      <span className="material-symbols-outlined text-base text-text-secondary">{icon}</span>
      {title}
    </h3>
  );
}

// ── Main component ─────────────────────────────────────────────────
const Observability: React.FC<ObservabilityProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const ob = (t as any).obs || {};
  const { toast } = useToast();

  const [data, setData] = useState<PromParseResult | null>(null);
  const [scrapeConfig, setScrapeConfig] = useState<PromScrapeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = useCallback(async (force = false) => {
    try {
      const res = await observabilityApi.metricsJsonCached(5000, force);
      if (res) {
        setData(res);
        setError(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchScrapeConfig = useCallback(async () => {
    try {
      const res = await observabilityApi.scrapeConfig();
      if (res) setScrapeConfig(res);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchMetrics(true);
    fetchScrapeConfig();
  }, [fetchMetrics, fetchScrapeConfig]);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => fetchMetrics(true), 10_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, fetchMetrics]);

  const metrics = data?.metrics ?? [];

  // ── Derived metrics ──────────────────────────────────────────────
  const tokenUsage = findMetric(metrics, 'openclaw_model_tokens') || findMetric(metrics, 'openclaw_model_usage_tokens');
  const costUsage = findMetric(metrics, 'openclaw_model_cost_usd') || findMetric(metrics, 'openclaw_model_usage_cost_dollars');
  const modelCall = findMetric(metrics, 'openclaw_model_call');
  const modelCallDuration = findMetric(metrics, 'openclaw_model_call_duration_seconds');
  const toolExec = findMetric(metrics, 'openclaw_tool_execution');
  const toolDuration = findMetric(metrics, 'openclaw_tool_execution_duration_seconds');
  const msgDelivery = findMetric(metrics, 'openclaw_message_delivery');
  const msgProcessed = findMetric(metrics, 'openclaw_message_processed');
  const queueLane = findMetric(metrics, 'openclaw_queue_lane_size');
  const sessionState = findMetric(metrics, 'openclaw_session_state');
  const sessionQueueDepth = findMetric(metrics, 'openclaw_session_queue_depth');
  const memBytes = findMetric(metrics, 'openclaw_memory_bytes');
  const memPressure = findMetric(metrics, 'openclaw_memory_pressure');
  const droppedSeries = findMetric(metrics, 'openclaw_prometheus_series_dropped') || findMetric(metrics, 'openclaw_prometheus_dropped_series');

  const totalInputTokens = sumValues(tokenUsage, l => (l.token_type || l.direction) === 'input');
  const totalOutputTokens = sumValues(tokenUsage, l => (l.token_type || l.direction) === 'output');
  const totalCost = sumValues(costUsage);
  const totalModelCalls = sumValues(modelCall);
  const modelCallErrors = sumValues(modelCall, l => l.outcome === 'error');
  const modelP95 = histP95(modelCallDuration);
  const totalToolExecs = sumValues(toolExec);
  const toolErrors = sumValues(toolExec, l => l.outcome === 'error');
  const toolP95 = histP95(toolDuration);
  const totalDeliveries = sumValues(msgDelivery);
  const deliveryErrors = sumValues(msgDelivery, l => l.outcome === 'error');
  const totalMsgProcessed = sumValues(msgProcessed);
  const rssBytes = gaugeLatest(memBytes, l => l.kind === 'rss');
  const heapUsed = gaugeLatest(memBytes, l => l.kind === 'heap_used');
  const heapTotal = gaugeLatest(memBytes, l => l.kind === 'heap_total');
  const pressureEvents = sumValues(memPressure);
  const dropped = sumValues(droppedSeries);

  // Per-model breakdown
  const modelBreakdown = useMemo(() => {
    if (!modelCall) return [];
    const grouped = groupBy(
      modelCall.values.filter(v => !v.suffix),
      v => v.labels.model || 'unknown',
    );
    return Object.entries(grouped)
      .map(([model, vals]) => ({ model, total: vals.reduce((s, v) => s + v.value, 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [modelCall]);

  // Per-tool breakdown
  const toolBreakdown = useMemo(() => {
    if (!toolExec) return [];
    const grouped = groupBy(
      toolExec.values.filter(v => !v.suffix),
      v => v.labels.tool || 'unknown',
    );
    return Object.entries(grouped)
      .map(([tool, vals]) => ({ tool, total: vals.reduce((s, v) => s + v.value, 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [toolExec]);

  // Per-channel delivery
  const channelBreakdown = useMemo(() => {
    if (!msgDelivery) return [];
    const grouped = groupBy(
      msgDelivery.values.filter(v => !v.suffix),
      v => v.labels.channel || 'unknown',
    );
    return Object.entries(grouped)
      .map(([channel, vals]) => ({
        channel,
        total: vals.reduce((s, v) => s + v.value, 0),
        errors: vals.filter(v => v.labels.outcome === 'error').reduce((s, v) => s + v.value, 0),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [msgDelivery]);

  // Queue lanes
  const queueLanes = useMemo(() => {
    if (!queueLane) return [];
    return queueLane.values
      .filter(v => !v.suffix)
      .map(v => ({ lane: v.labels.lane || 'default', size: v.value }))
      .sort((a, b) => b.size - a.size);
  }, [queueLane]);


  // ── Render ───────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="material-symbols-outlined animate-spin text-2xl text-text-muted">progress_activity</span>
      </div>
    );
  }

  if (error && !data) {
    const is404 = error.includes('404');
    const versionMatch = error.match(/^version_too_low:(.+):(.+)$/);
    if (versionMatch) {
      const [, curVer, minVer] = versionMatch;
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-text-secondary max-w-md mx-auto text-center">
          <span className="material-symbols-outlined text-4xl" style={{ color: 'var(--color-warning)' }}>upgrade</span>
          <p className="text-sm font-medium text-text">{ob.versionTooLow || 'OpenClaw version too low'}</p>
          <p className="text-xs text-text-muted">
            {(ob.versionTooLowHint || 'Live Metrics requires OpenClaw ≥ {{min}}. Current: {{cur}}.')
              .replace('{{min}}', minVer).replace('{{cur}}', curVer)}
          </p>
          <code className="text-xs bg-surface-sunken px-3 py-1.5 rounded-lg font-mono select-all">npm update -g openclaw</code>
          <button
            className="px-4 py-1.5 rounded-lg bg-surface-raised hover:bg-surface-overlay text-text text-sm font-medium transition-colors"
            onClick={() => { setLoading(true); setError(null); fetchMetrics(true); }}
          >
            {ob.retry || 'Retry'}
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-secondary max-w-md mx-auto text-center">
        <span className="material-symbols-outlined text-4xl" style={{ color: is404 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
          {is404 ? 'extension_off' : 'error'}
        </span>
        {is404 ? (
          <>
            <p className="text-sm font-medium text-text">{ob.pluginNotEnabled || 'Prometheus plugin not enabled'}</p>
            <p className="text-xs text-text-muted">{ob.pluginNotEnabledHint || 'Enable the diagnostics-prometheus plugin in OpenClaw to activate live metrics.'}</p>
            <button
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-primary/90 hover:bg-primary text-white text-sm font-medium transition-colors disabled:opacity-60 flex items-center gap-1.5"
              onClick={async () => {
                setLoading(true);
                setError(null);
                try {
                  const res = await observabilityApi.enablePlugin();
                  if (res?.version_too_low) {
                    setError(`version_too_low:${res.current_version || '?'}:${res.min_version || '2026.4.25'}`);
                    setLoading(false);
                    return;
                  }
                  // If metrics are already available, just fetch directly
                  if (res?.already_enabled && res?.metrics_available) {
                    fetchMetrics(true);
                    return;
                  }
                  if (res?.restart_required && !res?.restart_triggered) {
                    setError(ob.restartRequired || 'Plugin enabled. Restart the OpenClaw gateway, then retry.');
                    setLoading(false);
                    return;
                  }
                  // Poll until the plugin is loaded and metrics are available
                  for (let i = 0; i < 45; i++) {
                    await new Promise(r => setTimeout(r, 2000));
                    try {
                      const m = await observabilityApi.metricsJsonCached(0, true);
                      if (m) { setData(m); setError(null); setLoading(false); return; }
                    } catch { /* plugin not ready yet, keep polling */ }
                  }
                  // Exhausted retries — do one final fetch to show the real error
                  fetchMetrics(true);
                } catch (e: any) {
                  setError(e?.message || 'Failed to enable plugin');
                  setLoading(false);
                }
              }}
            >
              {loading && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
              {loading ? (ob.enablingPlugin || 'Enabling...') : (ob.enablePlugin || 'Enable Plugin')}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm">{error}</p>
            <button
              className="px-4 py-1.5 rounded-lg bg-surface-raised hover:bg-surface-overlay text-text text-sm font-medium transition-colors"
              onClick={() => { setLoading(true); fetchMetrics(true); }}
            >
              {ob.retry || 'Retry'}
            </button>
          </>
        )}
      </div>
    );
  }

  const maxModelCalls = Math.max(...modelBreakdown.map(m => m.total), 1);
  const maxToolExecs = Math.max(...toolBreakdown.map(t => t.total), 1);
  const maxChannelTotal = Math.max(...channelBreakdown.map(c => c.total), 1);

  return (
    <div className="h-full overflow-y-auto neon-scrollbar p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-xl text-info">monitoring</span>
          <h2 className="text-base font-bold text-text">{ob.title || 'Observability'}</h2>
          {dropped > 0 && (
            <span className="text-[10px] text-warning font-medium px-1.5 py-0.5 rounded bg-warning/10">
              {ob.droppedSeries?.replace('{{n}}', String(dropped)) || `${dropped} series dropped`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
              className="accent-info w-3.5 h-3.5"
            />
            {ob.autoRefresh || 'Auto-refresh'}
          </label>
          <button
            onClick={() => fetchMetrics(true)}
            className="p-1 rounded-md hover:bg-surface-raised transition-colors text-text-secondary hover:text-text"
            title={ob.refresh || 'Refresh'}
          >
            <span className="material-symbols-outlined text-base">refresh</span>
          </button>
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon="token" title={ob.totalTokens || 'Total Tokens'} value={fmtNum(totalInputTokens + totalOutputTokens)} sub={`↑${fmtNum(totalInputTokens)} ↓${fmtNum(totalOutputTokens)}`} color="#3b82f6" />
        <StatCard icon="payments" title={ob.totalCost || 'Total Cost'} value={totalCost > 0 ? '$' + totalCost.toFixed(4) : '$0'} color="#8b5cf6" />
        <StatCard icon="speed" title={ob.modelP95 || 'Model p95 Latency'} value={fmtMs(modelP95)} sub={`${fmtNum(totalModelCalls)} ${ob.calls || 'calls'}`} color="#f59e0b" />
        <StatCard icon="memory" title={ob.rssMemory || 'RSS Memory'} value={fmtBytes(rssBytes)} sub={pressureEvents > 0 ? `${fmtNum(pressureEvents)} ${ob.pressureEvents || 'pressure events'}` : undefined} color="#10b981" />
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

        {/* 1. Token & Cost */}
        <div className="sci-card p-4 space-y-3">
          <SectionHeader icon="token" title={ob.tokenCost || 'Token & Cost'} />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.inputTokens || 'Input'}</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtNum(totalInputTokens)}</p>
            </div>
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.outputTokens || 'Output'}</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtNum(totalOutputTokens)}</p>
            </div>
          </div>
          {costUsage && costUsage.values.filter(v => !v.suffix).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-text-muted font-medium">{ob.costByModel || 'Cost by model'}</p>
              {costUsage.values
                .filter(v => !v.suffix && v.value > 0)
                .sort((a, b) => b.value - a.value)
                .slice(0, 6)
                .map((v, i) => (
                  <MetricBar key={i} label={v.labels.model || '?'} value={v.value} max={totalCost || 1} color="#8b5cf6" />
                ))}
            </div>
          )}
        </div>

        {/* 2. Model Latency */}
        <div className="sci-card p-4 space-y-3">
          <SectionHeader icon="speed" title={ob.modelLatency || 'Model Latency'} />
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.totalCalls || 'Total Calls'}</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtNum(totalModelCalls)}</p>
            </div>
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.errors || 'Errors'}</p>
              <p className={`text-base font-bold tabular-nums ${modelCallErrors > 0 ? 'text-danger' : 'text-text'}`}>{fmtNum(modelCallErrors)}</p>
            </div>
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">p95</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtMs(modelP95)}</p>
            </div>
          </div>
          {modelBreakdown.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-text-muted font-medium">{ob.callsByModel || 'Calls by model'}</p>
              {modelBreakdown.map((m, i) => (
                <MetricBar key={i} label={m.model} value={m.total} max={maxModelCalls} color="#3b82f6" />
              ))}
            </div>
          )}
        </div>

        {/* 3. Tool Performance */}
        <div className="sci-card p-4 space-y-3">
          <SectionHeader icon="build" title={ob.toolPerf || 'Tool Performance'} />
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.executions || 'Executions'}</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtNum(totalToolExecs)}</p>
            </div>
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.errors || 'Errors'}</p>
              <p className={`text-base font-bold tabular-nums ${toolErrors > 0 ? 'text-danger' : 'text-text'}`}>{fmtNum(toolErrors)}</p>
            </div>
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">p95</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtMs(toolP95)}</p>
            </div>
          </div>
          {toolBreakdown.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-text-muted font-medium">{ob.execByTool || 'Executions by tool'}</p>
              {toolBreakdown.map((t, i) => (
                <MetricBar key={i} label={t.tool} value={t.total} max={maxToolExecs} color="#14b8a6" />
              ))}
            </div>
          )}
        </div>

        {/* 4. Channel Delivery */}
        <div className="sci-card p-4 space-y-3">
          <SectionHeader icon="send" title={ob.channelDelivery || 'Channel Delivery'} />
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.delivered || 'Delivered'}</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtNum(totalDeliveries)}</p>
            </div>
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.errors || 'Errors'}</p>
              <p className={`text-base font-bold tabular-nums ${deliveryErrors > 0 ? 'text-danger' : 'text-text'}`}>{fmtNum(deliveryErrors)}</p>
            </div>
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.processed || 'Processed'}</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtNum(totalMsgProcessed)}</p>
            </div>
          </div>
          {channelBreakdown.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-text-muted font-medium">{ob.byChannel || 'By channel'}</p>
              {channelBreakdown.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-28 truncate text-text-secondary font-medium">{c.channel}</span>
                  <div className="flex-1 h-2 rounded-full bg-surface-sunken overflow-hidden relative">
                    <div className="h-full rounded-full transition-all duration-500 bg-info" style={{ width: `${(c.total / maxChannelTotal) * 100}%` }} />
                    {c.errors > 0 && (
                      <div className="absolute top-0 end-0 h-full rounded-full bg-danger" style={{ width: `${(c.errors / maxChannelTotal) * 100}%` }} />
                    )}
                  </div>
                  <span className="w-16 text-end tabular-nums text-text font-mono">{fmtNum(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 5. Queue & Sessions */}
        <div className="sci-card p-4 space-y-3">
          <SectionHeader icon="queue" title={ob.queueSessions || 'Queue & Sessions'} />
          {queueLanes.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-[11px] text-text-muted font-medium">{ob.queueLanes || 'Queue Lanes'}</p>
              {queueLanes.map((q, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-surface-sunken last:border-0">
                  <span className="text-text-secondary font-medium">{q.lane}</span>
                  <span className={`tabular-nums font-bold ${q.size > 10 ? 'text-warning' : 'text-text'}`}>{q.size}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">{ob.noQueueData || 'No queue data'}</p>
          )}
          {sessionState && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-text-muted font-medium">{ob.sessionStates || 'Session States'}</p>
              {sessionState.values
                .filter(v => !v.suffix)
                .map((v, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-surface-sunken last:border-0">
                    <span className="text-text-secondary font-medium">{v.labels.state || '?'}</span>
                    <span className="tabular-nums font-bold text-text">{fmtNum(v.value)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* 6. Memory Pressure */}
        <div className="sci-card p-4 space-y-3">
          <SectionHeader icon="memory" title={ob.memoryPressure || 'Memory'} />
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">RSS</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtBytes(rssBytes)}</p>
            </div>
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.heapUsed || 'Heap Used'}</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtBytes(heapUsed)}</p>
            </div>
            <div className="bg-surface-sunken rounded-lg p-2">
              <p className="text-text-muted">{ob.heapTotal || 'Heap Total'}</p>
              <p className="text-base font-bold text-text tabular-nums">{fmtBytes(heapTotal)}</p>
            </div>
          </div>
          {heapTotal > 0 && (
            <div>
              <div className="flex justify-between text-[11px] text-text-muted mb-1">
                <span>{ob.heapUsage || 'Heap Usage'}</span>
                <span>{((heapUsed / heapTotal) * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, (heapUsed / heapTotal) * 100)}%`,
                    backgroundColor: heapUsed / heapTotal > 0.9 ? '#ef4444' : heapUsed / heapTotal > 0.7 ? '#f59e0b' : '#10b981',
                  }}
                />
              </div>
            </div>
          )}
          {pressureEvents > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-warning">
              <span className="material-symbols-outlined text-sm">warning</span>
              {ob.pressureCount?.replace('{{n}}', String(pressureEvents)) || `${pressureEvents} pressure events`}
            </div>
          )}
          {memPressure && memPressure.values.filter(v => !v.suffix).length > 0 && (
            <div className="space-y-1">
              {memPressure.values.filter(v => !v.suffix).map((v, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-0.5">
                  <span className="text-text-secondary">{v.labels.level} — {v.labels.reason}</span>
                  <span className="tabular-nums font-bold text-warning">{fmtNum(v.value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Scrape Config */}
      {scrapeConfig && (
        <ScrapeConfigSection
          config={scrapeConfig}
          ob={ob}
          toast={toast}
        />
      )}

      {/* Raw metrics toggle */}
      <RawMetricsSection raw={data?.raw || ''} label={ob.rawMetrics || 'Raw Prometheus Metrics'} />
    </div>
  );
};

function CopyableField({ label, value, toast, copiedLabel }: { label: string; value: string; toast: (type: string, msg: string) => void; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      toast('success', copiedLabel);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value, toast, copiedLabel]);
  return (
    <div>
      <p className="text-text-muted mb-1">{label}</p>
      <div className="flex items-center gap-1 bg-surface-sunken rounded-lg p-2 group">
        <code className="flex-1 font-mono text-text break-all select-all min-w-0">{value}</code>
        <button
          onClick={handleCopy}
          className="shrink-0 p-0.5 rounded text-text-muted hover:text-text opacity-0 group-hover:opacity-100 transition-opacity"
          title={label}
        >
          <span className="material-symbols-outlined text-sm">{copied ? 'check' : 'content_copy'}</span>
        </button>
      </div>
    </div>
  );
}

function ScrapeConfigSection({ config, ob, toast }: { config: PromScrapeConfig; ob: any; toast: (type: string, msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedLabel = ob.copied || 'Copied!';

  const handleCopyYaml = useCallback(() => {
    navigator.clipboard.writeText(config.yamlSnippet).then(() => {
      setCopied(true);
      toast('success', copiedLabel);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [config.yamlSnippet, toast, copiedLabel]);

  return (
    <div className="sci-card p-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-sm font-bold text-text hover:text-info transition-colors w-full text-start"
      >
        <span className="material-symbols-outlined text-base text-text-secondary">{open ? 'expand_less' : 'expand_more'}</span>
        <span className="material-symbols-outlined text-base text-text-secondary">integration_instructions</span>
        {ob.scrapeConfig || 'Prometheus Scrape Config'}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <CopyableField label={ob.scrapeUrl || 'Scrape URL'} value={config.scrapeUrl} toast={toast} copiedLabel={copiedLabel} />
            <CopyableField label={ob.metricsPath || 'Metrics Path'} value={config.metricsPath} toast={toast} copiedLabel={copiedLabel} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-text-muted">{ob.yamlSnippet || 'prometheus.yml snippet'}</p>
              <button
                onClick={handleCopyYaml}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-text-secondary hover:text-text hover:bg-surface-raised transition-colors"
              >
                <span className="material-symbols-outlined text-sm">{copied ? 'check' : 'content_copy'}</span>
                {copied ? (ob.copied || 'Copied') : (ob.copy || 'Copy')}
              </button>
            </div>
            <pre className="bg-surface-sunken rounded-lg p-3 font-mono text-xs text-text overflow-x-auto neon-scrollbar whitespace-pre select-all">{config.yamlSnippet}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function RawMetricsSection({ raw, label }: { raw: string; label: string }) {
  const [open, setOpen] = useState(false);
  if (!raw) return null;
  return (
    <div className="sci-card p-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-sm font-bold text-text hover:text-info transition-colors w-full text-start"
      >
        <span className="material-symbols-outlined text-base text-text-secondary">{open ? 'expand_less' : 'expand_more'}</span>
        {label}
        <span className="text-[10px] text-text-muted font-normal ms-1">{raw.split('\n').length} {open ? '' : 'lines'}</span>
      </button>
      {open && (
        <pre className="mt-2 bg-surface-sunken rounded-lg p-3 font-mono text-[11px] text-text overflow-auto neon-scrollbar max-h-96 whitespace-pre">{raw}</pre>
      )}
    </div>
  );
}

export default Observability;
