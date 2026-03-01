
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi, gatewayApi } from '../services/api';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import CustomSelect from '../components/CustomSelect';

interface SchedulerProps { language: Language; }

type ScheduleKind = 'every' | 'at' | 'cron';
type PayloadKind = 'systemEvent' | 'agentTurn';
type SessionTarget = 'main' | 'isolated';
type WakeMode = 'now' | 'next-heartbeat';
type DeliveryMode = 'announce' | 'none' | 'webhook';

interface CronForm {
  name: string; description: string; agentId: string; enabled: boolean;
  scheduleKind: ScheduleKind; scheduleAt: string; everyAmount: string; everyUnit: 'minutes' | 'hours' | 'days';
  cronExpr: string; cronTz: string; sessionTarget: SessionTarget; wakeMode: WakeMode;
  payloadKind: PayloadKind; payloadText: string; deliveryMode: DeliveryMode; deliveryChannel: string; deliveryTo: string;
  timeoutSeconds: string; model: string; thinking: string; deleteAfterRun: boolean;
  sessionKey: string; accountId: string; bestEffort: boolean;
}

const DEFAULT_FORM: CronForm = {
  name: '', description: '', agentId: '', enabled: true,
  scheduleKind: 'every', scheduleAt: '', everyAmount: '30', everyUnit: 'minutes',
  cronExpr: '0 7 * * *', cronTz: '', sessionTarget: 'isolated', wakeMode: 'now',
  payloadKind: 'agentTurn', payloadText: '', deliveryMode: 'announce', deliveryChannel: 'last', deliveryTo: '',
  timeoutSeconds: '', model: '', thinking: '', deleteAfterRun: false,
  sessionKey: '', accountId: '', bestEffort: false,
};

