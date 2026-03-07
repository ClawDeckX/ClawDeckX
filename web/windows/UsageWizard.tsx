import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi, templateApi, selfUpdateApi } from '../services/api';
import { ScenarioTemplate, AgentTemplate } from '../services/template-manager-v2';
import { templateSystem } from '../services/template-system';
import { useToast } from '../components/Toast';
import { FileApplyConfirm, FileApplyRequest } from '../components/FileApplyConfirm';
import { ScenarioLibraryV2 } from '../components/scenarios';

interface UsageWizardProps {
  language: Language;
  onOpenEditor?: () => void;
  onOpenChat?: () => void;
  onDismiss?: () => void;
}

const WIZARD_STORAGE_KEY = 'usage_wizard_state';
const WIZARD_DISMISSED_KEY = 'usage_wizard_dismissed';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface CheckItem {
  id: string;
  icon: string;
  status: CheckStatus;
}

interface CapabilityCheck {
  id: string;
  status: CheckStatus;
  section: string;
  icon: string;
  current: string;
  recommendation: string;
}

// Step definitions — check → identity → scenarios → memory → capability
const STEPS = [
  { key: 'check', icon: 'verified' },
  { key: 'identity', icon: 'badge' },
  { key: 'scenarios', icon: 'category' },
  { key: 'memory', icon: 'psychology' },
  { key: 'capability', icon: 'tune' },
] as const;

type StepKey = typeof STEPS[number]['key'];

// Identity files — IDENTITY.md (agent identity) + USER.md (user profile)
const IDENTITY_FILES = [
  { name: 'IDENTITY.md', titleKey: 'identityTitle', descKey: 'identityDesc', icon: 'badge' },
  { name: 'USER.md', titleKey: 'userTitle', descKey: 'userDesc', icon: 'person' },
] as const;

// Identity presets are loaded from the template system (templates/official/agents/personas/)

