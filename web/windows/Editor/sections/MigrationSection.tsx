import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SectionProps } from '../sectionTypes';
import { migrateApi, snapshotApi, type MigratePlan, type MigrateApplyResult, type MigrateDetectResult, type MigrateProvider, type MigrateItem, type RemoteOpenClawImportRequest, type RemoteOpenClawImportResult } from '../../../services/api';
import { getTranslation } from '../../../locales';
import { useToast } from '../../../components/Toast';
import { dispatchOpenWindow } from '../../../types';

// Claude / Hermes -> OpenClaw 一键导入向导。样式参考 HermesDeckX/web/windows/Editor/sections/MigrationSection.tsx
// （反方向：HermesDeckX 是 OpenClaw->Hermes，这里是 Claude/Hermes->OpenClaw）。
// 5 步：选 provider -> 配置 --from / 选项 -> preview plan -> apply -> report

type Step = 1 | 2 | 3 | 4 | 5;

const META: Record<string, { icon: string; tag: string; color: string }> = {
  claude: { icon: 'smart_toy', tag: 'Claude / Claude Desktop / Claude Code', color: 'text-amber-500' },
  hermes: { icon: 'memory', tag: 'HermesAgent', color: 'text-violet-500' },
};

const STATUS_MAP: Record<string, [string, string]> = {
  'mapped': ['emerald', 'mapped'], 'applied': ['emerald', 'applied'],
  'conflict': ['rose', 'conflict'], 'skipped': ['slate', 'skipped'],
  'archive': ['slate', 'archive'], 'archived': ['slate', 'archived'],
  'manual-review': ['amber', 'manual-review'], 'manual_review': ['amber', 'manual-review'],
  'error': ['rose', 'error'], 'sensitive': ['amber', 'sensitive'],
};

function kindIcon(kind: string): string {
  const map: Record<string, string> = {
    config: 'tune', mcp_server: 'hub', skill: 'auto_awesome', agent: 'smart_toy',
    workspace: 'folder', memory: 'neurology', credential: 'key', secret: 'key', archive: 'archive',
  };
  return map[kind] || 'extension';
}

const StatusBadge: React.FC<{ status: string; m: any }> = ({ status, m }) => {
  const [c, defLabel] = STATUS_MAP[status] || ['slate', status];
  const label = (m && m[`status_${status.replace(/-/g, '_')}`]) || defLabel;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded bg-${c}-500/10 text-${c}-500 border border-${c}-500/30`}>{label}</span>;
};

const Pill: React.FC<{ color: string; icon: string; value: number; label: string }> = ({ color, icon, value, label }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md bg-${color}-500/10 text-${color}-500 border border-${color}-500/30`}>
    <span className="material-symbols-outlined text-[14px]">{icon}</span>
    <span className="font-bold">{value}</span><span>{label}</span>
  </span>
);

const SummaryStat: React.FC<{ color: string; label: string; value: number }> = ({ color, label, value }) => (
  <div className={`rounded-lg border border-${color}-500/20 bg-${color}-500/5 p-3`}>
    <div className={`text-[10px] font-bold text-${color}-500 mb-0.5`}>{label}</div>
    <div className="text-xl font-bold theme-text font-mono">{value}</div>
  </div>
);

