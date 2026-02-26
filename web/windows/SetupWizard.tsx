import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { get, post } from '../services/request';
import { useConfirm } from '../components/ConfirmDialog';
import { getNPMRegistryURL, isLikelyInChina, NPM_REGISTRY_MIRRORS } from '../services/network';

interface SetupWizardProps {
  language: Language;
  onClose?: () => void;
  onOpenEditor?: () => void;
  onOpenUsageWizard?: () => void;
}

const SETUP_WIZARD_AUTO_OPEN_DISABLED_KEY = 'setup_wizard_disable_auto_open';

type WizardPhase = 'scan' | 'install' | 'starting' | 'complete';

interface ToolInfo {
  installed: boolean;
  version?: string;
  path?: string;
}

interface Step {
  name: string;
  description: string;
  command?: string;
  required: boolean;
}

interface EnvironmentReport {
  os: string;
  arch: string;
  distro?: string;
  hostname: string;
  packageManager: string;
  hasSudo: boolean;
  tools: Record<string, ToolInfo>;
  internetAccess: boolean;
  openClawInstalled: boolean;
  openClawConfigured: boolean;
  openClawVersion?: string;
  openClawCnInstalled: boolean;
  openClawCnVersion?: string;
  gatewayRunning: boolean;
  gatewayPort?: number;
  recommendedMethod: string;
  recommendedSteps: Step[];
  warnings: string[];
  isRoot?: boolean;
  currentUser?: string;
  latestOpenClawVersion?: string;
  updateAvailable?: boolean;
}

interface SetupEvent {
  type: 'phase' | 'step' | 'progress' | 'log' | 'success' | 'error' | 'complete';
  phase?: string;
  step?: string;
  message: string;
  progress?: number;
  data?: any;
}