// Note: Scenario definitions moved to templates/official/scenarios/
// ScenarioLibraryV2 component now loads scenarios from the unified template system


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const UsageWizard: React.FC<UsageWizardProps> = ({ language, onOpenEditor, onOpenChat, onDismiss }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const o = (t as any).ow as any;
  const { toast } = useToast();

  // Restore persisted state from localStorage
  const storedState = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(WIZARD_STORAGE_KEY) || '{}'); } catch { return {}; }
  }, []);

  // Data
  const [config, setConfig] = useState<any>(null);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [agentFiles, setAgentFiles] = useState<Record<string, any[]>>({});
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [gwError, setGwError] = useState<string | null>(null);

  // UI state
  const initialStep = useMemo<StepKey>(() => (
    STEPS.some(s => s.key === storedState.activeStep) ? storedState.activeStep as StepKey : 'check'
  ), [storedState.activeStep]);
  const [activeStep, setActiveStep] = useState<StepKey>(initialStep);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<{ agentId: string; fileName: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showTemplates, setShowTemplates] = useState(true);
  const [dbTemplates, setDbTemplates] = useState<any[]>([]);
  const [appliedScenarios, setAppliedScenarios] = useState<Set<string>>(new Set(storedState.appliedScenarios || []));
  const [pendingApply, setPendingApply] = useState<{ request: FileApplyRequest; scenarioId: string } | null>(null);
  const [tabTransition, setTabTransition] = useState(false);

  // Identity Q&A mode
  const [identityMode, setIdentityMode] = useState<'qa' | 'manual'>('qa');
  const [qaFields, setQaFields] = useState(storedState.qaFields || { name: '', personality: '', language: '', role: '', userName: '', userInfo: '' });
  const [qaGenerated, setQaGenerated] = useState(!!storedState.qaGenerated);
  const [qaPreviewContent, setQaPreviewContent] = useState(storedState.qaPreviewContent || { identity: '', user: '' });
  const [qaApplied, setQaApplied] = useState(!!storedState.qaApplied);

  // Agent identity presets (loaded from template system)
  const [agentPresets, setAgentPresets] = useState<AgentTemplate[]>([]);

  // Preset preview
  const [presetPreview, setPresetPreview] = useState<AgentTemplate | null>(null);

  // Version check
  const [versionInfo, setVersionInfo] = useState<{ current?: string; latest?: string; updateAvailable?: boolean } | null>(null);

  // Persist state to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({
        activeStep,
        appliedScenarios: [...appliedScenarios],
        qaFields, qaGenerated, qaPreviewContent, qaApplied,
      }));
    } catch {}
  }, [activeStep, appliedScenarios, qaFields, qaGenerated, qaPreviewContent, qaApplied]);

  // Tab transition animation
  const handleStepChange = useCallback((step: StepKey) => {
    if (step === activeStep) return;
    setTabTransition(true);
    setTimeout(() => {
      setActiveStep(step);
      setTabTransition(false);
    }, 150);
  }, [activeStep]);

  // Fetch all data
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setGwError(null);
    let allFailed = true;
    const settle = (p: Promise<any>) => p.catch((e: any) => { return { __error: e?.message || 'Connection failed' }; });
    const [cfgData, agentsData, channelsData] = await Promise.all([
      settle(gwApi.configGet()),
      settle(gwApi.agents()),
      settle(gwApi.channels()),
    ]);
    if (cfgData && !cfgData.__error) {
      const cfg = cfgData.config || cfgData.parsed || cfgData;
      setConfig(cfg);
      allFailed = false;
    }
    if (agentsData && !agentsData.__error) allFailed = false;
    if (channelsData && !channelsData.__error) allFailed = false;
    if (allFailed) {
      setGwError(cfgData?.__error || 'Gateway not connected');
      setLoading(false);
      return;
    }
    const agentsList = Array.isArray(agentsData) ? agentsData : agentsData?.agents || [];
    setDefaultAgentId(agentsData?.defaultId || agentsList[0]?.id || null);
    const raw = channelsData?.channels ?? channelsData?.list ?? channelsData;
    setChannels(Array.isArray(raw) ? raw : []);
    const filesResults = await Promise.all(
      agentsList.map(async (ag: any) => {
        try {
          const res = await gwApi.agentFilesList(ag.id);
          return { id: ag.id, files: res?.files || [] };
        } catch { return { id: ag.id, files: [] }; }
      })
    );
    const filesMap: Record<string, any[]> = {};
    for (const r of filesResults) filesMap[r.id] = r.files;
    setAgentFiles(filesMap);
    // Version check
    try {
      const vData = await selfUpdateApi.check();
      if (vData) setVersionInfo({ current: vData.currentVersion, latest: vData.latestVersion, updateAvailable: vData.available });
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Load templates from API
  useEffect(() => {
    templateApi.list().then((data: any) => setDbTemplates(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  // Load agent identity presets from template system
  useEffect(() => {
    templateSystem.getAgentTemplates(language).then(templates => {
      setAgentPresets(templates.filter(t => t.wizardPreset));
    }).catch(() => {});
  }, [language]);

  const resolveI18n = useCallback((tpl: any): { name: string; desc: string; content: string } => {
    try {
      const map = typeof tpl.i18n === 'string' ? JSON.parse(tpl.i18n) : tpl.i18n;
      return map[language] || map['en'] || Object.values(map)[0] as any || { name: tpl.template_id, desc: '', content: '' };
    } catch { return { name: tpl.template_id || '', desc: '', content: '' }; }
  }, [language]);

  // ---------------------------------------------------------------------------
  // Check logic (Step 0)
  // ---------------------------------------------------------------------------

  const providers = config?.models?.providers || {};
  const providerCount = Object.keys(providers).length;
  const primaryModel = config?.agents?.defaults?.model?.primary || '';
  const fallbacks: string[] = config?.agents?.defaults?.model?.fallbacks || [];
  const heartbeatCfg = config?.agents?.defaults?.heartbeat || {};
  const heartbeatOn = heartbeatCfg?.enabled !== false;
  const heartbeatModel = heartbeatCfg?.model || '';
  const heartbeatEvery = heartbeatCfg?.every || '30m';
  const subagentModel = config?.agents?.defaults?.subagents?.model || '';
  const toolProfile = String(config?.tools?.profile || 'full');
  const toolAllow = Array.isArray(config?.tools?.allow) ? config.tools.allow.map(String) : [];
  const toolDeny = Array.isArray(config?.tools?.deny) ? config.tools.deny.map(String) : [];
  const commandsBashEnabled = config?.commands?.bash !== false;
  const browserEnabled = config?.browser?.enabled === true;
  const browserEvaluateEnabled = config?.browser?.evaluateEnabled === true;
  const webSearchEnabled = config?.tools?.web?.search?.enabled !== false;
  const webFetchEnabled = config?.tools?.web?.fetch?.enabled !== false;
  const imageEnabled = config?.tools?.media?.image?.enabled !== false;
  const audioEnabled = config?.tools?.media?.audio?.enabled !== false;
  const videoEnabled = config?.tools?.media?.video?.enabled !== false;
  const memoryFlush = config?.agents?.defaults?.compaction?.memoryFlush;
  const memoryFlushEnabled = memoryFlush?.enabled !== false;
  const configuredChannels = config?.channels ? Object.keys(config.channels).filter(k => config.channels[k]?.enabled !== false) : [];
  const activeChannels = channels.filter((ch: any) => ch.connected || ch.running || ch.status === 'connected');
  const hasChannels = configuredChannels.length > 0 || activeChannels.length > 0;
  const defaultFiles = defaultAgentId ? (agentFiles[defaultAgentId] || []) : [];
  const hasFile = (name: string) => defaultFiles.some((f: any) => !f.missing && f.name === name);

  // Security config
  const gwAuth = config?.gateway?.auth || {};
  const authMode = gwAuth?.mode || config?.gateway?.authMode || '';
  const authIsNone = authMode === 'none' || (!authMode && !gwAuth?.token);
  const hasTls = !!config?.gateway?.tls?.cert || !!config?.gateway?.tls?.enabled;
  const highImpactDenyList = useMemo(() => {
    const flags = { shell: false, browser: false, web: false, file: false };
    toolDeny.forEach((item: string) => {
      const lower = item.toLowerCase();
      if (lower.includes('shell') || lower.includes('bash') || lower.includes('exec') || lower.includes('terminal')) flags.shell = true;
      if (lower.includes('browser')) flags.browser = true;
      if (lower.includes('web') || lower.includes('search') || lower.includes('fetch')) flags.web = true;
      if (lower.includes('file') || lower.includes('fs') || lower.includes('read') || lower.includes('write')) flags.file = true;
    });
    return Object.entries(flags).filter(([, disabled]) => disabled).map(([name]) => name);
  }, [toolDeny]);

  // Check sections with weight: required items weight 2, recommended weight 1
  const checks = useMemo(() => {
    const _hasFile = (name: string) => defaultFiles.some((f: any) => !f.missing && f.name === name);
    return [
      { section: o?.secModel, desc: o?.secModelDesc, icon: 'psychology', required: true, items: [
        { id: 'provider', icon: 'cloud', status: (providerCount > 0 ? 'pass' : 'fail') as CheckStatus, weight: 2 },
        { id: 'primary', icon: 'star', status: (primaryModel ? 'pass' : 'fail') as CheckStatus, weight: 2 },
        { id: 'fallback', icon: 'swap_horiz', status: (fallbacks.length > 0 ? 'pass' : 'warn') as CheckStatus, weight: 1 },
        { id: 'heartbeatModel', icon: 'favorite', status: (heartbeatModel ? 'pass' : (heartbeatOn ? 'warn' : 'pass')) as CheckStatus, weight: 1 },
        { id: 'subagentModel', icon: 'account_tree', status: (subagentModel ? 'pass' : 'warn') as CheckStatus, weight: 1 },
      ]},
      { section: o?.secIdentity, desc: o?.secIdentityDesc, icon: 'badge', required: false, items: [
        { id: 'identity', icon: 'badge', status: (_hasFile('IDENTITY.md') ? 'pass' : 'warn') as CheckStatus, weight: 1 },
        { id: 'user', icon: 'person', status: (_hasFile('USER.md') ? 'pass' : 'warn') as CheckStatus, weight: 1 },
      ]},
      { section: o?.secMemory, desc: o?.secMemoryDesc, icon: 'psychology', required: false, items: [
        { id: 'memoryFlush', icon: 'sync', status: (memoryFlushEnabled ? 'pass' : 'warn') as CheckStatus, weight: 1 },
      ]},
      { section: o?.secChannel, desc: o?.secChannelDesc, icon: 'forum', required: false, items: [
        { id: 'channel', icon: 'forum', status: (hasChannels ? 'pass' : 'warn') as CheckStatus, weight: 1 },
      ]},
      { section: o?.secSecurity, desc: o?.secSecurityDesc, icon: 'shield', required: false, items: [
        { id: 'authMode', icon: 'lock', status: (authIsNone ? 'warn' : 'pass') as CheckStatus, weight: 1 },
        { id: 'tlsEnabled', icon: 'https', status: (hasTls ? 'pass' : 'warn') as CheckStatus, weight: 1 },
      ]},
    ];
  }, [providerCount, primaryModel, fallbacks, heartbeatModel, heartbeatOn, subagentModel, defaultFiles, memoryFlushEnabled, hasChannels, authIsNone, hasTls, o]);

  const sectionKeys = ['model', 'identity', 'memory', 'channel', 'security'];

  // Weighted scoring: required items ×2, recommended ×1
  const { totalWeight, passWeight, failCount, scorePercent } = useMemo(() => {
    let tw = 0, pw = 0, fc = 0;
    for (const s of checks) {
      for (const item of s.items) {
        const w = item.weight ?? 1;
        tw += w;
        if (item.status === 'pass') pw += w;
        else fc++;
      }
    }
    return { totalWeight: tw, passWeight: pw, failCount: fc, scorePercent: tw > 0 ? Math.round((pw / tw) * 100) : 0 };
  }, [checks]);

  const capabilityChecks = useMemo<CapabilityCheck[]>(() => {
    const impactedTools = highImpactDenyList.join(', ');
    return [
      {
        id: 'capToolProfile',
        status: toolProfile === 'full' ? 'pass' : toolProfile === 'messaging' || toolProfile === 'minimal' ? 'fail' : 'warn',
        section: 'tools',
        icon: 'build',
        current: `tools.profile = ${toolProfile}`,
        recommendation: toolProfile === 'full'
          ? (o?.capOkFull || 'All tools are available.')
          : (o?.capProfileRecommend || 'Set tools.profile to full, or remove it to restore the default profile.'),
      },
      {
        id: 'capToolAllow',
        status: toolAllow.length === 0 ? 'pass' : 'warn',
        section: 'tools',
        icon: 'checklist',
        current: toolAllow.length === 0 ? (o?.capNotConfigured || 'Not configured') : `${toolAllow.length} item(s)`,
        recommendation: toolAllow.length === 0
          ? (o?.capAllowOk || 'No tool whitelist is limiting capabilities.')
          : (o?.capAllowRecommend || 'Review tools.allow. Anything not on the allow list will be unavailable.'),
      },
      {
        id: 'capToolDeny',
        status: highImpactDenyList.length === 0 ? 'pass' : 'fail',
        section: 'tools',
        icon: 'block',
        current: highImpactDenyList.length === 0 ? (o?.capNotConfigured || 'Not configured') : impactedTools,
        recommendation: highImpactDenyList.length === 0
          ? (o?.capDenyOk || 'No high-impact tools are denied.')
          : (o?.capDenyRecommend || 'Review tools.deny and remove blocked shell, browser, web, or file tools if you want full capability.'),
      },
      {
        id: 'capCommandsBash',
        status: commandsBashEnabled ? 'pass' : 'fail',
        section: 'commands',
        icon: 'terminal',
        current: `commands.bash = ${commandsBashEnabled}`,
        recommendation: commandsBashEnabled
          ? (o?.capBashOk || 'Command execution is enabled.')
          : (o?.capBashRecommend || 'Enable commands.bash if you want the assistant to run terminal commands.'),
      },
      {
        id: 'capBrowserEnabled',
        status: browserEnabled ? 'pass' : 'warn',
        section: 'browser',
        icon: 'language',
        current: `browser.enabled = ${browserEnabled}`,
        recommendation: browserEnabled
          ? (o?.capBrowserOk || 'Browser automation is enabled.')
          : (o?.capBrowserRecommend || 'Enable browser.enabled if you want page navigation, browsing, and web automation.'),
      },
      {
        id: 'capBrowserEval',
        status: !browserEnabled ? 'warn' : browserEvaluateEnabled ? 'pass' : 'warn',
        section: 'browser',
        icon: 'code',
        current: `browser.evaluateEnabled = ${browserEvaluateEnabled}`,
        recommendation: !browserEnabled
          ? (o?.capBrowserEvalBlocked || 'Browser automation is off, so page evaluation is unavailable too.')
          : browserEvaluateEnabled
            ? (o?.capBrowserEvalOk || 'Page evaluation is enabled.')
            : (o?.capBrowserEvalRecommend || 'Enable browser.evaluateEnabled if you want more complex page interaction.'),
      },
      {
        id: 'capWebSearch',
        status: webSearchEnabled ? 'pass' : 'warn',
        section: 'browser',
        icon: 'travel_explore',
        current: `tools.web.search.enabled = ${webSearchEnabled}`,
        recommendation: webSearchEnabled
          ? (o?.capWebSearchOk || 'Web search is enabled.')
          : (o?.capWebSearchRecommend || 'Enable tools.web.search.enabled to improve online search capability.'),
      },
      {
        id: 'capWebFetch',
        status: webFetchEnabled ? 'pass' : 'warn',
        section: 'browser',
        icon: 'pageview',
        current: `tools.web.fetch.enabled = ${webFetchEnabled}`,
        recommendation: webFetchEnabled
          ? (o?.capWebFetchOk || 'Web fetch is enabled.')
          : (o?.capWebFetchRecommend || 'Enable tools.web.fetch.enabled if you want the assistant to reliably read page content.'),
      },
      {
        id: 'capMediaImage',
        status: imageEnabled ? 'pass' : 'warn',
        section: 'tools',
        icon: 'image',
        current: `tools.media.image.enabled = ${imageEnabled}`,
        recommendation: imageEnabled
          ? (o?.capMediaImageOk || 'Image understanding is enabled.')
          : (o?.capMediaImageRecommend || 'Enable tools.media.image.enabled for image understanding tasks.'),
      },
      {
        id: 'capMediaAudio',
        status: audioEnabled ? 'pass' : 'warn',
        section: 'tools',
        icon: 'graphic_eq',
        current: `tools.media.audio.enabled = ${audioEnabled}`,
        recommendation: audioEnabled
          ? (o?.capMediaAudioOk || 'Audio understanding is enabled.')
          : (o?.capMediaAudioRecommend || 'Enable tools.media.audio.enabled for audio understanding tasks.'),
      },
      {
        id: 'capMediaVideo',
        status: videoEnabled ? 'pass' : 'warn',
        section: 'tools',
        icon: 'video_library',
        current: `tools.media.video.enabled = ${videoEnabled}`,
        recommendation: videoEnabled
          ? (o?.capMediaVideoOk || 'Video understanding is enabled.')
          : (o?.capMediaVideoRecommend || 'Enable tools.media.video.enabled for video understanding tasks.'),
      },
    ];
  }, [
    audioEnabled,
    browserEnabled,
    browserEvaluateEnabled,
    commandsBashEnabled,
    highImpactDenyList,
    imageEnabled,
    o,
    toolAllow.length,
    toolProfile,
    videoEnabled,
    webFetchEnabled,
    webSearchEnabled,
  ]);

  const capabilityIssueCount = useMemo(() => capabilityChecks.filter(item => item.status !== 'pass').length, [capabilityChecks]);
  const capabilityFailCount = useMemo(() => capabilityChecks.filter(item => item.status === 'fail').length, [capabilityChecks]);

  // Auto-expand first problematic section on first load
  useEffect(() => {
    if (!loading && firstLoad && checks.length > 0) {
      setFirstLoad(false);
      for (let i = 0; i < checks.length; i++) {
        if (checks[i].items.some(it => it.status !== 'pass')) {
          setActiveSection(sectionKeys[i]);
          break;
        }
      }
    }
  }, [loading, firstLoad, checks]);

  // Reset wizard
  const resetWizard = useCallback(() => {
    try { localStorage.removeItem(WIZARD_STORAGE_KEY); } catch {}
    setAppliedScenarios(new Set());
    setQaFields({ name: '', personality: '', language: '', role: '', userName: '', userInfo: '' });
    setQaGenerated(false);
    setQaPreviewContent({ identity: '', user: '' });
    setQaApplied(false);
    setActiveStep('check');
    toast('success', o?.wizardReset);
  }, [o, toast]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const openFileEditor = useCallback(async (agentId: string, fileName: string) => {
    try {
      const res = await gwApi.agentFileGet(agentId, fileName);
      setEditingFile({ agentId, fileName, content: (res as any)?.file?.content || '' });
    } catch {
      setEditingFile({ agentId, fileName, content: '' });
    }
  }, []);

  const saveFile = useCallback(async () => {
    if (!editingFile) return;
    setSaving(true);
    try {
      await gwApi.agentFileSet(editingFile.agentId, editingFile.fileName, editingFile.content);
      toast('success', o?.saved);
      await fetchAll();
    } catch (err: any) { toast('error', err?.message || o?.saveFailed); }
    setSaving(false);
    setEditingFile(null);
  }, [editingFile, fetchAll, toast, o]);

  const openFileWithTemplate = useCallback((agentId: string, fileName: string) => {
    const tpls = dbTemplates.filter(t => t.target_file === fileName);
    if (tpls.length > 0) {
      const resolved = resolveI18n(tpls[0]);
      setEditingFile({ agentId, fileName, content: resolved.content });
    } else {
      setEditingFile({ agentId, fileName, content: '' });
    }
  }, [dbTemplates, resolveI18n]);

  const applyTemplateToEditor = useCallback((tpl: any) => {
    if (!editingFile) return;
    const resolved = resolveI18n(tpl);
    setEditingFile({ ...editingFile, content: resolved.content });
  }, [editingFile, resolveI18n]);

  const openEditorSection = useCallback((section: string) => {
    window.dispatchEvent(new CustomEvent('clawdeck:open-window', { detail: { id: 'editor', section } }));
  }, []);

  // Generate identity config from Q&A fields — IDENTITY.md + USER.md
  const generateIdentityFromQa = useCallback(() => {
    const { name, personality, language: lang, role, userName, userInfo } = qaFields;
    const finalName = name || o?.qaDefaultName;
    const finalPersonality = personality || o?.qaDefaultPersonality;
    const finalRole = role || o?.qaDefaultRole;
    const finalLang = lang || o?.qaDefaultLanguage;
    const finalUserName = userName || o?.qaDefaultUserName;

    // IDENTITY.md — agent identity card
    const identityLines = [
      '# IDENTITY.md',
      '',
      `- **Name:** ${finalName}`,
      `- **Creature:** ${finalRole}`,
      `- **Vibe:** ${finalPersonality}`,
      '',
    ];

    // USER.md — user profile
    const userLines = [
      '# USER.md',
      '',
      `- **Name:** ${finalUserName}`,
      `- **Language:** ${finalLang}`,
      ...(userInfo ? ['', '## Context', '', userInfo] : []),
      '',
    ];

    setQaPreviewContent({ identity: identityLines.join('\n'), user: userLines.join('\n') });
    setQaGenerated(true);
  }, [qaFields, o]);

  // Apply identity preset — writes both IDENTITY.md + USER.md
  const applyIdentityPreset = useCallback((preset: AgentTemplate) => {
    if (!defaultAgentId) return;
    const identityContent = preset.content.identityContent || '';
    const userContent = preset.content.userContent || '';
    const files: { fileName: string; mode: 'replace'; content: string }[] = [
      { fileName: 'IDENTITY.md', mode: 'replace', content: identityContent },
      ...(userContent ? [{ fileName: 'USER.md' as const, mode: 'replace' as const, content: userContent }] : []),
    ];
    setPendingApply({
      scenarioId: `preset_${preset.id}`,
      request: {
        agentId: defaultAgentId,
        title: preset.metadata.name || preset.id,
        files,
      },
    });
  }, [defaultAgentId]);

  // Apply Q&A generated identity
  const applyQaIdentity = useCallback(() => {
    if (!defaultAgentId) return;
    const files: { fileName: string; mode: 'replace'; content: string }[] = [
      { fileName: 'IDENTITY.md', mode: 'replace', content: qaPreviewContent.identity },
      ...(qaPreviewContent.user ? [{ fileName: 'USER.md' as const, mode: 'replace' as const, content: qaPreviewContent.user }] : []),
    ];
    setPendingApply({
      scenarioId: 'qa_identity',
        request: { agentId: defaultAgentId, title: o?.identityQaTitle, files },
    });
    setQaApplied(true);
  }, [defaultAgentId, qaPreviewContent, o]);

  const handleApplyDone = useCallback(async () => {
    if (pendingApply) {
      const sid = pendingApply.scenarioId;
      setAppliedScenarios(prev => new Set(prev).add(sid));
    }
    setPendingApply(null);
    await fetchAll();
  }, [pendingApply, fetchAll]);

  // Handle scenario apply from ScenarioLibraryV2
  const handleApplyScenario = useCallback((scenario: ScenarioTemplate) => {
    setAppliedScenarios(prev => new Set(prev).add(scenario.id));
    toast('success', o?.scenarioApplied || 'Scenario applied');
    fetchAll();
  }, [o, toast, fetchAll]);


  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const statusDot = (s: CheckStatus) => s === 'pass' ? 'bg-mac-green' : s === 'warn' ? 'bg-mac-yellow' : 'bg-mac-red';

  const renderGoEditorHint = (hint: string, configPath?: string, showButton: boolean = true) => (
    <div className="mt-2 sm:ms-7 flex flex-col gap-1.5 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-start sm:items-center gap-2 flex-1 min-w-0">
          <span className="material-symbols-outlined text-[14px] text-primary shrink-0 mt-0.5 sm:mt-0">lightbulb</span>
          <span className="text-[10px] text-primary/80 dark:text-primary/60">{hint}</span>
        </div>
        {showButton && onOpenEditor && (
          <button onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-primary text-white font-bold flex items-center gap-1 hover:bg-primary/90 transition-colors shrink-0 self-start sm:self-auto">
            <span className="material-symbols-outlined text-[12px]">settings</span>{o?.goEditor}
          </button>
        )}
      </div>
      {configPath && (
        <div className="sm:ms-5 flex items-center gap-1.5 text-[11px] text-primary/60 dark:text-primary/40">
          <span className="material-symbols-outlined text-[12px] shrink-0">route</span>
          <span className="font-medium break-all sm:break-normal">{o?.configPath}: {configPath}</span>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <span className="material-symbols-outlined text-4xl text-primary animate-spin">progress_activity</span>
          <p className="text-xs text-slate-400 dark:text-white/40 mt-3">{o?.scanning}</p>
        </div>
      </div>
    );
  }

  if (gwError) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-mac-red/10 flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-[32px] text-mac-red">cloud_off</span>
          </div>
          <h2 className="text-sm font-bold text-slate-700 dark:text-white/80 mb-2">{o?.gwErrorTitle}</h2>
          <p className="text-[11px] text-slate-500 dark:text-white/40 mb-1">{o?.gwErrorDesc}</p>
          <p className="text-[10px] text-slate-400 dark:text-white/30 font-mono mb-4">{gwError}</p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={fetchAll}
              className="text-[11px] px-4 py-2 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px]">refresh</span>{o?.gwErrorRetry}
            </button>
            {onOpenEditor && (
              <button onClick={onOpenEditor}
                className="text-[11px] px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/50 font-bold hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">settings</span>{o?.goEditor}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // File editor modal
  // ---------------------------------------------------------------------------

  const renderFileEditor = () => {
    if (!editingFile) return null;
    const available = dbTemplates.filter(t => t.target_file === editingFile.fileName);
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6" onClick={() => setEditingFile(null)}>
        <div className="bg-white dark:bg-[#1a1c20] rounded-xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] sm:max-h-[80vh] h-full sm:h-auto sm:min-h-[50vh] flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-slate-200 dark:border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary">description</span>
              <span className="text-xs font-bold text-slate-700 dark:text-white/80 font-mono">{editingFile.fileName}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowTemplates(!showTemplates)}
                className={`text-[10px] px-2.5 py-1 rounded-lg font-bold transition-colors flex items-center gap-1 ${showTemplates ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:text-primary'}`}>
                <span className="material-symbols-outlined text-[12px]">auto_fix_high</span>
                {o?.templateSidebar}
              </button>
              <button onClick={saveFile} disabled={saving}
                className="text-[10px] px-3 py-1.5 bg-primary text-white rounded-lg font-bold disabled:opacity-40 flex items-center gap-1 hover:bg-primary/90 transition-colors">
                <span className={`material-symbols-outlined text-[12px] ${saving ? 'animate-spin' : ''}`}>{saving ? 'progress_activity' : 'save'}</span>
                {saving ? o?.saving : o?.save}
              </button>
              <button onClick={() => setEditingFile(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60 p-1">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
          </div>
          <div className="flex-1 flex overflow-hidden">
            {showTemplates && available.length > 0 && (
              <div className="hidden sm:flex w-48 md:w-56 border-e border-slate-200 dark:border-white/[0.06] flex-col shrink-0">
                <div className="px-3 py-2 border-b border-slate-100 dark:border-white/[0.04]">
                  <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{o?.templateSidebar}</p>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                  {available.map(tpl => {
                    const resolved = resolveI18n(tpl);
                    return (
                      <button key={tpl.id} onClick={() => applyTemplateToEditor(tpl)}
                        className="w-full text-start p-2.5 rounded-xl border border-slate-200/60 dark:border-white/[0.06] hover:border-primary/40 hover:bg-primary/5 transition-all group">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-[14px] text-primary">{tpl.icon}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-bold text-slate-700 dark:text-white/70 group-hover:text-primary truncate">{resolved.name}</p>
                            <p className="text-[10px] text-slate-400 dark:text-white/35 truncate">{resolved.desc}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <textarea
              value={editingFile.content}
              onChange={e => setEditingFile({ ...editingFile, content: e.target.value })}
              className="flex-1 p-4 md:p-5 text-[11px] md:text-xs font-mono text-slate-700 dark:text-white/70 bg-transparent resize-none focus:outline-none custom-scrollbar leading-relaxed"
              spellCheck={false}
            />
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Step 0: Health Check
  // ---------------------------------------------------------------------------

  const checkItemAction = (itemId: string): { label: string; action: () => void } | null => {
    switch (itemId) {
      case 'provider': case 'primary': case 'fallback': case 'heartbeatModel': case 'subagentModel':
        return { label: o?.goEditor, action: () => openEditorSection('models') };
      case 'identity': case 'user':
        return { label: o?.goIdentity || o?.goEditor, action: () => handleStepChange('identity') };
      case 'memoryFlush':
        return { label: o?.goMemory || o?.goEditor, action: () => handleStepChange('memory') };
      case 'channel':
        return { label: o?.goEditor, action: () => openEditorSection('channels') };
      case 'authMode': case 'tlsEnabled':
        return { label: o?.goEditor, action: () => openEditorSection('gateway') };
      default: return null;
    }
  };

  const renderCheckItem = (item: CheckItem & { weight?: number }) => {
    const act = item.status !== 'pass' ? checkItemAction(item.id) : null;
    return (
      <div key={item.id} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg group">
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(item.status)}`} />
        <span className="material-symbols-outlined text-[14px] text-slate-400 dark:text-white/35">{item.icon}</span>
        <span className={`text-[11px] flex-1 ${item.status === 'pass' ? 'text-slate-400 dark:text-white/40' : 'text-slate-600 dark:text-white/60'}`}>{(o as any)?.[item.id] || item.id}</span>
        {act && (
          <button onClick={act.action}
            className="text-[10px] px-2 py-0.5 rounded-md text-primary hover:bg-primary/10 font-bold transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0">
            <span className="material-symbols-outlined text-[10px]">arrow_forward</span>{act.label}
          </button>
        )}
      </div>
    );
  };

  const renderIdentityActions = () => {
    const agentId = defaultAgentId;
    if (!agentId) return <p className="text-[10px] text-slate-400">{o?.noAgent}</p>;
    const files = ['IDENTITY.md', 'USER.md'];
    return (
      <div className="space-y-1.5 mt-2">
        {files.map(f => {
          const exists = hasFile(f);
          return (
            <div key={f} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-50/50 dark:bg-white/[0.015]">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${exists ? 'bg-mac-green' : 'bg-mac-yellow'}`} />
              <span className="text-[10px] font-mono font-semibold text-slate-600 dark:text-white/50 flex-1">{f}</span>
              <button onClick={() => openFileEditor(agentId, f)}
                className="text-[11px] px-2 py-0.5 rounded-md text-primary hover:bg-primary/5 font-bold transition-colors">
                {exists ? o?.edit : o?.create}
              </button>
              {!exists && (
                <button onClick={() => openFileWithTemplate(agentId, f)}
                  className="text-[11px] px-2 py-0.5 rounded-md border border-primary/30 text-primary hover:bg-primary/5 font-bold transition-colors flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-[10px]">auto_fix_high</span>{o?.useTemplate}
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderChannelActions = () => (
    <div className="space-y-2.5 mt-2">
      {activeChannels.length > 0 && (
        <div className="space-y-1">
          {activeChannels.map((ch: any, i: number) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50/50 dark:bg-white/[0.015]">
              <div className="w-1.5 h-1.5 rounded-full bg-mac-green animate-pulse shrink-0" />
              <span className="text-[10px] font-semibold text-slate-600 dark:text-white/50 flex-1">{ch.label || ch.name || ch.id}</span>
              <span className="text-[10px] text-mac-green font-bold">{o?.connected}</span>
            </div>
          ))}
        </div>
      )}
      {activeChannels.length === 0 && renderGoEditorHint(o?.noChannelHint, o?.channelConfigPath)}
    </div>
  );

  const renderMemoryActions = () => (
    <div className="space-y-2.5 mt-2">
      {!memoryFlushEnabled && renderGoEditorHint(o?.memoryFlushHint, o?.memoryFlushConfigPath)}
    </div>
  );

  const renderSecurityActions = () => (
    <div className="space-y-2.5 mt-2">
      {authIsNone && renderGoEditorHint(o?.securityAuthHint, o?.securityAuthPath)}
      {!hasTls && renderGoEditorHint(o?.securityTlsHint, o?.securityTlsPath)}
    </div>
  );

  const sectionRenderers: Record<string, () => React.ReactNode> = {
    identity: renderIdentityActions,
    memory: renderMemoryActions,
    channel: renderChannelActions,
    security: renderSecurityActions,
  };

  const renderStepCheck = () => {
    const readinessMsg = scorePercent >= 80 ? o?.readinessReady : scorePercent >= 40 ? o?.readinessAlmost : o?.readinessNeedSetup;
    const readinessColor = scorePercent >= 80 ? 'mac-green' : scorePercent >= 40 ? 'amber-500' : 'mac-red';
    const isComplete = failCount === 0;

    return (
      <div className="space-y-4">
        {/* Version update warning */}
        {versionInfo?.updateAvailable && (
          <div className="rounded-2xl border border-amber-300/40 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/[0.04] p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[16px] text-amber-600 dark:text-amber-400">system_update</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">{o?.versionUpdateTitle}</p>
              <p className="text-[10px] text-amber-600/70 dark:text-amber-400/60">{o?.versionCurrent}: {versionInfo.current} → {versionInfo.latest}</p>
            </div>
          </div>
        )}

        {/* Completion CTA — show when all checks pass */}
        {isComplete && (
          <div className="rounded-2xl border-2 border-mac-green/40 bg-gradient-to-br from-mac-green/[0.06] to-emerald-500/[0.03] p-5 text-center">
            <div className="text-3xl mb-2">🎉</div>
            <h3 className="text-sm font-bold text-mac-green mb-1">{o?.completionTitle}</h3>
            <p className="text-[11px] text-slate-500 dark:text-white/40 mb-4">{o?.completionDesc}</p>
            <div className="flex items-center justify-center gap-3">
              {onOpenChat && (
                <button onClick={onOpenChat}
                  className="text-[11px] px-5 py-2.5 rounded-xl bg-mac-green text-white font-bold hover:bg-mac-green/90 transition-colors flex items-center gap-1.5 shadow-sm">
                  <span className="material-symbols-outlined text-[16px]">chat</span>{o?.completionGoChat}
                </button>
              )}
              <button onClick={() => window.dispatchEvent(new CustomEvent('clawdeck:open-window', { detail: { id: 'knowledge' } }))}
                className="text-[11px] px-4 py-2 rounded-xl border border-mac-green/30 text-mac-green font-bold hover:bg-mac-green/5 transition-colors flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">lightbulb</span>{o?.completionGoTips}
              </button>
            </div>
          </div>
        )}

        {/* Readiness banner */}
        {!isComplete && (
          <div className={`rounded-2xl border p-4 ${scorePercent >= 80 ? 'border-mac-green/30 bg-mac-green/[0.04]' : scorePercent >= 40 ? 'border-amber-300/40 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/[0.04]' : 'border-primary/30 bg-primary/[0.04]'}`}>
            <div className="flex items-center gap-4">
              <div className="relative w-14 h-14 shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="4" className="text-slate-200 dark:text-white/10" />
                  <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="4"
                    strokeDasharray={`${scorePercent * 1.696} 169.6`}
                    className={`transition-all duration-700 text-${readinessColor}`}
                    strokeLinecap="round" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-sm font-bold text-${readinessColor}`}>{scorePercent}%</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-xs font-bold text-slate-700 dark:text-white/80">{o?.readinessTitle}</h3>
                <p className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5">{readinessMsg}</p>
              </div>
            </div>
          </div>
        )}

        {/* Smart recommendation removed */}

        {/* Check sections */}
        {checks.map((section, si) => {
          const sectionKey = sectionKeys[si];
          const isOpen = activeSection === sectionKey;
          const sectionPass = section.items.filter(i => i.status === 'pass').length;
          const sectionTotal = section.items.length;
          const allPass = sectionPass === sectionTotal;
          const isRequired = section.required;
          return (
            <div key={sectionKey} className={`rounded-2xl border transition-all ${isOpen ? 'border-primary/30 bg-white dark:bg-white/[0.02] shadow-sm' : allPass ? 'border-mac-green/20 bg-mac-green/[0.03]' : 'border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'}`}>
              <button onClick={() => setActiveSection(isOpen ? null : sectionKey)}
                className="w-full flex items-center gap-3 px-4 py-3 text-start">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${allPass ? 'bg-mac-green/10' : 'bg-primary/10'}`}>
                  <span className={`material-symbols-outlined text-[16px] ${allPass ? 'text-mac-green' : 'text-primary'}`}>
                    {allPass ? 'check_circle' : section.icon}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-white/80">{section.section}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isRequired ? 'bg-mac-red/10 text-mac-red' : 'bg-primary/10 text-primary/70'}`}>
                      {isRequired ? o?.requiredLabel : o?.recommendedLabel}
                    </span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-bold ${allPass ? 'bg-mac-green/10 text-mac-green' : 'bg-primary/10 text-primary'}`}>
                      {sectionPass}/{sectionTotal}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-white/35 mt-0.5 truncate">{section.desc}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {section.items.map(item => (
                    <div key={item.id} className={`w-1.5 h-1.5 rounded-full ${statusDot(item.status)}`} />
                  ))}
                </div>
                <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>expand_more</span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4">
                  <div className="border-t border-slate-100 dark:border-white/[0.04] pt-2">
                    {section.items.map(item => renderCheckItem(item))}
                    {sectionKey === 'model' && !allPass && renderGoEditorHint(o?.modelGoEditorHint, o?.modelConfigPath)}
                    {sectionRenderers[sectionKey]?.()}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderStepCapability = () => {
    const statusTone = capabilityFailCount > 0
      ? 'border-red-300/50 dark:border-red-500/20 bg-red-50/60 dark:bg-red-500/[0.04]'
      : capabilityIssueCount > 0
        ? 'border-amber-300/50 dark:border-amber-500/20 bg-amber-50/60 dark:bg-amber-500/[0.04]'
        : 'border-mac-green/30 bg-mac-green/[0.04]';

    const groups = [
      { key: 'core', title: o?.capGroupCore || 'Core restrictions', ids: ['capToolProfile', 'capToolAllow', 'capToolDeny', 'capCommandsBash'] },
      { key: 'web', title: o?.capGroupWeb || 'Browsing and web access', ids: ['capBrowserEnabled', 'capBrowserEval', 'capWebSearch', 'capWebFetch'] },
      { key: 'media', title: o?.capGroupMedia || 'Multimodal capability', ids: ['capMediaImage', 'capMediaAudio', 'capMediaVideo'] },
    ];

    return (
      <div className="space-y-4">
        <div className={`rounded-2xl border p-4 ${statusTone}`}>
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${capabilityIssueCount === 0 ? 'bg-mac-green/10' : capabilityFailCount > 0 ? 'bg-red-500/10' : 'bg-amber-500/10'}`}>
              <span className={`material-symbols-outlined text-[20px] ${capabilityIssueCount === 0 ? 'text-mac-green' : capabilityFailCount > 0 ? 'text-red-500' : 'text-amber-500'}`}>tune</span>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xs font-bold text-slate-700 dark:text-white/80">{o?.capabilityTitle || 'Capability Limits'}</h3>
              <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5">{o?.capabilitySubtitle || 'These settings directly change what OpenClaw can do, even if the system is otherwise healthy.'}</p>
              <p className="text-[11px] font-medium mt-2 text-slate-600 dark:text-white/55">
                {capabilityIssueCount === 0
                  ? (o?.capSummaryOk || 'No major capability restrictions detected.')
                  : capabilityFailCount > 0
                    ? (o?.capSummaryLimited || '{count} high-impact restriction(s) detected.').replace('{count}', String(capabilityFailCount))
                    : (o?.capSummaryReview || '{count} optimization item(s) worth reviewing.').replace('{count}', String(capabilityIssueCount))}
              </p>
            </div>
          </div>
        </div>

        {groups.map(group => {
          const items = capabilityChecks.filter(item => group.ids.includes(item.id));
          return (
            <div key={group.key} className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h4 className="text-xs font-bold text-slate-700 dark:text-white/80">{group.title}</h4>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 dark:bg-white/[0.05] text-slate-500 dark:text-white/45">
                  {items.filter(item => item.status !== 'pass').length}/{items.length}
                </span>
              </div>
              <div className="space-y-3">
                {items.map(item => {
                  const tone = item.status === 'pass'
                    ? 'border-mac-green/20 bg-mac-green/[0.03]'
                    : item.status === 'fail'
                      ? 'border-red-300/40 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/[0.04]'
                      : 'border-amber-300/40 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/[0.04]';
                  const chip = item.status === 'pass'
                    ? 'bg-mac-green/10 text-mac-green'
                    : item.status === 'fail'
                      ? 'bg-red-500/10 text-red-500'
                      : 'bg-amber-500/10 text-amber-500';
                  return (
                    <div key={item.id} className={`rounded-xl border p-3 ${tone}`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.status === 'pass' ? 'bg-mac-green/10' : item.status === 'fail' ? 'bg-red-500/10' : 'bg-amber-500/10'}`}>
                          <span className={`material-symbols-outlined text-[18px] ${item.status === 'pass' ? 'text-mac-green' : item.status === 'fail' ? 'text-red-500' : 'text-amber-500'}`}>{item.icon}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[12px] font-bold text-slate-700 dark:text-white/80">{(o as any)?.[item.id] || item.id}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${chip}`}>
                              {item.status === 'pass' ? (o?.capStatusOk || 'OK') : item.status === 'fail' ? (o?.capStatusLimited || 'Limited') : (o?.capStatusReview || 'Review')}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-white/40 mt-1 font-mono break-all">{item.current}</p>
                          <p className="text-[11px] text-slate-600 dark:text-white/55 mt-2 leading-relaxed">{item.recommendation}</p>
                          {item.status !== 'pass' && (
                            <div className="flex items-center gap-2 mt-3 flex-wrap">
                              <button
                                onClick={() => openEditorSection(item.section)}
                                className="text-[10px] px-2.5 py-1 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors flex items-center gap-1"
                              >
                                <span className="material-symbols-outlined text-[12px]">settings</span>
                                {o?.capOpenConfig || o?.goEditor || 'Open Config Center'}
                              </button>
                              <span className="text-[10px] text-slate-400 dark:text-white/35">
                                {(o?.capOpenPath || 'Section: {section}').replace('{section}', item.section)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Step 2: Identity Setup (IDENTITY.md + USER.md)
  // ---------------------------------------------------------------------------

  const renderStepIdentity = () => {
    const agentId = defaultAgentId;

    const renderQaField = (key: string, labelKey: string, placeholderKey: string) => (
      <div key={key}>
        <label className="text-[10px] font-bold text-slate-600 dark:text-white/50 mb-1 block">{(o as any)?.[labelKey]}</label>
        <input type="text" value={(qaFields as any)[key]}
          onChange={e => setQaFields(prev => ({ ...prev, [key]: e.target.value }))}
          placeholder={(o as any)?.[placeholderKey]}
          className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-slate-700 dark:text-white/70 placeholder:text-slate-300 dark:placeholder:text-white/20 focus:outline-none focus:border-primary/50" />
      </div>
    );

    const renderFileCard = (pf: typeof IDENTITY_FILES[number]) => {
      const exists = hasFile(pf.name);
      return (
        <div key={pf.name} className={`rounded-2xl border p-4 transition-all ${exists ? 'border-mac-green/30 bg-mac-green/[0.03]' : 'border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'}`}>
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${exists ? 'bg-mac-green/10' : 'bg-primary/10'}`}>
              <span className={`material-symbols-outlined text-[20px] ${exists ? 'text-mac-green' : 'text-primary'}`}>{pf.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 dark:text-white/80">{(o as any)?.[pf.titleKey]}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${exists ? 'bg-mac-green/10 text-mac-green' : 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                  {exists ? o?.fileExists : o?.fileMissing}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1 leading-relaxed">{(o as any)?.[pf.descKey]}</p>
            </div>
          </div>
          {agentId && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
              <button onClick={() => openFileEditor(agentId, pf.name)}
                className="text-[10px] px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-bold hover:bg-primary/20 transition-colors flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">{exists ? 'edit' : 'add'}</span>
                {exists ? o?.edit : o?.create}
              </button>
              {!exists && (
                <button onClick={() => openFileWithTemplate(agentId, pf.name)}
                  className="text-[10px] px-3 py-1.5 rounded-lg border border-primary/30 text-primary font-bold hover:bg-primary/5 transition-colors flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">auto_fix_high</span>
                  {o?.useTemplate}
                </button>
              )}
            </div>
          )}
          {!agentId && <p className="text-[11px] text-slate-400 mt-2">{o?.noAgent}</p>}
        </div>
      );
    };

    return (
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <button onClick={() => setIdentityMode('qa')}
            className={`text-[10px] px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1 ${identityMode === 'qa' ? 'bg-primary text-white' : 'text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/[0.04]'}`}>
            <span className="material-symbols-outlined text-[12px]">chat</span>{o?.identityModeQa}
          </button>
          <button onClick={() => setIdentityMode('manual')}
            className={`text-[10px] px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1 ${identityMode === 'manual' ? 'bg-primary text-white' : 'text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/[0.04]'}`}>
            <span className="material-symbols-outlined text-[12px]">edit_note</span>{o?.identityModeManual}
          </button>
        </div>

        {identityMode === 'qa' && (
          <div className="space-y-4">
            {/* Identity presets */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 dark:text-white/40 mb-2">{o?.presetTitle}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {agentPresets.map(preset => (
                    <button key={preset.id} onClick={() => setPresetPreview(preset)}
                      className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-3 text-start hover:border-primary/30 hover:shadow-sm transition-all group">
                      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${preset.metadata.color || 'from-primary to-primary/80'} flex items-center justify-center mb-2`}>
                        <span className="material-symbols-outlined text-[16px] text-white">{preset.metadata.icon || 'person'}</span>
                      </div>
                      <p className="text-[10px] font-bold text-slate-700 dark:text-white/80 group-hover:text-primary">{preset.metadata.name}</p>
                      <p className="text-[10px] text-slate-400 dark:text-white/35 mt-0.5 leading-relaxed">{preset.metadata.description}</p>
                    </button>
                ))}
              </div>
            </div>

            {/* Q&A form */}
            <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 space-y-3">
              <div>
                <h4 className="text-xs font-bold text-slate-700 dark:text-white/80">{o?.identityQaTitle}</h4>
                <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{o?.identityQaSubtitle}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {renderQaField('name', 'qaName', 'qaNamePlaceholder')}
                {renderQaField('role', 'qaRole', 'qaRolePlaceholder')}
                {renderQaField('personality', 'qaPersonality', 'qaPersonalityPlaceholder')}
                {renderQaField('language', 'qaLanguage', 'qaLanguagePlaceholder')}
                {renderQaField('userName', 'qaUserName', 'qaUserNamePlaceholder')}
                {renderQaField('userInfo', 'qaUserInfo', 'qaUserInfoPlaceholder')}
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button onClick={generateIdentityFromQa}
                  className="text-[10px] px-4 py-2 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>{o?.qaGenerate}
                </button>
                {qaGenerated && <span className="text-[11px] text-mac-green font-bold">{o?.qaGenerated}</span>}
              </div>
            </div>

            {/* Q&A preview — IDENTITY.md + USER.md */}
            {qaGenerated && (
              <div className="rounded-2xl border border-primary/20 bg-primary/[0.02] p-4 space-y-3">
                <h4 className="text-[10px] font-bold text-primary">{o?.qaPreview}</h4>
                <div className="rounded-lg bg-slate-50 dark:bg-white/[0.02] p-3">
                  <p className="text-[10px] font-bold text-primary mb-1">IDENTITY.md</p>
                  <pre className="text-[11px] text-slate-600 dark:text-white/50 whitespace-pre-wrap font-mono leading-relaxed">{qaPreviewContent.identity}</pre>
                </div>
                {qaPreviewContent.user && (
                  <div className="rounded-lg bg-slate-50 dark:bg-white/[0.02] p-3">
                    <p className="text-[10px] font-bold text-primary mb-1">USER.md</p>
                    <pre className="text-[11px] text-slate-600 dark:text-white/50 whitespace-pre-wrap font-mono leading-relaxed">{qaPreviewContent.user}</pre>
                  </div>
                )}
                <button onClick={applyQaIdentity} disabled={qaApplied}
                  className="text-[10px] px-4 py-2 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors flex items-center gap-1 disabled:opacity-50">
                  <span className="material-symbols-outlined text-[14px]">{qaApplied ? 'check' : 'play_arrow'}</span>
                  {qaApplied ? o?.qaApplied : o?.qaApply}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Manual edit mode — IDENTITY.md + USER.md */}
        {identityMode === 'manual' && (
          <div className="space-y-4">
            {IDENTITY_FILES.map(pf => renderFileCard(pf))}
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Step 2: Memory
  // ---------------------------------------------------------------------------

  const renderStepMemory = () => {
    const memoryItems = [
      { titleKey: 'dailyLogTitle', descKey: 'dailyLogDesc', icon: 'calendar_today', hasIt: true },
      { titleKey: 'memoryFlushTitle', descKey: 'memoryFlushDesc', icon: 'sync', hasIt: memoryFlushEnabled },
    ];
    return (
      <div className="space-y-4">
        {/* Simplified toggle + examples */}
        <div className={`rounded-2xl border p-4 ${memoryFlushEnabled ? 'border-mac-green/20 bg-mac-green/[0.02]' : 'border-primary/20 bg-primary/[0.03]'}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${memoryFlushEnabled ? 'bg-mac-green/10' : 'bg-primary/10'}`}>
              <span className={`material-symbols-outlined text-[20px] ${memoryFlushEnabled ? 'text-mac-green' : 'text-primary'}`}>psychology</span>
            </div>
            <div className="flex-1">
              <h4 className="text-xs font-bold text-slate-700 dark:text-white/80">{o?.memoryToggleTitle}</h4>
              <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{o?.memoryToggleDesc}</p>
            </div>
          </div>
          <div className="ms-13 space-y-1.5">
            <p className="text-[11px] font-bold text-slate-500 dark:text-white/40">{o?.memoryExamples}</p>
            {[o?.memoryEx1, o?.memoryEx2, o?.memoryEx3, o?.memoryEx4].map((ex, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/40">
                <span className="material-symbols-outlined text-[12px] text-primary/50">check_circle</span>
                <span>{ex}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-500/15 text-[10px] text-amber-700 dark:text-amber-400/80 flex items-start gap-2">
          <span className="material-symbols-outlined text-[14px] mt-0.5 shrink-0">tips_and_updates</span>
          <span>{o?.memoryTip}</span>
        </div>
        <div className="space-y-3">
          {memoryItems.map((mi, idx) => (
              <div key={idx} className={`rounded-2xl border p-4 transition-all ${mi.hasIt ? 'border-mac-green/20 bg-mac-green/[0.02]' : 'border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'}`}>
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${mi.hasIt ? 'bg-mac-green/10' : 'bg-slate-100 dark:bg-white/[0.04]'}`}>
                    <span className={`material-symbols-outlined text-[18px] ${mi.hasIt ? 'text-mac-green' : 'text-slate-400 dark:text-white/40'}`}>{mi.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-700 dark:text-white/80">{(o as any)?.[mi.titleKey]}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${mi.hasIt ? 'bg-mac-green/10 text-mac-green' : 'bg-slate-100 dark:bg-white/[0.04] text-slate-400 dark:text-white/40'}`}>
                        {mi.hasIt ? o?.fixed : o?.fix}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1 leading-relaxed">{(o as any)?.[mi.descKey]}</p>
                  </div>
                </div>
              </div>
          ))}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Step 3: Scenarios (使用新的 ScenarioLibraryV2 组件)
  // ---------------------------------------------------------------------------

  const renderStepScenarios = () => (
    <ScenarioLibraryV2
      language={language}
      defaultAgentId={defaultAgentId}
      onApplyScenario={handleApplyScenario}
    />
  );


  // ---------------------------------------------------------------------------
  // Step content router
  // ---------------------------------------------------------------------------

  const stepContent: Record<StepKey, () => React.ReactNode> = {
    check: renderStepCheck,
    capability: renderStepCapability,
    scenarios: renderStepScenarios,
    identity: renderStepIdentity,
    memory: renderStepMemory,
  };

  const currentStepIdx = STEPS.findIndex(s => s.key === activeStep);
  const stepTitle = (o as any)?.[
    activeStep === 'check'
      ? 'stepCheck'
      : activeStep === 'capability'
        ? 'stepCapability'
        : activeStep === 'identity'
          ? 'identityStepTitle'
          : activeStep === 'memory'
            ? 'memoryTitle'
            : 'scenarioTitle'
  ] || activeStep;

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50 dark:bg-transparent">
      {/* Header */}
      <div className="shrink-0 px-4 md:px-6 pt-4 md:pt-5 pb-3 md:pb-4 border-b border-slate-200/60 dark:border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-primary">auto_fix_high</span>
              {o?.title}
            </h1>
            <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5 truncate">{o?.subtitle}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={resetWizard} className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-all" title={o?.resetWizard}>
              <span className="material-symbols-outlined text-[16px]">restart_alt</span>
            </button>
            <button onClick={fetchAll} className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all" title={o?.refresh}>
              <span className="material-symbols-outlined text-[16px]">refresh</span>
            </button>
            {onDismiss && (
              <button onClick={() => { try { localStorage.setItem(WIZARD_DISMISSED_KEY, '1'); } catch {} onDismiss(); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white/60 hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-all" title={o?.dismissWizard}>
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
            {/* Score ring */}
            <div className="relative w-14 h-14 md:w-16 md:h-16 ms-1">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="3.5" className="text-slate-200 dark:text-white/10" />
                <circle cx="32" cy="32" r="27" fill="none" stroke="currentColor" strokeWidth="3.5"
                  strokeDasharray={`${scorePercent * 1.696} 169.6`}
                  className={`transition-all duration-700 ${scorePercent >= 80 ? 'text-mac-green' : scorePercent >= 50 ? 'text-mac-yellow' : 'text-mac-red'}`}
                  strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-xs md:text-sm font-bold ${scorePercent >= 80 ? 'text-mac-green' : scorePercent >= 50 ? 'text-amber-600 dark:text-mac-yellow' : 'text-mac-red'}`}>{scorePercent}%</span>
                <span className="text-[9px] md:text-[10px] text-slate-400 dark:text-white/40 font-bold">
                  {failCount > 0 ? `${failCount} ${o?.itemsToFix}` : o?.allGood}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Step nav — with mobile tooltip via title attribute */}
        <div className="flex items-center gap-1 mt-3 overflow-x-auto custom-scrollbar pb-1 -mx-1 px-1">
          {STEPS.map((step, idx) => {
            const isActive = activeStep === step.key;
            const labelKey = `step${step.key.charAt(0).toUpperCase() + step.key.slice(1)}` as string;
            const label = (o as any)?.[labelKey] || step.key;
            return (
              <button key={step.key} onClick={() => handleStepChange(step.key)} title={label}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold whitespace-nowrap transition-all shrink-0 ${
                  isActive
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/[0.04]'
                }`}>
                <span className="material-symbols-outlined text-[14px]">{step.icon}</span>
                <span className="hidden sm:inline">{label}</span>
                {idx === 0 && failCount > 0 && !isActive && (
                  <span className="w-4 h-4 rounded-full bg-mac-red/10 text-mac-red text-[10px] font-bold flex items-center justify-center">{failCount}</span>
                )}
                {step.key === 'capability' && capabilityIssueCount > 0 && !isActive && (
                  <span className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${capabilityFailCount > 0 ? 'bg-mac-red/10 text-mac-red' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                    {capabilityIssueCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content — with tab transition */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        <div className={`max-w-6xl mx-auto transition-opacity duration-150 ${tabTransition ? 'opacity-0' : 'opacity-100'}`}>
          {stepContent[activeStep]?.()}
        </div>
      </div>

      {/* File editor modal */}
      {renderFileEditor()}

      {/* Preset preview modal */}
      {presetPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPresetPreview(null)}>
          <div className="bg-white dark:bg-[#1a1c20] rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-white/[0.06]">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${presetPreview.metadata.color || 'from-primary to-primary/80'} flex items-center justify-center`}>
                  <span className="material-symbols-outlined text-[14px] text-white">{presetPreview.metadata.icon || 'person'}</span>
                </div>
                <span className="text-xs font-bold text-slate-700 dark:text-white/80">
                  {presetPreview.metadata.name}
                </span>
              </div>
              <button onClick={() => setPresetPreview(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60 p-1">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-3">
              <div className="rounded-lg bg-slate-50 dark:bg-white/[0.02] p-3">
                <p className="text-[10px] font-bold text-primary mb-1">IDENTITY.md</p>
                <pre className="text-[11px] text-slate-600 dark:text-white/50 whitespace-pre-wrap font-mono leading-relaxed">{presetPreview.content.identityContent || ''}</pre>
              </div>
              {presetPreview.content.userContent && (
                <div className="rounded-lg bg-slate-50 dark:bg-white/[0.02] p-3">
                  <p className="text-[10px] font-bold text-primary mb-1">USER.md</p>
                  <pre className="text-[11px] text-slate-600 dark:text-white/50 whitespace-pre-wrap font-mono leading-relaxed">{presetPreview.content.userContent}</pre>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 dark:border-white/[0.04]">
              <button onClick={() => setPresetPreview(null)}
                className="text-[10px] px-3 py-1.5 rounded-lg text-slate-500 dark:text-white/40 font-bold hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                {o?.cancel}
              </button>
              <button onClick={() => { applyIdentityPreset(presetPreview); setPresetPreview(null); }}
                className="text-[10px] px-4 py-1.5 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">play_arrow</span>{o?.qaApply}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File apply confirm dialog */}
      {pendingApply && (
        <FileApplyConfirm
          request={pendingApply.request}
          locale={(t as any).fileApply || {}}
          onDone={handleApplyDone}
          onCancel={() => setPendingApply(null)}
        />
      )}
    </div>
  );
};

export default UsageWizard;
