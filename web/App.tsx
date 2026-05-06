
import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/ConfirmDialog';
import LockScreen from './components/LockScreen';
import Desktop from './components/Desktop';
import WindowFrame from './components/WindowFrame';
import { WindowID, WindowState, WindowBounds, Language, isRtl, OpenWindowDetail } from './types';
import { getTranslation, loadLocale } from './locales';
import { get } from './services/request';
import { authApi, settingsApi } from './services/api';
import { useBadgeCounts } from './hooks/useBadgeCounts';
import ErrorBoundary from './components/ErrorBoundary';
import CommandPalette from './components/CommandPalette';
import type { Preferences, StartupWindowMode } from './utils/preferences';
import { loadPreferences } from './utils/preferences';

const idle = (cb: () => void) => {
  const ric = (window as any).requestIdleCallback as ((fn: () => void, opts?: { timeout: number }) => number) | undefined;
  if (ric) return ric(cb, { timeout: 1200 });
  return window.setTimeout(cb, 350);
};

// 路由级代码分割：每个页面独立 chunk，按需加载
const loadDashboard = () => import('./windows/Dashboard');
const loadGateway = () => import('./windows/Gateway');
const loadSessions = () => import('./windows/Sessions');
const loadActivity = () => import('./windows/Activity');
const loadAlerts = () => import('./windows/Alerts');
const loadUsage = () => import('./windows/Usage');
const loadEditor = () => import('./windows/Editor/index');
const loadSkills = () => import('./windows/Skills');
const loadAgents = () => import('./windows/Agents');
const loadDoctor = () => import('./windows/Doctor');
const loadScheduler = () => import('./windows/Scheduler');
const loadSettings = () => import('./windows/Settings');
const loadNodes = () => import('./windows/Nodes');
const loadSetupWizard = () => import('./windows/SetupWizard');
const loadUsageWizard = () => import('./windows/UsageWizard');
const loadKnowledge = () => import('./windows/Knowledge');
const loadTerminal = () => import('./windows/Terminal');
const loadAgentRoom = () => import('./windows/AgentRoom');
const loadObservability = () => import('./windows/Observability');

const WINDOW_LOADERS: Record<WindowID, () => Promise<unknown>> = {
  dashboard: loadDashboard,
  gateway: loadGateway,
  sessions: loadSessions,
  activity: loadActivity,
  alerts: loadAlerts,
  usage: loadUsage,
  editor: loadEditor,
  skills: loadSkills,
  agents: loadAgents,
  maintenance: loadDoctor,
  scheduler: loadScheduler,
  settings: loadSettings,
  nodes: loadNodes,
  setup_wizard: loadSetupWizard,
  usage_wizard: loadUsageWizard,
  knowledge: loadKnowledge,
  terminal: loadTerminal,
  agentroom: loadAgentRoom,
  observability: loadObservability,
};

const PRIORITY_WARMUP_LOADERS: Array<() => Promise<unknown>> = [
  loadGateway,
  loadEditor,
  loadSessions,
  loadAlerts,
  loadAgents,
];

const SECONDARY_WARMUP_LOADERS: Array<() => Promise<unknown>> = [
  loadActivity,
  loadDoctor,
  loadScheduler,
  loadSettings,
  loadNodes,
  loadSkills,
  loadUsage,
  loadSetupWizard,
  loadUsageWizard,
];

const Dashboard = React.lazy(loadDashboard);
const Gateway = React.lazy(loadGateway);
const Sessions = React.lazy(loadSessions);
const Activity = React.lazy(loadActivity);
const Alerts = React.lazy(loadAlerts);
const Usage = React.lazy(loadUsage);
const Editor = React.lazy(loadEditor);
const Skills = React.lazy(loadSkills);
const Agents = React.lazy(loadAgents);
const Doctor = React.lazy(loadDoctor);
const Scheduler = React.lazy(loadScheduler);
const Settings = React.lazy(loadSettings);
const Nodes = React.lazy(loadNodes);
const SetupWizard = React.lazy(loadSetupWizard);
const UsageWizard = React.lazy(loadUsageWizard);
const Knowledge = React.lazy(loadKnowledge);
const TerminalPage = React.lazy(loadTerminal);
const AgentRoom = React.lazy(loadAgentRoom);
const Observability = React.lazy(loadObservability);

