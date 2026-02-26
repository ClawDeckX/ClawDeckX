import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi, templateApi } from '../services/api';
import { useToast } from '../components/Toast';
import { FileApplyConfirm, FileApplyRequest } from '../components/FileApplyConfirm';

interface UsageWizardProps {
  language: Language;
  onOpenEditor?: () => void;
}

type CheckStatus = 'pass' | 'warn' | 'fail';

interface CheckItem {
  id: string;
  icon: string;
  status: CheckStatus;
}

// Step definitions — reordered: check → scenarios → persona → memory → automation → tips
const STEPS = [
  { key: 'check', icon: 'verified' },
  { key: 'scenarios', icon: 'category' },
  { key: 'persona', icon: 'face' },
  { key: 'memory', icon: 'psychology' },
  { key: 'automation', icon: 'schedule' },
  { key: 'tips', icon: 'lightbulb' },
] as const;

type StepKey = typeof STEPS[number]['key'];

// Persona files
const PERSONA_FILES = [
  { name: 'SOUL.md', titleKey: 'soulTitle', descKey: 'soulDesc', icon: 'psychology' },
  { name: 'IDENTITY.md', titleKey: 'identityTitle', descKey: 'identityDesc', icon: 'badge' },
  { name: 'USER.md', titleKey: 'userTitle', descKey: 'userDesc', icon: 'person' },
  { name: 'AGENTS.md', titleKey: 'agentsTitle', descKey: 'agentsDesc', icon: 'gavel' },
] as const;

// Persona preset templates
interface PersonaPreset {
  id: string;
  icon: string;
  color: string;
  soulContent: { zh: string; en: string };
  userContent: { zh: string; en: string };
}

const PERSONA_PRESETS: PersonaPreset[] = [
  { id: 'professional', icon: 'work', color: 'from-blue-500 to-blue-600',
    soulContent: {
      zh: '# 核心性格\n\n你是一个专业高效的 AI 助手。\n\n## 行为准则\n- 回答简洁精准，注重事实和数据\n- 使用专业但易懂的语言\n- 主动提供相关建议和替代方案\n- 遇到不确定的问题，诚实说明并建议验证方式\n\n## 语气风格\n- 正式但不生硬\n- 条理清晰，善用列表和结构化输出\n- 重要信息加粗标注\n',
      en: '# Core Personality\n\nYou are a professional and efficient AI assistant.\n\n## Behavior Guidelines\n- Give concise, accurate answers focused on facts and data\n- Use professional but accessible language\n- Proactively offer relevant suggestions and alternatives\n- Be honest about uncertainty and suggest verification methods\n\n## Tone\n- Formal but not stiff\n- Well-structured, use lists and organized output\n- Bold important information\n',
    },
    userContent: { zh: '', en: '' },
  },
  { id: 'friendly', icon: 'mood', color: 'from-amber-500 to-amber-600',
    soulContent: {
      zh: '# 核心性格\n\n你是一个活泼有趣的 AI 伙伴。\n\n## 行为准则\n- 用轻松幽默的方式交流\n- 适当使用表情和比喻让对话更生动\n- 关心用户的感受，给予鼓励和支持\n- 在保持有趣的同时确保信息准确\n\n## 语气风格\n- 亲切随和，像朋友聊天\n- 偶尔开个小玩笑\n- 用简单直白的语言\n',
      en: '# Core Personality\n\nYou are a fun and engaging AI buddy.\n\n## Behavior Guidelines\n- Communicate in a casual, humorous way\n- Use emojis and metaphors to make conversations lively\n- Care about the user\'s feelings, offer encouragement\n- Stay accurate while being entertaining\n\n## Tone\n- Friendly and casual, like chatting with a friend\n- Occasional light humor\n- Simple, straightforward language\n',
    },
    userContent: { zh: '', en: '' },
  },
  { id: 'butler', icon: 'spa', color: 'from-emerald-500 to-emerald-600',
    soulContent: {
      zh: '# 核心性格\n\n你是一个温暖体贴的 AI 管家。\n\n## 行为准则\n- 主动关心用户的需求和状态\n- 提前预判可能需要的帮助\n- 细心记住用户的偏好和习惯\n- 用温暖的语气提供建议，不强迫\n\n## 语气风格\n- 温暖亲切，像贴心的管家\n- 耐心细致，不催促\n- 适时给予关心和提醒\n',
      en: '# Core Personality\n\nYou are a warm and caring AI butler.\n\n## Behavior Guidelines\n- Proactively care about user\'s needs and state\n- Anticipate potential needs before being asked\n- Remember user\'s preferences and habits\n- Offer suggestions warmly without being pushy\n\n## Tone\n- Warm and caring, like a thoughtful butler\n- Patient and attentive, never rushing\n- Offer timely care and reminders\n',
    },
    userContent: { zh: '', en: '' },
  },
  { id: 'scholar', icon: 'school', color: 'from-violet-500 to-violet-600',
    soulContent: {
      zh: '# 核心性格\n\n你是一个博学的 AI 学术顾问。\n\n## 行为准则\n- 深入分析问题，提供多角度见解\n- 引用相关理论和研究支持观点\n- 鼓励批判性思维和独立思考\n- 复杂问题分步骤解释\n\n## 语气风格\n- 严谨但不枯燥\n- 善于用类比解释复杂概念\n- 鼓励提问和深入探讨\n',
      en: '# Core Personality\n\nYou are a knowledgeable AI academic advisor.\n\n## Behavior Guidelines\n- Analyze problems deeply, offer multi-perspective insights\n- Reference relevant theories and research\n- Encourage critical thinking and independent thought\n- Break down complex problems step by step\n\n## Tone\n- Rigorous but not dry\n- Good at using analogies for complex concepts\n- Encourage questions and deep discussion\n',
    },
    userContent: { zh: '', en: '' },
  },
];

// Scenario definitions with templates and requirements
interface ScenarioDef {
  id: string;
  icon: string;
  color: string;
  difficulty: 'easy' | 'medium' | 'hard';
  newbie?: boolean;
  soulSnippet: { zh: string; en: string };
  heartbeatSnippet: { zh: string; en: string };
  requires?: { skills?: string[]; channels?: boolean };
}