const StepIndicator: React.FC<{ step: Step; labels: string[] }> = ({ step, labels }) => (
  <ol className="flex items-center gap-2 text-xs">
    {labels.map((label, i) => {
      const n = (i + 1) as Step;
      const active = step === n; const done = step > n;
      return (
        <li key={i} className="flex items-center gap-2 flex-1 min-w-0">
          <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] ${
            done ? 'bg-cyan-500 text-white' : active ? 'bg-cyan-400 text-white ring-2 ring-cyan-400/40' : 'bg-slate-200 dark:bg-white/10 theme-text-muted'
          }`}>{done ? '✓' : n}</span>
          <span className={`truncate ${active ? 'theme-text font-semibold' : 'theme-text-muted'}`}>{label}</span>
          {i < labels.length - 1 && <span className="flex-shrink-0 w-4 h-px bg-slate-300 dark:bg-white/10" />}
        </li>
      );
    })}
  </ol>
);

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <label className="block text-xs font-semibold theme-text-secondary mb-1">{label}</label>
    {children}
    {hint && <div className="text-[11px] theme-text-muted mt-1">{hint}</div>}
  </div>
);

const GroupPanel: React.FC<{ kind: string; items: MigrateItem[]; m: any }> = ({ kind, items, m }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="sci-card rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full px-4 py-2 flex items-center justify-between text-sm font-bold theme-text">
        <span className="flex items-center gap-2">
          <span className="material-symbols-outlined text-cyan-400 text-[16px]">{kindIcon(kind)}</span>
          {(m && m[`kind_${kind}`]) || kind} ({items.length})
        </span>
        <span className="material-symbols-outlined text-[18px] theme-text-muted">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="divide-y divide-slate-200/50 dark:divide-white/5">
          {items.slice(0, 50).map((f, i) => (
            <div key={i} className="px-4 py-2 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <StatusBadge status={f.status} m={m} />
                <span className="font-mono text-[12px] theme-text">{f.action}</span>
                <span className="theme-text-secondary truncate min-w-0">{f.id}</span>
                {f.sensitive && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500">
                    <span className="material-symbols-outlined text-[12px]">lock</span>{m.sensitive || '敏感'}
                  </span>
                )}
              </div>
              {f.target && <div className="text-[11px] font-mono theme-text-muted truncate mt-0.5">→ {f.target}</div>}
              {(f.message || f.reason) && <div className="text-[11px] theme-text-muted mt-0.5">{f.message || f.reason}</div>}
            </div>
          ))}
          {items.length > 50 && <div className="px-4 py-2 text-[11px] theme-text-muted text-center">... {items.length - 50} more</div>}
        </div>
      )}
    </div>
  );
};

const Step1: React.FC<{ providers: MigrateProvider[]; detect: Record<string, MigrateDetectResult>; loading: boolean; onChoose: (id: string) => void; onRefresh: () => void; m: any }> = ({ providers, detect, loading, onChoose, onRefresh, m }) => (
  <div className="space-y-4">
    {loading && (
      <div className="p-3 rounded-lg bg-slate-500/10 border border-slate-500/20 text-xs theme-text-muted flex items-center gap-2">
        <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
        {m.loadingProviders || '正在加载迁移 provider...'}
      </div>
    )}
    {!loading && providers.length === 0 && (
      <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-3">
        <span className="material-symbols-outlined text-[16px] shrink-0">warning</span>
        <div className="flex-1 min-w-0">
          <p className="font-bold">{m.noProvidersTitle || '未发现可用 provider'}</p>
          <p className="mt-0.5 text-[11px]">{m.noProvidersHint || 'OpenClaw CLI 报告无注册的迁移 provider。请确认已安装 openclaw 2026.4.26+。'}</p>
          <button onClick={onRefresh} className="mt-2 px-2.5 py-1 rounded text-[11px] font-bold bg-amber-500 text-white hover:bg-amber-600">
            <span className="material-symbols-outlined text-[12px] align-middle me-0.5">refresh</span>{m.refresh || '重新加载'}
          </button>
        </div>
      </div>
    )}
    <div className="grid md:grid-cols-2 gap-4">
      {providers.map(p => {
        const meta = META[p.id] || { icon: 'extension', tag: p.pluginId || '', color: 'text-cyan-500' };
        const det = detect[p.id];
        return (
          <button key={p.id} type="button" onClick={() => onChoose(p.id)} disabled={loading}
            className="sci-card text-start p-5 rounded-xl hover:border-cyan-400/50 disabled:opacity-60 disabled:cursor-wait transition-all">
            <div className="flex items-start gap-3">
              <span className={`material-symbols-outlined ${meta.color} text-[28px]`}>{meta.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="font-bold theme-text flex items-center gap-2">
                  {p.title || p.id}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-500 border border-cyan-500/30 font-mono">{p.id}</span>
                </div>
                <div className="text-xs theme-text-muted mt-1">{p.description || meta.tag}</div>
                {det && (
                  <div className="text-[11px] mt-2 truncate font-mono">
                    {det.exists
                      ? <span className="text-green-500">✓ {m.detected || '已检测到'}: {det.path}</span>
                      : <span className="theme-text-disabled">{m.notDetected || '未检测到默认路径'}: {det.path}</span>}
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  </div>
);

const Step2: React.FC<any> = ({ provider, from, setFrom, includeSecrets, setIncludeSecrets, overwrite, setOverwrite, noBackup, setNoBackup, force, setForce, loading, detect, onBack, onNext, m }) => (
  <div className="sci-card p-5 rounded-xl space-y-4 max-w-2xl">
    <div className="text-xs theme-text-muted">{m.configHint || 'Provider'}: <span className="font-bold theme-text font-mono">{provider}</span></div>
    <Field label={m.fieldFrom || '源目录 (--from)'} hint={detect?.path ? `${m.defaultDir || '默认'}: ${detect.path}` : (m.fromHint || '留空使用 provider 默认目录')}>
      <input className="sci-input w-full px-3 py-2 rounded-lg text-sm font-mono" value={from} onChange={e => setFrom(e.target.value)} placeholder={detect?.path || '~/.claude'} />
    </Field>
    <div className="space-y-2 pt-1">
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={includeSecrets} onChange={e => setIncludeSecrets(e.target.checked)} className="mt-0.5" />
        <span>
          <span className="font-semibold theme-text">{m.includeSecrets || '包含敏感凭证 (--include-secrets)'}</span>
          <div className="text-[11px] theme-text-muted mt-0.5">{m.includeSecretsDesc || 'Hermes 仅支持 .env 中已知的 API key（OPENAI_API_KEY 等）。Claude 永远不导入凭证。'}</div>
        </span>
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="mt-0.5" />
        <span>
          <span className="font-semibold theme-text">{m.overwrite || '覆盖冲突 (--overwrite)'}</span>
          <div className="text-[11px] theme-text-muted mt-0.5">{m.overwriteDesc || '当 plan 报告冲突时允许直接覆盖。Apply 会先写 item-level 备份。'}</div>
        </span>
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={noBackup} onChange={e => { setNoBackup(e.target.checked); if (!e.target.checked) setForce(false); }} className="mt-0.5" />
        <span>
          <span className="font-semibold theme-text">{m.noBackup || '跳过 OpenClaw 整体备份 (--no-backup)'}</span>
          <div className="text-[11px] theme-text-muted mt-0.5">{m.noBackupDesc || '默认会先做整体备份。仅当本机无 OpenClaw 状态、或你已自行备份时勾选。'}</div>
        </span>
      </label>
      {noBackup && (
        <label className="flex items-start gap-2 text-xs ms-6">
          <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-semibold text-rose-500">{m.force || '强制 (--force)'}</span>
            <div className="text-[11px] theme-text-muted mt-0.5">{m.forceDesc || 'CLI 要求 --no-backup 必须配合 --force 才能生效。'}</div>
          </span>
        </label>
      )}
    </div>
    <div className="flex items-center gap-2 pt-2">
      <button onClick={onBack} disabled={loading} className="px-4 py-2 rounded-lg text-sm bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10">{m.back || '上一步'}</button>
      <button onClick={onNext} disabled={loading || (noBackup && !force)} className="px-4 py-2 rounded-lg text-sm bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-60">
        {loading ? <><span className="material-symbols-outlined text-[14px] animate-spin align-middle me-1">progress_activity</span>{m.planning || '生成预览中...'}</> : (m.next || '生成预览')}
      </button>
    </div>
  </div>
);

const Step3: React.FC<{ plan: MigratePlan; onBack: () => void; onApply: () => void; m: any }> = ({ plan, onBack, onApply, m }) => {
  const [confirm, setConfirm] = useState(false);
  const grouped = useMemo(() => {
    const map: Record<string, MigrateItem[]> = {};
    for (const it of plan.items) { const k = it.kind || 'other'; (map[k] = map[k] || []).push(it); }
    return map;
  }, [plan]);
  const conflicts = plan.summary.conflicts || 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Pill color="emerald" icon="check_circle" value={plan.summary.total} label={m.pillTotal || '总条目'} />
        <Pill color="rose" icon="warning" value={conflicts} label={m.pillConflicts || '冲突'} />
        <Pill color="amber" icon="lock" value={plan.summary.sensitive || 0} label={m.pillSensitive || '敏感项'} />
      </div>
      {plan.warnings && plan.warnings.length > 0 && (
        <div className="sci-card rounded-xl p-4 text-xs">
          <div className="font-bold text-amber-500 mb-2 flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">warning</span>{m.warnings || '警告'}
          </div>
          <ul className="space-y-0.5 text-amber-600 dark:text-amber-400">
            {plan.warnings.map((w, i) => <li key={i}>· {w}</li>)}
          </ul>
        </div>
      )}
      <div className="space-y-2">
        {Object.entries(grouped).map(([kind, items]) => <GroupPanel key={kind} kind={kind} items={items} m={m} />)}
      </div>
      {plan.nextSteps && plan.nextSteps.length > 0 && (
        <div className="sci-card rounded-xl p-4 text-xs">
          <div className="font-bold theme-text mb-2">{m.nextSteps || '后续步骤'}</div>
          <ul className="space-y-0.5 theme-text-secondary">
            {plan.nextSteps.map((s, i) => <li key={i}>{i + 1}. {s}</li>)}
          </ul>
        </div>
      )}
      <div className="sci-card rounded-xl p-4 text-xs flex items-start gap-2">
        <input id="confirm-apply" type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} className="mt-0.5" />
        <label htmlFor="confirm-apply" className="cursor-pointer">
          <span className="font-bold theme-text">{m.confirmApply || '我已审阅以上 plan，确认执行迁移'}</span>
          <div className="text-[11px] theme-text-muted mt-0.5">{m.confirmApplyDesc || 'Apply 调用 openclaw migrate apply <provider> --yes，默认会先生成完整备份。'}</div>
        </label>
      </div>
      <div className="flex items-center gap-2 pt-2 flex-wrap">
        <button onClick={onBack} className="px-4 py-2 rounded-lg text-sm bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10">{m.back || '上一步'}</button>
        <button onClick={onApply} disabled={!confirm} className="px-4 py-2 rounded-lg text-sm bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed">
          <span className="material-symbols-outlined text-[14px] align-middle me-1">play_arrow</span>{m.apply || '执行迁移'}
        </button>
        {conflicts > 0 && <span className="text-[11px] text-rose-500">{m.conflictsHint || '存在冲突 — 如确定要覆盖请回到上一步勾选 --overwrite'}</span>}
      </div>
    </div>
  );
};

const Step4: React.FC<{ m: any }> = ({ m }) => (
  <div className="sci-card rounded-xl p-6 max-w-xl flex items-center gap-4">
    <span className="material-symbols-outlined text-cyan-400 text-[32px] animate-spin">progress_activity</span>
    <div>
      <h3 className="font-bold theme-text">{m.applying || '正在执行迁移...'}</h3>
      <p className="text-xs theme-text-muted mt-1">{m.applyingDesc || '正在生成备份、写入 OpenClaw 状态、归档不支持项。完整迁移最多需要 4 分钟。'}</p>
    </div>
  </div>
);

const Step5: React.FC<{ result: MigrateApplyResult; ok: boolean; onRestart: () => void; m: any }> = ({ result, ok, onRestart, m }) => {
  const summary: any = result.summary || {};
  const grouped = useMemo(() => {
    const map: Record<string, MigrateItem[]> = {};
    for (const it of result.items || []) { const s = it.status || 'other'; (map[s] = map[s] || []).push(it); }
    return map;
  }, [result]);
  return (
    <div className="space-y-4">
      <div className="sci-card rounded-xl p-5">
        <div className={`flex items-center gap-2 font-bold mb-3 ${ok ? 'text-emerald-500' : 'text-rose-500'}`}>
          <span className="material-symbols-outlined">{ok ? 'check_circle' : 'cancel'}</span>
          <span>{ok ? (m.doneTitle || '迁移完成') : (m.doneFailedTitle || '迁移失败')}</span>
          <span className="theme-text-muted text-xs ms-auto font-normal">{result.providerId}</span>
        </div>
        <div className="grid md:grid-cols-4 gap-2 text-xs">
          <SummaryStat color="emerald" label={m.applied || '已应用'} value={summary.applied ?? 0} />
          <SummaryStat color="slate" label={m.skipped || '跳过'} value={summary.skipped ?? 0} />
          <SummaryStat color="rose" label={m.conflicts || '冲突'} value={summary.conflicts ?? 0} />
          <SummaryStat color="amber" label={m.errors || '错误'} value={summary.errors ?? 0} />
        </div>
        <div className="mt-3 text-[11px] theme-text-muted space-y-0.5 font-mono break-all">
          {result.backupPath && <div>{m.cfgBackup || '备份'}: <code className="theme-text">{result.backupPath}</code></div>}
          {result.reportDir && <div>{m.reportDir || '报告目录'}: <code className="theme-text">{result.reportDir}</code></div>}
        </div>
      </div>
      {Object.entries(grouped).slice(0, 6).map(([status, items]) => (
        <div key={status} className="sci-card rounded-xl p-4">
          <div className="text-sm font-bold theme-text mb-2 flex items-center gap-2">
            <StatusBadge status={status} m={m} /><span>({items.length})</span>
          </div>
          <ul className="text-[11px] font-mono space-y-0.5 max-h-48 overflow-auto">
            {items.slice(0, 30).map((it, i) => (
              <li key={i} className="truncate theme-text-secondary" title={it.id}>
                <span className="theme-text">{it.kind}/{it.action}</span> {it.id}
              </li>
            ))}
            {items.length > 30 && <li className="theme-text-muted text-center">... {items.length - 30} more</li>}
          </ul>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-2 flex-wrap">
        <button onClick={onRestart} className="px-4 py-2 rounded-lg text-sm bg-cyan-500 text-white hover:bg-cyan-600">
          <span className="material-symbols-outlined text-[14px] align-middle me-1">restart_alt</span>{m.startOver || '再次迁移'}
        </button>
        {ok && (
          <span className="text-[11px] theme-text-muted">{m.runDoctorHint || '建议执行 openclaw doctor 验证状态'}</span>
        )}
      </div>
    </div>
  );
};

// ==================== Remote OpenClaw Migration Panel ====================
type RemoteMode = 'clawdeckx' | 'gateway' | 'file';

const RemoteOpenClawPanel: React.FC<{ m: any; rm: any }> = ({ m, rm }) => {
  const { toast } = useToast();
  const [mode, setMode] = useState<RemoteMode | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('18789');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<RemoteOpenClawImportResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const canSubmit = useMemo(() => {
    if (!mode || loading) return false;
    if (mode === 'file') return !!selectedFile;
    if (password.length < 6) return false;
    if (mode === 'clawdeckx') return baseUrl.trim().length > 0;
    return host.trim().length > 0;
  }, [mode, password, loading, baseUrl, host, selectedFile]);

  const doImport = useCallback(async () => {
    setLoading(true); setErrorMsg(''); setResult(null);
    try {
      if (mode === 'file') {
        if (!selectedFile) return;
        const res = await snapshotApi.importFile(selectedFile);
        setResult(res);
        toast('success', rm.fileImportOk || 'Backup file imported — go to Snapshots to restore');
        return;
      }
      const req: RemoteOpenClawImportRequest = {
        mode: mode as 'clawdeckx' | 'gateway',
        password,
        note: note.trim() || undefined,
      };
      if (mode === 'clawdeckx') {
        req.baseUrl = baseUrl.trim();
        if (username.trim()) req.username = username.trim();
        if (loginPassword) req.loginPassword = loginPassword;
      } else {
        req.host = host.trim();
        req.port = parseInt(port) || 18789;
        req.token = token.trim() || undefined;
      }
      const res = await migrateApi.importRemoteOpenClaw(req);
      setResult(res);
      toast('success', rm.importOk || 'Remote import succeeded — go to Snapshots to restore');
    } catch (e: any) {
      setErrorMsg(e?.message || String(e));
      toast('error', rm.importFailed || 'Remote import failed');
    } finally { setLoading(false); }
  }, [mode, baseUrl, username, loginPassword, host, port, token, password, note, selectedFile, toast, rm]);

  const reset = useCallback(() => {
    setMode(null); setBaseUrl(''); setUsername(''); setLoginPassword('');
    setHost(''); setPort('18789'); setToken('');
    setPassword(''); setNote(''); setErrorMsg(''); setResult(null);
    setSelectedFile(null);
  }, []);

  const navigateToRestore = useCallback((snapshotId: string) => {
    dispatchOpenWindow({ id: 'settings', tab: 'snapshot', snapshotId });
  }, []);

  if (result) {
    return (
      <div className="space-y-4">
        <div className="sci-card rounded-xl p-5">
          <div className="flex items-center gap-2 font-bold text-emerald-500 mb-3">
            <span className="material-symbols-outlined">check_circle</span>
            <span>{rm.importOk || 'Import completed'}</span>
          </div>
          <div className="grid md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="text-[10px] font-bold text-emerald-500 mb-0.5">{rm.snapshotId || 'Snapshot ID'}</div>
              <div className="font-mono theme-text truncate" title={result.snapshotId}>{result.snapshotId}</div>
            </div>
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
              <div className="text-[10px] font-bold text-cyan-500 mb-0.5">{rm.resourceCount || 'Resources'}</div>
              <div className="text-xl font-bold theme-text font-mono">{result.resourceCount}</div>
            </div>
            <div className="rounded-lg border border-slate-500/20 bg-slate-500/5 p-3">
              <div className="text-[10px] font-bold theme-text-muted mb-0.5">{rm.sizeBytes || 'Size'}</div>
              <div className="text-xl font-bold theme-text font-mono">{(result.sizeBytes / 1024).toFixed(1)} KB</div>
            </div>
          </div>
          <p className="text-xs theme-text-muted mt-3">{rm.importOkHint || 'The remote config has been imported as a local snapshot. Go to the Snapshots tab to preview and selectively restore.'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigateToRestore(result.snapshotId)}
            className="px-4 py-2 rounded-lg text-sm bg-emerald-500 text-white hover:bg-emerald-600 font-bold">
            <span className="material-symbols-outlined text-[14px] align-middle me-1">settings_backup_restore</span>
            {rm.goToRestore || 'Go to Restore'}
          </button>
          <button onClick={reset} className="px-4 py-2 rounded-lg text-sm bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10">
            <span className="material-symbols-outlined text-[14px] align-middle me-1">restart_alt</span>
            {rm.importAnother || 'Import another'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mode selection */}
      {!mode && (
        <div className="grid md:grid-cols-3 gap-4">
          <button type="button" onClick={() => setMode('clawdeckx')}
            className="sci-card text-start p-5 rounded-xl hover:border-cyan-400/50 transition-all">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-cyan-400 text-[28px]">dns</span>
              <div className="min-w-0 flex-1">
                <div className="font-bold theme-text">{rm.modeClawDeckX || 'Remote ClawDeckX'}</div>
                <div className="text-xs theme-text-muted mt-1">{rm.modeClawDeckXDesc || 'Connect to another ClawDeckX instance and import its OpenClaw snapshot.'}</div>
              </div>
            </div>
          </button>
          <button type="button" onClick={() => setMode('gateway')}
            className="sci-card text-start p-5 rounded-xl hover:border-violet-400/50 transition-all">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-violet-400 text-[28px]">router</span>
              <div className="min-w-0 flex-1">
                <div className="font-bold theme-text">{rm.modeGateway || 'Remote OpenClaw Gateway'}</div>
                <div className="text-xs theme-text-muted mt-1">{rm.modeGatewayDesc || 'Connect directly to a remote OpenClaw Gateway via WebSocket and import config + agent files.'}</div>
              </div>
            </div>
          </button>
          <button type="button" onClick={() => setMode('file')}
            className="sci-card text-start p-5 rounded-xl hover:border-emerald-400/50 transition-all">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-emerald-400 text-[28px]">upload_file</span>
              <div className="min-w-0 flex-1">
                <div className="font-bold theme-text">{rm.modeFile || 'Import .clawbak File'}</div>
                <div className="text-xs theme-text-muted mt-1">{rm.modeFileDesc || 'Directly import a .clawbak backup file exported from another ClawDeckX instance.'}</div>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Form */}
      {mode && (
        <div className="sci-card p-5 rounded-xl space-y-4 max-w-2xl">
          <div className="flex items-center gap-2 text-xs theme-text-muted">
            <span className="material-symbols-outlined text-[14px]">{mode === 'clawdeckx' ? 'dns' : mode === 'gateway' ? 'router' : 'upload_file'}</span>
            <span className="font-bold theme-text">{mode === 'clawdeckx' ? (rm.modeClawDeckX || 'Remote ClawDeckX') : mode === 'gateway' ? (rm.modeGateway || 'Remote Gateway') : (rm.modeFile || 'Import .clawbak')}</span>
            <button onClick={() => { setMode(null); setErrorMsg(''); setSelectedFile(null); }} className="ms-auto text-[11px] text-cyan-500 hover:underline">{rm.changeMode || 'Change'}</button>
          </div>

          {mode === 'file' && (
            <>
              <Field label={rm.fileLabel || 'Backup File (.clawbak)'} hint={rm.fileHint || 'Select a .clawbak file exported from another ClawDeckX'}>
                <input ref={fileInputRef} type="file" accept=".clawbak" className="hidden" onChange={e => { setSelectedFile(e.target.files?.[0] || null); }} />
                <button onClick={() => fileInputRef.current?.click()}
                  className="sci-input w-full px-3 py-2 rounded-lg text-sm text-start flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] theme-text-muted">attach_file</span>
                  <span className={selectedFile ? 'theme-text font-mono' : 'theme-text-muted'}>
                    {selectedFile ? selectedFile.name : (rm.filePlaceholder || 'Click to select .clawbak file...')}
                  </span>
                </button>
              </Field>
              {selectedFile && (
                <div className="text-[11px] theme-text-muted">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </div>
              )}
            </>
          )}

          {mode === 'clawdeckx' && (
            <>
              <Field label={rm.remoteUrl || 'Remote ClawDeckX URL'} hint={rm.remoteUrlHint || 'e.g. http://192.168.1.100:18088'}>
                <input className="sci-input w-full px-3 py-2 rounded-lg text-sm font-mono" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="http://192.168.1.100:18088" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={rm.loginUser || 'Username'} hint={rm.loginUserHint || 'ClawDeckX login username'}>
                  <input className="sci-input w-full px-3 py-2 rounded-lg text-sm" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" />
                </Field>
                <Field label={rm.loginPass || 'Login Password'} hint={rm.loginPassHint || 'ClawDeckX login password'}>
                  <input type="password" className="sci-input w-full px-3 py-2 rounded-lg text-sm" value={loginPassword} onChange={e => setLoginPassword(e.target.value)} placeholder="••••••" />
                </Field>
              </div>
            </>
          )}
          {mode === 'gateway' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label={rm.gwHost || 'Gateway Host'} hint={rm.gwHostHint || 'IP or hostname of remote OpenClaw gateway'}>
                    <input className="sci-input w-full px-3 py-2 rounded-lg text-sm font-mono" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.100" />
                  </Field>
                </div>
                <Field label={rm.gwPort || 'Port'}>
                  <input className="sci-input w-full px-3 py-2 rounded-lg text-sm font-mono" value={port} onChange={e => setPort(e.target.value)} placeholder="18789" />
                </Field>
              </div>
              <Field label={rm.gwToken || 'Gateway Token'} hint={rm.gwTokenHint || 'Authentication token (if required)'}>
                <input type="password" className="sci-input w-full px-3 py-2 rounded-lg text-sm font-mono" value={token} onChange={e => setToken(e.target.value)} placeholder="..." />
              </Field>
            </>
          )}

          {mode !== 'file' && (
            <>
              <Field label={rm.password || 'Snapshot Password'} hint={rm.passwordHint || 'Min 6 characters. Used to encrypt the imported snapshot.'}>
                <input type="password" className="sci-input w-full px-3 py-2 rounded-lg text-sm font-mono" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••" />
              </Field>
              <Field label={rm.note || 'Note'} hint={rm.noteHint || 'Optional label for the imported snapshot'}>
                <input className="sci-input w-full px-3 py-2 rounded-lg text-sm" value={note} onChange={e => setNote(e.target.value)} placeholder={rm.notePlaceholder || 'Remote migration from ...'} />
              </Field>
            </>
          )}

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500 dark:text-red-400 whitespace-pre-wrap break-words">{errorMsg}</div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button onClick={() => { setMode(null); setErrorMsg(''); }} className="px-4 py-2 rounded-lg text-sm bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10">{m.back || 'Back'}</button>
            <button onClick={doImport} disabled={!canSubmit}
              className="px-4 py-2 rounded-lg text-sm bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed">
              {loading
                ? <><span className="material-symbols-outlined text-[14px] animate-spin align-middle me-1">progress_activity</span>{rm.importing || 'Importing...'}</>
                : <><span className="material-symbols-outlined text-[14px] align-middle me-1">cloud_download</span>{rm.importBtn || 'Import'}</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== Main Section ====================
type MigrationTab = 'local' | 'remote';

export const MigrationSection: React.FC<SectionProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const m = useMemo(() => ((t as any).es && (t as any).es.migration) || {}, [t]);
  const rm = useMemo(() => ((t as any).es && (t as any).es.remoteMigration) || {}, [t]);
  const { toast } = useToast();

  const [tab, setTab] = useState<MigrationTab>('local');
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [providers, setProviders] = useState<MigrateProvider[]>([]);
  const [detect, setDetect] = useState<Record<string, MigrateDetectResult>>({});
  const [provider, setProvider] = useState('');
  const [from, setFrom] = useState('');
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [noBackup, setNoBackup] = useState(false);
  const [force, setForce] = useState(false);
  const [plan, setPlan] = useState<MigratePlan | null>(null);
  const [applyResult, setApplyResult] = useState<MigrateApplyResult | null>(null);
  const [applyOk, setApplyOk] = useState(true);

  const refreshProviders = useCallback(async () => {
    setLoading(true); setErrorMsg('');
    try {
      const [list, det] = await Promise.all([migrateApi.list(), migrateApi.detect()]);
      setProviders(list.providers || []);
      const dm: Record<string, MigrateDetectResult> = {};
      (det.results || []).forEach(r => { dm[r.provider] = r; });
      setDetect(dm);
    } catch (e: any) { setErrorMsg(e?.message || String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { refreshProviders(); }, [refreshProviders]);

  const chooseProvider = useCallback((id: string) => {
    setProvider(id);
    const d = detect[id];
    setFrom(d?.exists ? d.path : '');
    setIncludeSecrets(false); setOverwrite(false); setNoBackup(false); setForce(false);
    setStep(2);
  }, [detect]);

  const doPlan = useCallback(async () => {
    setLoading(true); setErrorMsg('');
    try {
      const p = await migrateApi.plan({ provider, from: from.trim() || undefined, includeSecrets, overwrite });
      setPlan(p); setStep(3);
    } catch (e: any) { setErrorMsg(e?.message || String(e)); }
    finally { setLoading(false); }
  }, [provider, from, includeSecrets, overwrite]);

  const doApply = useCallback(async () => {
    setStep(4); setLoading(true); setErrorMsg('');
    try {
      const r = await migrateApi.apply({ provider, from: from.trim() || undefined, includeSecrets, overwrite, noBackup, force });
      setApplyResult(r.result); setApplyOk(r.ok);
      if (!r.ok && r.error) setErrorMsg(r.error);
      setStep(5);
      if (r.ok) toast('success', m.applyOk || '迁移完成');
      else toast('error', r.error || (m.applyFailed || '迁移失败'));
    } catch (e: any) {
      setErrorMsg(e?.message || String(e)); setApplyOk(false); setStep(5);
    } finally { setLoading(false); }
  }, [provider, from, includeSecrets, overwrite, noBackup, force, toast, m]);

  const restart = useCallback(() => {
    setStep(1); setProvider(''); setFrom(''); setPlan(null); setApplyResult(null); setApplyOk(true); setErrorMsg('');
    setIncludeSecrets(false); setOverwrite(false); setNoBackup(false); setForce(false);
    refreshProviders();
  }, [refreshProviders]);

  return (
    <div className="flex-1 overflow-auto p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <h2 className="text-xl font-bold theme-text flex items-center gap-2">
          <span className="material-symbols-outlined text-cyan-400">swap_horiz</span>
          {m.title || 'Claude / Hermes 一键导入'}
        </h2>
        <p className="text-xs theme-text-muted mt-1">
          {m.subtitle || '将 Claude（CLAUDE.md / MCP / skills / commands）或 HermesAgent（config / providers / MCP / memory / skills）导入到 OpenClaw。'}
        </p>
      </header>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-5 border-b border-slate-200 dark:border-white/10">
        <button onClick={() => setTab('local')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            tab === 'local' ? 'border-cyan-500 text-cyan-500' : 'border-transparent theme-text-muted hover:theme-text'
          }`}>
          <span className="material-symbols-outlined text-[14px] align-middle me-1">folder_open</span>
          {rm.tabLocal || 'Local Import'}
        </button>
        <button onClick={() => setTab('remote')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
            tab === 'remote' ? 'border-violet-500 text-violet-500' : 'border-transparent theme-text-muted hover:theme-text'
          }`}>
          <span className="material-symbols-outlined text-[14px] align-middle me-1">cloud_download</span>
          {rm.tabRemote || 'Remote OpenClaw'}
        </button>
      </div>

      {tab === 'local' && (
        <>
          <StepIndicator step={step} labels={[
            m.stepProvider || '选择来源',
            m.stepConfigure || '配置选项',
            m.stepPreview || '预览',
            m.stepApply || '执行',
            m.stepReport || '报告',
          ]} />

          {errorMsg && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500 dark:text-red-400 whitespace-pre-wrap break-words">
              {errorMsg}
            </div>
          )}

          <div className="mt-6">
            {step === 1 && <Step1 providers={providers} detect={detect} loading={loading} onChoose={chooseProvider} onRefresh={refreshProviders} m={m} />}
            {step === 2 && (
              <Step2
                provider={provider} from={from} setFrom={setFrom}
                includeSecrets={includeSecrets} setIncludeSecrets={setIncludeSecrets}
                overwrite={overwrite} setOverwrite={setOverwrite}
                noBackup={noBackup} setNoBackup={setNoBackup}
                force={force} setForce={setForce}
                loading={loading} detect={detect[provider]}
                onBack={() => setStep(1)} onNext={doPlan} m={m}
              />
            )}
            {step === 3 && plan && <Step3 plan={plan} onBack={() => setStep(2)} onApply={doApply} m={m} />}
            {step === 4 && <Step4 m={m} />}
            {step === 5 && applyResult && <Step5 result={applyResult} ok={applyOk} onRestart={restart} m={m} />}
          </div>
        </>
      )}

      {tab === 'remote' && (
        <div className="mt-2">
          <p className="text-xs theme-text-muted mb-4">{rm.subtitle || 'Import OpenClaw config and agent files from a remote instance.'}</p>
          <RemoteOpenClawPanel m={m} rm={rm} />
        </div>
      )}
    </div>
  );
};
