import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MiniDonut, MiniBarChart, MiniSparkline } from './MiniChart';
import { SecurityPolicyBadges } from './SecurityPolicyBadges';
import type { ExecAsk, ExecHost, ExecSecurity, AskFallback } from '../utils/exec-policy';

/* ── In-memory cache for usage data (avoids re-fetch on session switch) ── */
const CACHE_TTL = 30_000;
const CACHE_MAX = 50;
interface CacheEntry { usage: any; timeseries: any; ts: number; }
const usageCache = new Map<string, CacheEntry>();
function cacheGet(key: string): CacheEntry | null {
  const e = usageCache.get(key);
  if (!e || Date.now() - e.ts > CACHE_TTL) { usageCache.delete(key); return null; }
  return e;
}
function cacheSet(key: string, usage: any, timeseries: any) {
  if (usageCache.size >= CACHE_MAX) {
    const oldest = usageCache.keys().next().value;
    if (oldest !== undefined) usageCache.delete(oldest);
  }
  usageCache.set(key, { usage, timeseries, ts: Date.now() });
}

interface SessionInfo {
  model?: string;
  modelProvider?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  maxContextTokens?: number;
  compacted?: boolean;
  thinkingLevel?: string;
  reasoningLevel?: string;
  verboseLevel?: string;
  sendPolicy?: string;
  fastMode?: boolean;
  messageCount?: number;
  lastLatencyMs?: number | null;
  liveElapsed?: number;
  runPhase?: string;
  kind?: string;
  agentId?: string;
  agentLabel?: string;
  childSessionCount?: number;
  parentSessionKey?: string;
}

interface SecurityInfo {
  toolProfile?: string;
  sandboxMode?: string;
  execSecurity?: string;
  execHost?: string;
  execAsk?: string;
}

interface UsagePanelProps {
  sessionKey: string;
  gwReady: boolean;
  loadUsage: (key: string) => Promise<any>;
  loadTimeseries?: (key: string) => Promise<any>;
  labels: Record<string, string>;
  session?: SessionInfo;
  securityInfo?: SecurityInfo;
  onModelChange?: (model: string | null) => void;
  onNavigateAgent?: () => void;
  loadModels?: () => Promise<{ value: string; label: string }[]>;
}

const fmtTok = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n || 0);
const fmtCost = (n: number) => n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : '$0';
const fmtDuration = (ms: number) => ms >= 86400000 ? `${(ms / 86400000).toFixed(1)}d` : ms >= 3600000 ? `${(ms / 3600000).toFixed(1)}h` : `${(ms / 60000).toFixed(0)}m`;

/* ── Section heading ── */
const SH: React.FC<{ icon: string; title: string; badge?: string | number }> = ({ icon, title, badge }) => (
  <div className="flex items-center justify-between mb-1.5">
    <span className="text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase flex items-center gap-1">
      <span className="material-symbols-outlined text-[11px]">{icon}</span>
      {title}
    </span>
    {badge !== undefined && badge !== null && <span className="text-[10px] font-extrabold text-slate-600 dark:text-white/50 tabular-nums">{badge}</span>}
  </div>
);

/* ── Horizontal bar row ── */
const HBar: React.FC<{ pct: number; label: string; count: string; gradient: string }> = ({ pct, label, count, gradient }) => (
  <div className="flex items-center gap-1.5">
    <div className="flex-1 h-[6px] rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
      <div className={`h-full rounded-full ${gradient} transition-all`} style={{ width: `${pct}%` }} />
    </div>
    <span className="text-[9px] text-slate-400 dark:text-white/25 font-mono truncate max-w-[52px]" title={label}>{label}</span>
    <span className="text-[9px] font-bold tabular-nums shrink-0 text-slate-500 dark:text-white/40">{count}</span>
  </div>
);

/* ── Divider ── */
const Div = () => <div className="border-t border-slate-100/60 dark:border-white/[0.04]" />;

