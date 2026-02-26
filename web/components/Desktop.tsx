
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { WindowID, WindowState, Language } from '../types';
import { getTranslation } from '../locales';
import Badge from './Badge';
import LanguageSwitcher from './LanguageSwitcher';
import { useIconGrid } from '../hooks/useIconGrid';

interface DesktopProps {
  onOpenWindow: (id: WindowID) => void;
  onCloseAllWindows: () => void;
  activeWindows: WindowState[];
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  badges?: Record<WindowID, number>;
  dockAutoHide?: boolean;
}

interface AppInfo {
  id: WindowID;
  titleKey: string;
  icon: string;
  gradient: string;
}

interface AppGroup {
  id: string;
  nameKey: string;
  icon: string;
  gradient: string;
  apps: { id: WindowID; icon: string; color: string }[];
}

const Desktop: React.FC<DesktopProps> = ({
  onOpenWindow,
  onCloseAllWindows,
  activeWindows,
  theme,
  onToggleTheme,
  language,
  onChangeLanguage,
  badges = {},
  dockAutoHide = false
}) => {
  const [time, setTime] = useState(new Date());
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [isTrashCleaning, setIsTrashCleaning] = useState(false);
  const [dockPeeking, setDockPeeking] = useState(false);
  const dockHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const popupRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  // Dock auto-hide: hidden when maximized window exists, peek on bottom hover
  const isDockHidden = dockAutoHide && !dockPeeking;

  const handleDockTriggerEnter = useCallback(() => {
    if (!dockAutoHide) return;
    if (dockHideTimer.current) { clearTimeout(dockHideTimer.current); dockHideTimer.current = null; }
    setDockPeeking(true);
  }, [dockAutoHide]);

  const handleDockAreaLeave = useCallback(() => {
    if (!dockAutoHide) return;
    dockHideTimer.current = setTimeout(() => setDockPeeking(false), 400);
  }, [dockAutoHide]);

  // Reset peek when auto-hide is disabled (no maximized windows)
  useEffect(() => {
    if (!dockAutoHide) setDockPeeking(false);
  }, [dockAutoHide]);

  const t = useMemo(() => getTranslation(language), [language]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const allDesktopApps: AppInfo[] = [
    // 核心操作
    { id: 'dashboard', titleKey: 'dashboard', icon: 'dashboard', gradient: 'from-[#2DA9FF] to-[#007AFF]' },
    { id: 'gateway', titleKey: 'gateway', icon: 'router', gradient: 'from-[#34C759] to-[#248A3D]' },
    { id: 'editor', titleKey: 'editor', icon: 'code_blocks', gradient: 'from-[#14B8A6] to-[#0D9488]' },
    { id: 'sessions', titleKey: 'sessions', icon: 'forum', gradient: 'from-[#818CF8] to-[#4F46E5]' },
    { id: 'agents', titleKey: 'agents', icon: 'robot_2', gradient: 'from-[#5856D6] to-[#3634A3]' },
    // 监控与运维
    { id: 'activity', titleKey: 'activity', icon: 'query_stats', gradient: 'from-[#AF52DE] to-[#8944AB]' },
    { id: 'alerts', titleKey: 'alerts', icon: 'approval', gradient: 'from-[#FF453A] to-[#C33B32]' },
    { id: 'scheduler', titleKey: 'scheduler', icon: 'event_repeat', gradient: 'from-[#FF375F] to-[#BF2A47]' },
    { id: 'skills', titleKey: 'skills', icon: 'extension', gradient: 'from-[#FF9500] to-[#E67E00]' },
    { id: 'maintenance', titleKey: 'maintenance', icon: 'health_and_safety', gradient: 'from-[#22C55E] to-[#15803D]' },
    { id: 'nodes', titleKey: 'nodes', icon: 'hub', gradient: 'from-[#10B981] to-[#059669]' },
    // 配置与工具
    { id: 'config_mgmt', titleKey: 'config_mgmt', icon: 'analytics', gradient: 'from-[#F472B6] to-[#DB2777]' },
    { id: 'settings', titleKey: 'settings', icon: 'settings', gradient: 'from-[#8E8E93] to-[#636366]' },
    { id: 'usage_wizard', titleKey: 'usage_wizard', icon: 'auto_fix_high', gradient: 'from-[#A855F7] to-[#7C3AED]' },
    { id: 'setup_wizard', titleKey: 'setup_wizard', icon: 'rocket_launch', gradient: 'from-[#FF6B6B] to-[#FF3D3D]' },
  ];
  const desktopApps = useMemo(() => {
    // Defensive normalization: keep editor always visible on desktop.
    const map = new Map<WindowID, AppInfo>();
    allDesktopApps.forEach((a) => map.set(a.id, a));
    if (!map.has('editor')) {
      map.set('editor', { id: 'editor', titleKey: 'editor', icon: 'code_blocks', gradient: 'from-[#14B8A6] to-[#0D9488]' });
    }
    return Array.from(map.values());
  }, [allDesktopApps]);

  const appIds = useMemo(() => desktopApps.map(a => a.id), [desktopApps]);
  const { positions: iconPositions, previewPositions, dragState, getPixelPos, onIconPointerDown, config: iconGridConfig } = useIconGrid(appIds);

  // #6 Dock bounce notification — track badge changes
  const prevBadgesRef = useRef<Record<string, number>>({});
  const [bouncingGroups, setBouncingGroups] = useState<Set<string>>(new Set());

  const groups: AppGroup[] = [
    {
      id: 'overview',
      nameKey: 'monitorCenter',
      icon: 'dashboard',
      gradient: 'from-[#007AFF] to-[#0040A3]',
      apps: [
        { id: 'dashboard', icon: 'dashboard', color: 'bg-blue-500' },
        { id: 'activity', icon: 'query_stats', color: 'bg-indigo-500' },
        { id: 'alerts', icon: 'approval', color: 'bg-red-500' },
      ]
    },
    {
      id: 'gateway',
      nameKey: 'gatewayMgmt',
      icon: 'hub',
      gradient: 'from-[#34C759] to-[#1A5C2A]',
      apps: [
        { id: 'gateway', icon: 'router', color: 'bg-emerald-500' },
        { id: 'sessions', icon: 'forum', color: 'bg-teal-500' },
        { id: 'agents', icon: 'robot_2', color: 'bg-green-600' },
        { id: 'scheduler', icon: 'event_repeat', color: 'bg-cyan-600' },
      ]
    },
    {
      id: 'config',
      nameKey: 'configTools',
      icon: 'code_blocks',
      gradient: 'from-[#FF9500] to-[#B36800]',
      apps: [
        { id: 'editor', icon: 'code_blocks', color: 'bg-slate-700' },
        { id: 'skills', icon: 'extension', color: 'bg-amber-600' },
        { id: 'config_mgmt', icon: 'analytics', color: 'bg-cyan-500' },
        { id: 'usage_wizard', icon: 'auto_fix_high', color: 'bg-violet-600' },
      ]
    },
    {
      id: 'system',
      nameKey: 'systemTools',
      icon: 'shield_lock',
      gradient: 'from-[#3B82F6] to-[#1E40AF]',
      apps: [
        { id: 'editor', icon: 'code_blocks', color: 'bg-teal-600' },
        { id: 'nodes', icon: 'hub', color: 'bg-sky-600' },
        { id: 'maintenance', icon: 'health_and_safety', color: 'bg-emerald-600' },
        { id: 'settings', icon: 'settings', color: 'bg-zinc-600' },
        { id: 'setup_wizard', icon: 'rocket_launch', color: 'bg-red-500' },
      ]
    }
  ];

  useEffect(() => {
    const prev = prevBadgesRef.current;
    const newBouncing = new Set<string>();
    for (const group of groups) {
      for (const app of group.apps) {
        const cur = (badges as Record<string, number>)[app.id] || 0;
        const old = prev[app.id] || 0;
        if (cur > old) {
          newBouncing.add(group.id);
          break;
        }
      }
    }
    prevBadgesRef.current = { ...(badges as Record<string, number>) };
    if (newBouncing.size > 0) {
      setBouncingGroups(newBouncing);
      const timer = setTimeout(() => setBouncingGroups(new Set()), 850);
      return () => clearTimeout(timer);
    }
  }, [badges]);

  const handleAppClick = (id: WindowID) => {
    onOpenWindow(id);
    setActiveGroupId(null);
  };

  const handleTrashClick = () => {
    const hasOpenWindows = activeWindows.some(w => w.isOpen);
    if (!hasOpenWindows) {
      setIsTrashCleaning(true);
      setTimeout(() => setIsTrashCleaning(false), 500);
      return;
    }
    onCloseAllWindows();
    setIsTrashCleaning(true);
    setTimeout(() => setIsTrashCleaning(false), 600);
  };

  const getScale = (index: number) => {
    if (hoverIndex === null || window.innerWidth < 768) return 1;
    const distance = Math.abs(index - hoverIndex);
    if (distance === 0) return 1.5;
    if (distance === 1) return 1.25;
    if (distance === 2) return 1.1;
    return 1;
  };

  return (
    <div className={`relative h-screen w-screen bg-cover bg-center overflow-hidden flex flex-col transition-all duration-700`}
      style={{
        backgroundImage: theme === 'dark'
          ? "linear-gradient(135deg, #0f1923 0%, #1a3a5f 50%, #2e4b6b 100%)"
          : "linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%)"
      }}>

      {/* 菜单栏 (MenuBar) - 交互升级 */}
      <header className={`fixed top-0 w-full h-[32px] md:h-[25px] flex items-center justify-between px-3 z-[9999] backdrop-blur-2xl backdrop-saturate-[1.8] border-b text-slate-800 dark:text-white transition-colors duration-300 ${theme === 'dark' ? 'bg-black/50 border-white/10' : 'bg-white/60 border-slate-900/10'}`}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 group cursor-pointer relative mr-2">
            <span className="text-[13px]" role="img">&#x1F980;</span>
            <span className="text-[11px] font-bold">ClawDeckX</span>
            <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-[1px] rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 leading-none">beta</span>
            <span className="text-[11px] opacity-40 font-mono ml-0.5">v{__APP_VERSION__} b{__BUILD_NUMBER__}</span>
          </div>

        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <a href="https://github.com/ClawDeckX/ClawDeckX" target="_blank" rel="noopener noreferrer" className="hover:opacity-60 transition-opacity flex items-center" title="GitHub">
            <svg className="w-[15px] h-[15px]" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          </a>
          <button onClick={onToggleTheme} className="hover:opacity-60 transition-opacity flex items-center"><span className="material-symbols-outlined text-[15px]">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span></button>
          <LanguageSwitcher language={language} onChange={onChangeLanguage} variant="topbar" />
          <div className="text-[11px] font-medium min-w-[50px] text-right hidden xs:block">
            {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
          </div>
        </div>
      </header>

      {/* 桌面图标区域 — macOS 风格可拖拽 */}
      <main className="flex-1 w-full relative overflow-hidden">
        {/* 移动端：保持原有网格布局 */}
        <div className="md:hidden grid gap-x-1 gap-y-2 h-full content-start items-start pt-[45px] px-2 pb-24"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
            gridAutoFlow: 'column',
            gridTemplateRows: 'repeat(auto-fill, minmax(100px, 120px))'
          }}
        >
          {desktopApps.map(app => (
            <div
              key={app.id}
              onClick={() => handleAppClick(app.id)}
              className="flex flex-col items-center gap-1 group cursor-pointer w-full p-1 rounded-xl hover:bg-white/10 transition-colors"
            >
              <div className={`relative w-[50px] h-[50px] rounded-[1.1rem] bg-gradient-to-b ${app.gradient} flex items-center justify-center shadow-[0_8px_16px_-4px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.3)] border-[0.5px] border-black/10 group-hover:brightness-110 group-active:scale-90 transition-all duration-200 overflow-hidden shrink-0`}>
                <div className="absolute top-0 left-0 right-0 h-[40%] bg-gradient-to-b from-white/30 to-transparent pointer-events-none"></div>
                <span className="material-symbols-outlined text-[26px] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] select-none z-10">{app.icon}</span>
                <Badge count={(badges as any)[app.id] || 0} />
              </div>
              <div className="w-full h-[28px] flex items-start justify-center overflow-hidden">
                <span className="text-[10px] font-semibold text-white text-center select-none leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,1)] line-clamp-2 break-words">
                  {t[app.titleKey] as string}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 桌面端：绝对定位 + 拖拽 + 网格吸附 + 让位动画 */}
        <div className="hidden md:block w-full h-full relative">
          {desktopApps.map(app => {
            const isDragging = dragState?.id === app.id;
            const displayPos = isDragging ? iconPositions[app.id] : (previewPositions[app.id] || iconPositions[app.id]);
            if (!displayPos) return null;
            const pixel = getPixelPos(displayPos);
            const left = isDragging ? getPixelPos(iconPositions[app.id]).x + dragState.dx : pixel.x;
            const top = isDragging ? getPixelPos(iconPositions[app.id]).y + dragState.dy : pixel.y;

            return (
              <div
                key={app.id}
                className={`absolute flex flex-col items-center gap-1 group cursor-pointer p-2 rounded-xl hover:bg-white/10 select-none ${isDragging ? 'z-[100] opacity-80 scale-105' : 'transition-all duration-200 ease-out'}`}
                style={{ left, top, width: iconGridConfig.cellW }}
                onPointerDown={(e) => onIconPointerDown(app.id, e)}
                onDoubleClick={() => handleAppClick(app.id)}
              >
                <div className={`relative w-[60px] h-[60px] rounded-[1.2rem] bg-gradient-to-b ${app.gradient} flex items-center justify-center shadow-[0_8px_16px_-4px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.3)] border-[0.5px] border-black/10 group-hover:brightness-110 group-active:scale-90 transition-all duration-200 overflow-hidden shrink-0`}>
                  <div className="absolute top-0 left-0 right-0 h-[40%] bg-gradient-to-b from-white/30 to-transparent pointer-events-none"></div>
                  <span className="material-symbols-outlined text-[32px] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)] select-none z-10">{app.icon}</span>
                  <Badge count={(badges as any)[app.id] || 0} />
                </div>
                <div className="w-full h-[32px] flex items-start justify-center overflow-hidden">
                  <span className="text-[11px] font-semibold text-white text-center select-none leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,1)] line-clamp-2 break-words">
                    {t[app.titleKey] as string}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* Bottom hover trigger zone — invisible, activates Dock peek */}
      {dockAutoHide && (
        <div
          className="fixed bottom-0 left-0 right-0 h-2 z-[9999]"
          onMouseEnter={handleDockTriggerEnter}
        />
      )}

      {/* Dock / Bottom Bar */}
      <div
        ref={dockRef}
        className={`fixed left-0 md:left-1/2 md:-translate-x-1/2 z-[10000] w-full md:w-auto flex flex-col items-center transition-all duration-300 ease-out ${isDockHidden ? 'bottom-0 translate-y-full opacity-0 pointer-events-none' : 'bottom-0 md:bottom-3 translate-y-0 opacity-100'}`}
        onMouseEnter={() => { if (dockAutoHide && dockHideTimer.current) { clearTimeout(dockHideTimer.current); dockHideTimer.current = null; } }}
        onMouseLeave={handleDockAreaLeave}
      >
        {activeGroupId && (
          <div ref={popupRef} className={`mb-6 mac-glass p-3 md:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-2xl border transition-all duration-300 animate-in fade-in zoom-in-95 slide-in-from-bottom-6 mx-4 md:mx-0 ${theme === 'dark' ? 'bg-[#1e1e1e]/90 border-white/10' : 'bg-white/90 border-slate-900/10'}`}>
            <div className="grid gap-4 md:gap-6" style={{ gridTemplateColumns: `repeat(${Math.min(groups.find(g => g.id === activeGroupId)?.apps.length || 4, 4)}, minmax(0, 1fr))` }}>
              {groups.find(g => g.id === activeGroupId)?.apps.map(app => {
                const appData = desktopApps.find(a => a.id === app.id);
                const win = activeWindows.find(w => w.id === app.id);
                const isOpen = !!win?.isOpen;
                const isMinimized = !!win?.isOpen && !!win?.isMinimized;
                const minimizedRingClass = theme === 'dark'
                  ? 'ring-4 ring-sky-200/95 shadow-[0_0_0_2px_rgba(186,230,253,0.25),0_0_16px_rgba(56,189,248,0.55)]'
                  : 'ring-4 ring-blue-500/95 shadow-[0_0_0_2px_rgba(59,130,246,0.22),0_0_14px_rgba(59,130,246,0.35)]';
                return (
                  <div key={app.id} onClick={() => handleAppClick(app.id)} className="flex flex-col items-center gap-1.5 md:gap-2 group cursor-pointer active:scale-95 transition-all">
                    <div className={`relative w-12 h-12 md:w-14 md:h-14 rounded-xl md:rounded-2xl bg-gradient-to-b ${appData?.gradient} flex items-center justify-center shadow-lg border border-black/10 ${isMinimized ? minimizedRingClass : ''}`}>
                      <span className={`material-symbols-outlined text-2xl md:text-3xl text-white ${isOpen && !isMinimized ? '' : 'opacity-95'}`}>{app.icon}</span>
                      {isOpen && !isMinimized && (
                        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-[5px] h-[5px] rounded-full bg-white/90 dark:bg-white" />
                      )}
                    </div>
                    <span className={`text-[11px] md:text-[11px] font-bold text-center leading-tight whitespace-nowrap ${theme === 'dark' ? 'text-white/90' : 'text-slate-800'}`}>{appData ? (t[appData.titleKey] as string) : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className={`mac-glass flex items-center justify-center md:items-end gap-1 px-3 md:px-4 py-2 md:py-3 w-full md:w-auto h-[72px] md:h-[72px] md:rounded-[1.8rem] rounded-t-[2rem] shadow-[0_10px_40px_rgba(0,0,0,0.3)] border-t border-white/20 transition-all duration-300 ${theme === 'dark' ? 'bg-black/40' : 'bg-white/50'}`} onMouseLeave={() => setHoverIndex(null)}>
          {groups.map((group, index) => {
            const isGroupActive = activeGroupId === group.id;
            const hasAnyAppOpen = group.apps.some(app => activeWindows.find(w => w.id === app.id)?.isOpen);
            const scale = getScale(index);
            return (
              <div key={group.id} onMouseEnter={() => setHoverIndex(index)} onClick={() => setActiveGroupId(isGroupActive ? null : group.id)}
                className={`relative flex flex-col items-center justify-center md:justify-end px-1 md:px-1 pb-1 origin-bottom ${bouncingGroups.has(group.id) ? 'animate-dock-bounce' : ''}`}
                style={{ transform: `scale(${scale})`, width: window.innerWidth < 768 ? 'auto' : `${scale * 54}px`, flex: window.innerWidth < 768 ? '1' : 'none', transition: 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                <div className={`relative w-[42px] md:w-[48px] h-[42px] md:h-[48px] rounded-[0.9rem] md:rounded-[1rem] bg-gradient-to-b ${group.gradient} flex items-center justify-center shadow-lg border-[0.5px] border-black/10`}>
                  <span className="material-symbols-outlined text-[24px] md:text-[28px] text-white">{group.icon}</span>
                </div>
                <div className="absolute -bottom-1 md:-bottom-2 h-[4px] flex items-center justify-center">
                  {hasAnyAppOpen && <div className={`w-[4px] h-[4px] rounded-full ${theme === 'dark' ? 'bg-white' : 'bg-black/70'}`}></div>}
                </div>
              </div>
            );
          })}
          <div className={`w-[1px] h-8 mx-2 md:mx-2 self-center shrink-0 ${theme === 'dark' ? 'bg-white/10' : 'bg-black/10'}`}></div>
          <div className="relative flex items-center justify-center md:justify-end px-1 pb-1 group" style={{ flex: window.innerWidth < 768 ? '1' : 'none', width: window.innerWidth < 768 ? 'auto' : '54px' }}>
            <div onClick={handleTrashClick} title={(t as any).menu?.clearWorkspace} className={`w-[42px] md:w-[48px] h-[42px] md:h-[48px] rounded-[0.9rem] md:rounded-[1rem] flex items-center justify-center transition-all cursor-pointer active:scale-75 ${theme === 'dark' ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'} ${isTrashCleaning ? 'animate-bounce' : ''}`}>
              <span className={`material-symbols-outlined text-[24px] md:text-[28px] transition-colors ${isTrashCleaning ? 'text-mac-green' : 'text-mac-red/80'}`}>delete</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Desktop;