// i18n-aware relative time formatting
function fmtRelative(ms?: number, s?: any) {
  if (!ms || !Number.isFinite(ms)) return s?.na || '-';
  const diff = ms - Date.now();
  if (Math.abs(diff) < 60_000) return s?.justNow;
  const mins = Math.abs(Math.round(diff / 60_000));
  if (mins < 60) return diff > 0 ? `${mins} ${s?.inMinutes}` : `${mins} ${s?.minutesAgo}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return diff > 0 ? `${hrs} ${s?.inHours}` : `${hrs} ${s?.hoursAgo}`;
  return new Date(ms).toLocaleString();
}

function fmtSchedule(job: any, l?: any) {
  const schedule = job.schedule;
  if (!schedule) return l?.na || '-';
  if (schedule.kind === 'at') return `${l?.at} ${schedule.at ? new Date(schedule.at).toLocaleString() : (l?.na || '-')}`;
  if (schedule.kind === 'every') {
    const ms = schedule.everyMs || 0;
    if (ms >= 86400000) return `${l?.every} ${Math.round(ms / 86400000)}d`;
    if (ms >= 3600000) return `${l?.every} ${Math.round(ms / 3600000)}h`;
    return `${l?.every} ${Math.round(ms / 60000)}m`;
  }
  return `${schedule.expr || (l?.na || '-')}${schedule.tz ? ` (${schedule.tz})` : ''}`;
}

function fmtPayload(job: any, s?: any) {
  const p = job.payload;
  if (!p) return s?.na || '-';
  if (p.kind === 'systemEvent') return `${s?.systemEvent}: ${p.text || (s?.na || '-')}`;
  return `${s?.agentTurn}: ${p.message || (s?.na || '-')}`;
}

function cronToHuman(expr: string, s?: any): string {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return s?.cronEveryMinute || 'every minute';
  if (min === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return s?.cronEveryHour || 'every hour';
  if (dom === '*' && mon === '*' && dow === '*' && hour !== '*') {
    return `${s?.cronEveryDay || 'every day'} ${s?.cronAt || 'at'} ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (dom === '*' && mon === '*' && dow === '1-5') {
    return `${s?.cronEveryWeekday || 'every weekday'} ${s?.cronAt || 'at'} ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (dom === '*' && mon === '*' && (dow === '0,6' || dow === '6,0')) {
    return `${s?.cronEveryWeekend || 'every weekend'} ${s?.cronAt || 'at'} ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (min.startsWith('*/')) return `${s?.every || 'every'} ${min.slice(2)} ${s?.cronMinute || 'min'}`;
  if (hour.startsWith('*/')) return `${s?.every || 'every'} ${hour.slice(2)} ${s?.cronHour || 'hr'}`;
  return expr;
}

function jobToForm(job: any): CronForm {
  const sch = job.schedule || {};
  const p = job.payload || {};
  const d = job.delivery || {};
  let scheduleKind: ScheduleKind = 'every';
  let everyAmount = '30', everyUnit: 'minutes' | 'hours' | 'days' = 'minutes';
  let scheduleAt = '', cronExpr = '0 7 * * *', cronTz = '';
  if (sch.kind === 'at') { scheduleKind = 'at'; scheduleAt = sch.at ? new Date(sch.at).toISOString().slice(0, 16) : ''; }
  else if (sch.kind === 'cron') { scheduleKind = 'cron'; cronExpr = sch.expr || ''; cronTz = sch.tz || ''; }
  else if (sch.kind === 'every') {
    scheduleKind = 'every';
    const ms = sch.everyMs || 0;
    if (ms >= 86400000) { everyAmount = String(Math.round(ms / 86400000)); everyUnit = 'days'; }
    else if (ms >= 3600000) { everyAmount = String(Math.round(ms / 3600000)); everyUnit = 'hours'; }
    else { everyAmount = String(Math.round(ms / 60000)); everyUnit = 'minutes'; }
  }
  return {
    name: job.name || '', description: job.description || '', agentId: job.agentId || '',
    enabled: job.enabled !== false, scheduleKind, scheduleAt, everyAmount, everyUnit,
    cronExpr, cronTz, sessionTarget: job.sessionTarget || 'isolated', wakeMode: job.wakeMode || 'now',
    payloadKind: p.kind || 'agentTurn', payloadText: p.kind === 'systemEvent' ? (p.text || '') : (p.message || ''),
    deliveryMode: (d.mode as DeliveryMode) || 'announce', deliveryChannel: d.channel || 'last', deliveryTo: d.to || '',
    timeoutSeconds: p.timeoutSeconds ? String(p.timeoutSeconds) : '', model: p.model || '', thinking: p.thinking || '',
    deleteAfterRun: !!job.deleteAfterRun, sessionKey: job.sessionKey || '',
    accountId: d.accountId || '', bestEffort: !!d.bestEffort,
  };
}

function formToJobPayload(f: CronForm) {
  let schedule: any;
  if (f.scheduleKind === 'at') {
    const ms = Date.parse(f.scheduleAt);
    if (!Number.isFinite(ms)) throw new Error('errInvalidTime');
    schedule = { kind: 'at', at: new Date(ms).toISOString() };
  } else if (f.scheduleKind === 'every') {
    const amt = parseInt(f.everyAmount) || 0;
    if (amt <= 0) throw new Error('errInvalidInterval');
    const mult = f.everyUnit === 'minutes' ? 60000 : f.everyUnit === 'hours' ? 3600000 : 86400000;
    schedule = { kind: 'every', everyMs: amt * mult };
  } else {
    if (!f.cronExpr.trim()) throw new Error('errCronRequired');
    schedule = { kind: 'cron', expr: f.cronExpr.trim(), tz: f.cronTz.trim() || undefined };
  }
  let payload: any;
  if (f.payloadKind === 'systemEvent') {
    if (!f.payloadText.trim()) throw new Error('errSystemTextRequired');
    payload = { kind: 'systemEvent', text: f.payloadText.trim() };
  } else {
    if (!f.payloadText.trim()) throw new Error('errAgentMessageRequired');
    payload = { kind: 'agentTurn', message: f.payloadText.trim() } as any;
    const timeout = parseInt(f.timeoutSeconds) || 0;
    if (timeout > 0) payload.timeoutSeconds = timeout;
    if (f.model.trim()) payload.model = f.model.trim();
    if (f.thinking.trim()) payload.thinking = f.thinking.trim();
  }
  const delivery = f.deliveryMode !== 'none'
    ? {
      mode: f.deliveryMode,
      channel: f.deliveryChannel.trim() || 'last',
      to: f.deliveryTo.trim() || undefined,
      accountId: f.accountId.trim() || undefined,
      bestEffort: f.bestEffort || undefined,
    } : undefined;
  if (!f.name.trim()) throw new Error('errNameRequired');
  return {
    name: f.name.trim(), description: f.description.trim() || undefined,
    agentId: f.agentId.trim() || undefined, enabled: f.enabled,
    schedule, sessionTarget: f.sessionTarget, wakeMode: f.wakeMode, payload, delivery,
    deleteAfterRun: f.deleteAfterRun || undefined,
    sessionKey: f.sessionKey.trim() || undefined,
  };
}

const Scheduler: React.FC<SchedulerProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const s = (t as any).sch as any;
  const { toast } = useToast();
  const { confirm } = useConfirm();

  // Gateway connectivity (mirrors Sessions page pattern)
  const [gwReady, setGwReady] = useState(false);
  const [gwChecked, setGwChecked] = useState(false);

  const [status, setStatus] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form state
  const [form, setForm] = useState<CronForm>({ ...DEFAULT_FORM });
  const [showForm, setShowForm] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Per-job busy state
  const [busyJobs, setBusyJobs] = useState<Set<string>>(new Set());

  // Search / filter / sort
  const [searchQuery, setSearchQuery] = useState('');
  const [filterEnabled, setFilterEnabled] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [sortBy, setSortBy] = useState<'nextRunAtMs' | 'updatedAtMs' | 'name'>('nextRunAtMs');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Run history
  const [runsJobId, setRunsJobId] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsHasMore, setRunsHasMore] = useState(false);
  const [runsOffset, setRunsOffset] = useState(0);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsStatusFilter, setRunsStatusFilter] = useState<string>('all');

  const na = s?.na || '-';

  const setErrorWithAutoClear = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 8000);
  }, []);

  const toErrorText = useCallback((e: any) => {
    const raw = String(e?.message || e || '');
    if (raw === 'errInvalidTime') return s.errInvalidTime;
    if (raw === 'errInvalidInterval') return s.errInvalidInterval;
    if (raw === 'errCronRequired') return s.errCronRequired;
    if (raw === 'errSystemTextRequired') return s.errSystemTextRequired;
    if (raw === 'errAgentMessageRequired') return s.errAgentMessageRequired;
    if (raw === 'errNameRequired') return s.errNameRequired;
    return raw;
  }, [s]);

  // Gateway connectivity check
  useEffect(() => {
    const check = () => {
      Promise.allSettled([gwApi.status(), gatewayApi.status()]).then(([rpc, svc]) => {
        const rpcOk = rpc.status === 'fulfilled' && !!(rpc.value as any)?.connected;
        const gwOk = svc.status === 'fulfilled' && !!(svc.value as any)?.running;
        setGwReady(rpcOk || gwOk);
        setGwChecked(true);
      }).catch(() => { setGwReady(false); setGwChecked(true); });
    };
    check();
    const timer = setInterval(check, 8000);
    return () => clearInterval(timer);
  }, []);

  // Load jobs + status
  const loadAll = useCallback(async () => {
    if (!gwReady) return;
    setLoading(true); setError(null);
    try {
      const [statusData, jobsData] = await Promise.all([
        gwApi.cronStatus().catch(() => null),
        gwApi.cronList({ includeDisabled: true, sortBy, sortDir, query: searchQuery || undefined, enabled: filterEnabled === 'all' ? undefined : filterEnabled }).catch(() => null),
      ]);
      if (statusData) setStatus(statusData);
      if (jobsData) {
        const list = Array.isArray(jobsData) ? jobsData : (jobsData as any)?.jobs || [];
        setJobs(list);
        setJobsTotal((jobsData as any)?.total ?? list.length);
      }
    } catch (e: any) { setErrorWithAutoClear(String(e)); }
    setLoading(false);
  }, [gwReady, sortBy, sortDir, searchQuery, filterEnabled, setErrorWithAutoClear]);

  // Auto-refresh every 10s + on mount
  useEffect(() => {
    if (!gwReady) return;
    loadAll();
    const timer = setInterval(loadAll, 10000);
    const onVis = () => { if (!document.hidden) loadAll(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [gwReady, loadAll]);

  const patchForm = useCallback((patch: Partial<CronForm>) => {
    setForm(prev => ({ ...prev, ...patch }));
    // Clear field errors for patched fields
    setFieldErrors(prev => {
      const next = { ...prev };
      for (const k of Object.keys(patch)) delete next[k];
      return next;
    });
  }, []);

  // Validate form and return field-level errors
  const validateForm = useCallback((): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = s.errNameRequired;
    if (form.scheduleKind === 'at' && !Number.isFinite(Date.parse(form.scheduleAt))) errs.scheduleAt = s.errInvalidTime;
    if (form.scheduleKind === 'every' && (parseInt(form.everyAmount) || 0) <= 0) errs.everyAmount = s.errInvalidInterval;
    if (form.scheduleKind === 'cron' && !form.cronExpr.trim()) errs.cronExpr = s.errCronRequired;
    if (form.payloadKind === 'systemEvent' && !form.payloadText.trim()) errs.payloadText = s.errSystemTextRequired;
    if (form.payloadKind === 'agentTurn' && !form.payloadText.trim()) errs.payloadText = s.errAgentMessageRequired;
    return errs;
  }, [form, s]);

  // Add job
  const addJob = useCallback(async () => {
    if (formBusy) return;
    const errs = validateForm();
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
    setFormBusy(true); setError(null); setFieldErrors({});
    try {
      const payload = formToJobPayload(form);
      await gwApi.cronAdd(payload);
      setForm({ ...DEFAULT_FORM });
      setShowForm(false);
      await loadAll();
      toast('success', s.jobAdded);
    } catch (e: any) {
      const msg = toErrorText(e);
      setErrorWithAutoClear(msg);
      toast('error', msg);
    }
    setFormBusy(false);
  }, [formBusy, form, loadAll, toast, s, toErrorText, validateForm, setErrorWithAutoClear]);

  // Edit (update) job
  const updateJob = useCallback(async () => {
    if (formBusy || !editingJobId) return;
    const errs = validateForm();
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
    setFormBusy(true); setError(null); setFieldErrors({});
    try {
      const payload = formToJobPayload(form);
      await gwApi.cronUpdate(editingJobId, payload);
      setForm({ ...DEFAULT_FORM });
      setShowForm(false);
      setEditingJobId(null);
      await loadAll();
      toast('success', s.jobUpdated);
    } catch (e: any) {
      const msg = toErrorText(e);
      setErrorWithAutoClear(msg);
      toast('error', msg);
    }
    setFormBusy(false);
  }, [formBusy, editingJobId, form, loadAll, toast, s, toErrorText, validateForm, setErrorWithAutoClear]);

  // Open edit form
  const openEditForm = useCallback((job: any) => {
    setForm(jobToForm(job));
    setEditingJobId(job.id);
    setShowForm(true);
    setFieldErrors({});
  }, []);

  // Duplicate job
  const duplicateJob = useCallback((job: any) => {
    const f = jobToForm(job);
    f.name = f.name + ' (copy)';
    setForm(f);
    setEditingJobId(null);
    setShowForm(true);
    setFieldErrors({});
  }, []);

  // Load runs with pagination
  const loadRuns = useCallback(async (jobId: string, offset = 0, append = false) => {
    setRunsLoading(true);
    try {
      const res = await gwApi.cronRuns(jobId, 20, {
        offset,
        status: runsStatusFilter !== 'all' ? runsStatusFilter : undefined,
        sortDir: 'desc',
      }) as any;
      const entries = Array.isArray(res?.entries) ? res.entries : [];
      setRunsJobId(jobId);
      setRuns(prev => append ? [...prev, ...entries] : entries);
      setRunsTotal(res?.total ?? entries.length);
      setRunsHasMore(!!res?.hasMore);
      setRunsOffset(offset + entries.length);
    } catch { /* ignore */ }
    setRunsLoading(false);
  }, [runsStatusFilter]);

  const loadMoreRuns = useCallback(() => {
    if (runsJobId && !runsLoading) loadRuns(runsJobId, runsOffset, true);
  }, [runsJobId, runsLoading, runsOffset, loadRuns]);

  const toggleJob = useCallback(async (job: any) => {
    if (busyJobs.has(job.id)) return;
    setBusyJobs(prev => new Set(prev).add(job.id));
    try {
      await gwApi.cronUpdate(job.id, { enabled: !job.enabled });
      await loadAll();
      toast('success', s.jobToggled);
    } catch (e: any) {
      const msg = toErrorText(e);
      setErrorWithAutoClear(msg);
      toast('error', msg);
    }
    setBusyJobs(prev => { const n = new Set(prev); n.delete(job.id); return n; });
  }, [busyJobs, loadAll, toast, s, toErrorText, setErrorWithAutoClear]);

  const runJob = useCallback(async (job: any) => {
    if (busyJobs.has(job.id)) return;
    setBusyJobs(prev => new Set(prev).add(job.id));
    try {
      await gwApi.cronRun(job.id);
      await loadRuns(job.id);
      toast('success', s.jobRunning);
    } catch (e: any) {
      const msg = toErrorText(e);
      setErrorWithAutoClear(msg);
      toast('error', msg);
    }
    setBusyJobs(prev => { const n = new Set(prev); n.delete(job.id); return n; });
  }, [busyJobs, loadRuns, toast, s, toErrorText, setErrorWithAutoClear]);

  const removeJob = useCallback(async (job: any) => {
    if (busyJobs.has(job.id)) return;
    const ok = await confirm({
      title: s.confirmRemoveTitle,
      message: (s.confirmRemoveMsg || '').replace('{name}', job.name || job.id),
      confirmText: s.remove,
      danger: true,
    });
    if (!ok) return;
    setBusyJobs(prev => new Set(prev).add(job.id));
    try {
      await gwApi.cronRemove(job.id);
      if (runsJobId === job.id) { setRunsJobId(null); setRuns([]); }
      await loadAll();
      toast('success', s.jobRemoved);
    } catch (e: any) {
      const msg = toErrorText(e);
      setErrorWithAutoClear(msg);
      toast('error', msg);
    }
    setBusyJobs(prev => { const n = new Set(prev); n.delete(job.id); return n; });
  }, [busyJobs, runsJobId, loadAll, toast, s, toErrorText, confirm, setErrorWithAutoClear]);

  // Auto-refresh runs every 10s when viewing
  useEffect(() => {
    if (!runsJobId || !gwReady) return;
    const timer = setInterval(() => loadRuns(runsJobId), 10000);
    return () => clearInterval(timer);
  }, [runsJobId, gwReady, loadRuns]);

  const selectedJobName = runsJobId ? (jobs.find(j => j.id === runsJobId)?.name || runsJobId) : null;

  const inputCls = 'w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30';
  const inputErrCls = 'w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-mac-red/5 border border-mac-red/30 text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-mac-red/30';
  const labelCls = 'text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase';
  const selectCls = 'w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70';
  const errHintCls = 'text-[9px] text-mac-red mt-0.5';

  // Gateway not ready screen
  if (gwChecked && !gwReady) {
    return (
      <main className="flex-1 overflow-y-auto p-4 md:p-5 custom-scrollbar bg-slate-50/50 dark:bg-transparent">
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-white/30">
          <span className="material-symbols-outlined text-[48px] mb-4 text-mac-yellow">cloud_off</span>
          <p className="text-sm font-bold mb-1">{s.gwNotReady}</p>
          <p className="text-[11px] text-center mb-4">{s.gwNotReadyDesc}</p>
          <button onClick={() => { setGwChecked(false); }} className="px-4 py-1.5 rounded-lg bg-primary text-white text-[11px] font-bold">{s.retry}</button>
        </div>
      </main>
    );
  }

  // Skeleton loading
  if (!gwChecked || (loading && jobs.length === 0 && !status)) {
    return (
      <main className="flex-1 overflow-y-auto p-4 md:p-5 custom-scrollbar bg-slate-50/50 dark:bg-transparent">
        <div className="space-y-4 max-w-5xl animate-pulse">
          <div className="h-8 bg-slate-200/50 dark:bg-white/5 rounded-lg w-48" />
          <div className="grid grid-cols-3 gap-3">{[0, 1, 2].map(i => <div key={i} className="h-20 bg-slate-200/30 dark:bg-white/[0.03] rounded-xl" />)}</div>
          <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="h-16 bg-slate-200/30 dark:bg-white/[0.03] rounded-xl" />)}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-5 custom-scrollbar bg-slate-50/50 dark:bg-transparent">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold dark:text-white text-slate-800">{s.title}</h1>
          <p className="text-[10px] text-slate-400 dark:text-white/35 mt-0.5">{s.schedulerHelp || s.desc}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => { if (showForm && editingJobId) { setEditingJobId(null); setForm({ ...DEFAULT_FORM }); } setShowForm(!showForm); setFieldErrors({}); }}
            className="h-8 flex items-center gap-1.5 px-3 rounded-lg bg-primary text-white text-[11px] font-bold hover:bg-blue-600 transition-all">
            <span className="material-symbols-outlined text-[14px]">{showForm ? 'close' : 'add'}</span>
            <span className="hidden sm:inline">{showForm ? s.cancel : s.newJob}</span>
          </button>
          <button onClick={loadAll} disabled={loading} className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40" title={s.refresh}>
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
          </button>
        </div>
      </div>

      {error && <div className="mb-3 px-3 py-2 rounded-xl bg-mac-red/10 border border-mac-red/20 text-[10px] text-mac-red animate-fade-in">{error}</div>}

      <div className="space-y-4 max-w-5xl">
        {/* Status Card - full width when no form */}
        <div className={`grid grid-cols-1 ${showForm ? 'lg:grid-cols-2' : ''} gap-4`}>
          <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
            <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-primary">schedule</span>
              {s.scheduler}
            </h3>
            <div className={`grid ${showForm ? 'grid-cols-3' : 'grid-cols-4'} gap-3`}>
              <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3 text-center">
                <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.status}</p>
                <p className={`text-sm font-bold mt-0.5 ${status?.enabled ? 'text-mac-green' : 'text-slate-400'}`}>{status ? (status.enabled ? s.enabled : s.disabled) : s.na}</p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3 text-center">
                <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.jobs}</p>
                <p className="text-sm font-bold text-slate-700 dark:text-white/70 mt-0.5">{jobsTotal || status?.jobs || na}</p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3 text-center">
                <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.nextWake}</p>
                <p className="text-[10px] font-bold text-primary mt-0.5">{fmtRelative(status?.nextWakeAtMs, s)}</p>
              </div>
              {!showForm && (
                <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3 text-center">
                  <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.running}</p>
                  <p className="text-sm font-bold text-slate-700 dark:text-white/70 mt-0.5">{jobs.filter(j => j.state?.runningAtMs).length}</p>
                </div>
              )}
            </div>
          </div>

          {/* Form Modal (add / edit) */}
          {showForm && (
            <div className="rounded-2xl border border-primary/20 bg-white dark:bg-white/[0.02] p-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px] text-primary">{editingJobId ? 'edit' : 'add_task'}</span>
                {editingJobId ? s.editJob : s.newJob}
              </h3>
              <div className="space-y-2.5">
                {/* Name + AgentId */}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className={labelCls}>{s.name}</span>
                    <input value={form.name} onChange={e => patchForm({ name: e.target.value })} className={fieldErrors.name ? inputErrCls : inputCls} />
                    {fieldErrors.name && <p className={errHintCls}>{fieldErrors.name}</p>}
                  </label>
                  <label className="block">
                    <span className={labelCls}>{s.agentId}</span>
                    <input value={form.agentId} onChange={e => patchForm({ agentId: e.target.value })} placeholder="default" className={inputCls} />
                  </label>
                </div>
                {/* Description */}
                <label className="block">
                  <span className={labelCls}>{s.description}</span>
                  <input value={form.description} onChange={e => patchForm({ description: e.target.value })} className={inputCls} />
                </label>
                {/* Schedule */}
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className={labelCls}>{s.schedule}</span>
                    <CustomSelect value={form.scheduleKind} onChange={v => patchForm({ scheduleKind: v as ScheduleKind })}
                      options={[{ value: 'every', label: s.every }, { value: 'at', label: s.at }, { value: 'cron', label: s.cron }]} className={selectCls} />
                  </label>
                  {form.scheduleKind === 'every' && <>
                    <label className="block">
                      <span className={labelCls}>{s.every}</span>
                      <input value={form.everyAmount} onChange={e => patchForm({ everyAmount: e.target.value })} className={fieldErrors.everyAmount ? inputErrCls : inputCls} />
                      {fieldErrors.everyAmount && <p className={errHintCls}>{fieldErrors.everyAmount}</p>}
                    </label>
                    <label className="block">
                      <span className={labelCls}>&nbsp;</span>
                      <CustomSelect value={form.everyUnit} onChange={v => patchForm({ everyUnit: v as any })}
                        options={[{ value: 'minutes', label: s.minutes }, { value: 'hours', label: s.hours }, { value: 'days', label: s.days }]} className={selectCls} />
                    </label>
                  </>}
                  {form.scheduleKind === 'at' && (
                    <label className="block col-span-2">
                      <span className={labelCls}>{s.at}</span>
                      <input type="datetime-local" value={form.scheduleAt} onChange={e => patchForm({ scheduleAt: e.target.value })} className={fieldErrors.scheduleAt ? inputErrCls : inputCls} />
                      {fieldErrors.scheduleAt && <p className={errHintCls}>{fieldErrors.scheduleAt}</p>}
                    </label>
                  )}
                  {form.scheduleKind === 'cron' && <>
                    <label className="block">
                      <span className={labelCls}>{s.cronExpr}</span>
                      <input value={form.cronExpr} onChange={e => patchForm({ cronExpr: e.target.value })} className={`${fieldErrors.cronExpr ? inputErrCls : inputCls} font-mono`} />
                      {fieldErrors.cronExpr && <p className={errHintCls}>{fieldErrors.cronExpr}</p>}
                      {form.cronExpr && !fieldErrors.cronExpr && <p className="text-[9px] text-primary/70 mt-0.5">{s.cronPreview}: {cronToHuman(form.cronExpr, s)}</p>}
                    </label>
                    <label className="block">
                      <span className={labelCls}>{s.timezone}</span>
                      <input value={form.cronTz} onChange={e => patchForm({ cronTz: e.target.value })} placeholder="UTC" className={inputCls} />
                    </label>
                  </>}
                </div>
                {/* Session + Wake + Payload */}
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className={labelCls}>{s.session}</span>
                    <CustomSelect value={form.sessionTarget} onChange={v => patchForm({ sessionTarget: v as SessionTarget })}
                      options={[{ value: 'main', label: s.main }, { value: 'isolated', label: s.isolated }]} className={selectCls} />
                  </label>
                  <label className="block">
                    <span className={labelCls}>{s.wakeMode}</span>
                    <CustomSelect value={form.wakeMode} onChange={v => patchForm({ wakeMode: v as WakeMode })}
                      options={[{ value: 'now', label: s.now }, { value: 'next-heartbeat', label: s.nextHeartbeat }]} className={selectCls} />
                  </label>
                  <label className="block">
                    <span className={labelCls}>{s.payload}</span>
                    <CustomSelect value={form.payloadKind} onChange={v => patchForm({ payloadKind: v as PayloadKind })}
                      options={[{ value: 'systemEvent', label: s.systemEvent }, { value: 'agentTurn', label: s.agentTurn }]} className={selectCls} />
                  </label>
                </div>
                {/* Payload text */}
                <label className="block">
                  <span className={labelCls}>{form.payloadKind === 'systemEvent' ? s.systemText : s.agentMessage}</span>
                  <textarea value={form.payloadText} onChange={e => patchForm({ payloadText: e.target.value })} rows={3}
                    className={`${fieldErrors.payloadText ? inputErrCls : inputCls} resize-none`} />
                  {fieldErrors.payloadText && <p className={errHintCls}>{fieldErrors.payloadText}</p>}
                </label>
                {/* Model + Thinking (agentTurn only) */}
                {form.payloadKind === 'agentTurn' && (
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block">
                      <span className={labelCls}>{s.model}</span>
                      <input value={form.model} onChange={e => patchForm({ model: e.target.value })} placeholder={s.modelPlaceholder} className={inputCls} />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{s.thinking}</span>
                      <input value={form.thinking} onChange={e => patchForm({ thinking: e.target.value })} placeholder={s.thinkingPlaceholder} className={inputCls} />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{s.timeout}</span>
                      <input value={form.timeoutSeconds} onChange={e => patchForm({ timeoutSeconds: e.target.value })} placeholder="0" className={inputCls} />
                    </label>
                  </div>
                )}
                {/* Delivery */}
                {form.payloadKind === 'agentTurn' && (
                  <div className="grid grid-cols-4 gap-2">
                    <label className="block">
                      <span className={labelCls}>{s.delivery}</span>
                      <CustomSelect value={form.deliveryMode} onChange={v => patchForm({ deliveryMode: v as DeliveryMode })}
                        options={[{ value: 'announce', label: s.announce }, { value: 'webhook', label: s.webhook }, { value: 'none', label: s.none }]} className={selectCls} />
                    </label>
                    {form.deliveryMode !== 'none' && <>
                      <label className="block">
                        <span className={labelCls}>{s.channel}</span>
                        <input value={form.deliveryChannel} onChange={e => patchForm({ deliveryChannel: e.target.value })} placeholder="last" className={inputCls} />
                      </label>
                      <label className="block">
                        <span className={labelCls}>{s.to}</span>
                        <input value={form.deliveryTo} onChange={e => patchForm({ deliveryTo: e.target.value })} placeholder="+1555..." className={inputCls} />
                      </label>
                      <label className="block">
                        <span className={labelCls}>{s.accountId}</span>
                        <input value={form.accountId} onChange={e => patchForm({ accountId: e.target.value })} placeholder={s.accountIdPlaceholder} className={inputCls} />
                      </label>
                    </>}
                  </div>
                )}
                {/* Advanced: sessionKey, deleteAfterRun, bestEffort, enabled */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={form.enabled} onChange={e => patchForm({ enabled: e.target.checked })} className="accent-primary" />
                    <span className="text-[10px] text-slate-500 dark:text-white/40">{s.enabled}</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={form.deleteAfterRun} onChange={e => patchForm({ deleteAfterRun: e.target.checked })} className="accent-mac-yellow" />
                    <span className="text-[10px] text-slate-500 dark:text-white/40" title={s.deleteAfterRunHint}>{s.deleteAfterRun}</span>
                  </label>
                  {form.deliveryMode !== 'none' && (
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={form.bestEffort} onChange={e => patchForm({ bestEffort: e.target.checked })} className="accent-primary" />
                      <span className="text-[10px] text-slate-500 dark:text-white/40" title={s.bestEffortHint}>{s.bestEffort}</span>
                    </label>
                  )}
                </div>
                {/* Session key */}
                <label className="block">
                  <span className={labelCls}>{s.sessionKey}</span>
                  <input value={form.sessionKey} onChange={e => patchForm({ sessionKey: e.target.value })} placeholder={s.sessionKeyPlaceholder} className={inputCls} />
                </label>
                {/* Submit */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button onClick={() => { setShowForm(false); setEditingJobId(null); setForm({ ...DEFAULT_FORM }); setFieldErrors({}); }}
                    className="px-4 py-1.5 rounded-lg text-slate-500 text-[11px] font-bold hover:bg-slate-100 dark:hover:bg-white/5">{s.cancel}</button>
                  <button onClick={editingJobId ? updateJob : addJob} disabled={formBusy}
                    className="px-4 py-1.5 rounded-lg bg-primary text-white text-[11px] font-bold disabled:opacity-40">
                    {formBusy ? (editingJobId ? s.updating : s.saving) : (editingJobId ? s.updateJob : s.addJob)}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Jobs List */}
        <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
          {/* Search / Filter / Sort bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-primary">list_alt</span>
              {s.jobs} ({jobsTotal || jobs.length})
            </h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <span className="material-symbols-outlined text-[14px] text-slate-400 absolute left-2 top-1/2 -translate-y-1/2">search</span>
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={s.searchJobs || s.search}
                  className="pl-7 pr-2 py-1 w-36 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-600 dark:text-white/60 focus:outline-none focus:ring-1 focus:ring-primary/30" />
              </div>
              <CustomSelect value={filterEnabled}
                onChange={v => setFilterEnabled(v as 'all' | 'enabled' | 'disabled')}
                options={[{ value: 'all', label: s.filterAll || s.all }, { value: 'enabled', label: s.enabled }, { value: 'disabled', label: s.disabled }]}
                className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-600 dark:text-white/60" />
              <CustomSelect value={`${sortBy}-${sortDir}`}
                onChange={v => { const [b, d] = v.split('-'); setSortBy(b as any); setSortDir(d as any); }}
                options={[
                  { value: 'name-asc', label: `${s.sortName} ↑` }, { value: 'name-desc', label: `${s.sortName} ↓` },
                  { value: 'nextRunAtMs-asc', label: `${s.sortNextRun || s.sortNext} ↑` }, { value: 'nextRunAtMs-desc', label: `${s.sortNextRun || s.sortNext} ↓` },
                  { value: 'updatedAtMs-desc', label: `${s.sortUpdated} ↓` }, { value: 'updatedAtMs-asc', label: `${s.sortUpdated} ↑` },
                ]}
                className="px-2 py-1 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-600 dark:text-white/60" />
            </div>
          </div>

          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-4xl mb-3">schedule</span>
              <p className="text-sm font-bold mb-1">{s.noJobs}</p>
              <p className="text-[11px] text-center">{s.noJobsHint}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job: any) => {
                const isSelected = runsJobId === job.id;
                const lastStatus = job.state?.lastStatus;
                const isBusy = busyJobs.has(job.id);
                return (
                  <div key={job.id} onClick={() => loadRuns(job.id)}
                    className={`px-3.5 py-3 rounded-xl border cursor-pointer transition-all ${isBusy ? 'opacity-60 pointer-events-none' : ''} ${isSelected ? 'border-primary/30 bg-primary/[0.03]' : 'border-slate-200/60 dark:border-white/[0.06] bg-slate-50 dark:bg-white/[0.02] hover:border-primary/20'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-bold text-slate-700 dark:text-white/70 truncate">{job.name}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${job.enabled ? 'bg-mac-green/10 text-mac-green' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                            {job.enabled ? s.enabled : s.disabled}
                          </span>
                          {job.deleteAfterRun && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-mac-yellow/10 text-mac-yellow font-bold shrink-0">{s.deleteAfterRun}</span>}
                          {job.state?.runningAtMs && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold shrink-0 animate-pulse">{s.running}</span>}
                        </div>
                        {job.description && <p className="text-[11px] text-slate-400 dark:text-white/35 mt-0.5 truncate">{job.description}</p>}
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px]">
                          <span className="text-slate-500 dark:text-white/40 font-mono">{fmtSchedule(job, s)}</span>
                          <span className="text-slate-400 dark:text-white/35">{fmtPayload(job, s)}</span>
                          {job.agentId && <span className="text-slate-400 dark:text-white/35">{s.agentId}: {job.agentId}</span>}
                        </div>
                        <div className="flex gap-2 mt-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40">{job.sessionTarget}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40">{job.wakeMode}</span>
                        </div>
                      </div>
                      {/* State + Actions */}
                      <div className="shrink-0 text-right space-y-1">
                        <div className="text-[11px]">
                          <span className="text-slate-400 dark:text-white/35">{s.status}: </span>
                          <span className={`font-bold ${lastStatus === 'ok' ? 'text-mac-green' : lastStatus === 'error' ? 'text-mac-red' : 'text-slate-400'}`}>{lastStatus || s.na}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 dark:text-white/35">{s.nextRun}: {fmtRelative(job.state?.nextRunAtMs, s)}</div>
                        <div className="text-[11px] text-slate-400 dark:text-white/35">{s.last}: {fmtRelative(job.state?.lastRunAtMs, s)}</div>
                        {job.state?.consecutiveErrors > 0 && (
                          <div className="text-[11px] text-mac-red font-bold">{s.consecutiveErrors}: {job.state.consecutiveErrors}</div>
                        )}
                        <div className="flex gap-1 mt-1 justify-end flex-wrap">
                          <button onClick={e => { e.stopPropagation(); openEditForm(job); }} disabled={isBusy}
                            className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-primary disabled:opacity-30" title={s.editJob}>
                            <span className="material-symbols-outlined text-[12px]">edit</span>
                          </button>
                          <button onClick={e => { e.stopPropagation(); duplicateJob(job); }} disabled={isBusy}
                            className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-primary disabled:opacity-30" title={s.duplicate}>
                            <span className="material-symbols-outlined text-[12px]">content_copy</span>
                          </button>
                          <button onClick={e => { e.stopPropagation(); toggleJob(job); }} disabled={isBusy}
                            className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-primary disabled:opacity-30">
                            {job.enabled ? s.disable : s.enable}
                          </button>
                          <button onClick={e => { e.stopPropagation(); runJob(job); }} disabled={isBusy}
                            className="text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary font-bold disabled:opacity-30">{s.run}</button>
                          <button onClick={e => { e.stopPropagation(); removeJob(job); }} disabled={isBusy}
                            className="text-[11px] px-2 py-0.5 rounded bg-mac-red/10 text-mac-red disabled:opacity-30">{s.remove}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Pagination */}
          {jobsTotal > jobs.length && (
            <div className="flex justify-center mt-3">
              <button onClick={loadAll} className="text-[10px] text-primary font-bold hover:underline">{s.loadMore}</button>
            </div>
          )}
        </div>

        {/* Run History */}
        <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-indigo-500">history</span>
              {s.runHistory}
              {selectedJobName && <span className="text-[11px] font-normal text-slate-400 dark:text-white/35">— {selectedJobName}</span>}
            </h3>
            {runsJobId && (
              <div className="flex items-center gap-2">
                <CustomSelect value={runsStatusFilter}
                  onChange={v => { setRunsStatusFilter(v); setRuns([]); setRunsOffset(0); if (runsJobId) setTimeout(() => loadRuns(runsJobId!), 0); }}
                  options={[{ value: 'all', label: s.all }, { value: 'ok', label: s.ok }, { value: 'error', label: s.error }, { value: 'skipped', label: s.skipped }]}
                  className="px-2 py-0.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-600 dark:text-white/60" />
                <button onClick={() => { if (runsJobId) loadRuns(runsJobId); }} className="text-slate-400 hover:text-primary">
                  <span className="material-symbols-outlined text-[14px]">refresh</span>
                </button>
              </div>
            )}
          </div>
          {!runsJobId ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-3xl mb-2">touch_app</span>
              <p className="text-[11px] font-bold mb-1">{s.selectJob}</p>
              <p className="text-[10px] text-center">{s.selectJobHint}</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-3xl mb-2">history</span>
              <p className="text-[11px] font-bold mb-1">{s.noRuns}</p>
              <p className="text-[10px] text-center">{s.noRunsHint}</p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                {runs.map((run: any, i: number) => (
                  <div key={`${run.ts}-${i}`} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${run.status === 'ok' ? 'bg-mac-green' : run.status === 'error' ? 'bg-mac-red' : 'bg-mac-yellow'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold ${run.status === 'ok' ? 'text-mac-green' : run.status === 'error' ? 'text-mac-red' : 'text-mac-yellow'}`}>
                          {run.status === 'ok' ? s.ok : run.status === 'error' ? s.error : s.skipped}
                        </span>
                        {run.durationMs != null && <span className="text-[11px] text-slate-400 dark:text-white/35">{run.durationMs}ms</span>}
                      </div>
                      {run.summary && <p className="text-[11px] text-slate-500 dark:text-white/40 truncate mt-0.5">{run.summary}</p>}
                      {run.error && <p className="text-[11px] text-mac-red truncate mt-0.5">{run.error}</p>}
                    </div>
                    <span className="text-[11px] text-slate-400 dark:text-white/20 shrink-0">{run.ts ? new Date(run.ts).toLocaleString() : na}</span>
                  </div>
                ))}
              </div>
              {runsHasMore && (
                <div className="flex justify-center mt-3">
                  <button onClick={loadMoreRuns} disabled={runsLoading}
                    className="text-[10px] text-primary font-bold hover:underline disabled:opacity-40">
                    {runsLoading ? (s.loading || 'Loading...') : s.loadMore}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
};

export default Scheduler;
