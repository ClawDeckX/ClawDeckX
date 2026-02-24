
import React, { useState, useMemo, useEffect } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi } from '../services/api';

interface ConfigMgmtProps {
  language: Language;
}

const ConfigMgmt: React.FC<ConfigMgmtProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const cfg = t.cfg as any;
  const [tab, setTab] = useState<'providers' | 'models' | 'advanced'>('providers');
  const [configData, setConfigData] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);

  useEffect(() => {
    gwApi.configGet().then(setConfigData).catch(() => {});
    gwApi.models().then((data: any) => {
      setModels(Array.isArray(data) ? data : (data?.list || []));
    }).catch(() => {});
  }, []);

  const providers = [
    { name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com', icon: 'cloud', color: 'bg-blue-500/10 text-blue-500', isDefault: true },
    { name: 'OpenAI', url: 'https://api.openai.com/v1', icon: 'bolt', color: 'bg-emerald-500/10 text-emerald-500', isDefault: false },
    { name: 'Anthropic', url: 'https://api.anthropic.com', icon: 'psychology', color: 'bg-orange-500/10 text-orange-500', isDefault: false },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#1a1c20]">
      <header className="h-14 flex items-center justify-center border-b border-slate-200 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 shrink-0">
        <div className="flex bg-slate-200 dark:bg-black/20 p-1 rounded-xl border border-slate-300 dark:border-white/10">
          <button onClick={() => setTab('providers')} className={`px-6 py-1.5 rounded-lg text-[11px] font-bold transition-all ${tab === 'providers' ? 'bg-white dark:bg-primary shadow text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700'}`}>{cfg.providers}</button>
          <button onClick={() => setTab('models')} className={`px-6 py-1.5 rounded-lg text-[11px] font-bold transition-all ${tab === 'models' ? 'bg-white dark:bg-primary shadow text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700'}`}>{cfg.models}</button>
          <button onClick={() => setTab('advanced')} className={`px-6 py-1.5 rounded-lg text-[11px] font-bold transition-all ${tab === 'advanced' ? 'bg-white dark:bg-primary shadow text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700'}`}>{cfg.advanced}</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        <div className="max-w-3xl mx-auto animate-in fade-in duration-300">
          {tab === 'providers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold opacity-60 uppercase tracking-widest">{cfg.providers}</h3>
                <button className="flex items-center gap-1 text-[11px] font-bold text-primary">
                  <span className="material-symbols-outlined text-sm">add</span> {cfg.addCustom}
                </button>
              </div>

              {providers.map(provider => (
                <div key={provider.name} className="bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 rounded-2xl p-4 flex items-center gap-4 group">
                   <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-inner ${provider.color}`}>
                    <span className="material-symbols-outlined text-[24px]">{provider.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold truncate">{provider.name}</h4>
                      {provider.isDefault && <span className="px-1.5 py-0.5 rounded text-[11px] font-bold bg-primary/20 text-primary uppercase tracking-tighter">Default</span>}
                    </div>
                    <p className="text-[10px] text-slate-400 font-mono truncate opacity-60">{provider.url}</p>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1.5 text-slate-400 hover:text-primary transition-colors"><span className="material-symbols-outlined text-lg">edit</span></button>
                    <button className="p-1.5 text-slate-400 hover:text-mac-red transition-colors"><span className="material-symbols-outlined text-lg">delete</span></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'models' && (
            <div className="space-y-4">
               <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold opacity-60 uppercase tracking-widest">{cfg.models}</h3>
                <button className="flex items-center gap-1 text-[11px] font-bold text-primary">
                  <span className="material-symbols-outlined text-sm">add</span> {cfg.addCustom}
                </button>
              </div>
              <div className="overflow-hidden border border-slate-200 dark:border-white/5 rounded-xl shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 dark:bg-white/5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">{cfg.modelId}</th>
                      <th className="px-4 py-3">{cfg.context}</th>
                      <th className="px-4 py-3 text-right">{cfg.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {[
                      /* Fixed: Use gemini-3-flash-preview instead of gemini-3-flash */
                      { id: 'gemini-3-flash-preview', ctx: '1M' },
                      { id: 'gpt-4o', ctx: '128K' },
                      { id: 'claude-3-5-sonnet', ctx: '200K' }
                    ].map(m => (
                      <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                        <td className="px-4 py-3 text-xs font-mono font-medium text-primary">{m.id}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-white/40">{m.ctx}</td>
                        <td className="px-4 py-3 text-right">
                          <button className="text-[10px] font-bold text-primary mr-3 hover:underline">{cfg.edit}</button>
                          <button className="text-[10px] font-bold text-mac-red hover:underline">{cfg.delete}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <footer className="h-12 border-t border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#1e1e1e] flex items-center justify-between px-6 shrink-0">
        <span className="text-[10px] text-slate-400 font-medium italic opacity-60">{cfg.unsaved}</span>
        <button className="px-6 py-1.5 bg-primary text-white text-[11px] font-bold rounded-lg shadow-lg shadow-primary/20 hover:brightness-110 active:scale-95 transition-all">{cfg.save}</button>
      </footer>
    </div>
  );
};

export default ConfigMgmt;
