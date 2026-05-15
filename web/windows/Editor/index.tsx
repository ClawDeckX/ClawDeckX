import React, { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { useConfigEditor } from './useConfigEditor';
import { useToast } from '../../components/Toast';
import { configApi, gwApi } from '../../services/api';
import { get } from '../../services/request';
import { extractSchemaKeys, getUnmappedKeys } from './sectionRegistry';
import { EditorFieldsI18nProvider } from './fields';
import type { SectionProps } from './sectionTypes';
import { validateChannelsConfig } from './sections/ChannelsSection';
interface EditorProps {
  language: Language;
  pendingSection?: string | null;
  onSectionConsumed?: () => void;
}

type SectionId =
  | 'migration'
  | 'models' | 'agents' | 'tools' | 'channels' | 'messages' | 'commands'
  | 'session' | 'gateway' | 'hooks' | 'cron' | 'extensions'
  | 'memory' | 'audio' | 'browser' | 'logging' | 'auth' | 'misc' | 'json' | 'live' | 'templates'
  | 'unmapped';

interface SectionDef {
  id: SectionId;
  icon: string;
  labelKey: string;
  color: string;
  searchKeys?: string[];
}
const MigrationSection = lazy(() => import('./sections/MigrationSection').then(m => ({ default: m.MigrationSection })));
const ModelsSection = lazy(() => import('./sections/ModelsSection').then(m => ({ default: m.ModelsSection })));
const AgentsSection = lazy(() => import('./sections/AgentsSection').then(m => ({ default: m.AgentsSection })));
const ToolsSection = lazy(() => import('./sections/ToolsSection').then(m => ({ default: m.ToolsSection })));
const ChannelsSection = lazy(() => import('./sections/ChannelsSection').then(m => ({ default: m.ChannelsSection })));
const MessagesSection = lazy(() => import('./sections/MessagesSection').then(m => ({ default: m.MessagesSection })));
const CommandsSection = lazy(() => import('./sections/CommandsSection').then(m => ({ default: m.CommandsSection })));
const SessionSection = lazy(() => import('./sections/SessionSection').then(m => ({ default: m.SessionSection })));
const GatewaySection = lazy(() => import('./sections/GatewaySection').then(m => ({ default: m.GatewaySection })));
const HooksSection = lazy(() => import('./sections/HooksSection').then(m => ({ default: m.HooksSection })));
const CronSection = lazy(() => import('./sections/CronSection').then(m => ({ default: m.CronSection })));
const ExtensionsSection = lazy(() => import('./sections/ExtensionsSection').then(m => ({ default: m.ExtensionsSection })));
const MemorySection = lazy(() => import('./sections/MemorySection').then(m => ({ default: m.MemorySection })));
const AudioSection = lazy(() => import('./sections/AudioSection').then(m => ({ default: m.AudioSection })));
const BrowserSection = lazy(() => import('./sections/BrowserSection').then(m => ({ default: m.BrowserSection })));
const LoggingSection = lazy(() => import('./sections/LoggingSection').then(m => ({ default: m.LoggingSection })));
const AuthSection = lazy(() => import('./sections/AuthSection').then(m => ({ default: m.AuthSection })));
const MiscSection = lazy(() => import('./sections/MiscSection').then(m => ({ default: m.MiscSection })));
const JsonEditorSection = lazy(() => import('./sections/JsonEditorSection').then(m => ({ default: m.JsonEditorSection })));
const LiveConfigSection = lazy(() => import('./sections/LiveConfigSection').then(m => ({ default: m.LiveConfigSection })));
const TemplatesSection = lazy(() => import('./sections/TemplatesSectionV2').then(m => ({ default: m.TemplatesSectionV2 })));
const UnmappedConfigSection = lazy(() => import('./sections/UnmappedConfigSection').then(m => ({ default: m.UnmappedConfigSection })));
const SECTIONS: SectionDef[] = [
  // OpenClaw 一键导入（置顶）
  { id: 'migration', icon: 'swap_horiz', labelKey: 'secMigration', color: 'text-cyan-400',
    searchKeys: ['migrate', 'migration', 'claude', 'hermes', 'import', '导入', '迁移', 'importer'] },
  // core sections
  { id: 'models', icon: 'psychology', labelKey: 'secModels', color: 'text-blue-500',
    searchKeys: ['providers', 'provider', 'apiType', 'apiTypeTip', 'baseUrlTip', 'credentials', 'models', 'primaryModel', 'primaryModelDesc', 'fallbackModel', 'fallbackModelDesc', 'contextWindow', 'contextWindowDesc', 'reasoning', 'reasoningDesc', 'mergeMode', 'mergeModeDesc', 'subagentModel', 'subagentModelDesc', 'heartbeatModel', 'heartbeatModelDesc', 'customHeaders', 'authMethod', 'advancedSettings', 'addProviderWizard', 'testConn', 'discoverModels'] },
  { id: 'channels', icon: 'forum', labelKey: 'secChannels', color: 'text-green-500',
    searchKeys: ['channelConfig', 'addChannel', 'channelType', 'allowFrom', 'denyFrom', 'adminIds', 'mentionPatterns', 'greeting', 'onboardMsg', 'groupMode', 'threadMode', 'dmPolicy', 'groupPolicy', 'streamMode', 'replyMode', 'inlineButtons', 'selfChatMode', 'chTelegram', 'chWhatsapp', 'chDiscord', 'chSlack', 'chSignal', 'chImessage', 'chBluebubbles', 'chGooglechat', 'chMsteams', 'chMattermost', 'chMatrix', 'chFeishu', 'chWecom', 'chWecomKf', 'chWechat', 'chQq', 'chDingtalk', 'chDoubao', 'chZalo', 'chVoicecall', 'botToken', 'appToken', 'webhookUrl'] },
  { id: 'gateway', icon: 'dns', labelKey: 'secGateway', color: 'text-teal-500',
    searchKeys: ['basicSettings', 'port', 'runMode', 'bind', 'authentication', 'authMode', 'authToken', 'authPassword', 'authRateLimit', 'tlsEnabled', 'autoGenerate', 'certPath', 'keyPath', 'remoteConn', 'remotePassword', 'tlsFingerprint', 'transport', 'reload', 'reloadMode', 'controlUi', 'httpConfig', 'httpChat', 'httpResponses', 'trustedProxies', 'gwToolAccess', 'gwNodes', 'discovery', 'webConfig', 'channelHealthCheckMin', 'allowTailscaleAuth', 'apnsRelay', 'apnsRelayBaseUrl', 'apnsRelayTimeoutMs'] },
  { id: 'templates', icon: 'auto_fix_high', labelKey: 'secTemplates', color: 'text-violet-500',
    searchKeys: ['tplDesc', 'tplAdd', 'tplEdit', 'tplDelete', 'tplApply', 'tplExport', 'tplImport', 'tplShare', 'tplSearch', 'tplCategory', 'tplTags', 'tplAuthor', 'tplBuiltIn', 'tplUser'] },
  // frequently used sections
  { id: 'agents', icon: 'smart_toy', labelKey: 'secAgents', color: 'text-purple-500',
    searchKeys: ['agentList', 'addAgent', 'systemPrompt', 'behavior', 'thinkingDefault', 'verboseDefault', 'elevatedDefault', 'typingMode', 'compactionMode', 'bootstrapTruncationWarning', 'humanDelay', 'heartbeat', 'maxConcurrent', 'maxConcurrentDesc', 'subagentConcurrent', 'workspace', 'timeoutS', 'mediaMaxMb', 'sandbox', 'dockerEnabled', 'wakeMode', 'avatar'] },
  { id: 'tools', icon: 'build', labelKey: 'secTools', color: 'text-orange-500',
    searchKeys: ['toolProfile', 'profile', 'profileDesc', 'allowList', 'denyList', 'exec', 'execHost', 'security', 'askBeforeExec', 'safeBins', 'safeBinsDesc', 'webSearch', 'webFetch', 'media', 'imageUnderstanding', 'audioUnderstanding', 'videoUnderstanding', 'elevatedTools', 'allowedElevated', 'messageTools', 'crossContextSend', 'broadcast', 'agentToAgent'] },
  { id: 'messages', icon: 'chat', labelKey: 'secMessages', color: 'text-cyan-500',
    searchKeys: ['prefixes', 'messagePrefix', 'responsePrefix', 'ackReaction', 'typingReaction', 'ackEmoji', 'ackScope', 'removeAfterReply', 'groupChat', 'historyLimit', 'messageQueue', 'queueCap', 'dropWhenFull', 'inboundDebounce', 'ttsConfig', 'autoTts', 'typingIntervalS', 'typingMode'] },
  { id: 'commands', icon: 'terminal', labelKey: 'secCommands', color: 'text-amber-500',
    searchKeys: ['commandToggles', 'nativeCommands', 'nativeSkills', 'textCommands', 'bashCommands', 'configCommands', 'debugCommands', 'restartCommand', 'bashConfig', 'foregroundMs', 'accessControl', 'useAccessGroups', 'ownerAllowFrom', 'ownerAllowFromDesc'] },
  { id: 'session', icon: 'history', labelKey: 'secSession', color: 'text-indigo-500',
    searchKeys: ['sessionScope', 'scope', 'scopeDesc', 'dmScope', 'idleMinutes', 'sessionStore', 'sessionMainKey', 'resetTriggers', 'sessionReset', 'resetMode', 'atHour', 'resetByType', 'threadBindings', 'tbIdleHours', 'tbMaxAgeHours', 'sessionMaintenance', 'maintMode', 'maintPruneAfter', 'maintMaxEntries', 'maintRotateBytes', 'maintMaxDiskBytes', 'agentToAgentSession', 'maxPingPongTurns'] },
  { id: 'hooks', icon: 'webhook', labelKey: 'secHooks', color: 'text-pink-500',
    searchKeys: ['enableHooks', 'webhookPath', 'maxBodyBytes', 'presets', 'hookMappings', 'hookMatch', 'hookAction', 'hookChannel', 'hookModel', 'credentialsPath', 'tokenPath', 'webhookToken', 'gmailConfig', 'gmailEnabled', 'internalEnabled', 'internalHooks'] },
  { id: 'cron', icon: 'schedule', labelKey: 'secCron', color: 'text-lime-500',
    searchKeys: ['cronJobs', 'cronStorePath', 'cronWakeMode', 'cronLightContext', 'cronMaxConcurrent'] },
  { id: 'extensions', icon: 'extension', labelKey: 'secExtensions', color: 'text-violet-500',
    searchKeys: ['skillEntries', 'skillName', 'pluginSettings', 'enablePlugins', 'pluginSlots', 'pluginEntries', 'pluginName', 'memoryPlugin', 'loadConfig', 'installConfig', 'allowBundled', 'extraDirs', 'watch', 'watchDebounceMs', 'nodeManager', 'envVars'] },
  { id: 'memory', icon: 'neurology', labelKey: 'secMemory', color: 'text-sky-500',
    searchKeys: ['memoryConfig', 'memoryProvider', 'maxMemories', 'citations', 'memSearchProvider', 'memSearchFallback', 'qmdCommand', 'qmdDataPath'] },
  { id: 'audio', icon: 'volume_up', labelKey: 'secAudio', color: 'text-fuchsia-500',
    searchKeys: ['audioConfig', 'talkProvider', 'talkOutputFormat', 'sttProvider', 'ttsProvider', 'voiceId', 'speed', 'wakeWord', 'enableWakeWord', 'wakeWordPhrase', 'silenceMs', 'inputDevice', 'outputDevice', 'sampleRate', 'ttsStatus', 'talkMode', 'talkModeDesc', 'audioTranscription', 'audioInterrupt'] },
  { id: 'browser', icon: 'language', labelKey: 'secBrowser', color: 'text-emerald-500',
    searchKeys: ['browserConfig', 'brEvaluateEnabled', 'headless', 'browserTimeout', 'viewport', 'brNoSandbox', 'brAttachOnly', 'brDefaultProfile', 'brSsrfPolicy', 'brAllowPrivateNetwork', 'brHostnameAllowlist', 'cdpUrl', 'executablePath', 'brColor'] },
  { id: 'logging', icon: 'monitoring', labelKey: 'secLogging', color: 'text-yellow-500',
    searchKeys: ['loggingConfig', 'logLevel', 'logFile', 'maxFileBytes', 'consoleLevel', 'consoleStyle', 'redactSensitive', 'redactPatterns', 'diagnostics', 'enableDiag', 'diagFlags', 'stuckSessionWarnMs', 'otelConfig', 'otelEndpoint', 'otelProtocol', 'otelServiceName', 'otelTraces', 'otelMetrics', 'otelLogs', 'otelSampleRate', 'otelFlushMs', 'cacheTrace'] },
  { id: 'auth', icon: 'lock', labelKey: 'secAuth', color: 'text-red-500',
    searchKeys: ['authConfig', 'authOrder', 'authOrderDesc', 'authProfiles', 'authProfile', 'addAuthProfile', 'authEmail', 'authCooldowns', 'authCooldownDesc', 'providerOrder'] },
  // tail sections
  { id: 'live', icon: 'cloud_sync', labelKey: 'secLive', color: 'text-amber-500',
    searchKeys: ['liveConfig', 'viewSchema', 'liveLoadConfig', 'configApplyBtn', 'configPatchBtn', 'configSetTitle', 'configSetDesc', 'wizardTitle', 'wizardStart'] },
  { id: 'misc', icon: 'tune', labelKey: 'secMisc', color: 'text-slate-500',
    searchKeys: ['updateConfig', 'updateChannel', 'checkOnStart', 'autoUpdateEnabled', 'uiConfig', 'assistantName', 'assistantAvatar', 'seamColor', 'controlUi', 'basePath', 'allowedOrigins', 'cliConfig', 'cliTaglineMode', 'shellEnvEnabled', 'envVars', 'discovery', 'mcpServers', 'MCP'] },
  { id: 'unmapped', icon: 'new_releases', labelKey: 'secUnmapped', color: 'text-amber-500' },
  { id: 'json', icon: 'data_object', labelKey: 'secJson', color: 'text-slate-400' },
];

const Editor: React.FC<EditorProps> = ({ language, pendingSection, onSectionConsumed }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const ed = (t as any).cfgEditor || {};
  const es = useMemo(() => (t as any).es || {}, [t]);

  const editor = useConfigEditor();
  const { toast } = useToast();
  const handleSave = useCallback(async () => {
    // Pre-save: validate required channel credentials
    if (editor.config) {
      const chErrors = validateChannelsConfig(editor.config, es);
      if (chErrors.length > 0) {
        const msgs = chErrors.map(e => {
          const label = e.account === 'default' ? e.channel : `${e.channel}/${e.account}`;
          return `${label}: ${e.fields.join(', ')}`;
        });
        toast('error', (es.saveCredentialMissing || 'Required channel fields missing') + '\n' + msgs.join('\n'));
        return;
      }
    }
    const ok = await editor.save();
    if (ok) {
      toast('success', ed.saveOkReloading || 'Config saved. Gateway is reloading...');
    }
  }, [editor, toast, ed, es]);
  const [activeSection, setActiveSection] = useState<SectionId>('models');
  useEffect(() => {
    if (pendingSection && SECTIONS.some(s => s.id === pendingSection)) {
      setActiveSection(pendingSection as SectionId);
      onSectionConsumed?.();
    }
  }, [pendingSection, onSectionConsumed]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [unmappedCount, setUnmappedCount] = useState<number | null>(null);
  const [openclawInstalled, setOpenclawInstalled] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const scrollBySectionRef = useRef<Partial<Record<SectionId, number>>>({});
  const pendingRestoreSectionRef = useRef<SectionId | null>(null);
  const sectionButtonRefs = useRef<Partial<Record<SectionId, HTMLButtonElement | null>>>({});

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

  // Ctrl+S 淇濆瓨
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
    };

    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) { editor.redo(); } else { editor.undo(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editor]);

  // Pre-detect unmapped keys count so we can hide the tab when empty
  useEffect(() => {
    gwApi.configSchema().then((res: any) => {
      const schemaObj = res?.schema || res;
      if (!schemaObj?.properties) { setUnmappedCount(0); return; }
      const allKeys = extractSchemaKeys(schemaObj);
      const unmapped = getUnmappedKeys(allKeys);
      setUnmappedCount(unmapped.length);
    }).catch(() => { /* keep null = show tab as fallback */ });
  }, []);

  // 杩囨护 sections
  const filteredSections = useMemo(() => {
    let list = SECTIONS;
    // Hide the unmapped section when there are no unmapped keys
    if (unmappedCount === 0) list = list.filter(s => s.id !== 'unmapped');
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(s => {
      if (((es as any)[s.labelKey] || '').toLowerCase().includes(q)) return true;
      if (s.labelKey.toLowerCase().includes(q)) return true;
      if (s.id.includes(q)) return true;
      if (s.searchKeys) {
        return s.searchKeys.some(k => {
          // Match translated label (e.g. Chinese) AND raw key name (English)
          if (k.toLowerCase().includes(q)) return true;
          const v = (es as any)[k];
          return typeof v === 'string' && v.toLowerCase().includes(q);
        });
      }
      return false;
    });
  }, [searchQuery, es, unmappedCount]);

  const handleSectionClick = useCallback((id: SectionId) => {
    if (mainScrollRef.current) {
      scrollBySectionRef.current[activeSection] = mainScrollRef.current.scrollTop;
    }
    pendingRestoreSectionRef.current = id;
    setActiveSection(id);
    setSidebarOpen(false);
  }, [activeSection]);

  useEffect(() => {
    if (!editor.config || !mainScrollRef.current) return;
    // Only restore scroll position when switching sections, not on config updates
    if (!pendingRestoreSectionRef.current) return;
    const targetSection = pendingRestoreSectionRef.current;
    const targetTop = scrollBySectionRef.current[targetSection] ?? 0;
    const raf = window.requestAnimationFrame(() => {
      if (mainScrollRef.current) {
        mainScrollRef.current.scrollTop = targetTop;
      }
      pendingRestoreSectionRef.current = null;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [activeSection]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const btn = sectionButtonRefs.current[activeSection];
    if (!btn) return;
    const raf = window.requestAnimationFrame(() => {
      btn.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [sidebarOpen, activeSection, filteredSections.length]);

  const sectionProps = useMemo<SectionProps | null>(() => {
    if (!editor.config) return null;
    return {
      config: editor.config,
      schema: editor.schema,
      setField: editor.setField,
      getField: editor.getField,
      deleteField: editor.deleteField,
      appendToArray: editor.appendToArray,
      removeFromArray: editor.removeFromArray,
      language,
      save: editor.save,
      reload: editor.reload,
    };
  }, [editor.config, editor.schema, editor.setField, editor.getField, editor.deleteField, editor.appendToArray, editor.removeFromArray, language, editor.save, editor.reload]);

  const renderedSection = useMemo(() => {
    if (!editor.config || !sectionProps) return null;
    switch (activeSection) {
      case 'migration': return <MigrationSection {...sectionProps} />;
      case 'models': return <ModelsSection {...sectionProps} />;
      case 'agents': return <AgentsSection {...sectionProps} />;
      case 'tools': return <ToolsSection {...sectionProps} />;
      case 'channels': return <ChannelsSection {...sectionProps} />;
      case 'messages': return <MessagesSection {...sectionProps} />;
      case 'commands': return <CommandsSection {...sectionProps} />;
      case 'session': return <SessionSection {...sectionProps} />;
      case 'gateway': return <GatewaySection {...sectionProps} />;
      case 'hooks': return <HooksSection {...sectionProps} />;
      case 'cron': return <CronSection {...sectionProps} />;
      case 'extensions': return <ExtensionsSection {...sectionProps} />;
      case 'memory': return <MemorySection {...sectionProps} />;
      case 'audio': return <AudioSection {...sectionProps} />;
      case 'browser': return <BrowserSection {...sectionProps} />;
      case 'logging': return <LoggingSection {...sectionProps} />;
      case 'auth': return <AuthSection {...sectionProps} />;
      case 'misc': return <MiscSection {...sectionProps} />;
      case 'templates': return <TemplatesSection language={language} />;
      case 'json': return <JsonEditorSection config={editor.config} toJSON={editor.toJSON} fromJSON={editor.fromJSON} language={language} />;
      case 'live': return <LiveConfigSection language={language} />;
      case 'unmapped': return <UnmappedConfigSection language={language} config={editor.config} setField={editor.setField} onUnmappedCount={setUnmappedCount} />;
      default: return null;
    }
  }, [activeSection, editor.config, editor.fromJSON, editor.toJSON, language, sectionProps]);

  const currentSection = SECTIONS.find(s => s.id === activeSection);
  const showMobileSaveBar = editor.dirty || editor.saving || !!editor.saveError;

  return (
    <EditorFieldsI18nProvider language={language}>
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#1a1c20] relative">
      {/* 椤舵爮 */}
      <header className="h-12 border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.03] flex items-center gap-2.5 px-3 md:px-4 shrink-0">
        {/* 绉诲姩绔彍鍗曟寜閽?*/}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="md:hidden text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          aria-label={sidebarOpen ? ed.closeMenu : ed.openMenu}
          title={sidebarOpen ? ed.closeMenu : ed.openMenu}
          aria-expanded={sidebarOpen}
          aria-controls="config-editor-sidebar"
        >
          <span className="material-symbols-outlined text-[20px]">menu</span>
        </button>

        {/* 妯″紡鍒囨崲 */}
        <div className="flex bg-slate-200 dark:bg-black/20 p-0.5 rounded-lg border border-slate-300 dark:border-white/5 shrink-0">
          <button
            onClick={() => editor.setMode('remote')}
            className={`px-2 md:px-3 py-1 rounded-md text-[11px] font-bold transition-all ${editor.mode === 'remote' ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {ed.remote}
          </button>
          <button
            onClick={() => editor.setMode('local')}
            className={`px-2 md:px-3 py-1 rounded-md text-[11px] font-bold transition-all ${editor.mode === 'local' ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {ed.local}
          </button>
        </div>

        {/* 鏂囦欢璺緞 */}
        <span className="hidden sm:inline text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate max-w-[360px]" title={editor.configPath || ''}>
          {editor.configPath || (editor.mode === 'local' ? 'openclaw.json' : 'remote://gateway')}
        </span>

        <div className="flex-1" />

        {/* 鎾ら攢/閲嶅仛 */}
        <button
          onClick={editor.undo}
          disabled={!editor.canUndo}
          className="hidden sm:flex w-7 h-7 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={`${ed.undo} (Ctrl+Z)`}
          aria-label={ed.undo}
        >
          <span className="material-symbols-outlined text-[16px]">undo</span>
        </button>
        <button
          onClick={editor.redo}
          disabled={!editor.canRedo}
          className="hidden sm:flex w-7 h-7 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={`${ed.redo} (Ctrl+Shift+Z)`}
          aria-label={ed.redo}
        >
          <span className="material-symbols-outlined text-[16px]">redo</span>
        </button>

        {/* 淇濆瓨 */}
        <button
          onClick={handleSave}
          disabled={!editor.dirty || editor.saving}
          aria-label={ed.saveReload}
          title={ed.saveReload}
          className={`px-3 md:px-4 h-8 text-[11px] font-bold rounded-lg transition-all flex items-center gap-1.5 ${
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
        {/* 绉诲姩绔伄缃?*/}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        {/* 渚ц竟鏍?*/}
        <aside
          id="config-editor-sidebar"
          className={`
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'}
          md:translate-x-0 fixed md:static z-40 md:z-auto
          w-52 md:w-44 lg:w-52 h-full shrink-0
          bg-slate-50 dark:bg-[#161820] border-e border-slate-200 dark:border-white/5
          flex flex-col overflow-hidden transition-transform duration-200
        `}
        >
          {/* 鎼滅储 */}
          <div className="p-2.5">
            <div className="relative">
              <span className="material-symbols-outlined absolute start-2 top-1/2 -translate-y-1/2 text-[14px] text-slate-400">search</span>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={ed.search}
                className="w-full h-8 ps-7 pe-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-md text-[11px] text-slate-700 dark:text-slate-300 outline-none focus:border-primary placeholder:text-slate-400 dark:placeholder:text-slate-600"
              />
            </div>
          </div>

          {/* 瀵艰埅鍒楄〃 */}
          <nav className="flex-1 overflow-y-auto custom-scrollbar neon-scrollbar px-2 pb-2.5">
            {filteredSections.map(s => (
              <button
                key={s.id}
                ref={el => { sectionButtonRefs.current[s.id] = el; }}
                onClick={() => handleSectionClick(s.id)}
                aria-current={activeSection === s.id ? 'page' : undefined}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-start transition-all mb-1 ${
                  activeSection === s.id
                    ? 'bg-primary/10 text-primary font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className={`material-symbols-outlined text-[16px] ${activeSection === s.id ? 'text-primary' : s.color}`}>{s.icon}</span>
                <span className="text-[11px] truncate">{(es as any)[s.labelKey]}</span>
                {s.id === 'unmapped' && unmappedCount != null && unmappedCount > 0 && (
                  <span className="ms-auto text-[8px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">{unmappedCount}</span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* 涓荤紪杈戝尯 */}
        <main
          ref={mainScrollRef}
          className={`flex-1 overflow-y-auto custom-scrollbar neon-scrollbar ${showMobileSaveBar ? 'pb-16 md:pb-0' : ''}`}
          style={{ scrollPaddingBottom: showMobileSaveBar ? 84 : 16 }}
        >
          {editor.loading && !editor.config ? (
            // Initial load: no config yet, show full-page spinner.
            // Subsequent reloads (config already present) keep rendering the
            // section so local wizard/plugin-install state isn't wiped by an
            // unmount/remount cycle.
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
                        className="px-4 h-8 bg-primary text-white text-[11px] font-bold rounded-lg flex items-center gap-1.5 hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
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
                  <button onClick={() => editor.load()} className="px-4 h-8 bg-primary text-white text-[11px] font-bold rounded-lg">
                    {ed.retry}
                  </button>
                )}
              </div>
            </div>
          ) : editor.config ? (
            <div className="p-3.5 md:p-5 lg:p-6 max-w-5xl mx-auto">
              {/* 鍖哄潡鏍囬 */}
              {currentSection && (
                <div className="flex items-center gap-2.5 mb-5 md:mb-6">
                  <span className={`material-symbols-outlined text-[22px] ${currentSection.color}`}>{currentSection.icon}</span>
                  <h2 className="text-sm md:text-base font-bold text-slate-800 dark:text-white">
                    {(es as any)[currentSection.labelKey]}
                  </h2>
                </div>
              )}
              <Suspense fallback={<div className="py-10 flex items-center justify-center text-slate-400"><span className="material-symbols-outlined text-[24px] animate-spin">progress_activity</span></div>}>{renderedSection}</Suspense>
            </div>
          ) : null}
        </main>
      </div>

      {showMobileSaveBar && (
        <div className="md:hidden px-3 pt-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-slate-200 dark:border-white/5 bg-white/95 dark:bg-[#161820]/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              {editor.saveError ? (
                <p className="text-[11px] text-red-500 truncate">{editor.saveError}</p>
              ) : (
                <p className="text-[11px] text-amber-500 truncate">{ed.unsaved}</p>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={!editor.dirty || editor.saving}
              className={`h-9 px-3.5 text-[11px] font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                editor.dirty
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : 'bg-slate-200 dark:bg-white/10 text-slate-400 dark:text-slate-500 cursor-not-allowed'
              }`}
            >
              {editor.saving && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
              {ed.saveReload}
            </button>
          </div>
        </div>
      )}

      {/* 搴曟爮 */}
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
            <span className="text-amber-500 flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[10px]">circle</span>
              {ed.unsaved}
            </span>
          ) : (
            <span className="text-mac-green flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[10px]">check_circle</span>
              {ed.synced}
            </span>
          )}
        </span>
      </footer>
      </div>
    </EditorFieldsI18nProvider>
  );
};

export default Editor;









