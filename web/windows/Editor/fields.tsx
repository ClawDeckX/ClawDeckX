import React, { useState, useCallback, useRef, useEffect } from 'react';
import CustomSelect from '../../components/CustomSelect';

// ============================================================================
// 通用样式常量
// ============================================================================
const inputBase = 'h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[11px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600';
const labelBase = 'text-[10px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none';
const descBase = 'text-[11px] md:text-[10px] text-slate-400 dark:text-slate-500 mt-0.5';

// ============================================================================
// Tooltip — 悬停/点击提示气泡
// ============================================================================
export const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [show]);

  return (
    <div ref={ref} className="relative inline-flex items-center"
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      onClick={() => setShow(s => !s)}
    >
      {children}
      {show && (
        <div className="absolute z-50 bottom-full left-0 mb-1.5 px-3 py-2 bg-slate-800 dark:bg-slate-700 text-white text-[10px] md:text-[11px] leading-relaxed rounded-lg shadow-lg max-w-[260px] w-max pointer-events-none whitespace-pre-line">
          {text}
          <div className="absolute top-full left-3 border-4 border-transparent border-t-slate-800 dark:border-t-slate-700" />
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ConfigField — 通用字段行容器
// ============================================================================
interface ConfigFieldProps {
  label: string;
  desc?: string;
  tooltip?: string;
  error?: string;
  children: React.ReactNode;
  inline?: boolean;
}

export const ConfigField: React.FC<ConfigFieldProps> = ({ label, desc, tooltip, error, children, inline = true }) => (
  <div className={inline ? 'flex flex-col sm:grid sm:grid-cols-3 sm:items-start gap-1 sm:gap-3 py-1.5' : 'flex flex-col gap-1 py-1.5'}>
    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <label className={labelBase}>{label}</label>
        {tooltip && (
          <Tooltip text={tooltip}>
            <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-slate-500 cursor-help hover:text-primary transition-colors">info</span>
          </Tooltip>
        )}
      </div>
      {desc && <span className={descBase}>{desc}</span>}
    </div>
    <div className={inline ? 'sm:col-span-2 flex flex-col gap-1' : 'flex flex-col gap-1'}>
      {children}
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  </div>
);

// ============================================================================
// TextField
// ============================================================================
interface TextFieldProps {
  label: string;
  desc?: string;
  tooltip?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  mono?: boolean;
  multiline?: boolean;
}

export const TextField: React.FC<TextFieldProps> = ({ label, desc, tooltip, value, onChange, placeholder, error, mono = true, multiline }) => (
  <ConfigField label={label} desc={desc} tooltip={tooltip} error={error}>
    {multiline ? (
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className={`${inputBase} h-auto py-2 resize-y ${mono ? 'font-mono' : 'font-sans'}`}
      />
    ) : (
      <input
        type="text"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputBase} ${mono ? 'font-mono' : 'font-sans'}`}
      />
    )}
  </ConfigField>
);

// ============================================================================
// NumberField
// ============================================================================
interface NumberFieldProps {
  label: string;
  desc?: string;
  tooltip?: string;
  value: number | undefined | null;
  onChange: (v: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  error?: string;
}

export const NumberField: React.FC<NumberFieldProps> = ({ label, desc, tooltip, value, onChange, min, max, step, placeholder, error }) => (
  <ConfigField label={label} desc={desc} tooltip={tooltip} error={error}>
    <input
      type="number"
      value={value ?? ''}
      onChange={e => {
        const v = e.target.value;
        onChange(v === '' ? undefined : Number(v));
      }}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      className={`${inputBase} w-full sm:w-32`}
    />
  </ConfigField>
);

// ============================================================================
// SelectField
// ============================================================================
interface SelectFieldProps {
  label: string;
  desc?: string;
  tooltip?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  allowEmpty?: boolean;
}

export const SelectField: React.FC<SelectFieldProps> = ({ label, desc, tooltip, value, onChange, options, error, allowEmpty }) => {
  const allOptions = allowEmpty ? [{ value: '', label: '—' }, ...options] : options;
  return (
    <ConfigField label={label} desc={desc} tooltip={tooltip} error={error}>
      <CustomSelect
        value={value || ''}
        onChange={onChange}
        options={allOptions}
        className={`${inputBase} w-full sm:w-48`}
      />
    </ConfigField>
  );
};

// ============================================================================
// SwitchField
// ============================================================================
interface SwitchFieldProps {
  label: string;
  desc?: string;
  tooltip?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export const SwitchField: React.FC<SwitchFieldProps> = ({ label, desc, tooltip, value, onChange }) => (
  <ConfigField label={label} desc={desc} tooltip={tooltip}>
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${value ? 'bg-primary' : 'bg-slate-300 dark:bg-slate-600'}`}
    >
      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  </ConfigField>
);

// ============================================================================
// PasswordField
// ============================================================================
interface PasswordFieldProps {
  label: string;
  desc?: string;
  tooltip?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
}

export const PasswordField: React.FC<PasswordFieldProps> = ({ label, desc, tooltip, value, onChange, placeholder, error }) => {
  const [show, setShow] = useState(false);
  return (
    <ConfigField label={label} desc={desc} tooltip={tooltip} error={error}>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputBase} w-full pr-8 font-mono`}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <span className="material-symbols-outlined text-[14px]">{show ? 'visibility_off' : 'visibility'}</span>
        </button>
      </div>
    </ConfigField>
  );
};

// ============================================================================
// ArrayField — 字符串数组编辑（tag 输入）
// ============================================================================
interface ArrayFieldProps {
  label: string;
  desc?: string;
  tooltip?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}

export const ArrayField: React.FC<ArrayFieldProps> = ({ label, desc, tooltip, value, onChange, placeholder }) => {
  const [input, setInput] = useState('');
  const items = Array.isArray(value) ? value : [];

  const add = useCallback(() => {
    const v = input.trim();
    if (v && !items.includes(v)) {
      onChange([...items, v]);
      setInput('');
    }
  }, [input, items, onChange]);

  return (
    <ConfigField label={label} desc={desc} tooltip={tooltip} inline={false}>
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {items.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary text-[10px] md:text-[11px] rounded-md font-mono">
            {item}
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="hover:text-red-500 transition-colors">
              <span className="material-symbols-outlined text-[12px]">close</span>
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder || 'Enter to add...'}
          className={`${inputBase} flex-1`}
        />
        <button onClick={add} className="h-8 px-2.5 bg-primary/10 text-primary text-[10px] font-bold rounded-md hover:bg-primary/20 transition-colors">+</button>
      </div>
    </ConfigField>
  );
};

// ============================================================================
// DiscordGuildField — Discord 服务器配置（对象格式，支持链接自动提取）
// OpenClaw expects: guilds: Record<string, DiscordGuildEntry>
// ============================================================================
interface DiscordGuildFieldProps {
  label: string;
  desc?: string;
  tooltip?: string;
  value: Record<string, any>;  // { "guildId": { ...config }, ... }
  onChange: (v: Record<string, any>) => void;
  placeholder?: string;
  linkHint?: string;
}

// Extract guild ID from Discord URL: https://discord.com/channels/{guildId}/{channelId}
function extractDiscordGuildId(input: string): string {
  const trimmed = input.trim();
  // Match Discord channel URL pattern
  const match = trimmed.match(/discord\.com\/channels\/(\d+)(?:\/\d+)?/);
  if (match) {
    return match[1];
  }
  // If it's already a numeric ID, return as-is
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed;
}

export const DiscordGuildField: React.FC<DiscordGuildFieldProps> = ({ label, desc, tooltip, value, onChange, placeholder, linkHint }) => {
  const [input, setInput] = useState('');
  const [extracted, setExtracted] = useState<string | null>(null);
  
  // Convert object to array of guild IDs for display
  const guildsObj = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const guildIds = Object.keys(guildsObj);

  // Auto-extract guild ID when input changes
  useEffect(() => {
    if (input.includes('discord.com/channels/')) {
      const guildId = extractDiscordGuildId(input);
      if (guildId && guildId !== input.trim()) {
        setExtracted(guildId);
      } else {
        setExtracted(null);
      }
    } else {
      setExtracted(null);
    }
  }, [input]);

  const add = useCallback(() => {
    const v = extracted || input.trim();
    if (v && !guildIds.includes(v)) {
      // Add guild as object entry with empty config (OpenClaw format)
      onChange({ ...guildsObj, [v]: {} });
      setInput('');
      setExtracted(null);
    }
  }, [input, extracted, guildIds, guildsObj, onChange]);

  const remove = useCallback((guildId: string) => {
    const newObj = { ...guildsObj };
    delete newObj[guildId];
    onChange(newObj);
  }, [guildsObj, onChange]);

  return (
    <ConfigField label={label} desc={desc} tooltip={tooltip} inline={false}>
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {guildIds.map((guildId) => (
          <span key={guildId} className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary text-[10px] md:text-[11px] rounded-md font-mono">
            {guildId}
            <button onClick={() => remove(guildId)} className="hover:text-red-500 transition-colors">
              <span className="material-symbols-outlined text-[12px]">close</span>
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        <div className="flex-1 relative">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={placeholder || 'Enter to add...'}
            className={`${inputBase} w-full ${extracted ? 'pr-24' : ''}`}
          />
          {extracted && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-green-600 dark:text-green-400 font-mono bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded">
              → {extracted}
            </span>
          )}
        </div>
        <button onClick={add} className="h-8 px-2.5 bg-primary/10 text-primary text-[10px] font-bold rounded-md hover:bg-primary/20 transition-colors">+</button>
      </div>
      {linkHint && (
        <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1">{linkHint}</p>
      )}
    </ConfigField>
  );
};

// ============================================================================
// KeyValueField — key-value 对编辑
// ============================================================================
interface KeyValueFieldProps {
  label: string;
  desc?: string;
  tooltip?: string;
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export const KeyValueField: React.FC<KeyValueFieldProps> = ({ label, desc, tooltip, value, onChange, keyPlaceholder, valuePlaceholder }) => {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const entries = Object.entries(value || {});

  const add = useCallback(() => {
    const k = newKey.trim();
    if (k) {
      onChange({ ...(value || {}), [k]: newVal });
      setNewKey('');
      setNewVal('');
    }
  }, [newKey, newVal, value, onChange]);

  return (
    <ConfigField label={label} desc={desc} tooltip={tooltip} inline={false}>
      {entries.length > 0 && (
        <div className="space-y-1">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-primary bg-primary/10 px-2 py-1 rounded min-w-[60px]">{k}</span>
              <input
                type="text"
                value={v}
                onChange={e => onChange({ ...value, [k]: e.target.value })}
                className={`${inputBase} flex-1`}
              />
              <button onClick={() => { const next = { ...value }; delete next[k]; onChange(next); }} className="text-slate-400 hover:text-red-500">
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-1.5 mt-1">
        <input type="text" value={newKey} onChange={e => setNewKey(e.target.value)} placeholder={keyPlaceholder || 'Key'} className={`${inputBase} w-28`} />
        <input type="text" value={newVal} onChange={e => setNewVal(e.target.value)} placeholder={valuePlaceholder || 'Value'} className={`${inputBase} flex-1`}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button onClick={add} className="h-8 px-2.5 bg-primary/10 text-primary text-[10px] font-bold rounded-md hover:bg-primary/20 transition-colors">+</button>
      </div>
    </ConfigField>
  );
};

// ============================================================================
// ConfigSection — 配置区块容器
// ============================================================================
interface ConfigSectionProps {
  title: string;
  icon: string;
  iconColor?: string;
  desc?: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
}

export const ConfigSection: React.FC<ConfigSectionProps> = ({ title, icon, iconColor = 'text-primary', desc, children, collapsible = true, defaultOpen = true, actions }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/[0.06] rounded-xl transition-colors ${open ? 'overflow-visible' : 'overflow-hidden'}`}>
      <div
        className={`flex items-center gap-2.5 px-4 py-2.5 ${collapsible ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-white/[0.03]' : ''} transition-colors`}
        onClick={() => collapsible && setOpen(!open)}
      >
        <span className={`material-symbols-outlined text-[18px] ${iconColor}`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs md:text-sm font-bold text-slate-800 dark:text-white truncate">{title}</h3>
          {desc && <p className="text-[11px] md:text-[10px] text-slate-400 dark:text-slate-500 truncate">{desc}</p>}
        </div>
        {actions && <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>{actions}</div>}
        {collapsible && (
          <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>expand_more</span>
        )}
      </div>
      {open && <div className="px-4 pb-3 border-t border-slate-100 dark:border-white/[0.04]">{children}</div>}
    </div>
  );
};

// ============================================================================
// ConfigCard — 子卡片（如单个服务商、单个频道）
// ============================================================================
interface ConfigCardProps {
  title: string;
  icon?: string;
  children: React.ReactNode;
  onDelete?: () => void;
  actions?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export const ConfigCard: React.FC<ConfigCardProps> = ({ title, icon, children, onDelete, actions, collapsible = true, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-slate-200 dark:border-white/[0.06] rounded-lg overflow-hidden bg-white dark:bg-white/[0.01] mt-2">
      <div
        className={`flex items-center gap-2 px-3 py-2 bg-slate-50 dark:bg-white/[0.02] ${collapsible ? 'cursor-pointer' : ''}`}
        onClick={() => collapsible && setOpen(!open)}
      >
        {icon && <span className="material-symbols-outlined text-[16px] text-slate-500">{icon}</span>}
        <span className="text-[11px] md:text-xs font-bold text-slate-700 dark:text-slate-300 flex-1 truncate">{title}</span>
        {actions && <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>{actions}</div>}
        {onDelete && (
          <button onClick={e => { e.stopPropagation(); onDelete(); }} className="text-slate-400 hover:text-red-500 transition-colors">
            <span className="material-symbols-outlined text-[14px]">delete</span>
          </button>
        )}
        {collapsible && (
          <span className={`material-symbols-outlined text-[14px] text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>expand_more</span>
        )}
      </div>
      {(!collapsible || open) && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
};

// ============================================================================
// AddButton — 添加按钮
// ============================================================================
interface AddButtonProps {
  label: string;
  onClick: () => void;
}

export const AddButton: React.FC<AddButtonProps> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    className="mt-2 w-full h-8 border border-dashed border-slate-300 dark:border-white/10 rounded-lg text-[10px] md:text-[11px] font-bold text-slate-400 dark:text-slate-500 hover:text-primary hover:border-primary dark:hover:text-primary dark:hover:border-primary transition-colors flex items-center justify-center gap-1"
  >
    <span className="material-symbols-outlined text-[14px]">add</span>
    {label}
  </button>
);

// ============================================================================
// EmptyState — 空状态
// ============================================================================
interface EmptyStateProps {
  message: string;
  icon?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ message, icon = 'inbox' }) => (
  <div className="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-slate-500">
    <span className="material-symbols-outlined text-[32px] mb-2">{icon}</span>
    <span className="text-[11px]">{message}</span>
  </div>
);