const SCENARIOS: ScenarioDef[] = [
  { id: 'assistant', icon: 'assistant', color: 'from-primary to-primary/80', difficulty: 'easy', newbie: true,
    soulSnippet: {
      zh: '\n## 个人助手\n- 回答问题时简洁准确，必要时提供详细解释\n- 主动记住用户的偏好和重要信息\n- 帮助管理待办事项和提醒\n- 遇到不确定的问题，诚实说明\n',
      en: '\n## Personal Assistant\n- Answer questions concisely and accurately, provide details when needed\n- Proactively remember user preferences and important info\n- Help manage todos and reminders\n- Be honest about uncertainty\n',
    },
    heartbeatSnippet: {
      zh: '\n- [ ] 检查是否有待办事项需要提醒\n- [ ] 检查用户之前提到的重要事项\n',
      en: '\n- [ ] Check if there are todos that need reminding\n- [ ] Check important items mentioned by user previously\n',
    },
  },
  { id: 'email', icon: 'mail', color: 'from-blue-500 to-blue-600', difficulty: 'medium',
    soulSnippet: {
      zh: '\n## 邮件管家\n- 每次心跳检查未读邮件，按重要程度分类\n- 重要邮件立即通知我，普通邮件汇总\n- 可以帮我草拟回复，但发送前必须确认\n',
      en: '\n## Email Manager\n- Check unread emails during each heartbeat, classify by importance\n- Notify me immediately for important emails, summarize others\n- Draft replies for me, but always confirm before sending\n',
    },
    heartbeatSnippet: {
      zh: '\n- [ ] 检查未读邮件，分类并汇总\n- [ ] 重要邮件立即通知用户\n',
      en: '\n- [ ] Check unread emails, classify and summarize\n- [ ] Notify user immediately for important emails\n',
    },
    requires: { skills: ['gog'] },
  },
  { id: 'calendar', icon: 'calendar_month', color: 'from-green-500 to-green-600', difficulty: 'medium',
    soulSnippet: {
      zh: '\n## 日程管理\n- 每天早上汇报今日日程\n- 会议前 15 分钟提醒\n- 检测日程冲突并建议调整\n',
      en: '\n## Calendar Manager\n- Brief me on today\'s schedule every morning\n- Remind me 15 minutes before meetings\n- Detect schedule conflicts and suggest adjustments\n',
    },
    heartbeatSnippet: {
      zh: '\n- [ ] 检查今日日程，提醒即将到来的会议\n- [ ] 检测日程冲突\n',
      en: '\n- [ ] Check today\'s schedule, remind upcoming meetings\n- [ ] Detect schedule conflicts\n',
    },
    requires: { skills: ['gog'] },
  },
  { id: 'task', icon: 'checklist', color: 'from-amber-500 to-amber-600', difficulty: 'easy',
    soulSnippet: {
      zh: '\n## 任务追踪\n- 维护待办事项清单，记录在 memory 中\n- 心跳时检查截止日期，提前提醒\n- 完成任务后自动更新状态\n',
      en: '\n## Task Tracker\n- Maintain todo list in memory files\n- Check deadlines during heartbeat, remind in advance\n- Auto-update status when tasks are completed\n',
    },
    heartbeatSnippet: {
      zh: '\n- [ ] 检查待办事项截止日期\n- [ ] 提醒即将到期的任务\n',
      en: '\n- [ ] Check todo deadlines\n- [ ] Remind about upcoming due tasks\n',
    },
  },
  { id: 'dev', icon: 'code', color: 'from-violet-500 to-violet-600', difficulty: 'medium',
    soulSnippet: {
      zh: '\n## 开发助手\n- 监控 GitHub Issue 和 PR\n- CI/CD 失败时立即通知\n- 代码审查时给出建设性建议\n',
      en: '\n## Dev Assistant\n- Monitor GitHub issues and PRs\n- Notify immediately on CI/CD failures\n- Give constructive suggestions during code review\n',
    },
    heartbeatSnippet: {
      zh: '\n- [ ] 检查 GitHub 新 Issue 和 PR\n- [ ] 检查 CI/CD 状态\n',
      en: '\n- [ ] Check new GitHub issues and PRs\n- [ ] Check CI/CD status\n',
    },
    requires: { skills: ['github'] },
  },
  { id: 'knowledge', icon: 'menu_book', color: 'from-cyan-500 to-cyan-600', difficulty: 'easy',
    soulSnippet: {
      zh: '\n## 知识管理\n- 对话中提到的重要信息自动归档到 memory\n- 支持语义搜索历史知识\n- 定期整理和去重知识库\n',
      en: '\n## Knowledge Manager\n- Auto-archive important info from conversations to memory\n- Support semantic search of historical knowledge\n- Periodically organize and deduplicate knowledge base\n',
    },
    heartbeatSnippet: {
      zh: '\n- [ ] 整理近期对话中的重要信息\n- [ ] 检查知识库是否需要更新\n',
      en: '\n- [ ] Organize important info from recent conversations\n- [ ] Check if knowledge base needs updating\n',
    },
  },
  { id: 'family', icon: 'family_restroom', color: 'from-pink-500 to-pink-600', difficulty: 'easy',
    soulSnippet: {
      zh: '\n## 家庭助手\n- 管理家庭日程和提醒事项\n- 维护购物清单\n- 语气温暖友好，适合家庭场景\n',
      en: '\n## Family Assistant\n- Manage family schedule and reminders\n- Maintain shopping lists\n- Use warm, friendly tone suitable for family context\n',
    },
    heartbeatSnippet: {
      zh: '\n- [ ] 检查家庭日程提醒\n- [ ] 检查购物清单是否需要补充\n',
      en: '\n- [ ] Check family schedule reminders\n- [ ] Check if shopping list needs updating\n',
    },
  },
  { id: 'team', icon: 'groups', color: 'from-indigo-500 to-indigo-600', difficulty: 'hard',
    soulSnippet: {
      zh: '\n## 团队协作\n- 支持多人通过不同频道与我交互\n- 根据频道和用户身份调整回复风格\n- 团队相关信息共享，个人信息隔离\n',
      en: '\n## Team Collaboration\n- Support multi-user interaction via different channels\n- Adjust response style based on channel and user identity\n- Share team info, isolate personal info\n',
    },
    heartbeatSnippet: {
      zh: '\n- [ ] 检查各频道未处理的消息\n- [ ] 汇总团队待办事项\n',
      en: '\n- [ ] Check unprocessed messages across channels\n- [ ] Summarize team todos\n',
    },
    requires: { channels: true },
  },
];

// Automation templates
interface AutoTemplateDef {
  id: string;
  icon: string;
  color: string;
  heartbeatContent: { zh: string; en: string };
}

const AUTO_TEMPLATES: AutoTemplateDef[] = [
  { id: 'dailyBrief', icon: 'wb_sunny', color: 'from-amber-400 to-amber-500',
    heartbeatContent: {
      zh: '\n- [ ] 汇报今日天气和日程安排\n- [ ] 提醒今日待办事项和截止日期\n- [ ] 总结昨日未完成的任务\n',
      en: '\n- [ ] Report today\'s weather and schedule\n- [ ] Remind about today\'s todos and deadlines\n- [ ] Summarize yesterday\'s unfinished tasks\n',
    },
  },
  { id: 'reminder', icon: 'alarm', color: 'from-blue-400 to-blue-500',
    heartbeatContent: {
      zh: '\n- [ ] 检查用户设置的提醒事项\n- [ ] 到期提醒立即通知\n',
      en: '\n- [ ] Check user-set reminders\n- [ ] Notify immediately for due reminders\n',
    },
  },
  { id: 'emailCheck', icon: 'mark_email_unread', color: 'from-red-400 to-red-500',
    heartbeatContent: {
      zh: '\n- [ ] 检查未读邮件\n- [ ] 按重要程度分类汇总\n- [ ] 重要邮件立即通知\n',
      en: '\n- [ ] Check unread emails\n- [ ] Classify and summarize by importance\n- [ ] Notify immediately for important emails\n',
    },
  },
];

// Tip definitions with status detection and editor section navigation
interface TipDef {
  id: string;
  icon: string;
  color: string;
  editorSection: string;
  docUrl?: string;
}

