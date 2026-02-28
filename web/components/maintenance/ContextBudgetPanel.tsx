import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { contextBudgetApi, ContextBudgetAnalysis, OptimizeResult } from '../../services/api';
import { useToast } from '../Toast';

interface ContextBudgetPanelProps {
  language: Language;
  agentId?: string;
}

function fmtBytes(b?: number): string {
  if (b == null || b === 0) return '0 B';
  if (b < 1024) return `${b} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = b / 1024;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[i]}`;
}

function fmtTokens(t?: number): string {
  if (t == null) return '--';
  if (t < 1000) return String(t);
  if (t < 1000000) return `${(t / 1000).toFixed(1)}K`;
  return `${(t / 1000000).toFixed(2)}M`;
}

const ContextBudgetPanel: React.FC<ContextBudgetPanelProps> = ({ language, agentId }) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const m = (t.maint || {}) as any;
  const { toast } = useToast();

  const [analysis, setAnalysis] = useState<ContextBudgetAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState<string | null>(null);
  const [optimizeAllLoading, setOptimizeAllLoading] = useState(false);
  const [optimizeResults, setOptimizeResults] = useState<OptimizeResult[]>([]);

  const loadAnalysis = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const data = await contextBudgetApi.analyzeCached(agentId, 30000, force);
      setAnalysis(data);
    } catch (err: any) {
      toast('error', err?.message || 'Failed to load analysis');
    } finally {
      setLoading(false);
    }
  }, [agentId, toast]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  const handleOptimize = useCallback(async (fileName: string) => {
    setOptimizing(fileName);
    try {
      const result = await contextBudgetApi.optimize(fileName, agentId);
      setOptimizeResults((prev) => [...prev, result]);
      toast('success', m.ctxOptimizeSuccess);
      loadAnalysis(true);
    } catch (err: any) {
      toast('error', m.ctxOptimizeFailed + ': ' + (err?.message || ''));
    } finally {
      setOptimizing(null);
    }
  }, [agentId, loadAnalysis, m.ctxOptimizeFailed, m.ctxOptimizeSuccess, toast]);

  const handleOptimizeAll = useCallback(async () => {
    setOptimizeAllLoading(true);
    try {
      const result = await contextBudgetApi.optimizeAll(agentId);
      setOptimizeResults(result.results);
      toast('success', `${m.ctxOptimizeSuccess} - 节省 ${fmtTokens(result.totalSaved)} tokens`);
      loadAnalysis(true);
    } catch (err: any) {
      toast('error', m.ctxOptimizeFailed + ': ' + (err?.message || ''));
    } finally {
      setOptimizeAllLoading(false);
    }
  }, [agentId, loadAnalysis, m.ctxOptimizeFailed, m.ctxOptimizeSuccess, toast]);

  const statusColor = (status: string) => {
    if (status === 'ok') return 'text-emerald-500 bg-emerald-500/10';
    if (status === 'warn') return 'text-amber-500 bg-amber-500/10';
    return 'text-red-500 bg-red-500/10';
  };

  const statusText = (status: string) => {
    if (status === 'ok') return m.ctxStatusOk;
    if (status === 'warn') return m.ctxStatusWarn;
    return m.ctxStatusCritical;
  };

  const usageColor = (percentage: number) => {
    if (percentage < 60) return 'bg-emerald-500';
    if (percentage < 80) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-white">{m.ctxTitle}</h3>
          <p className="text-[11px] text-slate-500 dark:text-white/40">{m.ctxDesc}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadAnalysis(true)}
            disabled={loading}
            className="h-8 px-3 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-600 dark:text-white/60 hover:border-primary/30 disabled:opacity-50 flex items-center gap-1.5"
          >
            <span className={`material-symbols-outlined text-[14px] ${loading ? 'animate-spin' : ''}`}>
              {loading ? 'progress_activity' : 'refresh'}
            </span>
          </button>
          <button
            onClick={handleOptimizeAll}
            disabled={optimizeAllLoading || !analysis?.suggestions?.length}
            className="h-8 px-4 rounded-lg text-[11px] font-bold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            <span className={`material-symbols-outlined text-[14px] ${optimizeAllLoading ? 'animate-spin' : ''}`}>
              {optimizeAllLoading ? 'progress_activity' : 'auto_fix_high'}
            </span>
            {optimizeAllLoading ? m.ctxOptimizing : m.ctxOptimizeAll}
          </button>
        </div>
      </div>

      {/* Budget Overview */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">{m.ctxTotalSize}</p>
              <p className="text-lg font-black text-slate-700 dark:text-white/80">{fmtBytes(analysis?.totalSize)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">{m.ctxTotalTokens}</p>
              <p className="text-lg font-black text-slate-700 dark:text-white/80">{fmtTokens(analysis?.totalTokens)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40">{m.ctxBudgetLimit}</p>
              <p className="text-lg font-black text-slate-700 dark:text-white/80">{fmtTokens(analysis?.budgetLimit)}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 rounded text-[10px] font-bold ${statusColor(analysis?.status || 'ok')}`}>
              {statusText(analysis?.status || 'ok')}
            </span>
          </div>
        </div>

        {/* Usage Bar */}
        <div>
          <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-white/40 mb-1">
            <span>{m.ctxUsage}</span>
            <span>{analysis?.usagePercentage?.toFixed(1) || 0}%</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${usageColor(analysis?.usagePercentage || 0)}`}
              style={{ width: `${Math.min(100, analysis?.usagePercentage || 0)}%` }}
            />
          </div>
        </div>
      </div>

      {/* File Ranking */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mb-3">{m.ctxFileRanking}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-slate-100 dark:border-white/5">
                <th className="text-left py-2 px-2 text-slate-400 dark:text-white/40 font-medium">{m.ctxFileName}</th>
                <th className="text-right py-2 px-2 text-slate-400 dark:text-white/40 font-medium">{m.ctxFileSize}</th>
                <th className="text-right py-2 px-2 text-slate-400 dark:text-white/40 font-medium">{m.ctxFileTokens}</th>
                <th className="text-right py-2 px-2 text-slate-400 dark:text-white/40 font-medium">{m.ctxFilePercent}</th>
                <th className="text-center py-2 px-2 text-slate-400 dark:text-white/40 font-medium">{m.ctxFileStatus}</th>
                <th className="text-center py-2 px-2 text-slate-400 dark:text-white/40 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(analysis?.files || []).map((file) => (
                <tr key={file.fileName} className="border-b border-slate-50 dark:border-white/[0.03] last:border-0">
                  <td className="py-2 px-2 font-mono text-slate-700 dark:text-white/70">{file.fileName}</td>
                  <td className="py-2 px-2 text-right text-slate-500 dark:text-white/50">{fmtBytes(file.size)}</td>
                  <td className="py-2 px-2 text-right text-slate-500 dark:text-white/50">{fmtTokens(file.tokenEstimate)}</td>
                  <td className="py-2 px-2 text-right text-slate-500 dark:text-white/50">{file.percentage.toFixed(1)}%</td>
                  <td className="py-2 px-2 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${statusColor(file.status)}`}>
                      {statusText(file.status)}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    {file.status !== 'ok' && (
                      <button
                        onClick={() => handleOptimize(file.fileName)}
                        disabled={optimizing === file.fileName}
                        className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                      >
                        {optimizing === file.fileName ? m.ctxOptimizing : m.ctxOptimize}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Suggestions */}
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] p-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/40 mb-3">{m.ctxSuggestions}</p>
        {(!analysis?.suggestions || analysis.suggestions.length === 0) ? (
          <p className="text-[11px] text-slate-400 dark:text-white/40 text-center py-4">{m.ctxNoSuggestions}</p>
        ) : (
          <div className="space-y-2">
            {analysis.suggestions.map((s, idx) => (
              <div key={idx} className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">{s.file}</p>
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">{s.issue}</p>
                    <p className="text-[10px] text-amber-600/70 dark:text-amber-400/70 mt-1">
                      <span className="font-medium">{m.ctxSuggAction}:</span> {s.action}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] text-amber-600/70 dark:text-amber-400/70">{m.ctxSuggSaving}</p>
                    <p className="text-[11px] font-bold text-amber-700 dark:text-amber-300">{fmtTokens(s.estimatedSaving)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Optimize Results */}
      {optimizeResults.length > 0 && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 p-3">
          <p className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-2">优化结果</p>
          <div className="space-y-2">
            {optimizeResults.map((r, idx) => (
              <div key={idx} className="text-[11px] flex items-center justify-between">
                <span className="font-mono text-emerald-700 dark:text-emerald-300">{r.file}</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  {fmtBytes(r.originalSize)} → {fmtBytes(r.newSize)} (节省 {fmtTokens(r.savedTokens)} tokens)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ContextBudgetPanel;
