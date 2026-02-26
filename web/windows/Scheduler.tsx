
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi } from '../services/api';
import { useToast } from '../components/Toast';
import CustomSelect from '../components/CustomSelect';

interface SchedulerProps { language: Language; }

type ScheduleKind = 'every' | 'at' | 'cron';
type PayloadKind = 'systemEvent' | 'agentTurn';
type SessionTarget = 'main' | 'isolated';
type WakeMode = 'now' | 'next-heartbeat';
type DeliveryMode = 'announce' | 'none';

interface CronForm {
  name: string; description: string; agentId: string; enabled: boolean;
  scheduleKind: ScheduleKind; scheduleAt: string; everyAmount: string; everyUnit: 'minutes' | 'hours' | 'days';
  cronExpr: string; cronTz: string; sessionTarget: SessionTarget; wakeMode: WakeMode;
  payloadKind: PayloadKind; payloadText: string; deliveryMode: DeliveryMode; deliveryChannel: string; deliveryTo: string; timeoutSeconds: string;
}

const DEFAULT_FORM: CronForm = {
  name: '', description: '', agentId: '', enabled: true,
  scheduleKind: 'every', scheduleAt: '', everyAmount: '30', everyUnit: 'minutes',
  cronExpr: '0 7 * * *', cronTz: '', sessionTarget: 'isolated', wakeMode: 'now',
  payloadKind: 'agentTurn', payloadText: '', deliveryMode: 'announce', deliveryChannel: 'last', deliveryTo: '', timeoutSeconds: '',
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

const Scheduler: React.FC<SchedulerProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const s = (t as any).sch as any;
  const { toast } = useToast();

  const [status, setStatus] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CronForm>({ ...DEFAULT_FORM });
  const [showForm, setShowForm] = useState(false);
  const [runsJobId, setRunsJobId] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const na = s?.na || '-';

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

  const loadAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [statusData, jobsData] = await Promise.all([
        gwApi.cronStatus().catch(() => null),
        gwApi.cron().catch(() => null),
      ]);
      if (statusData) setStatus(statusData);
      if (jobsData) setJobs(Array.isArray(jobsData) ? jobsData : jobsData?.jobs || []);
    } catch (e: any) { setError(String(e)); }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const patchForm = useCallback((patch: Partial<CronForm>) => setForm(prev => ({ ...prev, ...patch })), []);

  const addJob = useCallback(async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const f = form;
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
      }
      const delivery = f.sessionTarget === 'isolated' && f.payloadKind === 'agentTurn' && f.deliveryMode
        ? { mode: f.deliveryMode, channel: f.deliveryChannel.trim() || 'last', to: f.deliveryTo.trim() || undefined }
        : undefined;
      const job = {
        name: f.name.trim(), description: f.description.trim() || undefined,
        agentId: f.agentId.trim() || undefined, enabled: f.enabled,
        schedule, sessionTarget: f.sessionTarget, wakeMode: f.wakeMode, payload, delivery,
      };
      if (!job.name) throw new Error('errNameRequired');
      await gwApi.cronAdd(job);
      setForm({ ...DEFAULT_FORM });
      setShowForm(false);
      await loadAll();
      toast('success', s.jobAdded);
    } catch (e: any) {
      const msg = toErrorText(e);
      setError(msg);
      toast('error', msg);
    }
    setBusy(false);
  }, [busy, form, loadAll, toast, s, toErrorText]);

  const toggleJob = useCallback(async (job: any) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { 
      await gwApi.cronUpdate(job.id, { enabled: !job.enabled }); 
      await loadAll(); 
      toast('success', s.jobToggled);
    }
    catch (e: any) {
      const msg = toErrorText(e);
      setError(msg);
      toast('error', msg);
    }
    setBusy(false);
  }, [busy, loadAll, toast, s, toErrorText]);

  const runJob = useCallback(async (job: any) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { 
      await gwApi.cronRun(job.id); 
      await loadRuns(job.id); 
      toast('success', s.jobRunning);
    }
    catch (e: any) {
      const msg = toErrorText(e);
      setError(msg);
      toast('error', msg);
    }
    setBusy(false);
  }, [busy, toast, s, toErrorText]);

  const removeJob = useCallback(async (job: any) => {
    if (busy) return;
    if (!confirm(s.confirmRemove)) return;
    setBusy(true); setError(null);
    try {
      await gwApi.cronRemove(job.id);
      if (runsJobId === job.id) { setRunsJobId(null); setRuns([]); }
      await loadAll();
      toast('success', s.jobRemoved);
    } catch (e: any) {
      const msg = toErrorText(e);
      setError(msg);
      toast('error', msg);
    }
    setBusy(false);
  }, [busy, runsJobId, loadAll, toast, s, toErrorText]);

  const loadRuns = useCallback(async (jobId: string) => {
    try {
      const res = await gwApi.cronRuns(jobId);
      setRunsJobId(jobId);
      setRuns(Array.isArray((res as any)?.entries) ? (res as any).entries : []);
    } catch (e: any) { setError(String(e)); }
  }, []);

  const selectedJobName = runsJobId ? (jobs.find(j => j.id === runsJobId)?.name || runsJobId) : null;
  const sortedRuns = [...runs].sort((a, b) => (b.ts || 0) - (a.ts || 0));

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-5 custom-scrollbar bg-slate-50/50 dark:bg-transparent">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold dark:text-white text-slate-800">{s.title}</h1>
          <p className="text-[10px] text-slate-400 dark:text-white/35 mt-0.5">{s.schedulerHelp || s.desc}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setShowForm(!showForm)} className="h-8 flex items-center gap-1.5 px-3 rounded-lg bg-primary text-white text-[11px] font-bold hover:bg-blue-600 transition-all">
            <span className="material-symbols-outlined text-[14px]">{showForm ? 'close' : 'add'}</span>
            <span className="hidden sm:inline">{s.newJob}</span>
          </button>
          <button onClick={loadAll} disabled={loading} className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40" title={s.refresh}>
            <span className={`material-symbols-outlined text-[18px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
          </button>
        </div>
      </div>

      {error && <div className="mb-3 px-3 py-2 rounded-xl bg-mac-red/10 border border-mac-red/20 text-[10px] text-mac-red">{error}</div>}

      <div className="space-y-4 max-w-5xl">
        {/* Status + New Job */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Scheduler Status */}
          <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
            <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-primary">schedule</span>
              {s.scheduler}
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3 text-center">
                <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.enabled}</p>
                <p className={`text-sm font-bold mt-0.5 ${status?.enabled ? 'text-mac-green' : 'text-slate-400'}`}>{status ? (status.enabled ? s.enabled : s.disabled) : s.na}</p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3 text-center">
                <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.jobs}</p>
                <p className="text-sm font-bold text-slate-700 dark:text-white/70 mt-0.5">{status?.jobs ?? na}</p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 p-3 text-center">
                <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.nextWake}</p>
                <p className="text-[10px] font-bold text-primary mt-0.5">{fmtRelative(status?.nextWakeAtMs, s)}</p>
              </div>
            </div>
          </div>

          {/* New Job Form (collapsible) */}
          {showForm && (
            <div className="rounded-2xl border border-primary/20 bg-white dark:bg-white/[0.02] p-4">
              <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px] text-primary">add_task</span>
                {s.newJob}
              </h3>
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.name}</span>
                    <input value={form.name} onChange={e => patchForm({ name: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.agentId}</span>
                    <input value={form.agentId} onChange={e => patchForm({ agentId: e.target.value })} placeholder="default"
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.description}</span>
                  <input value={form.description} onChange={e => patchForm({ description: e.target.value })}
                    className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                </label>
                {/* Schedule */}
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.schedule}</span>
                    <CustomSelect value={form.scheduleKind} onChange={v => patchForm({ scheduleKind: v as ScheduleKind })}
                      options={[{ value: 'every', label: s.every }, { value: 'at', label: s.at }, { value: 'cron', label: s.cron }]}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70" />
                  </label>
                  {form.scheduleKind === 'every' && <>
                    <label className="block">
                      <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.every}</span>
                      <input value={form.everyAmount} onChange={e => patchForm({ everyAmount: e.target.value })}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">&nbsp;</span>
                      <CustomSelect value={form.everyUnit} onChange={v => patchForm({ everyUnit: v as any })}
                        options={[{ value: 'minutes', label: s.minutes }, { value: 'hours', label: s.hours }, { value: 'days', label: s.days }]}
                        className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70" />
                    </label>
                  </>}
                  {form.scheduleKind === 'at' && <>
                    <label className="block col-span-2">
                      <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.at}</span>
                      <input type="datetime-local" value={form.scheduleAt} onChange={e => patchForm({ scheduleAt: e.target.value })}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                    </label>
                  </>}
                  {form.scheduleKind === 'cron' && <>
                    <label className="block">
                      <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.cronExpr}</span>
                      <input value={form.cronExpr} onChange={e => patchForm({ cronExpr: e.target.value })}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] font-mono text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.timezone}</span>
                      <input value={form.cronTz} onChange={e => patchForm({ cronTz: e.target.value })} placeholder="UTC"
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                    </label>
                  </>}
                </div>
                {/* Session + Wake + Payload */}
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.session}</span>
                    <CustomSelect value={form.sessionTarget} onChange={v => patchForm({ sessionTarget: v as SessionTarget })}
                      options={[{ value: 'main', label: s.main }, { value: 'isolated', label: s.isolated }]}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.wakeMode}</span>
                    <CustomSelect value={form.wakeMode} onChange={v => patchForm({ wakeMode: v as WakeMode })}
                      options={[{ value: 'now', label: s.now }, { value: 'next-heartbeat', label: s.nextHeartbeat }]}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.payload}</span>
                    <CustomSelect value={form.payloadKind} onChange={v => patchForm({ payloadKind: v as PayloadKind })}
                      options={[{ value: 'systemEvent', label: s.systemEvent }, { value: 'agentTurn', label: s.agentTurn }]}
                      className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70" />
                  </label>
                </div>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{form.payloadKind === 'systemEvent' ? s.systemText : s.agentMessage}</span>
                  <textarea value={form.payloadText} onChange={e => patchForm({ payloadText: e.target.value })} rows={3}
                    className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30" />
                </label>
                {/* Delivery (agent turn only) */}
                {form.payloadKind === 'agentTurn' && (
                  <div className="grid grid-cols-4 gap-2">
                    <label className="block">
                      <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.delivery}</span>
                      <CustomSelect value={form.deliveryMode} onChange={v => patchForm({ deliveryMode: v as DeliveryMode })}
                        options={[{ value: 'announce', label: s.announce }, { value: 'none', label: s.none }]}
                        className="w-full mt-0.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70" />
                    </label>
                    <label className="block">
                      <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.timeout}</span>
                      <input value={form.timeoutSeconds} onChange={e => patchForm({ timeoutSeconds: e.target.value })}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                    </label>
                    {form.deliveryMode === 'announce' && <>
                      <label className="block">
                        <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.channel}</span>
                        <input value={form.deliveryChannel} onChange={e => patchForm({ deliveryChannel: e.target.value })} placeholder="last"
                          className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{s.to}</span>
                        <input value={form.deliveryTo} onChange={e => patchForm({ deliveryTo: e.target.value })} placeholder="+1555..."
                          className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                      </label>
                    </>}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.enabled} onChange={e => patchForm({ enabled: e.target.checked })} className="accent-primary" />
                    <span className="text-[10px] text-slate-500 dark:text-white/40">{s.enabled}</span>
                  </label>
                  <button onClick={addJob} disabled={busy} className="px-4 py-1.5 rounded-lg bg-primary text-white text-[11px] font-bold disabled:opacity-40">{busy ? s.saving : s.addJob}</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Jobs List */}
        <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
          <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-primary">list_alt</span>
            {s.jobs} ({jobs.length})
          </h3>
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
                return (
                  <div key={job.id} onClick={() => loadRuns(job.id)}
                    className={`px-3.5 py-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-primary/30 bg-primary/[0.03]' : 'border-slate-200/60 dark:border-white/[0.06] bg-slate-50 dark:bg-white/[0.02] hover:border-primary/20'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] font-bold text-slate-700 dark:text-white/70 truncate">{job.name}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${job.enabled ? 'bg-mac-green/10 text-mac-green' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                            {job.enabled ? s.enabled : s.disabled}
                          </span>
                          {job.deleteAfterRun && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-mac-yellow/10 text-mac-yellow font-bold shrink-0">{s.deleteAfterRun}</span>}
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
                        <div className="flex gap-1 mt-1 justify-end">
                          <button onClick={e => { e.stopPropagation(); toggleJob(job); }} disabled={busy}
                            className="text-[11px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-primary disabled:opacity-30">{job.enabled ? s.disable : s.enable}</button>
                          <button onClick={e => { e.stopPropagation(); runJob(job); }} disabled={busy}
                            className="text-[11px] px-2 py-0.5 rounded bg-primary/10 text-primary font-bold disabled:opacity-30">{s.run}</button>
                          <button onClick={e => { e.stopPropagation(); removeJob(job); }} disabled={busy}
                            className="text-[11px] px-2 py-0.5 rounded bg-mac-red/10 text-mac-red disabled:opacity-30">{s.remove}</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Run History */}
        <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
          <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[14px] text-indigo-500">history</span>
            {s.runHistory}
            {selectedJobName && <span className="text-[11px] font-normal text-slate-400 dark:text-white/35">— {selectedJobName}</span>}
          </h3>
          {!runsJobId ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-3xl mb-2">touch_app</span>
              <p className="text-[11px] font-bold mb-1">{s.selectJob}</p>
              <p className="text-[10px] text-center">{s.selectJobHint}</p>
            </div>
          ) : sortedRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-3xl mb-2">history</span>
              <p className="text-[11px] font-bold mb-1">{s.noRuns}</p>
              <p className="text-[10px] text-center">{s.noRunsHint}</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {sortedRuns.slice(0, 20).map((run: any, i: number) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-100 dark:border-white/5">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${run.status === 'ok' ? 'bg-mac-green' : run.status === 'error' ? 'bg-mac-red' : 'bg-mac-yellow'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold ${run.status === 'ok' ? 'text-mac-green' : run.status === 'error' ? 'text-mac-red' : 'text-mac-yellow'}`}>{run.status === 'ok' ? s.ok : run.status === 'error' ? s.error : s.skipped}</span>
                      {run.durationMs != null && <span className="text-[11px] text-slate-400 dark:text-white/35">{run.durationMs}ms</span>}
                    </div>
                    {run.summary && <p className="text-[11px] text-slate-500 dark:text-white/40 truncate mt-0.5">{run.summary}</p>}
                    {run.error && <p className="text-[11px] text-mac-red truncate mt-0.5">{run.error}</p>}
                  </div>
                  <span className="text-[11px] text-slate-400 dark:text-white/20 shrink-0">{run.ts ? new Date(run.ts).toLocaleString() : na}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
};

export default Scheduler;
