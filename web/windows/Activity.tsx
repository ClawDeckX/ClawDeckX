
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi } from '../services/api';
import { useToast } from '../components/Toast';
import CustomSelect from '../components/CustomSelect';

interface ActivityProps { language: Language; }

const THINK_LEVELS = ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const VERBOSE_VALUES = ['', 'off', 'on', 'full'];
const REASONING_LEVELS = ['', 'off', 'on', 'stream'];

// i18n-aware relative time formatting
function fmtRelative(ms?: number | null, a?: any) {
  if (!ms || !Number.isFinite(ms)) return '-';
  const diff = Date.now() - ms;
  if (diff < 60_000) return a?.justNow;
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} ${a?.minutesAgo}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${a?.hoursAgo}`;
  return `${Math.round(hrs / 24)} ${a?.daysAgo}`;
}

function fmtTokens(row: any) {
  const t = row.totalTokens || ((row.inputTokens || 0) + (row.outputTokens || 0));
  if (!t) return '-';
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
  if (t >= 1_000) return `${(t / 1_000).toFixed(1)}K`;
  return String(t);
}

const KIND_COLORS: Record<string, string> = {
  direct: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  group: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  global: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  unknown: 'bg-slate-500/10 text-slate-500',
};

const Activity: React.FC<ActivityProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const a = (t as any).act as any;
  const { toast } = useToast();

  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');

  const loadSessions = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await gwApi.sessions();
      setResult(data);
    } catch (e: any) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearchKeyword(searchInput.trim().toLowerCase()), 140);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { loadSessions(); });
    return () => cancelAnimationFrame(raf);
  }, [loadSessions]);

  const sessions: any[] = result?.sessions || [];
  const storePath = result?.path || '';

  const filtered = useMemo(() => {
    let list = sessions;
    if (kindFilter) list = list.filter((s: any) => s.kind === kindFilter);
    if (searchKeyword) {
      const q = searchKeyword;
      list = list.filter((s: any) =>
        (s.key || '').toLowerCase().includes(q) ||
        (s.label || '').toLowerCase().includes(q) ||
        (s.displayName || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [sessions, kindFilter, searchKeyword]);

  const renderedSessions = useMemo(() => filtered.slice(0, 260), [filtered]);
  const omittedSessions = Math.max(0, filtered.length - renderedSessions.length);

  const selected = selectedKey ? sessions.find((s: any) => s.key === selectedKey) : null;

  const selectSession = useCallback((key: string) => {
    setSelectedKey(key);
    setDrawerOpen(false);
    setPreview(null);
    setPreviewLoading(true);
    gwApi.proxy('sessions.preview', { keys: [key], limit: 20, maxChars: 500 })
      .then(setPreview)
      .catch(() => { })
      .finally(() => setPreviewLoading(false));
  }, []);

  const patchSession = useCallback(async (key: string, patch: any) => {
    if (busy) return;
    setBusy(true);
    try { 
      await gwApi.sessionsPatch(key, patch); 
      await loadSessions(); 
      toast('success', a.patchOk);
    }
    catch (e: any) { 
      setError(String(e)); 
      toast('error', String(e));
    }
    setBusy(false);
  }, [busy, loadSessions, toast, a]);

  const resetSession = useCallback(async (key: string) => {
    if (busy) return;
    if (!confirm(a.confirmReset)) return;
    setBusy(true);
    try { 
      await gwApi.proxy('sessions.reset', { key }); 
      await loadSessions(); 
      toast('success', a.resetOk);
    }
    catch (e: any) { 
      setError(String(e)); 
      toast('error', String(e));
    }
    setBusy(false);
  }, [busy, loadSessions, toast, a]);

  const deleteSession = useCallback(async (key: string) => {
    if (busy) return;
    if (!confirm(a.confirmDelete)) return;
    setBusy(true);
    try {
      await gwApi.proxy('sessions.delete', { key, deleteTranscript: true });
      if (selectedKey === key) { setSelectedKey(null); setPreview(null); }
      await loadSessions();
      toast('success', a.deleteOk);
    } catch (e: any) { 
      setError(String(e)); 
      toast('error', String(e));
    }
    setBusy(false);
  }, [busy, selectedKey, loadSessions, toast, a]);

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    sessions.forEach((s: any) => { counts[s.kind] = (counts[s.kind] || 0) + 1; });
    return counts;
  }, [sessions]);

  const previewMessages: any[] = preview?.previews?.[0]?.messages || [];

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-50/50 dark:bg-transparent">
      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="md:hidden fixed top-[32px] bottom-[72px] left-0 right-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Left: Session List — desktop: static, mobile: slide-out drawer */}
      <div className={`fixed md:static top-[32px] bottom-[72px] md:top-auto md:bottom-auto left-0 z-50 w-72 md:w-80 lg:w-96 shrink-0 border-r border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-[#1a1c22] md:dark:bg-white/[0.02] flex flex-col transform transition-transform duration-200 ease-out ${drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* Header */}
        <div className="p-3 border-b border-slate-200/60 dark:border-white/[0.06]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex-1 min-w-0">
              <h2 className="text-xs font-bold text-slate-700 dark:text-white/80">{a.title}</h2>
              <p className="text-[10px] text-slate-400 dark:text-white/35 truncate" title={a.activityHelp}>
                {sessions.length} {a.sessions}{storePath ? ` · ${storePath}` : ''}
              </p>
            </div>
            <button onClick={loadSessions} disabled={loading} className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40 shrink-0" title={a.refresh}>
              <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
            </button>
          </div>
          {/* Search + Filter */}
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]">search</span>
              <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder={a.search}
                className="w-full h-7 pl-7 pr-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
            </div>
            <CustomSelect value={kindFilter} onChange={v => setKindFilter(v)}
              options={[{ value: '', label: `${a.all} (${sessions.length})` }, ...['direct', 'group', 'global', 'unknown'].filter(k => kindCounts[k]).map(k => ({ value: k, label: `${(a as any)[k] || k} (${kindCounts[k]})` }))]}
              className="h-7 px-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-600 dark:text-white/50" />
          </div>
        </div>

        {error && <div className="mx-3 mt-2 px-2 py-1.5 rounded-lg bg-mac-red/10 border border-mac-red/20 text-[11px] text-mac-red">{error}</div>}

        {/* Session List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-3xl mb-2">forum</span>
              <p className="text-[11px] font-bold mb-1">{a.noSessions}</p>
              <p className="text-[10px] text-center px-4">{a.noSessionsHint}</p>
            </div>
          ) : renderedSessions.map((row: any) => {
            const isSelected = row.key === selectedKey;
            const displayName = row.displayName?.trim() || row.label?.trim() || '';
            return (
              <button key={row.key} onClick={() => selectSession(row.key)}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-100/60 dark:border-white/[0.03] transition-all ${isSelected ? 'bg-primary/[0.06]' : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${KIND_COLORS[row.kind] || KIND_COLORS.unknown}`}>{row.kind}</span>
                  <p className={`text-[10px] font-mono truncate flex-1 ${isSelected ? 'text-primary font-bold' : 'text-slate-600 dark:text-white/50'}`}>{row.key}</p>
                </div>
                {displayName && <p className="text-[11px] text-slate-400 dark:text-white/35 truncate">{displayName}</p>}
                <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400 dark:text-white/20">
                  <span>{fmtRelative(row.updatedAt, a)}</span>
                  <span>{fmtTokens(row)} {a.tok}</span>
                  {row.model && <span className="truncate">{row.model}</span>}
                </div>
              </button>
            );
          })}
          {omittedSessions > 0 && (
            <div className="px-3 py-2 text-[10px] text-center text-slate-400 dark:text-white/30 border-t border-slate-100/60 dark:border-white/[0.03]">
              +{omittedSessions}
            </div>
          )}
        </div>
      </div>

      {/* Right: Detail Panel */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Mobile hamburger for empty state */}
            <div className="md:hidden flex items-center px-4 pt-3 pb-1 shrink-0">
              <button onClick={() => setDrawerOpen(true)} className="p-1.5 -ml-1 rounded-lg text-slate-500 dark:text-white/50 hover:text-primary hover:bg-primary/5 transition-all">
                <span className="material-symbols-outlined text-[20px]">menu</span>
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-slate-400 dark:text-white/30 px-4">
                <span className="material-symbols-outlined text-5xl mb-3">forum</span>
                <p className="text-sm font-bold mb-1">{a.selectSession}</p>
                <p className="text-[11px]">{a.selectSessionHint}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-5">
            <div className="max-w-4xl space-y-4">
              {/* Session Header */}
              <div className="flex items-start justify-between gap-2">
                {/* Mobile hamburger */}
                <button onClick={() => setDrawerOpen(true)} className="md:hidden p-1.5 -ml-1 mt-0.5 rounded-lg text-slate-500 dark:text-white/50 hover:text-primary hover:bg-primary/5 transition-all shrink-0">
                  <span className="material-symbols-outlined text-[20px]">menu</span>
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${KIND_COLORS[selected.kind] || KIND_COLORS.unknown}`}>{selected.kind}</span>
                    <h2 className="text-sm font-bold text-slate-800 dark:text-white font-mono truncate">{selected.key}</h2>
                  </div>
                  {(selected.displayName || selected.label) && (
                    <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5">{selected.displayName || selected.label}</p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => resetSession(selected.key)} disabled={busy}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-primary disabled:opacity-30">{a.reset}</button>
                  <button onClick={() => deleteSession(selected.key)} disabled={busy}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-mac-red/10 text-mac-red disabled:opacity-30">{a.delete}</button>
                </div>
              </div>

              {/* Session Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: a.updated, value: selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '-', icon: 'schedule' },
                  { label: a.tokens, value: `${fmtTokens(selected)} (${selected.inputTokens || 0}/${selected.outputTokens || 0})`, icon: 'token' },
                  { label: a.model, value: selected.model || '-', icon: 'smart_toy' },
                  { label: a.context, value: selected.contextTokens ? `${(selected.contextTokens / 1000).toFixed(0)}K` : '-', icon: 'memory' },
                ].map(kv => (
                  <div key={kv.label} className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-white/40">{kv.icon}</span>
                      <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{kv.label}</span>
                    </div>
                    <p className="text-[10px] font-semibold text-slate-700 dark:text-white/70 font-mono truncate">{kv.value}</p>
                  </div>
                ))}
              </div>

              {/* Per-Session Overrides */}
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
                <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1">{a.label} & {a.overrides}</h3>
                <p className="text-[10px] text-slate-400 dark:text-white/30 mb-3">{a.overridesHelp}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {/* Label */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{a.label}</span>
                    <input defaultValue={selected.label || ''} disabled={busy}
                      onBlur={e => { const v = e.target.value.trim(); if (v !== (selected.label || '')) patchSession(selected.key, { label: v || null }); }}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                  </label>
                  {/* Thinking */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{a.thinking}</span>
                    <CustomSelect value={selected.thinkingLevel || ''} disabled={busy}
                      onChange={v => patchSession(selected.key, { thinkingLevel: v || null })}
                      options={THINK_LEVELS.map(lv => ({ value: lv, label: lv ? (a[lv] || lv) : a.inherit }))}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                  </label>
                  {/* Verbose */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{a.verbose}</span>
                    <CustomSelect value={selected.verboseLevel || ''} disabled={busy}
                      onChange={v => patchSession(selected.key, { verboseLevel: v || null })}
                      options={VERBOSE_VALUES.map(lv => ({ value: lv, label: lv ? (a[lv] || lv) : a.inherit }))}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                  </label>
                  {/* Reasoning */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{a.reasoning}</span>
                    <CustomSelect value={selected.reasoningLevel || ''} disabled={busy}
                      onChange={v => patchSession(selected.key, { reasoningLevel: v || null })}
                      options={REASONING_LEVELS.map(lv => ({ value: lv, label: lv ? (a[lv] || lv) : a.inherit }))}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                  </label>
                </div>
              </div>

              {/* Message Preview */}
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px] text-primary">chat</span>
                    {a.messages}
                  </h3>
                  <button onClick={() => selectSession(selected.key)} disabled={previewLoading}
                    className="text-[10px] text-primary hover:underline">{a.refresh}</button>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-white/30 mb-3">{a.messagesHelp}</p>
                {previewLoading ? (
                  <p className="text-[10px] text-slate-400 dark:text-white/20 py-6 text-center">{a.loading}</p>
                ) : previewMessages.length === 0 ? (
                  <p className="text-[10px] text-slate-400 dark:text-white/20 py-6 text-center">{a.noMessages}</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
                    {previewMessages.map((msg: any, i: number) => {
                      const role = msg.role || 'unknown';
                      const isUser = role === 'user';
                      const isAssistant = role === 'assistant';
                      const isTool = role === 'tool';
                      return (
                        <div key={i} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${isUser ? 'bg-primary/10 text-primary' :
                              isAssistant ? 'bg-mac-green/10 text-mac-green' :
                                isTool ? 'bg-purple-500/10 text-purple-500' :
                                  'bg-slate-100 dark:bg-white/5 text-slate-400'
                            }`}>
                            <span className="material-symbols-outlined text-[12px]">
                              {isUser ? 'person' : isAssistant ? 'smart_toy' : isTool ? 'build' : 'settings'}
                            </span>
                          </div>
                          <div className={`flex-1 min-w-0 rounded-xl px-3 py-2 ${isUser ? 'bg-primary/[0.06] border border-primary/10' :
                              'bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5'
                            }`}>
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase">{role}</span>
                              {msg.model && <span className="text-[10px] text-slate-300 dark:text-white/15 font-mono">{msg.model}</span>}
                            </div>
                            <p className="text-[10px] text-slate-600 dark:text-white/50 whitespace-pre-wrap break-words line-clamp-6">{msg.content || msg.text || a.empty}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Extra Info */}
              {(selected.surface || selected.subject || selected.room || selected.space) && (
                <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
                  <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-2">{a.metadata}</h3>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    {selected.surface && <div><span className="text-slate-400 dark:text-white/35">{a.surface}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.surface}</span></div>}
                    {selected.subject && <div><span className="text-slate-400 dark:text-white/35">{a.subject}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.subject}</span></div>}
                    {selected.room && <div><span className="text-slate-400 dark:text-white/35">{a.room}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.room}</span></div>}
                    {selected.space && <div><span className="text-slate-400 dark:text-white/35">{a.space}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.space}</span></div>}
                    {selected.modelProvider && <div><span className="text-slate-400 dark:text-white/35">{a.provider}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.modelProvider}</span></div>}
                    {selected.sessionId && <div><span className="text-slate-400 dark:text-white/35">{a.sessionId}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.sessionId}</span></div>}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Activity;
