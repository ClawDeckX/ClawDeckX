import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Language } from '../../../types';
import { getTranslation } from '../../../locales';

interface JsonEditorSectionProps {
  config: Record<string, any>;
  toJSON: () => string;
  fromJSON: (json: string) => boolean;
  language: Language;
}

export const JsonEditorSection: React.FC<JsonEditorSectionProps> = ({ config, toJSON, fromJSON, language }) => {
  const ed = useMemo(() => (getTranslation(language) as any).cfgEditor || {}, [language]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [lineCount, setLineCount] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 同步配置到文本
  useEffect(() => {
    const json = toJSON();
    setText(json);
    setLineCount(json.split('\n').length);
    setError('');
  }, [config, toJSON]);

  const handleChange = useCallback((value: string) => {
    setText(value);
    setLineCount(value.split('\n').length);
    try {
      JSON.parse(value);
      setError('');
    } catch (e: any) {
      setError(e.message || ed.invalidJson);
    }
  }, []);

  const handleApply = useCallback(() => {
    const ok = fromJSON(text);
    if (!ok) {
      setError(ed.parseJsonFailed);
    } else {
      setError('');
    }
  }, [text, fromJSON]);

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(text);
      const formatted = JSON.stringify(parsed, null, 2);
      setText(formatted);
      setLineCount(formatted.split('\n').length);
      setError('');
    } catch (e: any) {
      setError(e.message || ed.invalidJson);
    }
  }, [text, ed]);

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-2">
        <button onClick={handleApply} disabled={!!error} className="px-3 h-7 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">check</span>
          {ed.apply}
        </button>
        <button onClick={handleFormat} className="px-3 h-7 bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-400 text-[10px] font-bold rounded-lg hover:bg-slate-300 dark:hover:bg-white/15 flex items-center gap-1">
          <span className="material-symbols-outlined text-[14px]">format_align_left</span>
          {ed.format}
        </button>
        <span className="flex-1" />
        {error ? (
          <span className="text-[10px] text-red-400 flex items-center gap-1 truncate max-w-[300px]">
            <span className="material-symbols-outlined text-[12px]">error</span>
            {error}
          </span>
        ) : (
          <span className="text-[10px] text-mac-green flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">check_circle</span>
            {ed.validJson}
          </span>
        )}
        <span className="text-[10px] text-slate-400 font-mono">{lineCount} {ed.lines}</span>
      </div>

      {/* 编辑器 */}
      <div className="border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden bg-[#fafafa] dark:bg-[#141418]">
        <div className="flex overflow-hidden" style={{ maxHeight: 'calc(100vh - 280px)' }}>
          {/* 行号 */}
          <div className="w-10 md:w-12 bg-slate-100 dark:bg-[#1a1a1e] border-r border-slate-200 dark:border-white/5 py-3 px-1 text-right select-none overflow-hidden shrink-0">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="text-[10px] md:text-[11px] leading-[1.65] text-slate-300 dark:text-white/15 font-mono">{i + 1}</div>
            ))}
          </div>
          {/* 文本区域 */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => handleChange(e.target.value)}
            spellCheck={false}
            className="flex-1 p-3 bg-transparent text-[11px] md:text-[12px] leading-[1.65] font-mono text-slate-800 dark:text-[#d4d4d4] outline-none resize-none overflow-auto custom-scrollbar"
            style={{ minHeight: '400px', tabSize: 2 }}
          />
        </div>
      </div>
    </div>
  );
};
