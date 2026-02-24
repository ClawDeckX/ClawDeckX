import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { useConfigEditor, ConfigMode } from './useConfigEditor';
import { configApi } from '../../services/api';
import { get } from '../../services/request';
import { ModelsSection } from './sections/ModelsSection';
import { AgentsSection } from './sections/AgentsSection';
import { ToolsSection } from './sections/ToolsSection';
import { ChannelsSection } from './sections/ChannelsSection';
import { MessagesSection } from './sections/MessagesSection';
import { CommandsSection } from './sections/CommandsSection';
import { SessionSection } from './sections/SessionSection';
import { GatewaySection } from './sections/GatewaySection';
import { HooksSection } from './sections/HooksSection';
import { CronSection } from './sections/CronSection';
import { ExtensionsSection } from './sections/ExtensionsSection';
import { MemorySection } from './sections/MemorySection';
import { AudioSection } from './sections/AudioSection';
import { BrowserSection } from './sections/BrowserSection';
import { LoggingSection } from './sections/LoggingSection';
import { AuthSection } from './sections/AuthSection';
import { MiscSection } from './sections/MiscSection';
import { JsonEditorSection } from './sections/JsonEditorSection';
import { LiveConfigSection } from './sections/LiveConfigSection';
import { TemplatesSection } from './sections/TemplatesSection';

interface EditorProps {
  language: Language;
}

type SectionId =
  | 'models' | 'agents' | 'tools' | 'channels' | 'messages' | 'commands'
  | 'session' | 'gateway' | 'hooks' | 'cron' | 'extensions'
  | 'memory' | 'audio' | 'browser' | 'logging' | 'auth' | 'misc' | 'json' | 'live' | 'templates';

interface SectionDef {
  id: SectionId;
  icon: string;
  labelKey: string;
  color: string;
}

const SECTIONS: SectionDef[] = [
  // 核心配置（固定顺序）
  { id: 'models', icon: 'psychology', labelKey: 'secModels', color: 'text-blue-500' },
  { id: 'channels', icon: 'forum', labelKey: 'secChannels', color: 'text-green-500' },
  { id: 'gateway', icon: 'dns', labelKey: 'secGateway', color: 'text-teal-500' },
  { id: 'templates', icon: 'auto_fix_high', labelKey: 'secTemplates', color: 'text-violet-500' },
  // 按使用频率排序
  { id: 'agents', icon: 'smart_toy', labelKey: 'secAgents', color: 'text-purple-500' },
  { id: 'tools', icon: 'build', labelKey: 'secTools', color: 'text-orange-500' },
  { id: 'messages', icon: 'chat', labelKey: 'secMessages', color: 'text-cyan-500' },
  { id: 'commands', icon: 'terminal', labelKey: 'secCommands', color: 'text-amber-500' },
  { id: 'session', icon: 'history', labelKey: 'secSession', color: 'text-indigo-500' },
  { id: 'hooks', icon: 'webhook', labelKey: 'secHooks', color: 'text-pink-500' },
  { id: 'cron', icon: 'schedule', labelKey: 'secCron', color: 'text-lime-500' },
  { id: 'extensions', icon: 'extension', labelKey: 'secExtensions', color: 'text-violet-500' },
  { id: 'memory', icon: 'neurology', labelKey: 'secMemory', color: 'text-sky-500' },
  { id: 'audio', icon: 'volume_up', labelKey: 'secAudio', color: 'text-fuchsia-500' },
  { id: 'browser', icon: 'language', labelKey: 'secBrowser', color: 'text-emerald-500' },
  { id: 'logging', icon: 'monitoring', labelKey: 'secLogging', color: 'text-yellow-500' },
  { id: 'auth', icon: 'lock', labelKey: 'secAuth', color: 'text-red-500' },
  // 末尾固定
  { id: 'live', icon: 'cloud_sync', labelKey: 'secLive', color: 'text-amber-500' },
  { id: 'misc', icon: 'tune', labelKey: 'secMisc', color: 'text-slate-500' },
  { id: 'json', icon: 'data_object', labelKey: 'secJson', color: 'text-slate-400' },
];

