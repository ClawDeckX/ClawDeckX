
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Language } from '../types';
import { availableLanguages } from '../locales';

interface LanguageOption {
  code: Language;
  label: string;
  flag: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'zh', label: '简体中文', flag: '🇨🇳' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'zh-TW', label: '繁體中文', flag: '🇹🇼' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'pt-BR', label: 'Português', flag: '🇧🇷' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
];


interface LanguageSwitcherProps {
  language: Language;
  onChange: (lang: Language) => void;
  variant?: 'topbar' | 'lockscreen';
}

const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ language, onChange, variant = 'topbar' }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
  }, []);

  useEffect(() => {
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, handleClickOutside]);

  const current = LANGUAGES.find(l => l.code === language) || LANGUAGES[0];
  const visibleLanguages = LANGUAGES.filter(l => availableLanguages.has(l.code));

  const handleSelect = (lang: Language) => {
    if (lang !== language) {
      onChange(lang);
    }
    setOpen(false);
  };

  if (variant === 'lockscreen') {
    return (
      <div ref={ref} className="relative">
        <div
          className="flex flex-col items-center gap-2 group cursor-pointer"
          onClick={() => setOpen(p => !p)}
        >
          <div className="w-10 h-10 rounded-full mac-glass flex items-center justify-center text-white opacity-80 group-hover:opacity-100 transition-all">
            <span className="text-[18px]">{current.flag}</span>
          </div>
          <span className="text-white/80 text-[11px] font-medium group-hover:text-white">{current.label}</span>
        </div>

        {open && (
          <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-44 rounded-2xl bg-[#1a1a2e]/95 backdrop-blur-xl border border-white/15 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 z-50">
            <div className="py-1.5">
              {visibleLanguages.map(l => {
                const active = l.code === language;
                return (
                  <button
                    key={l.code}
                    onClick={() => handleSelect(l.code)}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-colors
                      ${active ? 'bg-white/20' : 'hover:bg-white/10'}
                    `}
                  >
                    <span className="text-[15px] leading-none">{l.flag}</span>
                    <span className={`text-[12px] font-medium flex-1 ${active ? 'text-white' : 'text-white/80'}`}>{l.label}</span>
                    {active && <span className="material-symbols-outlined text-[14px] text-white">check</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // topbar variant
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(p => !p)}
        className="flex items-center gap-1 hover:bg-black/10 dark:hover:bg-white/10 px-1.5 md:px-2 rounded-md transition-colors h-6 md:h-5"
      >
        <span className="text-[13px] leading-none">{current.flag}</span>
        <span className="text-[10px] font-black uppercase">{current.label}</span>
        <span className={`material-symbols-outlined text-[12px] transition-transform ${open ? 'rotate-180' : ''}`}>expand_more</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-44 rounded-xl bg-white dark:bg-[#1e1e1e] border border-slate-200 dark:border-white/10 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 z-50">
          <div className="py-1">
            {visibleLanguages.map(l => {
              const active = l.code === language;
              return (
                <button
                  key={l.code}
                  onClick={() => handleSelect(l.code)}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors
                    ${active
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-slate-50 dark:hover:bg-white/5 text-slate-700 dark:text-white/80'}
                  `}
                >
                  <span className="text-[14px] leading-none">{l.flag}</span>
                  <span className="text-[11px] font-medium flex-1">{l.label}</span>
                  {active && <span className="material-symbols-outlined text-[13px]">check</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default LanguageSwitcher;