const WINDOW_IDS: { id: WindowID; openByDefault?: boolean }[] = [
  { id: 'dashboard', openByDefault: true },
  { id: 'gateway' },
  { id: 'sessions' },
  { id: 'activity' },
  { id: 'alerts' },
  { id: 'usage' },
  { id: 'editor' },
  { id: 'skills' },
  { id: 'agents' },
  { id: 'maintenance' },
  { id: 'scheduler' },
  { id: 'settings' },
  { id: 'nodes' },
  { id: 'knowledge' },
  { id: 'terminal' },
  { id: 'agentroom' },
  { id: 'observability' },
  { id: 'setup_wizard' },
  { id: 'usage_wizard' },
];

const CASCADE_OFFSET = 30;
const MENU_BAR_H = 25;
const SETUP_WIZARD_AUTO_OPEN_DISABLED_KEY = 'setup_wizard_disable_auto_open';

function centeredBounds(): WindowBounds {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  // 动态计算：取屏幕 75% 与合理上下限之间的值
  const defaultW = Math.max(960, Math.min(1200, Math.round(vw * 0.75)));
  const defaultH = Math.max(680, Math.min(860, Math.round(vh * 0.75)));
  const w = Math.min(defaultW, vw - 40);
  const h = Math.min(defaultH, vh - MENU_BAR_H - 100);
  return { x: Math.round((vw - w) / 2), y: MENU_BAR_H + 20, width: w, height: h };
}

function smartCascadeBounds(openWindows: WindowState[]): WindowBounds {
  const base = centeredBounds();
  const visible = openWindows.filter(w => w.isOpen && !w.isMinimized);
  if (visible.length === 0) return base;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const maxOff = Math.min(
    vw - base.width - 20,
    vh - MENU_BAR_H - base.height - 100,
    CASCADE_OFFSET * 12
  );
  const maxSlots = Math.max(Math.floor(maxOff / CASCADE_OFFSET), 1);

  const occupiedOffsets = new Set(
    visible.map(w => {
      const dx = w.bounds.x - base.x;
      const dy = w.bounds.y - base.y;
      if (dx === dy && dx >= 0 && dx % CASCADE_OFFSET === 0) {
        return dx / CASCADE_OFFSET;
      }
      return -1;
    })
  );

  let slot = 0;
  for (let i = 0; i <= maxSlots; i++) {
    if (!occupiedOffsets.has(i)) { slot = i; break; }
    if (i === maxSlots) slot = 0;
  }

  const off = slot * CASCADE_OFFSET;
  return { x: base.x + off, y: base.y + off, width: base.width, height: base.height };
}

const resolveWindowTitle = (tr: any, id: WindowID): string => {
  const direct = tr?.[id];
  if (typeof direct === 'string') return direct;
  const menuTitle = tr?.menu?.[id];
  if (typeof menuTitle === 'string') return menuTitle;
  return id;
};

const buildWindows = (lang: Language, startupWindow: StartupWindowMode = 'dashboard'): WindowState[] => {
  const tr = getTranslation(lang) as any;
  return WINDOW_IDS.map((w, i) => ({
    id: w.id,
    title: resolveWindowTitle(tr, w.id),
    isOpen: startupWindow !== 'none' && w.id === startupWindow,
    isMinimized: false,
    isMaximized: false,
    zIndex: 10 + i,
    bounds: centeredBounds(),
  }));
};