const Editor: React.FC<EditorProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const ed = (t as any).cfgEditor || {};
  const es = useMemo(() => (t as any).es || {}, [t]);

  const editor = useConfigEditor();
  const [activeSection, setActiveSection] = useState<SectionId>('models');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [openclawInstalled, setOpenclawInstalled] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  // 当配置文件不存在时，检测 openclaw 是否已安装
  useEffect(() => {
    if (editor.loadErrorCode === 'CONFIG_NOT_FOUND') {
      get<any>('/api/v1/setup/scan').then((data: any) => {
        const report = data?.data || data;
        setOpenclawInstalled(report?.openClawInstalled ?? false);
      }).catch(() => setOpenclawInstalled(false));
    }
  }, [editor.loadErrorCode]);

  const handleGenerateDefault = useCallback(async () => {
    setGenerating(true);
    setGenerateError('');
    try {
      await configApi.generateDefault();
      await editor.load();
    } catch (e: any) {
      setGenerateError(e?.message || es.genConfigFail);
    } finally {
      setGenerating(false);
    }
  }, [editor, es]);

  // Ctrl+S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        editor.save();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) { editor.redo(); } else { editor.undo(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editor]);

  // 过滤 sections
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return SECTIONS;
    const q = searchQuery.toLowerCase();
    return SECTIONS.filter(s =>
      ((es as any)[s.labelKey] || '').toLowerCase().includes(q) ||
      s.id.includes(q)
    );
  }, [searchQuery, es]);

  const handleSectionClick = useCallback((id: SectionId) => {
    setActiveSection(id);
    setSidebarOpen(false);
  }, []);

  const renderSection = () => {
    if (!editor.config) return null;
    const props = { config: editor.config, setField: editor.setField, getField: editor.getField, deleteField: editor.deleteField, appendToArray: editor.appendToArray, removeFromArray: editor.removeFromArray, language, save: editor.save };
    switch (activeSection) {
      case 'models': return <ModelsSection {...props} />;
      case 'agents': return <AgentsSection {...props} />;
      case 'tools': return <ToolsSection {...props} />;
      case 'channels': return <ChannelsSection {...props} />;
      case 'messages': return <MessagesSection {...props} />;
      case 'commands': return <CommandsSection {...props} />;
      case 'session': return <SessionSection {...props} />;
      case 'gateway': return <GatewaySection {...props} />;
      case 'hooks': return <HooksSection {...props} />;
      case 'cron': return <CronSection {...props} />;
      case 'extensions': return <ExtensionsSection {...props} />;
      case 'memory': return <MemorySection {...props} />;
      case 'audio': return <AudioSection {...props} />;
      case 'browser': return <BrowserSection {...props} />;
      case 'logging': return <LoggingSection {...props} />;
      case 'auth': return <AuthSection {...props} />;
      case 'misc': return <MiscSection {...props} />;
      case 'templates': return <TemplatesSection language={language} />;
      case 'json': return <JsonEditorSection config={editor.config} toJSON={editor.toJSON} fromJSON={editor.fromJSON} language={language} />;
      case 'live': return <LiveConfigSection language={language} />;
      default: return null;
    }
  };

  const currentSection = SECTIONS.find(s => s.id === activeSection);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#1a1c20] relative">
      {/* 顶栏 */}
      <header className="h-11 md:h-12 border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.03] flex items-center gap-2 px-2 md:px-3 shrink-0">
        {/* 移动端菜单按钮 */}
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <span className="material-symbols-outlined text-[20px]">menu</span>
        </button>

        {/* 模式切换 */}
        <div className="flex bg-slate-200 dark:bg-black/20 p-0.5 rounded-lg border border-slate-300 dark:border-white/5 shrink-0">
          <button
            onClick={() => editor.setMode('remote')}
            className={`px-2 md:px-3 py-1 rounded-md text-[11px] md:text-[10px] font-bold transition-all ${editor.mode === 'remote' ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {ed.remote}
          </button>
          <button
            onClick={() => editor.setMode('local')}
            className={`px-2 md:px-3 py-1 rounded-md text-[11px] md:text-[10px] font-bold transition-all ${editor.mode === 'local' ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {ed.local}
          </button>
        </div>

        {/* 文件路径 */}
        <span className="hidden sm:inline text-[10px] font-mono text-slate-400 dark:text-slate-500 truncate max-w-[200px]">
          {editor.mode === 'local' ? (editor.configPath || 'openclaw.json') : 'remote://gateway'}
        </span>

        <div className="flex-1" />

        {/* 撤销/重做 */}
        <button onClick={editor.undo} disabled={!editor.canUndo} className="hidden sm:flex w-7 h-7 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Undo (Ctrl+Z)">
          <span className="material-symbols-outlined text-[16px]">undo</span>
        </button>
        <button onClick={editor.redo} disabled={!editor.canRedo} className="hidden sm:flex w-7 h-7 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Redo (Ctrl+Shift+Z)">
          <span className="material-symbols-outlined text-[16px]">redo</span>
        </button>

        {/* 保存 */}
        <button
          onClick={() => editor.save()}
          disabled={!editor.dirty || editor.saving}
          className={`px-3 md:px-4 h-7 text-[10px] md:text-[11px] font-bold rounded-lg transition-all flex items-center gap-1.5 ${
            editor.dirty
              ? 'bg-primary text-white shadow-lg shadow-primary/20 hover:bg-primary/90'
              : 'bg-slate-200 dark:bg-white/10 text-slate-400 dark:text-slate-500 cursor-not-allowed'
          }`}
        >
          {editor.saving && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
          {ed.saveReload}
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* 移动端遮罩 */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* 侧边栏 */}
        <aside className={`
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 fixed md:static z-40 md:z-auto
          w-52 md:w-44 lg:w-52 h-full shrink-0
          bg-slate-50 dark:bg-[#161820] border-r border-slate-200 dark:border-white/5
          flex flex-col overflow-hidden transition-transform duration-200
        `}>
          {/* 搜索 */}
          <div className="p-2">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-slate-400">search</span>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={ed.search}
                className="w-full h-7 pl-7 pr-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-md text-[10px] text-slate-700 dark:text-slate-300 outline-none focus:border-primary placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
            </div>
          </div>

          {/* 导航列表 */}
          <nav className="flex-1 overflow-y-auto custom-scrollbar px-1.5 pb-2">
            {filteredSections.map(s => (
              <button
                key={s.id}
                onClick={() => handleSectionClick(s.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all mb-0.5 ${
                  activeSection === s.id
                    ? 'bg-primary/10 text-primary font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className={`material-symbols-outlined text-[16px] ${activeSection === s.id ? 'text-primary' : s.color}`}>{s.icon}</span>
                <span className="text-[10px] md:text-[11px] truncate">{(es as any)[s.labelKey]}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* 主编辑区 */}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          {editor.loading ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <span className="material-symbols-outlined text-[32px] animate-spin">progress_activity</span>
                <span className="text-xs">{ed.loading}</span>
              </div>
            </div>
          ) : editor.loadError ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-4 text-slate-400 max-w-sm text-center px-4">
                <span className="material-symbols-outlined text-[32px] text-red-400">error</span>
                <span className="text-xs text-red-400">{editor.loadError}</span>
                {editor.loadErrorCode === 'CONFIG_NOT_FOUND' ? (
                  openclawInstalled === null ? (
                    <span className="text-xs text-slate-400">{es.checkingInstall}</span>
                  ) : openclawInstalled ? (
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {es.configMissing}
                      </p>
                      {generateError && <span className="text-xs text-red-400">{generateError}</span>}
                      <button
                        onClick={handleGenerateDefault}
                        disabled={generating}
                        className="px-4 h-8 bg-primary text-white text-[10px] font-bold rounded-lg flex items-center gap-1.5 hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
                      >
                        {generating && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                        {es.genDefaultConfig}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <p className="text-xs text-amber-500">
                        {es.notInstalled}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {es.installHint}
                      </p>
                    </div>
                  )
                ) : (
                  <button onClick={() => editor.load()} className="px-4 h-7 bg-primary text-white text-[10px] font-bold rounded-lg">
                    {ed.retry}
                  </button>
                )}
              </div>
            </div>
          ) : editor.config ? (
            <div className="p-3 md:p-5 lg:p-6 max-w-3xl mx-auto">
              {/* 区块标题 */}
              {currentSection && (
                <div className="flex items-center gap-2.5 mb-4 md:mb-5">
                  <span className={`material-symbols-outlined text-[22px] ${currentSection.color}`}>{currentSection.icon}</span>
                  <h2 className="text-sm md:text-base font-bold text-slate-800 dark:text-white">
                    {(es as any)[currentSection.labelKey]}
                  </h2>
                </div>
              )}
              {renderSection()}
            </div>
          ) : null}
        </main>
      </div>

      {/* 底栏 */}
      <footer className="h-7 md:h-8 border-t border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#161820] flex items-center px-3 md:px-4 text-[11px] md:text-[10px] text-slate-400 dark:text-slate-500 font-mono gap-3">
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${editor.mode === 'local' ? 'bg-blue-500' : 'bg-green-500'}`} />
          {editor.mode === 'local' ? ed.local : ed.remote}
        </span>
        {editor.dirty && (
          <span className="flex items-center gap-1 text-amber-500">
            <span className="material-symbols-outlined text-[10px]">circle</span>
            {ed.unsaved}
          </span>
        )}
        {editor.saveError && (
          <span className="text-red-400 truncate max-w-[200px]">{editor.saveError}</span>
        )}
        <span className="flex-1" />
        {editor.config && (
          <span>{Object.keys(editor.config).length} {ed.topKeys}</span>
        )}
        {editor.errors.length > 0 && (
          <span className="text-red-400">{editor.errors.length} {ed.errors}</span>
        )}
        <span className="hidden sm:inline flex items-center gap-1">
          {editor.dirty ? (
            <span className="text-amber-500">●</span>
          ) : (
            <span className="text-mac-green flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[10px]">check_circle</span>
              {ed.synced}
            </span>
          )}
        </span>
      </footer>
    </div>
  );
};

export default Editor;
