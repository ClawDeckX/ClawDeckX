import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { snapshotApi, type SnapshotStatsResponse } from '../../services/api';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import CustomSelect from '../../components/CustomSelect';
import NumberStepper from '../../components/NumberStepper';

interface SnapshotSummary {
  id?: string; snapshot_id?: string; note?: string; trigger?: string;
  created_at?: string; size_bytes?: number; resource_count?: number;
  resource_ids?: string[]; resource_paths?: string[];
}
interface SnapshotResource { id: string; display_name?: string; type?: string; }
interface SnapshotConfigField { path: string; kind?: string; }
interface SnapshotUnlockResult {
  preview_token?: string; previewToken?: string;
  resources?: SnapshotResource[];
  config_fields?: SnapshotConfigField[]; configFields?: SnapshotConfigField[];
}

function getTopLevelConfigPath(path: string): string {
  const m = path.match(/^[^.[\]]+/);
  return m?.[0] || path;
}

export interface SnapshotTabProps { s: any; inputCls: string; labelCls: string; rowCls: string; }

const SnapshotTab: React.FC<SnapshotTabProps> = ({ s, inputCls, labelCls, rowCls }) => {
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotPassword, setSnapshotPassword] = useState('');
  const [snapshotNote, setSnapshotNote] = useState('');
  const [snapshotModeTab, setSnapshotModeTab] = useState<'manual' | 'scheduled'>('manual');
  const [snapshotScheduleEnabled, setSnapshotScheduleEnabled] = useState(false);
  const [snapshotScheduleTime, setSnapshotScheduleTime] = useState('03:00');
  const [snapshotScheduleRetention, setSnapshotScheduleRetention] = useState(7);
  const [snapshotSchedulePassword, setSnapshotSchedulePassword] = useState('');
  const [snapshotSchedulePasswordSet, setSnapshotSchedulePasswordSet] = useState(false);
  const [snapshotScheduleStatus, setSnapshotScheduleStatus] = useState<any>(null);
  const [snapshotScheduleSaving, setSnapshotScheduleSaving] = useState(false);
  const [runNowBusy, setRunNowBusy] = useState(false);
  const [expandedSnapshotFiles, setExpandedSnapshotFiles] = useState<Record<string, boolean>>({});
  const [snapshotListLimit, setSnapshotListLimit] = useState(20);
  const [snapshotImporting, setSnapshotImporting] = useState(false);
  const snapshotImportRef = useRef<HTMLInputElement>(null);
  const snapshotScheduleTimeOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 15) {
      const t = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      options.push({ value: t, label: t });
    }
    if (snapshotScheduleTime && !options.some(o => o.value === snapshotScheduleTime))
      return [{ value: snapshotScheduleTime, label: snapshotScheduleTime }, ...options];
    return options;
  }, [snapshotScheduleTime]);

  // Stats dashboard
  const [stats, setStats] = useState<SnapshotStatsResponse | null>(null);
  // Batch management
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [filterTrigger, setFilterTrigger] = useState<string>('all');
  const [pruneKeepN, setPruneKeepN] = useState(5);
  const [showPruneDialog, setShowPruneDialog] = useState(false);
  // Verify
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; error?: string; verified_count?: number } | null>(null);
  const [showVerifyModal, setShowVerifyModal] = useState<string | null>(null);
  // OpenClaw import
  const [showOcImportModal, setShowOcImportModal] = useState(false);
  const [ocImportFile, setOcImportFile] = useState<File | null>(null);
  const [ocImportPassword, setOcImportPassword] = useState('');
  const [ocImportNote, setOcImportNote] = useState('');
  const [ocImporting, setOcImporting] = useState(false);
  const ocImportRef = useRef<HTMLInputElement>(null);
  // OpenClaw export
  const [showOcExportModal, setShowOcExportModal] = useState<string | null>(null);
  const [ocExportPassword, setOcExportPassword] = useState('');
  const [ocExporting, setOcExporting] = useState(false);

  const [restoreTarget, setRestoreTarget] = useState<SnapshotSummary | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreUnlocked, setRestoreUnlocked] = useState<SnapshotUnlockResult | null>(null);
  const [restoreSelectedFiles, setRestoreSelectedFiles] = useState<string[]>([]);
  const [restoreSelectedConfigPaths, setRestoreSelectedConfigPaths] = useState<string[]>([]);
  const [restorePlan, setRestorePlan] = useState<{ will_modify_files?: number; will_modify_config_paths?: number; warnings?: string[] } | null>(null);
  const [restoreSearchQuery, setRestoreSearchQuery] = useState('');
  const [restoreStep, setRestoreStep] = useState(0);
  const [restoreProgress, setRestoreProgress] = useState<{ current: number; total: number; phase: string; file?: string } | null>(null);

  const fetchSnapshots = useCallback((force = false) => {
    snapshotApi.listCached(10000, force).then((data: any) => setSnapshots(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);
  const fetchSnapshotSchedule = useCallback(() => {
    snapshotApi.getSchedule().then((cfg: any) => {
      setSnapshotScheduleEnabled(!!cfg?.enabled);
      setSnapshotScheduleTime(cfg?.time || '03:00');
      setSnapshotScheduleRetention(Math.max(1, Number(cfg?.retentionCount || 7)));
      setSnapshotSchedulePasswordSet(!!cfg?.passwordSet);
    }).catch(() => {});
    snapshotApi.getScheduleStatus().then((st: any) => setSnapshotScheduleStatus(st || null)).catch(() => {});
  }, []);

  const fetchStats = useCallback(() => {
    snapshotApi.stats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => { fetchSnapshots(); fetchSnapshotSchedule(); fetchStats(); }, [fetchSnapshots, fetchSnapshotSchedule, fetchStats]);

  const refreshAll = useCallback((force = true) => { fetchSnapshots(force); fetchStats(); }, [fetchSnapshots, fetchStats]);

  // Filtered snapshot list
  const filteredSnapshots = useMemo(() => {
    if (filterTrigger === 'all') return snapshots;
    return snapshots.filter(b => b.trigger === filterTrigger);
  }, [snapshots, filterTrigger]);

  // Batch management handlers
  const toggleBatchItem = (id: string) => {
    setBatchSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const handleBatchDelete = async () => {
    if (batchSelected.size === 0) return;
    const ids = Array.from(batchSelected);
    const ok = await confirm({ title: s.snapshotBatchDelete || 'Batch Delete', message: (s.snapshotBatchDeleteConfirm || 'Delete {n} selected backups?').replace('{n}', String(ids.length)), confirmText: s.delete || 'Delete', danger: true });
    if (!ok) return;
    try { await snapshotApi.batchDelete(ids); toast('success', (s.snapshotBatchDeleteOk || 'Deleted {n} backups').replace('{n}', String(ids.length))); setBatchSelected(new Set()); refreshAll(); }
    catch (err: any) { toast('error', err?.message || s.deleteFailed || 'Delete failed'); }
  };
  const handlePrune = async () => {
    const ok = await confirm({ title: s.snapshotPrune || 'Cleanup Backups', message: (s.snapshotPruneConfirm || 'Keep the latest {n} backups and delete the rest?').replace('{n}', String(pruneKeepN)), confirmText: s.snapshotPrune || 'Cleanup', danger: true });
    if (!ok) return;
    try { const result = await snapshotApi.pruneKeepN(pruneKeepN); toast('success', (s.snapshotPruneOk || 'Deleted {n} old backups').replace('{n}', String(result.deleted?.length || 0))); setShowPruneDialog(false); refreshAll(); }
    catch (err: any) { toast('error', err?.message || s.deleteFailed || 'Cleanup failed'); }
  };

  // Verify integrity handler
  const handleVerify = async (snapshotID: string) => {
    if (!verifyPassword || verifyPassword.length < 6) { toast('error', s.snapshotPasswordTooShort || s.pwdTooShort); return; }
    setVerifyingId(snapshotID);
    try {
      const result = await snapshotApi.verify(snapshotID, verifyPassword);
      setVerifyResult(result);
    } catch (err: any) { toast('error', err?.message || 'Verify failed'); }
    finally { setVerifyingId(null); }
  };

  // OpenClaw import handler
  const handleOcImport = async () => {
    if (!ocImportFile) return;
    if (ocImportPassword.length < 6) { toast('error', s.snapshotPasswordTooShort || s.pwdTooShort); return; }
    setOcImporting(true);
    try {
      const result = await snapshotApi.importOpenClaw(ocImportFile, ocImportPassword, ocImportNote.trim() || undefined);
      toast('success', (s.snapshotOcImportOk || 'Imported OpenClaw backup: {n} resources').replace('{n}', String(result.resource_count)));
      setShowOcImportModal(false); setOcImportFile(null); setOcImportPassword(''); setOcImportNote(''); refreshAll();
    } catch (err: any) { toast('error', err?.message || s.snapshotImportFailed || 'Import failed'); }
    finally { setOcImporting(false); }
  };

  // OpenClaw export handler
  const handleOcExport = async (snapshotID: string) => {
    if (ocExportPassword.length < 6) { toast('error', s.snapshotPasswordTooShort || s.pwdTooShort); return; }
    setOcExporting(true);
    try {
      await snapshotApi.exportOpenClaw(snapshotID, ocExportPassword);
      toast('success', s.snapshotOcExportOk || 'Exported as OpenClaw format');
      setShowOcExportModal(null); setOcExportPassword('');
    } catch (err: any) { toast('error', err?.message || s.snapshotExportFailed || 'Export failed'); }
    finally { setOcExporting(false); }
  };

  const handleCreateSnapshot = async () => {
    if (!snapshotPassword || snapshotPassword.length < 6) { toast('error', s.snapshotPasswordTooShort || s.pwdTooShort); return; }
    setSnapshotLoading(true);
    try { await snapshotApi.create({ password: snapshotPassword, trigger: 'manual', note: snapshotNote.trim() || undefined }); toast('success', s.snapshotCreated || s.backupCreated); setSnapshotPassword(''); setSnapshotNote(''); refreshAll(); }
    catch { toast('error', s.snapshotCreateFailed || s.backupFailed); }
    finally { setSnapshotLoading(false); }
  };
  const handleImportSnapshot = async (file: File) => {
    if (!file || !file.name.endsWith('.clawbak')) { toast('error', s.snapshotImportInvalidFile || 'Please select a .clawbak file'); return; }
    setSnapshotImporting(true);
    try { await snapshotApi.importFile(file); toast('success', s.snapshotImportOk || 'Backup imported'); refreshAll(); }
    catch (err: any) { toast('error', err?.message || s.snapshotImportFailed || 'Import failed'); }
    finally { setSnapshotImporting(false); if (snapshotImportRef.current) snapshotImportRef.current.value = ''; }
  };
  const handleSaveSnapshotSchedule = async () => {
    if (!/^\d{2}:\d{2}$/.test(snapshotScheduleTime)) { toast('error', s.snapshotScheduleInvalidTime); return; }
    if (snapshotScheduleRetention < 1 || snapshotScheduleRetention > 365) { toast('error', s.snapshotScheduleInvalidRetention); return; }
    if (snapshotScheduleEnabled && !snapshotSchedulePasswordSet && snapshotSchedulePassword.length < 6) { toast('error', s.snapshotSchedulePasswordRequired); return; }
    if (snapshotSchedulePassword && snapshotSchedulePassword.length < 6) { toast('error', s.snapshotPasswordTooShort || s.pwdTooShort); return; }
    setSnapshotScheduleSaving(true);
    try { await snapshotApi.updateSchedule({ enabled: snapshotScheduleEnabled, time: snapshotScheduleTime, retentionCount: snapshotScheduleRetention, timezone: 'Local', password: snapshotSchedulePassword || undefined }); setSnapshotSchedulePassword(''); toast('success', s.snapshotScheduleSaved || s.saved); fetchSnapshotSchedule(); }
    catch (err: any) { toast('error', err?.message || s.snapshotScheduleSaveFailed || s.saveFailed); }
    finally { setSnapshotScheduleSaving(false); }
  };
  const openRestoreWizard = (target: SnapshotSummary) => { setRestoreTarget(target); setRestorePassword(''); setRestoreUnlocked(null); setRestoreSelectedFiles([]); setRestoreSelectedConfigPaths([]); setRestorePlan(null); setRestoreSearchQuery(''); setRestoreStep(0); };
  const closeRestoreWizard = () => { setRestoreTarget(null); setRestorePassword(''); setRestoreUnlocked(null); setRestoreSelectedFiles([]); setRestoreSelectedConfigPaths([]); setRestorePlan(null); setRestoreProgress(null); };
  const handleUnlockRestorePreview = async (): Promise<boolean> => {
    if (!restoreTarget) return false;
    const id = restoreTarget.id || restoreTarget.snapshot_id; if (!id) return false;
    if (!restorePassword || restorePassword.length < 6) { toast('error', s.snapshotPasswordTooShort || s.pwdTooShort); return false; }
    setSnapshotLoading(true);
    try {
      const unlocked = await snapshotApi.unlockPreview(id, restorePassword) as SnapshotUnlockResult;
      const cfgFields = unlocked?.config_fields || unlocked?.configFields || [];
      setRestoreUnlocked(unlocked);
      setRestoreSelectedFiles((unlocked?.resources || []).map(r => r.id));
      setRestoreSelectedConfigPaths(Array.from(new Set(cfgFields.map(f => getTopLevelConfigPath(f.path)).filter(Boolean))));
      setRestorePlan(null); toast('success', s.snapshotUnlockOk || s.restore); return true;
    } catch (err: any) { toast('error', err?.message || s.snapshotUnlockFailed || s.restoreFailed); return false; }
    finally { setSnapshotLoading(false); }
  };
  const handleBuildRestorePlan = async () => {
    if (!restoreTarget || !restoreUnlocked) return;
    const id = restoreTarget.id || restoreTarget.snapshot_id;
    const previewToken = restoreUnlocked.preview_token || restoreUnlocked.previewToken;
    if (!id || !previewToken) return;
    setSnapshotLoading(true);
    try { const plan = await snapshotApi.restorePlan(id, { previewToken, restoreSelections: { files: restoreSelectedFiles, config_paths: restoreSelectedConfigPaths } }) as any; setRestorePlan(plan || null); }
    catch { toast('error', s.snapshotPlanFailed || s.restoreFailed); }
    finally { setSnapshotLoading(false); }
  };
  const handleConfirmRestore = async () => {
    if (!restoreTarget || !restoreUnlocked) return;
    const id = restoreTarget.id || restoreTarget.snapshot_id;
    const previewToken = restoreUnlocked.preview_token || restoreUnlocked.previewToken;
    if (!id || !previewToken) return;
    const hasConfigPaths = restoreSelectedConfigPaths.length > 0;
    const ok = await confirm({ title: s.snapshotRestore || s.restore, message: hasConfigPaths ? (s.snapshotRestoreConfirmWithRestart || 'Restore will apply selected files and automatically restart the gateway. This may take a moment. Continue?') : (s.snapshotRestoreConfirm || 'Restore the selected backup items now? Current local files may be overwritten.'), confirmText: s.snapshotRestore || s.restore, danger: true });
    if (!ok) return;
    setSnapshotLoading(true);
    setRestoreProgress({ current: 0, total: 0, phase: 'starting' });
    try {
      const result = await snapshotApi.restoreStream(id, { previewToken, restorePlan: { files: restoreSelectedFiles, config_paths: restoreSelectedConfigPaths }, createPreRestoreSnapshot: true, password: restorePassword }, (evt) => {
        setRestoreProgress({ current: evt.current, total: evt.total, phase: evt.phase, file: evt.file });
      });
      setRestoreProgress(null); closeRestoreWizard(); fetchSnapshots(true);
      if (result?.gateway_restarted) {
        toast('success', s.snapshotRestoreOkRestarted || 'Restore completed and gateway has been restarted.');
      } else if (result?.gateway_restart_error) {
        toast('warning', (s.snapshotRestoreOkRestartFailed || 'Restore completed, but gateway restart failed: ') + result.gateway_restart_error);
      } else {
        toast('success', s.snapshotRestoreOk || s.restoreOk);
      }
    }
    catch (err: any) { setRestoreProgress(null); toast('error', err?.message || s.snapshotRestoreFailed || s.restoreFailed); }
    finally { setSnapshotLoading(false); }
  };
  const handleDeleteSnapshot = async (id: string) => {
    const ok = await confirm({ title: s.snapshotDelete || s.deleteBackup, message: s.snapshotDeleteConfirm || 'Are you sure?', confirmText: s.snapshotDelete || s.deleteBackup, danger: true });
    if (!ok) return;
    try { await snapshotApi.remove(id); refreshAll(); toast('success', s.deleted || s.deleteBackup); }
    catch (err: any) { toast('error', err?.message || s.deleteFailed); }
  };

  const fileChipStyle = (p: string) => {
    const lp = p.toLowerCase();
    if (lp.endsWith('.json') || lp.includes('config')) return { icon: 'settings', color: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400 border-blue-200/60 dark:border-blue-500/20' };
    if (lp.endsWith('.md')) return { icon: 'description', color: 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-400 border-purple-200/60 dark:border-purple-500/20' };
    if (lp.includes('persona')) return { icon: 'person', color: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400 border-amber-200/60 dark:border-amber-500/20' };
    if (lp.includes('credential')) return { icon: 'key', color: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400 border-rose-200/60 dark:border-rose-500/20' };
    if (lp.includes('.env')) return { icon: 'terminal', color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-500/20' };
    return { icon: 'draft', color: 'bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-white/50 border-slate-200/60 dark:border-white/10' };
  };
  const shortName = (p: string) => { const parts = p.replace(/^files\//, '').split('/'); return parts.length <= 2 ? parts.join('/') : `.../${parts.slice(-2).join('/')}`; };

  // Render helper for restore wizard modal - defined as a method to keep the return clean
  const renderRestoreWizard = () => {
    if (!restoreTarget) return null;
    const stepDone = (i: number) => i < restoreStep;
    const stepActive = (i: number) => i === restoreStep;
    const stepPanelCls = (i: number) => `border rounded-xl overflow-hidden transition-colors ${stepActive(i) ? 'border-primary/40 bg-white dark:bg-white/[0.02]' : stepDone(i) ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5' : 'border-slate-200 dark:border-white/[0.06] opacity-50'}`;
    const stepHeadCls = (i: number) => `flex items-center gap-2.5 px-4 py-3 ${stepDone(i) ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]' : ''}`;
    const stepNumCls = (i: number) => `w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${stepDone(i) ? 'bg-green-500 text-white' : stepActive(i) ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-400'}`;
    const q = restoreSearchQuery.toLowerCase().trim();
    const allFileIds = restoreUnlocked ? (restoreUnlocked.resources || []).map(r => r.id) : [];
    const allConfigPaths = restoreUnlocked ? Array.from(new Set((restoreUnlocked.config_fields || restoreUnlocked.configFields || []).map((f: any) => getTopLevelConfigPath(f.path)).filter(Boolean))) : [];
    const filteredResources = restoreUnlocked ? (q ? (restoreUnlocked.resources || []).filter(r => (r.display_name || r.id).toLowerCase().includes(q)) : (restoreUnlocked.resources || [])) : [];
    const filteredConfigPaths = q ? allConfigPaths.filter(p => p.toLowerCase().includes(q)) : allConfigPaths;
    const allFilesSelected = allFileIds.length > 0 && allFileIds.every(fid => restoreSelectedFiles.includes(fid));
    const allConfigSelected = allConfigPaths.length > 0 && allConfigPaths.every(p => restoreSelectedConfigPaths.includes(p));
    const wizardSteps = [{ icon: 'lock_open', label: s.restoreStepUnlock || 'Unlock Snapshot' }, { icon: 'checklist', label: s.restoreStepSelect || 'Select Content' }, { icon: 'settings_backup_restore', label: s.restoreStepConfirm || 'Confirm & Restore' }];

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeRestoreWizard} />
        <div className="relative mac-glass rounded-2xl shadow-2xl overflow-hidden animate-scale-in w-[480px] max-h-[85vh] flex flex-col backdrop-blur-3xl">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-200/20 dark:border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"><span className="material-symbols-outlined text-[18px] text-primary">settings_backup_restore</span></div>
              <p className="text-[14px] font-bold text-slate-800 dark:text-white">{s.snapshotRestoreWizard || 'Restore Wizard'}</p>
            </div>
            <button onClick={closeRestoreWizard} className="w-7 h-7 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center transition-colors"><span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/40">close</span></button>
          </div>
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-2">
            {/* Step 0 */}
            <div className={stepPanelCls(0)}>
              <div className={stepHeadCls(0)} onClick={() => stepDone(0) && setRestoreStep(0)}>
                <div className={stepNumCls(0)}>{stepDone(0) ? <span className="material-symbols-outlined text-[14px]">check</span> : 1}</div>
                <div className="min-w-0 flex-1"><p className="text-[12px] font-semibold text-slate-700 dark:text-white/80">{wizardSteps[0].label}</p>{stepDone(0) && <p className="text-[10px] text-green-600 dark:text-green-400 mt-0.5 truncate">{restoreTarget.note || restoreTarget.id || restoreTarget.snapshot_id}{restoreUnlocked ? ` · ${(restoreUnlocked.resources || []).length} ${s.snapshotFilesCount || 'files'}` : ''}</p>}</div>
                <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30">{wizardSteps[0].icon}</span>
              </div>
              {stepActive(0) && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="text-[11px] text-slate-500 dark:text-white/40 flex items-center gap-2"><span className="material-symbols-outlined text-[14px]">backup</span>{restoreTarget.note || restoreTarget.id || restoreTarget.snapshot_id}{restoreTarget.created_at && <span className="text-slate-400 dark:text-white/20">· {new Date(restoreTarget.created_at).toLocaleString()}</span>}</div>
                  <input type="password" value={restorePassword} onChange={e => setRestorePassword(e.target.value)} placeholder={s.snapshotPasswordPlaceholder || s.enterPassword || 'Password'} className={inputCls}
                    onKeyDown={async e => { if (e.key === 'Enter' && restorePassword.length >= 6) { const ok = await handleUnlockRestorePreview(); if (ok) setRestoreStep(1); } }} />
                  <div className="flex justify-end pt-1"><button onClick={async () => { const ok = await handleUnlockRestorePreview(); if (ok) setRestoreStep(1); }} disabled={snapshotLoading || restorePassword.length < 6} className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40">{s.snapshotUnlock || 'Unlock'} <span className="material-symbols-outlined text-[14px]">arrow_forward</span></button></div>
                </div>
              )}
            </div>
            {/* Step 1 */}
            <div className={stepPanelCls(1)}>
              <div className={stepHeadCls(1)} onClick={() => stepDone(1) && setRestoreStep(1)}>
                <div className={stepNumCls(1)}>{stepDone(1) ? <span className="material-symbols-outlined text-[14px]">check</span> : 2}</div>
                <div className="min-w-0 flex-1"><p className="text-[12px] font-semibold text-slate-700 dark:text-white/80">{wizardSteps[1].label}</p>{stepDone(1) && <p className="text-[10px] text-green-600 dark:text-green-400 mt-0.5">{restoreSelectedFiles.length} {s.snapshotFilesCount || 'files'} · {restoreSelectedConfigPaths.length} {s.snapshotConfigPathsCount || 'config paths'}</p>}</div>
                <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30">{wizardSteps[1].icon}</span>
              </div>
              {stepActive(1) && restoreUnlocked && (
                <div className="px-4 pb-4 space-y-3">
                  <input type="text" value={restoreSearchQuery} onChange={e => setRestoreSearchQuery(e.target.value)} placeholder={s.restoreSearchPlaceholder || 'Filter files and config paths...'} className={inputCls} />
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] font-semibold text-slate-600 dark:text-white/60 flex items-center gap-1"><span className="material-symbols-outlined text-[13px]">folder</span>{s.snapshotSelectFiles || 'Files'}<span className="text-[10px] font-normal text-slate-400 dark:text-white/30">({restoreSelectedFiles.length}/{allFileIds.length})</span></p>
                      <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => { if (allFilesSelected) setRestoreSelectedFiles([]); else setRestoreSelectedFiles(allFileIds); setRestorePlan(null); }}>{allFilesSelected ? (s.deselectAll || 'Deselect all') : (s.selectAll || 'Select all')}</button>
                    </div>
                    <div className="space-y-0.5 max-h-40 overflow-auto pe-1 rounded-lg border border-slate-100 dark:border-white/[0.06] p-2">
                      {filteredResources.map(r => { const checked = restoreSelectedFiles.includes(r.id); return (<label key={r.id} className={`flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-md transition-colors cursor-pointer ${checked ? 'bg-primary/5 text-primary dark:text-primary/90' : 'text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.03]'}`}><input type="checkbox" checked={checked} className="accent-primary" onChange={() => { setRestoreSelectedFiles(prev => checked ? prev.filter(x => x !== r.id) : [...prev, r.id]); setRestorePlan(null); }} /><span className="material-symbols-outlined text-[13px] opacity-50">{(r.display_name || r.id).toLowerCase().endsWith('.md') ? 'description' : (r.display_name || r.id).toLowerCase().endsWith('.json') ? 'settings' : 'draft'}</span><span className="truncate">{r.display_name || r.id}</span></label>); })}
                      {filteredResources.length === 0 && <p className="text-[10px] text-slate-400 dark:text-white/20 text-center py-2">{s.noResults || 'No matching files'}</p>}
                    </div>
                  </div>
                  {allConfigPaths.length > 0 && (<div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] font-semibold text-slate-600 dark:text-white/60 flex items-center gap-1"><span className="material-symbols-outlined text-[13px]">tune</span>{s.snapshotSelectConfigPaths || 'Config Paths'}<span className="text-[10px] font-normal text-slate-400 dark:text-white/30">({restoreSelectedConfigPaths.length}/{allConfigPaths.length})</span></p>
                      <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => { if (allConfigSelected) setRestoreSelectedConfigPaths([]); else setRestoreSelectedConfigPaths([...allConfigPaths]); setRestorePlan(null); }}>{allConfigSelected ? (s.deselectAll || 'Deselect all') : (s.selectAll || 'Select all')}</button>
                    </div>
                    <div className="space-y-0.5 max-h-36 overflow-auto pe-1 rounded-lg border border-slate-100 dark:border-white/[0.06] p-2">
                      {filteredConfigPaths.map(path => { const checked = restoreSelectedConfigPaths.includes(path); return (<label key={path} className={`flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-md transition-colors cursor-pointer ${checked ? 'bg-primary/5 text-primary dark:text-primary/90' : 'text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.03]'}`}><input type="checkbox" checked={checked} className="accent-primary" onChange={() => { setRestoreSelectedConfigPaths(prev => checked ? prev.filter(x => x !== path) : [...prev, path]); setRestorePlan(null); }} /><span className="material-symbols-outlined text-[13px] opacity-50">tune</span><span className="truncate">{path}</span></label>); })}
                      {filteredConfigPaths.length === 0 && <p className="text-[10px] text-slate-400 dark:text-white/20 text-center py-2">{s.noResults || 'No matching paths'}</p>}
                    </div>
                  </div>)}
                  <div className="flex justify-between pt-2 border-t border-slate-100 dark:border-white/[0.04]">
                    <button onClick={() => setRestoreStep(0)} className="px-4 py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-white/70 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">arrow_back</span> {s.back || 'Back'}</button>
                    <button onClick={() => { setRestoreStep(2); setRestorePlan(null); }} disabled={restoreSelectedFiles.length === 0 && restoreSelectedConfigPaths.length === 0} className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 disabled:opacity-40">{s.next || 'Next'} <span className="material-symbols-outlined text-[14px]">arrow_forward</span></button>
                  </div>
                </div>
              )}
            </div>
            {/* Step 2 */}
            <div className={stepPanelCls(2)}>
              <div className={stepHeadCls(2)}>
                <div className={stepNumCls(2)}>{stepDone(2) ? <span className="material-symbols-outlined text-[14px]">check</span> : 3}</div>
                <div className="min-w-0 flex-1"><p className="text-[12px] font-semibold text-slate-700 dark:text-white/80">{wizardSteps[2].label}</p></div>
                <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30">{wizardSteps[2].icon}</span>
              </div>
              {stepActive(2) && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="rounded-lg border border-slate-100 dark:border-white/[0.06] p-3 text-[11px] text-slate-600 dark:text-white/60 space-y-1.5">
                    <p className="font-semibold text-slate-700 dark:text-white/70">{s.restoreSummary || 'Restore Summary'}</p>
                    <div className="flex items-center gap-2"><span className="material-symbols-outlined text-[13px] text-blue-500">backup</span>{restoreTarget.note || restoreTarget.id || restoreTarget.snapshot_id}</div>
                    <div className="flex items-center gap-4 text-[10px]"><span className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">folder</span> {restoreSelectedFiles.length} {s.snapshotFilesCount || 'files'}</span><span className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">tune</span> {restoreSelectedConfigPaths.length} {s.snapshotConfigPathsCount || 'config paths'}</span></div>
                  </div>
                  {!restorePlan && (<div className="text-center py-2"><button onClick={handleBuildRestorePlan} disabled={snapshotLoading} className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1.5 mx-auto disabled:opacity-40"><span className={`material-symbols-outlined text-[14px] ${snapshotLoading ? 'animate-spin' : ''}`}>{snapshotLoading ? 'progress_activity' : 'assignment'}</span>{s.snapshotBuildPlan || 'Build Restore Plan'}</button><p className="text-[10px] text-slate-400 dark:text-white/30 mt-1.5">{s.restoreBuildPlanHint || 'Review what will be changed before restoring'}</p></div>)}
                  {restorePlan && (<div className="rounded-lg border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5 p-3 text-[11px] space-y-1.5"><p className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">check_circle</span>{s.restorePlanReady || 'Restore Plan Ready'}</p><div className="text-emerald-600 dark:text-emerald-400/80">{s.snapshotPlanFiles || 'Will modify files'}: <strong>{restorePlan.will_modify_files || 0}</strong></div><div className="text-emerald-600 dark:text-emerald-400/80">{s.snapshotPlanConfigPaths || 'Will modify config paths'}: <strong>{restorePlan.will_modify_config_paths || 0}</strong></div>
                    {(restorePlan.warnings || []).length > 0 && (() => { const warns = restorePlan.warnings || []; return (<details className="pt-1 text-amber-600 dark:text-amber-400"><summary className="flex items-center gap-1 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden"><span className="material-symbols-outlined text-[13px] shrink-0">warning</span><span className="font-semibold">{warns.length} {s.snapshotOverwriteWarning || 'files will be overwritten'}</span><span className="material-symbols-outlined text-[12px] ms-auto opacity-50 transition-transform [[open]>&]:rotate-180">expand_more</span></summary><div className="mt-1.5 max-h-32 overflow-auto rounded-md border border-amber-200/50 dark:border-amber-500/10 bg-amber-50/50 dark:bg-amber-500/5 p-2 space-y-0.5">{warns.map((w, i) => (<div key={i} className="flex items-center gap-1.5 text-[10px] text-amber-700 dark:text-amber-400/80"><span className="material-symbols-outlined text-[11px] opacity-50 shrink-0">draft</span><span className="truncate">{w}</span></div>))}</div></details>); })()}
                  </div>)}
                  {restoreProgress && (
                    <div className="rounded-lg border border-blue-200 dark:border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5 p-3 text-[11px] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-blue-700 dark:text-blue-400 flex items-center gap-1"><span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>{restoreProgress.phase === 'restarting' ? (s.restartingGateway || 'Restarting gateway...') : (s.restoring || 'Restoring...')}</span>
                        {restoreProgress.phase !== 'restarting' && <span className="text-blue-600 dark:text-blue-400/80 font-mono">{restoreProgress.current}/{restoreProgress.total}</span>}
                      </div>
                      <div className="w-full h-1.5 bg-blue-100 dark:bg-blue-500/10 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-300 ${restoreProgress.phase === 'restarting' ? 'bg-amber-500 dark:bg-amber-400 animate-pulse w-full' : 'bg-blue-500 dark:bg-blue-400'}`} style={restoreProgress.phase !== 'restarting' ? { width: `${restoreProgress.total > 0 ? (restoreProgress.current / restoreProgress.total) * 100 : 0}%` } : { width: '100%' }} />
                      </div>
                      {restoreProgress.file && <div className="text-[10px] text-blue-500/70 dark:text-blue-400/50 truncate flex items-center gap-1"><span className="material-symbols-outlined text-[11px]">{restoreProgress.phase === 'restarting' ? 'restart_alt' : restoreProgress.phase === 'pre_backup' ? 'backup' : restoreProgress.phase === 'config' ? 'settings' : 'draft'}</span>{restoreProgress.phase === 'restarting' ? (s.restartingGatewayHint || 'This may take a moment...') : restoreProgress.file}</div>}
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-slate-100 dark:border-white/[0.04]">
                    <button onClick={() => setRestoreStep(1)} disabled={!!restoreProgress} className="px-4 py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-white/70 flex items-center gap-1 disabled:opacity-30"><span className="material-symbols-outlined text-[14px]">arrow_back</span> {s.back || 'Back'}</button>
                    <button onClick={handleConfirmRestore} disabled={snapshotLoading || !restorePlan} className="px-5 py-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-40"><span className={`material-symbols-outlined text-[14px] ${snapshotLoading && restorePlan ? 'animate-spin' : ''}`}>{snapshotLoading && restorePlan ? 'progress_activity' : 'settings_backup_restore'}</span>{s.snapshotRestore || s.restore}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="space-y-5">
        <div className="flex items-start justify-between">
          <div><h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.snapshotTitle || s.backup}</h2><p className="text-[12px] text-slate-400 dark:text-white/40 mt-0.5">{s.snapshotDesc || s.backupDesc}</p></div>
          <div className="shrink-0 flex items-center gap-2">
            <input ref={snapshotImportRef} type="file" accept=".clawbak" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImportSnapshot(f); }} />
            <input ref={ocImportRef} type="file" accept=".tar.gz,.tgz" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { setOcImportFile(f); setShowOcImportModal(true); } if (ocImportRef.current) ocImportRef.current.value = ''; }} />
            <button onClick={() => snapshotImportRef.current?.click()} disabled={snapshotImporting} className="flex items-center gap-1.5 px-3 py-[6px] rounded-lg text-[12px] font-medium border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors disabled:opacity-40" title={s.snapshotImport || 'Import .clawbak'}><span className={`material-symbols-outlined text-[16px] ${snapshotImporting ? 'animate-spin' : ''}`}>{snapshotImporting ? 'progress_activity' : 'upload'}</span>{s.snapshotImport || 'Import'}</button>
            <button onClick={() => ocImportRef.current?.click()} className="flex items-center gap-1.5 px-3 py-[6px] rounded-lg text-[12px] font-medium border border-blue-200 dark:border-blue-500/20 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors" title={s.snapshotOcImport || 'Import OpenClaw .tar.gz'}><span className="material-symbols-outlined text-[16px]">inventory_2</span>.tar.gz</button>
          </div>
        </div>

        {/* Stats Dashboard */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={`${rowCls} px-3 py-2.5 flex items-center gap-2.5`}>
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center"><span className="material-symbols-outlined text-[18px] text-blue-500">backup</span></div>
              <div><p className="text-[18px] font-bold text-slate-800 dark:text-white leading-none">{stats.total_count}</p><p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5">{s.snapshotStatsTotal || 'Total Backups'}</p></div>
            </div>
            <div className={`${rowCls} px-3 py-2.5 flex items-center gap-2.5`}>
              <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center"><span className="material-symbols-outlined text-[18px] text-emerald-500">hard_drive</span></div>
              <div><p className="text-[18px] font-bold text-slate-800 dark:text-white leading-none">{stats.total_size_bytes > 1048576 ? `${(stats.total_size_bytes / 1048576).toFixed(1)} MB` : `${(stats.total_size_bytes / 1024).toFixed(1)} KB`}</p><p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5">{s.snapshotStatsSize || 'Storage Used'}</p></div>
            </div>
            <div className={`${rowCls} px-3 py-2.5 flex items-center gap-2.5`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stats.days_since_backup < 0 ? 'bg-red-100 dark:bg-red-500/15' : stats.days_since_backup > 7 ? 'bg-amber-100 dark:bg-amber-500/15' : 'bg-emerald-100 dark:bg-emerald-500/15'}`}><span className={`material-symbols-outlined text-[18px] ${stats.days_since_backup < 0 ? 'text-red-500' : stats.days_since_backup > 7 ? 'text-amber-500' : 'text-emerald-500'}`}>schedule</span></div>
              <div><p className={`text-[18px] font-bold leading-none ${stats.days_since_backup < 0 ? 'text-red-500' : stats.days_since_backup > 7 ? 'text-amber-500' : 'text-slate-800 dark:text-white'}`}>{stats.days_since_backup < 0 ? '—' : stats.days_since_backup === 0 ? (s.snapshotStatsToday || 'Today') : `${stats.days_since_backup}d`}</p><p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5">{s.snapshotStatsLastBackup || 'Last Backup'}</p></div>
            </div>
            <div className={`${rowCls} px-3 py-2.5 flex items-center gap-2.5`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stats.schedule_enabled ? 'bg-emerald-100 dark:bg-emerald-500/15' : 'bg-slate-100 dark:bg-white/[0.06]'}`}><span className={`material-symbols-outlined text-[18px] ${stats.schedule_enabled ? 'text-emerald-500' : 'text-slate-400 dark:text-white/30'}`}>event_repeat</span></div>
              <div><p className={`text-[18px] font-bold leading-none ${stats.schedule_enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-white/30'}`}>{stats.schedule_enabled ? (s.on || 'ON') : (s.off || 'OFF')}</p><p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5">{s.snapshotStatsSchedule || 'Auto Backup'}</p></div>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-white/[0.05] w-fit">
          <button type="button" onClick={() => setSnapshotModeTab('manual')} className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${snapshotModeTab === 'manual' ? 'bg-white dark:bg-white/10 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white/80'}`}>{s.snapshotManualTab || s.snapshotCreate || 'Manual backup'}</button>
          <button type="button" onClick={() => setSnapshotModeTab('scheduled')} className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${snapshotModeTab === 'scheduled' ? 'bg-white dark:bg-white/10 text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white/80'}`}>{s.snapshotScheduledTab || s.snapshotScheduleTitle || 'Scheduled backup'}</button>
        </div>

        {snapshotModeTab === 'manual' && (<div className={rowCls}><div className="px-4 py-3 space-y-3"><p className="text-[13px] font-semibold text-slate-700 dark:text-white/80">{s.snapshotCreate || s.createBackup}</p><div className="space-y-2"><input type="text" value={snapshotNote} onChange={e => setSnapshotNote(e.target.value)} placeholder={s.snapshotNotePlaceholder || s.snapshotNote || 'Snapshot note (optional)'} className={inputCls} /><input type="password" value={snapshotPassword} onChange={e => setSnapshotPassword(e.target.value)} placeholder={s.snapshotPasswordPlaceholder || s.enterPassword || 'Password'} className={inputCls} />
          {snapshotPassword.length > 0 && (() => { const len = snapshotPassword.length; const hasUpper = /[A-Z]/.test(snapshotPassword); const hasDigit = /\d/.test(snapshotPassword); const hasSpecial = /[^A-Za-z0-9]/.test(snapshotPassword); const score = (len >= 6 ? 1 : 0) + (len >= 10 ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSpecial ? 1 : 0); const label = score <= 1 ? (s.pwdStrengthWeak || 'Weak') : score <= 3 ? (s.pwdStrengthMedium || 'Medium') : (s.pwdStrengthStrong || 'Strong'); const color = score <= 1 ? 'bg-red-400' : score <= 3 ? 'bg-amber-400' : 'bg-emerald-400'; return (<div className="flex items-center gap-2 mt-1"><div className="flex-1 h-1 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden"><div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, score * 20)}%` }} /></div><span className="text-[10px] text-slate-400 dark:text-white/40 shrink-0">{label}</span></div>); })()}
        </div><div className="flex justify-end"><button onClick={handleCreateSnapshot} disabled={snapshotLoading || snapshotPassword.length < 6} className="flex items-center gap-1.5 px-4 py-[7px] bg-primary text-white rounded-lg text-[13px] font-medium transition-all disabled:opacity-40 hover:opacity-90 shadow-sm"><span className={`material-symbols-outlined text-[16px] ${snapshotLoading ? 'animate-spin' : ''}`}>{snapshotLoading ? 'progress_activity' : 'add'}</span>{s.snapshotCreate || s.createBackup}</button></div><p className="text-[11px] text-amber-700 dark:text-amber-400/80 leading-relaxed">{s.snapshotSecurityNote || s.backupSecurityNote}</p></div></div>)}

        {snapshotModeTab === 'scheduled' && (<div className={rowCls}><div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between"><p className="text-[13px] font-semibold text-slate-700 dark:text-white/80">{s.snapshotScheduleTitle || 'Scheduled Backup'}</p><button type="button" role="switch" aria-checked={snapshotScheduleEnabled} onClick={() => setSnapshotScheduleEnabled(prev => !prev)} className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${snapshotScheduleEnabled ? 'bg-primary' : 'bg-slate-300 dark:bg-white/20'}`}><span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transform transition-transform duration-200 ${snapshotScheduleEnabled ? 'translate-x-[18px] rtl:-translate-x-[18px]' : 'translate-x-[3px] rtl:-translate-x-[3px]'}`} /></button></div>
          <div className={`grid grid-cols-1 md:grid-cols-3 gap-2 transition-opacity ${snapshotScheduleEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
            <div><label className={labelCls}>{s.snapshotScheduleTime}</label><CustomSelect value={snapshotScheduleTime} onChange={setSnapshotScheduleTime} options={snapshotScheduleTimeOptions} placeholder={s.snapshotScheduleTimePlaceholder} className={`${inputCls} mt-1.5`} /></div>
            <div><label className={labelCls}>{s.snapshotScheduleRetention}</label><NumberStepper min={1} max={365} step={1} value={snapshotScheduleRetention} onChange={(v) => { if (v === '') { setSnapshotScheduleRetention(1); return; } const n = Number(v); if (Number.isNaN(n)) return; setSnapshotScheduleRetention(Math.max(1, Math.min(365, Math.round(n)))); }} className={`${inputCls} mt-1.5 h-9`} inputClassName="font-mono text-[12px]" /></div>
            <div><label className={labelCls}>{s.snapshotSchedulePassword}</label><input type="password" value={snapshotSchedulePassword} onChange={e => setSnapshotSchedulePassword(e.target.value)} placeholder={snapshotSchedulePasswordSet ? s.snapshotSchedulePasswordUpdate : s.snapshotPasswordPlaceholder} className={`${inputCls} mt-1.5`} /></div>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px]">{snapshotSchedulePasswordSet ? <><span className="inline-block w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-emerald-400/20" /><span className="text-emerald-600 dark:text-emerald-400">{s.snapshotSchedulePasswordSet}</span></> : <><span className="inline-block w-2 h-2 rounded-full bg-red-400 ring-2 ring-red-400/20" /><span className="text-red-500 dark:text-red-400">{s.snapshotSchedulePasswordUnset}</span></>}</span>
            <div className="flex items-center gap-2">
              <button onClick={async () => { if (runNowBusy) return; setRunNowBusy(true); try { await snapshotApi.scheduleRunNow(); toast('success', s.snapshotScheduleRunNowOk || 'Triggered'); fetchSnapshots(true); setTimeout(() => { snapshotApi.getScheduleStatus().then((st: any) => setSnapshotScheduleStatus(st || null)).catch(() => {}); }, 1500); } catch (err: any) { toast('error', err?.message || s.snapshotScheduleRunNowFail || 'Failed'); } finally { setRunNowBusy(false); } }} disabled={!snapshotScheduleEnabled || !snapshotSchedulePasswordSet || runNowBusy} className="flex items-center gap-1.5 px-3 py-[6px] rounded-lg text-[11px] font-bold border border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors disabled:opacity-40 disabled:pointer-events-none" title={s.snapshotScheduleRunNow || 'Run now'}><span className={`material-symbols-outlined text-[14px] ${runNowBusy ? 'animate-spin' : ''}`}>{runNowBusy ? 'progress_activity' : 'play_arrow'}</span>{runNowBusy ? (s.snapshotScheduleRunning || 'Running...') : (s.snapshotScheduleRunNow || 'Run Now')}</button>
              <button onClick={handleSaveSnapshotSchedule} disabled={snapshotScheduleSaving} className="flex items-center gap-1.5 px-4 py-[6px] bg-primary text-white rounded-lg text-[11px] font-bold transition-all disabled:opacity-40 hover:opacity-90 shadow-sm"><span className={`material-symbols-outlined text-[14px] ${snapshotScheduleSaving ? 'animate-spin' : ''}`}>{snapshotScheduleSaving ? 'progress_activity' : 'save'}</span>{s.save}</button>
            </div>
          </div>
          {snapshotScheduleStatus && (() => { const isRunning = snapshotScheduleStatus.running; const lastStatus = snapshotScheduleStatus.lastStatus; const statusIcon = isRunning ? 'sync' : lastStatus === 'success' ? 'check_circle' : lastStatus === 'failed' ? 'error' : lastStatus === 'skipped' ? 'skip_next' : 'schedule'; const statusColor = isRunning ? 'text-blue-500' : lastStatus === 'success' ? 'text-emerald-500' : lastStatus === 'failed' ? 'text-red-500' : 'text-slate-400 dark:text-white/30'; const statusText = isRunning ? s.snapshotScheduleStatusRunning : lastStatus === 'success' ? s.snapshotScheduleStatusSuccess : lastStatus === 'failed' ? s.snapshotScheduleStatusFailed : lastStatus === 'skipped' ? s.snapshotScheduleStatusSkipped : s.snapshotScheduleStatusNever; const statusBorder = isRunning ? 'border-blue-200 dark:border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5' : lastStatus === 'success' ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5' : lastStatus === 'failed' ? 'border-red-200 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5' : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03]'; return (<div className={`rounded-xl border p-3 text-[11px] space-y-2 ${statusBorder}`}><div className="flex items-center gap-2"><span className={`material-symbols-outlined text-[16px] ${statusColor} ${isRunning ? 'animate-spin' : ''}`}>{statusIcon}</span><span className={`font-semibold ${statusColor}`}>{s.snapshotScheduleStatus}: {statusText}</span></div><div className="space-y-1 text-slate-500 dark:text-white/40"><div className="flex flex-wrap gap-x-4 gap-y-1">{snapshotScheduleStatus.lastRunAt && (<div className="flex items-center gap-1.5"><span className="material-symbols-outlined text-[12px] opacity-50">schedule</span>{s.snapshotScheduleLastRun}: {new Date(snapshotScheduleStatus.lastRunAt).toLocaleString()}</div>)}{snapshotScheduleStatus.lastSuccessAt && (<div className="flex items-center gap-1.5"><span className="material-symbols-outlined text-[12px] opacity-50">check</span>{s.snapshotScheduleLastSuccess}: {new Date(snapshotScheduleStatus.lastSuccessAt).toLocaleString()}</div>)}</div>{snapshotScheduleStatus.lastSnapshotId && (<div className="flex items-center gap-1.5 min-w-0"><span className="material-symbols-outlined text-[12px] opacity-50 shrink-0">backup</span><span className="shrink-0">{s.snapshotScheduleLastSnapshot}:</span><span className="font-mono text-[10px] truncate">{snapshotScheduleStatus.lastSnapshotId}</span></div>)}</div>{snapshotScheduleStatus.lastError && (<div className="flex items-start gap-1.5 text-red-500 dark:text-red-400"><span className="material-symbols-outlined text-[12px] mt-0.5 shrink-0">warning</span><span>{s.snapshotScheduleLastError}: {snapshotScheduleStatus.lastError}</span></div>)}</div>); })()}
        </div></div>)}

        {/* Batch management toolbar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1.5">
            <select value={filterTrigger} onChange={e => setFilterTrigger(e.target.value)} className="px-2 py-1 rounded-lg text-[11px] border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] text-slate-600 dark:text-white/60">
              <option value="all">{s.snapshotFilterAll || 'All'}</option>
              <option value="manual">{s.snapshotFilterManual || 'Manual'}</option>
              <option value="scheduled">{s.snapshotFilterScheduled || 'Scheduled'}</option>
              <option value="import">{s.snapshotFilterImport || 'Imported'}</option>
              <option value="import_openclaw">OpenClaw</option>
              <option value="pre_restore">{s.snapshotFilterPreRestore || 'Pre-restore'}</option>
            </select>
            <button type="button" onClick={() => { setBatchMode(!batchMode); setBatchSelected(new Set()); }} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors ${batchMode ? 'border-primary/40 bg-primary/5 text-primary' : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:bg-slate-50 dark:hover:bg-white/5'}`}><span className="material-symbols-outlined text-[14px]">checklist</span>{s.snapshotBatchMode || 'Select'}</button>
          </div>
          <div className="flex items-center gap-1.5">
            {batchMode && batchSelected.size > 0 && (
              <button onClick={handleBatchDelete} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"><span className="material-symbols-outlined text-[14px]">delete_sweep</span>{s.snapshotBatchDelete || 'Delete'} ({batchSelected.size})</button>
            )}
            <button onClick={() => setShowPruneDialog(true)} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors"><span className="material-symbols-outlined text-[14px]">auto_delete</span>{s.snapshotPrune || 'Cleanup'}</button>
          </div>
        </div>

        <div className={rowCls}>
          {filteredSnapshots.length === 0 ? (<div className="flex flex-col items-center py-10 text-slate-300 dark:text-white/10"><span className="material-symbols-outlined text-4xl mb-2">cloud_off</span><span className="text-[12px] text-slate-400 dark:text-white/20">{s.snapshotEmpty || s.noBackups}</span></div>) : (<>
            {filteredSnapshots.slice(0, snapshotListLimit).map((b) => { const id = b.id || b.snapshot_id; if (!id) return null; return (<div key={id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                {batchMode && (<input type="checkbox" checked={batchSelected.has(id)} onChange={() => toggleBatchItem(id)} className="accent-primary shrink-0" />)}
                <span className="material-symbols-outlined text-[18px] text-emerald-500">backup</span>
                <div className="min-w-0"><div className="flex items-center gap-2"><p className="text-[13px] font-medium text-slate-700 dark:text-white/70 truncate">{b.note || id}</p>{b.trigger && b.trigger !== 'manual' && (<span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium leading-none ${b.trigger === 'scheduled' ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400' : b.trigger === 'pre_restore' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400' : b.trigger === 'import_openclaw' ? 'bg-cyan-100 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-400' : b.trigger === 'import' ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/50'}`}>{b.trigger === 'scheduled' ? (s.snapshotTriggerScheduled || 'Scheduled') : b.trigger === 'pre_restore' ? (s.snapshotTriggerPreRestore || 'Pre-restore') : b.trigger === 'import_openclaw' ? 'OpenClaw' : b.trigger === 'import' ? (s.snapshotTriggerImport || 'Imported') : b.trigger}</span>)}</div><p className="text-[10px] text-slate-400 dark:text-white/20">{b.created_at ? new Date(b.created_at).toLocaleString() : ''} {b.size_bytes ? `· ${(b.size_bytes / 1024).toFixed(1)} KB` : ''}</p>
                  {!!(b.resource_paths && b.resource_paths.length) && (() => { const isExpanded = !!expandedSnapshotFiles[id]; const total = b.resource_paths!.length; return (<div className="mt-1.5">{!isExpanded ? (<button type="button" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-white/40 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors border border-slate-200/60 dark:border-white/10" onClick={() => setExpandedSnapshotFiles(prev => ({ ...prev, [id]: true }))}><span className="material-symbols-outlined text-[12px]">folder_open</span>{total} {s.snapshotFilesCount || 'files'}<span className="material-symbols-outlined text-[10px] ms-0.5">expand_more</span></button>) : (<div className="space-y-1.5"><div className="flex flex-wrap gap-1">{b.resource_paths!.map((p, idx) => { const chip = fileChipStyle(p); return (<span key={idx} className={`inline-flex items-center gap-1 px-1.5 py-[2px] rounded-md text-[10px] font-medium border ${chip.color} transition-colors`} title={p}><span className="material-symbols-outlined text-[11px]">{chip.icon}</span>{shortName(p)}</span>); })}</div><button type="button" className="text-[10px] text-primary hover:underline" onClick={() => setExpandedSnapshotFiles(prev => ({ ...prev, [id]: false }))}>{s.snapshotShowLessFiles || 'Collapse'}</button></div>)}</div>); })()}
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => { setShowVerifyModal(id); setVerifyPassword(''); setVerifyResult(null); }} className="p-1.5 text-slate-400 hover:text-emerald-500 rounded-lg transition-colors" title={s.snapshotVerify || 'Verify'}><span className="material-symbols-outlined text-[16px]">verified</span></button>
                <button onClick={async () => { try { const resp = await fetch(snapshotApi.exportUrl(id), { method: 'POST', credentials: 'include' }); if (!resp.ok) { const errText = await resp.text().catch(() => ''); throw new Error(`HTTP ${resp.status}: ${errText || resp.statusText}`); } const disp = resp.headers.get('content-disposition') || ''; const fnMatch = disp.match(/filename="?([^";\s]+)"?/); const filename = fnMatch?.[1] || `backup-${new Date().toISOString().replace(/[T:]/g, '_').slice(0, 19)}.clawbak`; const blob = await resp.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); } catch (err: any) { toast('error', err?.message || s.snapshotExportFailed || 'Export failed'); } }} className="p-1.5 text-slate-400 hover:text-blue-500 rounded-lg transition-colors" title={s.snapshotExport || 'Export .clawbak'}><span className="material-symbols-outlined text-[16px]">download</span></button>
                <button onClick={() => { setShowOcExportModal(id); setOcExportPassword(''); }} className="p-1.5 text-slate-400 hover:text-cyan-500 rounded-lg transition-colors" title={s.snapshotOcExport || 'Export .tar.gz'}><span className="material-symbols-outlined text-[16px]">inventory_2</span></button>
                <button onClick={() => openRestoreWizard(b)} className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors" title={s.snapshotRestore || s.restore}><span className="material-symbols-outlined text-[16px]">settings_backup_restore</span></button>
                <button onClick={() => handleDeleteSnapshot(id)} className="p-1.5 text-slate-400 hover:text-mac-red rounded-lg transition-colors" title={s.snapshotDelete || s.deleteBackup}><span className="material-symbols-outlined text-[16px]">delete</span></button>
              </div>
            </div>); })}
            {filteredSnapshots.length > snapshotListLimit && (<div className="flex justify-center py-2"><button className="text-[11px] text-primary hover:underline" onClick={() => setSnapshotListLimit(prev => prev + 20)}>{s.snapshotShowMore || 'Show more'} ({filteredSnapshots.length - snapshotListLimit} {s.snapshotRemaining || 'remaining'})</button></div>)}
          </>)}
        </div>
      </div>
      {renderRestoreWizard()}

      {/* OpenClaw Import Modal */}
      {showOcImportModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { setShowOcImportModal(false); setOcImportFile(null); }} />
          <div className="relative mac-glass rounded-2xl shadow-2xl overflow-hidden animate-scale-in w-[400px] p-5 space-y-4">
            <div className="flex items-center justify-between"><p className="text-[14px] font-bold text-slate-800 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-[18px] text-cyan-500">inventory_2</span>{s.snapshotOcImportTitle || 'Import OpenClaw Backup'}</p><button onClick={() => { setShowOcImportModal(false); setOcImportFile(null); }} className="w-7 h-7 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"><span className="material-symbols-outlined text-[16px] text-slate-400">close</span></button></div>
            <div className="text-[11px] text-slate-500 dark:text-white/40 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06]"><span className="material-symbols-outlined text-[14px]">draft</span>{ocImportFile?.name || '—'}<span className="text-slate-400 dark:text-white/20 ms-auto">{ocImportFile ? `${(ocImportFile.size / 1024).toFixed(1)} KB` : ''}</span></div>
            <input type="text" value={ocImportNote} onChange={e => setOcImportNote(e.target.value)} placeholder={s.snapshotNotePlaceholder || 'Note (optional)'} className={inputCls} />
            <input type="password" value={ocImportPassword} onChange={e => setOcImportPassword(e.target.value)} placeholder={s.snapshotOcImportPwdHint || 'Set password for encrypted storage (min 6 chars)'} className={inputCls} />
            <p className="text-[10px] text-amber-600 dark:text-amber-400/80">{s.snapshotOcImportNote || 'The .tar.gz backup will be re-encrypted with your password and stored securely.'}</p>
            <div className="flex justify-end"><button onClick={handleOcImport} disabled={ocImporting || !ocImportFile || ocImportPassword.length < 6} className="flex items-center gap-1.5 px-4 py-[7px] bg-primary text-white rounded-lg text-[12px] font-medium transition-all disabled:opacity-40 hover:opacity-90"><span className={`material-symbols-outlined text-[16px] ${ocImporting ? 'animate-spin' : ''}`}>{ocImporting ? 'progress_activity' : 'upload'}</span>{s.snapshotOcImportBtn || 'Import & Encrypt'}</button></div>
          </div>
        </div>
      )}

      {/* OpenClaw Export Modal */}
      {showOcExportModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowOcExportModal(null)} />
          <div className="relative mac-glass rounded-2xl shadow-2xl overflow-hidden animate-scale-in w-[380px] p-5 space-y-4">
            <div className="flex items-center justify-between"><p className="text-[14px] font-bold text-slate-800 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-[18px] text-cyan-500">inventory_2</span>{s.snapshotOcExportTitle || 'Export as OpenClaw Format'}</p><button onClick={() => setShowOcExportModal(null)} className="w-7 h-7 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"><span className="material-symbols-outlined text-[16px] text-slate-400">close</span></button></div>
            <p className="text-[11px] text-slate-500 dark:text-white/40">{s.snapshotOcExportDesc || 'Decrypt and export as a standard .tar.gz archive with manifest.json, compatible with OpenClaw CLI.'}</p>
            <input type="password" value={ocExportPassword} onChange={e => setOcExportPassword(e.target.value)} placeholder={s.snapshotPasswordPlaceholder || 'Enter backup password'} className={inputCls} />
            <div className="flex justify-end"><button onClick={() => handleOcExport(showOcExportModal)} disabled={ocExporting || ocExportPassword.length < 6} className="flex items-center gap-1.5 px-4 py-[7px] bg-primary text-white rounded-lg text-[12px] font-medium transition-all disabled:opacity-40 hover:opacity-90"><span className={`material-symbols-outlined text-[16px] ${ocExporting ? 'animate-spin' : ''}`}>{ocExporting ? 'progress_activity' : 'download'}</span>{s.snapshotOcExportBtn || 'Export .tar.gz'}</button></div>
          </div>
        </div>
      )}

      {/* Verify Integrity Modal */}
      {showVerifyModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowVerifyModal(null)} />
          <div className="relative mac-glass rounded-2xl shadow-2xl overflow-hidden animate-scale-in w-[380px] p-5 space-y-4">
            <div className="flex items-center justify-between"><p className="text-[14px] font-bold text-slate-800 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-[18px] text-emerald-500">verified</span>{s.snapshotVerifyTitle || 'Verify Backup Integrity'}</p><button onClick={() => setShowVerifyModal(null)} className="w-7 h-7 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"><span className="material-symbols-outlined text-[16px] text-slate-400">close</span></button></div>
            <input type="password" value={verifyPassword} onChange={e => setVerifyPassword(e.target.value)} placeholder={s.snapshotPasswordPlaceholder || 'Enter backup password'} className={inputCls} onKeyDown={e => { if (e.key === 'Enter' && verifyPassword.length >= 6) handleVerify(showVerifyModal); }} />
            {verifyResult && (
              <div className={`rounded-lg border p-3 text-[11px] space-y-1 ${verifyResult.ok ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5' : 'border-red-200 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5'}`}>
                <p className={`font-semibold flex items-center gap-1 ${verifyResult.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}><span className="material-symbols-outlined text-[14px]">{verifyResult.ok ? 'check_circle' : 'error'}</span>{verifyResult.ok ? (s.snapshotVerifyOk || 'Integrity check passed') : (s.snapshotVerifyFail || 'Integrity check failed')}</p>
                {verifyResult.ok && <p className="text-emerald-600 dark:text-emerald-400/80">{verifyResult.verified_count} {s.snapshotVerifyFiles || 'files verified (SHA256)'}</p>}
                {verifyResult.error && <p className="text-red-600 dark:text-red-400/80">{verifyResult.error}</p>}
              </div>
            )}
            <div className="flex justify-end"><button onClick={() => handleVerify(showVerifyModal)} disabled={!!verifyingId || verifyPassword.length < 6} className="flex items-center gap-1.5 px-4 py-[7px] bg-primary text-white rounded-lg text-[12px] font-medium transition-all disabled:opacity-40 hover:opacity-90"><span className={`material-symbols-outlined text-[16px] ${verifyingId ? 'animate-spin' : ''}`}>{verifyingId ? 'progress_activity' : 'verified'}</span>{s.snapshotVerifyBtn || 'Verify'}</button></div>
          </div>
        </div>
      )}

      {/* Prune / Cleanup Dialog */}
      {showPruneDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowPruneDialog(false)} />
          <div className="relative mac-glass rounded-2xl shadow-2xl overflow-hidden animate-scale-in w-[380px] p-5 space-y-4">
            <div className="flex items-center justify-between"><p className="text-[14px] font-bold text-slate-800 dark:text-white flex items-center gap-2"><span className="material-symbols-outlined text-[18px] text-amber-500">auto_delete</span>{s.snapshotPruneTitle || 'Cleanup Old Backups'}</p><button onClick={() => setShowPruneDialog(false)} className="w-7 h-7 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center"><span className="material-symbols-outlined text-[16px] text-slate-400">close</span></button></div>
            <p className="text-[11px] text-slate-500 dark:text-white/40">{s.snapshotPruneDesc || 'Keep the most recent N backups and delete all older ones.'}</p>
            <div className="flex items-center gap-3"><label className="text-[12px] font-medium text-slate-600 dark:text-white/60 shrink-0">{s.snapshotPruneKeep || 'Keep latest'}</label><NumberStepper min={1} max={100} step={1} value={pruneKeepN} onChange={(v) => { const n = Number(v); if (!Number.isNaN(n)) setPruneKeepN(Math.max(1, Math.min(100, Math.round(n)))); }} className={`${inputCls} h-9 flex-1`} inputClassName="font-mono text-[12px]" /></div>
            {snapshots.length > pruneKeepN && <p className="text-[11px] text-amber-600 dark:text-amber-400/80 flex items-center gap-1"><span className="material-symbols-outlined text-[13px]">warning</span>{(s.snapshotPruneWarn || '{n} backups will be deleted').replace('{n}', String(snapshots.length - pruneKeepN))}</p>}
            <div className="flex justify-end"><button onClick={handlePrune} disabled={snapshots.length <= pruneKeepN} className="flex items-center gap-1.5 px-4 py-[7px] bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[12px] font-medium transition-all disabled:opacity-40"><span className="material-symbols-outlined text-[16px]">auto_delete</span>{s.snapshotPruneBtn || 'Cleanup Now'}</button></div>
          </div>
        </div>
      )}
    </>
  );
};

export default SnapshotTab;
