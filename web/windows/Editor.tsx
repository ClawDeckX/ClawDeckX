
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { configApi, gwApi } from '../services/api';

interface EditorProps {
  language: Language;
}

const Editor: React.FC<EditorProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const edit = t.edit as any;
  const [tab, setTab] = useState<'models' | 'json'>('models');
  const [showAddModal, setShowAddModal] = useState<'provider' | 'model' | null>(null);
  const [jsonContent, setJsonContent] = useState('');
  const [jsonValid, setJsonValid] = useState(true);

  useEffect(() => {
    // 优先走 WebSocket 获取配置（本地/远程统一），失败降级读本地文件
    gwApi.configGet().then((data: any) => {
      const cfg = data?.config || data?.parsed || data;
      setJsonContent(typeof cfg === 'string' ? cfg : JSON.stringify(cfg, null, 2));
    }).catch(() => {
      configApi.get().then((data: any) => {
        const content = typeof data === 'string' ? data : (data?.content || JSON.stringify(data?.config || data, null, 2));
        setJsonContent(content);
      }).catch(() => {});
    });
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const parsed = JSON.parse(jsonContent);
      // 优先走 WebSocket 保存，失败降级本地写入
      try {
        await gwApi.configSetAll(parsed);
        await gwApi.configReload().catch(() => {});
      } catch {
        await configApi.update(parsed);
        await gwApi.configReload().catch(() => {});
      }
    } catch {}
  }, [jsonContent]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#1a1c20] relative">
      <header className="h-12 border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/5 flex items-center justify-between px-3 md:px-4 shrink-0 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-3 md:gap-4">
          <div className="flex bg-slate-200 dark:bg-black/20 p-0.5 rounded-lg border border-slate-300 dark:border-white/5 shrink-0">
            <button onClick={() => setTab('models')} aria-pressed={tab === 'models'} className={`px-3 md:px-4 py-1 rounded-md text-[10px] md:text-[11px] font-bold transition-all ${tab === 'models' ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700'}`}>{edit.modelMgmt}</button>
            <button onClick={() => setTab('json')} aria-pressed={tab === 'json'} className={`px-3 md:px-4 py-1 rounded-md text-[10px] md:text-[11px] font-bold transition-all ${tab === 'json' ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700'}`}>{edit.jsonEdit}</button>
          </div>
          <span className="hidden sm:inline text-[11px] font-mono text-slate-400">openclaw.json</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={handleSave} className="px-3 md:px-4 h-7 bg-primary text-white text-[10px] md:text-[11px] font-bold rounded-lg shadow-lg shadow-primary/20">{edit.saveReload}</button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col">
        {tab === 'models' ? (
          <div className="flex-1 p-4 md:p-8 overflow-y-auto custom-scrollbar">
            <div className="max-w-2xl mx-auto space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-2">
              <section>
                <div className="flex items-center justify-between mb-3 md:mb-4">
                  <div className="flex items-center gap-2 text-slate-800 dark:text-white">
                    <span className="material-symbols-outlined text-primary text-[20px]">psychology</span>
                    <h3 className="text-xs md:text-sm font-bold">{edit.coreConfig}</h3>
                  </div>
                  <button onClick={() => setShowAddModal('provider')} className="text-[11px] md:text-[10px] font-bold text-primary hover:underline">+ {(t as any).menu?.addProvider}</button>
                </div>
                <div className="bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl p-4">
                  <div className="space-y-4">
                    <div className="flex flex-col sm:grid sm:grid-cols-3 sm:items-center gap-1.5 sm:gap-4">
                      <label className="text-[10px] md:text-xs font-bold text-slate-500">{edit.mainModel}</label>
                      <input className="sm:col-span-2 h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[11px] md:text-xs text-primary font-mono" defaultValue="gemini-3-flash-preview" />
                    </div>
                    <div className="flex flex-col sm:grid sm:grid-cols-3 sm:items-center gap-1.5 sm:gap-4">
                      <label className="text-[10px] md:text-xs font-bold text-slate-500">{edit.maxConcurrency}</label>
                      <input type="number" className="sm:col-span-2 h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[11px] md:text-xs" defaultValue="16" />
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between mb-3 md:mb-4">
                   <div className="flex items-center gap-2 text-slate-800 dark:text-white">
                    <span className="material-symbols-outlined text-purple-500 text-[20px]">hub</span>
                    <h3 className="text-xs md:text-sm font-bold">{edit.agentCluster}</h3>
                  </div>
                   <button onClick={() => setShowAddModal('model')} className="text-[11px] md:text-[10px] font-bold text-primary hover:underline">+ {(t as any).menu?.addModel}</button>
                </div>
                <div className="bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl p-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-500">{edit.autoDiscovery}</label>
                      <div className="w-8 h-4 bg-primary rounded-full relative">
                        <div className="absolute right-0.5 top-0.5 w-3 h-3 bg-white rounded-full"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        ) : (
          <div className="flex-1 bg-[#141414] font-mono text-[11px] md:text-[13px] flex overflow-hidden">
            <div className="w-8 md:w-12 border-r border-white/5 bg-[#1a1a1a] flex flex-col items-center py-4 text-white/20 select-none">
              {[...Array(30)].map((_, i) => <span key={i} className="leading-[1.6]">{i + 1}</span>)}
            </div>
            <div className="flex-1 p-2 md:p-4 overflow-y-auto custom-scrollbar text-[#9cdcfe]">
               <div className="leading-[1.6]">
                <div><span className="text-white">{"{"}</span></div>
                <div className="pl-4">
                  <span className="text-[#9cdcfe]">"mcpServers"</span>: <span className="text-white">{"{"}</span>
                </div>
                <div className="pl-8">
                  <span className="text-[#9cdcfe]">"fetch"</span>: <span className="text-white">{"{"}</span>
                </div>
                <div className="pl-12">
                   <span className="text-[#9cdcfe]">"command"</span>: <span className="text-[#ce9178]">"uvx"</span>
                </div>
                <div className="pl-8"><span className="text-white">{"}"}</span></div>
                <div><span className="text-white">{"}"}</span></div>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className="h-7 md:h-8 border-t border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#1e1e1e] flex items-center px-4 text-[11px] md:text-[10px] text-slate-400 font-mono">
        <span className="mr-4 hidden xs:inline">{edit.ln} 12, {edit.col} 8</span>
        <span>UTF-8</span>
        <span className="ml-auto flex items-center gap-1 text-mac-green">
          <span className="material-symbols-outlined text-[10px]">check_circle</span>
          <span className="hidden xs:inline">{edit.validJson}</span>
        </span>
      </footer>
    </div>
  );
};

export default Editor;
