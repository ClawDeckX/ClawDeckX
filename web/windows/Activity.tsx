
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi } from '../services/api';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import CustomSelect from '../components/CustomSelect';

interface ActivityProps { language: Language; onNavigateToSession?: (key: string) => void; }

type SortField = 'updated' | 'tokens' | 'name';

const THINK_LEVELS = ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const VERBOSE_VALUES = ['', 'off', 'on', 'full'];
const REASONING_LEVELS = ['', 'off', 'on', 'stream'];
const SEND_POLICIES = ['', 'allow', 'deny'];

const CHANNEL_ICONS: Record<string, string> = {
  telegram: '✈️', discord: '🎮', slack: '💬', signal: '🔒', imessage: '💬',
  whatsapp: '📱', web: '🌐', matrix: '🔗', msteams: '👥', voice: '📞',
};

const AUTO_REFRESH_MS = 30_000;

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

const Activity: React.FC<ActivityProps> = ({ language, onNavigateToSession }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const a = (t as any).act as any;
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);

  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    try { return localStorage.getItem('act_selectedKey'); } catch { return null; }
  });
  const [preview, setPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortField, setSortField] = useState<SortField>('updated');
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number>(0);
  const [previewLimit, setPreviewLimit] = useState(20);
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set());
  const [savedField, setSavedField] = useState<string | null>(null);

  // Persist selectedKey
  useEffect(() => {
    try { if (selectedKey) localStorage.setItem('act_selectedKey', selectedKey); else localStorage.removeItem('act_selectedKey'); } catch {}
  }, [selectedKey]);

  const loadSessions = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await gwApi.sessions();
      setResult(data);
      setLastRefresh(Date.now());
    } catch (e: any) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearchKeyword(searchInput.trim().toLowerCase()), 140);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Initial load
  useEffect(() => {
    const raf = requestAnimationFrame(() => { loadSessions(); });
    return () => cancelAnimationFrame(raf);
  }, [loadSessions]);

  // Auto-refresh every 30s
  useEffect(() => {
    const iv = setInterval(() => { loadSessions(); }, AUTO_REFRESH_MS);
    return () => clearInterval(iv);
  }, [loadSessions]);

  const sessions: any[] = result?.sessions || [];
  const storePath = result?.path || '';

  // KPI stats
  const kpiStats = useMemo(() => {
    let totalTok = 0, totalIn = 0, totalOut = 0, active24h = 0, abortedCount = 0;
    const channelSet = new Set<string>();
    const now = Date.now();
    sessions.forEach((s: any) => {
      totalTok += s.totalTokens || ((s.inputTokens || 0) + (s.outputTokens || 0));
      totalIn += s.inputTokens || 0;
      totalOut += s.outputTokens || 0;
      if (s.updatedAt && (now - s.updatedAt) < 86_400_000) active24h++;
      if (s.abortedLastRun) abortedCount++;
      if (s.lastChannel) channelSet.add(s.lastChannel);
    });
    const avgTok = sessions.length ? Math.round(totalTok / sessions.length) : 0;
    return { totalTok, totalIn, totalOut, active24h, abortedCount, avgTok, channels: channelSet.size };
  }, [sessions]);

  // Filter + sort
  const filtered = useMemo(() => {
    let list = sessions;
    if (kindFilter) list = list.filter((s: any) => s.kind === kindFilter);
    if (searchKeyword) {
      const q = searchKeyword;
      list = list.filter((s: any) =>
        (s.key || '').toLowerCase().includes(q) ||
        (s.label || '').toLowerCase().includes(q) ||
        (s.displayName || '').toLowerCase().includes(q) ||
        (s.model || '').toLowerCase().includes(q) ||
        (s.lastChannel || '').toLowerCase().includes(q)
      );
    }
    // Sort
    list = [...list].sort((a2: any, b2: any) => {
      if (sortField === 'tokens') return ((b2.totalTokens || 0) - (a2.totalTokens || 0));
      if (sortField === 'name') return (a2.key || '').localeCompare(b2.key || '');
      return ((b2.updatedAt || 0) - (a2.updatedAt || 0));
    });
    return list;
  }, [sessions, kindFilter, searchKeyword, sortField]);

  // Time-grouped sessions
  const groupedSessions = useMemo(() => {
    const groups: { label: string; items: any[] }[] = [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 86_400_000;
    const weekStart = todayStart - (now.getDay() * 86_400_000);
    const buckets: Record<string, any[]> = { today: [], yesterday: [], week: [], earlier: [] };
    filtered.forEach((s: any) => {
      const ts = s.updatedAt || 0;
      if (ts >= todayStart) buckets.today.push(s);
      else if (ts >= yesterdayStart) buckets.yesterday.push(s);
      else if (ts >= weekStart) buckets.week.push(s);
      else buckets.earlier.push(s);
    });
    if (buckets.today.length) groups.push({ label: a.groupToday || 'Today', items: buckets.today });
    if (buckets.yesterday.length) groups.push({ label: a.groupYesterday || 'Yesterday', items: buckets.yesterday });
    if (buckets.week.length) groups.push({ label: a.groupThisWeek || 'This Week', items: buckets.week });
    if (buckets.earlier.length) groups.push({ label: a.groupEarlier || 'Earlier', items: buckets.earlier });
    return groups;
  }, [filtered, a]);

  const renderedCount = useMemo(() => filtered.slice(0, 260).length, [filtered]);
  const omittedSessions = Math.max(0, filtered.length - renderedCount);

  const selected = selectedKey ? sessions.find((s: any) => s.key === selectedKey) : null;

  const selectSession = useCallback((key: string) => {
    setSelectedKey(key);
    setDrawerOpen(false);
    setPreview(null);
    setPreviewLoading(true);
    setExpandedMsgs(new Set());
    gwApi.proxy('sessions.preview', { keys: [key], limit: previewLimit, maxChars: 500 })
      .then(setPreview)
      .catch(() => { })
      .finally(() => setPreviewLoading(false));
  }, [previewLimit]);

  // Reload preview when limit changes
  useEffect(() => {
    if (selectedKey) {
      setPreviewLoading(true);
      gwApi.proxy('sessions.preview', { keys: [selectedKey], limit: previewLimit, maxChars: 500 })
        .then(setPreview)
        .catch(() => { })
        .finally(() => setPreviewLoading(false));
    }
  }, [previewLimit, selectedKey]);

  const patchSession = useCallback(async (key: string, patch: any, fieldName?: string) => {
    if (busy) return;
    setBusy(true);
    try { 
      await gwApi.sessionsPatch(key, patch); 
      await loadSessions(); 
      toast('success', a.patchOk);
      if (fieldName) { setSavedField(fieldName); setTimeout(() => setSavedField(null), 1500); }
    }
    catch (e: any) { 
      setError(String(e)); 
      toast('error', String(e));
    }
    setBusy(false);
  }, [busy, loadSessions, toast, a]);

  const resetSession = useCallback(async (key: string) => {
    if (busy) return;
    const ok = await confirm({ title: a.reset, message: a.confirmReset, danger: true, confirmText: a.reset });
    if (!ok) return;
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
  }, [busy, loadSessions, toast, a, confirm]);

  const deleteSession = useCallback(async (key: string) => {
    if (busy) return;
    const isMain = key.endsWith(':main');
    const msg = isMain ? (a.confirmDeleteMain || `${a.confirmDelete} (main)`) : a.confirmDelete;
    const ok = await confirm({ title: a.delete, message: msg, danger: true, confirmText: a.delete });
    if (!ok) return;
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
  }, [busy, selectedKey, loadSessions, toast, a, confirm]);

  const compactSession = useCallback(async (key: string) => {
    if (busy) return;
    const ok = await confirm({ title: a.compact || 'Compact', message: a.confirmCompact || 'Compact this session transcript?', confirmText: a.compact || 'Compact' });
    if (!ok) return;
    setBusy(true);
    try {
      await gwApi.sessionsCompact(key);
      await loadSessions();
      toast('success', a.compactOk || 'Compacted');
      selectSession(key);
    } catch (e: any) { toast('error', String(e)); }
    setBusy(false);
  }, [busy, loadSessions, toast, a, confirm, selectSession]);

  // Batch operations
  const batchDelete = useCallback(async () => {
    if (batchSelected.size === 0) return;
    const ok = await confirm({ title: a.batchDelete || 'Batch Delete', message: `${a.confirmBatchDelete || 'Delete'} ${batchSelected.size} ${a.sessions}?`, danger: true });
    if (!ok) return;
    setBusy(true);
    for (const key of batchSelected) {
      try { await gwApi.proxy('sessions.delete', { key, deleteTranscript: true }); } catch {}
    }
    setBatchSelected(new Set());
    setBatchMode(false);
    if (selectedKey && batchSelected.has(selectedKey)) { setSelectedKey(null); setPreview(null); }
    await loadSessions();
    toast('success', a.deleteOk);
    setBusy(false);
  }, [batchSelected, selectedKey, loadSessions, toast, a, confirm]);

  const batchReset = useCallback(async () => {
    if (batchSelected.size === 0) return;
    const ok = await confirm({ title: a.batchReset || 'Batch Reset', message: `${a.confirmBatchReset || 'Reset'} ${batchSelected.size} ${a.sessions}?`, danger: true });
    if (!ok) return;
    setBusy(true);
    for (const key of batchSelected) {
      try { await gwApi.proxy('sessions.reset', { key }); } catch {}
    }
    setBatchSelected(new Set());
    setBatchMode(false);
    await loadSessions();
    toast('success', a.resetOk);
    setBusy(false);
  }, [batchSelected, loadSessions, toast, a, confirm]);

  const toggleBatchItem = useCallback((key: string) => {
    setBatchSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Export CSV
  const exportCSV = useCallback(() => {
    const header = 'key,kind,label,model,provider,totalTokens,inputTokens,outputTokens,updatedAt,lastChannel\n';
    const rows = sessions.map((s: any) =>
      [s.key, s.kind, `"${(s.label || '').replace(/"/g, '""')}"`, s.model || '', s.modelProvider || '',
       s.totalTokens || 0, s.inputTokens || 0, s.outputTokens || 0,
       s.updatedAt ? new Date(s.updatedAt).toISOString() : '', s.lastChannel || ''].join(',')
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `sessions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click(); URL.revokeObjectURL(url);
  }, [sessions]);

  // Copy message
  const copyText = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => toast('success', a.copied || 'Copied'));
  }, [toast, a]);

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    sessions.forEach((s: any) => { counts[s.kind] = (counts[s.kind] || 0) + 1; });
    return counts;
  }, [sessions]);

  const previewMessages: any[] = useMemo(() => {
    const items = (preview?.previews?.[0]?.items || []).slice().reverse();
    // Filter empty messages
    return items.filter((m: any) => (m.content || m.text || '').trim());
  }, [preview]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const flatList = filtered.slice(0, 260);
      if (!flatList.length) return;
      const idx = flatList.findIndex((s: any) => s.key === selectedKey);
      if (e.key === 'ArrowDown') { e.preventDefault(); const next = Math.min(idx + 1, flatList.length - 1); selectSession(flatList[next].key); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); const prev = Math.max(idx - 1, 0); selectSession(flatList[prev].key); }
      else if (e.key === 'Delete' && selectedKey) { e.preventDefault(); deleteSession(selectedKey); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [filtered, selectedKey, selectSession, deleteSession]);

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
            <div className="flex items-center gap-1 shrink-0">
              {/* Export CSV */}
              {sessions.length > 0 && (
                <button onClick={exportCSV} className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all" title={a.exportCsv || 'Export CSV'}>
                  <span className="material-symbols-outlined text-[16px]">download</span>
                </button>
              )}
              {/* Batch mode toggle */}
              <button onClick={() => { setBatchMode(!batchMode); setBatchSelected(new Set()); }}
                className={`p-1.5 rounded-lg transition-all ${batchMode ? 'text-primary bg-primary/10' : 'text-slate-400 hover:text-primary hover:bg-primary/5'}`}
                title={a.batchMode || 'Batch'}>
                <span className="material-symbols-outlined text-[16px]">checklist</span>
              </button>
              <button onClick={loadSessions} disabled={loading} className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40" title={a.refresh}>
                <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
              </button>
            </div>
          </div>

          {/* KPI mini stats */}
          {sessions.length > 0 && !loading && (
            <div className="flex gap-2 mb-2 text-[10px]">
              <div className="flex-1 rounded-lg bg-blue-500/5 dark:bg-blue-500/10 px-2 py-1.5 text-center">
                <div className="font-bold text-blue-600 dark:text-blue-400 tabular-nums">{fmtTokens({ totalTokens: kpiStats.totalTok })}</div>
                <div className="text-slate-400 dark:text-white/30">{a.totalTokens || a.tokens}</div>
              </div>
              <div className="flex-1 rounded-lg bg-mac-green/5 dark:bg-mac-green/10 px-2 py-1.5 text-center">
                <div className="font-bold text-mac-green tabular-nums">{kpiStats.active24h}</div>
                <div className="text-slate-400 dark:text-white/30">{a.active24h || '24h'}</div>
              </div>
              <div className="flex-1 rounded-lg bg-slate-500/5 dark:bg-white/5 px-2 py-1.5 text-center">
                <div className="font-bold text-slate-600 dark:text-white/60 tabular-nums">{fmtTokens({ totalTokens: kpiStats.avgTok })}</div>
                <div className="text-slate-400 dark:text-white/30">{a.avgPerSession || 'Avg'}</div>
              </div>
              {kpiStats.abortedCount > 0 && (
                <div className="flex-1 rounded-lg bg-mac-red/5 dark:bg-mac-red/10 px-2 py-1.5 text-center">
                  <div className="font-bold text-mac-red tabular-nums">{kpiStats.abortedCount}</div>
                  <div className="text-slate-400 dark:text-white/30">{a.aborted || 'Aborted'}</div>
                </div>
              )}
            </div>
          )}

          {/* Search + Filter + Sort */}
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]">search</span>
              <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder={a.search}
                className="w-full h-7 pl-7 pr-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
            </div>
            <CustomSelect value={kindFilter} onChange={v => setKindFilter(v)}
              options={[{ value: '', label: `${a.all} (${sessions.length})` }, ...['direct', 'group', 'global', 'unknown'].filter(k => kindCounts[k]).map(k => ({ value: k, label: `${(a as any)[k] || k} (${kindCounts[k]})` }))]}
              className="h-7 px-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-600 dark:text-white/50" />
            <CustomSelect value={sortField} onChange={v => setSortField(v as SortField)}
              options={[{ value: 'updated', label: a.sortUpdated || 'Updated' }, { value: 'tokens', label: a.sortTokens || 'Tokens' }, { value: 'name', label: a.sortName || 'Name' }]}
              className="h-7 px-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-600 dark:text-white/50" />
          </div>

          {/* Batch actions bar */}
          {batchMode && (
            <div className="flex items-center gap-2 mt-2 px-1">
              <span className="text-[10px] text-slate-400 dark:text-white/30">{batchSelected.size} {a.selected || 'selected'}</span>
              <div className="flex-1" />
              <button onClick={batchReset} disabled={busy || batchSelected.size === 0}
                className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-primary disabled:opacity-30">{a.reset}</button>
              <button onClick={batchDelete} disabled={busy || batchSelected.size === 0}
                className="text-[10px] px-2 py-0.5 rounded bg-mac-red/10 text-mac-red disabled:opacity-30">{a.delete}</button>
            </div>
          )}
        </div>

        {error && <div className="mx-3 mt-2 px-2 py-1.5 rounded-lg bg-mac-red/10 border border-mac-red/20 text-[11px] text-mac-red">{error}</div>}

        {/* Session List */}
        <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
          {loading && !result ? (
            // Skeleton loading
            <div className="space-y-0">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="px-3 py-2.5 border-b border-slate-100/60 dark:border-white/[0.03] animate-pulse">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-10 h-4 rounded-full bg-slate-200/60 dark:bg-white/5" />
                    <div className="flex-1 h-3 rounded bg-slate-200/60 dark:bg-white/5" />
                  </div>
                  <div className="h-3 w-2/3 rounded bg-slate-100/60 dark:bg-white/[0.03] mt-1" />
                  <div className="h-2.5 w-1/2 rounded bg-slate-100/40 dark:bg-white/[0.02] mt-1.5" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-3xl mb-2">forum</span>
              <p className="text-[11px] font-bold mb-1">{a.noSessions}</p>
              <p className="text-[10px] text-center px-4">{a.noSessionsHint}</p>
            </div>
          ) : (
            <>
              {groupedSessions.map((group) => (
                <div key={group.label}>
                  <div className="sticky top-0 z-10 px-3 py-1 text-[10px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-wider bg-slate-50/90 dark:bg-[#1a1c22]/90 backdrop-blur-sm border-b border-slate-100/60 dark:border-white/[0.03]">
                    {group.label} ({group.items.length})
                  </div>
                  {group.items.map((row: any) => {
                    const isSelected = row.key === selectedKey;
                    const displayName = row.displayName?.trim() || row.label?.trim() || '';
                    const totalTok = row.totalTokens || ((row.inputTokens || 0) + (row.outputTokens || 0));
                    const inRatio = totalTok > 0 ? ((row.inputTokens || 0) / totalTok) * 100 : 0;
                    const chIcon = row.lastChannel ? (CHANNEL_ICONS[row.lastChannel] || '📡') : null;
                    return (
                      <div key={row.key}
                        className={`group w-full text-left px-3 py-2.5 border-b border-slate-100/60 dark:border-white/[0.03] transition-all cursor-pointer ${isSelected ? 'bg-primary/[0.06]' : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'}`}
                        onClick={() => batchMode ? toggleBatchItem(row.key) : selectSession(row.key)}>
                        <div className="flex items-center gap-2 mb-0.5">
                          {batchMode && (
                            <input type="checkbox" checked={batchSelected.has(row.key)} onChange={() => toggleBatchItem(row.key)}
                              className="w-3 h-3 rounded border-slate-300 dark:border-white/20 text-primary shrink-0" onClick={e => e.stopPropagation()} />
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${KIND_COLORS[row.kind] || KIND_COLORS.unknown}`}>{row.kind}</span>
                          {chIcon && <span className="text-[10px] shrink-0" title={row.lastChannel}>{chIcon}</span>}
                          <p className={`text-[10px] font-mono truncate flex-1 ${isSelected ? 'text-primary font-bold' : 'text-slate-600 dark:text-white/50'}`}>{row.key}</p>
                          {row.abortedLastRun && (
                            <span className="material-symbols-outlined text-[12px] text-mac-red shrink-0" title={a.aborted || 'Aborted'}>warning</span>
                          )}
                          {/* Hover quick actions */}
                          {!batchMode && (
                            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                              <button onClick={e => { e.stopPropagation(); resetSession(row.key); }}
                                className="p-0.5 rounded text-slate-400 hover:text-primary" title={a.reset}>
                                <span className="material-symbols-outlined text-[12px]">restart_alt</span>
                              </button>
                              <button onClick={e => { e.stopPropagation(); deleteSession(row.key); }}
                                className="p-0.5 rounded text-slate-400 hover:text-mac-red" title={a.delete}>
                                <span className="material-symbols-outlined text-[12px]">delete</span>
                              </button>
                            </div>
                          )}
                        </div>
                        {displayName && <p className="text-[11px] text-slate-400 dark:text-white/35 truncate">{displayName}</p>}
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400 dark:text-white/20">
                          <span>{fmtRelative(row.updatedAt, a)}</span>
                          <span>{fmtTokens(row)} {a.tok}</span>
                          {row.model && <span className="truncate max-w-[100px]">{row.model}</span>}
                        </div>
                        {/* Token I/O micro bar */}
                        {totalTok > 0 && (
                          <div className="mt-1 h-1 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                            <div className="h-full rounded-full bg-blue-400/60 dark:bg-blue-400/40 transition-all" style={{ width: `${inRatio}%` }} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              {omittedSessions > 0 && (
                <div className="px-3 py-2 text-[10px] text-center text-slate-400 dark:text-white/30 border-t border-slate-100/60 dark:border-white/[0.03]">
                  +{omittedSessions}
                </div>
              )}
            </>
          )}
        </div>

        {/* Last refresh footer */}
        {lastRefresh > 0 && (
          <div className="px-3 py-1 border-t border-slate-100/60 dark:border-white/[0.03] text-[9px] text-slate-400 dark:text-white/20 text-center">
            {a.lastRefresh || 'Last refresh'}: {new Date(lastRefresh).toLocaleTimeString()}
          </div>
        )}
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
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${KIND_COLORS[selected.kind] || KIND_COLORS.unknown}`}>{selected.kind}</span>
                    {selected.lastChannel && <span className="text-[12px]" title={selected.lastChannel}>{CHANNEL_ICONS[selected.lastChannel] || '📡'}</span>}
                    <h2 className="text-sm font-bold text-slate-800 dark:text-white font-mono truncate">{selected.key}</h2>
                    {selected.abortedLastRun && (
                      <span className="material-symbols-outlined text-[14px] text-mac-red" title={a.aborted || 'Aborted'}>warning</span>
                    )}
                  </div>
                  {(selected.displayName || selected.label) && (
                    <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5">{selected.displayName || selected.label}</p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                  {/* Jump to chat */}
                  {onNavigateToSession && (
                    <button onClick={() => onNavigateToSession(selected.key)}
                      className="text-[10px] px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">chat</span>
                      {a.openChat || 'Chat'}
                    </button>
                  )}
                  {/* Compact */}
                  <button onClick={() => compactSession(selected.key)} disabled={busy}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-primary disabled:opacity-30">{a.compact || 'Compact'}</button>
                  <button onClick={() => resetSession(selected.key)} disabled={busy}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-primary disabled:opacity-30">{a.reset}</button>
                  <button onClick={() => deleteSession(selected.key)} disabled={busy}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-mac-red/10 text-mac-red disabled:opacity-30">{a.delete}</button>
                </div>
              </div>

              {/* Session Info Grid — enhanced with I/O bar and context progress */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Updated At */}
                <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-white/40">schedule</span>
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{a.updated}</span>
                  </div>
                  <p className="text-[10px] font-semibold text-slate-700 dark:text-white/70 font-mono truncate">{selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '-'}</p>
                </div>
                {/* Tokens with I/O bar */}
                <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-white/40">token</span>
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{a.tokens}</span>
                  </div>
                  <p className="text-[10px] font-semibold text-slate-700 dark:text-white/70 font-mono">{fmtTokens(selected)}</p>
                  {(() => {
                    const inp = selected.inputTokens || 0;
                    const out = selected.outputTokens || 0;
                    const tot = inp + out;
                    if (!tot) return null;
                    const inPct = (inp / tot) * 100;
                    return (
                      <div className="mt-1.5">
                        <div className="flex justify-between text-[9px] text-slate-400 dark:text-white/25 mb-0.5">
                          <span>{a.input || 'In'}: {inp.toLocaleString()}</span>
                          <span>{a.output || 'Out'}: {out.toLocaleString()}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden flex">
                          <div className="h-full bg-blue-400/70 dark:bg-blue-400/50 rounded-l-full" style={{ width: `${inPct}%` }} />
                          <div className="h-full bg-amber-400/70 dark:bg-amber-400/50 flex-1 rounded-r-full" />
                        </div>
                      </div>
                    );
                  })()}
                </div>
                {/* Model with Provider */}
                <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-white/40">smart_toy</span>
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{a.model}</span>
                  </div>
                  <p className="text-[10px] font-semibold text-slate-700 dark:text-white/70 font-mono truncate">{selected.model || '-'}</p>
                  {selected.modelProvider && (
                    <p className="text-[9px] text-slate-400 dark:text-white/25 mt-0.5 truncate">{selected.modelProvider}</p>
                  )}
                </div>
                {/* Context with usage progress */}
                <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-white/40">memory</span>
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{a.context}</span>
                  </div>
                  <p className="text-[10px] font-semibold text-slate-700 dark:text-white/70 font-mono">{selected.contextTokens ? `${(selected.contextTokens / 1000).toFixed(0)}K` : '-'}</p>
                  {(() => {
                    const ctx = selected.contextTokens || 0;
                    const tot = selected.totalTokens || ((selected.inputTokens || 0) + (selected.outputTokens || 0));
                    if (!ctx || !tot) return null;
                    const pct = Math.min((tot / ctx) * 100, 100);
                    const color = pct > 80 ? 'bg-mac-red' : pct > 50 ? 'bg-amber-400' : 'bg-mac-green';
                    return (
                      <div className="mt-1.5">
                        <div className="flex justify-between text-[9px] text-slate-400 dark:text-white/25 mb-0.5">
                          <span>{pct.toFixed(0)}% {a.used || 'used'}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                          <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Per-Session Overrides — enhanced with model, sendPolicy, saved indicator */}
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
                <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-1">{a.overrides}</h3>
                <p className="text-[10px] text-slate-400 dark:text-white/30 mb-3">{a.overridesHelp}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {/* Label */}
                  <label className="block relative">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                      {a.label}
                      {savedField === 'label' && <span className="material-symbols-outlined text-[12px] text-mac-green">check_circle</span>}
                    </span>
                    <input defaultValue={selected.label || ''} disabled={busy} key={`label-${selected.key}`}
                      onBlur={e => { const v = e.target.value.trim(); if (v !== (selected.label || '')) patchSession(selected.key, { label: v || null }, 'label'); }}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                  </label>
                  {/* Thinking */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                      {a.thinking}
                      {savedField === 'thinking' && <span className="material-symbols-outlined text-[12px] text-mac-green">check_circle</span>}
                    </span>
                    <CustomSelect value={selected.thinkingLevel || ''} disabled={busy}
                      onChange={v => patchSession(selected.key, { thinkingLevel: v || null }, 'thinking')}
                      options={THINK_LEVELS.map(lv => ({ value: lv, label: lv ? (a[lv] || lv) : a.inherit }))}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                  </label>
                  {/* Verbose */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                      {a.verbose}
                      {savedField === 'verbose' && <span className="material-symbols-outlined text-[12px] text-mac-green">check_circle</span>}
                    </span>
                    <CustomSelect value={selected.verboseLevel || ''} disabled={busy}
                      onChange={v => patchSession(selected.key, { verboseLevel: v || null }, 'verbose')}
                      options={VERBOSE_VALUES.map(lv => ({ value: lv, label: lv ? (a[lv] || lv) : a.inherit }))}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                  </label>
                  {/* Reasoning */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                      {a.reasoning}
                      {savedField === 'reasoning' && <span className="material-symbols-outlined text-[12px] text-mac-green">check_circle</span>}
                    </span>
                    <CustomSelect value={selected.reasoningLevel || ''} disabled={busy}
                      onChange={v => patchSession(selected.key, { reasoningLevel: v || null }, 'reasoning')}
                      options={REASONING_LEVELS.map(lv => ({ value: lv, label: lv ? (a[lv] || lv) : a.inherit }))}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                  </label>
                  {/* Send Policy */}
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                      {a.sendPolicy || 'Send Policy'}
                      {savedField === 'sendPolicy' && <span className="material-symbols-outlined text-[12px] text-mac-green">check_circle</span>}
                    </span>
                    <CustomSelect value={selected.sendPolicy || ''} disabled={busy}
                      onChange={v => patchSession(selected.key, { sendPolicy: v || null } as any, 'sendPolicy')}
                      options={SEND_POLICIES.map(lv => ({ value: lv, label: lv ? (a[lv] || lv) : a.inherit }))}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                  </label>
                  {/* Model Override */}
                  <label className="block relative">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                      {a.modelOverride || 'Model Override'}
                      {savedField === 'model' && <span className="material-symbols-outlined text-[12px] text-mac-green">check_circle</span>}
                    </span>
                    <input defaultValue={selected.model || ''} disabled={busy} key={`model-${selected.key}`}
                      placeholder={a.modelPlaceholder || 'e.g. anthropic/claude-sonnet-4-5'}
                      onBlur={e => { const v = e.target.value.trim(); if (v !== (selected.model || '')) patchSession(selected.key, { model: v || null } as any, 'model'); }}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                  </label>
                </div>
              </div>

              {/* Message Preview — enhanced with timestamps, expand, copy, limit switcher */}
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px] text-primary">chat</span>
                    {a.messages}
                  </h3>
                  <div className="flex items-center gap-2">
                    {/* Limit switcher */}
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-white/30">
                      {[10, 20, 50].map(n => (
                        <button key={n} onClick={() => setPreviewLimit(n)}
                          className={`px-1.5 py-0.5 rounded ${previewLimit === n ? 'bg-primary/10 text-primary font-bold' : 'hover:text-primary'}`}>{n}</button>
                      ))}
                    </div>
                    <button onClick={() => selectSession(selected.key)} disabled={previewLoading}
                      className="text-[10px] text-primary hover:underline">{a.refresh}</button>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-white/30 mb-3">{a.messagesHelp}</p>
                {previewLoading ? (
                  <div className="space-y-2 py-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex gap-2.5 animate-pulse">
                        <div className="w-6 h-6 rounded-lg bg-slate-200/60 dark:bg-white/5 shrink-0" />
                        <div className="flex-1 rounded-xl bg-slate-100/60 dark:bg-white/[0.03] h-14" />
                      </div>
                    ))}
                  </div>
                ) : previewMessages.length === 0 ? (
                  <p className="text-[10px] text-slate-400 dark:text-white/20 py-6 text-center">{a.noMessages}</p>
                ) : (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                    {previewMessages.map((msg: any, i: number) => {
                      const role = msg.role || 'unknown';
                      const isUser = role === 'user';
                      const isAssistant = role === 'assistant';
                      const isTool = role === 'tool';
                      const content = msg.content || msg.text || '';
                      const isLong = content.length > 300;
                      const isExpanded = expandedMsgs.has(i);
                      return (
                        <div key={i} className={`group/msg flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${isUser ? 'bg-primary/10 text-primary' :
                              isAssistant ? 'bg-mac-green/10 text-mac-green' :
                                isTool ? 'bg-purple-500/10 text-purple-500' :
                                  'bg-slate-100 dark:bg-white/5 text-slate-400'
                            }`}>
                            <span className="material-symbols-outlined text-[12px]">
                              {isUser ? 'person' : isAssistant ? 'smart_toy' : isTool ? 'build' : 'settings'}
                            </span>
                          </div>
                          <div className={`flex-1 min-w-0 rounded-xl px-3 py-2 relative ${isUser ? 'bg-primary/[0.06] border border-primary/10' :
                              'bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5'
                            }`}>
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase">{role}</span>
                              {msg.model && <span className="text-[10px] text-slate-300 dark:text-white/15 font-mono">{msg.model}</span>}
                              {msg.timestamp && <span className="text-[9px] text-slate-300 dark:text-white/15">{new Date(msg.timestamp).toLocaleTimeString()}</span>}
                              <div className="flex-1" />
                              {/* Copy button */}
                              {content && (
                                <button onClick={() => copyText(content)}
                                  className="opacity-0 group-hover/msg:opacity-100 transition-opacity p-0.5 rounded text-slate-400 hover:text-primary" title="Copy">
                                  <span className="material-symbols-outlined text-[12px]">content_copy</span>
                                </button>
                              )}
                            </div>
                            <p className={`text-[10px] text-slate-600 dark:text-white/50 whitespace-pre-wrap break-words ${isLong && !isExpanded ? 'line-clamp-6' : ''}`}>
                              {content || a.empty}
                            </p>
                            {isLong && (
                              <button onClick={() => setExpandedMsgs(prev => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i); else next.add(i);
                                return next;
                              })} className="text-[10px] text-primary hover:underline mt-1">
                                {isExpanded ? (a.collapse || 'Collapse') : `${a.expand || 'Expand'} (${(content.length / 1000).toFixed(1)}k)`}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Extra Info — enhanced with more fields */}
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
                <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-2">{a.metadata}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
                  {selected.surface && <div><span className="text-slate-400 dark:text-white/35">{a.surface}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.surface}</span></div>}
                  {selected.subject && <div><span className="text-slate-400 dark:text-white/35">{a.subject}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.subject}</span></div>}
                  {selected.room && <div><span className="text-slate-400 dark:text-white/35">{a.room}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.room}</span></div>}
                  {selected.space && <div><span className="text-slate-400 dark:text-white/35">{a.space}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.space}</span></div>}
                  {selected.modelProvider && <div><span className="text-slate-400 dark:text-white/35">{a.provider}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.modelProvider}</span></div>}
                  {selected.sessionId && <div><span className="text-slate-400 dark:text-white/35">{a.sessionId}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.sessionId}</span></div>}
                  {selected.lastChannel && <div><span className="text-slate-400 dark:text-white/35">{a.channel || 'Channel'}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.lastChannel}</span></div>}
                  {selected.sendPolicy && <div><span className="text-slate-400 dark:text-white/35">{a.sendPolicy || 'Policy'}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.sendPolicy}</span></div>}
                  {selected.origin && <div><span className="text-slate-400 dark:text-white/35">{a.origin || 'Origin'}: </span><span className="text-slate-600 dark:text-white/50 font-mono">{selected.origin}</span></div>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Activity;