const TIPS: TipDef[] = [
  { id: 'Routing', icon: 'alt_route', color: 'bg-blue-500', editorSection: 'channels', docUrl: 'https://docs.openclaw.ai/configuration#channels' },
  { id: 'Session', icon: 'history', color: 'bg-green-500', editorSection: 'session', docUrl: 'https://docs.openclaw.ai/configuration#compaction' },
  { id: 'Security', icon: 'shield', color: 'bg-orange-500', editorSection: 'channels', docUrl: 'https://docs.openclaw.ai/configuration#security' },
  { id: 'Cost', icon: 'savings', color: 'bg-emerald-500', editorSection: 'models', docUrl: 'https://docs.openclaw.ai/configuration#heartbeat' },
  { id: 'MultiAgent', icon: 'group_work', color: 'bg-violet-500', editorSection: 'agents', docUrl: 'https://docs.openclaw.ai/configuration#agents' },
  { id: 'Thinking', icon: 'neurology', color: 'bg-pink-500', editorSection: 'models', docUrl: 'https://docs.openclaw.ai/configuration#models' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const UsageWizard: React.FC<UsageWizardProps> = ({ language, onOpenEditor }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const o = (t as any).ow as any;
  const { toast } = useToast();
  const bilingualLang = useMemo<'zh' | 'en'>(() => (language === 'zh' ? 'zh' : 'en'), [language]);
  const pickBilingual = useCallback((value: { zh: string; en: string }) => value[bilingualLang], [bilingualLang]);

  // Data
  const [config, setConfig] = useState<any>(null);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [agentFiles, setAgentFiles] = useState<Record<string, any[]>>({});
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);

  // UI state
  const [activeStep, setActiveStep] = useState<StepKey>('check');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<{ agentId: string; fileName: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showTemplates, setShowTemplates] = useState(true);
  const [dbTemplates, setDbTemplates] = useState<any[]>([]);
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);
  const [appliedScenarios, setAppliedScenarios] = useState<Set<string>>(new Set());
  const [pendingApply, setPendingApply] = useState<{ request: FileApplyRequest; scenarioId: string } | null>(null);

  // Persona Q&A mode
  const [personaMode, setPersonaMode] = useState<'qa' | 'manual'>('qa');
  const [qaFields, setQaFields] = useState({ name: '', personality: '', language: '', role: '', userName: '', userInfo: '' });
  const [qaGenerated, setQaGenerated] = useState(false);
  const [qaPreviewContent, setQaPreviewContent] = useState({ soul: '', user: '' });
  const [qaApplied, setQaApplied] = useState(false);

  // Automation templates
  const [appliedAutoTemplates, setAppliedAutoTemplates] = useState<Set<string>>(new Set());

  // Fetch all data
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const settle = (p: Promise<any>) => p.catch(() => null);
    const [cfgData, agentsData, channelsData] = await Promise.all([
      settle(gwApi.configGet()),
      settle(gwApi.agents()),
      settle(gwApi.channels()),
    ]);
    if (cfgData) {
      const cfg = cfgData.config || cfgData.parsed || cfgData;
      setConfig(cfg);
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
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Load templates from API
  useEffect(() => {
    templateApi.list().then((data: any) => setDbTemplates(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const resolveI18n = useCallback((tpl: any): { name: string; desc: string; content: string } => {
    try {
      const map = typeof tpl.i18n === 'string' ? JSON.parse(tpl.i18n) : tpl.i18n;
      return map[language] || map['en'] || Object.values(map)[0] as any || { name: tpl.template_id, desc: '', content: '' };
    } catch { return { name: tpl.template_id || '', desc: '', content: '' }; }
  }, [language]);

  // Auto-expand first problematic section on first load
  useEffect(() => {
    if (!loading && firstLoad) {
      setFirstLoad(false);
      const keys = ['model', 'persona', 'automation', 'channel'];
      const sections = buildChecks();
      for (let i = 0; i < sections.length; i++) {
        if (sections[i].items.some(it => it.status !== 'pass')) {
          setActiveSection(keys[i]);
          break;
        }
      }
    }
  }, [loading, firstLoad]);

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
  const memorySearch = config?.agents?.defaults?.memorySearch || {};
  const memorySearchEnabled = !!memorySearch?.provider || !!memorySearch?.local?.modelPath;
  const memoryFlush = config?.agents?.defaults?.compaction?.memoryFlush;
  const memoryFlushEnabled = memoryFlush?.enabled !== false;
  const configuredChannels = config?.channels ? Object.keys(config.channels).filter(k => config.channels[k]?.enabled !== false) : [];
  const activeChannels = channels.filter((ch: any) => ch.connected || ch.running || ch.status === 'connected');
  const hasChannels = configuredChannels.length > 0 || activeChannels.length > 0;
  const defaultFiles = defaultAgentId ? (agentFiles[defaultAgentId] || []) : [];
  const hasFile = (name: string) => defaultFiles.some((f: any) => !f.missing && f.name === name);

  function buildChecks() {
    return [
      { section: o?.secModel, desc: o?.secModelDesc, icon: 'psychology', items: [
        { id: 'provider', icon: 'cloud', status: (providerCount > 0 ? 'pass' : 'fail') as CheckStatus },
        { id: 'primary', icon: 'star', status: (primaryModel ? 'pass' : 'fail') as CheckStatus },
        { id: 'fallback', icon: 'swap_horiz', status: (fallbacks.length > 0 ? 'pass' : 'warn') as CheckStatus },
        { id: 'heartbeatModel', icon: 'favorite', status: (heartbeatModel ? 'pass' : (heartbeatOn ? 'warn' : 'pass')) as CheckStatus },
        { id: 'subagentModel', icon: 'account_tree', status: (subagentModel ? 'pass' : 'warn') as CheckStatus },
      ]},
      { section: o?.secPersona, desc: o?.secPersonaDesc, icon: 'face', items: [
        { id: 'soul', icon: 'psychology', status: (hasFile('SOUL.md') ? 'pass' : 'warn') as CheckStatus },
        { id: 'identity', icon: 'badge', status: (hasFile('IDENTITY.md') ? 'pass' : 'warn') as CheckStatus },
        { id: 'user', icon: 'person', status: (hasFile('USER.md') ? 'pass' : 'warn') as CheckStatus },
        { id: 'agents', icon: 'gavel', status: (hasFile('AGENTS.md') ? 'pass' : 'warn') as CheckStatus },
      ]},
      { section: o?.secAutomation, desc: o?.secAutoDesc, icon: 'schedule', items: [
        { id: 'heartbeat', icon: 'monitor_heart', status: (heartbeatOn ? 'pass' : 'warn') as CheckStatus },
        { id: 'heartbeatMd', icon: 'checklist', status: (hasFile('HEARTBEAT.md') ? 'pass' : 'warn') as CheckStatus },
      ]},
      { section: o?.secChannel, desc: o?.secChannelDesc, icon: 'forum', items: [
        { id: 'channel', icon: 'forum', status: (hasChannels ? 'pass' : 'warn') as CheckStatus },
      ]},
    ];
  }

  const checks = buildChecks();
  const sectionKeys = ['model', 'persona', 'automation', 'channel'];
  const totalChecks = checks.reduce((n, s) => n + s.items.length, 0);
  const passCount = checks.reduce((n, s) => n + s.items.filter(i => i.status === 'pass').length, 0);
  const failCount = totalChecks - passCount;
  const scorePercent = totalChecks > 0 ? Math.round((passCount / totalChecks) * 100) : 0;

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

  // Generate persona config from Q&A fields
  const generatePersonaFromQa = useCallback(() => {
    const { name, personality, language: lang, role, userName, userInfo } = qaFields;
    const fill = (tpl: string, params: Record<string, string>) =>
      Object.entries(params).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), tpl);
    const finalName = name || o?.qaDefaultName;
    const finalPersonality = personality || o?.qaDefaultPersonality;
    const finalRole = role || o?.qaDefaultRole;
    const finalLang = lang || o?.qaDefaultLanguage;
    const finalUserName = userName || o?.qaDefaultUserName;
    const soulLines = [
      `# ${o?.personaCoreTitle}`,
      '',
      fill(o?.personaIntroTemplate || '', {
        name: finalName,
        personality: finalPersonality,
        role: finalRole,
      }),
      '',
      `## ${o?.personaBehaviorTitle}`,
      fill(o?.personaBehaviorLangTemplate || '', { language: finalLang }),
      fill(o?.personaBehaviorAddressTemplate || '', { userName: finalUserName }),
      o?.personaBehaviorConcise,
      o?.personaBehaviorHonest,
      '',
    ];
    const userLines = userInfo ? [
      `# ${o?.personaUserInfoTitle}`,
      '',
      userInfo,
      '',
    ] : [];
    setQaPreviewContent({ soul: soulLines.join('\n'), user: userLines.join('\n') });
    setQaGenerated(true);
  }, [qaFields, o]);

  // Apply persona preset
  const applyPersonaPreset = useCallback((preset: PersonaPreset) => {
    if (!defaultAgentId) return;
    const lang = bilingualLang;
    setPendingApply({
      scenarioId: `preset_${preset.id}`,
      request: {
        agentId: defaultAgentId,
        title: (o as any)?.[`preset${preset.id.charAt(0).toUpperCase() + preset.id.slice(1)}`] || preset.id,
        files: [
          { fileName: 'SOUL.md', mode: 'replace', content: preset.soulContent[lang] },
          ...(preset.userContent[lang] ? [{ fileName: 'USER.md', mode: 'replace' as const, content: preset.userContent[lang] }] : []),
        ],
      },
    });
  }, [defaultAgentId, bilingualLang, o]);

  // Apply Q&A generated persona
  const applyQaPersona = useCallback(() => {
    if (!defaultAgentId) return;
    const files: { fileName: string; mode: 'replace'; content: string }[] = [
      { fileName: 'SOUL.md', mode: 'replace', content: qaPreviewContent.soul },
    ];
    if (qaPreviewContent.user) {
      files.push({ fileName: 'USER.md', mode: 'replace', content: qaPreviewContent.user });
    }
    setPendingApply({
      scenarioId: 'qa_persona',
        request: { agentId: defaultAgentId, title: o?.personaQaTitle, files },
    });
    setQaApplied(true);
  }, [defaultAgentId, qaPreviewContent, o]);

  // Apply automation template
  const applyAutoTemplate = useCallback((tpl: AutoTemplateDef) => {
    if (!defaultAgentId) return;
    const lang = bilingualLang;
    setPendingApply({
      scenarioId: `auto_${tpl.id}`,
      request: {
        agentId: defaultAgentId,
        title: (o as any)?.[`autoTemplate${tpl.id.charAt(0).toUpperCase() + tpl.id.slice(1)}`] || tpl.id,
        files: [{ fileName: 'HEARTBEAT.md', mode: 'append', content: tpl.heartbeatContent[lang] }],
      },
    });
  }, [defaultAgentId, bilingualLang, o]);

  // Open confirm dialog for scenario apply
  const applyScenario = useCallback((sc: ScenarioDef) => {
    if (!defaultAgentId) return;
    const lang = bilingualLang;
    const cap = sc.id.charAt(0).toUpperCase() + sc.id.slice(1);
    const titleKey = `scenario${cap}Title` as string;
    setPendingApply({
      scenarioId: sc.id,
      request: {
        agentId: defaultAgentId,
        title: (o as any)?.[titleKey] || sc.id,
        files: [
          { fileName: 'SOUL.md', mode: 'append', content: sc.soulSnippet[lang] },
          { fileName: 'HEARTBEAT.md', mode: 'append', content: sc.heartbeatSnippet[lang] },
        ],
      },
    });
  }, [defaultAgentId, bilingualLang, o]);

  const handleApplyDone = useCallback(async () => {
    if (pendingApply) {
      const sid = pendingApply.scenarioId;
      if (sid.startsWith('auto_')) {
        setAppliedAutoTemplates(prev => new Set(prev).add(sid.replace('auto_', '')));
      } else {
        setAppliedScenarios(prev => new Set(prev).add(sid));
      }
    }
    setPendingApply(null);
    await fetchAll();
  }, [pendingApply, fetchAll]);

  // Tip status detection: returns ok + detail label when configured
  const getTipStatus = useCallback((tipId: string): { ok: boolean; detail: string } => {
    switch (tipId) {
      case 'Routing': {
        const n = activeChannels.length;
          return { ok: n > 1, detail: n > 1 ? o?.tipRoutingStatus.replace('{n}', String(n)) : '' };
      }
      case 'Session': {
        const threshold = config?.agents?.defaults?.compaction?.threshold || 0;
          return { ok: threshold > 0, detail: threshold > 0 ? o?.tipSessionStatus.replace('{n}', String(threshold)) : '' };
      }
      case 'Security': {
        const hasDm = channels.some((ch: any) => ch.dmPolicy || ch.allowFrom?.length > 0);
        return { ok: hasDm, detail: hasDm ? (o?.tipSecurityStatus ?? '') : '' };
      }
      case 'Cost': {
        const m = heartbeatModel;
          return { ok: !!m, detail: m ? o?.tipCostStatus.replace('{m}', m) : '' };
      }
      case 'MultiAgent': {
        const agentCount = Object.keys(agentFiles).length;
          return { ok: agentCount > 1, detail: agentCount > 1 ? o?.tipMultiAgentStatus.replace('{n}', String(agentCount)) : '' };
      }
      case 'Thinking': {
        const reasoning = config?.agents?.defaults?.model?.reasoning === true;
        return { ok: reasoning, detail: reasoning ? (o?.tipThinkingStatus ?? '') : '' };
      }
      default: return { ok: false, detail: '' };
    }
  }, [activeChannels, config, channels, heartbeatModel, agentFiles, o]);

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const statusDot = (s: CheckStatus) => s === 'pass' ? 'bg-mac-green' : s === 'warn' ? 'bg-mac-yellow' : 'bg-mac-red';

  const renderGoEditorHint = (hint: string, configPath?: string) => (
    <div className="mt-2 sm:ml-7 flex flex-col gap-1.5 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex items-start sm:items-center gap-2 flex-1 min-w-0">
          <span className="material-symbols-outlined text-[14px] text-primary shrink-0 mt-0.5 sm:mt-0">lightbulb</span>
          <span className="text-[10px] text-primary/80 dark:text-primary/60">{hint}</span>
        </div>
        {onOpenEditor && (
          <button onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
            className="text-[10px] px-2.5 py-1 rounded-lg bg-primary text-white font-bold flex items-center gap-1 hover:bg-primary/90 transition-colors shrink-0 self-start sm:self-auto">
            <span className="material-symbols-outlined text-[12px]">settings</span>{o?.goEditor}
          </button>
        )}
      </div>
      {configPath && (
        <div className="sm:ml-5 flex items-center gap-1.5 text-[11px] text-primary/60 dark:text-primary/40">
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
              <div className="hidden sm:flex w-48 md:w-56 border-r border-slate-200 dark:border-white/[0.06] flex-col shrink-0">
                <div className="px-3 py-2 border-b border-slate-100 dark:border-white/[0.04]">
                  <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase tracking-wider">{o?.templateSidebar}</p>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
                  {available.map(tpl => {
                    const resolved = resolveI18n(tpl);
                    return (
                      <button key={tpl.id} onClick={() => applyTemplateToEditor(tpl)}
                        className="w-full text-left p-2.5 rounded-xl border border-slate-200/60 dark:border-white/[0.06] hover:border-primary/40 hover:bg-primary/5 transition-all group">
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

  const renderCheckItem = (item: CheckItem) => (
    <div key={item.id} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg">
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot(item.status)}`} />
      <span className="material-symbols-outlined text-[14px] text-slate-400 dark:text-white/35">{item.icon}</span>
      <span className={`text-[11px] flex-1 ${item.status === 'pass' ? 'text-slate-400 dark:text-white/40' : 'text-slate-600 dark:text-white/60'}`}>{(o as any)?.[item.id] || item.id}</span>
    </div>
  );

  const renderPersonaActions = () => {
    const agentId = defaultAgentId;
    if (!agentId) return <p className="text-[10px] text-slate-400">{o?.noAgent}</p>;
    const files = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'AGENTS.md'];
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

  const renderAutomationActions = () => {
    const agentId = defaultAgentId;
    return (
      <div className="space-y-2.5 mt-2">
        {!heartbeatOn && renderGoEditorHint(o?.heartbeatOff, o?.heartbeatConfigPath)}
        {agentId && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-50/50 dark:bg-white/[0.015]">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasFile('HEARTBEAT.md') ? 'bg-mac-green' : 'bg-mac-yellow'}`} />
            <span className="text-[10px] font-mono font-semibold text-slate-600 dark:text-white/50 flex-1">HEARTBEAT.md</span>
            <button onClick={() => openFileEditor(agentId, 'HEARTBEAT.md')}
              className="text-[11px] px-2 py-0.5 rounded-md text-primary hover:bg-primary/5 font-bold transition-colors">
              {hasFile('HEARTBEAT.md') ? o?.edit : o?.create}
            </button>
            {!hasFile('HEARTBEAT.md') && (
              <button onClick={() => openFileWithTemplate(agentId, 'HEARTBEAT.md')}
                className="text-[11px] px-2 py-0.5 rounded-md border border-primary/30 text-primary hover:bg-primary/5 font-bold transition-colors flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[10px]">auto_fix_high</span>{o?.useTemplate}
              </button>
            )}
          </div>
        )}
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

  const sectionRenderers: Record<string, () => React.ReactNode> = {
    persona: renderPersonaActions,
    automation: renderAutomationActions,
    channel: renderChannelActions,
  };

  // Smart recommendation logic - returns targetSection to detect duplicates with current open section
  const getRecommendation = () => {
    if (providerCount === 0 || !primaryModel) return { msg: o?.recommendModel, btn: o?.recommendGoModel, icon: 'psychology', action: () => onOpenEditor?.(), targetSection: 'model' };
    if (activeChannels.length === 0) return { msg: o?.recommendChannel, btn: o?.recommendGoChannel, icon: 'forum', action: () => onOpenEditor?.(), targetSection: 'channel' };
    if (!hasFile('SOUL.md')) return { msg: o?.recommendPersona, btn: o?.recommendGoPersona, icon: 'face', action: () => setActiveStep('persona'), targetSection: 'persona' };
    if (failCount > 0) return { msg: o?.recommendScenario, btn: o?.recommendGoScenario, icon: 'category', action: () => setActiveStep('scenarios'), targetSection: null };
    return { msg: o?.recommendExplore, btn: o?.recommendGoExplore, icon: 'lightbulb', action: () => setActiveStep('tips'), targetSection: null };
  };

  const renderStepCheck = () => {
    const rec = getRecommendation();
    const readinessMsg = scorePercent >= 80 ? o?.readinessReady : scorePercent >= 40 ? o?.readinessAlmost : o?.readinessNeedSetup;
    const readinessColor = scorePercent >= 80 ? 'mac-green' : scorePercent >= 40 ? 'amber-500' : 'mac-red';

    return (
      <div className="space-y-4">
        {/* Readiness banner */}
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

        {/* Smart recommendation - hide when targeting the same section that's currently open */}
        {failCount > 0 && rec.targetSection !== activeSection && (
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/[0.06] to-transparent p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[14px] text-primary">auto_awesome</span>
              <span className="text-[10px] font-bold text-primary">{o?.smartRecommend}</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[18px] text-primary">{rec.icon}</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-white/60 flex-1">{rec.msg}</p>
              </div>
              <button onClick={rec.action}
                className="text-[10px] px-3 py-1.5 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors shrink-0 flex items-center gap-1 self-start sm:self-auto">
                <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
                {rec.btn}
              </button>
            </div>
          </div>
        )}

        {/* Check sections */}
        {checks.map((section, si) => {
          const sectionKey = sectionKeys[si];
          const isOpen = activeSection === sectionKey;
          const sectionPass = section.items.filter(i => i.status === 'pass').length;
          const sectionTotal = section.items.length;
          const allPass = sectionPass === sectionTotal;
          const isRequired = sectionKey === 'model';
          return (
            <div key={sectionKey} className={`rounded-2xl border transition-all ${isOpen ? 'border-primary/30 bg-white dark:bg-white/[0.02] shadow-sm' : allPass ? 'border-mac-green/20 bg-mac-green/[0.03]' : 'border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'}`}>
              <button onClick={() => setActiveSection(isOpen ? null : sectionKey)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left">
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

  // ---------------------------------------------------------------------------
  // Step 2: Persona (with Q&A mode + presets + manual edit)
  // ---------------------------------------------------------------------------

  const renderStepPersona = () => {
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

    return (
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <button onClick={() => setPersonaMode('qa')}
            className={`text-[10px] px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1 ${personaMode === 'qa' ? 'bg-primary text-white' : 'text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/[0.04]'}`}>
            <span className="material-symbols-outlined text-[12px]">chat</span>{o?.personaModeQa}
          </button>
          <button onClick={() => setPersonaMode('manual')}
            className={`text-[10px] px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1 ${personaMode === 'manual' ? 'bg-primary text-white' : 'text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/[0.04]'}`}>
            <span className="material-symbols-outlined text-[12px]">edit_note</span>{o?.personaModeManual}
          </button>
        </div>

        {personaMode === 'qa' && (
          <div className="space-y-4">
            {/* Persona presets */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 dark:text-white/40 mb-2">{o?.presetTitle}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PERSONA_PRESETS.map(preset => {
                  const nameKey = `preset${preset.id.charAt(0).toUpperCase() + preset.id.slice(1)}` as string;
                  const descKey = `${nameKey}Desc` as string;
                  return (
                    <button key={preset.id} onClick={() => applyPersonaPreset(preset)}
                      className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-3 text-left hover:border-primary/30 hover:shadow-sm transition-all group">
                      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${preset.color} flex items-center justify-center mb-2`}>
                        <span className="material-symbols-outlined text-[16px] text-white">{preset.icon}</span>
                      </div>
                      <p className="text-[10px] font-bold text-slate-700 dark:text-white/80 group-hover:text-primary">{(o as any)?.[nameKey]}</p>
                      <p className="text-[10px] text-slate-400 dark:text-white/35 mt-0.5 leading-relaxed">{(o as any)?.[descKey]}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Q&A form */}
            <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 space-y-3">
              <div>
                <h4 className="text-xs font-bold text-slate-700 dark:text-white/80">{o?.personaQaTitle}</h4>
                <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{o?.personaQaSubtitle}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {renderQaField('name', 'qaName', 'qaNamePlaceholder')}
                {renderQaField('personality', 'qaPersonality', 'qaPersonalityPlaceholder')}
                {renderQaField('language', 'qaLanguage', 'qaLanguagePlaceholder')}
                {renderQaField('role', 'qaRole', 'qaRolePlaceholder')}
                {renderQaField('userName', 'qaUserName', 'qaUserNamePlaceholder')}
                {renderQaField('userInfo', 'qaUserInfo', 'qaUserInfoPlaceholder')}
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button onClick={generatePersonaFromQa}
                  className="text-[10px] px-4 py-2 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>{o?.qaGenerate}
                </button>
                {qaGenerated && <span className="text-[11px] text-mac-green font-bold">{o?.qaGenerated}</span>}
              </div>
            </div>

            {/* Q&A preview */}
            {qaGenerated && (
              <div className="rounded-2xl border border-primary/20 bg-primary/[0.02] p-4 space-y-3">
                <h4 className="text-[10px] font-bold text-primary">{o?.qaPreview}</h4>
                <div className="rounded-lg bg-slate-50 dark:bg-white/[0.02] p-3">
                  <p className="text-[10px] font-bold text-primary mb-1">SOUL.md</p>
                  <pre className="text-[11px] text-slate-600 dark:text-white/50 whitespace-pre-wrap font-mono leading-relaxed">{qaPreviewContent.soul}</pre>
                </div>
                {qaPreviewContent.user && (
                  <div className="rounded-lg bg-slate-50 dark:bg-white/[0.02] p-3">
                    <p className="text-[10px] font-bold text-primary mb-1">USER.md</p>
                    <pre className="text-[11px] text-slate-600 dark:text-white/50 whitespace-pre-wrap font-mono leading-relaxed">{qaPreviewContent.user}</pre>
                  </div>
                )}
                <button onClick={applyQaPersona} disabled={qaApplied}
                  className="text-[10px] px-4 py-2 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors flex items-center gap-1 disabled:opacity-50">
                  <span className="material-symbols-outlined text-[14px]">{qaApplied ? 'check' : 'play_arrow'}</span>
                  {qaApplied ? o?.qaApplied : o?.qaApply}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Manual edit mode — original file cards */}
        {personaMode === 'manual' && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-primary/5 border border-primary/15 text-[10px] text-primary/80 dark:text-primary/60 flex items-start gap-2">
              <span className="material-symbols-outlined text-[14px] mt-0.5 shrink-0">tips_and_updates</span>
              <span>{o?.personaTip}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PERSONA_FILES.map(pf => {
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
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Step 2: Memory
  // ---------------------------------------------------------------------------

  const renderStepMemory = () => {
    const agentId = defaultAgentId;
    const memoryItems = [
      { titleKey: 'memoryMdTitle', descKey: 'memoryMdDesc', icon: 'save', file: 'MEMORY.md', hasIt: hasFile('MEMORY.md') },
      { titleKey: 'dailyLogTitle', descKey: 'dailyLogDesc', icon: 'calendar_today', file: null, hasIt: true },
      { titleKey: 'vectorSearchTitle', descKey: 'vectorSearchDesc', icon: 'search', file: null, hasIt: memorySearchEnabled },
      { titleKey: 'memoryFlushTitle', descKey: 'memoryFlushDesc', icon: 'sync', file: null, hasIt: memoryFlushEnabled },
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
          <div className="ml-13 space-y-1.5">
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
                      {mi.hasIt ? (mi.file ? o?.fileExists : o?.vectorSearchEnabled) : (mi.file ? o?.fileMissing : o?.vectorSearchDisabled)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1 leading-relaxed">{(o as any)?.[mi.descKey]}</p>
                </div>
              </div>
              {mi.file && agentId && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                  <button onClick={() => openFileEditor(agentId, mi.file!)}
                    className="text-[10px] px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-bold hover:bg-primary/20 transition-colors flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">{mi.hasIt ? 'edit' : 'add'}</span>
                    {mi.hasIt ? o?.edit : o?.create}
                  </button>
                </div>
              )}
              {!mi.file && !mi.hasIt && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                  {renderGoEditorHint(o?.configureSearch, o?.memorySearchConfigPath)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Step 3: Automation
  // ---------------------------------------------------------------------------

  const renderStepAutomation = () => {
    const agentId = defaultAgentId;
    return (
      <div className="space-y-4">
        {/* Heartbeat visual explanation */}
        <div className="rounded-2xl border border-primary/15 bg-primary/[0.03] p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px] text-primary animate-pulse">monitor_heart</span>
            </div>
            <div className="flex-1">
              <p className="text-[10px] text-slate-600 dark:text-white/50 leading-relaxed">{o?.heartbeatExplain}</p>
            </div>
          </div>
        </div>

        {/* Automation templates */}
        <div>
          <p className="text-[10px] font-bold text-slate-500 dark:text-white/40 mb-2">{o?.autoTemplateTitle}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {AUTO_TEMPLATES.map(tpl => {
              const nameKey = `autoTemplate${tpl.id.charAt(0).toUpperCase() + tpl.id.slice(1)}` as string;
              const descKey = `${nameKey}Desc` as string;
              const isApplied = appliedAutoTemplates.has(tpl.id);
              return (
                <div key={tpl.id} className={`rounded-xl border p-3 transition-all ${isApplied ? 'border-mac-green/30 bg-mac-green/[0.03]' : 'border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${tpl.color} flex items-center justify-center shrink-0`}>
                      <span className="material-symbols-outlined text-[14px] text-white">{tpl.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-slate-700 dark:text-white/80">{(o as any)?.[nameKey]}</p>
                      <p className="text-[10px] text-slate-400 dark:text-white/35">{(o as any)?.[descKey]}</p>
                    </div>
                  </div>
                  {agentId && (
                    <button onClick={() => !isApplied && applyAutoTemplate(tpl)} disabled={isApplied}
                      className={`w-full text-[11px] px-2 py-1.5 rounded-lg font-bold transition-colors flex items-center justify-center gap-1 ${isApplied ? 'bg-mac-green/10 text-mac-green' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}>
                      <span className="material-symbols-outlined text-[12px]">{isApplied ? 'check' : 'play_arrow'}</span>
                      {isApplied ? o?.autoTemplateApplied : o?.autoTemplateApply}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-3 rounded-xl bg-primary/5 border border-primary/15 text-[10px] text-primary/80 dark:text-primary/60 flex items-start gap-2">
          <span className="material-symbols-outlined text-[14px] mt-0.5 shrink-0">tips_and_updates</span>
          <span>{o?.autoTip}</span>
        </div>

        {/* Heartbeat */}
        <div className={`rounded-2xl border p-4 ${heartbeatOn ? 'border-mac-green/20 bg-mac-green/[0.02]' : 'border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'}`}>
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${heartbeatOn ? 'bg-mac-green/10' : 'bg-slate-100 dark:bg-white/[0.04]'}`}>
              <span className={`material-symbols-outlined text-[20px] ${heartbeatOn ? 'text-mac-green' : 'text-slate-400'}`}>monitor_heart</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 dark:text-white/80">{o?.heartbeatTitle}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${heartbeatOn ? 'bg-mac-green/10 text-mac-green' : 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                  {heartbeatOn ? o?.heartbeatEnabled : o?.heartbeatDisabled}
                </span>
                {heartbeatOn && <span className="text-[10px] text-slate-400 dark:text-white/35">{o?.heartbeatInterval}: {heartbeatEvery}</span>}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1 leading-relaxed">{o?.heartbeatDesc}</p>
            </div>
          </div>
          {!heartbeatOn && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
              {renderGoEditorHint(o?.heartbeatOff, o?.heartbeatConfigPath)}
            </div>
          )}
        </div>

        {/* HEARTBEAT.md */}
        <div className={`rounded-2xl border p-4 ${hasFile('HEARTBEAT.md') ? 'border-mac-green/20 bg-mac-green/[0.02]' : 'border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'}`}>
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${hasFile('HEARTBEAT.md') ? 'bg-mac-green/10' : 'bg-slate-100 dark:bg-white/[0.04]'}`}>
              <span className={`material-symbols-outlined text-[20px] ${hasFile('HEARTBEAT.md') ? 'text-mac-green' : 'text-slate-400'}`}>checklist</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 dark:text-white/80">{o?.heartbeatMdTitle}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${hasFile('HEARTBEAT.md') ? 'bg-mac-green/10 text-mac-green' : 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                  {hasFile('HEARTBEAT.md') ? o?.fileExists : o?.fileMissing}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1 leading-relaxed">{o?.heartbeatMdDesc}</p>
            </div>
          </div>
          {agentId && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
              <button onClick={() => openFileEditor(agentId, 'HEARTBEAT.md')}
                className="text-[10px] px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-bold hover:bg-primary/20 transition-colors flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">{hasFile('HEARTBEAT.md') ? 'edit' : 'add'}</span>
                {hasFile('HEARTBEAT.md') ? o?.edit : o?.create}
              </button>
              {!hasFile('HEARTBEAT.md') && (
                <button onClick={() => openFileWithTemplate(agentId, 'HEARTBEAT.md')}
                  className="text-[10px] px-3 py-1.5 rounded-lg border border-primary/30 text-primary font-bold hover:bg-primary/5 transition-colors flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">auto_fix_high</span>{o?.useTemplate}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Cron vs Heartbeat */}
        <div className="rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-100 dark:bg-violet-500/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px] text-violet-500">compare_arrows</span>
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-bold text-slate-700 dark:text-white/80">{o?.cronVsHeartbeat}</span>
              <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1 leading-relaxed">{o?.cronVsHeartbeatDesc}</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Step 4: Scenarios
  // ---------------------------------------------------------------------------

  const renderStepScenarios = () => {
    const agentId = defaultAgentId;
    const difficultyLabel = (d: string) => d === 'easy' ? o?.scenarioDifficultyEasy : d === 'medium' ? o?.scenarioDifficultyMedium : o?.scenarioDifficultyHard;
    const difficultyColor = (d: string) => d === 'easy' ? 'bg-mac-green/10 text-mac-green' : d === 'medium' ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400';
    return (
      <div className="space-y-4">
        <p className="text-[10px] text-slate-400 dark:text-white/40">{o?.scenarioSubtitle}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SCENARIOS.map(sc => {
            const cap = sc.id.charAt(0).toUpperCase() + sc.id.slice(1);
            const titleKey = `scenario${cap}Title` as string;
            const descKey = `scenario${cap}Desc` as string;
            const isApplied = appliedScenarios.has(sc.id);
            const needsSkill = sc.requires?.skills?.length ? sc.requires.skills : null;
            const needsChannel = sc.requires?.channels && activeChannels.length === 0;
            const allReady = !needsSkill && !needsChannel;

            return (
              <div key={sc.id} className={`rounded-2xl border transition-all ${sc.newbie && !isApplied ? 'ring-2 ring-primary/20 ' : ''}${isApplied ? 'border-mac-green/30 bg-mac-green/[0.03]' : 'border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] hover:border-primary/20'}`}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${sc.color} flex items-center justify-center shrink-0 shadow-sm`}>
                      <span className="material-symbols-outlined text-[20px] text-white">{sc.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-700 dark:text-white/80">{(o as any)?.[titleKey]}</span>
                        {sc.newbie && !isApplied && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-primary/10 text-primary flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[10px]">star</span>{o?.scenarioRecommendNewbie}
                          </span>
                        )}
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${difficultyColor(sc.difficulty)}`}>
                          {difficultyLabel(sc.difficulty)}
                        </span>
                        {isApplied && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-mac-green/10 text-mac-green flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[10px]">check</span>{o?.scenarioApplied}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1 leading-relaxed">{(o as any)?.[descKey]}</p>
                      {(needsSkill || needsChannel) && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {needsSkill?.map(sk => (
                            <span key={sk} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">
                              {o?.scenarioNeedSkill}: {sk}
                            </span>
                          ))}
                          {needsChannel && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">
                              {o?.scenarioNeedChannel}
                            </span>
                          )}
                        </div>
                      )}
                      {allReady && !isApplied && (
                        <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-mac-green/10 text-mac-green font-bold mt-2">
                          {o?.scenarioAllReady}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => setExpandedScenario(sc.id)}
                      className="text-[10px] px-2.5 py-1 rounded-lg text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/[0.04] font-bold transition-colors flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">visibility</span>
                      {o?.scenarioExpand}
                    </button>
                    {agentId && !isApplied && (
                      <button onClick={() => applyScenario(sc)}
                        className="text-[10px] px-3 py-1 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors flex items-center gap-1 ml-auto">
                        <span className="material-symbols-outlined text-[12px]">play_arrow</span>
                        {o?.scenarioApply}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Scenario detail modal */}
        {expandedScenario && (() => {
          const sc = SCENARIOS.find(s => s.id === expandedScenario);
          if (!sc) return null;
          const cap = sc.id.charAt(0).toUpperCase() + sc.id.slice(1);
          const titleKey = `scenario${cap}Title` as string;
          const descKey = `scenario${cap}Desc` as string;
          const snippet = pickBilingual(sc.soulSnippet);
          const hbSnippet = pickBilingual(sc.heartbeatSnippet);
          const isApplied = appliedScenarios.has(sc.id);
          return (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-2 sm:p-4" onClick={() => setExpandedScenario(null)}>
              <div className="bg-white dark:bg-[#1a1c20] rounded-xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] sm:max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Modal header */}
                <div className="flex items-center gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-200 dark:border-white/[0.06] shrink-0">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${sc.color} flex items-center justify-center shrink-0 shadow-sm`}>
                    <span className="material-symbols-outlined text-[20px] text-white">{sc.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-white">{(o as any)?.[titleKey]}</h3>
                    <p className="text-[11px] text-slate-400 dark:text-white/40 mt-0.5">{(o as any)?.[descKey]}</p>
                  </div>
                  <button onClick={() => setExpandedScenario(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60 p-1 shrink-0">
                    <span className="material-symbols-outlined text-[20px]">close</span>
                  </button>
                </div>
                {/* Modal body */}
                <div className="flex-1 overflow-y-auto custom-scrollbar px-4 sm:px-5 py-3 sm:py-4 space-y-4">
                  <div>
                    <p className="text-[11px] font-bold text-slate-600 dark:text-white/50 mb-2 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px] text-primary">psychology</span>
                      {o?.scenarioSoulSnippet}
                    </p>
                    <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3 sm:p-4">
                      <pre className="text-[11px] sm:text-xs text-slate-700 dark:text-white/60 whitespace-pre-wrap font-mono leading-relaxed">{snippet.trim()}</pre>
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-slate-600 dark:text-white/50 mb-2 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px] text-primary">monitor_heart</span>
                      {o?.scenarioHeartbeatSnippet}
                    </p>
                    <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3 sm:p-4">
                      <pre className="text-[11px] sm:text-xs text-slate-700 dark:text-white/60 whitespace-pre-wrap font-mono leading-relaxed">{hbSnippet.trim()}</pre>
                    </div>
                  </div>
                </div>
                {/* Modal footer */}
                <div className="flex items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t border-slate-200 dark:border-white/[0.06] shrink-0">
                  <button onClick={() => setExpandedScenario(null)}
                    className="text-[11px] px-3 py-1.5 rounded-lg text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/[0.04] font-bold transition-colors">
                {o?.cancel || o?.close}
                  </button>
                  {agentId && !isApplied && (
                    <button onClick={() => { applyScenario(sc); setExpandedScenario(null); }}
                      className="text-[11px] px-4 py-1.5 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                      {o?.scenarioApply}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Step 5: Tips
  // ---------------------------------------------------------------------------

  const renderStepTips = () => (
    <div className="space-y-4">
      <p className="text-[10px] text-slate-400 dark:text-white/40">{o?.tipsSubtitle}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TIPS.map(tip => {
          const titleKey = `tip${tip.id}Title` as string;
          const descKey = `tip${tip.id}Desc` as string;
          const guideKey = `tip${tip.id}Guide` as string;
          const status = getTipStatus(tip.id);
          return (
            <div key={tip.id} className={`rounded-2xl border transition-all ${status.ok ? 'border-mac-green/20 bg-mac-green/[0.02]' : 'border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]'} p-4`}>
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl ${tip.color} flex items-center justify-center shrink-0`}>
                  <span className="material-symbols-outlined text-[18px] text-white">{tip.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-white/80">{(o as any)?.[titleKey]}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold flex items-center gap-0.5 ${status.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                      <span className="material-symbols-outlined text-[10px]">{status.ok ? 'check_circle' : 'info'}</span>
                      {status.ok ? (status.detail || o?.tipDone) : o?.tipTodo}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-white/40 mt-1 leading-relaxed">{(o as any)?.[descKey]}</p>
                </div>
              </div>
              {/* Guide path — shown when NOT configured */}
              {!status.ok && (
                <div className="mt-3 rounded-lg bg-amber-50/50 dark:bg-amber-500/[0.04] border border-amber-200/40 dark:border-amber-500/10 px-3 py-2.5">
                  <p className="text-[10px] font-bold text-amber-600/70 dark:text-amber-400/50 mb-1">{o?.tipGuidePath}</p>
                  <p className="text-[10px] text-amber-700 dark:text-amber-300/70 font-medium">{(o as any)?.[guideKey]}</p>
                </div>
              )}
              {/* Status detail — shown when configured */}
              {status.ok && status.detail && (
                <div className="mt-3 rounded-lg bg-mac-green/[0.04] border border-mac-green/10 px-3 py-2 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] text-mac-green">verified</span>
                  <span className="text-[10px] text-mac-green font-medium">{status.detail}</span>
                </div>
              )}
              {/* Action row */}
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                {!status.ok && onOpenEditor && (
                  <button onClick={onOpenEditor}
                    className="text-[10px] px-2.5 py-1 rounded-lg bg-primary text-white font-bold hover:bg-primary/90 transition-colors flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">settings</span>
                    {o?.tipGoSetup}
                  </button>
                )}
                {tip.docUrl && (
                  <a href={tip.docUrl} target="_blank" rel="noopener noreferrer"
                    className={`text-[10px] px-2.5 py-1 rounded-lg text-slate-500 dark:text-white/40 hover:text-primary hover:bg-primary/5 font-bold transition-colors flex items-center gap-1 ${status.ok ? '' : 'ml-auto'}`}>
                    <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                    {o?.tipLearnMore}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Step content router
  // ---------------------------------------------------------------------------

  const stepContent: Record<StepKey, () => React.ReactNode> = {
    check: renderStepCheck,
    scenarios: renderStepScenarios,
    persona: renderStepPersona,
    memory: renderStepMemory,
    automation: renderStepAutomation,
    tips: renderStepTips,
  };

  const currentStepIdx = STEPS.findIndex(s => s.key === activeStep);
  const stepTitle = (o as any)?.[`${activeStep === 'check' ? 'stepCheck' : activeStep === 'persona' ? 'personaTitle' : activeStep === 'memory' ? 'memoryTitle' : activeStep === 'automation' ? 'autoTitle' : activeStep === 'scenarios' ? 'scenarioTitle' : 'tipsTitle'}`] || activeStep;

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
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={fetchAll} className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all" title={o?.refresh}>
              <span className="material-symbols-outlined text-[16px]">refresh</span>
            </button>
            {/* Score ring */}
            <div className="relative w-14 h-14 md:w-16 md:h-16">
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

        {/* Step nav */}
        <div className="flex items-center gap-1 mt-3 overflow-x-auto custom-scrollbar pb-1 -mx-1 px-1">
          {STEPS.map((step, idx) => {
            const isActive = activeStep === step.key;
            const labelKey = `step${step.key.charAt(0).toUpperCase() + step.key.slice(1)}` as string;
            return (
              <button key={step.key} onClick={() => setActiveStep(step.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold whitespace-nowrap transition-all shrink-0 ${
                  isActive
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/[0.04]'
                }`}>
                <span className="material-symbols-outlined text-[14px]">{step.icon}</span>
                <span className="hidden sm:inline">{(o as any)?.[labelKey]}</span>
                {idx === 0 && failCount > 0 && !isActive && (
                  <span className="w-4 h-4 rounded-full bg-mac-red/10 text-mac-red text-[10px] font-bold flex items-center justify-center">{failCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
        <div className="max-w-3xl mx-auto">
          {stepContent[activeStep]?.()}
        </div>
      </div>

      {/* File editor modal */}
      {renderFileEditor()}

      {/* File apply confirm dialog */}
      {pendingApply && (
        <FileApplyConfirm
          request={pendingApply.request}
          locale={(t as any).fileApply}
          onDone={handleApplyDone}
          onCancel={() => setPendingApply(null)}
        />
      )}
    </div>
  );
};

export default UsageWizard;