const App: React.FC = () => {
  const [isLocked, setIsLocked] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('lang') as Language) || 'zh');
  const [windows, setWindows] = useState<WindowState[]>(() => {
    const p = loadPreferences();
    return buildWindows(language, p.startupWindow);
  });
  const [maxZ, setMaxZ] = useState(100);
  const [localeReady, setLocaleReady] = useState(language === 'en');
  const hasWarmedChunksRef = React.useRef(false);
  const prefetchedWindowsRef = React.useRef<Set<WindowID>>(new Set());

  // On mount: check if existing cookie session is still valid → skip lock screen
  useEffect(() => {
    authApi.me()
      .then(() => {
        setIsLocked(false);
      })
      .catch(() => {
        // Cookie missing or expired → stay on lock screen
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, []);

  // Unified cross-window deep-link state
  const [pendingDetail, setPendingDetail] = useState<OpenWindowDetail | null>(null);

  // 动态加载语言包
  useEffect(() => {
    if (language === 'en') { setLocaleReady(true); return; }
    setLocaleReady(false);
    loadLocale(language).then(() => setLocaleReady(true));
  }, [language]);

  const t = useMemo(() => getTranslation(language), [language, localeReady]);
  const badges = useBadgeCounts(!isLocked);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dir = isRtl(language) ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    localStorage.setItem('lang', language);
    setWindows(prev => prev.map(w => ({
      ...w,
      title: resolveWindowTitle(t as any, w.id)
    })));
    // Sync language to backend (fire and forget, skip when not logged in)
    if (!isLocked) {
      settingsApi.setLanguage(language).catch(() => {});
    }
  }, [language, t]);

  // 自动检查OpenClaw 安装状态，未安装则自动打开安装向导
  useEffect(() => {
    if (isLocked) return;
    if (localStorage.getItem(SETUP_WIZARD_AUTO_OPEN_DISABLED_KEY) === '1') return;

    const checkOpenClawStatus = async () => {
      // 延迟 500ms，确保登录流程完成
      await new Promise(resolve => setTimeout(resolve, 500));

      // 检查是否登录状态通过 API 调用本身来验证 (依靠 Cookie)
      // 如果未登录，接下来的 get 调用会失败并被 catch 捕获

      try {
        const data = await get<any>('/api/v1/setup/scan');
        if (!data.openClawInstalled) {
          setWindows(prev => prev.map(w => {
            if (w.id === 'setup_wizard') return { ...w, isOpen: true, zIndex: 200 };
            return w;
          }));
        } else if (!data.openClawConfigured) {
          setWindows(prev => prev.map(w => {
            if (w.id === 'editor') return { ...w, isOpen: true, zIndex: 200 };
            return w;
          }));
        }
      } catch (err) {
        // 忽略错误（可能是未登录或网络问题）
        // console.log('Setup scan failed:', err);
      }
    };
    checkOpenClawStatus();
  }, [isLocked]);

  // 登录后空闲预热常用窗口 chunk，减少首次打开等待
  useEffect(() => {
    if (isLocked || !localeReady) return;

    if (hasWarmedChunksRef.current) return;
    hasWarmedChunksRef.current = true;

    // 省流量或弱网仅预热高优先级，避免挤占带宽导致主交互变慢
    const conn = (navigator as any).connection;
    const saveData = !!conn?.saveData;
    const netType = String(conn?.effectiveType || '');
    const weakNetwork = /(^|-)2g|slow-2g/.test(netType);

    idle(() => {
      void Promise.allSettled(PRIORITY_WARMUP_LOADERS.map((loader) => loader()));
    });

    if (saveData || weakNetwork) return;

    window.setTimeout(() => {
      idle(() => {
        void Promise.allSettled(SECONDARY_WARMUP_LOADERS.map((loader) => loader()));
      });
    }, 800);
  }, [isLocked, localeReady]);

  const toggleTheme = useCallback(() => setTheme(p => p === 'dark' ? 'light' : 'dark'), []);
  const changeLanguage = useCallback((lang: Language) => setLanguage(lang), []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Even if the backend session is already invalid, force the UI back to lock screen.
    } finally {
      setWindows(buildWindows(language, loadPreferences().startupWindow));
      setMaxZ(100);
      setPendingDetail(null);
      prefetchedWindowsRef.current.clear();
      hasWarmedChunksRef.current = false;
      setIsLocked(true);
    }
  }, [language]);

  const prefetchWindow = useCallback((id: WindowID) => {
    if (prefetchedWindowsRef.current.has(id)) return;
    const loader = WINDOW_LOADERS[id];
    if (!loader) return;
    prefetchedWindowsRef.current.add(id);
    void loader().catch(() => {
      prefetchedWindowsRef.current.delete(id);
    });
  }, []);

  const openWindow = useCallback((id: WindowID) => {
    setWindows(prev => {
      const target = prev.find(w => w.id === id);
      if (target?.isOpen) {
        return prev.map(w => w.id === id ? { ...w, isMinimized: false, zIndex: maxZ + 1 } : w);
      }
      const newBounds = smartCascadeBounds(prev);
      return prev.map(w => {
        if (w.id === id) return { ...w, isOpen: true, isMinimized: false, zIndex: maxZ + 1, bounds: newBounds };
        return w;
      });
    });
    setMaxZ(p => p + 1);
  }, [maxZ]);

  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);

  const handlePrefsChange = useCallback((next: Preferences) => {
    setPrefs(next);
  }, []);

  // Unified deep-link event listener
  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent<OpenWindowDetail>).detail;
      if (!detail?.id) return;
      setPendingDetail(detail);
      openWindow(detail.id);
    };
    window.addEventListener('clawdeck:open-window', handler as EventListener);
    return () => window.removeEventListener('clawdeck:open-window', handler as EventListener);
  }, [openWindow]);

  // Navigate to Sessions window and select a specific session
  const navigateToSession = useCallback((sessionKey: string) => {
    setPendingDetail({ id: 'sessions', sessionKey });
    openWindow('sessions');
  }, [openWindow]);

  // Listen for navigate-to-session events from workflow runner
  useEffect(() => {
    const handleNavigateToSession = (e: CustomEvent<{ sessionKey: string; agentId?: string }>) => {
      if (e.detail?.sessionKey) {
        navigateToSession(e.detail.sessionKey);
      }
    };
    window.addEventListener('navigate-to-session', handleNavigateToSession as EventListener);
    return () => {
      window.removeEventListener('navigate-to-session', handleNavigateToSession as EventListener);
    };
  }, [navigateToSession]);

  const consumeDetail = useCallback(() => setPendingDetail(null), []);
  const detailFor = useCallback((id: WindowID) => pendingDetail?.id === id ? pendingDetail : null, [pendingDetail]);

  const closeWindow = useCallback((id: WindowID) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, isOpen: false, isMaximized: false } : w));
  }, []);

  const closeAllWindows = useCallback(() => {
    setWindows(prev => prev.map(w => ({ ...w, isOpen: false, isMaximized: false, isMinimized: false })));
  }, []);

  const minimizeWindow = useCallback((id: WindowID) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: true } : w));
  }, []);

  const maximizeWindow = useCallback((id: WindowID) => {
    setWindows(prev => prev.map(w => {
      if (w.id !== id) return w;
      if (w.isMaximized) {
        return { ...w, isMaximized: false, isMinimized: false, bounds: w.prevBounds || w.bounds };
      }
      return { ...w, isMaximized: true, isMinimized: false, prevBounds: { ...w.bounds } };
    }));
  }, []);

  const focusWindow = useCallback((id: WindowID) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: maxZ + 1 } : w));
    setMaxZ(p => p + 1);
  }, [maxZ]);

  const updateBounds = useCallback((id: WindowID, bounds: WindowBounds) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, bounds, isMaximized: false } : w));
  }, []);

  if (!localeReady || authChecking) return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-900">
      <span className="material-symbols-outlined text-3xl text-white/40 animate-spin">progress_activity</span>
    </div>
  );

  if (isLocked) return (
    <ToastProvider>
      <ConfirmProvider>
        <LockScreen
          onUnlock={() => setIsLocked(false)}
          theme={theme}
          onToggleTheme={toggleTheme}
          language={language}
          onChangeLanguage={changeLanguage}
        />
      </ConfirmProvider>
    </ToastProvider>
  );

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="h-screen w-screen overflow-hidden select-none">
          <Desktop
            onOpenWindow={openWindow}
            onPrefetchWindow={prefetchWindow}
            onCloseAllWindows={closeAllWindows}
            onLogout={logout}
            activeWindows={windows}
            theme={theme}
            onToggleTheme={toggleTheme}
            language={language}
            onChangeLanguage={changeLanguage}
            badges={badges}
            dockAutoHide={prefs.dockAutoHide
              ? windows.some(w => w.isOpen && !w.isMinimized)
              : windows.some(w => w.isOpen && w.isMaximized && !w.isMinimized)}
            wallpaper={prefs.wallpaper}
          />
          {windows.filter(w => w.isOpen).map(w => {
            const topZ = Math.max(...windows.filter(o => o.isOpen && !o.isMinimized).map(o => o.zIndex));
            return (
              <WindowFrame
                key={w.id}
                window={w}
                language={language}
                isFocused={w.zIndex === topZ}
                dockHidden={prefs.dockAutoHide
                  ? windows.some(o => o.isOpen && !o.isMinimized)
                  : windows.some(o => o.isOpen && o.isMaximized && !o.isMinimized)}
                controlsPosition={prefs.windowControlsPosition}
                onClose={() => closeWindow(w.id)}
                onMinimize={() => minimizeWindow(w.id)}
                onMaximize={() => maximizeWindow(w.id)}
                onFocus={() => focusWindow(w.id)}
                onBoundsChange={(b) => updateBounds(w.id, b)}
              >
                <ErrorBoundary windowId={w.id} windowTitle={w.title}>
                  <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400 dark:text-white/40"><span className="material-symbols-outlined animate-spin me-2">progress_activity</span></div>}>
                    {w.id === 'dashboard' && <Dashboard language={language} />}
                    {w.id === 'gateway' && <Gateway language={language} />}
                    {w.id === 'sessions' && <Sessions language={language} pendingSessionKey={detailFor('sessions')?.sessionKey ?? null} onSessionKeyConsumed={consumeDetail} />}
                    {w.id === 'activity' && <Activity language={language} onNavigateToSession={navigateToSession} />}
                    {w.id === 'alerts' && <Alerts language={language} />}
                    {w.id === 'usage' && <Usage language={language} onNavigateToSession={navigateToSession} />}
                    {w.id === 'editor' && <Editor language={language} pendingSection={detailFor('editor')?.section ?? null} onSectionConsumed={consumeDetail} />}
                    {w.id === 'skills' && <Skills language={language} />}
                    {w.id === 'agents' && <Agents language={language} />}
                    {w.id === 'maintenance' && <Doctor language={language} />}
                    {w.id === 'scheduler' && <Scheduler language={language} />}
                    {w.id === 'settings' && <Settings language={language} onLogout={logout} pendingTab={detailFor('settings')?.tab ?? null} pendingSnapshotId={detailFor('settings')?.snapshotId ?? null} onTabConsumed={consumeDetail} onPrefsChange={handlePrefsChange} badges={badges} />}
                    {w.id === 'nodes' && <Nodes language={language} />}
                    {w.id === 'knowledge' && <Knowledge language={language} pendingExpandItem={detailFor('knowledge')?.expandItem ?? null} onExpandItemConsumed={consumeDetail} />}
                    {w.id === 'terminal' && <TerminalPage language={language} />}
                    {w.id === 'agentroom' && <AgentRoom language={language} />}
                    {w.id === 'observability' && <Observability language={language} />}
                    {w.id === 'setup_wizard' && (
                      <SetupWizard
                        language={language}
                        onClose={() => closeWindow('setup_wizard')}
                        onOpenEditor={() => openWindow('editor')}
                        onOpenUsageWizard={() => openWindow('usage_wizard')}
                      />
                    )}
                    {w.id === 'usage_wizard' && <UsageWizard language={language} onOpenEditor={() => openWindow('editor')} />}
                  </Suspense>
                </ErrorBoundary>
              </WindowFrame>
            );
          })}
          <CommandPalette language={language} openWindow={openWindow} />
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
};

export default App;
