
import React, { ReactNode, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { WindowState, WindowBounds, Language } from '../types';
import { getTranslation } from '../locales';
import { useWindowDrag, getSnapBounds, SnapZone } from '../hooks/useWindowDrag';
import { useWindowResize, ResizeEdge, CURSOR_MAP } from '../hooks/useWindowResize';

interface WindowFrameProps {
  window: WindowState;
  language: Language;
  isFocused: boolean;
  dockHidden?: boolean;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onFocus: () => void;
  onBoundsChange: (bounds: WindowBounds) => void;
  children: ReactNode;
}

const RESIZE_HANDLE = 6;

const EDGES: { edge: ResizeEdge; style: React.CSSProperties }[] = [
  { edge: 'n',  style: { top: 0, left: RESIZE_HANDLE, right: RESIZE_HANDLE, height: RESIZE_HANDLE, cursor: 'ns-resize' } },
  { edge: 's',  style: { bottom: 0, left: RESIZE_HANDLE, right: RESIZE_HANDLE, height: RESIZE_HANDLE, cursor: 'ns-resize' } },
  { edge: 'w',  style: { left: 0, top: RESIZE_HANDLE, bottom: RESIZE_HANDLE, width: RESIZE_HANDLE, cursor: 'ew-resize' } },
  { edge: 'e',  style: { right: 0, top: RESIZE_HANDLE, bottom: RESIZE_HANDLE, width: RESIZE_HANDLE, cursor: 'ew-resize' } },
  { edge: 'nw', style: { top: 0, left: 0, width: RESIZE_HANDLE * 2, height: RESIZE_HANDLE * 2, cursor: 'nwse-resize' } },
  { edge: 'ne', style: { top: 0, right: 0, width: RESIZE_HANDLE * 2, height: RESIZE_HANDLE * 2, cursor: 'nesw-resize' } },
  { edge: 'sw', style: { bottom: 0, left: 0, width: RESIZE_HANDLE * 2, height: RESIZE_HANDLE * 2, cursor: 'nesw-resize' } },
  { edge: 'se', style: { bottom: 0, right: 0, width: RESIZE_HANDLE * 2, height: RESIZE_HANDLE * 2, cursor: 'nwse-resize' } },
];

const WindowFrame: React.FC<WindowFrameProps> = ({
  window: win,
  language,
  isFocused,
  dockHidden = false,
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  onBoundsChange,
  children,
}) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const [snapPreview, setSnapPreview] = useState<SnapZone>(null);
  const [animState, setAnimState] = useState<'opening' | 'idle' | 'minimizing'>('opening');
  const [isDragging, setIsDragging] = useState(false);
  const minimizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMinimizedRef = useRef(win.isMinimized);
  const isMobile = typeof globalThis.window !== 'undefined' && globalThis.window.innerWidth < 768;
  const boundsRef = useRef(win.bounds);
  boundsRef.current = win.bounds;

  // #2 Window open animation — play once on mount
  useEffect(() => {
    const timer = setTimeout(() => setAnimState('idle'), 260);
    return () => clearTimeout(timer);
  }, []);

  const getBounds = useCallback(() => boundsRef.current, []);

  // Drag — with shadow enhancement tracking (#7)
  const dragCb = useMemo(() => ({
    getBounds,
    onMove: (x: number, y: number) => {
      setIsDragging(true);
      onBoundsChange({ ...boundsRef.current, x, y });
    },
    onSnapPreview: (zone: SnapZone) => setSnapPreview(zone),
    onSnapCommit: (zone: SnapZone) => {
      setSnapPreview(null);
      setIsDragging(false);
      if (!zone) return;
      const snap = getSnapBounds(zone);
      if (snap) onBoundsChange(snap);
    },
  }), [getBounds, onBoundsChange]);

  const { onPointerDown: onTitlePointerDown } = useWindowDrag(dragCb);

  // Resize
  const resizeCb = useMemo(() => ({
    getBounds,
    onResize: (b: WindowBounds) => onBoundsChange(b),
  }), [getBounds, onBoundsChange]);

  const { onEdgePointerDown } = useWindowResize(resizeCb);

  // #3 Minimize genie — play animation then hide
  const handleMinimize = useCallback(() => {
    if (minimizeTimerRef.current) {
      clearTimeout(minimizeTimerRef.current);
      minimizeTimerRef.current = null;
    }
    setAnimState('minimizing');
    minimizeTimerRef.current = setTimeout(() => {
      minimizeTimerRef.current = null;
      onMinimize();
    }, 340);
  }, [onMinimize]);

  useEffect(() => {
    return () => {
      if (minimizeTimerRef.current) {
        clearTimeout(minimizeTimerRef.current);
        minimizeTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const wasMinimized = prevMinimizedRef.current;
    const isRestored = wasMinimized && !win.isMinimized;
    // Restore path: only after state actually transitioned minimized -> restored.
    if (isRestored && animState === 'minimizing') {
      if (minimizeTimerRef.current) {
        clearTimeout(minimizeTimerRef.current);
        minimizeTimerRef.current = null;
      }
      setAnimState('idle');
    }
    prevMinimizedRef.current = win.isMinimized;
  }, [win.isMinimized, animState]);

  if (win.isMinimized) return null;

  // --- Mobile: full-screen layout (unchanged behavior) ---
  if (isMobile) {
    return (
      <div
        className="fixed top-[32px] left-0 right-0 bottom-[72px]"
        style={{ zIndex: win.zIndex }}
        onMouseDown={onFocus}
      >
        <div className="mac-window-shadow bg-slate-50 dark:bg-[#1a1c20] overflow-hidden flex flex-col w-full h-full rounded-2xl border-0 transition-colors duration-300">
          <header className="flex items-center justify-between px-2.5 py-2.5 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-white/5 backdrop-blur-md shrink-0 select-none min-h-[44px]">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <div className="flex gap-[7px] shrink-0 group/traffic">
                <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="w-3 h-3 rounded-full bg-mac-red border border-black/10 dark:border-black/20 flex items-center justify-center hover:brightness-110 active:brightness-90 transition-all">
                  <svg className="w-[6px] h-[6px] opacity-0 group-hover/traffic:opacity-100 transition-opacity" viewBox="0 0 6 6" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" strokeLinecap="round"><line x1="0.5" y1="0.5" x2="5.5" y2="5.5"/><line x1="5.5" y1="0.5" x2="0.5" y2="5.5"/></svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); onMaximize(); }} className="w-3 h-3 rounded-full bg-mac-green border border-black/10 dark:border-black/20 flex items-center justify-center hover:brightness-110 active:brightness-90 transition-all">
                  <svg className="w-[6px] h-[6px] opacity-0 group-hover/traffic:opacity-100 transition-opacity" viewBox="0 0 6 6" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.1" strokeLinecap="round"><path d="M0.5 3.5L3 0.5 5.5 3.5 3 5.5z"/></svg>
                </button>
              </div>
              <div className="ml-1 flex items-center gap-1.5 text-slate-500 dark:text-white/50 min-w-0 max-w-full">
                <span className="text-[11px] font-bold uppercase tracking-tight truncate">{win.title}</span>
              </div>
            </div>
          </header>
          <div className="flex-1 overflow-hidden flex flex-col bg-white dark:bg-[#0f1115] transition-colors duration-300">{children}</div>
        </div>
      </div>
    );
  }

  // --- Desktop: draggable + resizable ---
  const { x, y, width, height } = win.bounds;
  const isMax = win.isMaximized;

  // #4 Smooth maximize/restore transition — bottom:0 when dock is auto-hidden
  const maxBottom = dockHidden ? 0 : 75;
  const outerStyle: React.CSSProperties = isMax
    ? { position: 'fixed', top: 25, left: 0, right: 0, bottom: maxBottom, zIndex: win.zIndex, transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }
    : { position: 'fixed', left: x, top: y, width, height, zIndex: win.zIndex, transition: isDragging ? 'none' : 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)' };

  // Animation class
  const animClass = animState === 'opening' ? 'animate-win-open' : animState === 'minimizing' ? 'animate-win-minimize' : '';

  // #13 Inactive + #7 Drag shadow
  const shadowClass = isDragging
    ? 'mac-window-shadow-drag'
    : isFocused
      ? 'mac-window-shadow'
      : 'mac-window-shadow-inactive';
  const inactiveClass = !isFocused && !isDragging ? 'mac-window-inactive' : '';

  // Snap preview overlay bounds
  const snapBounds = snapPreview ? getSnapBounds(snapPreview) : null;

  return (
    <>
      {/* Snap preview ghost */}
      {snapBounds && (
        <div
          className="fixed rounded-xl border-2 border-primary/40 bg-primary/10 pointer-events-none transition-all duration-150 z-[9998]"
          style={{ left: snapBounds.x + 4, top: snapBounds.y + 4, width: snapBounds.width - 8, height: snapBounds.height - 8 }}
        />
      )}

      <div className={animClass} style={outerStyle} onMouseDown={onFocus}>
        {/* Resize handles (hidden when maximized) */}
        {!isMax && EDGES.map(({ edge, style }) => (
          <div
            key={edge}
            className="absolute z-[2]"
            style={{ ...style, position: 'absolute' }}
            onPointerDown={(e) => { onFocus(); onEdgePointerDown(edge, e); }}
          />
        ))}

        <div className={`${shadowClass} ${inactiveClass} bg-slate-50 dark:bg-[#1a1c20] overflow-hidden flex flex-col w-full h-full transition-colors duration-300 ${isMax ? 'rounded-none' : 'rounded-xl border border-slate-200 dark:border-white/10'}`}>
          {/* Title bar — draggable */}
          <header
            className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 dark:border-white/5 bg-white/50 dark:bg-white/5 backdrop-blur-md shrink-0 select-none cursor-default"
            onPointerDown={(e) => { if (!isMax) { onFocus(); onTitlePointerDown(e); } }}
            onDoubleClick={(e) => { e.stopPropagation(); onMaximize(); }}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* macOS traffic lights */}
              <div className="flex gap-2 shrink-0 group/traffic">
                <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="w-3 h-3 rounded-full bg-mac-red border border-black/10 dark:border-black/20 flex items-center justify-center hover:brightness-110 active:brightness-90 transition-all">
                  <svg className="w-[6px] h-[6px] opacity-0 group-hover/traffic:opacity-100 transition-opacity" viewBox="0 0 6 6" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" strokeLinecap="round"><line x1="0.5" y1="0.5" x2="5.5" y2="5.5"/><line x1="5.5" y1="0.5" x2="0.5" y2="5.5"/></svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleMinimize(); }} className="w-3 h-3 rounded-full bg-mac-yellow border border-black/10 dark:border-black/20 flex items-center justify-center hover:brightness-110 active:brightness-90 transition-all">
                  <svg className="w-[6px] h-[6px] opacity-0 group-hover/traffic:opacity-100 transition-opacity" viewBox="0 0 6 6" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" strokeLinecap="round"><line x1="0.5" y1="3" x2="5.5" y2="3"/></svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); onMaximize(); }} className="w-3 h-3 rounded-full bg-mac-green border border-black/10 dark:border-black/20 flex items-center justify-center hover:brightness-110 active:brightness-90 transition-all">
                  {isMax ? (
                    <svg className="w-[6px] h-[6px] opacity-0 group-hover/traffic:opacity-100 transition-opacity" viewBox="0 0 6 6" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.1" strokeLinecap="round"><path d="M1.5 4L3 1.5 4.5 4z"/></svg>
                  ) : (
                    <svg className="w-[6px] h-[6px] opacity-0 group-hover/traffic:opacity-100 transition-opacity" viewBox="0 0 6 6" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.1" strokeLinecap="round"><path d="M0.5 3.5L3 0.5 5.5 3.5 3 5.5z"/></svg>
                  )}
                </button>
              </div>

              {/* Title */}
              <div className="ml-4 flex items-center gap-2 text-slate-500 dark:text-white/50 min-w-0 max-w-full">
                <span className="material-symbols-outlined text-[18px] hidden xs:inline shrink-0">terminal</span>
                <span className="text-xs font-bold uppercase tracking-widest truncate">{win.title}</span>
              </div>
            </div>

          </header>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex flex-col bg-white dark:bg-[#0f1115] transition-colors duration-300">
            {children}
          </div>

          {/* Footer (hidden when maximized) */}
          {!isMax && (
            <footer className="px-4 py-2 border-t border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4 text-[10px] font-medium text-slate-400 dark:text-white/40">
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">shield_lock</span>
                  <span className="hidden xs:inline">{t.encrypted}</span>
                </div>
              </div>
              <div className="text-[10px] text-slate-400 dark:text-white/40 font-mono italic">ClawDeckX OS</div>
            </footer>
          )}
        </div>
      </div>
    </>
  );
};

export default WindowFrame;