/* ── Metadata chip ── */
const Chip: React.FC<{ icon: string; label: string; value: string; cls?: string }> = ({ icon, label, value, cls }) => (
  <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-md bg-slate-100/60 dark:bg-white/[0.04] ${cls || 'text-slate-500 dark:text-white/35'}`} title={label}>
    <span className="material-symbols-outlined text-[10px]">{icon}</span>
    {value}
  </span>
);

export const UsagePanel: React.FC<UsagePanelProps> = ({ sessionKey, gwReady, loadUsage, loadTimeseries, labels: a, session: s, securityInfo: sec, onModelChange, onNavigateAgent, loadModels }) => {
  const [usage, setUsage] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string }[]>([]);
  const [modelLoading, setModelLoading] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('usage-panel-collapsed') === '1'; } catch { return false; }
  });

  const loadData = useCallback(async (force = false) => {
    if (!gwReady || !sessionKey) return;
    if (!force) {
      const cached = cacheGet(sessionKey);
      if (cached) { setUsage(cached.usage); setTimeseries(cached.timeseries); return; }
    }
    setLoading(true);
    setError(null);
    try {
      const [data, ts] = await Promise.all([
        loadUsage(sessionKey),
        loadTimeseries ? loadTimeseries(sessionKey).catch(() => null) : null,
      ]);
      setUsage(data);
      if (ts) setTimeseries(ts);
      cacheSet(sessionKey, data, ts);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    }
    setLoading(false);
  }, [gwReady, sessionKey, loadUsage, loadTimeseries]);

  useEffect(() => { loadData(); }, [loadData]);

  // Force-refresh if initial load returned null but session is now populated
  const hadNullUsage = useRef(false);
  useEffect(() => {
    if (!usage && !loading && !error && gwReady && sessionKey) hadNullUsage.current = true;
    if (hadNullUsage.current && s?.totalTokens && !usage) {
      hadNullUsage.current = false;
      loadData(true);
    }
  }, [s?.totalTokens, usage, loading, error, gwReady, sessionKey, loadData]);

  useEffect(() => {
    if (!modelPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) setModelPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelPickerOpen]);

  useEffect(() => { setModelPickerOpen(false); setModelOptions([]); setTimeseries(null); }, [sessionKey]);

  const toggle = () => {
    setCollapsed(v => {
      try { localStorage.setItem('usage-panel-collapsed', v ? '0' : '1'); } catch {}
      return !v;
    });
  };

  if (collapsed) {
    return (
      <button onClick={toggle}
        className="w-8 h-full border-s border-slate-200/60 dark:border-white/[0.06] flex items-center justify-center
                   bg-white/50 dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.04] transition">
        <span className="material-symbols-outlined text-[14px] text-slate-400">analytics</span>
      </button>
    );
  }

  const u = usage;
  const tokenSlices = u ? [
    { value: u.input || 0, color: '#3b82f6' },
    { value: u.output || 0, color: '#f59e0b' },
    ...(u.cacheRead ? [{ value: u.cacheRead, color: '#8b5cf6' }] : []),
    ...(u.cacheWrite ? [{ value: u.cacheWrite, color: '#06b6d4' }] : []),
  ].filter(d => d.value > 0) : [];

  const dailyData = u?.dailyBreakdown?.slice(-7) || [];

  // Context usage
  const ctxUsed = s?.totalTokens || 0;
  const ctxMax = s?.maxContextTokens || 0;
  const ctxRemain = ctxMax > 0 ? Math.max(0, ctxMax - ctxUsed) : 0;
  const ctxPct = ctxMax > 0 ? Math.min(100, (ctxUsed / ctxMax) * 100) : 0;
  const ctxBarClr = ctxPct > 90 ? 'bg-red-500' : ctxPct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
  const ctxTxtClr = ctxPct > 90 ? 'text-red-500' : ctxPct > 70 ? 'text-amber-500' : 'text-emerald-500';
  const ctxRemClr = ctxPct > 90 ? 'text-red-400' : ctxPct > 70 ? 'text-amber-400' : 'text-emerald-400';

  // Timeseries sparkline
  const tsPoints = timeseries?.points || [];
  const tsCumTok = tsPoints.length > 1 ? tsPoints.map((p: any) => p.cumulativeTokens || 0) : [];
  const tsCumCost = tsPoints.length > 1 ? tsPoints.map((p: any) => p.cumulativeCost || 0) : [];

  return (
    <div className="w-56 shrink-0 border-s border-slate-200/60 dark:border-white/[0.06]
                    bg-white/50 dark:bg-white/[0.02] flex flex-col overflow-y-auto neon-scrollbar">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100/60 dark:border-white/[0.04] shrink-0">
        <span className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase">{a.usage || 'Usage'}</span>
        <div className="flex items-center gap-1">
          <button onClick={() => loadData(true)} disabled={loading} className="p-0.5 text-slate-400 hover:text-primary transition">
            <span className={`material-symbols-outlined text-[12px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
          </button>
          <button onClick={toggle} className="p-0.5 text-slate-400 hover:text-primary transition">
            <span className="material-symbols-outlined text-[12px]">chevron_right</span>
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">

        {/* ═══ Security / Tool Policy ═══ */}
        {sec && (sec.toolProfile || sec.sandboxMode || sec.execSecurity || sec.execHost || sec.execAsk) && (
          <SecurityPolicyBadges
            policy={{
              toolProfile: sec.toolProfile || 'full',
              execSecurity: (sec.execSecurity || '') as ExecSecurity,
              execHost: (sec.execHost || 'sandbox') as ExecHost,
              execAsk: (sec.execAsk || 'off') as ExecAsk,
              askFallback: '' as AskFallback,
              sandboxMode: sec.sandboxMode || 'Off',
              fsWsOnly: false,
            }}
            labels={a}
            onClick={onNavigateAgent}
            hideAskWhenOff
            hideSandboxWhenOff
          />
        )}

        {/* ═══ Model Picker ═══ */}
        {s?.model && (
          <>
            <Div />
            <div ref={modelPickerRef} className="relative">
              <SH icon="memory" title={a.model || 'Model'} />
              <button type="button" onClick={async () => {
                if (modelPickerOpen) { setModelPickerOpen(false); return; }
                if (loadModels && modelOptions.length === 0) {
                  setModelLoading(true);
                  try { setModelOptions(await loadModels()); } catch { /* ignore */ }
                  setModelLoading(false);
                }
                setModelPickerOpen(true);
              }}
                className="w-full text-start px-2 py-1.5 rounded-lg bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/10
                           hover:from-purple-500/15 hover:to-blue-500/15 hover:border-purple-500/20 transition-all cursor-pointer group">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold text-purple-600 dark:text-purple-400 truncate">{s.model}</div>
                    {s.modelProvider && <div className="text-[10px] text-slate-400 dark:text-white/25 mt-0.5">{s.modelProvider}</div>}
                  </div>
                  <span className={`material-symbols-outlined text-[12px] text-purple-400/50 group-hover:text-purple-400 transition shrink-0 ms-1 ${modelLoading ? 'animate-spin' : ''}`}>
                    {modelLoading ? 'progress_activity' : 'swap_horiz'}
                  </span>
                </div>
              </button>
              {modelPickerOpen && modelOptions.length > 0 && (
                <div className="absolute z-[100] start-0 end-0 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1e2028] shadow-xl shadow-black/10 dark:shadow-black/40 py-1">
                  {modelOptions.map(o => (
                    <button key={o.value} type="button"
                      onClick={() => { onModelChange?.(o.value || null); setModelPickerOpen(false); }}
                      className={`w-full text-start px-3 py-1.5 text-[11px] transition-colors truncate ${
                        o.value === s.model || o.value === `${s.modelProvider}/${s.model}`
                          ? 'text-primary font-bold bg-primary/5 dark:bg-primary/10'
                          : 'text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/[0.06]'
                      }`}
                      title={o.label}>
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══ Context Window ═══ */}
        {ctxUsed > 0 && (
          <>
            <Div />
            <div>
              <SH icon="data_usage" title={a.context || 'Context'} />
              {/* Used / Max */}
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[12px] font-mono tabular-nums font-bold text-slate-700 dark:text-white/80">{fmtTok(ctxUsed)}</span>
                {ctxMax > 0 && <span className="text-[10px] text-slate-400 dark:text-white/25">/ {fmtTok(ctxMax)}</span>}
              </div>
              {/* Progress bar */}
              {ctxMax > 0 && (
                <div className="mb-1.5">
                  <div className="h-2 rounded-full bg-slate-200/60 dark:bg-white/10 overflow-hidden">
                    <div className={`h-full rounded-full ${ctxBarClr} transition-all`} style={{ width: `${ctxPct}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-0.5">
                    <div className="flex items-center gap-1">
                      <span className={`text-[10px] font-bold tabular-nums ${ctxTxtClr}`}>{ctxPct.toFixed(0)}%</span>
                      {s?.compacted && <span className="material-symbols-outlined text-[10px] text-amber-500" title={a.ctxCompacted || 'Compacted'}>compress</span>}
                    </div>
                    <span className={`text-[10px] tabular-nums ${ctxRemClr}`}>{fmtTok(ctxRemain)} {a.remaining || 'left'}</span>
                  </div>
                </div>
              )}
              {/* Input / Output token split */}
              {(s?.inputTokens || s?.outputTokens) ? (
                <div className="grid grid-cols-2 gap-1.5 mt-1">
                  <div className="px-1.5 py-1 rounded-md bg-blue-500/5 border border-blue-500/10">
                    <div className="text-[8px] font-bold text-blue-400 uppercase">{a.input || 'Input'}</div>
                    <div className="text-[11px] font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400">{fmtTok(s.inputTokens || 0)}</div>
                  </div>
                  <div className="px-1.5 py-1 rounded-md bg-amber-500/5 border border-amber-500/10">
                    <div className="text-[8px] font-bold text-amber-400 uppercase">{a.output || 'Output'}</div>
                    <div className="text-[11px] font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">{fmtTok(s.outputTokens || 0)}</div>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}

        {/* ═══ Session Quick Stats ═══ */}
        {(s?.messageCount || s?.thinkingLevel || s?.lastLatencyMs || s?.liveElapsed) ? (
          <>
            <Div />
            <div className="flex items-center flex-wrap gap-1.5">
              {s?.messageCount ? <Chip icon="chat" label={a.messages || 'Messages'} value={`${s.messageCount} msg`} /> : null}
              {s?.thinkingLevel ? <Chip icon="psychology" label={a.thinking || 'Thinking'} value={s.thinkingLevel} cls="text-purple-500 dark:text-purple-400" /> : null}
              {s?.reasoningLevel ? <Chip icon="neurology" label={a.reasoning || 'Reasoning'} value={s.reasoningLevel} cls="text-blue-500 dark:text-blue-400" /> : null}
              {s?.fastMode ? <Chip icon="bolt" label={a.fastMode || 'Fast'} value={a.fastMode || 'Fast'} cls="text-amber-500 dark:text-amber-400" /> : null}
              {s?.verboseLevel ? <Chip icon="subject" label={a.verbose || 'Verbose'} value={s.verboseLevel} /> : null}
              {s?.sendPolicy === 'deny' ? <Chip icon="block" label={a.sendDenied || 'Send denied'} value={a.sendDenied || 'Denied'} cls="text-red-500 dark:text-red-400" /> : null}
              {(s?.childSessionCount ?? 0) > 0 ? <Chip icon="account_tree" label={a.childSessions || 'Sub-sessions'} value={`${s!.childSessionCount}`} cls="text-cyan-500 dark:text-cyan-400" /> : null}
              {(s?.runPhase === 'streaming' || s?.runPhase === 'sending') && s?.liveElapsed ? (
                <Chip icon="timer" label={a.elapsed || 'Elapsed'} value={`${(s.liveElapsed / 1000).toFixed(1)}s`} cls="text-primary" />
              ) : s?.lastLatencyMs && s?.runPhase === 'idle' ? (
                <Chip icon="speed" label={a.lastLatency || 'Latency'} value={`${(s.lastLatencyMs / 1000).toFixed(1)}s`} />
              ) : null}
            </div>
          </>
        ) : null}

        {/* ═══ Cost ═══ */}
        {(u || !loading) && (
          <>
            <Div />
            <div>
              <SH icon="payments" title={a.cost || 'Cost'} />
              <div className="text-lg font-bold text-slate-700 dark:text-white/80 tabular-nums">{fmtCost(u?.totalCost || 0)}</div>
              {u && (u.inputCost > 0 || u.outputCost > 0) && (
                <div className="text-[10px] text-slate-400 dark:text-white/25 space-y-0.5">
                  <div>{a.input || 'In'}: {fmtCost(u.inputCost || 0)} · {a.output || 'Out'}: {fmtCost(u.outputCost || 0)}</div>
                  {(u.cacheReadCost > 0 || u.cacheWriteCost > 0) && (
                    <div>
                      {u.cacheReadCost > 0 ? `${a.cacheRead || 'Cache R'}: ${fmtCost(u.cacheReadCost)}` : ''}
                      {u.cacheReadCost > 0 && u.cacheWriteCost > 0 ? ' · ' : ''}
                      {u.cacheWriteCost > 0 ? `${a.cacheWrite || 'Cache W'}: ${fmtCost(u.cacheWriteCost)}` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══ Token Donut ═══ */}
        {tokenSlices.length > 0 && (
          <div>
            <SH icon="donut_large" title={a.tokens || 'Tokens'} badge={fmtTok(u.totalTokens || (u.input + u.output + (u.cacheRead || 0) + (u.cacheWrite || 0)))} />
            <div className="flex items-center gap-2">
              <MiniDonut size={56} slices={tokenSlices} innerRadius={0.6} />
              <div className="text-[10px] space-y-0.5">
                <div><span className="text-blue-500">●</span> {a.input || 'In'}: {fmtTok(u.input)}</div>
                <div><span className="text-amber-500">●</span> {a.output || 'Out'}: {fmtTok(u.output)}</div>
                {u.cacheRead > 0 && <div><span className="text-purple-500">●</span> {a.cacheRead || 'Cache R'}: {fmtTok(u.cacheRead)}</div>}
                {u.cacheWrite > 0 && <div><span className="text-cyan-500">●</span> {a.cacheWrite || 'Cache W'}: {fmtTok(u.cacheWrite)}</div>}
              </div>
            </div>
          </div>
        )}

        {/* ═══ Cumulative Token Sparkline ═══ */}
        {tsCumTok.length > 1 && (
          <div>
            <SH icon="trending_up" title={a.tokenTrend || 'Token Growth'} />
            <MiniSparkline values={tsCumTok} height={36} color="#3b82f6" />
          </div>
        )}

        {/* ═══ Cumulative Cost Sparkline ═══ */}
        {tsCumCost.length > 1 && tsCumCost[tsCumCost.length - 1] > 0 && (
          <div>
            <SH icon="show_chart" title={a.costTrend || 'Cost Growth'} />
            <MiniSparkline values={tsCumCost} height={36} color="#f59e0b" />
          </div>
        )}

        {/* ═══ Error state ═══ */}
        {error && (
          <div className="flex flex-col items-center gap-2 p-3 text-center rounded-lg bg-red-50/50 dark:bg-red-500/5">
            <span className="material-symbols-outlined text-[16px] text-red-400">error</span>
            <p className="text-[10px] text-red-400">{error}</p>
            <button onClick={() => loadData(true)} className="text-[10px] px-2 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition">
              {a.retry || 'Retry'}
            </button>
          </div>
        )}

        {/* ═══ Messages ═══ */}
        {u?.messageCounts && u.messageCounts.total > 0 && (() => {
          const mc = u.messageCounts;
          return (
            <>
              <Div />
              <div>
                <SH icon="forum" title={a.messages || 'Messages'} badge={mc.total} />
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden flex mb-1">
                  {mc.user > 0 && <div className="h-full bg-blue-400/80" style={{ width: `${(mc.user / mc.total) * 100}%` }} title={`${a.user || 'User'}: ${mc.user}`} />}
                  {mc.assistant > 0 && <div className="h-full bg-emerald-400/80" style={{ width: `${(mc.assistant / mc.total) * 100}%` }} title={`${a.assistant || 'Asst'}: ${mc.assistant}`} />}
                  {mc.toolCalls > 0 && <div className="h-full bg-purple-400/80" style={{ width: `${(mc.toolCalls / mc.total) * 100}%` }} title={`${a.toolCall || 'Tools'}: ${mc.toolCalls}`} />}
                  {mc.toolResults > 0 && <div className="h-full bg-violet-400/60" style={{ width: `${(mc.toolResults / mc.total) * 100}%` }} title={`${a.toolResults || 'Results'}: ${mc.toolResults}`} />}
                  {mc.errors > 0 && <div className="h-full bg-red-400/80" style={{ width: `${(mc.errors / mc.total) * 100}%` }} title={`${a.error || 'Errors'}: ${mc.errors}`} />}
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px]">
                  <span className="text-blue-500">● {a.user || 'User'} {mc.user}</span>
                  <span className="text-emerald-500">● {a.assistant || 'Asst'} {mc.assistant}</span>
                  {mc.toolCalls > 0 && <span className="text-purple-500">● {a.toolCall || 'Tools'} {mc.toolCalls}</span>}
                  {mc.toolResults > 0 && <span className="text-violet-400">● {a.toolResults || 'Results'} {mc.toolResults}</span>}
                  {mc.errors > 0 && <span className="text-red-500">● {a.error || 'Err'} {mc.errors}</span>}
                </div>
              </div>
            </>
          );
        })()}

        {/* ═══ Tool Usage ═══ */}
        {u?.toolUsage && u.toolUsage.totalCalls > 0 && (() => {
          const topTools = (u.toolUsage.tools || []).slice(0, 5);
          const maxCalls = topTools[0]?.count || 1;
          return (
            <>
              <Div />
              <div>
                <SH icon="build" title={a.tools || 'Tools'} badge={`${u.toolUsage.totalCalls} · ${u.toolUsage.uniqueTools} ${a.unique || 'unique'}`} />
                <div className="space-y-1">
                  {topTools.map((t: any, i: number) => (
                    <HBar key={i} pct={(t.count / maxCalls) * 100} label={t.name} count={`${t.count}×`}
                      gradient="bg-gradient-to-r from-purple-500/80 to-violet-400/60" />
                  ))}
                </div>
              </div>
            </>
          );
        })()}

        {/* ═══ Latency ═══ */}
        {u?.latency && u.latency.count > 0 && (() => {
          const { avgMs, p95Ms, minMs, maxMs } = u.latency;
          return (
            <>
              <Div />
              <div>
                <SH icon="speed" title={a.latency || 'Latency'} badge={`avg ${(avgMs / 1000).toFixed(1)}s`} />
                <div className="h-2.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden relative mb-1">
                  {maxMs > 0 && (
                    <>
                      <div className="absolute h-full bg-emerald-400/50 rounded-s-full" style={{ left: `${(minMs / maxMs) * 100}%`, width: `${((avgMs - minMs) / maxMs) * 100}%` }} />
                      <div className="absolute h-full bg-amber-400/50" style={{ left: `${(avgMs / maxMs) * 100}%`, width: `${((p95Ms - avgMs) / maxMs) * 100}%` }} />
                      <div className="absolute h-full bg-red-400/30 rounded-e-full" style={{ left: `${(p95Ms / maxMs) * 100}%`, width: `${((maxMs - p95Ms) / maxMs) * 100}%` }} />
                    </>
                  )}
                </div>
                <div className="flex justify-between text-[9px] text-slate-400 dark:text-white/25 tabular-nums">
                  <span>{(minMs / 1000).toFixed(1)}s</span>
                  <span className="text-amber-500 font-bold">p95 {(p95Ms / 1000).toFixed(1)}s</span>
                  <span>{(maxMs / 1000).toFixed(1)}s</span>
                </div>
              </div>
            </>
          );
        })()}

        {/* ═══ Session Duration ═══ */}
        {u?.firstActivity && u?.lastActivity && (
          <>
            <Div />
            <div>
              <SH icon="schedule" title={a.duration || 'Duration'} badge={u.durationMs > 0 ? fmtDuration(u.durationMs) : undefined} />
              <div className="text-[10px] text-slate-500 dark:text-white/35 space-y-0.5">
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[10px] text-emerald-400">play_arrow</span>
                  <span>{a.firstMsg || 'First'}: <b>{new Date(u.firstActivity).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b></span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[10px] text-blue-400">stop</span>
                  <span>{a.lastMsg || 'Last'}: <b>{new Date(u.lastActivity).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b></span>
                </div>
              </div>
              {/* Activity dates count */}
              {u.activityDates?.length > 0 && (
                <div className="mt-1 text-[9px] text-slate-400 dark:text-white/25">
                  <span className="material-symbols-outlined text-[10px] align-middle me-0.5">calendar_month</span>
                  {u.activityDates.length} {a.activeDays || 'active days'}
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══ 7-Day Trend ═══ */}
        {dailyData.length > 0 && (
          <>
            <Div />
            <div>
              <SH icon="bar_chart" title={a.trend7d || '7-Day Trend'} />
              <MiniBarChart values={dailyData.map((d: any) => d.tokens || 0)} height={48} color="#3b82f6" />
              <div className="flex justify-between text-[8px] text-slate-400/60 dark:text-white/15 mt-0.5 px-1">
                <span>{dailyData[0]?.date?.slice(5)}</span>
                <span>{dailyData[dailyData.length - 1]?.date?.slice(5)}</span>
              </div>
            </div>
          </>
        )}

        {/* ═══ Daily Message Trend ═══ */}
        {u?.dailyMessageCounts?.length > 1 && (
          <div>
            <SH icon="mark_chat_read" title={a.msgTrend || 'Message Trend'} />
            <MiniSparkline values={u.dailyMessageCounts.slice(-7).map((d: any) => d.total || 0)} height={32} color="#22c55e" />
          </div>
        )}

        {/* ═══ Daily Latency Trend ═══ */}
        {u?.dailyLatency?.length > 1 && (
          <div>
            <SH icon="timer" title={a.latencyTrend || 'Latency Trend'} />
            <MiniSparkline values={u.dailyLatency.slice(-7).map((d: any) => d.avgMs || 0)} height={32} color="#f97316" />
          </div>
        )}

        {/* ═══ Model Usage ═══ */}
        {u?.modelUsage?.length > 0 && (() => {
          const topModels = u.modelUsage.slice(0, 5);
          const maxCount = topModels[0]?.count || 1;
          return (
            <>
              <Div />
              <div>
                <SH icon="model_training" title={a.models || 'Models'} />
                <div className="space-y-1">
                  {topModels.map((m: any, i: number) => (
                    <HBar key={i} pct={(m.count / maxCount) * 100}
                      label={m.model || 'unknown'} count={`${m.count}×`}
                      gradient="bg-gradient-to-r from-blue-500/80 to-cyan-400/60" />
                  ))}
                </div>
              </div>
            </>
          );
        })()}

        {/* ═══ Missing Cost Warning ═══ */}
        {u?.missingCostEntries > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/5 border border-amber-500/10 text-[9px] text-amber-500">
            <span className="material-symbols-outlined text-[11px]">warning</span>
            {u.missingCostEntries} {a.missingCost || 'entries without cost data'}
          </div>
        )}

        {/* ═══ Loading skeleton ═══ */}
        {!u && !error && loading && (
          <div className="space-y-3 animate-pulse">
            {/* Model skeleton */}
            <div>
              <div className="h-2.5 w-12 rounded bg-slate-200/60 dark:bg-white/5 mb-1.5" />
              <div className="h-10 rounded-lg bg-slate-100/80 dark:bg-white/[0.03] border border-slate-200/40 dark:border-white/[0.04]" />
            </div>
            <Div />
            {/* Context skeleton */}
            <div>
              <div className="h-2.5 w-14 rounded bg-slate-200/60 dark:bg-white/5 mb-1.5" />
              <div className="h-4 w-16 rounded bg-slate-200/60 dark:bg-white/5 mb-1" />
              <div className="h-2 rounded-full bg-slate-200/60 dark:bg-white/5 mb-1" />
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                <div className="h-8 rounded-md bg-slate-100/80 dark:bg-white/[0.03] border border-slate-200/40 dark:border-white/[0.04]" />
                <div className="h-8 rounded-md bg-slate-100/80 dark:bg-white/[0.03] border border-slate-200/40 dark:border-white/[0.04]" />
              </div>
            </div>
            <Div />
            {/* Stats chips skeleton */}
            <div className="flex flex-wrap gap-1.5">
              <div className="h-5 w-14 rounded-md bg-slate-200/60 dark:bg-white/5" />
              <div className="h-5 w-16 rounded-md bg-slate-200/60 dark:bg-white/5" />
            </div>
            <Div />
            {/* Cost skeleton */}
            <div>
              <div className="h-2.5 w-10 rounded bg-slate-200/60 dark:bg-white/5 mb-1.5" />
              <div className="h-6 w-12 rounded bg-slate-200/60 dark:bg-white/5" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
