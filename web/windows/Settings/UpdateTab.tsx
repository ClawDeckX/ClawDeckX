import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Language, dispatchOpenWindow } from '../../types';
import { getTranslation } from '../../locales';
import { selfUpdateApi, hostInfoApi, serviceApi, gatewayApi, gwApi, runtimeApi } from '../../services/api';
import type { SelfUpdateInfo, UpdateCheckResult, UpdateHistoryEntry, RuntimeStatus, ReleaseSummary } from '../../services/api';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import CustomSelect from '../../components/CustomSelect';
import VersionPicker, { VersionPickerLabels } from '../../components/VersionPicker';
import TranslateModelPicker from '../../components/TranslateModelPicker';
import { SmartLink } from '../../components/SmartLink';
import { useOpenClawUpdate } from '../../hooks/useOpenClawUpdate';

declare const __APP_VERSION__: string;
declare const __BUILD_NUMBER__: string;

/**
 * 宽松语义比较：仅看前 3 段 numeric，忽略 prerelease 后缀；用于 UI 层降级判断。
 * 返回正数表示 a > b，0 相等，负数 a < b。
 * 后端已有精确比较；前端这里只需"老/新/相同"三态即可。
 */
function compareSemverLoose(a: string, b: string): number {
  const parse = (s: string): number[] => s.replace(/^v/, '').split(/[^\d]/).filter(Boolean).slice(0, 3).map(n => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export interface UpdateTabProps {
  s: any;
  language: Language;
  inputCls: string;
  rowCls: string;
}

const UpdateTab: React.FC<UpdateTabProps> = ({ s, language, inputCls, rowCls }) => {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const sk = useMemo(() => (getTranslation(language) as any).sk || {}, [language]);
  const sRef = useRef(s);
  sRef.current = s;

  // ── OpenClaw 更新 ──
  const [ocUpdateChecking, setOcUpdateChecking] = useState(false);
  const [ocUpdateInfo, setOcUpdateInfo] = useState<{ available: boolean; currentVersion?: string; latestVersion?: string; releaseNotes?: string; publishedAt?: string; releaseTag?: string; error?: string } | null>(null);
  const {
    running: ocUpdating,
    logs: ocUpdateLogs,
    step: ocUpdateStep,
    progress: ocUpdateProgress,
    run: runOcUpdate,
  } = useOpenClawUpdate();
  const ocUpdateLogRef = useRef<HTMLDivElement>(null);

  // ── 自更新 ──
  const [selfUpdateChecking, setSelfUpdateChecking] = useState(false);
  const [selfUpdateInfo, setSelfUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [selfUpdating, setSelfUpdating] = useState(false);
  const [selfUpdateProgress, setSelfUpdateProgress] = useState<{ stage: string; percent: number; error?: string; done?: boolean } | null>(null);
  const [selfUpdateVersion, setSelfUpdateVersion] = useState<SelfUpdateInfo | null>(null);
  const [updateChannel, setUpdateChannel] = useState<'stable' | 'beta'>('stable');
  // v0.9.2 指定版本升级：后端按需返回最近 N 个 release；picker 改变后重新拉取该 tag 的 check
  //   以覆盖 selfUpdateInfo，复用原有的 downloadUrl → apply 流水线，天然支持降级。
  const [releaseList, setReleaseList] = useState<ReleaseSummary[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>('');        // '' = 最新 stable（默认行为）
  const [loadingReleases, setLoadingReleases] = useState(false);
  // OpenClaw 指定版本升级：npm 包走 tag 直装；后端由 hostInfoApi.releases 返回 GitHub 列表。
  const [ocReleaseList, setOcReleaseList] = useState<ReleaseSummary[]>([]);
  const [ocSelectedTag, setOcSelectedTag] = useState<string>('');
  const [ocLoadingReleases, setOcLoadingReleases] = useState(false);

  // 共用版本选择器的 i18n 标签——避免 ClawDeckX / OpenClaw 两处重复构造。
  const versionPickerLabels: VersionPickerLabels = useMemo(() => ({
    title: s.selfUpdatePickVersion || 'Pick version',
    latest: s.selfUpdateLatestStable || 'Latest stable',
    current: s.selfUpdateTagCurrent || 'current',
    older: s.selfUpdateTagOlder || 'older',
    beta: s.selfUpdateTagBeta || 'beta',
    noAsset: s.selfUpdateTagNoAsset || 'no asset',
    refresh: s.selfUpdateRefreshReleases || 'Refresh version list',
  }), [s]);
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryEntry[]>([]);
  const lastAutoCheckRef = useRef<number>(0);
  const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);
  const UPDATE_CHECK_CACHE_MS = 60 * 60 * 1000; // 1 hour cache
  const [translatedNotes, setTranslatedNotes] = useState<string | null>(null);
  const [notesTranslating, setNotesTranslating] = useState(false);
  const [showTranslated, setShowTranslated] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [ocTranslatedNotes, setOcTranslatedNotes] = useState<string | null>(null);
  const [ocNotesTranslating, setOcNotesTranslating] = useState(false);
  const [ocShowTranslated, setOcShowTranslated] = useState(false);
  const [ocNotesExpanded, setOcNotesExpanded] = useState(false);

  // ── 忽略版本 ──
  const [dismissedClawdeckx, setDismissedClawdeckx] = useState('');
  const [dismissedOpenclaw, setDismissedOpenclaw] = useState('');
  const [dismissing, setDismissing] = useState<string | null>(null);

  // ── 服务状态 ──
  const [serviceStatus, setServiceStatus] = useState<{ openclaw_installed: boolean; clawdeckx_installed: boolean; is_docker?: boolean } | null>(null);
  const [serviceLoading, setServiceLoading] = useState(false);

  // ── Docker 运行时覆盖 ──
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeRollingBack, setRuntimeRollingBack] = useState(false);
  const [runtimeOcUpdating, setRuntimeOcUpdating] = useState(false);
  const [runtimeOcLogs, setRuntimeOcLogs] = useState<string[]>([]);
  const [runtimeOcStep, setRuntimeOcStep] = useState('');
  const [runtimeOcProgress, setRuntimeOcProgress] = useState(0);
  const isDockerRuntime = !!runtimeStatus?.is_docker;
  const effectiveOcUpdating = isDockerRuntime ? runtimeOcUpdating : ocUpdating;
  const effectiveOcLogs = isDockerRuntime ? runtimeOcLogs : ocUpdateLogs;
  const effectiveOcStep = isDockerRuntime ? runtimeOcStep : ocUpdateStep;
  const effectiveOcProgress = isDockerRuntime ? runtimeOcProgress : ocUpdateProgress;

  const loadRuntimeStatus = useCallback(async () => {
    try {
      const data = await runtimeApi.status();
      setRuntimeStatus(data);
    } catch {
    }
  }, []);

  // Markdown-like rendering for release notes (sanitized)
  const renderMarkdown = useCallback((text: string) => {
    // Escape HTML first to prevent XSS from server-supplied release notes
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    return escaped
      .replace(/^### (.+)$/gm, '<h4 class="font-bold text-slate-700 dark:text-white/70 mt-2 mb-1">$1</h4>')
      .replace(/^## (.+)$/gm, '<h3 class="font-bold text-slate-700 dark:text-white/70 text-[12px] mt-3 mb-1">$1</h3>')
      .replace(/^- (.+)$/gm, '<li class="ms-3 list-disc">$1</li>')
      .replace(/^\* (.+)$/gm, '<li class="ms-3 list-disc">$1</li>')
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-[10px] font-mono">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '<br/>')
      .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline break-all">$1</a>');
  }, []);

  // Self-update handlers
  const handleSelfUpdateCheck = useCallback(async () => {
    setSelfUpdateChecking(true);
    setSelfUpdateInfo(null);
    setSelfUpdateProgress(null);
    setTranslatedNotes(null);
    setShowTranslated(false);
    setNotesExpanded(false);
    try {
      const res = updateChannel === 'beta' ? await selfUpdateApi.checkChannel('beta') : await selfUpdateApi.check();
      setSelfUpdateInfo(res);
    } catch { setSelfUpdateInfo({ available: false, currentVersion: '', latestVersion: '', error: sRef.current.networkError }); }
    setSelfUpdateChecking(false);
  }, [updateChannel]);

  // 加载 release 列表（用于"指定版本"下拉）。失败静默：下拉会空，不影响主流程。
  // force=true 绕过 getCached 的 10 分钟 TTL，由刷新按钮 / 升级完成后调用。
  const loadReleaseList = useCallback(async (force = false) => {
    setLoadingReleases(true);
    try {
      const list = await selfUpdateApi.releases(20, force);
      setReleaseList(Array.isArray(list) ? list : []);
    } catch { /* ignore */ }
    setLoadingReleases(false);
  }, []);

  // 加载 OpenClaw release 列表。与 ClawDeckX 对称；后端会按本地已装版本标记 current/older。
  // 失败不影响主流程，但通过 console 打点便于定位（例如 GitHub rate limit / 网络）。
  // force=true 绕过 getCached 的 10 分钟 TTL，由刷新按钮 / 升级完成后调用。
  const loadOcReleaseList = useCallback(async (force = false) => {
    setOcLoadingReleases(true);
    try {
      const list = await hostInfoApi.openclawReleases(50, force);
      const arr = (Array.isArray(list) ? list : []).filter(r => !r.prerelease);
      setOcReleaseList(arr);
      if (arr.length === 0) {
        console.warn('[UpdateTab] openclaw releases returned empty list');
      }
    } catch (err) {
      console.error('[UpdateTab] openclaw releases fetch failed:', err);
    }
    setOcLoadingReleases(false);
  }, []);

  // OpenClaw 选择某个 tag 后只记录到本地 state；真正的安装发生在点击"执行更新"时
  // （hook 会把 tag 带上去 POST body）。这里不需要像 ClawDeckX 那样重新 check，
  // 因为 OpenClaw 的安装不依赖 downloadUrl，任意合法 npm tag 都能装。
  const handleSelectOcTag = useCallback((tag: string) => {
    setOcSelectedTag(tag);
  }, []);

  // 选择某个 tag 后：拉取该 release 的 check 结果，覆盖 selfUpdateInfo 以启用 apply。
  const handleSelectTag = useCallback(async (tag: string) => {
    setSelectedTag(tag);
    setSelfUpdateProgress(null);
    setTranslatedNotes(null);
    setShowTranslated(false);
    setNotesExpanded(false);
    setSelfUpdateChecking(true);
    try {
      // tag 为空 = 最新 stable；否则精确 tag；beta 通道由 check-channel 处理。
      const res = tag
        ? await selfUpdateApi.check(tag)
        : (updateChannel === 'beta' ? await selfUpdateApi.checkChannel('beta') : await selfUpdateApi.check());
      setSelfUpdateInfo(res);
    } catch {
      setSelfUpdateInfo({ available: false, currentVersion: '', latestVersion: '', error: sRef.current.networkError });
    }
    setSelfUpdateChecking(false);
  }, [updateChannel]);

  const handleSelfUpdateApply = useCallback(async () => {
    if (!selfUpdateInfo?.downloadUrl) return;
    // v0.9.2 降级保护：仿 openclaw 的 --tag 行为，降级必须二次确认。
    const cur = selfUpdateInfo.currentVersion || '';
    const tgt = selfUpdateInfo.latestVersion || '';
    const picked = releaseList.find(r => (r.tagName === selectedTag || r.tagName === `v${selectedTag}` || r.tagName.replace(/^v/, '') === selectedTag));
    const isDowngrade = !!picked?.isOlder || (!!cur && !!tgt && compareSemverLoose(tgt, cur) < 0);
    if (isDowngrade) {
      const ok = await confirm({
        title: sRef.current.selfUpdateDowngradeTitle || 'Downgrade version?',
        message: (sRef.current.selfUpdateDowngradeMsg || 'Target {tgt} is older than current {cur}. Downgrading may drop newer data/features. Continue?').replace('{cur}', `v${cur}`).replace('{tgt}', `v${tgt}`),
        confirmText: sRef.current.selfUpdateDowngradeConfirm || 'Downgrade',
        cancelText: sRef.current.cancel || 'Cancel',
        danger: true,
      });
      if (!ok) return;
    }
    // Prompt user to backup before updating
    const wantBackup = await confirm({
      title: sRef.current.updateBackupTitle || 'Backup Recommended',
      message: sRef.current.updateBackupMsg || 'It is recommended to backup your configuration before updating. Would you like to go to the backup page first?',
      confirmText: sRef.current.updateBackupGo || 'Go to Backup',
      cancelText: sRef.current.selfUpdateDownload || 'Continue Update',
    });
    if (wantBackup) {
      dispatchOpenWindow({ id: 'settings', tab: 'snapshot' });
      return;
    }
    setSelfUpdating(true);
    setSelfUpdateProgress({ stage: 'connecting', percent: 0 });
    try {
      const resp = await fetch(isDockerRuntime ? '/api/v1/runtime/clawdeckx/update' : '/api/v1/self-update/apply', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ downloadUrl: selfUpdateInfo.downloadUrl }),
      });
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const p = JSON.parse(line.slice(6));
                setSelfUpdateProgress(p);
                if (p.done) {
                  toast('success', isDockerRuntime ? (sRef.current.runtimeUpdateOk || sRef.current.selfUpdateDone) : sRef.current.selfUpdateDone);
                  if (isDockerRuntime) {
                    setTimeout(() => window.location.reload(), 3000);
                  } else {
                    setTimeout(() => window.location.reload(), 3000);
                  }
                }
                if (p.error) {
                  toast('error', p.error);
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
      }
    } catch (err: any) {
      setSelfUpdateProgress({ stage: 'error', percent: 0, error: err?.message || sRef.current.unknownError });
      toast('error', isDockerRuntime ? (sRef.current.runtimeUpdateFailed || sRef.current.selfUpdateFailed) : sRef.current.selfUpdateFailed);
    }
    setSelfUpdating(false);
  }, [selfUpdateInfo, toast, isDockerRuntime, confirm]);

  // Release notes translation — cached in SQLite via backend
  const handleTranslateNotes = useCallback(async (text: string, product?: string, ver?: string) => {
    if (!text || language === 'en') return;
    setNotesTranslating(true);
    try {
      const res = await selfUpdateApi.translateNotes(text, language, product || 'clawdeckx', ver || '0');
      setTranslatedNotes(res.translated);
      setShowTranslated(true);
    } catch {
      toast('error', sRef.current.translateFailed || 'Translation failed');
    }
    setNotesTranslating(false);
  }, [language, toast]);

  // OpenClaw release notes manual translation
  const handleOcTranslateNotes = useCallback(async (text: string, ver?: string) => {
    if (!text || language === 'en') return;
    setOcNotesTranslating(true);
    try {
      const res = await selfUpdateApi.translateNotes(text, language, 'openclaw', ver || '0');
      setOcTranslatedNotes(res.translated);
      setOcShowTranslated(true);
    } catch {
      toast('error', sRef.current.translateFailed || 'Translation failed');
    }
    setOcNotesTranslating(false);
  }, [language, toast]);

  // OpenClaw update handlers
  const handleOcUpdateCheck = useCallback(async () => {
    setOcUpdateChecking(true);
    setOcUpdateInfo(null);
    setOcTranslatedNotes(null);
    setOcShowTranslated(false);
    setOcNotesExpanded(false);
    try {
      const res = await hostInfoApi.checkUpdate();
      setOcUpdateInfo(res);
      setOcUpdateChecking(false);
      // Auto-translate release notes for non-English users (cached in SQLite via backend)
      if (res.releaseNotes && language !== 'en') {
        const ver = res.latestVersion || res.currentVersion || '0';
        setOcNotesTranslating(true);
        try {
          const tr = await selfUpdateApi.translateNotes(res.releaseNotes, language, 'openclaw', ver);
          setOcTranslatedNotes(tr.translated);
          setOcShowTranslated(true);
        } catch { /* translation failed, show original */ }
        setOcNotesTranslating(false);
      }
    } catch {
      setOcUpdateInfo({ available: false, error: sRef.current.networkError });
      setOcUpdateChecking(false);
    }
  }, [language]);

  const handleOcUpdateRun = useCallback(async () => {
    // Prompt user to backup before updating
    const wantBackup = await confirm({
      title: sRef.current.updateBackupTitle || 'Backup Recommended',
      message: sRef.current.updateBackupMsg || 'It is recommended to backup your configuration before updating. Would you like to go to the backup page first?',
      confirmText: sRef.current.updateBackupGo || 'Go to Backup',
      cancelText: sRef.current.openclawUpdateRun || 'Continue Update',
    });
    if (wantBackup) {
      dispatchOpenWindow({ id: 'settings', tab: 'snapshot' });
      return;
    }
    // 目标版本：picker 选中的 tag 优先；否则走默认 latest（沿用 ocUpdateInfo.latestVersion 文案）。
    const tgtVersion = ocSelectedTag || ocUpdateInfo?.latestVersion || '?';
    const curVersion = ocUpdateInfo?.currentVersion || '?';
    const ok = await confirm({
      title: sRef.current.openclawUpdateRun || 'Update OpenClaw',
      message: `${sRef.current.openclawUpdateConfirm || 'Update OpenClaw from'} v${curVersion} → v${tgtVersion}`,
      confirmText: sRef.current.openclawUpdateRun || 'Update',
      danger: false,
    });
    if (!ok) return;

    // 降级保护：与 ClawDeckX 一致。选中的 tag 被后端标记为 older，或本地宽松比较低于 current。
    const picked = ocReleaseList.find(r => r.tagName === ocSelectedTag || r.tagName === `v${ocSelectedTag}` || r.tagName.replace(/^v/, '') === ocSelectedTag);
    const isDowngrade = !!picked?.isOlder || (!!ocSelectedTag && !!ocUpdateInfo?.currentVersion && compareSemverLoose(ocSelectedTag, ocUpdateInfo.currentVersion) < 0);
    if (isDowngrade) {
      const confirmDown = await confirm({
        title: sRef.current.selfUpdateDowngradeTitle || 'Downgrade version?',
        message: (sRef.current.selfUpdateDowngradeMsg || 'You are about to install an older version. Continue?')
          + `\n\nv${curVersion} → v${ocSelectedTag}`,
        confirmText: sRef.current.selfUpdateDowngradeConfirm || 'Downgrade anyway',
        danger: true,
      });
      if (!confirmDown) return;
    }
    try {
      if (isDockerRuntime) {
        setRuntimeOcUpdating(true);
        setRuntimeOcLogs([]);
        setRuntimeOcStep('connecting');
        setRuntimeOcProgress(0);
        const resp = await fetch('/api/v1/runtime/openclaw/update', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag: ocSelectedTag || '' }),
        });
        const reader = resp.body?.getReader();
        const decoder = new TextDecoder();
        if (reader) {
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const p = JSON.parse(line.slice(6));
                if (p.stage) setRuntimeOcStep(p.stage);
                if (typeof p.percent === 'number') setRuntimeOcProgress(p.percent);
                setRuntimeOcLogs(prev => [...prev, p.error || p.stage || JSON.stringify(p)]);
                if (p.error) {
                  toast('error', p.error);
                }
                if (p.done) {
                  toast('success', sRef.current.runtimeUpdateOk || sRef.current.openclawUpdateOk);
                  // Smart restart gateway after Docker update
                  try { await gwApi.gatewayRestartRequest({ reason: 'openclaw-update' }); }
                  catch { try { await gatewayApi.restart(); } catch { /* ignore */ } }
                  await new Promise(r => setTimeout(r, 3000));
                  await loadRuntimeStatus();
                  const res = await hostInfoApi.checkUpdate();
                  setOcUpdateInfo({ ...res, available: false });
                  window.dispatchEvent(new CustomEvent('clawdeck:refresh-badges'));
                }
              } catch { }
            }
          }
        }
        setRuntimeOcProgress(100);
      } else {
        await runOcUpdate({ tag: ocSelectedTag || '' });
        toast('success', sRef.current.openclawUpdateOk);
        // Smart restart gateway: safe restart if RPC online, hard restart fallback
        try { await gwApi.gatewayRestartRequest({ reason: 'openclaw-update' }); }
        catch { try { await gatewayApi.restart(); } catch { /* gateway may not be running */ } }
        await new Promise(r => setTimeout(r, 3000));
        const res = await hostInfoApi.checkUpdate();
        setOcUpdateInfo({ ...res, available: false });
        // 装完新版本后重新拉 release 列表（current/older 标记需要刷新）。
        loadOcReleaseList(true);
        // Refresh dashboard to reflect new version
        window.dispatchEvent(new CustomEvent('clawdeck:refresh-badges'));
      }
    } catch {
      toast('error', isDockerRuntime ? (sRef.current.runtimeUpdateFailed || sRef.current.openclawUpdateFailed) : sRef.current.openclawUpdateFailed);
    } finally {
      if (isDockerRuntime) {
        setRuntimeOcUpdating(false);
      }
    }
  }, [runOcUpdate, toast, confirm, ocUpdateInfo, ocSelectedTag, ocReleaseList, isDockerRuntime, loadRuntimeStatus, loadOcReleaseList]);

  // OpenClaw 升级日志自动滚动
  useEffect(() => {
    if (ocUpdateLogRef.current) {
      ocUpdateLogRef.current.scrollTop = ocUpdateLogRef.current.scrollHeight;
    }
  }, [effectiveOcLogs]);

  // 忽略/取消忽略版本更新
  const handleDismiss = useCallback(async (product: 'clawdeckx' | 'openclaw', version: string) => {
    if (!version) return;
    setDismissing(product);
    try {
      await selfUpdateApi.dismissUpdate(product, version);
      if (product === 'clawdeckx') setDismissedClawdeckx(version);
      else setDismissedOpenclaw(version);
      toast('success', sRef.current.dismissSuccess || 'Version ignored');
      window.dispatchEvent(new CustomEvent('clawdeck:refresh-badges'));
    } catch {
      toast('error', sRef.current.dismissFailed || 'Failed to ignore version');
    }
    setDismissing(null);
  }, [toast]);

  const handleUndismiss = useCallback(async (product: 'clawdeckx' | 'openclaw') => {
    setDismissing(product);
    try {
      await selfUpdateApi.undismissUpdate(product);
      if (product === 'clawdeckx') setDismissedClawdeckx('');
      else setDismissedOpenclaw('');
      toast('success', sRef.current.dismissSuccess || 'Notification restored');
      window.dispatchEvent(new CustomEvent('clawdeck:refresh-badges'));
    } catch {
      toast('error', sRef.current.dismissFailed || 'Failed to restore notification');
    }
    setDismissing(null);
  }, [toast]);

  // 服务管理
  const loadServiceStatus = useCallback(async () => {
    try {
      const data = await serviceApi.status();
      setServiceStatus(data);
    } catch (err) {
      console.error('Failed to load service status:', err);
    }
  }, []);

  const handleServiceInstall = useCallback(async (service: 'openclaw' | 'clawdeckx') => {
    setServiceLoading(true);
    try {
      if (service === 'openclaw') {
        const res = await gatewayApi.daemonInstall();
        // Immediately reflect the installed state from the response
        setServiceStatus(prev => prev ? { ...prev, openclaw_installed: res.installed } : { openclaw_installed: res.installed, clawdeckx_installed: false });
        toast('success', sRef.current.serviceInstalled || 'OpenClaw service installed');
      } else {
        await serviceApi.installClawDeckX();
        toast('success', sRef.current.serviceInstalled || 'ClawDeckX service installed');
      }
      await loadServiceStatus();
    } catch (err: any) {
      toast('error', err.message || 'Installation failed');
    } finally {
      setServiceLoading(false);
    }
  }, [toast, loadServiceStatus]);

  const handleServiceUninstall = useCallback(async (service: 'openclaw' | 'clawdeckx') => {
    setServiceLoading(true);
    try {
      if (service === 'openclaw') {
        const res = await gatewayApi.daemonUninstall();
        // Immediately reflect the uninstalled state from the response
        setServiceStatus(prev => prev ? { ...prev, openclaw_installed: res.installed } : { openclaw_installed: res.installed, clawdeckx_installed: false });
        toast('success', sRef.current.serviceUninstalled || 'OpenClaw service uninstalled');
      } else {
        await serviceApi.uninstallClawDeckX();
        toast('success', sRef.current.serviceUninstalled || 'ClawDeckX service uninstalled');
      }
      await loadServiceStatus();
    } catch (err: any) {
      toast('error', err.message || 'Uninstallation failed');
    } finally {
      setServiceLoading(false);
    }
  }, [toast, loadServiceStatus]);

  const handleRuntimeRollback = useCallback(async (component: string) => {
    const ok = await confirm(s.runtimeRollbackConfirm || 'Revert to the version bundled in the Docker image? The runtime overlay will be removed.');
    if (!ok) return;
    setRuntimeRollingBack(true);
    try {
      await runtimeApi.rollback(component);
      toast('success', s.runtimeRollbackOk || 'Rolled back to image version');
      await loadRuntimeStatus();
      if (component === 'openclaw') {
        setTimeout(() => void loadRuntimeStatus(), 3000);
      }
    } catch (err: any) {
      toast('error', (s.runtimeRollbackFailed || 'Rollback failed') + ': ' + (err.message || ''));
    } finally {
      setRuntimeRollingBack(false);
    }
  }, [confirm, toast, s, loadRuntimeStatus]);

  const handleRuntimeRestart = useCallback(async () => {
    const ok = await confirm({
      title: sRef.current.dockerRestartTitle || 'Restart Docker Container',
      message: sRef.current.dockerRestartMsg || 'Restart the Docker container now to activate the new version?',
      confirmText: sRef.current.dockerRestartBtn || 'Restart Now',
      danger: true,
    });
    if (!ok) return;
    try {
      await runtimeApi.restart();
      toast('success', sRef.current.dockerRestarting || 'Restarting Docker container...');
      setTimeout(() => window.location.reload(), 8000);
    } catch (err: any) {
      toast('error', err?.message || 'Restart failed');
    }
  }, [toast, confirm]);

  // 初始化数据加载
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      selfUpdateApi.info().then(d => setSelfUpdateVersion(d)).catch(() => { });
      selfUpdateApi.history().then(setUpdateHistory).catch(() => { });
      if (!ocUpdateInfo) hostInfoApi.checkUpdate().then(res => setOcUpdateInfo(res)).catch(() => { });
      selfUpdateApi.getDismissedVersions().then((all: any) => {
        if (all?.dismissed_clawdeckx_version) setDismissedClawdeckx(all.dismissed_clawdeckx_version);
        if (all?.dismissed_openclaw_version) setDismissedOpenclaw(all.dismissed_openclaw_version);
      }).catch(() => { });
      loadServiceStatus();
      loadRuntimeStatus();
      loadReleaseList();
      loadOcReleaseList();
      // Auto-check with 1-hour cache — skip if checked recently
      const now = Date.now();
      if (now - lastAutoCheckRef.current > UPDATE_CHECK_CACHE_MS) {
        lastAutoCheckRef.current = now;
        setLastCheckTime(now);
        // Run both checks, then force-refresh the backend overview cache and badge counts
        Promise.allSettled([handleSelfUpdateCheck(), handleOcUpdateCheck()]).then(() => {
          selfUpdateApi.overview(true).then(() => {
            window.dispatchEvent(new CustomEvent('clawdeck:refresh-badges'));
          }).catch(() => {});
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.system || 'Software Update'}</h2>
        <p className="text-[12px] text-slate-400 dark:text-white/40 mt-1">{s.selfUpdateDesc}</p>
      </div>

      {/* 更新通道 + 一键检查 */}
      <div className={rowCls}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-cyan-500">tune</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.updateChannel || 'Update Channel'}</h4>
            </div>
            <CustomSelect value={updateChannel} onChange={v => { setUpdateChannel(v as 'stable' | 'beta'); setSelfUpdateInfo(null); }}
              options={[{ value: 'stable', label: 'Stable' }, { value: 'beta', label: 'Beta' }]} className="w-28" />
          </div>
          <p className="text-[11px] text-slate-400 dark:text-white/30 mb-3">
            {updateChannel === 'beta' ? (s.updateChannelBetaDesc || 'Beta channel includes pre-release versions with the latest features but may be less stable.') : (s.updateChannelStableDesc || 'Stable channel provides tested releases recommended for production use.')}
          </p>
          {/* 一键全部检查 */}
          {lastCheckTime && !selfUpdateChecking && !ocUpdateChecking && (
            <p className="text-[11px] text-slate-400 dark:text-white/30 mb-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">schedule</span>
              {s.lastChecked || 'Last checked'}: {new Date(lastCheckTime).toLocaleString()}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={() => { const now = Date.now(); lastAutoCheckRef.current = now; setLastCheckTime(now); Promise.allSettled([handleSelfUpdateCheck(), handleOcUpdateCheck()]).then(() => { selfUpdateApi.overview(true).then(() => window.dispatchEvent(new CustomEvent('clawdeck:refresh-badges'))).catch(() => {}); }); }}
              disabled={selfUpdateChecking || ocUpdateChecking}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-cyan-500 text-white text-[12px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
              <span className={`material-symbols-outlined text-[16px] ${selfUpdateChecking || ocUpdateChecking ? 'animate-spin' : ''}`}>
                {selfUpdateChecking || ocUpdateChecking ? 'progress_activity' : 'refresh'}
              </span>
              {s.checkUpdate || 'Check for Updates'}
            </button>
          </div>
        </div>
      </div>

      {/* 翻译模型选择 */}
      {language !== 'en' && (
        <div className={rowCls}>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[16px] text-blue-500/60">translate</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{sk.translateModel || 'Translation Model'}</h4>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-white/40 mb-3">
              {sk.translateModelDesc || 'Choose the model for translating skill descriptions and release notes. Defaults to the cheapest available; falls back to free API if none configured.'}
            </p>
            <TranslateModelPicker sk={sk} />
          </div>
        </div>
      )}

      {/* ── 🦀 ClawDeckX 更新卡片 ── */}
      <div className={rowCls}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[18px]">🦀</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">ClawDeckX</h4>
              <SmartLink href="https://github.com/ClawDeckX/ClawDeckX" className="flex items-center text-slate-400 dark:text-white/30 hover:text-primary transition-colors" title="GitHub">
                <svg className="w-[14px] h-[14px]" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              </SmartLink>
            </div>
            <span className="font-mono text-[12px] font-bold text-slate-600 dark:text-white/60">
              v{__APP_VERSION__} <span className="font-normal text-slate-400 dark:text-white/30">(build {__BUILD_NUMBER__})</span>
            </span>
          </div>

          {/* v0.9.2 指定版本升级：对齐 openclaw update --tag 体验；列出最近 20 个 release
              （含 prerelease），支持降级。留空 = 最新 stable，保持原有默认行为。
              样式对齐上方 TranslateModelPicker：label + h-9 CustomSelect + h-9 refresh 按钮。 */}
          <VersionPicker
            value={selectedTag}
            onChange={(v) => void handleSelectTag(v)}
            releases={releaseList}
            loading={loadingReleases}
            onRefresh={() => void loadReleaseList(true)}
            labels={versionPickerLabels}
          />

          {/* 状态 */}
          {!selfUpdateInfo && !selfUpdateChecking && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-[14px]">info</span>
              {s.selfUpdateDesc}
            </div>
          )}
          {selfUpdateChecking && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-white/50">
              <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
              {s.selfUpdateChecking || 'Checking...'}
            </div>
          )}
          {selfUpdateInfo && !selfUpdateInfo.available && !selfUpdateInfo.error && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="material-symbols-outlined text-[14px] text-mac-green">check_circle</span>
              <span className="text-mac-green font-medium">{s.selfUpdateCurrent}</span>
            </div>
          )}
          {selfUpdateInfo?.error && !selfUpdateInfo.available && (() => {
            const err = selfUpdateInfo.error;
            let msg = err;
            let icon = 'error';
            let color = 'text-red-500';
            if (err.startsWith('Cannot connect to GitHub')) {
              msg = s.updateCannotConnect || 'Cannot connect to GitHub. Please check your network or download manually';
              icon = 'wifi_off';
              color = 'text-amber-500';
            } else if (err.startsWith('GITHUB_SERVER_ERROR:')) {
              msg = s.updateGithubServerError || 'GitHub server is temporarily unavailable, please try again later';
              icon = 'cloud_off';
              color = 'text-amber-500';
            } else if (err === 'GITHUB_RATE_LIMITED') {
              msg = s.updateGithubRateLimited || 'GitHub API rate limit reached, please try again later';
              icon = 'schedule';
              color = 'text-amber-500';
            } else if (err.startsWith('GITHUB_API_ERROR:')) {
              msg = s.updateGithubApiError || 'Unable to connect to GitHub, please check your network';
              icon = 'wifi_off';
              color = 'text-amber-500';
            }
            return (
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className={`material-symbols-outlined text-[14px] ${color}`}>{icon}</span>
                <span className={color}>{msg}</span>
              </div>
            );
          })()}

          {/* Release Notes — 无论是否有更新，只要有 releaseNotes 就显示 */}
          {selfUpdateInfo && !selfUpdateInfo.available && selfUpdateInfo.releaseNotes && (() => {
            const notesText = (showTranslated && translatedNotes) ? translatedNotes : selfUpdateInfo.releaseNotes!;
            const isLong = notesText.length > 600;
            return (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-white/40">
                    <span className="material-symbols-outlined text-[14px]">description</span>
                    {s.selfUpdateReleaseNotes} <span className="font-normal ms-1 text-[10px] text-slate-400 dark:text-white/25">v{selfUpdateInfo.latestVersion || selfUpdateInfo.currentVersion}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {language !== 'en' && (
                      translatedNotes ? (
                        <button onClick={() => setShowTranslated(v => !v)}
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 transition-colors">
                          <span className="material-symbols-outlined text-[12px]">translate</span>
                          {showTranslated ? (s.showOriginal || 'Original') : (s.showTranslation || 'Translated')}
                        </button>
                      ) : (
                        <button onClick={() => handleTranslateNotes(selfUpdateInfo.releaseNotes!, 'clawdeckx', selfUpdateInfo.latestVersion || selfUpdateInfo.currentVersion)} disabled={notesTranslating}
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 disabled:opacity-40 transition-colors">
                          <span className={`material-symbols-outlined text-[12px] ${notesTranslating ? 'animate-spin' : ''}`}>
                            {notesTranslating ? 'progress_activity' : 'translate'}
                          </span>
                          {notesTranslating ? (s.translating || 'Translating...') : (s.translateNotes || 'Translate')}
                        </button>
                      )
                    )}
                    {isLong && (
                      <button onClick={() => setNotesExpanded(v => !v)}
                        className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-400 dark:text-white/30 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                        <span className="material-symbols-outlined text-[12px]">{notesExpanded ? 'expand_less' : 'expand_more'}</span>
                        {notesExpanded ? (s.collapse || 'Collapse') : (s.expand || 'Expand')}
                      </button>
                    )}
                  </div>
                </div>
                {selfUpdateInfo.publishedAt && (
                  <div className="text-[10px] text-slate-400 dark:text-white/30 px-1">
                    {s.updatePublishedAt || 'Published'}: {(() => {
                      const diff = Date.now() - new Date(selfUpdateInfo.publishedAt!).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 60) return `${mins}m ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24) return `${hrs}h ago`;
                      return `${Math.floor(hrs / 24)}d ago`;
                    })()}
                  </div>
                )}
                <div className={`relative px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-[11px] text-slate-600 dark:text-white/50 leading-relaxed overflow-hidden transition-all duration-300 ${
                  isLong && !notesExpanded ? 'max-h-36' : 'max-h-[600px]'
                } overflow-y-auto`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(notesText) }} />
                {isLong && !notesExpanded && (
                  <div className="relative -mt-10 h-10 bg-gradient-to-t from-slate-50 dark:from-[#1c1c1e] to-transparent pointer-events-none rounded-b-lg" />
                )}
              </div>
            );
          })()}

          {/* 新版本可用 */}
          {selfUpdateInfo?.available && (
            <div className="mt-2 space-y-3">
              <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-primary/5 dark:bg-primary/10 border border-primary/20">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-primary">new_releases</span>
                  <span className="text-[11px] font-bold text-primary">{s.selfUpdateAvailable}</span>
                </div>
                <span className="text-[11px] font-mono font-bold text-primary">v{selfUpdateInfo.currentVersion} → v{selfUpdateInfo.latestVersion}</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-white/30 px-1">
                {selfUpdateInfo.publishedAt && (
                  <span>{s.updatePublishedAt || 'Published'}: {(() => {
                    const d = new Date(selfUpdateInfo.publishedAt);
                    const diff = Date.now() - d.getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    const days = Math.floor(hrs / 24);
                    return `${days}d ago`;
                  })()}</span>
                )}
                {(selfUpdateInfo.assetSize ?? 0) > 0 && <span>{s.selfUpdateSize}: {((selfUpdateInfo.assetSize ?? 0) / 1024 / 1024).toFixed(1)} MB</span>}
                {selfUpdateInfo.channel && <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-medium">{selfUpdateInfo.channel}</span>}
              </div>
              {/* Release Notes with translation + collapse */}
              {selfUpdateInfo.releaseNotes && (() => {
                const notesText = (showTranslated && translatedNotes) ? translatedNotes : selfUpdateInfo.releaseNotes!;
                const isLong = notesText.length > 600;
                return (
                  <div className="space-y-2">
                    {/* Header: title + translate/toggle buttons */}
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-white/40">
                        <span className="material-symbols-outlined text-[14px]">description</span>
                        {s.selfUpdateReleaseNotes}
                      </div>
                      <div className="flex items-center gap-1">
                        {/* Translate / Toggle button (non-English only) */}
                        {language !== 'en' && (
                          translatedNotes ? (
                            <button onClick={() => setShowTranslated(v => !v)}
                              className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 transition-colors">
                              <span className="material-symbols-outlined text-[12px]">translate</span>
                              {showTranslated ? (s.showOriginal || 'Original') : (s.showTranslation || 'Translated')}
                            </button>
                          ) : (
                            <button onClick={() => handleTranslateNotes(selfUpdateInfo.releaseNotes!, 'clawdeckx', selfUpdateInfo.latestVersion || selfUpdateInfo.currentVersion)} disabled={notesTranslating}
                              className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 disabled:opacity-40 transition-colors">
                              <span className={`material-symbols-outlined text-[12px] ${notesTranslating ? 'animate-spin' : ''}`}>
                                {notesTranslating ? 'progress_activity' : 'translate'}
                              </span>
                              {notesTranslating ? (s.translating || 'Translating...') : (s.translateNotes || 'Translate')}
                            </button>
                          )
                        )}
                        {/* Expand/Collapse (long content only) */}
                        {isLong && (
                          <button onClick={() => setNotesExpanded(v => !v)}
                            className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-400 dark:text-white/30 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                            <span className="material-symbols-outlined text-[12px]">{notesExpanded ? 'expand_less' : 'expand_more'}</span>
                            {notesExpanded ? (s.collapse || 'Collapse') : (s.expand || 'Expand')}
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Content */}
                    <div className={`relative px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-[11px] text-slate-600 dark:text-white/50 leading-relaxed overflow-hidden transition-all duration-300 ${
                      isLong && !notesExpanded ? 'max-h-36' : 'max-h-[600px]'
                    } overflow-y-auto`}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(notesText) }} />
                    {/* Fade overlay when collapsed */}
                    {isLong && !notesExpanded && (
                      <div className="relative -mt-10 h-10 bg-gradient-to-t from-slate-50 dark:from-[#1c1c1e] to-transparent pointer-events-none rounded-b-lg" />
                    )}
                  </div>
                );
              })()}
              {/* 已忽略此版本 */}
              {dismissedClawdeckx === selfUpdateInfo.latestVersion && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.06]">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px] text-slate-400 dark:text-white/30">notifications_off</span>
                    <span className="text-[11px] text-slate-500 dark:text-white/40">{s.dismissedVersion || 'This version is ignored'}</span>
                  </div>
                  <button onClick={() => handleUndismiss('clawdeckx')} disabled={dismissing === 'clawdeckx'}
                    className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 transition-colors disabled:opacity-40">
                    <span className={`material-symbols-outlined text-[12px] ${dismissing === 'clawdeckx' ? 'animate-spin' : ''}`}>
                      {dismissing === 'clawdeckx' ? 'progress_activity' : 'notifications_active'}
                    </span>
                    {s.undismiss || 'Restore'}
                  </button>
                </div>
              )}
              {/* 操作按钮 */}
              {!selfUpdating && !selfUpdateProgress?.done && (
                <div className="flex gap-2">
                  <button onClick={handleSelfUpdateApply} disabled={!selfUpdateInfo.downloadUrl}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-primary text-white text-[12px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
                    <span className="material-symbols-outlined text-[16px]">download</span>
                    {selfUpdateInfo.downloadUrl
                      ? (selectedTag
                        ? `${isDockerRuntime ? (s.runtimeOverlay || s.selfUpdateDownload) : s.selfUpdateDownload} → v${selfUpdateInfo.latestVersion || selectedTag}`
                        : (isDockerRuntime ? (s.runtimeOverlay || s.selfUpdateDownload) : s.selfUpdateDownload))
                      : s.selfUpdateNoAsset}
                  </button>
                  {dismissedClawdeckx !== selfUpdateInfo.latestVersion && (
                    <button onClick={() => handleDismiss('clawdeckx', selfUpdateInfo.latestVersion!)} disabled={dismissing === 'clawdeckx'}
                      className="flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/40 text-[12px] font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-all disabled:opacity-40"
                      title={s.dismissTooltip || 'Ignore this version, no more reminders until a newer version is released'}>
                      <span className={`material-symbols-outlined text-[14px] ${dismissing === 'clawdeckx' ? 'animate-spin' : ''}`}>
                        {dismissing === 'clawdeckx' ? 'progress_activity' : 'notifications_off'}
                      </span>
                      {s.dismiss || 'Ignore'}
                    </button>
                  )}
                  <SmartLink href="https://github.com/ClawDeckX/ClawDeckX/releases"
                    className="flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-[12px] font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    {s.viewReleases}
                  </SmartLink>
                </div>
              )}
              {/* 下载进度 */}
              {selfUpdateProgress && !selfUpdateProgress.done && !selfUpdateProgress.error && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-white/30">
                    <span>{selfUpdateProgress.stage === 'downloading' ? s.selfUpdateDownloading : selfUpdateProgress.stage === 'replacing' ? s.selfUpdateApplying : selfUpdateProgress.stage}</span>
                    <span>{Math.round(selfUpdateProgress.percent)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${selfUpdateProgress.percent}%` }} />
                  </div>
                </div>
              )}
              {selfUpdateProgress?.done && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-mac-green/10">
                  <span className="material-symbols-outlined text-[14px] text-mac-green animate-spin">progress_activity</span>
                  <span className="text-[11px] font-bold text-mac-green">{s.selfUpdateDone}</span>
                </div>
              )}
              {selfUpdateProgress?.error && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/5">
                  <span className="material-symbols-outlined text-[14px] text-red-500">error</span>
                  <span className="text-[11px] text-red-500">{s.selfUpdateFailed}: {selfUpdateProgress.error}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 🦞 OpenClaw 更新卡片 ── */}
      <div className={rowCls}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[18px]">🦞</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">OpenClaw</h4>
              <SmartLink href="https://github.com/openclaw/openclaw" className="flex items-center text-slate-400 dark:text-white/30 hover:text-primary transition-colors" title="GitHub">
                <svg className="w-[14px] h-[14px]" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              </SmartLink>
            </div>
            <span className="font-mono text-[12px] font-bold text-slate-600 dark:text-white/60">
              {ocUpdateInfo?.releaseTag || (ocUpdateInfo?.currentVersion ? `v${ocUpdateInfo.currentVersion}` : '—')}
            </span>
          </div>

          <VersionPicker
            value={ocSelectedTag}
            onChange={handleSelectOcTag}
            releases={ocReleaseList}
            loading={ocLoadingReleases}
            onRefresh={() => void loadOcReleaseList(true)}
            labels={versionPickerLabels}
          />

          {!ocUpdateInfo && !ocUpdateChecking && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-[14px]">info</span>
              {s.openclawUpdateDesc}
            </div>
          )}
          {ocUpdateChecking && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-white/50">
              <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
              {s.openclawUpdateChecking || 'Checking...'}
            </div>
          )}
          {ocUpdateInfo && !ocUpdateInfo.currentVersion && !ocUpdateInfo.error && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="material-symbols-outlined text-[14px] text-amber-500">warning</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">{s.openclawNotInstalled}</span>
            </div>
          )}
          {ocUpdateInfo && !ocUpdateInfo.available && !ocUpdateInfo.error && ocUpdateInfo.currentVersion && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="material-symbols-outlined text-[14px] text-mac-green">check_circle</span>
              <span className="text-mac-green font-medium">{s.openclawUpdateCurrent}</span>
            </div>
          )}
          {ocUpdateInfo?.error && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="material-symbols-outlined text-[14px] text-red-500">error</span>
              <span className="text-red-500">{ocUpdateInfo.error}</span>
            </div>
          )}

          {/* OpenClaw Release Notes — 当前已是最新时也显示 */}
          {ocUpdateInfo && !ocUpdateInfo.available && (ocUpdateInfo.releaseNotes || ocNotesTranslating) && (() => {
            const ocNotes = (ocShowTranslated && ocTranslatedNotes) ? ocTranslatedNotes : (ocUpdateInfo.releaseNotes || '');
            const ocIsLong = ocNotes.length > 600;
            return (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-white/40">
                    <span className="material-symbols-outlined text-[14px]">description</span>
                    {s.selfUpdateReleaseNotes} <span className="font-normal ms-1 text-[10px] text-slate-400 dark:text-white/25">{ocUpdateInfo.releaseTag || `v${ocUpdateInfo.currentVersion}`}</span>
                    {ocNotesTranslating && <span className="material-symbols-outlined text-[12px] animate-spin text-primary/50 ms-1">progress_activity</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    {language !== 'en' && (
                      ocTranslatedNotes ? (
                        <button onClick={() => setOcShowTranslated(v => !v)}
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 transition-colors">
                          <span className="material-symbols-outlined text-[12px]">translate</span>
                          {ocShowTranslated ? (s.showOriginal || 'Original') : (s.showTranslation || 'Translated')}
                        </button>
                      ) : (
                        <button onClick={() => handleOcTranslateNotes(ocUpdateInfo.releaseNotes!, ocUpdateInfo.releaseTag || ocUpdateInfo.currentVersion)} disabled={ocNotesTranslating}
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 disabled:opacity-40 transition-colors">
                          <span className={`material-symbols-outlined text-[12px] ${ocNotesTranslating ? 'animate-spin' : ''}`}>
                            {ocNotesTranslating ? 'progress_activity' : 'translate'}
                          </span>
                          {ocNotesTranslating ? (s.translating || 'Translating...') : (s.translateNotes || 'Translate')}
                        </button>
                      )
                    )}
                    {ocIsLong && (
                      <button onClick={() => setOcNotesExpanded(v => !v)}
                        className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-400 dark:text-white/30 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                        <span className="material-symbols-outlined text-[12px]">{ocNotesExpanded ? 'expand_less' : 'expand_more'}</span>
                        {ocNotesExpanded ? (s.collapse || 'Collapse') : (s.expand || 'Expand')}
                      </button>
                    )}
                  </div>
                </div>
                {ocUpdateInfo.publishedAt && (
                  <div className="text-[10px] text-slate-400 dark:text-white/30 px-1">
                    {s.updatePublishedAt || 'Published'}: {(() => {
                      const diff = Date.now() - new Date(ocUpdateInfo.publishedAt!).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 60) return `${mins}m ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24) return `${hrs}h ago`;
                      return `${Math.floor(hrs / 24)}d ago`;
                    })()}
                  </div>
                )}
                <div className={`relative px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-[11px] text-slate-600 dark:text-white/50 leading-relaxed overflow-hidden transition-all duration-300 ${
                  ocIsLong && !ocNotesExpanded ? 'max-h-36' : 'max-h-[600px]'
                } overflow-y-auto`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(ocNotes) }} />
                {ocIsLong && !ocNotesExpanded && (
                  <div className="relative -mt-8 h-8 bg-gradient-to-t from-slate-50 dark:from-[#1c1c1e] to-transparent pointer-events-none rounded-b-lg" />
                )}
              </div>
            );
          })()}

          {ocUpdateInfo?.available && (
            <div className="mt-2 space-y-3">
              <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-emerald-500">new_releases</span>
                  <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{s.openclawUpdateAvailable}</span>
                </div>
                <span className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">v{ocUpdateInfo.currentVersion} → v{ocUpdateInfo.latestVersion}</span>
              </div>
              {/* OpenClaw Release Notes */}
              {(ocUpdateInfo.releaseNotes || ocNotesTranslating) && (() => {
                const ocNotes = (ocShowTranslated && ocTranslatedNotes) ? ocTranslatedNotes : (ocUpdateInfo.releaseNotes || '');
                const ocIsLong = ocNotes.length > 600;
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-white/40">
                        <span className="material-symbols-outlined text-[14px]">description</span>
                        {s.selfUpdateReleaseNotes}
                        {ocNotesTranslating && <span className="material-symbols-outlined text-[12px] animate-spin text-primary/50 ms-1">progress_activity</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        {language !== 'en' && (
                          ocTranslatedNotes ? (
                            <button onClick={() => setOcShowTranslated(v => !v)}
                              className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 transition-colors">
                              <span className="material-symbols-outlined text-[12px]">translate</span>
                              {ocShowTranslated ? (s.showOriginal || 'Original') : (s.showTranslation || 'Translated')}
                            </button>
                          ) : (
                            <button onClick={() => handleOcTranslateNotes(ocUpdateInfo.releaseNotes!, ocUpdateInfo.latestVersion || ocUpdateInfo.currentVersion)} disabled={ocNotesTranslating}
                              className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 disabled:opacity-40 transition-colors">
                              <span className={`material-symbols-outlined text-[12px] ${ocNotesTranslating ? 'animate-spin' : ''}`}>
                                {ocNotesTranslating ? 'progress_activity' : 'translate'}
                              </span>
                              {ocNotesTranslating ? (s.translating || 'Translating...') : (s.translateNotes || 'Translate')}
                            </button>
                          )
                        )}
                        {ocIsLong && (
                          <button onClick={() => setOcNotesExpanded(v => !v)}
                            className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-400 dark:text-white/30 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                            <span className="material-symbols-outlined text-[12px]">{ocNotesExpanded ? 'expand_less' : 'expand_more'}</span>
                            {ocNotesExpanded ? (s.collapse || 'Collapse') : (s.expand || 'Expand')}
                          </button>
                        )}
                      </div>
                    </div>
                    {ocUpdateInfo.publishedAt && (
                      <div className="text-[10px] text-slate-400 dark:text-white/30 px-1">
                        {s.updatePublishedAt || 'Published'}: {(() => {
                          const diff = Date.now() - new Date(ocUpdateInfo.publishedAt!).getTime();
                          const mins = Math.floor(diff / 60000);
                          if (mins < 60) return `${mins}m ago`;
                          const hrs = Math.floor(mins / 60);
                          if (hrs < 24) return `${hrs}h ago`;
                          const days = Math.floor(hrs / 24);
                          return `${days}d ago`;
                        })()}
                      </div>
                    )}
                    <div className={`relative px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-[11px] text-slate-600 dark:text-white/50 leading-relaxed overflow-hidden transition-all duration-300 ${
                      ocIsLong && !ocNotesExpanded ? 'max-h-36' : 'max-h-[600px]'
                    } overflow-y-auto`}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(ocNotes) }} />
                    {ocIsLong && !ocNotesExpanded && (
                      <div className="relative -mt-8 h-8 bg-gradient-to-t from-slate-50 dark:from-[#1c1c1e] to-transparent pointer-events-none rounded-b-lg" />
                    )}
                  </div>
                );
              })()}
              {/* 已忽略此版本 */}
              {dismissedOpenclaw === ocUpdateInfo.latestVersion && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.06]">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px] text-slate-400 dark:text-white/30">notifications_off</span>
                    <span className="text-[11px] text-slate-500 dark:text-white/40">{s.dismissedVersion || 'This version is ignored'}</span>
                  </div>
                  <button onClick={() => handleUndismiss('openclaw')} disabled={dismissing === 'openclaw'}
                    className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 transition-colors disabled:opacity-40">
                    <span className={`material-symbols-outlined text-[12px] ${dismissing === 'openclaw' ? 'animate-spin' : ''}`}>
                      {dismissing === 'openclaw' ? 'progress_activity' : 'notifications_active'}
                    </span>
                    {s.undismiss || 'Restore'}
                  </button>
                </div>
              )}
              {/* v0.9.2 OpenClaw 一行布局：picker + 执行更新 + 忽略 + 查看更新。
                  picker 宽度自适应（min 140 / max 240）；执行更新按钮 flex-1 吞剩余空间；
                  Docker runtime 不渲染 picker，此时按钮行仍保留。picker 空值 = @latest。 */}
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleOcUpdateRun} disabled={effectiveOcUpdating}
                  className="flex-1 min-w-[140px] flex items-center justify-center gap-1.5 px-4 h-9 rounded-lg bg-emerald-500 text-white text-[12px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
                  <span className={`material-symbols-outlined text-[16px] ${effectiveOcUpdating ? 'animate-spin' : ''}`}>{effectiveOcUpdating ? 'progress_activity' : 'download'}</span>
                  {effectiveOcUpdating ? s.openclawUpdateRunning : (ocSelectedTag ? `${s.openclawUpdateRun} → v${ocSelectedTag}` : s.openclawUpdateRun)}
                </button>
                {dismissedOpenclaw !== ocUpdateInfo.latestVersion && (
                  <button onClick={() => handleDismiss('openclaw', ocUpdateInfo.latestVersion!)} disabled={dismissing === 'openclaw'}
                    className="shrink-0 flex items-center justify-center gap-1 px-3 h-9 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/40 text-[12px] font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-all disabled:opacity-40"
                    title={s.dismissTooltip || 'Ignore this version, no more reminders until a newer version is released'}>
                    <span className={`material-symbols-outlined text-[14px] ${dismissing === 'openclaw' ? 'animate-spin' : ''}`}>
                      {dismissing === 'openclaw' ? 'progress_activity' : 'notifications_off'}
                    </span>
                    {s.dismiss || 'Ignore'}
                  </button>
                )}
                <SmartLink href="https://github.com/openclaw/openclaw/releases"
                  className="shrink-0 flex items-center justify-center gap-1 px-3 h-9 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-[12px] font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                  {s.viewReleases}
                </SmartLink>
              </div>
            </div>
          )}
          {/* 已是最新 / 未安装 / 出错状态下，available 分支不渲染主按钮，此处补齐 picker + 按钮同一行。
              picker 总是渲染；"执行更新"按钮仅在选中 tag 时出现，防止误触"重装最新"。 */}
          {!ocUpdateInfo?.available && ocSelectedTag && (
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={handleOcUpdateRun}
                disabled={effectiveOcUpdating}
                className="shrink-0 flex items-center justify-center gap-1.5 px-4 h-9 rounded-lg bg-emerald-500 text-white text-[12px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
                <span className={`material-symbols-outlined text-[16px] ${effectiveOcUpdating ? 'animate-spin' : ''}`}>
                  {effectiveOcUpdating ? 'progress_activity' : 'download'}
                </span>
                {effectiveOcUpdating
                  ? s.openclawUpdateRunning
                  : `${s.openclawUpdateRun || 'Update'} → v${ocSelectedTag}`}
              </button>
            </div>
          )}

          {/* 升级日志面板 */}
          {(effectiveOcUpdating || effectiveOcLogs.length > 0) && (
            <div className="mt-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
              {effectiveOcUpdating && (
                <div className="h-1.5 bg-slate-200 dark:bg-white/10">
                  <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${effectiveOcProgress}%` }} />
                </div>
              )}
              {effectiveOcStep && (
                <div className="px-3 py-2 border-b border-slate-200 dark:border-white/10 flex items-center gap-1.5">
                  {effectiveOcUpdating && <span className="material-symbols-outlined text-[12px] text-emerald-500 animate-spin">progress_activity</span>}
                  {!effectiveOcUpdating && effectiveOcProgress >= 100 && <span className="material-symbols-outlined text-[12px] text-emerald-500">check_circle</span>}
                  <span className="text-[10px] text-slate-600 dark:text-white/60 flex-1 truncate">{effectiveOcStep}</span>
                  {effectiveOcUpdating && <span className="text-[9px] text-slate-400 dark:text-white/40">{effectiveOcProgress}%</span>}
                </div>
              )}
              <div ref={ocUpdateLogRef} className="max-h-28 overflow-y-auto px-3 py-2 font-mono text-[10px] text-slate-500 dark:text-white/50 space-y-0.5 select-text cursor-text">
                {effectiveOcLogs.length === 0 && effectiveOcUpdating && <div className="text-slate-400 dark:text-white/35">...</div>}
                {effectiveOcLogs.map((line, i) => <div key={i} className="break-all leading-relaxed">{line}</div>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 兼容性状态 */}
      {selfUpdateVersion?.openclawCompat && (
        <div className={rowCls}>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[16px] text-amber-500/60">verified</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.updateCompat || 'Compatibility'}</h4>
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] text-[11px]">
              <span className="text-slate-400 dark:text-white/40">{s.updateCompatReq || 'ClawDeckX requires OpenClaw'}:</span>
              <span className="font-mono font-bold text-slate-700 dark:text-white/70">{selfUpdateVersion.openclawCompat}</span>
              {ocUpdateInfo?.currentVersion && (
                <span className={`ms-auto px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  compareSemverLoose(ocUpdateInfo.currentVersion, selfUpdateVersion.openclawCompat.replace('>=', '')) >= 0
                    ? 'bg-mac-green/10 text-mac-green'
                    : 'bg-red-500/10 text-red-500'
                }`}>
                  {compareSemverLoose(ocUpdateInfo.currentVersion, selfUpdateVersion.openclawCompat.replace('>=', '')) >= 0 ? '✓ ' + (s.aboutCompat || 'Compatible') : '✗ ' + (s.updateIncompat || 'Incompatible')}
                </span>
              )}
            </div>
            {isDockerRuntime && (
              <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-slate-200 dark:border-white/[0.06] bg-slate-50/70 dark:bg-white/[0.02] px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-white/70">
                    <span className="material-symbols-outlined text-[14px] text-blue-500/70">restart_alt</span>
                    {s.dockerRestartTitle || 'Restart Docker Container'}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500 dark:text-white/35">
                    {s.runtimeRestartHint || 'Restart the container to activate the updated binary'}
                  </p>
                </div>
                <button
                  onClick={handleRuntimeRestart}
                  className="shrink-0 rounded-lg bg-primary/10 px-3 py-1.5 text-[10px] font-bold text-primary hover:bg-primary/15 transition-colors"
                >
                  {s.dockerRestartBtn || 'Restart Now'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Docker 运行时覆盖 ── */}
      {runtimeStatus?.is_docker && (
        <div className={rowCls}>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="material-symbols-outlined text-[16px] text-blue-500/60">layers</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.runtimeOverlay || 'Docker Runtime Overlay'}</h4>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-white/30 leading-relaxed mb-3">
              {s.runtimeOverlayDesc || 'Updates are stored in a persistent volume so they survive container restarts and recreations. No need to rebuild the Docker image for every update.'}
            </p>

            <div className="space-y-2">
              {/* ClawDeckX Runtime */}
              {(() => {
                const c = runtimeStatus.clawdeckx;
                return (
                  <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                    c.using_overlay
                      ? 'bg-blue-50 dark:bg-blue-500/5 border-blue-200 dark:border-blue-500/20'
                      : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/[0.06]'
                  }`}>
                    <span className="text-[16px]">🦀</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[12px] font-bold text-slate-700 dark:text-white/70">ClawDeckX</p>
                        {c.using_overlay && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400">
                            {s.runtimeUsingOverlay || 'Using overlay'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400 dark:text-white/30">
                        <span>{s.runtimeImageVersion || 'Image'}: <span className="font-mono font-medium text-slate-500 dark:text-white/50">{c.image_version || '—'}</span></span>
                        {c.using_overlay && (
                          <span>{s.runtimeOverlayVersion || 'Overlay'}: <span className="font-mono font-medium text-blue-600 dark:text-blue-400">{c.runtime_version || '—'}</span></span>
                        )}
                        <span>{s.runtimeActiveVersion || 'Active'}: <span className="font-mono font-bold text-slate-600 dark:text-white/60">{c.active_version || '—'}</span></span>
                      </div>
                    </div>
                    {c.using_overlay && (
                      <button
                        onClick={() => handleRuntimeRollback('clawdeckx')}
                        disabled={runtimeRollingBack}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors disabled:opacity-40 shrink-0"
                      >
                        <span className={`material-symbols-outlined text-[13px] ${runtimeRollingBack ? 'animate-spin' : ''}`}>
                          {runtimeRollingBack ? 'progress_activity' : 'undo'}
                        </span>
                        {s.runtimeRollback || 'Rollback to Image'}
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* OpenClaw Runtime */}
              {(() => {
                const c = runtimeStatus.openclaw;
                const canRollback = c.using_overlay || !!c.overlay_mismatch;
                return (
                  <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                    canRollback
                      ? 'bg-blue-50 dark:bg-blue-500/5 border-blue-200 dark:border-blue-500/20'
                      : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/[0.06]'
                  }`}>
                    <span className="text-[16px]">🦞</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[12px] font-bold text-slate-700 dark:text-white/70">OpenClaw</p>
                        {c.using_overlay && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400">
                            {s.runtimeUsingOverlay || 'Using overlay'}
                          </span>
                        )}
                        {c.overlay_mismatch && !c.using_overlay && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400">
                            {s.runtimeRestartHint || 'Restart required'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400 dark:text-white/30">
                        <span>{s.runtimeImageVersion || 'Image'}: <span className="font-mono font-medium text-slate-500 dark:text-white/50">{c.image_version || '—'}</span></span>
                        {c.using_overlay && (
                          <span>{s.runtimeOverlayVersion || 'Overlay'}: <span className="font-mono font-medium text-blue-600 dark:text-blue-400">{c.runtime_version || '—'}</span></span>
                        )}
                        <span>{s.runtimeActiveVersion || 'Active'}: <span className="font-mono font-bold text-slate-600 dark:text-white/60">{c.active_version || '—'}</span></span>
                      </div>
                    </div>
                    {canRollback && (
                      <button
                        onClick={() => handleRuntimeRollback('openclaw')}
                        disabled={runtimeRollingBack}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors disabled:opacity-40 shrink-0"
                      >
                        <span className={`material-symbols-outlined text-[13px] ${runtimeRollingBack ? 'animate-spin' : ''}`}>
                          {runtimeRollingBack ? 'progress_activity' : 'undo'}
                        </span>
                        {s.runtimeRollback || 'Rollback to Image'}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── 系统服务 ── */}
      <div className={rowCls}>
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="material-symbols-outlined text-[16px] text-emerald-500/60">settings_system_daydream</span>
            <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.serviceManagement || 'System Service'}</h4>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-white/30 leading-relaxed mb-3">
            {s.serviceAutoStartDesc || 'Register as a system service to automatically start on boot. Once installed, the gateway will run in the background without manual intervention.'}
          </p>

          {serviceStatus ? (
            serviceStatus.is_docker ? (
            <div className="flex items-center gap-3 px-3 py-3 rounded-lg bg-emerald-50 dark:bg-mac-green/5 border border-emerald-200 dark:border-mac-green/20">
              <span className="material-symbols-outlined text-[20px] text-emerald-500 dark:text-mac-green">check_circle</span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold text-emerald-700 dark:text-mac-green">{s.serviceDockerManaged || 'Managed by Docker'}</p>
                <p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5 leading-relaxed">
                  {s.serviceDockerDesc || 'Running inside a Docker container. Auto-start is managed by Docker restart policy and the container entrypoint script. No system service registration is needed.'}
                </p>
              </div>
            </div>
            ) : (
            <div className="space-y-2">
              {/* OpenClaw Service */}
              <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                serviceStatus.openclaw_installed
                  ? 'bg-emerald-50 dark:bg-mac-green/5 border-emerald-200 dark:border-mac-green/20'
                  : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/[0.06]'
              }`}>
                <span className="text-[16px]">🦞</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-slate-700 dark:text-white/70">OpenClaw</p>
                  <p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5">
                    {serviceStatus.openclaw_installed
                      ? (s.serviceAutoStartEnabled || 'Auto-start enabled')
                      : (s.serviceAutoStartDisabled || 'Not registered, manual start required')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {serviceStatus.openclaw_installed && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-mac-green/15 text-emerald-600 dark:text-mac-green">
                      {s.serviceInstalled || 'Installed'}
                    </span>
                  )}
                  <button
                    onClick={() => serviceStatus.openclaw_installed ? handleServiceUninstall('openclaw') : handleServiceInstall('openclaw')}
                    disabled={serviceLoading}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-bold transition-colors disabled:opacity-40 ${
                      serviceStatus.openclaw_installed
                        ? 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20'
                        : 'bg-emerald-50 dark:bg-mac-green/10 text-emerald-600 dark:text-mac-green hover:bg-emerald-100 dark:hover:bg-mac-green/20'
                    }`}
                  >
                    <span className={`material-symbols-outlined text-[13px] ${serviceLoading ? 'animate-spin' : ''}`}>
                      {serviceLoading ? 'progress_activity' : serviceStatus.openclaw_installed ? 'delete_forever' : 'install_desktop'}
                    </span>
                    {serviceStatus.openclaw_installed ? (s.uninstallService || 'Remove') : (s.installService || 'Install')}
                  </button>
                </div>
              </div>

              {/* ClawDeckX Service */}
              <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                serviceStatus.clawdeckx_installed
                  ? 'bg-emerald-50 dark:bg-mac-green/5 border-emerald-200 dark:border-mac-green/20'
                  : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/[0.06]'
              }`}>
                <span className="text-[16px]">🦀</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-slate-700 dark:text-white/70">ClawDeckX</p>
                  <p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5">
                    {serviceStatus.clawdeckx_installed
                      ? (s.serviceAutoStartEnabled || 'Auto-start enabled')
                      : (s.serviceAutoStartDisabled || 'Not registered, manual start required')}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {serviceStatus.clawdeckx_installed && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-mac-green/15 text-emerald-600 dark:text-mac-green">
                      {s.serviceInstalled || 'Installed'}
                    </span>
                  )}
                  <button
                    onClick={() => serviceStatus.clawdeckx_installed ? handleServiceUninstall('clawdeckx') : handleServiceInstall('clawdeckx')}
                    disabled={serviceLoading}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-bold transition-colors disabled:opacity-40 ${
                      serviceStatus.clawdeckx_installed
                        ? 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20'
                        : 'bg-emerald-50 dark:bg-mac-green/10 text-emerald-600 dark:text-mac-green hover:bg-emerald-100 dark:hover:bg-mac-green/20'
                    }`}
                  >
                    <span className={`material-symbols-outlined text-[13px] ${serviceLoading ? 'animate-spin' : ''}`}>
                      {serviceLoading ? 'progress_activity' : serviceStatus.clawdeckx_installed ? 'delete_forever' : 'install_desktop'}
                    </span>
                    {serviceStatus.clawdeckx_installed ? (s.uninstallService || 'Remove') : (s.installService || 'Install')}
                  </button>
                </div>
              </div>
            </div>
            )
          ) : (
            <div className="flex items-center gap-2 px-3 py-3 rounded-lg bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.06]">
              <span className="material-symbols-outlined text-[14px] text-slate-300 dark:text-white/20 animate-spin">progress_activity</span>
              <span className="text-[11px] text-slate-400 dark:text-white/30">{s.loading || 'Loading...'}</span>
            </div>
          )}
        </div>
      </div>

      {/* 系统环境信息 */}
      {selfUpdateVersion && (
        <div className={rowCls}>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-[16px] text-blue-500/60">computer</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.updateSysInfo || 'System Info'}</h4>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {[
                { label: s.updatePlatform || 'Platform', value: selfUpdateVersion.platform },
                { label: s.updateArch || 'Architecture', value: selfUpdateVersion.arch },
                { label: s.updateGoVer || 'Go Runtime', value: selfUpdateVersion.goVersion },
                { label: s.selfUpdateBuild || 'Build', value: selfUpdateVersion.build },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                  <span className="text-slate-400 dark:text-white/30">{item.label}</span>
                  <span className="font-mono font-medium text-slate-600 dark:text-white/60">{item.value || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 更新历史 */}
      {updateHistory.length > 0 && (
        <div className={rowCls}>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-[16px] text-purple-500/60">history</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.updateHistory || 'Update History'}</h4>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {updateHistory.map(entry => (
                <div key={entry.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] text-[11px]">
                  <span className={`material-symbols-outlined text-[14px] ${entry.result === 'success' ? 'text-mac-green' : 'text-red-500'}`}>
                    {entry.result === 'success' ? 'check_circle' : 'error'}
                  </span>
                  <span className="flex-1 truncate text-slate-600 dark:text-white/60">{entry.detail || entry.result}</span>
                  <span className="text-[10px] text-slate-400 dark:text-white/30 shrink-0">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpdateTab;

