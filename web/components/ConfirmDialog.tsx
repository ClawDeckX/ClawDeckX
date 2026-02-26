import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { getTranslation } from '../locales';
import { Language } from '../types';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue>({ confirm: () => Promise.resolve(false) });

export const useConfirm = () => useContext(ConfirmContext);

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState<boolean>(false);
  const [options, setOptions] = useState<ConfirmOptions>({ title: '', message: '', danger: false });
  const resolveRef = useRef<((value: boolean) => void) | undefined>(undefined);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setOpen(false);
    resolveRef.current?.(true);
  }, []);

  const handleCancel = useCallback(() => {
    setOpen(false);
    resolveRef.current?.(false);
  }, []);

  const lang = (localStorage.getItem('lang') as Language) || 'zh';
  const t = getTranslation(lang) as any;

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleCancel} />
          <div className="relative mac-glass rounded-2xl shadow-2xl overflow-hidden animate-scale-in w-[320px] backdrop-blur-3xl">
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
                <span className={`material-symbols-outlined text-[28px] ${options.danger ? 'text-mac-red' : 'text-primary'}`}>
                  {options.danger ? 'warning' : 'info'}
                </span>
              </div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white mb-2">{options.title}</h3>
              <p className="text-[13px] text-slate-600 dark:text-white/70 leading-relaxed">
                {options.message}
              </p>
            </div>
            <div className="flex border-t border-slate-200/20 dark:border-white/10">
              <button
                onClick={handleCancel}
                className="flex-1 py-3.5 text-[13px] font-medium text-slate-600 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 transition-colors border-r border-slate-200/20 dark:border-white/10"
              >
                {options.cancelText || t.cancel}
              </button>
              <button
                onClick={handleConfirm}
                className={`flex-1 py-3.5 text-[13px] font-bold transition-colors ${options.danger
                    ? 'text-mac-red hover:bg-mac-red/10'
                    : 'text-primary hover:bg-primary/10'
                  }`}
              >
                {options.confirmText || t.ok}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};
