
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { authApi, backupApi, auditApi, hostInfoApi, notifyApi, selfUpdateApi, serverConfigApi } from '../services/api';
import type { ServerConfig } from '../services/api';
import { useToast } from '../components/Toast';
import CustomSelect from '../components/CustomSelect';

type SettingsTab = 'account' | 'notify' | 'backup' | 'audit' | 'donate' | 'about';

interface SettingsProps {
  language: Language;
}

const Settings: React.FC<SettingsProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const s = t.set as any;
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleTabSelect = (tab: SettingsTab) => {
    setActiveTab(tab);
    setDrawerOpen(false);
  };

  // ── 当前用户 ──
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string } | null>(null);

  // ── 账户安全 ──
  const [newUsername, setNewUsername] = useState('');
  const [usernameVerifyPwd, setUsernameVerifyPwd] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');

  // ── 备份 ──
  const [backups, setBackups] = useState<any[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);

  // ── 审计日志 ──
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);

  // ── 通知配置 ──
  const [notifyCfg, setNotifyCfg] = useState<Record<string, string>>({});
  const [notifyActive, setNotifyActive] = useState<string[]>([]);
  const [notifyAvailable, setNotifyAvailable] = useState<any[]>([]);
  const [notifyDirty, setNotifyDirty] = useState(false);
  const [notifySaving, setNotifySaving] = useState(false);
  const [notifyTesting, setNotifyTesting] = useState(false);

  // ── OpenClaw 更新 ──
  const [ocUpdateChecking, setOcUpdateChecking] = useState(false);
  const [ocUpdateInfo, setOcUpdateInfo] = useState<{ available: boolean; currentVersion?: string; latestVersion?: string; error?: string } | null>(null);
  const [ocUpdating, setOcUpdating] = useState(false);
  const [ocUpdateLogs, setOcUpdateLogs] = useState<string[]>([]);
  const [ocUpdateStep, setOcUpdateStep] = useState('');
  const [ocUpdateProgress, setOcUpdateProgress] = useState(0);
  const ocUpdateLogRef = useRef<HTMLDivElement>(null);

  // ── 自更新 ──
  const [selfUpdateChecking, setSelfUpdateChecking] = useState(false);
  const [selfUpdateInfo, setSelfUpdateInfo] = useState<any>(null);
  const [selfUpdating, setSelfUpdating] = useState(false);
  const [selfUpdateProgress, setSelfUpdateProgress] = useState<{ stage: string; percent: number; error?: string; done?: boolean } | null>(null);
  const [selfUpdateVersion, setSelfUpdateVersion] = useState<{ version: string; build: string } | null>(null);

  // ── 访问安全 ──
  const [srvCfg, setSrvCfg] = useState<ServerConfig>({ bind: '0.0.0.0', port: 18791, cors_origins: [] });
  const [srvCfgOriginal, setSrvCfgOriginal] = useState<ServerConfig>({ bind: '0.0.0.0', port: 18791, cors_origins: [] });
  const [srvCfgSaving, setSrvCfgSaving] = useState(false);
  const [srvCfgDirty, setSrvCfgDirty] = useState(false);
  const [srvCfgRestart, setSrvCfgRestart] = useState(false);
  const [bindMode, setBindMode] = useState<'all' | 'local' | 'custom'>('all');
  const [newCorsOrigin, setNewCorsOrigin] = useState('');

  const navItems: { id: SettingsTab; icon: string; label: string; color: string }[] = [
    { id: 'account', icon: 'shield_person', label: s.account, color: 'bg-blue-500' },
    { id: 'notify', icon: 'notifications_active', label: s.notify, color: 'bg-amber-500' },
    { id: 'backup', icon: 'backup', label: s.backup, color: 'bg-emerald-500' },
    { id: 'audit', icon: 'assignment', label: s.auditLog, color: 'bg-orange-500' },
    { id: 'donate', icon: 'favorite', label: s.donate, color: 'bg-pink-500' },
    { id: 'about', icon: 'info', label: s.about, color: 'bg-purple-500' },
  ];

  const fetchBackups = useCallback(() => {
    backupApi.list().then((data: any) => setBackups(Array.isArray(data) ? data : [])).catch(() => { });
  }, []);

  const fetchAuditLogs = useCallback((page: number) => {
    setAuditLoading(true);
    auditApi.list({ page, page_size: 15 }).then((data: any) => {
      if (page === 1) setAuditLogs(data.list || []);
      else setAuditLogs(prev => [...prev, ...(data.list || [])]);
      setAuditTotal(data.total || 0);
      setAuditPage(page);
    }).catch(() => { }).finally(() => setAuditLoading(false));
  }, []);

  const fetchNotifyConfig = useCallback(() => {
    notifyApi.getConfig().then((data: any) => {
      setNotifyCfg(data?.config || {});
      setNotifyActive(data?.active_channels || []);
      setNotifyAvailable(data?.available_channels || []);
      setNotifyDirty(false);
    }).catch(() => { });
  }, []);

  const handleNotifySave = useCallback(async () => {
    setNotifySaving(true);
    try {
      const res = await notifyApi.updateConfig(notifyCfg) as any;
      setNotifyActive(res?.active_channels || []);
      setNotifyDirty(false);
      toast('success', s.notifySaved);
    } catch { toast('error', s.notifySaveFail); }
    setNotifySaving(false);
  }, [notifyCfg, s, toast]);

  const handleNotifyTest = useCallback(async () => {
    setNotifyTesting(true);
    try {
      await notifyApi.testSend();
      toast('success', s.notifyTestOk);
    } catch { toast('error', s.notifyTestFail); }
    setNotifyTesting(false);
  }, [s, toast]);

  const setNf = useCallback((key: string, value: string) => {
    setNotifyCfg(prev => ({ ...prev, [key]: value }));
    setNotifyDirty(true);
  }, []);

  // ── 访问安全 handlers ──
  const fetchServerConfig = useCallback(() => {
    serverConfigApi.get().then((data) => {
      const cfg: ServerConfig = { bind: data.bind || '0.0.0.0', port: data.port || 18791, cors_origins: data.cors_origins || [] };
      setSrvCfg(cfg);
      setSrvCfgOriginal(cfg);
      setSrvCfgDirty(false);
      setSrvCfgRestart(false);
      if (cfg.bind === '0.0.0.0') setBindMode('all');
      else if (cfg.bind === '127.0.0.1') setBindMode('local');
      else setBindMode('custom');
    }).catch(() => { });
  }, []);

  const handleSrvCfgSave = useCallback(async () => {
    setSrvCfgSaving(true);
    try {
      await serverConfigApi.update(srvCfg);
      setSrvCfgOriginal(srvCfg);
      setSrvCfgDirty(false);
      setSrvCfgRestart(true);
      toast('success', s.accessSaved);
    } catch { toast('error', s.accessSaveFail); }
    setSrvCfgSaving(false);
  }, [srvCfg, s, toast]);

  const updateSrvCfg = useCallback((patch: Partial<ServerConfig>) => {
    setSrvCfg(prev => {
      const next = { ...prev, ...patch };
      setSrvCfgDirty(JSON.stringify(next) !== JSON.stringify(srvCfgOriginal));
      return next;
    });
  }, [srvCfgOriginal]);

  const handleBindModeChange = useCallback((mode: 'all' | 'local' | 'custom') => {
    setBindMode(mode);
    if (mode === 'all') updateSrvCfg({ bind: '0.0.0.0' });
    else if (mode === 'local') updateSrvCfg({ bind: '127.0.0.1' });
  }, [updateSrvCfg]);

  const handleAddCorsOrigin = useCallback(() => {
    const origin = newCorsOrigin.trim();
    if (!origin) return;
    if (srvCfg.cors_origins.includes(origin)) return;
    updateSrvCfg({ cors_origins: [...srvCfg.cors_origins, origin] });
    setNewCorsOrigin('');
  }, [newCorsOrigin, srvCfg.cors_origins, updateSrvCfg]);

  const handleRemoveCorsOrigin = useCallback((idx: number) => {
    updateSrvCfg({ cors_origins: srvCfg.cors_origins.filter((_, i) => i !== idx) });
  }, [srvCfg.cors_origins, updateSrvCfg]);

  useEffect(() => {
    if (activeTab === 'backup') fetchBackups();
    if (activeTab === 'audit') fetchAuditLogs(1);
    if (activeTab === 'notify') fetchNotifyConfig();
    if (activeTab === 'account') {
      fetchServerConfig();
      authApi.me().then(setCurrentUser).catch(() => { });
    }
    if (activeTab === 'about') {
      selfUpdateApi.info().then(d => setSelfUpdateVersion(d)).catch(() => { });
      if (!ocUpdateInfo) hostInfoApi.checkUpdate().then(res => setOcUpdateInfo(res)).catch(() => { });
    }
  }, [activeTab, fetchBackups, fetchAuditLogs, fetchNotifyConfig, fetchServerConfig]);

  // Self-update handlers
  const handleSelfUpdateCheck = useCallback(async () => {
    setSelfUpdateChecking(true);
    setSelfUpdateInfo(null);
    setSelfUpdateProgress(null);
    try {
      const res = await selfUpdateApi.check();
      setSelfUpdateInfo(res);
    } catch { setSelfUpdateInfo({ available: false, error: 'Network error' }); }
    setSelfUpdateChecking(false);
  }, []);

  const handleSelfUpdateApply = useCallback(async () => {
    if (!selfUpdateInfo?.downloadUrl) return;
    setSelfUpdating(true);
    setSelfUpdateProgress({ stage: 'connecting', percent: 0 });
    try {
      const token = localStorage.getItem('token');
      const resp = await fetch('/api/v1/self-update/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
                  toast('success', s.selfUpdateDone);
                  setTimeout(() => window.location.reload(), 3000);
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
      setSelfUpdateProgress({ stage: 'error', percent: 0, error: err?.message || 'Unknown error' });
      toast('error', s.selfUpdateFailed);
    }
    setSelfUpdating(false);
  }, [selfUpdateInfo, s, toast]);

  // OpenClaw update handlers
  const handleOcUpdateCheck = useCallback(async () => {
    setOcUpdateChecking(true);
    setOcUpdateInfo(null);
    try {
      const res = await hostInfoApi.checkUpdate();
      setOcUpdateInfo(res);
    } catch { setOcUpdateInfo({ available: false, error: 'Network error' }); }
    setOcUpdateChecking(false);
  }, []);

  const handleOcUpdateRun = useCallback(async () => {
    setOcUpdating(true);
    setOcUpdateLogs([]);
    setOcUpdateStep('');
    setOcUpdateProgress(0);
    try {
      const resp = await fetch('/api/v1/setup/update-openclaw', { method: 'POST', credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const reader = resp.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let buf = '';
        let hasError = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          for (const part of parts) {
            if (part.startsWith('data: ')) {
              try {
                const ev = JSON.parse(part.slice(6));
                if (ev.type === 'log') {
                  setOcUpdateLogs(prev => [...prev.slice(-50), ev.message]);
                } else if (ev.type === 'phase' || ev.type === 'step') {
                  setOcUpdateStep(ev.message);
                  setOcUpdateProgress(ev.progress || 0);
                } else if (ev.type === 'progress') {
                  setOcUpdateProgress(ev.progress || 0);
                } else if (ev.type === 'error') {
                  hasError = true;
                } else if (ev.type === 'complete') {
                  setOcUpdateProgress(100);
                  setOcUpdateStep(ev.message);
                }
              } catch {}
            }
          }
        }
        if (hasError) throw new Error('update stream reported error');
      }
      toast('success', s.openclawUpdateOk);
      await new Promise(r => setTimeout(r, 1500));
      const res = await hostInfoApi.checkUpdate();
      setOcUpdateInfo({ ...res, available: false });
    } catch { toast('error', s.openclawUpdateFailed); }
    setOcUpdating(false);
  }, [s, toast]);

  // OpenClaw 升级日志自动滚动
  useEffect(() => {
    if (ocUpdateLogRef.current) {
      ocUpdateLogRef.current.scrollTop = ocUpdateLogRef.current.scrollHeight;
    }
  }, [ocUpdateLogs]);

  const handleChangeUsername = async () => {
    setUsernameError('');
    if (newUsername.length < 3) { setUsernameError(s.usernameTooShort); return; }
    setUsernameLoading(true);
    try {
      await authApi.changeUsername(newUsername, usernameVerifyPwd);
      toast('success', s.usernameChanged);
      setNewUsername(''); setUsernameVerifyPwd('');
      // 刷新当前用户信息
      authApi.me().then(setCurrentUser).catch(() => { });
    } catch (err: any) {
      setUsernameError(err?.message || s.usernameFailed);
    } finally { setUsernameLoading(false); }
  };

  const handleChangePwd = async () => {
    setPwdError('');
    if (newPwd.length < 6) { setPwdError(s.pwdTooShort); return; }
    if (newPwd !== confirmPwd) { setPwdError(s.pwdMismatch); return; }
    setPwdLoading(true);
    try {
      await authApi.changePassword(oldPwd, newPwd);
      toast('success', s.pwdChanged);
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
    } catch (err: any) {
      setPwdError(err?.message || s.pwdFailed);
    } finally { setPwdLoading(false); }
  };

  const handleCreateBackup = async () => {
    setBackupLoading(true);
    try {
      await backupApi.create();
      toast('success', s.backupCreated);
      fetchBackups();
    } catch { toast('error', s.backupFailed); }
    finally { setBackupLoading(false); }
  };

  const handleRestore = async (id: string) => {
    try {
      const res = await backupApi.restore(id);
      if (res?.has_redacted) {
        toast('warning', s.restoreOkRedacted || s.restoreOk);
      } else {
        toast('success', s.restoreOk);
      }
    } catch { toast('error', s.restoreFailed); }
  };

  const handleDeleteBackup = async (id: string) => {
    try { await backupApi.remove(id); fetchBackups(); } catch (err: any) { toast('error', err?.message || s.deleteFailed || 'Delete failed'); }
  };

  const inputCls = "w-full h-9 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-3 text-[13px] text-slate-800 dark:text-white focus:ring-2 focus:ring-primary/30 outline-none transition-all";
  const labelCls = "text-[11px] font-medium text-slate-500 dark:text-white/40";
  const rowCls = "bg-white dark:bg-white/[0.04] rounded-xl border border-slate-200/70 dark:border-white/[0.06] divide-y divide-slate-100 dark:divide-white/[0.04] overflow-hidden";

  return (
    <div className="flex-1 flex overflow-hidden bg-[#f5f5f7] dark:bg-[#1c1c1e]">

      {/* ── Mobile drawer overlay ── */}
      {drawerOpen && (
        <div className="md:hidden fixed top-[32px] bottom-[72px] left-0 right-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
      )}

      {/* ── macOS 风格侧边栏 — desktop: static, mobile: slide-out drawer ── */}
      <aside className={`fixed md:static top-[32px] bottom-[72px] md:top-auto md:bottom-auto left-0 z-50 w-64 md:w-56 shrink-0 border-r border-slate-200/70 dark:border-white/[0.06] bg-[#f5f5f7] dark:bg-[#2c2c2e] md:bg-[#f5f5f7]/80 md:dark:bg-[#2c2c2e]/80 backdrop-blur-xl flex flex-col overflow-y-auto no-scrollbar transform transition-transform duration-200 ease-out ${drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* 用户头像区 */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-200/70 dark:border-white/[0.06]">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold shadow-md">
            {(currentUser?.username || 'A').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-800 dark:text-white truncate">{currentUser?.username || 'Admin'}</p>
            <p className="text-[10px] text-slate-400 dark:text-white/40">ClawDeckX</p>
          </div>
        </div>

        {/* 导航列表 */}
        <nav className="flex flex-col gap-0.5 p-2 mt-1">
          {navItems.map(item => (
            <button key={item.id} onClick={() => handleTabSelect(item.id)}
              className={`flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] transition-all ${activeTab === item.id
                  ? 'bg-primary/15 dark:bg-primary/20 text-primary font-semibold'
                  : 'text-slate-600 dark:text-white/60 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                }`}>
              <div className={`w-[22px] h-[22px] rounded-md ${item.color} flex items-center justify-center shadow-sm`}>
                <span className="material-symbols-outlined text-white text-[14px]">{item.icon}</span>
              </div>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── 右侧内容区 ── */}
      <main className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
        {/* Mobile header with hamburger */}
        <div className="md:hidden flex items-center gap-2.5 px-4 pt-3 pb-1 shrink-0">
          <button onClick={() => setDrawerOpen(true)} className="p-1.5 -ml-1 rounded-lg text-slate-500 dark:text-white/50 hover:text-primary hover:bg-primary/5 transition-all">
            <span className="material-symbols-outlined text-[20px]">menu</span>
          </button>
          <span className="text-[13px] font-semibold text-slate-700 dark:text-white/80">
            {navItems.find(n => n.id === activeTab)?.label}
          </span>
        </div>
        <div className="max-w-xl mx-auto p-4 md:p-6 lg:p-8 w-full">

          {/* 账户安全 */}
          {activeTab === 'account' && (
            <div className="space-y-5">
              <h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.account}</h2>

              {/* 修改用户名 */}
              <div className={rowCls}>
                <div className="px-4 py-3">
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-white/80 mb-3">{s.changeUsername}</p>
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                      <label className={`${labelCls} sm:w-24 sm:shrink-0 sm:text-right`}>{s.newUsername}</label>
                      <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)} className={inputCls} />
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                      <label className={`${labelCls} sm:w-24 sm:shrink-0 sm:text-right`}>{s.verifyPassword}</label>
                      <input type="password" value={usernameVerifyPwd} onChange={e => setUsernameVerifyPwd(e.target.value)} className={inputCls}
                        onKeyDown={e => e.key === 'Enter' && handleChangeUsername()} />
                    </div>
                    {usernameError && <p className="text-xs text-mac-red sm:ml-[108px]">{usernameError}</p>}
                    <div className="flex justify-end pt-1">
                      <button onClick={handleChangeUsername} disabled={usernameLoading || !newUsername || !usernameVerifyPwd}
                        className="px-5 py-[7px] bg-primary text-white rounded-lg text-[13px] font-medium transition-all disabled:opacity-40 hover:opacity-90 shadow-sm">
                        {usernameLoading ? <span className="material-symbols-outlined text-sm animate-spin align-middle">progress_activity</span> : s.save}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 修改密码 */}
              <div className={rowCls}>
                <div className="px-4 py-3">
                  <p className="text-[13px] font-semibold text-slate-700 dark:text-white/80 mb-3">{s.changePwd}</p>
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                      <label className={`${labelCls} sm:w-24 sm:shrink-0 sm:text-right`}>{s.oldPwd}</label>
                      <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} className={inputCls} />
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                      <label className={`${labelCls} sm:w-24 sm:shrink-0 sm:text-right`}>{s.newPwd}</label>
                      <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} className={inputCls} />
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                      <label className={`${labelCls} sm:w-24 sm:shrink-0 sm:text-right`}>{s.confirmPwd}</label>
                      <input type="password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} className={inputCls}
                        onKeyDown={e => e.key === 'Enter' && handleChangePwd()} />
                    </div>
                    {pwdError && <p className="text-xs text-mac-red sm:ml-[108px]">{pwdError}</p>}
                    <div className="flex justify-end pt-1">
                      <button onClick={handleChangePwd} disabled={pwdLoading || !oldPwd || !newPwd}
                        className="px-5 py-[7px] bg-primary text-white rounded-lg text-[13px] font-medium transition-all disabled:opacity-40 hover:opacity-90 shadow-sm">
                        {pwdLoading ? <span className="material-symbols-outlined text-sm animate-spin align-middle">progress_activity</span> : s.save}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── 访问安全 ── */}
              <div className="pt-2">
                <h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.accessSecurity}</h2>
                <p className="text-[12px] text-slate-400 dark:text-white/40 mt-0.5">{s.accessSecurityDesc}</p>
              </div>

              {/* 重启提示 */}
              {srvCfgRestart && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/20">
                  <span className="material-symbols-outlined text-[18px] text-amber-500">warning</span>
                  <div className="flex-1">
                    <p className="text-[12px] font-bold text-amber-700 dark:text-amber-400">{s.restartRequired}</p>
                    <p className="text-[10px] text-amber-600/70 dark:text-amber-400/50 mt-0.5">{s.restartHint}</p>
                  </div>
                </div>
              )}

              <div className={rowCls}>
                <div className="px-4 py-3 space-y-4">
                  {/* 绑定地址 */}
                  <div>
                    <label className={labelCls}>{s.bindAddress}</label>
                    <div className="flex gap-2 mt-1.5">
                      {(['all', 'local', 'custom'] as const).map(mode => (
                        <button key={mode} onClick={() => handleBindModeChange(mode)}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all border ${
                            bindMode === mode
                              ? 'bg-primary/10 text-primary border-primary/30'
                              : 'bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-white/40 border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10'
                          }`}>
                          {mode === 'all' ? s.bindAll : mode === 'local' ? s.bindLocal : s.bindCustom}
                        </button>
                      ))}
                    </div>
                    {bindMode === 'custom' && (
                      <input type="text" value={srvCfg.bind} onChange={e => updateSrvCfg({ bind: e.target.value })}
                        className={`${inputCls} mt-2`} placeholder="192.168.1.100" />
                    )}
                    <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1.5">{s.bindAddressHint}</p>
                  </div>

                  {/* 监听端口 */}
                  <div>
                    <label className={labelCls}>{s.listenPort}</label>
                    <input type="text" inputMode="numeric" value={srvCfg.port}
                      onChange={e => { const v = e.target.value.replace(/\D/g, ''); const n = parseInt(v) || 0; if (n >= 0 && n <= 65535) updateSrvCfg({ port: n || 18791 }); }}
                      className={`${inputCls} mt-1.5 w-40`} />
                    <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1.5">{s.listenPortHint}</p>
                  </div>

                  {/* CORS 允许来源 */}
                  <div>
                    <label className={labelCls}>{s.corsOrigins}</label>
                    <div className="mt-1.5 space-y-1.5">
                      {srvCfg.cors_origins.map((origin, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="flex-1 text-[12px] text-slate-600 dark:text-white/60 font-mono bg-slate-50 dark:bg-white/5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 truncate">{origin}</span>
                          <button onClick={() => handleRemoveCorsOrigin(idx)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors">
                            <span className="material-symbols-outlined text-[14px]">close</span>
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2">
                        <input type="text" value={newCorsOrigin} onChange={e => setNewCorsOrigin(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleAddCorsOrigin()}
                          className={`${inputCls} flex-1`} placeholder="https://example.com" />
                        <button onClick={handleAddCorsOrigin} disabled={!newCorsOrigin.trim()}
                          className="px-3 h-9 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-[11px] font-bold text-slate-600 dark:text-white/50 disabled:opacity-40 transition-colors">
                          {s.addOrigin}
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1.5">{s.corsOriginsHint}</p>
                  </div>

                  {/* 保存按钮 */}
                  <div className="flex justify-end pt-1">
                    <button onClick={handleSrvCfgSave} disabled={srvCfgSaving || !srvCfgDirty}
                      className="px-5 py-[7px] bg-primary text-white rounded-lg text-[13px] font-medium transition-all disabled:opacity-40 hover:opacity-90 shadow-sm flex items-center gap-1.5">
                      {srvCfgSaving && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
                      {s.save}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 异常通知 */}
          {activeTab === 'notify' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.notify}</h2>
                <p className="text-[12px] text-slate-400 dark:text-white/40 mt-0.5">{s.notifyDesc}</p>
              </div>

              {/* Active channels badge */}
              {notifyActive.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-mac-green/10 border border-mac-green/20">
                  <span className="material-symbols-outlined text-[16px] text-mac-green">check_circle</span>
                  <span className="text-[11px] font-bold text-mac-green">{s.notifyActive}: {notifyActive.join(', ')}</span>
                </div>
              )}

              {/* Reuse hint */}
              {notifyAvailable.some((c: any) => c.type === 'telegram' && c.has_token) && !notifyCfg.notify_telegram_token && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-500/5 border border-blue-200/40 dark:border-blue-500/10">
                  <span className="material-symbols-outlined text-[16px] text-blue-500">info</span>
                  <span className="text-[11px] text-blue-600 dark:text-blue-400">{s.notifyReuseHint}</span>
                </div>
              )}

              {/* Telegram */}
              <div className={rowCls}>
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-[#229ED9]">send</span>
                      <p className="text-[13px] font-semibold text-slate-700 dark:text-white/80">{s.notifyTelegram}</p>
                    </div>
                    <button onClick={handleNotifyTest} disabled={notifyTesting}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-[10px] font-bold text-slate-500 dark:text-white/50 disabled:opacity-40 transition-colors">
                      <span className={`material-symbols-outlined text-[12px] ${notifyTesting ? 'animate-spin' : ''}`}>{notifyTesting ? 'progress_activity' : 'send'}</span>
                      {s.notifyTest}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls}>{s.notifyTgToken}</label>
                      <input type="password" value={notifyCfg.notify_telegram_token || ''} onChange={e => setNf('notify_telegram_token', e.target.value)}
                        className={inputCls} placeholder="123456:ABC-DEF..." />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifyTgTokenHint}</p>
                    </div>
                    <div>
                      <label className={labelCls}>{s.notifyTgChatId}</label>
                      <input type="text" value={notifyCfg.notify_telegram_chat_id || ''} onChange={e => setNf('notify_telegram_chat_id', e.target.value)}
                        className={inputCls} placeholder="-1001234567890" />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifyTgChatIdHint}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* DingTalk */}
              <div className={rowCls}>
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-orange-500">notifications</span>
                      <p className="text-[13px] font-semibold text-slate-700 dark:text-white/80">{s.notifyDingtalk}</p>
                    </div>
                    <button onClick={handleNotifyTest} disabled={notifyTesting}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-[10px] font-bold text-slate-500 dark:text-white/50 disabled:opacity-40 transition-colors">
                      <span className={`material-symbols-outlined text-[12px] ${notifyTesting ? 'animate-spin' : ''}`}>{notifyTesting ? 'progress_activity' : 'send'}</span>
                      {s.notifyTest}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls}>{s.notifyDdToken}</label>
                      <input type="password" value={notifyCfg.notify_dingtalk_token || ''} onChange={e => setNf('notify_dingtalk_token', e.target.value)}
                        className={inputCls} placeholder="access_token..." />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifyDdTokenHint}</p>
                    </div>
                    <div>
                      <label className={labelCls}>{s.notifyDdSecret}</label>
                      <input type="password" value={notifyCfg.notify_dingtalk_secret || ''} onChange={e => setNf('notify_dingtalk_secret', e.target.value)}
                        className={inputCls} placeholder="SEC..." />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifyDdSecretHint}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Lark / Feishu */}
              <div className={rowCls}>
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-blue-500">apartment</span>
                      <p className="text-[13px] font-semibold text-slate-700 dark:text-white/80">{s.notifyLark}</p>
                    </div>
                    <button onClick={handleNotifyTest} disabled={notifyTesting}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-[10px] font-bold text-slate-500 dark:text-white/50 disabled:opacity-40 transition-colors">
                      <span className={`material-symbols-outlined text-[12px] ${notifyTesting ? 'animate-spin' : ''}`}>{notifyTesting ? 'progress_activity' : 'send'}</span>
                      {s.notifyTest}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls}>{s.notifyLarkUrl}</label>
                      <input type="text" value={notifyCfg.notify_lark_webhook_url || ''} onChange={e => setNf('notify_lark_webhook_url', e.target.value)}
                        className={inputCls} placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..." />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifyLarkUrlHint}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Discord */}
              <div className={rowCls}>
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-indigo-500">sports_esports</span>
                      <p className="text-[13px] font-semibold text-slate-700 dark:text-white/80">{s.notifyDiscord}</p>
                    </div>
                    <button onClick={handleNotifyTest} disabled={notifyTesting}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-[10px] font-bold text-slate-500 dark:text-white/50 disabled:opacity-40 transition-colors">
                      <span className={`material-symbols-outlined text-[12px] ${notifyTesting ? 'animate-spin' : ''}`}>{notifyTesting ? 'progress_activity' : 'send'}</span>
                      {s.notifyTest}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls}>{s.notifyDcToken}</label>
                      <input type="password" value={notifyCfg.notify_discord_token || ''} onChange={e => setNf('notify_discord_token', e.target.value)}
                        className={inputCls} placeholder="Bot token..." />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifyDcTokenHint}</p>
                    </div>
                    <div>
                      <label className={labelCls}>{s.notifyDcChannelId}</label>
                      <input type="text" value={notifyCfg.notify_discord_channel_id || ''} onChange={e => setNf('notify_discord_channel_id', e.target.value)}
                        className={inputCls} placeholder="123456789012345678" />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifyDcChannelIdHint}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Slack */}
              <div className={rowCls}>
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-green-600">tag</span>
                      <p className="text-[13px] font-semibold text-slate-700 dark:text-white/80">{s.notifySlack}</p>
                    </div>
                    <button onClick={handleNotifyTest} disabled={notifyTesting}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-[10px] font-bold text-slate-500 dark:text-white/50 disabled:opacity-40 transition-colors">
                      <span className={`material-symbols-outlined text-[12px] ${notifyTesting ? 'animate-spin' : ''}`}>{notifyTesting ? 'progress_activity' : 'send'}</span>
                      {s.notifyTest}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls}>{s.notifySlackToken}</label>
                      <input type="password" value={notifyCfg.notify_slack_token || ''} onChange={e => setNf('notify_slack_token', e.target.value)}
                        className={inputCls} placeholder="xoxb-..." />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifySlackTokenHint}</p>
                    </div>
                    <div>
                      <label className={labelCls}>{s.notifySlackChannelId}</label>
                      <input type="text" value={notifyCfg.notify_slack_channel_id || ''} onChange={e => setNf('notify_slack_channel_id', e.target.value)}
                        className={inputCls} placeholder="C01234ABCDE" />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifySlackChannelIdHint}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* WeCom */}
              <div className={rowCls}>
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-emerald-500">business</span>
                      <p className="text-[13px] font-semibold text-slate-700 dark:text-white/80">{s.notifyWecom}</p>
                    </div>
                    <button onClick={handleNotifyTest} disabled={notifyTesting}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-[10px] font-bold text-slate-500 dark:text-white/50 disabled:opacity-40 transition-colors">
                      <span className={`material-symbols-outlined text-[12px] ${notifyTesting ? 'animate-spin' : ''}`}>{notifyTesting ? 'progress_activity' : 'send'}</span>
                      {s.notifyTest}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls}>{s.notifyWecomUrl}</label>
                      <input type="text" value={notifyCfg.notify_wecom_webhook_url || ''} onChange={e => setNf('notify_wecom_webhook_url', e.target.value)}
                        className={inputCls} placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifyWecomUrlHint}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Webhook */}
              <div className={rowCls}>
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px] text-pink-500">webhook</span>
                      <p className="text-[13px] font-semibold text-slate-700 dark:text-white/80">{s.notifyWebhook}</p>
                    </div>
                    <button onClick={handleNotifyTest} disabled={notifyTesting}
                      className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-[10px] font-bold text-slate-500 dark:text-white/50 disabled:opacity-40 transition-colors">
                      <span className={`material-symbols-outlined text-[12px] ${notifyTesting ? 'animate-spin' : ''}`}>{notifyTesting ? 'progress_activity' : 'send'}</span>
                      {s.notifyTest}
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className={labelCls}>{s.notifyWebhookUrl}</label>
                      <input type="text" value={notifyCfg.notify_webhook_url || ''} onChange={e => setNf('notify_webhook_url', e.target.value)}
                        className={inputCls} placeholder="https://hooks.example.com/..." />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>{s.notifyWebhookMethod}</label>
                        <CustomSelect value={notifyCfg.notify_webhook_method || 'POST'} onChange={v => setNf('notify_webhook_method', v)}
                          options={[{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }, { value: 'PUT', label: 'PUT' }]}
                          className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>{s.notifyWebhookHeaders}</label>
                        <input type="text" value={notifyCfg.notify_webhook_headers || ''} onChange={e => setNf('notify_webhook_headers', e.target.value)}
                          className={inputCls} placeholder="Authorization:Bearer xxx" />
                        <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifyWebhookHeadersHint}</p>
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>{s.notifyWebhookTemplate}</label>
                      <textarea value={notifyCfg.notify_webhook_template || ''} onChange={e => setNf('notify_webhook_template', e.target.value)}
                        className={`${inputCls} h-20 py-2 resize-none font-mono text-[11px]`}
                        placeholder={'{"text": "{message}"'} />
                      <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{s.notifyWebhookTemplateHint}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Save button at bottom */}
              <div className="flex justify-end pt-2">
                <button onClick={handleNotifySave} disabled={notifySaving || !notifyDirty}
                  className="flex items-center gap-1.5 px-5 py-[8px] bg-primary text-white rounded-lg text-[12px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
                  <span className={`material-symbols-outlined text-[16px] ${notifySaving ? 'animate-spin' : ''}`}>{notifySaving ? 'progress_activity' : 'save'}</span>
                  {s.save}
                </button>
              </div>
            </div>
          )}

          {/* 配置备份 */}
          {activeTab === 'backup' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.backup}</h2>
                  <p className="text-[12px] text-slate-400 dark:text-white/40 mt-0.5">{s.backupDesc}</p>
                </div>
                <button onClick={handleCreateBackup} disabled={backupLoading}
                  className="flex items-center gap-1.5 px-4 py-[7px] bg-primary text-white rounded-lg text-[13px] font-medium transition-all disabled:opacity-40 hover:opacity-90 shadow-sm">
                  <span className={`material-symbols-outlined text-[16px] ${backupLoading ? 'animate-spin' : ''}`}>{backupLoading ? 'progress_activity' : 'add'}</span>
                  {s.createBackup}
                </button>
              </div>
              <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-500/10">
                <span className="material-symbols-outlined text-[16px] text-amber-500 mt-0.5 shrink-0">shield</span>
                <p className="text-[11px] text-amber-700 dark:text-amber-400/80 leading-relaxed">{s.backupSecurityNote}</p>
              </div>
              <div className={rowCls}>
                {backups.length === 0 ? (
                  <div className="flex flex-col items-center py-10 text-slate-300 dark:text-white/10">
                    <span className="material-symbols-outlined text-4xl mb-2">cloud_off</span>
                    <span className="text-[12px] text-slate-400 dark:text-white/20">{s.noBackups}</span>
                  </div>
                ) : (
                  backups.map((b: any) => (
                    <div key={b.id || b.filename} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="material-symbols-outlined text-[18px] text-emerald-500">description</span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-slate-700 dark:text-white/70 truncate">{b.filename || b.name || b.id}</p>
                          <p className="text-[10px] text-slate-400 dark:text-white/20">{b.created_at ? new Date(b.created_at).toLocaleString() : ''} {b.size ? `· ${(b.size / 1024).toFixed(1)} KB` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={() => handleRestore(b.id || b.filename)} className="p-1.5 text-primary hover:bg-primary/10 rounded-lg transition-colors" title={s.restore}>
                          <span className="material-symbols-outlined text-[16px]">settings_backup_restore</span>
                        </button>
                        <a href={backupApi.download(b.id || b.filename)} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white/60 rounded-lg transition-colors" title={s.download}>
                          <span className="material-symbols-outlined text-[16px]">download</span>
                        </a>
                        <button onClick={() => handleDeleteBackup(b.id || b.filename)} className="p-1.5 text-slate-400 hover:text-mac-red rounded-lg transition-colors" title={s.deleteBackup}>
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 审计日志 */}
          {activeTab === 'audit' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.auditLog}</h2>
                <p className="text-[12px] text-slate-400 dark:text-white/40 mt-0.5">{s.auditDesc}</p>
              </div>
              <div className={rowCls}>
                {auditLogs.length === 0 ? (
                  <div className="flex flex-col items-center py-10 text-slate-300 dark:text-white/10">
                    <span className="material-symbols-outlined text-4xl mb-2">checklist</span>
                    <span className="text-[12px] text-slate-400 dark:text-white/20">{s.noAudit}</span>
                  </div>
                ) : (
                  <>
                    {auditLogs.map((log: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between px-4 py-2.5 gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${log.result === 'success' ? 'bg-mac-green' : 'bg-mac-red'}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-medium text-slate-700 dark:text-white/70">{log.action || '--'}</span>
                              <span className="text-[10px] text-slate-400 dark:text-white/20 font-mono">{log.username || '--'}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-slate-400 dark:text-white/20">{log.created_at ? new Date(log.created_at).toLocaleString() : '--'}</span>
                              <span className="text-[10px] text-slate-300 dark:text-white/10 font-mono">{log.ip || ''}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${log.result === 'success' ? 'bg-mac-green/10 text-mac-green' : 'bg-mac-red/10 text-mac-red'}`}>
                          {log.result === 'success' ? s.success : s.failed}
                        </span>
                      </div>
                    ))}
                    {auditLogs.length < auditTotal && (
                      <div className="px-4 py-3">
                        <button onClick={() => fetchAuditLogs(auditPage + 1)} disabled={auditLoading}
                          className="w-full py-2 text-[12px] text-primary font-medium hover:bg-primary/5 rounded-lg transition-colors disabled:opacity-40">
                          {auditLoading ? <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span> : s.loadMore}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* 打赏支持 */}
          {activeTab === 'donate' && (
            <div className="space-y-6">
              {/* 顶部爱心图标 */}
              <div className="flex flex-col items-center pt-4 pb-2">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/20 animate-pulse">
                  <span className="material-symbols-outlined text-[32px] text-white">favorite</span>
                </div>
              </div>

              {/* 诗意文案 */}
              <div className="text-center px-6 space-y-1">
                <p className="text-[14px] text-slate-600 dark:text-white/60 leading-relaxed">{s.donateLine1}</p>
                <p className="text-[14px] text-slate-600 dark:text-white/60 leading-relaxed">{s.donateLine2}</p>
                <p className="text-[14px] text-slate-600 dark:text-white/60 leading-relaxed">{s.donateLine3}</p>
                <p className="text-[14px] font-medium text-pink-500 dark:text-pink-400 leading-relaxed">{s.donateLine4}</p>
              </div>

              {/* 国际支付方式 - Ko-fi */}
              <div className={rowCls}>
                <div className="px-4 py-4">
                  <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-gradient-to-b from-[#FF5E5B]/5 to-[#FF5E5B]/10 dark:from-[#FF5E5B]/10 dark:to-[#FF5E5B]/20 border border-[#FF5E5B]/20 hover:border-[#FF5E5B]/40 transition-colors">
                    <a href="https://ko-fi.com/T6T71UDKMB" target="_blank" rel="noopener noreferrer">
                      <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Ko-fi" className="h-9 hover:opacity-80 transition-opacity" />
                    </a>
                  </div>
                </div>
              </div>

              {/* 国内支付方式 */}
              <div className={rowCls}>
                <div className="px-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    {/* 微信支付 */}
                    <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-gradient-to-b from-[#07C160]/5 to-[#07C160]/10 dark:from-[#07C160]/10 dark:to-[#07C160]/20 border border-[#07C160]/20 hover:border-[#07C160]/40 transition-colors">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-[#07C160] flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-7.062-6.122zm-2.18 2.768c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.36 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982z"/></svg>
                        </div>
                        <span className="text-[12px] font-bold text-[#07C160]">{s.donateWechat}</span>
                      </div>
                      <div className="w-32 h-32 bg-white rounded-xl flex items-center justify-center border-2 border-[#07C160]/30 shadow-sm overflow-hidden">
                        <img src="/wechat.png" alt="WeChat Pay QR Code" className="w-full h-full object-cover" />
                      </div>
                    </div>
                    {/* 支付宝 */}
                    <div className="flex flex-col items-center gap-3 p-4 rounded-xl bg-gradient-to-b from-[#1677FF]/5 to-[#1677FF]/10 dark:from-[#1677FF]/10 dark:to-[#1677FF]/20 border border-[#1677FF]/20 hover:border-[#1677FF]/40 transition-colors">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-[#1677FF] flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" viewBox="0 0 1024 1024" fill="currentColor"><path d="M896 650.667l-247.04-83.072s18.987-28.416 39.253-84.139c20.267-55.722 23.168-86.314 23.168-86.314l-159.915-1.28V341.163l193.707-1.365V301.227h-193.707V213.333H456.533v87.894H275.883v38.613l180.693-1.28v58.581H311.637v30.592h298.326s-3.286 24.832-14.72 55.723a1254.485 1254.485 0 0 1-23.211 57.941s-140.075-49.024-213.888-49.024-163.584 29.653-172.288 115.712c-8.661 86.016 41.813 132.608 112.939 149.76 71.125 17.237 136.789-.171 193.962-28.16 57.174-27.947 113.28-91.477 113.28-91.477l287.915 139.818A142.08 142.08 0 0 1 753.792 896H270.208A142.08 142.08 0 0 1 128 754.048V270.208A142.08 142.08 0 0 1 269.952 128h483.84A142.08 142.08 0 0 1 896 269.952v380.715zM535.936 602.539s-89.856 113.493-195.755 113.493c-105.941 0-128.17-53.93-128.17-92.714 0-38.742 22.016-80.854 112.17-86.955 90.07-6.101 211.84 66.176 211.84 66.176h-.085z"/></svg>
                        </div>
                        <span className="text-[12px] font-bold text-[#1677FF]">{s.donateAlipay}</span>
                      </div>
                      <div className="w-32 h-32 bg-white rounded-xl flex items-center justify-center border-2 border-[#1677FF]/30 shadow-sm overflow-hidden">
                        <img src="/alipay.png" alt="Alipay QR Code" className="w-full h-full object-cover" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 其他支持方式 */}
              <div className={rowCls}>
                <div className="px-4 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/40">volunteer_activism</span>
                    <h3 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.donateOtherWays}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <a href="https://github.com/ClawDeckX/ClawDeckX" target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                      <span className="material-symbols-outlined text-[16px] text-amber-500">star</span>
                      <span className="text-[11px] text-slate-600 dark:text-white/60">{s.donateStarGithub}</span>
                    </a>
                    <a href="https://github.com/ClawDeckX/ClawDeckX/issues" target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                      <span className="material-symbols-outlined text-[16px] text-blue-500">bug_report</span>
                      <span className="text-[11px] text-slate-600 dark:text-white/60">{s.donateFeedback}</span>
                    </a>
                    <a href="https://github.com/ClawDeckX/ClawDeckX" target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors">
                      <span className="material-symbols-outlined text-[16px] text-emerald-500">edit_document</span>
                      <span className="text-[11px] text-slate-600 dark:text-white/60">{s.donateDocs}</span>
                    </a>
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                      <span className="material-symbols-outlined text-[16px] text-pink-500">share</span>
                      <span className="text-[11px] text-slate-600 dark:text-white/60">{s.donateShare}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 底部感谢语 */}
              <div className="text-center px-4 pb-2">
                <p className="text-[11px] text-slate-400 dark:text-white/35 italic">{s.donateThankYou} 🙏</p>
              </div>
            </div>
          )}

          {/* 关于 */}
          {activeTab === 'about' && (
            <div className="space-y-6">
              {/* 顶部标识 */}
              <div className="flex flex-col items-center pt-4 pb-2">
                <div className="w-20 h-20 rounded-[22px] bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-white shadow-xl shadow-primary/20 mb-4">
                  <span className="text-[40px]" role="img">&#x1F980;</span>
                </div>
                <h3 className="text-[20px] font-bold text-slate-800 dark:text-white tracking-wide">ClawDeckX</h3>
                <p className="text-[12px] text-slate-400 dark:text-white/40 mt-1 font-mono">
                  v{__APP_VERSION__} · build {__BUILD_NUMBER__}
                </p>
              </div>

              {/* Slogan */}
              <div className="text-center px-4">
                <p className="text-[16px] font-light text-slate-600 dark:text-white/50 tracking-widest">{s.aboutSlogan}</p>
                {s.aboutSlogan !== 'Complexity within, simplicity without.' && (
                  <p className="text-[11px] text-slate-400 dark:text-white/20 mt-1 italic">Complexity within, simplicity without.</p>
                )}
              </div>

              {/* 简介 */}
              <div className={rowCls}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-[16px] text-primary/60">info</span>
                    <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.about}</h4>
                  </div>
                  <p className="text-[12px] text-slate-600 dark:text-white/50 leading-relaxed whitespace-pre-line">{s.aboutIntro}</p>
                </div>
              </div>

              {/* 开发者说明 */}
              <div className={rowCls}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-[16px] text-amber-500">emoji_objects</span>
                    <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">Note</h4>
                  </div>
                  <p className="text-[12px] text-slate-500 dark:text-white/45 leading-relaxed">{s.aboutNote}</p>
                </div>
              </div>

              {/* Version Info — unified with inline update actions */}
              <div className={rowCls}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-[16px] text-primary/60">verified</span>
                    <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.aboutVersion}</h4>
                  </div>
                  <div className="space-y-2 text-[11px]">

                    {/* ── 🦀 ClawDeckX row ── */}
                    <div className="px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 dark:text-white/40">🦀 ClawDeckX</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-700 dark:text-white/70">v{__APP_VERSION__} <span className="font-normal text-slate-400 dark:text-white/30">(build {__BUILD_NUMBER__})</span></span>
                          <button onClick={handleSelfUpdateCheck} disabled={selfUpdateChecking || selfUpdating}
                            className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 disabled:opacity-30 transition-colors">
                            {selfUpdateChecking ? <span className="material-symbols-outlined text-[12px] animate-spin align-middle">progress_activity</span> : s.selfUpdateCheck}
                          </button>
                        </div>
                      </div>
                      {/* Self-update: up to date */}
                      {selfUpdateInfo && !selfUpdateInfo.available && !selfUpdateInfo.error && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="material-symbols-outlined text-[12px] text-mac-green">check_circle</span>
                          <span className="text-[10px] text-mac-green font-medium">{s.selfUpdateCurrent}</span>
                        </div>
                      )}
                      {/* Self-update: error */}
                      {selfUpdateInfo?.error && !selfUpdateInfo.available && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="material-symbols-outlined text-[12px] text-red-500">error</span>
                          <span className="text-[10px] text-red-500">{selfUpdateInfo.error}</span>
                        </div>
                      )}
                      {/* Self-update: new version available */}
                      {selfUpdateInfo?.available && (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-primary/5 dark:bg-primary/10 border border-primary/20">
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[13px] text-primary">new_releases</span>
                              <span className="text-[10px] font-bold text-primary">{s.selfUpdateAvailable}</span>
                            </div>
                            <span className="text-[10px] font-mono font-bold text-primary">v{selfUpdateInfo.currentVersion} → v{selfUpdateInfo.latestVersion}</span>
                          </div>
                          {selfUpdateInfo.assetSize > 0 && (
                            <p className="text-[9px] text-slate-400 dark:text-white/30 px-1">{s.selfUpdateSize}: {(selfUpdateInfo.assetSize / 1024 / 1024).toFixed(1)} MB</p>
                          )}
                          {selfUpdateInfo.releaseNotes && (
                            <details className="group">
                              <summary className="text-[10px] font-bold text-slate-400 dark:text-white/30 cursor-pointer hover:text-primary transition-colors px-1">{s.selfUpdateReleaseNotes}</summary>
                              <div className="mt-1 px-2 py-1.5 rounded-md bg-slate-50 dark:bg-white/[0.03] text-[10px] text-slate-500 dark:text-white/40 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">{selfUpdateInfo.releaseNotes}</div>
                            </details>
                          )}
                          {!selfUpdating && !selfUpdateProgress?.done && (
                            <div className="flex gap-2">
                              <button onClick={handleSelfUpdateApply} disabled={!selfUpdateInfo.downloadUrl}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary text-white text-[11px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
                                <span className="material-symbols-outlined text-[14px]">download</span>
                                {selfUpdateInfo.downloadUrl ? s.selfUpdateDownload : s.selfUpdateNoAsset}
                              </button>
                              <a href="https://github.com/ClawDeckX/ClawDeckX/releases" target="_blank" rel="noopener noreferrer"
                                className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-[11px] font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                                <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                                {s.viewReleases || '查看更新'}
                              </a>
                            </div>
                          )}
                          {selfUpdateProgress && !selfUpdateProgress.done && !selfUpdateProgress.error && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[9px] text-slate-400 dark:text-white/30">
                                <span>{selfUpdateProgress.stage === 'downloading' ? s.selfUpdateDownloading : selfUpdateProgress.stage === 'replacing' ? s.selfUpdateApplying : selfUpdateProgress.stage}</span>
                                <span>{Math.round(selfUpdateProgress.percent)}%</span>
                              </div>
                              <div className="w-full h-1 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${selfUpdateProgress.percent}%` }} />
                              </div>
                            </div>
                          )}
                          {selfUpdateProgress?.done && (
                            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-mac-green/10">
                              <span className="material-symbols-outlined text-[12px] text-mac-green animate-spin">progress_activity</span>
                              <span className="text-[10px] font-bold text-mac-green">{s.selfUpdateDone}</span>
                            </div>
                          )}
                          {selfUpdateProgress?.error && (
                            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-red-50 dark:bg-red-500/5">
                              <span className="material-symbols-outlined text-[12px] text-red-500">error</span>
                              <span className="text-[10px] text-red-500">{s.selfUpdateFailed}: {selfUpdateProgress.error}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── 🦞 OpenClaw compat row ── */}
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                      <span className="text-slate-400 dark:text-white/40">🦞 OpenClaw {s.aboutCompat}</span>
                      <span className="font-mono font-bold text-slate-700 dark:text-white/70">{__OPENCLAW_COMPAT__}</span>
                    </div>

                    {/* ── 🦞 OpenClaw current version row ── */}
                    <div className="px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 dark:text-white/40">🦞 OpenClaw {s.aboutCurrentVer}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-700 dark:text-white/70">
                            {ocUpdateInfo?.currentVersion ? `v${ocUpdateInfo.currentVersion}` : '—'}
                          </span>
                          <button onClick={handleOcUpdateCheck} disabled={ocUpdateChecking || ocUpdating}
                            className="ml-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 disabled:opacity-30 transition-colors">
                            {ocUpdateChecking ? <span className="material-symbols-outlined text-[12px] animate-spin align-middle">progress_activity</span> : s.openclawUpdateCheck}
                          </button>
                        </div>
                      </div>
                      {/* OC: not installed */}
                      {ocUpdateInfo && !ocUpdateInfo.currentVersion && !ocUpdateInfo.error && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="material-symbols-outlined text-[12px] text-amber-500">warning</span>
                          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">{s.openclawNotInstalled}</span>
                        </div>
                      )}
                      {/* OC: up to date */}
                      {ocUpdateInfo && !ocUpdateInfo.available && !ocUpdateInfo.error && ocUpdateInfo.currentVersion && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="material-symbols-outlined text-[12px] text-mac-green">check_circle</span>
                          <span className="text-[10px] text-mac-green font-medium">{s.openclawUpdateCurrent}</span>
                        </div>
                      )}
                      {/* OC: error */}
                      {ocUpdateInfo?.error && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <span className="material-symbols-outlined text-[12px] text-red-500">error</span>
                          <span className="text-[10px] text-red-500">{ocUpdateInfo.error}</span>
                        </div>
                      )}
                      {/* OC: new version available */}
                      {ocUpdateInfo?.available && (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center justify-between px-2.5 py-2 rounded-lg bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20">
                            <div className="flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[13px] text-emerald-500">new_releases</span>
                              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{s.openclawUpdateAvailable}</span>
                            </div>
                            <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">v{ocUpdateInfo.currentVersion} → v{ocUpdateInfo.latestVersion}</span>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={handleOcUpdateRun} disabled={ocUpdating}
                              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500 text-white text-[11px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
                              <span className={`material-symbols-outlined text-[14px] ${ocUpdating ? 'animate-spin' : ''}`}>{ocUpdating ? 'progress_activity' : 'download'}</span>
                              {ocUpdating ? s.openclawUpdateRunning : s.openclawUpdateRun}
                            </button>
                            <a href="https://github.com/openclaw/openclaw/releases" target="_blank" rel="noopener noreferrer"
                              className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-[11px] font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                              <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                              {s.viewReleases || '查看更新'}
                            </a>
                          </div>
                        </div>
                      )}
                      {/* 升级日志面板 */}
                      {(ocUpdating || ocUpdateLogs.length > 0) && (
                        <div className="mt-2 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
                          {ocUpdating && (
                            <div className="h-1 bg-slate-200 dark:bg-white/10">
                              <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${ocUpdateProgress}%` }} />
                            </div>
                          )}
                          {ocUpdateStep && (
                            <div className="px-2.5 py-1.5 border-b border-slate-200 dark:border-white/10 flex items-center gap-1.5">
                              {ocUpdating && <span className="material-symbols-outlined text-[12px] text-emerald-500 animate-spin">progress_activity</span>}
                              {!ocUpdating && ocUpdateProgress >= 100 && <span className="material-symbols-outlined text-[12px] text-emerald-500">check_circle</span>}
                              <span className="text-[10px] text-slate-600 dark:text-white/60 flex-1 truncate">{ocUpdateStep}</span>
                              {ocUpdating && <span className="text-[9px] text-slate-400 dark:text-white/40">{ocUpdateProgress}%</span>}
                            </div>
                          )}
                          <div ref={ocUpdateLogRef} className="max-h-24 overflow-y-auto px-2.5 py-2 font-mono text-[10px] text-slate-500 dark:text-white/50 space-y-0.5">
                            {ocUpdateLogs.length === 0 && ocUpdating && (
                              <div className="text-slate-400 dark:text-white/35">...</div>
                            )}
                            {ocUpdateLogs.map((line, i) => (
                              <div key={i} className="break-all leading-relaxed">{line}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              </div>

              {/* 技术栈 */}
              <div className={rowCls}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-[16px] text-amber-500/60">memory</span>
                    <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.aboutTech}</h4>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['Go', 'React', 'TailwindCSS', 'SQLite', 'WebSocket', 'SSE'].map(tech => (
                      <span key={tech} className="px-3 py-1 rounded-full bg-slate-100 dark:bg-white/5 text-[11px] font-mono font-medium text-slate-500 dark:text-white/40 border border-slate-200 dark:border-white/10">{tech}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* 相关链接 */}
              <div className={rowCls}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-[16px] text-blue-500/60">link</span>
                    <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.aboutLinks}</h4>
                  </div>
                  <div className="space-y-2">
                    <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors group">
                      <span className="text-[20px]">🦞</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-slate-700 dark:text-white/70 group-hover:text-primary">OpenClaw</p>
                        <p className="text-[10px] text-slate-400 dark:text-white/20 truncate">github.com/openclaw/openclaw</p>
                      </div>
                      <span className="material-symbols-outlined text-[14px] text-slate-300 dark:text-white/15 group-hover:text-primary">open_in_new</span>
                    </a>
                    <a href="https://github.com/ClawDeckX/ClawDeckX" target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors group">
                      <span className="text-[20px]">🦀</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-slate-700 dark:text-white/70 group-hover:text-primary">ClawDeckX</p>
                        <p className="text-[10px] text-slate-400 dark:text-white/20 truncate">github.com/ClawDeckX/ClawDeckX</p>
                      </div>
                      <span className="material-symbols-outlined text-[14px] text-slate-300 dark:text-white/15 group-hover:text-primary">open_in_new</span>
                    </a>
                  </div>
                </div>
              </div>

              <p className="text-center text-[10px] text-slate-300 dark:text-white/10 pb-2">
                &copy; {new Date().getFullYear()} ClawDeckX &middot; Made with &#x2764;&#xFE0F;
              </p>
            </div>
          )}

        </div>
      </main>
    </div>
  );
};

export default Settings;
