import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Option {
    value: string;
    label: string;
}

interface CustomSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: Option[];
    className?: string;
    disabled?: boolean;
    placeholder?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({
    value,
    onChange,
    options,
    className = '',
    disabled = false,
    placeholder,
}) => {
    const [open, setOpen] = useState(false);
    const [hl, setHl] = useState(-1);
    const ref = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const selected = options.find(o => o.value === value);

    // 点击外部关闭
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // 打开时重置高亮到当前选中项
    useEffect(() => {
        if (open) {
            const idx = options.findIndex(o => o.value === value);
            setHl(idx >= 0 ? idx : 0);
        }
    }, [open, options, value]);

    // 滚动高亮项可见
    useEffect(() => {
        if (!open || hl < 0 || !listRef.current) return;
        const el = listRef.current.children[hl] as HTMLElement | undefined;
        el?.scrollIntoView({ block: 'nearest' });
    }, [hl, open]);

    const handleKey = useCallback((e: React.KeyboardEvent) => {
        if (disabled) return;
        if (!open) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
            }
            return;
        }
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHl(h => Math.min(h + 1, options.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHl(h => Math.max(h - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (hl >= 0 && hl < options.length) {
                    onChange(options[hl].value);
                    setOpen(false);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setOpen(false);
                break;
        }
    }, [open, hl, options, onChange, disabled]);

    return (
        <div ref={ref} className={`relative ${className} !bg-transparent !border-none !ring-0 !shadow-none !p-0 !rounded-none`} onKeyDown={handleKey} style={{ border: 'none' }}>
            {/* 触发按钮 */}
            <button
                type="button"
                disabled={disabled}
                onClick={() => !disabled && setOpen(!open)}
                className={`w-full flex items-center justify-between gap-1 text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
                tabIndex={0}
            >
                <span className="truncate flex-1">
                    {selected ? selected.label : (placeholder || '—')}
                </span>
                <span className={`material-symbols-outlined text-[14px] text-slate-400 dark:text-white/40 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}>
                    expand_more
                </span>
            </button>

            {/* 下拉面板 */}
            {open && (
                <div
                    ref={listRef}
                    className="absolute z-[100] right-0 mt-1 max-h-52 overflow-y-auto rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1e2028] shadow-xl shadow-black/10 dark:shadow-black/40 py-1 w-max min-w-full"
                >
                    {options.map((o, idx) => (
                        <button
                            key={o.value}
                            type="button"
                            onMouseEnter={() => setHl(idx)}
                            onClick={() => { onChange(o.value); setOpen(false); }}
                            className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors whitespace-nowrap ${o.value === value
                                ? 'text-primary font-bold bg-primary/5 dark:bg-primary/10'
                                : idx === hl
                                    ? 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-white/80'
                                    : 'text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                                }`}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CustomSelect;
