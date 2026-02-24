import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  leaving: boolean;
  duration: number;
  createdAt: number;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

const ICON_MAP: Record<ToastType, string> = {
  success: 'check_circle',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

const ACCENT_MAP: Record<ToastType, { icon: string; bar: string }> = {
  success: { icon: 'text-mac-green', bar: 'bg-mac-green' },
  error: { icon: 'text-mac-red', bar: 'bg-mac-red' },
  warning: { icon: 'text-mac-yellow', bar: 'bg-mac-yellow' },
  info: { icon: 'text-primary', bar: 'bg-primary' },
};

const MacToast: React.FC<{ item: ToastItem; onDismiss: (id: number) => void }> = ({ item, onDismiss }) => {
  const accent = ACCENT_MAP[item.type];
  const [progress, setProgress] = useState(100);
  const [hovered, setHovered] = useState(false);
  const startRef = useRef(item.createdAt);
  const remainRef = useRef(item.duration);

  useEffect(() => {
    if (hovered) return;
    startRef.current = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const pct = Math.max(0, ((remainRef.current - elapsed) / item.duration) * 100);
      setProgress(pct);
      if (pct <= 0) { onDismiss(item.id); return; }
      raf = requestAnimationFrame(tick);
    };
    let raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hovered, item.id, item.duration, onDismiss]);

  useEffect(() => {
    if (hovered) {
      const elapsed = Date.now() - startRef.current;
      remainRef.current = Math.max(remainRef.current - elapsed, 800);
    }
  }, [hovered]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`pointer-events-auto relative overflow-hidden
        w-[min(380px,calc(100vw-2rem))] sm:w-[380px]
        rounded-2xl
        bg-white/80 dark:bg-[#2a2a2e]/85
        backdrop-blur-2xl backdrop-saturate-150
        border border-white/40 dark:border-white/[0.08]
        shadow-[0_8px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]
        dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)]
        transition-all duration-300 ease-out
        ${item.leaving ? 'animate-mac-toast-out' : 'animate-mac-toast-in'}
      `}
    >
      {/* Content */}
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Icon */}
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${accent.icon} bg-current/10`}>
          <span className={`material-symbols-outlined text-[18px] ${accent.icon}`}>{ICON_MAP[item.type]}</span>
        </div>
        {/* Text */}
        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-[13px] font-medium text-slate-800 dark:text-white/90 leading-snug break-words">
            {item.message}
          </p>
        </div>
        {/* Close */}
        <button
          onClick={() => onDismiss(item.id)}
          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5
            opacity-0 group-hover:opacity-100 hover:!opacity-100
            bg-slate-200/60 dark:bg-white/10 hover:bg-slate-300/80 dark:hover:bg-white/20
            transition-all duration-200"
          style={{ opacity: hovered ? 1 : 0 }}
        >
          <span className="material-symbols-outlined text-[12px] text-slate-500 dark:text-white/50">close</span>
        </button>
      </div>
      {/* Progress bar */}
      <div className="h-[2px] w-full bg-slate-100/50 dark:bg-white/[0.04]">
        <div
          className={`h-full ${accent.bar} transition-none rounded-full opacity-60`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((type: ToastType, message: string, duration = 4000) => {
    const id = ++idRef.current;
    setToasts(prev => {
      const next = [...prev, { id, type, message, leaving: false, duration, createdAt: Date.now() }];
      return next.length > 5 ? next.slice(-5) : next;
    });
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, leaving: true } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 280);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* macOS-style notification container — top center */}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none
        sm:top-4 max-sm:left-0 max-sm:right-0 max-sm:translate-x-0 max-sm:px-4 max-sm:items-stretch">
        {toasts.map(t => (
          <MacToast key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