const SetupWizard: React.FC<SetupWizardProps> = ({ language, onClose, onOpenEditor, onOpenUsageWizard }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const sw = (t as any).sw || {};
  const common = (t as any).common || {};

  const [phase, setPhase] = useState<WizardPhase>('scan');
  const [scanResult, setScanResult] = useState<EnvironmentReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState('');
  const [needsRestart, setNeedsRestart] = useState(false);
  const [installSummary, setInstallSummary] = useState<Array<{label: string; status: string; detail?: string; category?: string}>>([]);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);
  const [updateStep, setUpdateStep] = useState('');
  const [updateProgress, setUpdateProgress] = useState(0);
  const updateLogRef = useRef<HTMLDivElement>(null);
  const [gwStartElapsed, setGwStartElapsed] = useState(0);
  const [gwStartFailed, setGwStartFailed] = useState(false);
  const [gwStartError, setGwStartError] = useState<string | null>(null);
  const [gwRetryCount, setGwRetryCount] = useState(0);
  const [wasInstalledOnOpen, setWasInstalledOnOpen] = useState<boolean | null>(null);
  const { confirm } = useConfirm();

  // 安装选项
  const [selectedRegistry, setSelectedRegistry] = useState(''); // '' | 'https://registry.npmmirror.com'
  const [autoDetectedRegistry, setAutoDetectedRegistry] = useState<string | null>(null);
  const [isDetectingRegistry, setIsDetectingRegistry] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [installZeroTier, setInstallZeroTier] = useState(false);
  const [zerotierNetworkId, setZerotierNetworkId] = useState('');
  const [installTailscale, setInstallTailscale] = useState(false);
  const [sudoPassword, setSudoPassword] = useState('');
  const [disableAutoOpen, setDisableAutoOpen] = useState<boolean>(() => localStorage.getItem(SETUP_WIZARD_AUTO_OPEN_DISABLED_KEY) === '1');

  useEffect(() => {
    localStorage.setItem(SETUP_WIZARD_AUTO_OPEN_DISABLED_KEY, disableAutoOpen ? '1' : '0');
  }, [disableAutoOpen]);

  // 扫描环境
  const scanEnvironment = useCallback(async () => {
    setIsScanning(true);
    setError(null);
    try {
      const response = await get<any>('/api/v1/setup/scan');
      const data: EnvironmentReport = response.data || response; // 兼容两种格式
      setScanResult(data);

      // 记录首次扫描时 OpenClaw 是否已安装
      if (wasInstalledOnOpen === null) {
        setWasInstalledOnOpen(data.openClawInstalled);
      }

      // 保持在 scan 阶段，显示扫描结果（无论是否已安装）
    } catch (err: any) {
      setError(err.message || sw.scanFailed);
    } finally {
      setIsScanning(false);
    }
  }, []);

  // 升级日志自动滚动
  useEffect(() => {
    if (updateLogRef.current) {
      updateLogRef.current.scrollTop = updateLogRef.current.scrollHeight;
    }
  }, [updateLogs]);

  // 初始扫描
  useEffect(() => {
    scanEnvironment();
  }, [scanEnvironment]);

  // 自动检测最快的 npm registry
  useEffect(() => {
    if (isLikelyInChina()) {
      setIsDetectingRegistry(true);
      getNPMRegistryURL()
        .then(url => {
          setAutoDetectedRegistry(url);
          // 如果用户没有手动选择，自动使用检测到的最快源
          if (selectedRegistry === '') {
            setSelectedRegistry(url);
          }
        })
        .catch(() => {
          // 检测失败，保持默认
        })
        .finally(() => {
          setIsDetectingRegistry(false);
        });
    }
  }, []);

  // 一键安装
  const startAutoInstall = useCallback(async () => {
    setPhase('install');

    const installConfig = {
      version: 'openclaw',
      registry: selectedRegistry,
      installZeroTier,
      zerotierNetworkId: installZeroTier && zerotierNetworkId ? zerotierNetworkId : undefined,
      installTailscale,
      skipConfig: true,
      skipGateway: false,
      sudoPassword: sudoPassword || undefined,
    };

    setIsInstalling(true);
    setError(null);
    setLogs([]);
    setProgress(0);

    try {
      // Stream is not supported by request.post yet, using fetch manually
      const response = await fetch('/api/v1/setup/auto-install', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(installConfig),
        credentials: 'include', // Important for cookies
      });

      if (!response.ok) {
        throw new Error(sw.installFailed);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error(sw.streamFailed);
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: SetupEvent = JSON.parse(line.slice(6));

              if (event.type === 'log') {
                setLogs(prev => [...prev.slice(-100), event.message]);
              } else if (event.type === 'phase') {
                setCurrentStep(event.message);
                setProgress(event.progress || 0);
              } else if (event.type === 'step') {
                setCurrentStep(event.message);
                setProgress(event.progress || 0);
              } else if (event.type === 'progress') {
                setProgress(event.progress || 0);
              } else if (event.type === 'error') {
                setError(event.message);
                setIsInstalling(false);
                return;
              } else if (event.type === 'complete') {
                setProgress(100);
                if (event.data?.summary) {
                  setInstallSummary(event.data.summary);
                }
                // 检查是否需要重启
                if (event.data && event.data.needsRestart) {
                  setNeedsRestart(true);
                  setPhase('complete');
                } else if (event.data && !event.data.configValid) {
                  // 配置文件不存在或异常，直接进入完成页（无需等待网关）
                  setPhase('complete');
                } else if (event.data && !event.data.gatewayRunning) {
                  // 配置正常但网关尚未就绪，进入启动等待阶段
                  setPhase('starting');
                } else {
                  setPhase('complete');
                }
                // 重新扫描环境以获取安装后的版本号等信息
                setLogs(prev => [...prev, `\n🔍 ${sw.runningDiagnostics}`]);
                scanEnvironment();
              }
            } catch { }
          }
        }
      }
    } catch (err: any) {
      setError(err.message || sw.installFailed);
    } finally {
      setIsInstalling(false);
    }
  }, [selectedRegistry, installZeroTier, zerotierNetworkId, installTailscale]);



  // 网关启动轮询
  useEffect(() => {
    if (phase !== 'starting') return;
    setGwStartElapsed(0);
    setGwStartFailed(false);
    setGwStartError(null);

    let cancelled = false;

    // 重试时主动调用启动 API
    if (gwRetryCount > 0) {
      post('/api/v1/gateway/start').catch(() => { });
    }

    let elapsed = 0;
    const interval = setInterval(async () => {
      if (cancelled) return;
      elapsed += 2;
      setGwStartElapsed(elapsed);

      if (elapsed > 60) {
        clearInterval(interval);
        setGwStartFailed(true);
        setGwStartError(sw.gwStartTimeout);
        return;
      }

      try {
        const res = await get<{ running: boolean }>('/api/v1/gateway/status');
        const data = (res as any).data || res;
        if (data.running) {
          clearInterval(interval);
          // 添加明显的诊断提示
          setLogs(prev => [...prev, `\n⏳ ${sw.runningFullDiagnostics}`]);
          scanEnvironment();
          setPhase('complete');
        }
      } catch {
        // 忽略请求错误，继续轮询
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, gwRetryCount]);

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar bg-slate-50 dark:bg-transparent transition-colors">
      <div className="max-w-2xl mx-auto">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            🚀 {sw.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-white/60">
            {sw.subtitle}
          </p>
          <label className="mt-3 inline-flex items-center gap-2 text-xs text-slate-500 dark:text-white/60 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={disableAutoOpen}
              onChange={(e) => setDisableAutoOpen(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/30"
            />
            <span>{sw.disableAutoOpen}</span>
          </label>
          <p className="mt-1 text-[11px] text-slate-400 dark:text-white/40">
            {sw.disableAutoOpenHint}
          </p>
        </div>

        {/* 进度指示器 */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <div className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${phase === 'scan' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-slate-100 dark:bg-white/5 text-slate-500'}`}>
            1 {sw.stepScan}
          </div>
          <div className="w-8 h-[2px] bg-slate-100 dark:bg-white/10"></div>
          <div className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${phase === 'install' || phase === 'starting' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-slate-100 dark:bg-white/5 text-slate-500'}`}>
            2 {sw.stepInstall}
          </div>
          <div className="w-8 h-[2px] bg-slate-100 dark:bg-white/10"></div>
          <div className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${phase === 'complete' ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' : 'bg-slate-100 dark:bg-white/5 text-slate-500'}`}>
            3 {sw.stepDone}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* 配置提醒 */}
        {phase === 'complete' && !needsRestart && (
          <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl p-4 mb-6">
            <p className="text-sm text-green-700 dark:text-green-400">
              {sw.installSuccessMsg}
            </p>
            <p className="text-xs text-green-600/80 dark:text-green-400/80 mt-2">
              {sw.installSuccessNote}
            </p>
          </div>
        )}

        {/* 重启提醒 */}
        {phase === 'complete' && needsRestart && (
          <div className="bg-yellow-50 dark:bg-yellow-500/10 border-2 border-yellow-500 dark:border-yellow-500/50 rounded-xl p-5 mb-6 animate-pulse">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-2xl text-yellow-600 dark:text-yellow-400 mt-0.5">warning</span>
              <div className="flex-1">
                <h4 className="text-base font-bold text-yellow-800 dark:text-yellow-300 mb-2">
                  {'⚠️ ' + sw.restartRequired}
                </h4>
                <p className="text-sm text-yellow-700 dark:text-yellow-400 mb-3">
                  {sw.restartDesc}
                </p>
                <div className="bg-yellow-100 dark:bg-yellow-900/30 rounded-lg p-3 mb-3">
                  <p className="text-xs text-yellow-800 dark:text-yellow-300 font-medium mb-2">
                    {sw.restartStepsTitle}
                  </p>
                  <ol className="text-xs text-yellow-700 dark:text-yellow-400 space-y-1 list-decimal list-inside">
                    {(sw.restartSteps || []).map((step: string, idx: number) => <li key={idx}>{step}</li>)}
                  </ol>
                </div>
                <p className="text-xs text-yellow-600 dark:text-yellow-400/80">
                  {sw.restartReason}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 扫描阶段 */}
        {phase === 'scan' && (
          <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm">
            {isScanning ? (
              <div className="text-center py-12">
                <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-slate-500 dark:text-white/60">{sw.scanning}</p>
              </div>
            ) : scanResult ? (
              <div className="space-y-6">
                {/* 系统信息 */}
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white/80 mb-3 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">computer</span>
                    {sw.sysInfo}
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-lg">
                      <p className="text-[10px] text-slate-400 uppercase">OS</p>
                      <p className="text-sm font-medium text-slate-700 dark:text-white/80">{scanResult.os} / {scanResult.arch}</p>
                    </div>
                    <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-lg">
                      <p className="text-[10px] text-slate-400 uppercase">{sw.pkgMgr}</p>
                      <p className="text-sm font-medium text-slate-700 dark:text-white/80">{scanResult.packageManager || common.na}</p>
                    </div>
                  </div>
                </div>

                {/* 工具状态 */}
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white/80 mb-3 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">build</span>
                    {sw.deps}
                  </h3>
                  <div className="space-y-2">
                    {['node', 'npm', 'git', 'openclaw', 'clawhub'].map(tool => {
                      const info = scanResult.tools ? scanResult.tools[tool] : undefined;
                      return (
                        <div key={tool} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-lg">
                          <span className="text-sm font-medium text-slate-700 dark:text-white/80 capitalize">{tool}</span>
                          <div className="flex items-center gap-2">
                            {info?.installed ? (
                              <>
                                <span className="text-xs text-slate-400">{info.version}</span>
                                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                              </>
                            ) : (
                              <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 技能运行时依赖 */}
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white/80 mb-3 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">extension</span>
                    {sw.skillDeps}
                    <span className="text-[10px] text-slate-400 dark:text-white/40 font-normal">{sw.skillDepsDesc}</span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {([
                      ['go', 'Go'],
                      ['uv', 'uv (Python)'],
                      ['ffmpeg', 'FFmpeg'],
                      ['jq', 'jq'],
                      ['rg', 'ripgrep'],
                    ] as [string, string][]).map(([key, label]) => {
                      const info = scanResult.tools ? scanResult.tools[key] : undefined;
                      return (
                        <div key={key} className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-white/5 rounded-lg">
                          <span className="text-xs font-medium text-slate-700 dark:text-white/80">{label}</span>
                          <div className="flex items-center gap-1.5">
                            {info?.installed ? (
                              <>
                                <span className="text-[10px] text-slate-400">{info.version}</span>
                                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                              </>
                            ) : (
                              <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* root 用户警告 */}
                {scanResult.isRoot && (
                  <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-red-500 text-lg">shield_person</span>
                      <h4 className="text-sm font-bold text-red-700 dark:text-red-400">{sw.rootWarningTitle}</h4>
                    </div>
                    <p className="text-xs text-red-600 dark:text-red-400/80">{sw.rootWarningDesc}</p>
                    <div className="space-y-2">
                      <p className="text-xs text-red-600 dark:text-red-400/70 font-medium">{sw.rootSwitchUser}</p>
                      <code className="block px-3 py-2 bg-red-100 dark:bg-red-500/15 rounded-lg text-[11px] font-mono text-red-800 dark:text-red-300 select-all">su - username</code>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-red-600 dark:text-red-400/70 font-medium">{sw.rootCreateUser}</p>
                      <code className="block px-3 py-2 bg-red-100 dark:bg-red-500/15 rounded-lg text-[11px] font-mono text-red-800 dark:text-red-300 select-all">adduser --gecos "" openclaw</code>
                      <code className="block px-3 py-2 bg-red-100 dark:bg-red-500/15 rounded-lg text-[11px] font-mono text-red-800 dark:text-red-300 select-all">usermod -aG sudo openclaw</code>
                      <code className="block px-3 py-2 bg-red-100 dark:bg-red-500/15 rounded-lg text-[11px] font-mono text-red-800 dark:text-red-300 select-all">echo 'openclaw ALL=(ALL) NOPASSWD:ALL' &gt; /etc/sudoers.d/openclaw</code>
                      <code className="block px-3 py-2 bg-red-100 dark:bg-red-500/15 rounded-lg text-[11px] font-mono text-red-800 dark:text-red-300 select-all">su - openclaw</code>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-red-600 dark:text-red-400/70 font-medium">{sw.rootThenReopen}</p>
                      <code className="block px-3 py-2 bg-red-100 dark:bg-red-500/15 rounded-lg text-[11px] font-mono text-red-800 dark:text-red-300 select-all">
                        {scanResult.os === 'windows' ? 'ClawDeckX.exe' : './ClawDeckX'}
                      </code>
                    </div>
                  </div>
                )}

                {/* 其他警告 */}
                {scanResult.warnings?.filter(w => !w.includes('root')).length > 0 && (
                  <div className="p-4 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30 rounded-xl">
                    <h4 className="text-sm font-bold text-yellow-700 dark:text-yellow-400 mb-2">{sw.warnings}</h4>
                    <ul className="text-xs text-yellow-600 dark:text-yellow-400/80 space-y-1">
                      {scanResult.warnings.filter(w => !w.includes('root')).map((w, i) => <li key={i}>• {w}</li>)}
                    </ul>
                  </div>
                )}

                {/* 安装选项 */}
                {!scanResult.openClawInstalled && (
                  <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-white/10">
                    <h4 className="text-sm font-bold text-slate-800 dark:text-white/80">
                      {sw.installOpts}
                    </h4>

                    {/* 高级设置（可折叠） */}
                    <div className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
                      <button
                        onClick={() => setAdvancedOpen(!advancedOpen)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-base text-slate-400">settings</span>
                          <span className="text-sm font-medium text-slate-700 dark:text-white/80">{sw.advancedSettings}</span>
                          <span className="text-[10px] text-slate-400 dark:text-white/40">{sw.advancedDesc}</span>
                        </div>
                        <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}>expand_more</span>
                      </button>
                      {advancedOpen && (
                        <div className="px-4 pb-4 space-y-4 border-t border-slate-200 dark:border-white/10 pt-3">
                          {/* npm 镜像源 */}
                          <div>
                            <label className="text-xs text-slate-500 dark:text-white/50 mb-2 block">{sw.npmRegistry}</label>
                            <div className="grid grid-cols-2 gap-2">
                              <button onClick={() => setSelectedRegistry('')}
                                className={`p-3 rounded-lg border-2 transition-all ${selectedRegistry === '' ? 'border-primary bg-primary/10 dark:bg-primary/20' : 'border-slate-200 dark:border-white/10 hover:border-primary/50'}`}>
                                <div className="text-sm font-medium text-slate-800 dark:text-white">{sw.officialRegistry}</div>
                                <div className="text-xs text-slate-500 dark:text-white/50 mt-1">npmjs.org</div>
                              </button>
                              <button onClick={() => setSelectedRegistry('https://registry.npmmirror.com')}
                                className={`p-3 rounded-lg border-2 transition-all ${selectedRegistry === 'https://registry.npmmirror.com' ? 'border-primary bg-primary/10 dark:bg-primary/20' : 'border-slate-200 dark:border-white/10 hover:border-primary/50'}`}>
                                <div className="text-sm font-medium text-slate-800 dark:text-white">{sw.mirrorRegistry}</div>
                                <div className="text-xs text-slate-500 dark:text-white/50 mt-1">{sw.mirrorRecommend}</div>
                              </button>
                            </div>
                          </div>
                          {/* 内网穿透 / 虚拟局域网 */}
                          <div>
                            <label className="text-xs text-slate-500 dark:text-white/50 mb-1 block">{sw.vpnTools}</label>
                            <p className="text-[10px] text-slate-400 dark:text-white/35 mb-2">{sw.vpnToolsDesc}</p>
                            <div className="space-y-2">
                              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-white/10 hover:border-primary/40 transition-colors cursor-pointer">
                                <input type="checkbox" checked={installZeroTier} onChange={e => setInstallZeroTier(e.target.checked)}
                                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/30" />
                                <div className="flex-1">
                                  <div className="text-sm font-medium text-slate-700 dark:text-white/80">🌐 {sw.installZeroTier}</div>
                                  <div className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{sw.zeroTierDesc}</div>
                                </div>
                              </label>
                              {installZeroTier && (
                                <div className="ml-7 mt-1">
                                  <input
                                    type="text"
                                    value={zerotierNetworkId}
                                    onChange={e => setZerotierNetworkId(e.target.value.replace(/[^a-fA-F0-9]/g, '').slice(0, 16))}
                                    placeholder={sw.zerotierNetworkIdPlaceholder}
                                    className="w-full h-8 px-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-xs font-mono text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/35 outline-none focus:ring-1 focus:ring-primary/40"
                                  />
                                  <p className="text-[10px] text-slate-400 dark:text-white/35 mt-1">{sw.zerotierNetworkIdDesc}</p>
                                </div>
                              )}
                              <label className="flex items-start gap-3 p-3 rounded-lg border border-slate-200 dark:border-white/10 hover:border-primary/40 transition-colors cursor-pointer">
                                <input type="checkbox" checked={installTailscale} onChange={e => setInstallTailscale(e.target.checked)}
                                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/30" />
                                <div className="flex-1">
                                  <div className="text-sm font-medium text-slate-700 dark:text-white/80">🔒 {sw.installTailscale}</div>
                                  <div className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{sw.tailscaleDesc}</div>
                                </div>
                              </label>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>


                  </div>
                )}

                {/* 已安装状态 */}
                {scanResult.openClawInstalled && (
                  <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-white/10">
                    <div className="p-4 bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-xl">
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-green-600 dark:text-green-400 text-xl">check_circle</span>
                        <div className="flex-1">
                          <h4 className="text-sm font-bold text-green-800 dark:text-green-300">
                            {sw.alreadyInstalled}
                          </h4>
                          <p className="text-xs text-green-600 dark:text-green-400/80 mt-1">
                            {`openclaw ${scanResult.openClawVersion || ''}`}
                            {scanResult.gatewayRunning
                              ? ` · ${sw.gwRunning}`
                              : ` · ${sw.gwNotRunning}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="flex gap-3 pt-4">
                  {scanResult.openClawInstalled ? (
                    <>
                      <button
                        onClick={() => {
                          if (scanResult.openClawConfigured) {
                            if (onClose) onClose();
                          } else {
                            if (onClose) onClose();
                            if (onOpenEditor) onOpenEditor();
                          }
                        }}
                        className="flex-1 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors shadow-lg shadow-primary/30"
                      >
                        {scanResult.openClawConfigured ? sw.enterSystem : sw.goConfigure}
                      </button>
                      <button
                        disabled={isUpdating || isUninstalling || !scanResult.updateAvailable}
                        onClick={async () => {
                          if (!scanResult.updateAvailable) return;
                          setIsUpdating(true);
                          setError(null);
                          setUpdateLogs([]);
                          setUpdateStep('');
                          setUpdateProgress(0);
                          try {
                            const response = await fetch('/api/v1/setup/update-openclaw', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                            });
                            if (!response.ok) throw new Error(sw.updateFailed);
                            const reader = response.body?.getReader();
                            if (!reader) throw new Error(sw.streamFailed);
                            const decoder = new TextDecoder();
                            let buf = '';
                            while (true) {
                              const { done, value } = await reader.read();
                              if (done) break;
                              buf += decoder.decode(value, { stream: true });
                              const parts = buf.split('\n\n');
                              buf = parts.pop() || '';
                              for (const part of parts) {
                                if (part.startsWith('data: ')) {
                                  try {
                                    const ev: SetupEvent = JSON.parse(part.slice(6));
                                    if (ev.type === 'log') {
                                      setUpdateLogs(prev => [...prev.slice(-50), ev.message]);
                                    } else if (ev.type === 'phase' || ev.type === 'step') {
                                      setUpdateStep(ev.message);
                                      setUpdateProgress(ev.progress || 0);
                                    } else if (ev.type === 'progress') {
                                      setUpdateProgress(ev.progress || 0);
                                    } else if (ev.type === 'error') {
                                      setError(ev.message);
                                      setIsUpdating(false);
                                      return;
                                    } else if (ev.type === 'complete') {
                                      setUpdateProgress(100);
                                      setUpdateStep(ev.message);
                                    }
                                  } catch {}
                                }
                              }
                            }
                            await scanEnvironment();
                          } catch (err: any) {
                            setError(err?.message || sw.updateFailed);
                          } finally {
                            setIsUpdating(false);
                          }
                        }}
                        className={`px-5 py-3 rounded-xl font-medium transition-colors border ${!scanResult.updateAvailable
                            ? 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-white/40 border-transparent cursor-not-allowed'
                            : 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/30'
                          }`}
                      >
                        <div className="flex flex-col items-center leading-none gap-1">
                          <span className="flex items-center gap-1.5">
                            {isUpdating && (
                              <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                            )}
                            {isUpdating ? sw.updating : (!scanResult.updateAvailable ? sw.upToDate : sw.updateAvailable)}
                          </span>
                          {scanResult.latestOpenClawVersion && (
                            <span className="text-[10px] opacity-70">
                              {scanResult.openClawVersion} → {scanResult.latestOpenClawVersion}
                            </span>
                          )}
                        </div>
                      </button>
                      <button
                        disabled={isUninstalling || isUpdating}
                        onClick={async () => {
                          const cmdName = 'openclaw';
                          const confirmed = await confirm({
                            title: sw.confirmUninstall,
                            message: sw.confirmUninstallMsg.replace('{cmd}', cmdName),
                            confirmText: sw.uninstall,
                            cancelText: sw.cancel,
                            danger: true,
                          });
                          if (!confirmed) return;
                          setIsUninstalling(true);
                          setError(null);
                          try {
                            await post('/api/v1/setup/uninstall');
                            setScanResult(null);
                            await scanEnvironment();
                          } catch (err: any) {
                            setError(err?.message || sw.uninstallFailed);
                          } finally {
                            setIsUninstalling(false);
                          }
                        }}
                        className="px-5 py-3 bg-slate-200 hover:bg-red-100 dark:bg-white/10 dark:hover:bg-red-500/20 text-slate-600 hover:text-red-600 dark:text-white/60 dark:hover:text-red-400 rounded-xl font-medium transition-colors disabled:opacity-50"
                      >
                        {isUninstalling ? sw.uninstalling : sw.uninstall}
                      </button>
                    </>
                  ) : (
                    <div className="flex-1 space-y-3">
                      {/* sudo 密码输入（非 root 且无免密 sudo 时显示） */}
                      {scanResult && !scanResult.isRoot && !scanResult.hasSudo && scanResult.os !== 'windows' && (
                        <div className="p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-amber-500 text-base">key</span>
                            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{sw.sudoPasswordTitle}</span>
                          </div>
                          <p className="text-[11px] text-amber-600 dark:text-amber-400/70">{sw.sudoPasswordDesc}</p>
                          <input
                            type="password"
                            value={sudoPassword}
                            onChange={e => setSudoPassword(e.target.value)}
                            placeholder={sw.sudoPasswordPlaceholder}
                            className="w-full h-9 px-3 bg-white dark:bg-white/5 border border-amber-200 dark:border-amber-500/30 rounded-lg text-sm text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-white/35 outline-none focus:ring-1 focus:ring-amber-400"
                          />
                        </div>
                      )}
                      <button
                        onClick={startAutoInstall}
                        className="w-full py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors shadow-lg shadow-primary/30"
                      >
                        {sw.startInstall}
                      </button>
                    </div>
                  )}
                </div>

                {/* 升级日志面板 */}
                {(isUpdating || updateLogs.length > 0) && (
                  <div className="mt-4 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
                    {/* 进度条 */}
                    {isUpdating && (
                      <div className="h-1 bg-slate-200 dark:bg-white/10">
                        <div
                          className="h-full bg-blue-500 transition-all duration-500"
                          style={{ width: `${updateProgress}%` }}
                        />
                      </div>
                    )}
                    {/* 当前步骤 */}
                    {updateStep && (
                      <div className="px-3 py-2 border-b border-slate-200 dark:border-white/10 flex items-center gap-2">
                        {isUpdating && (
                          <span className="material-symbols-outlined text-[14px] text-blue-500 animate-spin">progress_activity</span>
                        )}
                        {!isUpdating && updateProgress >= 100 && (
                          <span className="material-symbols-outlined text-[14px] text-green-500">check_circle</span>
                        )}
                        <span className="text-xs text-slate-600 dark:text-white/60">{updateStep}</span>
                        {isUpdating && (
                          <span className="text-[10px] text-slate-400 dark:text-white/40 ml-auto">{updateProgress}%</span>
                        )}
                      </div>
                    )}
                    {/* 日志输出 */}
                    <div ref={updateLogRef} className="max-h-32 overflow-y-auto p-3 font-mono text-[11px] text-slate-500 dark:text-white/50 space-y-0.5">
                      {updateLogs.length === 0 && isUpdating && (
                        <div className="text-slate-400 dark:text-white/35">{sw.waitingOutput}</div>
                      )}
                      {updateLogs.map((line, i) => (
                        <div key={i} className="break-all leading-relaxed">{line}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* 安装阶段 */}
        {phase === 'install' && (
          <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white/80 mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary animate-pulse">download</span>
              {sw.installing}
            </h3>

            {/* 进度条 */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-slate-500 dark:text-white/50 mb-1">
                <span>{currentStep}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 relative"
                  style={{ width: `${progress}%` }}
                >
                  <div className="absolute inset-0 bg-white/30 w-full h-full animate-[shimmer_2s_infinite] translate-x-[-100%]"
                    style={{
                      backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
                      animation: 'shimmer 1.5s infinite'
                    }}>
                  </div>
                </div>
              </div>
            </div>

            {/* 日志输出 */}
            <div className="h-48 overflow-y-auto bg-slate-900 dark:bg-black/50 rounded-lg p-3 font-mono text-xs text-green-400 custom-scrollbar">
              {logs.map((log, i) => (
                <div key={i} className="whitespace-pre-wrap">{log}</div>
              ))}
              {logs.length === 0 && (
                <div className="text-slate-500">{sw.waitingOutput}</div>
              )}
            </div>
          </div>
        )}

        {/* 启动网关阶段 */}
        {phase === 'starting' && (
          <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm">
            <div className="text-center">
              {!gwStartFailed ? (
                <>
                  <div className="w-16 h-16 bg-yellow-100 dark:bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="material-symbols-outlined text-3xl text-yellow-600 dark:text-yellow-400 animate-spin">progress_activity</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                    {sw.gwStarting}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-white/60 mb-4">
                    {sw.gwStartingDesc}
                  </p>
                  {/* 进度条 */}
                  <div className="max-w-xs mx-auto mb-3">
                    <div className="h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yellow-500 transition-all duration-1000"
                        style={{ width: `${Math.min((gwStartElapsed / 60) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-white/40">
                    {gwStartElapsed}s / 60s
                  </p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-red-100 dark:bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="material-symbols-outlined text-3xl text-red-600 dark:text-red-400">error</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                    {sw.gwStartFailed}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-white/60 mb-2">
                    {gwStartError}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-white/40 mb-6">
                    {sw.gwStartFailedHint}
                  </p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => {
                        setGwStartFailed(false);
                        setGwStartError(null);
                        setGwRetryCount(c => c + 1);
                      }}
                      className="px-5 py-2.5 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors"
                    >
                      {sw.gwRetry}
                    </button>
                    <button
                      onClick={() => setPhase('complete')}
                      className="px-5 py-2.5 bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white rounded-xl font-medium hover:bg-slate-300 dark:hover:bg-white/20 transition-colors"
                    >
                      {sw.gwSkip}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 完成阶段 */}
        {phase === 'complete' && (
          <div className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-2xl p-6 shadow-sm text-center">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-3xl text-green-600 dark:text-green-400">check_circle</span>
            </div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              {sw.installComplete}
            </h3>
            <p className="text-sm text-slate-500 dark:text-white/60 mb-4">
              {sw.installSuccess}
            </p>

            {/* 安装详单 */}
            {installSummary.length > 0 && (
              <div className="mb-6 text-left">
                {(['deps', 'optional', 'config', 'gateway'] as const).map(cat => {
                  const items = installSummary.filter(s => s.category === cat);
                  if (items.length === 0) return null;
                  const catLabel = { deps: sw.summaryDeps, optional: sw.summaryOptional, config: sw.summaryConfig, gateway: sw.summaryGateway }[cat];
                  return (
                    <div key={cat} className="mb-3">
                      <div className="text-[11px] font-medium text-slate-400 dark:text-white/40 uppercase tracking-wider mb-1.5 px-1">{catLabel}</div>
                      <div className="bg-slate-50 dark:bg-white/5 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5">
                        {items.map((item, idx) => {
                          const isZeroTier = item.label?.toLowerCase().includes('zerotier');
                          const isTailscale = item.label?.toLowerCase().includes('tailscale');
                          return (
                            <div key={idx} className="flex items-center gap-2 px-3 py-2 text-xs">
                              <span className="material-symbols-outlined text-sm" style={{ color: item.status === 'ok' ? '#22c55e' : item.status === 'warn' ? '#eab308' : item.status === 'fail' ? '#ef4444' : '#94a3b8' }}>
                                {item.status === 'ok' ? 'check_circle' : item.status === 'warn' ? 'warning' : item.status === 'fail' ? 'cancel' : 'remove_circle_outline'}
                              </span>
                              <span className="font-medium text-slate-700 dark:text-white/80 min-w-[80px]">{item.label}</span>
                              <span className="text-slate-500 dark:text-white/50 truncate flex-1">{item.detail}</span>
                              {isZeroTier && item.status === 'ok' && (
                                <a href="https://my.zerotier.com/" target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 px-2 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors shrink-0"
                      title={sw.zerotierManageHint}>
                                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        <span className="text-[10px] font-bold whitespace-nowrap">{sw.zerotierManage}</span>
                                </a>
                              )}
                              {isTailscale && item.status === 'ok' && (
                                <a href="https://login.tailscale.com/admin" target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 px-2 py-1 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg transition-colors shrink-0"
                      title={sw.tailscaleManageHint}>
                                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                        <span className="text-[10px] font-bold whitespace-nowrap">{sw.tailscaleManage}</span>
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 配置提示 */}
            <p className="text-xs text-slate-500 dark:text-white/50 mb-6">
              {sw.postInstallHint}
            </p>

            <div className="flex gap-3">
              {needsRestart ? (
                <button
                  onClick={() => onClose && onClose()}
                  className="flex-1 px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl font-medium transition-colors shadow-lg shadow-yellow-500/30"
                >
                  {sw.restartAck}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      onClose();
                      if (onOpenEditor) onOpenEditor();
                    }}
                    className="flex-1 px-6 py-3 bg-slate-200 hover:bg-slate-300 dark:bg-white/10 dark:hover:bg-white/20 text-slate-700 dark:text-white rounded-xl font-medium transition-colors"
                  >
                    {sw.openEditor}
                  </button>
                  <button
                    onClick={() => {
                      onClose();
                      if (onOpenUsageWizard) onOpenUsageWizard();
                    }}
                    className="flex-1 px-6 py-3 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition-colors shadow-lg shadow-primary/30 animate-pulse"
                  >
                    {sw.openUsageWizard}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

export default SetupWizard;
