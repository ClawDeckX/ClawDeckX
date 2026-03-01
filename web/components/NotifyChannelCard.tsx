import React, { useState } from 'react';
import { notifyApi } from '../services/api';
import CustomSelect from './CustomSelect';

export interface NotifyFieldDef {
  key: string;
  label: string;
  hint?: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'textarea' | 'select';
  options?: { value: string; label: string }[];
  /** If true, render this field in a half-width grid column */
  half?: boolean;
}

export interface NotifyChannelDef {
  id: string;
  icon: string;
  iconColor: string;
  title: string;
  fields: NotifyFieldDef[];
}

interface NotifyChannelCardProps {
  channel: NotifyChannelDef;
  config: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  testLabel: string;
  testingLabel?: string;
  inputClassName: string;
  labelClassName: string;
  rowClassName: string;
}

const NotifyChannelCard: React.FC<NotifyChannelCardProps> = ({
  channel,
  config,
  onFieldChange,
  testLabel,
  testingLabel,
  inputClassName,
  labelClassName,
  rowClassName,
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await notifyApi.testSend('', channel.id);
      setTestResult('ok');
    } catch {
      setTestResult('fail');
    }
    setTesting(false);
    setTimeout(() => setTestResult(null), 3000);
  };

  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  const togglePasswordVisibility = (key: string) => {
    setVisiblePasswords(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderField = (field: NotifyFieldDef) => {
    const value = config[field.key] || '';

    if (field.type === 'textarea') {
      return (
        <div key={field.key}>
          <label className={labelClassName}>{field.label}</label>
          <textarea
            value={value}
            onChange={e => onFieldChange(field.key, e.target.value)}
            className={`${inputClassName} h-20 py-2 resize-none font-mono text-[11px]`}
            placeholder={field.placeholder}
          />
          {field.hint && <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{field.hint}</p>}
        </div>
      );
    }

    if (field.type === 'select' && field.options) {
      return (
        <div key={field.key}>
          <label className={labelClassName}>{field.label}</label>
          <CustomSelect
            value={value || field.options[0]?.value || ''}
            onChange={v => onFieldChange(field.key, v)}
            options={field.options}
            className={inputClassName}
          />
        </div>
      );
    }

    const isPassword = field.type === 'password';
    const isVisible = visiblePasswords[field.key];

    return (
      <div key={field.key}>
        <label className={labelClassName}>{field.label}</label>
        <div className="relative">
          <input
            type={isPassword && !isVisible ? 'password' : 'text'}
            value={value}
            onChange={e => onFieldChange(field.key, e.target.value)}
            className={inputClassName}
            placeholder={field.placeholder}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => togglePasswordVisibility(field.key)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white/60 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">
                {isVisible ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          )}
        </div>
        {field.hint && <p className="text-[10px] text-slate-400 dark:text-white/20 mt-1">{field.hint}</p>}
      </div>
    );
  };

  // Group fields: half-width fields go into a grid row, others are full-width
  const renderFields = () => {
    const elements: React.ReactNode[] = [];
    let i = 0;
    while (i < channel.fields.length) {
      const field = channel.fields[i];
      if (field.half && i + 1 < channel.fields.length && channel.fields[i + 1].half) {
        elements.push(
          <div key={`grid-${field.key}`} className="grid grid-cols-2 gap-3">
            {renderField(field)}
            {renderField(channel.fields[i + 1])}
          </div>
        );
        i += 2;
      } else {
        elements.push(renderField(field));
        i++;
      }
    }
    return elements;
  };

  return (
    <div className={rowClassName}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className={`material-symbols-outlined text-[16px] ${channel.iconColor}`}>{channel.icon}</span>
            <p className="text-[13px] font-semibold text-slate-700 dark:text-white/80">{channel.title}</p>
          </div>
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-[10px] font-bold text-slate-500 dark:text-white/50 disabled:opacity-40 transition-colors"
          >
            <span className={`material-symbols-outlined text-[12px] ${testing ? 'animate-spin' : ''}`}>
              {testing ? 'progress_activity' : testResult === 'ok' ? 'check_circle' : testResult === 'fail' ? 'error' : 'send'}
            </span>
            <span className={testResult === 'ok' ? 'text-emerald-500' : testResult === 'fail' ? 'text-red-500' : ''}>
              {testing ? (testingLabel || testLabel) : testResult === 'ok' ? '✓' : testResult === 'fail' ? '✗' : testLabel}
            </span>
          </button>
        </div>
        <div className="space-y-3">
          {renderFields()}
        </div>
      </div>
    </div>
  );
};

export default NotifyChannelCard;
