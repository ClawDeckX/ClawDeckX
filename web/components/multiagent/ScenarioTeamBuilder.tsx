import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import {
  multiAgentApi,
  MultiAgentGenerateResult,
  MultiAgentDeployRequest,
  gwApi,
  GenTask,
  WizardStep1Request,
  WizardStep2Request,
} from '../../services/api';
import { useToast } from '../Toast';
import { resolveTemplateColor } from '../../utils/templateColors';
import { subscribeManagerWS } from '../../services/manager-ws';
import { templateSystem, resolveTemplatePrompt } from '../../services/template-system';

interface ScenarioTeamBuilderProps {
  language: Language;
  onClose: () => void;
  onReadyToDeploy: (deployRequest: MultiAgentDeployRequest, reasoning: string) => void;
  /** If provided, restore a previously submitted async task (e.g. when user re-opens the minimized window) */
  pendingTaskId?: string;
  onTaskSubmitted?: (taskId: string) => void;
  /** If provided, jump directly to preview with this already-completed result */
  completedResult?: MultiAgentGenerateResult;
}

type BuilderStep = 'input' | 'generating' | 'wizard' | 'preview' | 'edit-agent';
type TeamSize = 'single' | 'small' | 'medium' | 'large';
type WorkflowType = 'standalone' | 'sequential' | 'parallel' | 'collaborative' | 'event-driven' | 'routing';

interface AgentEdit {
  id: string;
  name: string;
  role: string;
  description: string;
  soul: string;
  agentsMd: string;
  userMd: string;
  identityMd: string;
  heartbeat: string;
  icon: string;
  color: string;
}

interface ScenarioTemplate {
  icon: string;
  color: string;
  nameKey: string;
  descKey: string;
  workflowType: Exclude<WorkflowType, 'standalone' | 'event-driven'>;
  teamSize: TeamSize;
  name: string;
  desc: string;
  /** ID matching templates/official/multi-agent/{id}.json — used to load prompts */
  multiAgentTemplateId?: string;
}

function isMissingDefaultModelError(message?: string | null): boolean {
  const text = (message || '').toLowerCase();
  return text.includes('agents.defaults.model.primary is empty')
    || text.includes('no model specified and agents.defaults.model.primary is empty');
}

const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  { icon: 'code', color: 'from-blue-500 to-cyan-500', nameKey: 'tpl_softdev_name', descKey: 'tpl_softdev_desc', workflowType: 'collaborative', teamSize: 'medium', name: 'Software Dev Team', desc: 'Full-stack software development team with PM, architects, frontend/backend devs and QA. Responsible for requirement analysis, system design, coding, code review, testing, and delivery management.', multiAgentTemplateId: 'software-dev' },
  { icon: 'campaign', color: 'from-pink-500 to-rose-500', nameKey: 'tpl_marketing_name', descKey: 'tpl_marketing_desc', workflowType: 'parallel', teamSize: 'medium', name: 'Content Marketing', desc: 'Content creation and marketing team producing SEO articles, social media posts, email newsletters, and marketing copy. Handles content strategy, writing, editing, distribution, and analytics.', multiAgentTemplateId: 'content-factory' },
  { icon: 'support_agent', color: 'from-green-500 to-emerald-500', nameKey: 'tpl_support_name', descKey: 'tpl_support_desc', workflowType: 'routing', teamSize: 'medium', name: 'Customer Support', desc: 'Multi-tier customer support team handling inbound requests through triage, L1/L2/L3 specialists, and escalation management. Focus on fast resolution, knowledge base maintenance, and CSAT improvement.', multiAgentTemplateId: 'customer-support' },
  { icon: 'science', color: 'from-violet-500 to-purple-500', nameKey: 'tpl_research_name', descKey: 'tpl_research_desc', workflowType: 'sequential', teamSize: 'medium', name: 'Research Team', desc: 'Academic or market research team with lead researcher, domain experts, data analysts, and critical reviewers. Conducts literature review, data collection, analysis, and report writing.', multiAgentTemplateId: 'research-team' },
  { icon: 'storefront', color: 'from-orange-500 to-amber-500', nameKey: 'tpl_ecommerce_name', descKey: 'tpl_ecommerce_desc', workflowType: 'collaborative', teamSize: 'large', name: 'E-Commerce Operations', desc: 'E-commerce operations team managing product listings, pricing strategy, inventory, customer service, promotions, and analytics. Covers the full order-to-fulfillment workflow.', multiAgentTemplateId: 'ecommerce' },
  { icon: 'school', color: 'from-teal-500 to-cyan-500', nameKey: 'tpl_education_name', descKey: 'tpl_education_desc', workflowType: 'sequential', teamSize: 'small', name: 'Education Content', desc: 'Online education content team creating courses, quizzes, video scripts, and learning materials. Roles include instructional designer, subject matter expert, writer, and quality reviewer.', multiAgentTemplateId: 'education' },
  { icon: 'account_balance', color: 'from-slate-500 to-gray-600', nameKey: 'tpl_finance_name', descKey: 'tpl_finance_desc', workflowType: 'sequential', teamSize: 'medium', name: 'Financial Analysis', desc: 'Financial analysis team covering market research, financial modeling, risk assessment, portfolio analysis, and investment reporting. Produces detailed research reports and recommendations.', multiAgentTemplateId: 'finance' },
  { icon: 'build', color: 'from-indigo-500 to-blue-600', nameKey: 'tpl_devops_name', descKey: 'tpl_devops_desc', workflowType: 'collaborative', teamSize: 'small', name: 'DevOps Team', desc: 'DevOps and SRE team managing CI/CD pipelines, infrastructure as code, monitoring, incident response, and deployment automation. Ensures system reliability, security, and scalability.', multiAgentTemplateId: 'devops-team' },
];

const WORKFLOW_TYPES = [
  { value: 'collaborative', icon: 'hub', labelKey: 'workflowCollaborative' },
  { value: 'sequential', icon: 'linear_scale', labelKey: 'workflowSequential' },
  { value: 'parallel', icon: 'call_split', labelKey: 'workflowParallel' },
  { value: 'routing', icon: 'route', labelKey: 'workflowRouting' },
] as const;

const WORKFLOW_DESCRIPTIONS: Record<string, { en: string; zh: string }> = {
  standalone: {
    en: 'standalone — a single agent works independently without multi-agent coordination',
    zh: '独立式 — 单个智能体独立工作，不需要多智能体协作',
  },
  collaborative: {
    en: 'collaborative — all agents work together simultaneously, sharing context and coordinating freely',
    zh: '协作式 — 所有智能体同时协作，自由共享上下文和协调任务',
  },
  sequential: {
    en: 'sequential — agents run one after another in a fixed pipeline, each passing results to the next',
    zh: '顺序式 — 智能体按固定流水线依次执行，每个将结果传递给下一个',
  },
  parallel: {
    en: 'parallel — agents run simultaneously on independent tasks, then results are merged',
    zh: '并行式 — 智能体同时处理各自独立任务，最后汇总结果',
  },
  routing: {
    en: 'routing — a router agent dispatches tasks to the most suitable specialist agent based on input',
    zh: '路由式 — 由路由智能体根据输入将任务分发给最合适的专科智能体',
  },
};

function getWorkflowDescription(wfType: string, language: string): string {
  const map = WORKFLOW_DESCRIPTIONS[wfType];
  if (!map) return wfType;
  return (language === 'zh' || language === 'zh-TW') ? map.zh : map.en;
}

const TEAM_SIZES = [
  { value: 'single', range: '1', icon: 'person' },
  { value: 'small', range: '2-3', icon: 'group' },
  { value: 'medium', range: '4-6', icon: 'groups' },
  { value: 'large', range: '7-10', icon: 'diversity_3' },
] as const;

function getAgentCountHint(size: TeamSize, style: 'compact' | 'words' = 'compact'): string {
  if (size === 'single') return style === 'words' ? 'exactly 1' : '1';
  if (size === 'small') return style === 'words' ? '2 to 3' : '2-3';
  if (size === 'large') return style === 'words' ? '7 to 10' : '7-10';
  return style === 'words' ? '4 to 6' : '4-6';
}

function getWorkflowLabelKey(type: string): string {
  if (type === 'standalone') return 'workflowStandalone';
  if (type === 'event-driven') return 'workflowEventDriven';
  return `workflow${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

const ElapsedTimer: React.FC<{ startedAt: number; className?: string }> = ({ startedAt, className }) => {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  const label = m > 0 ? `${m}m ${s}s` : `${s}s`;
  return <span className={className}>{label}</span>;
};

const StreamOutput: React.FC<{ content: string }> = ({ content }) => {
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content]);
  return (
    <pre ref={preRef} className="px-2 py-1.5 text-[10px] font-mono text-slate-300/70 dark:text-white/40 leading-relaxed whitespace-pre-wrap break-all max-h-[100px] overflow-y-auto">
      {content}<span className="inline-block w-1.5 h-2.5 bg-violet-400 animate-pulse ml-0.5 align-middle" />
    </pre>
  );
};

const ScenarioTeamBuilder: React.FC<ScenarioTeamBuilderProps> = ({
  language,
  onClose,
  onReadyToDeploy,
  pendingTaskId,
  onTaskSubmitted,
  completedResult,
}) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const ma = (t.multiAgent || {}) as any;
  const stb = (t.scenarioTeamBuilder || {}) as any;
  const { toast } = useToast();
  const formatAgentCountLabel = useCallback((size: TeamSize) => {
    const range = TEAM_SIZES.find(s => s.value === size)?.range || getAgentCountHint(size);
    const label = size === 'single' ? (stb.agentSingular || stb.agents || 'agent') : (stb.agents || 'agents');
    return `${range} ${label}`;
  }, [stb]);

  const [step, setStep] = useState<BuilderStep>('input');
  const [scenarioName, setScenarioName] = useState('');
  const [description, setDescription] = useState('');
  const [teamSize, setTeamSize] = useState<TeamSize>('medium');
  const [workflowType, setWorkflowType] = useState<Exclude<WorkflowType, 'standalone'>>('collaborative');
  const effectiveWorkflowType: WorkflowType = teamSize === 'single' ? 'standalone' : workflowType;
  const normalizeWorkflow = useCallback((workflow: MultiAgentGenerateResult['template']['workflow'] | undefined, agents?: MultiAgentGenerateResult['template']['agents']): MultiAgentGenerateResult['template']['workflow'] => {
    if (teamSize !== 'single') return workflow ?? { type: effectiveWorkflowType, description: '', steps: [] };
    const agent = agents?.[0];
    return {
      type: 'standalone',
      description: getWorkflowDescription('standalone', language),
      steps: [{
        agent: agent?.id || '',
        action: language === 'zh' || language === 'zh-TW'
          ? '独立处理用户任务并根据需要产出结果'
          : 'Handle the user task independently and produce the result',
      }],
    };
  }, [teamSize, effectiveWorkflowType, language]);
  const normalizeGenerateResult = useCallback((result: MultiAgentGenerateResult): MultiAgentGenerateResult => ({
    ...result,
    template: {
      ...result.template,
      agents: teamSize === 'single' ? result.template.agents.slice(0, 1) : result.template.agents,
      workflow: normalizeWorkflow(result.template.workflow, result.template.agents),
    },
  }), [teamSize, normalizeWorkflow]);
  const [generateResult, setGenerateResult] = useState<MultiAgentGenerateResult | null>(null);
  const [editingAgent, setEditingAgent] = useState<AgentEdit | null>(null);
  const [editedAgents, setEditedAgents] = useState<Record<string, AgentEdit>>({});
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'agents' | 'workflow' | 'reasoning'>('agents');

  // Async task id for background generation
  const [genTaskId, setGenTaskId] = useState<string | null>(pendingTaskId ?? null);
  // Whether the user has minimized this window while generating
  const [minimized, setMinimized] = useState(false);

  // Generation progress phases
  type GenPhase = 'connecting' | 'sending' | 'thinking' | 'parsing' | 'done';
  const [genPhase, setGenPhase] = useState<GenPhase>('connecting');
  const genTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Server-confirmed elapsed seconds (from gen_task WS events)
  const [genServerElapsed, setGenServerElapsed] = useState(0);
  // Client-side fallback elapsed ticker
  const [genClientElapsed, setGenClientElapsed] = useState(0);
  const genStartRef = useRef<number>(0);
  // True once we've received at least one server-side gen_task event
  const genServerActiveRef = useRef(false);
  // SessionKey received from backend gen_task — used to subscribe to chat deltas
  const genSessionKeyRef = useRef<string>('');
  // Live streaming token preview text
  const [genStreamText, setGenStreamText] = useState('');
  const genStreamBufRef = useRef('');
  const genStreamRafRef = useRef<number | null>(null);
  // WS-pushed error during generating (errorCode + errorMsg from gen_progress phase=error)
  const [genWsError, setGenWsError] = useState<{ code: string; msg: string } | null>(null);

  // Client-side elapsed ticker — always running during generating, as fallback
  useEffect(() => {
    if (step !== 'generating') {
      setGenClientElapsed(0);
      genStartRef.current = 0;
      genServerActiveRef.current = false;
      genSessionKeyRef.current = '';
      genStreamBufRef.current = '';
      if (genStreamRafRef.current !== null) { clearTimeout(genStreamRafRef.current); genStreamRafRef.current = null; }
      setGenStreamText('');
      setGenWsError(null);
      return;
    }
    genStartRef.current = Date.now();
    setGenClientElapsed(0);
    const iv = setInterval(() => {
      setGenClientElapsed(Math.floor((Date.now() - genStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [step]);

  // Jump to preview if a completed result is provided (background task finished while window was closed)
  useEffect(() => {
    if (!completedResult) return;
    setGenerateResult(normalizeGenerateResult(completedResult));
    setEditedAgents({});
    setStep('preview');
  }, [completedResult, normalizeGenerateResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore pending task on mount if pendingTaskId provided
  useEffect(() => {
    if (!pendingTaskId) return;
    setGenTaskId(pendingTaskId);
    setStep('generating');
    setGenPhase('thinking');
  }, [pendingTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to gen_task + chat delta WS events from backend
  useEffect(() => {
    if (step !== 'generating') return;
    const unsub = subscribeManagerWS((msg: any) => {
      if (msg?.type === 'gen_task') {
        const { taskId, elapsed, phase, sessionKey: sk, status, result, errorCode, errorMsg, streamToken } = msg.data ?? {};
        // Only handle events for our task
        if (genTaskId && taskId && taskId !== genTaskId) return;
        if (typeof sk === 'string' && sk) genSessionKeyRef.current = sk;
        if (typeof elapsed === 'number') {
          setGenServerElapsed(elapsed);
          genServerActiveRef.current = true;
        }
        // Accumulate streaming tokens from direct LLM call into the preview buffer
        if (typeof streamToken === 'string' && streamToken) {
          genStreamBufRef.current += streamToken;
          if (genStreamRafRef.current === null) {
            genStreamRafRef.current = window.setTimeout(() => {
              setGenStreamText(genStreamBufRef.current);
              genStreamRafRef.current = null;
            }, 60);
          }
        }
        if (phase === 'sending') setGenPhase('sending');
        if (phase === 'thinking') setGenPhase('thinking');
        if (phase === 'parsing') setGenPhase('parsing');
        if (status === 'failed' && errorCode) {
          setGenWsError({ code: errorCode, msg: errorMsg || errorCode });
          return;
        }
        if (status === 'done' && result) {
          genTimersRef.current.forEach(t => clearTimeout(t));
          genTimersRef.current = [];
          setGenPhase('parsing');
          setTimeout(() => {
            setGenerateResult(normalizeGenerateResult(result as MultiAgentGenerateResult));
            setEditedAgents({});
            setStep('preview');
            setGenTaskId(null);
          }, 400);
        }
        return;
      }
      // Live token streaming: chat delta events for our generation session
      if (msg?.type === 'chat' && msg.data?.state === 'delta') {
        const sk = msg.data?.sessionKey || msg.data?.key || '';
        // Accept if: (a) sessionKey already confirmed via gen_progress, or
        // (b) session key matches the generation label pattern (__gen_team_)
        // This handles the race where deltas arrive before the first gen_progress event.
        const isOurSession = genSessionKeyRef.current
          ? sk === genSessionKeyRef.current
          : typeof sk === 'string' && sk.includes('__gen_team_');
        if (!isOurSession) return;
        // Latch the sessionKey if not yet set
        if (!genSessionKeyRef.current && sk) genSessionKeyRef.current = sk;
        const text = (() => {
          const content = msg.data?.message?.content ?? msg.data?.message;
          if (typeof content === 'string') return content;
          if (Array.isArray(content)) {
            return content
              .filter((b: any) => b?.type === 'text')
              .map((b: any) => b.text || '')
              .join('');
          }
          return '';
        })();
        if (text) {
          genStreamBufRef.current += text;
          // Throttle setState to ~60fps
          if (genStreamRafRef.current === null) {
            genStreamRafRef.current = window.setTimeout(() => {
              setGenStreamText(genStreamBufRef.current);
              genStreamRafRef.current = null;
            }, 16);
          }
          setGenPhase('thinking');
        }
      }
    });
    return unsub;
  }, [step]);

  // Displayed elapsed = server value if we've heard from server, else client fallback
  const genElapsed = genServerActiveRef.current ? genServerElapsed : genClientElapsed;

  // Dropdowns for team size / workflow
  const [teamSizeOpen, setTeamSizeOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const teamSizeRef = useRef<HTMLDivElement>(null);
  const workflowRef = useRef<HTMLDivElement>(null);

  // Template picker
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const templatePickerRef = useRef<HTMLDivElement>(null);

  // Always use direct LLM streaming mode
  const directLlm = true;

  // Model selector
  const [selectedModel, setSelectedModel] = useState('');
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string }[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  // Load configured models on mount and auto-select when no default model is configured
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const gwCfg = await gwApi.configGet().catch(() => null);
        if (cancelled) return;
        const cfg = gwCfg as any;
        const parsed = cfg?.parsed || cfg?.config || cfg || {};
        const providers = parsed?.models?.providers || {};
        const primaryModel = parsed?.agents?.defaults?.model?.primary || '';
        const opts: { value: string; label: string }[] = [];
        const seen = new Set<string>();
        for (const [pName, pCfg] of Object.entries(providers) as [string, any][]) {
          const pModels = Array.isArray(pCfg?.models) ? pCfg.models : [];
          for (const m of pModels) {
            const id = typeof m === 'string' ? m : m?.id;
            if (!id) continue;
            const path = `${pName}/${id}`;
            if (seen.has(path)) continue;
            seen.add(path);
            const name = typeof m === 'object' && m?.name ? m.name : id;
            opts.push({ value: path, label: `${pName} / ${name}` });
          }
        }
        setModelOptions(opts);
        // Auto-select: use the configured primary model, or fall back to the first available model.
        // This prevents "agents.defaults.model.primary is empty" errors when the backend
        // reads a local config file that lacks the default model (e.g. Docker / remote gateway).
        if (opts.length > 0 && !selectedModel) {
          const match = primaryModel ? opts.find(o => o.value === primaryModel) : null;
          setSelectedModel(match ? match.value : opts[0].value);
        }
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (templatePickerRef.current && !templatePickerRef.current.contains(e.target as Node)) setTemplatePickerOpen(false);
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) setModelPickerOpen(false);
      if (teamSizeRef.current && !teamSizeRef.current.contains(e.target as Node)) setTeamSizeOpen(false);
      if (workflowRef.current && !workflowRef.current.contains(e.target as Node)) setWorkflowOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const applyingTemplateRef = useRef(false);
  const currentTemplateIdRef = useRef<string | null>(null);

  const handleApplyTemplate = useCallback((tpl: ScenarioTemplate) => {
    const name = stb[tpl.nameKey] || tpl.name;
    const desc = stb[tpl.descKey] || tpl.desc;
    setScenarioName(name);
    setDescription(desc);
    setWorkflowType(tpl.workflowType);
    setTeamSize(tpl.teamSize);
    setTemplatePickerOpen(false);
    // Clear cached step1 result so next wizard run is fresh with new prompts
    wzStep1ResultRef.current = null;
    setWzStep1Result(null);
    // Mark that we're applying a template so the auto-clear useEffect skips
    applyingTemplateRef.current = true;
    currentTemplateIdRef.current = tpl.multiAgentTemplateId ?? null;
    setWzPromptUserEdited(false);
    // Load template prompts if linked
    if (tpl.multiAgentTemplateId) {
      const agentCount = getAgentCountHint(tpl.teamSize);
      templateSystem.getMultiAgentTemplates(language).then(templates => {
        const matched = templates.find(t => t.id === tpl.multiAgentTemplateId);
        if (!matched?.content.prompts) return;
        const step1 = resolveTemplatePrompt(matched.content.prompts.step1, language, {
          scenarioName: name,
          description: desc,
          agentCount,
          workflowType: tpl.workflowType,
          workflowDescription: getWorkflowDescription(tpl.workflowType, language),
        });
        if (step1) { setWzStep1Prompt(step1); setWzPromptSource(matched.metadata?.name || tpl.multiAgentTemplateId || null); }
        // Store agentFile prompt template for later per-agent use
        const agentFileLang = (language === 'zh' || language === 'zh-TW') ? 'zh' : 'en';
        wzAgentFilePromptRef.current = matched.content.prompts.agentFile?.[agentFileLang]
          ?? matched.content.prompts.agentFile?.['en']
          ?? null;
        applyingTemplateRef.current = false;
      }).catch(() => { applyingTemplateRef.current = false; });
    } else {
      // No linked template — load generic default prompt + agentFile
      const agentCount = getAgentCountHint(tpl.teamSize, 'words');
      templateSystem.getMultiAgentTemplates(language).then(templates => {
        const def = templates.find(t => t.id === 'default');
        if (!def) return;
        if (def.content.prompts?.step1) {
          const resolved = resolveTemplatePrompt(def.content.prompts.step1, language, {
            scenarioName: name,
            description: desc,
            agentCount,
            workflowType: tpl.workflowType,
            workflowDescription: getWorkflowDescription(tpl.workflowType, language),
          });
          if (resolved) { setWzStep1Prompt(resolved); setWzPromptSource(null); }
        }
        // Load agentFile prompt template from default for step2
        const agentFileLang = (language === 'zh' || language === 'zh-TW') ? 'zh' : 'en';
        wzAgentFilePromptRef.current = def.content.prompts?.agentFile?.[agentFileLang]
          ?? def.content.prompts?.agentFile?.['en']
          ?? null;
        applyingTemplateRef.current = false;
      }).catch(() => { wzAgentFilePromptRef.current = null; applyingTemplateRef.current = false; });
    }
  }, [stb, language]);

  const [wzStep1Prompt, setWzStep1Prompt] = useState(''); // empty = backend uses compact default prompt
  const [wzPromptUserEdited, setWzPromptUserEdited] = useState(false); // true = user manually edited, don't auto-regenerate
  const [wzPromptSource, setWzPromptSource] = useState<string | null>(null); // null = default, string = template name
  const [wzPromptExpanded, setWzPromptExpanded] = useState(true); // collapsed/expanded state for prompt editor

  /** Build the generic fallback step1 prompt from the _default template (mirrors Go default). */
  const buildDefaultStep1Prompt = useCallback(async (name: string, desc: string, size: typeof teamSize, wfType: WorkflowType): Promise<string> => {
    const agentCount = getAgentCountHint(size, 'words');
    try {
      const templates = await templateSystem.getMultiAgentTemplates(language);
      const def = templates.find(t => t.id === 'default');
      if (def?.content.prompts?.step1) {
        const resolved = resolveTemplatePrompt(def.content.prompts.step1, language, {
          scenarioName: name,
          description: desc,
          agentCount,
          workflowType: wfType,
          workflowDescription: getWorkflowDescription(wfType, language),
        });
        if (resolved) return resolved;
      }
    } catch { /* fall through */ }
    return ''; // backend will use its built-in default
  }, [language]);

  const handlePreparePrompt = useCallback(async () => {
    if (!scenarioName.trim() || !description.trim()) return;
    setError(null);
    // Bust stale empty cache so template re-load always retries
    templateSystem.clearMultiAgentCache();
    // Navigate to wizard immediately so UI feels responsive
    setStep('wizard');
    setTimeout(() => {
      if (wzStep1ResultRef.current) {
        setWzPhase('step2');
      } else {
        setWzPhase('step1');
        setWzStep1Stream('');
        setWzStep1Error(null);
        wzStep1BufRef.current = '';
      }
    }, 0);
    // Pre-fill prompt in background if not yet set
    if (!wzStep1Prompt) {
      const prompt = await buildDefaultStep1Prompt(scenarioName.trim(), description.trim(), teamSize, effectiveWorkflowType);
      if (prompt) setWzStep1Prompt(prompt);
    }
  }, [scenarioName, description, teamSize, effectiveWorkflowType, wzStep1Prompt, buildDefaultStep1Prompt]);

  const handleConfirmWizard = handlePreparePrompt;

  const handleConfirmGenerate = useCallback(async () => {
    setStep('generating');
    setGenPhase('connecting');
    setError(null);
    genTimersRef.current.forEach(t => clearTimeout(t));
    genTimersRef.current = [];

    try {
      const { taskId } = await multiAgentApi.generateAsync({
        scenarioName: scenarioName.trim(),
        description: description.trim(),
        teamSize,
        workflowType: effectiveWorkflowType,
        language,
        ...(selectedModel ? { modelId: selectedModel } : {}),
        directLlm,
      } as any);
      setGenTaskId(taskId);
      onTaskSubmitted?.(taskId);
      // Drive phase hint for early seconds before first WS event
      const t1 = setTimeout(() => setGenPhase('sending'), 2000);
      const t2 = setTimeout(() => setGenPhase('thinking'), 5000);
      genTimersRef.current = [t1, t2];
    } catch (err: any) {
      genTimersRef.current.forEach(t => clearTimeout(t));
      genTimersRef.current = [];
      const errMsg = typeof err?.message === 'string' ? err.message : '';
      const errCode = typeof err?.error_code === 'string' ? err.error_code : '';
      const isGatewayDisconnected =
        errCode === 'GATEWAY_DISCONNECTED' ||
        errMsg.includes('GATEWAY_DISCONNECTED') ||
        errMsg.includes('not connected') ||
        errMsg.includes('gateway is not connected');
      if (isGatewayDisconnected) {
        setError('__gateway__');
      } else {
        setError(errMsg || stb.generateFailed || 'Generation failed');
      }
      setStep('input');
    }
  }, [scenarioName, description, teamSize, effectiveWorkflowType, language, selectedModel, directLlm, stb, onTaskSubmitted]);

  const getEffectiveAgent = useCallback(
    (agentId: string) => editedAgents[agentId] ?? null,
    [editedAgents]
  );

  const handleOpenAgentEdit = useCallback(
    (agent: MultiAgentGenerateResult['template']['agents'][0]) => {
      const existing = editedAgents[agent.id];
      setEditingAgent(existing ?? {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        description: agent.description ?? '',
        soul: agent.soul ?? '',
        agentsMd: (agent as any).agentsMd ?? '',
        userMd: (agent as any).userMd ?? '',
        identityMd: (agent as any).identityMd ?? '',
        heartbeat: agent.heartbeat ?? '',
        icon: agent.icon ?? 'person',
        color: agent.color ?? 'from-blue-500 to-cyan-500',
      });
      setStep('edit-agent');
    },
    [editedAgents]
  );

  const handleSaveAgentEdit = useCallback(() => {
    if (!editingAgent) return;
    setEditedAgents(prev => ({ ...prev, [editingAgent.id]: editingAgent }));
    setEditingAgent(null);
    setStep('preview');
  }, [editingAgent]);

  const handleConfirmDeploy = useCallback(() => {
    if (!generateResult) return;
    const template = generateResult.template;
    const agents = template.agents.map(agent => {
      const edited = editedAgents[agent.id];
      return {
        id: agent.id,
        name: edited?.name ?? agent.name,
        role: edited?.role ?? agent.role,
        description: edited?.description ?? agent.description,
        icon: edited?.icon ?? agent.icon,
        color: edited?.color ?? agent.color,
        soul: edited?.soul ?? agent.soul ?? `# ${agent.name}\n\n**Role:** ${agent.role}\n\n${agent.description ?? ''}`,
        agentsMd: edited?.agentsMd ?? (agent as any).agentsMd ?? '',
        userMd: edited?.userMd ?? (agent as any).userMd ?? '',
        identityMd: edited?.identityMd ?? (agent as any).identityMd ?? '',
        heartbeat: edited?.heartbeat ?? agent.heartbeat,
      };
    });
    const workflow = normalizeWorkflow(template.workflow, agents);
    const deployRequest: MultiAgentDeployRequest = {
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        agents,
        workflow,
        bindings: [],
      },
      prefix: template.id,
      skipExisting: true,
      dryRun: false,
    };
    onReadyToDeploy(deployRequest, generateResult.reasoning);
  }, [generateResult, editedAgents, normalizeWorkflow, onReadyToDeploy]);

  const getWorkflowTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      sequential: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      parallel: 'bg-green-500/10 text-green-500 border-green-500/20',
      collaborative: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
      'event-driven': 'bg-orange-500/10 text-orange-500 border-orange-500/20',
      routing: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
      standalone: 'bg-violet-500/10 text-violet-500 border-violet-500/20',
    };
    return colors[type] || 'bg-slate-500/10 text-slate-500 border-slate-500/20';
  };

  // ── Inline wizard state ───────────────────────────────────────────────────
  type WzPhase = 'step1' | 'step2';
  type WzAgentStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';
  interface WzAgentState {
    id: string; name: string; role: string; description: string; icon: string; color: string;
    status: WzAgentStatus;
    streamBuf: string;
    soul: string; agentsMd: string; userMd: string; identityMd: string; heartbeat: string;
    error?: string;
    customPrompt?: string;
    expanded: boolean;
    showPrompt: boolean;
    startedAt?: number;   // Date.now() when streaming started
    tokenCount?: number;  // accumulated token count
  }

  const [wzPhase, setWzPhase] = useState<WzPhase>('step1');
  // Step1
  const [wzStep1Stream, setWzStep1Stream] = useState('');
  const [wzStep1Running, setWzStep1Running] = useState(false);
  const [wzStep1Error, setWzStep1Error] = useState<string | null>(null);
  const [wzStep1Result, setWzStep1Result] = useState<any>(null); // cached parsed JSON
  const wzStep1ResultRef = useRef<any>(null); // mirror for reading in callbacks before state settles
  const wzStep1AbortRef = useRef<AbortController | null>(null);
  const wzStep1BufRef = useRef('');
  const wzStep1RafRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Step2
  const [wzAgents, setWzAgents] = useState<WzAgentState[]>([]);
  const wzAgentsRef = useRef<WzAgentState[]>([]); // mirrors wzAgents for use in async callbacks
  const [wzStep2Running, setWzStep2Running] = useState(false);
  const wzStep2AbortRef = useRef<AbortController | null>(null);
  const wzStep2ActiveIdxRef = useRef(0);
  // Stable ref to the start-step1 function so handleConfirmWizard can auto-invoke it
  const wzStartStep1Ref = useRef<(() => void) | null>(null);
  // Cached agentFile prompt template from loaded multi-agent template (raw, with {{placeholders}})
  const wzAgentFilePromptRef = useRef<string | null>(null);

  const wzLangHint = language === 'zh' || language === 'zh-TW' ? 'Chinese'
    : language === 'ja' ? 'Japanese' : language === 'ko' ? 'Korean' : 'English';

  // Step1: start/stop
  const wzHandleStep1Start = useCallback(() => {
    wzStep1AbortRef.current?.abort();
    wzStep1BufRef.current = '';
    if (wzStep1RafRef.current !== null) { clearTimeout(wzStep1RafRef.current); wzStep1RafRef.current = null; }
    setWzStep1Stream('');
    setWzStep1Error(null);
    setWzStep1Running(true);
    setWzStep1Result(null);

    const req: WizardStep1Request = {
      scenarioName: scenarioName.trim(),
      description: description.trim(),
      teamSize,
      workflowType: effectiveWorkflowType,
      language,
      modelId: selectedModel || undefined,
      customPrompt: wzStep1Prompt || undefined,
    };

    wzStep1AbortRef.current = multiAgentApi.wizardStep1(
      req,
      (token) => {
        wzStep1BufRef.current += token;
        if (wzStep1RafRef.current === null) {
          wzStep1RafRef.current = setTimeout(() => {
            setWzStep1Stream(wzStep1BufRef.current);
            wzStep1RafRef.current = null;
          }, 30);
        }
      },
      (doneData) => {
        setWzStep1Running(false);
        wzStep1ResultRef.current = doneData;
        setWzStep1Result(doneData);
        const agentList: any[] = doneData.parsed?.template?.agents ?? [];
        const agentFilePromptTpl = wzAgentFilePromptRef.current;
        setWzAgents(agentList.map((a: any) => {
          const core = { id: a.id ?? '', name: a.name ?? '', role: a.role ?? '', description: a.description ?? '', icon: a.icon ?? 'person', color: a.color ?? 'from-blue-500 to-cyan-500' };
          // Resolve per-agent prompt: use template if available, otherwise fallback to generic default
          const customPrompt = agentFilePromptTpl
            ? agentFilePromptTpl
              .replace(/\{\{agentName\}\}/g, core.name)
              .replace(/\{\{agentRole\}\}/g, core.role)
              .replace(/\{\{agentDesc\}\}/g, core.description)
              .replace(/\{\{scenarioName\}\}/g, scenarioName)
            : `Output ONLY valid JSON. No markdown fences, no explanation.\n\nYou are writing OpenClaw agent workspace files for a multi-agent system.\nAgent name: ${core.name}\nAgent role: ${core.role}\nAgent description: ${core.description}\nScenario / team name: ${scenarioName}\nWrite all content in: ${wzLangHint}\n\nFILE SPECIFICATIONS — follow these exactly:\n\nSOUL.md — Persona, tone, and boundaries. Loaded every session.\n  - Write in first person as the agent.\n  - Cover: who this agent is, what they care about, their working principles, their communication style.\n  - 3-5 short paragraphs. Use markdown headers (## Core Truths, ## Boundaries, ## Vibe).\n  - Be specific to this agent's role, NOT generic AI platitudes.\n\nAGENTS.md — Operating instructions and memory rules. Loaded every session.\n  - Starts with "## Session Startup" listing files to read on wake-up (SOUL.md, USER.md, memory/YYYY-MM-DD.md).\n  - Includes "## Red Lines" (things this agent must never do).\n  - Includes role-specific rules and priorities for this agent's domain.\n  - Use markdown headers and bullet lists.\n\nUSER.md — Profile of the human this agent serves. Loaded every session.\n  - Use the standard template format: - **Name:** / - **What to call them:** / - **Pronouns:** (optional) / - **Timezone:** / - **Notes:**\n  - Add a "## Context" section about what this agent should learn about the user (relevant to the agent's role).\n  - Leave field values blank — the agent fills them in from real interactions.\n\nIDENTITY.md — The agent's name, creature, vibe, and emoji.\n  - Use this format exactly: - **Name:** / - **Creature:** / - **Vibe:** / - **Emoji:**\n  - Do NOT add extra fields.\n\nHEARTBEAT.md — Optional periodic checklist for background proactive work. Keep minimal to avoid token burn.\n  - First, judge whether this agent genuinely has recurring background tasks worth checking periodically.\n  - If YES: write 2-4 specific, actionable "- [ ] task" checklist items for this agent's role.\n  - If NO (agent is purely reactive or session-driven with no background state): output exactly: # No periodic tasks for this agent\n  - Never pad with vague items just to fill space.\n\nReturn JSON with these exact keys. Values are full markdown file contents (escape newlines as \\n):\n{"soul":"","agentsMd":"","userMd":"","identityMd":"","heartbeat":""}`;
          return { ...core, status: 'pending' as WzAgentStatus, streamBuf: '', soul: '', agentsMd: '', userMd: '', identityMd: '', heartbeat: '', expanded: false, showPrompt: false, customPrompt };
        }));
        setWzPhase('step2');
      },
      (code, msg) => {
        setWzStep1Running(false);
        setWzStep1Error(`${code}: ${msg}`);
      },
    );
  }, [scenarioName, description, teamSize, effectiveWorkflowType, language, selectedModel, wzStep1Prompt, wzLangHint]);

  // Register auto-start ref so handleConfirmWizard can call it after state flush
  useEffect(() => { wzStartStep1Ref.current = wzHandleStep1Start; }, [wzHandleStep1Start]);

  // Auto-clear prompt when key params change (if not user-edited), so it gets regenerated fresh
  // Skip when a template is being applied — the template's own async loader sets the prompt.
  useEffect(() => {
    if (wzPromptUserEdited) return;
    if (applyingTemplateRef.current) return;
    setWzStep1Prompt('');
    setWzPromptSource(null);
  }, [teamSize, workflowType, scenarioName, description]); // eslint-disable-line react-hooks/exhaustive-deps

  // Retry prompt load when wizard step1 is active but prompt still empty (async race on first open)
  useEffect(() => {
    if (step !== 'wizard' || wzPhase !== 'step1' || wzStep1Prompt || wzStep1Running) return;
    const tplId = currentTemplateIdRef.current;
    const agentCount = getAgentCountHint(teamSize);
    templateSystem.getMultiAgentTemplates(language).then(templates => {
      const tpl = tplId ? templates.find(t => t.id === tplId) : templates.find(t => t.id === 'default');
      const promptObj = tpl?.content.prompts?.step1 ?? templates.find(t => t.id === 'default')?.content.prompts?.step1;
      if (!promptObj) return;
      const resolved = resolveTemplatePrompt(promptObj, language, {
        scenarioName: scenarioName.trim(),
        description: description.trim(),
        agentCount,
        workflowType: effectiveWorkflowType,
        workflowDescription: getWorkflowDescription(effectiveWorkflowType, language),
      });
      if (resolved) {
        setWzStep1Prompt(resolved);
        setWzPromptSource(tplId ? (tpl?.metadata?.name ?? tplId) : null);
      }
    }).catch(() => {});
  }, [step, wzPhase, wzStep1Prompt, wzStep1Running, scenarioName, description, teamSize, effectiveWorkflowType, language, wzPromptUserEdited]);

  const wzHandleStep1Stop = useCallback(() => {
    wzStep1AbortRef.current?.abort();
    setWzStep1Running(false);
  }, []);

  // Stable ref so the done callback always calls the latest version (avoids stale closure in setTimeout)
  const wzRunAgentRef = useRef<(idx: number, agents: WzAgentState[], singleOnly?: boolean) => void>(() => {});
  // Stale-stream watchdog: fires when no new tokens arrive for STALE_MS after content started
  const wzStaleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wzStaleResolvedRef = useRef(false); // true once done/error already handled

  // Step2: run a single agent by index. Pass singleOnly=true to prevent auto-chaining to next pending agent.
  const wzRunAgent = useCallback((idx: number, agents: WzAgentState[], singleOnly = false) => {
    const agent = agents[idx];
    if (!agent) return;
    wzStep2AbortRef.current?.abort();
    if (wzStaleTimerRef.current) { clearTimeout(wzStaleTimerRef.current); wzStaleTimerRef.current = null; }
    wzStaleResolvedRef.current = false;
    wzStep2ActiveIdxRef.current = idx;
    setWzStep2Running(true);
    setWzAgents(prev => prev.map((a, i) => i === idx ? { ...a, status: 'running', streamBuf: '', error: undefined, startedAt: Date.now(), tokenCount: 0 } : a));

    const STALE_MS = 15_000; // 15s no-token watchdog

    // Helper: attempt to parse accumulated streamBuf as JSON and mark done
    const tryRecoverFromStream = () => {
      if (wzStaleResolvedRef.current) return;
      wzStaleResolvedRef.current = true;
      const current = wzAgentsRef.current[idx];
      if (!current || current.status !== 'running') return;
      const raw = (current.streamBuf || '').replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
      try {
        const parsed = JSON.parse(raw);
        const updatedAgents = wzAgentsRef.current.map((a, i) => i === idx ? {
          ...a, status: 'done' as WzAgentStatus, streamBuf: '',
          soul: parsed.soul ?? raw, agentsMd: parsed.agentsMd ?? '',
          userMd: parsed.userMd ?? '', identityMd: parsed.identityMd ?? '',
          heartbeat: parsed.heartbeat ?? '',
        } : a);
        wzAgentsRef.current = updatedAgents;
        setWzAgents(updatedAgents);
        if (!singleOnly) {
          const nextIdx = updatedAgents.findIndex((a, i) => i > idx && a.status === 'pending');
          if (nextIdx >= 0) { setTimeout(() => wzRunAgentRef.current(nextIdx, wzAgentsRef.current), 200); }
          else { setWzStep2Running(false); }
        } else { setWzStep2Running(false); }
      } catch {
        // JSON parse failed — mark as error so user can retry
        setWzAgents(prev => prev.map((a, i) => i === idx ? { ...a, status: 'error', error: 'Stream stalled — no completion signal received. Tap retry.' } : a));
        setWzStep2Running(false);
      }
    };

    const resetStaleTimer = () => {
      if (wzStaleTimerRef.current) clearTimeout(wzStaleTimerRef.current);
      wzStaleTimerRef.current = setTimeout(tryRecoverFromStream, STALE_MS);
    };

    const req: WizardStep2Request = {
      agentId: agent.id, agentName: agent.name, agentRole: agent.role, agentDesc: agent.description,
      scenarioName: scenarioName.trim(), language,
      modelId: selectedModel || undefined,
      customPrompt: agent.customPrompt,
    };

    wzStep2AbortRef.current = multiAgentApi.wizardStep2(
      req,
      (_token, _agentId) => {
        setWzAgents(prev => prev.map((a, i) => i === idx ? { ...a, streamBuf: a.streamBuf + _token, tokenCount: (a.tokenCount ?? 0) + _token.length } : a));
        resetStaleTimer();
      },
      (doneData) => {
        if (wzStaleTimerRef.current) { clearTimeout(wzStaleTimerRef.current); wzStaleTimerRef.current = null; }
        if (wzStaleResolvedRef.current) return; // watchdog already handled
        wzStaleResolvedRef.current = true;
        // Build the updated agents list
        const updatedAgents = wzAgentsRef.current.map((a, i) => i === idx ? {
          ...a, status: 'done' as WzAgentStatus, streamBuf: '',
          soul: doneData.soul ?? '', agentsMd: doneData.agentsMd ?? '',
          userMd: doneData.userMd ?? '', identityMd: doneData.identityMd ?? '',
          heartbeat: doneData.heartbeat ?? '',
        } : a);
        wzAgentsRef.current = updatedAgents;
        setWzAgents(updatedAgents);
        // Auto-advance to next pending agent
        if (!singleOnly) {
          const nextIdx = updatedAgents.findIndex((a, i) => i > idx && a.status === 'pending');
          if (nextIdx >= 0) {
            setTimeout(() => wzRunAgentRef.current(nextIdx, wzAgentsRef.current), 200);
          } else {
            setWzStep2Running(false);
          }
        } else {
          setWzStep2Running(false);
        }
      },
      (code, msg) => {
        if (wzStaleTimerRef.current) { clearTimeout(wzStaleTimerRef.current); wzStaleTimerRef.current = null; }
        if (wzStaleResolvedRef.current) return;
        wzStaleResolvedRef.current = true;
        setWzAgents(prev => prev.map((a, i) => i === idx ? { ...a, status: 'error', error: `${code}: ${msg}` } : a));
        setWzStep2Running(false);
      },
    );
    // Start the initial watchdog (will be reset on first token)
    resetStaleTimer();
  }, [scenarioName, language, selectedModel]);
  wzRunAgentRef.current = wzRunAgent;
  // Keep wzAgentsRef in sync so async callbacks always see the latest state
  // (this runs synchronously on every render, before any effect fires)
  wzAgentsRef.current = wzAgents;

  const wzHandleGenerateAll = useCallback(() => {
    const firstIdx = wzAgents.findIndex(a => a.status === 'pending');
    if (firstIdx >= 0) wzRunAgent(firstIdx, wzAgents);
  }, [wzAgents, wzRunAgent]);

  const wzHandleStop = useCallback(() => {
    wzStep2AbortRef.current?.abort();
    setWzStep2Running(false);
    setWzAgents(prev => prev.map(a => a.status === 'running' ? { ...a, status: 'error', error: stb.wzStoppedByUser || 'Stopped by user' } : a));
  }, [stb.wzStoppedByUser])

  const wzHandleSkip = useCallback((idx: number) => {
    if (wzStep2Running && wzStep2ActiveIdxRef.current === idx) {
      wzStep2AbortRef.current?.abort();
      setWzStep2Running(false);
    }
    setWzAgents(prev => {
      const next = prev.map((a, i) => i === idx ? { ...a, status: 'skipped' as WzAgentStatus } : a);
      if (wzStep2Running && wzStep2ActiveIdxRef.current === idx) {
        const nextIdx = next.findIndex((a, i) => i > idx && a.status === 'pending');
        if (nextIdx >= 0) setTimeout(() => wzRunAgent(nextIdx, next), 100);
      }
      return next;
    });
  }, [wzStep2Running, wzRunAgent]);

  const wzHandleFinish = useCallback(() => {
    if (!wzStep1Result) return;
    const parsed = wzStep1Result.parsed ?? {};
    const result: MultiAgentGenerateResult = {
      reasoning: parsed.reasoning ?? '',
      template: {
        id: parsed.template?.id ?? '',
        name: parsed.template?.name ?? scenarioName,
        description: parsed.template?.description ?? description,
        agents: wzAgents.map(a => ({
          id: a.id, name: a.name, role: a.role, description: a.description,
          icon: a.icon, color: a.color,
          soul: a.soul, agentsMd: a.agentsMd, userMd: a.userMd,
          identityMd: a.identityMd, heartbeat: a.heartbeat,
        })),
        workflow: normalizeWorkflow(parsed.template?.workflow, wzAgents),
      },
    };
    setGenerateResult(normalizeGenerateResult(result));
    setEditedAgents({});
    setStep('preview');
  }, [wzStep1Result, wzAgents, scenarioName, description, normalizeWorkflow, normalizeGenerateResult]);

  // Cleanup wizard SSE on unmount or leaving wizard step
  useEffect(() => {
    if (step !== 'wizard') {
      wzStep1AbortRef.current?.abort();
      wzStep2AbortRef.current?.abort();
    }
  }, [step]);

  const selectedModelLabel = modelOptions.find(o => o.value === selectedModel)?.label;
  const missingModelConfig = isMissingDefaultModelError(error)
    || isMissingDefaultModelError(genWsError?.msg)
    || isMissingDefaultModelError(wzStep1Error);
  const missingModelTitle = stb.modelRequiredTitle || 'Choose a generation model first';
  const missingModelDesc = stb.modelRequiredDesc || 'Choose a generation model below, or configure a default model in OpenClaw and try again.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* ── Header ── */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-violet-500 to-purple-600 shrink-0">
              <span className="material-symbols-outlined text-white text-[18px]">auto_awesome</span>
            </div>
            <div>
              <h2 className="text-[13px] font-bold text-slate-800 dark:text-white leading-tight">
                {stb.title || 'AI Team Builder'}
              </h2>
              <p className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5">
                {stb.subtitle || 'Describe a scenario, AI generates your team'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Minimize button — only shown during background generation */}
            {step === 'generating' && genTaskId && (
              <button
                onClick={() => { setMinimized(true); onClose(); }}
                title={stb.minimizeBtn || 'Minimize — generation continues in background'}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">minimize</span>
                <span className="hidden sm:inline">{stb.minimizeBtn || 'Minimize'}</span>
              </button>
            )}
            {/* Step indicator */}
            {step === 'input' && (
              <div className="hidden sm:flex items-center gap-1">
                {(['input', 'wizard', 'preview'] as const).map((s, i) => {
                  const order: BuilderStep[] = ['input', 'generating', 'wizard', 'preview', 'edit-agent'];
                  const done = order.indexOf(step) > order.indexOf(s);
                  const active = step === s;
                  return (
                    <React.Fragment key={s}>
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-all ${
                        active ? 'bg-violet-500 text-white' : done ? 'bg-violet-500/30 text-violet-400' : 'bg-slate-200 dark:bg-white/10 text-slate-400 dark:text-white/30'
                      }`}>{i + 1}</div>
                      {i < 2 && <div className="w-3 h-px bg-slate-200 dark:bg-white/10" />}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
            <button
              onClick={
                step === 'edit-agent' ? () => setStep('preview')
                : step === 'wizard' ? () => { setStep('input'); setWzPromptUserEdited(false); }
                : step === 'generating' && genTaskId ? () => { setMinimized(true); onClose(); }
                : onClose
              }
              className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 flex items-center justify-center transition-colors"
            >
              <span className="material-symbols-outlined text-[18px] text-slate-400">
                {step === 'edit-agent' ? 'arrow_back'
                  : step === 'generating' && genTaskId ? 'minimize'
                  : 'close'}
              </span>
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0">

          {/* ══ Step: Input ══ */}
          {step === 'input' && (
            <div className="p-5 space-y-4">

              {error && (
                <div className="px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-[11px] text-red-600 dark:text-red-400 flex items-start gap-2">
                  <span className="material-symbols-outlined text-[15px] shrink-0 mt-0.5">error</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-semibold">
                      {missingModelConfig ? missingModelTitle : error}
                    </p>
                    {missingModelConfig && (
                      <>
                        <p className="text-red-500/80 dark:text-red-400/70">{missingModelDesc}</p>
                        {modelOptions.length > 0 && (
                          <button
                            onClick={() => setModelPickerOpen(true)}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-red-500/20 hover:bg-red-500/10 transition-colors text-[10px] font-bold"
                          >
                            <span className="material-symbols-outlined text-[12px]">memory</span>
                            {stb.chooseModelNow || 'Choose model now'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ── Template Picker + Name row ── */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider">
                    {stb.scenarioNameLabel || 'Scenario Name'} <span className="text-red-400">*</span>
                  </label>
                  {/* Template button — like SOUL.md template picker */}
                  <div ref={templatePickerRef} className="relative">
                    <button
                      onClick={() => setTemplatePickerOpen(v => !v)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all ${templatePickerOpen ? 'border-violet-500/50 bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/40 hover:border-violet-400/40 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-500/5'}`}
                    >
                      <span className="material-symbols-outlined text-[14px]">auto_fix_high</span>
                      {stb.templateBtn || 'Templates'}
                      <span className={`material-symbols-outlined text-[12px] transition-transform ${templatePickerOpen ? 'rotate-180' : ''}`}>expand_more</span>
                    </button>

                    {templatePickerOpen && (
                      <div className="absolute end-0 top-full mt-1.5 w-72 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1e2028] shadow-2xl shadow-black/20 z-50 overflow-hidden">
                        <div className="px-3 py-2 border-b border-slate-100 dark:border-white/5">
                          <p className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider">
                            {stb.templatePickerTitle || 'Professional Scenario Templates'}
                          </p>
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                          {SCENARIO_TEMPLATES.map((tpl, i) => (
                            <button
                              key={i}
                              onClick={() => handleApplyTemplate(tpl)}
                              className="w-full text-start px-3 py-2.5 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-white/[0.06] transition-colors border-b border-slate-100 dark:border-white/[0.04] last:border-b-0 group"
                            >
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br ${tpl.color} mt-0.5`}>
                                <span className="material-symbols-outlined text-white text-[15px]">{tpl.icon}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-bold text-slate-700 dark:text-white/80 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                                  {stb[tpl.nameKey] || tpl.name}
                                </p>
                                <p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5 line-clamp-2 leading-relaxed">
                                  {stb[tpl.descKey] || tpl.desc}
                                </p>
                                <div className="flex items-center gap-1.5 mt-1">
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/40 font-medium">
                                    {ma[getWorkflowLabelKey(tpl.workflowType)] || tpl.workflowType}
                                  </span>
                                  <span className="text-[9px] text-slate-400 dark:text-white/30">
                                    {formatAgentCountLabel(tpl.teamSize)}
                                  </span>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <input
                  type="text"
                  value={scenarioName}
                  onChange={e => setScenarioName(e.target.value)}
                  placeholder={stb.scenarioNamePlaceholder || 'e.g. Software Development Team'}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[13px] text-slate-800 dark:text-white/80 placeholder-slate-400 dark:placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50 transition-all"
                />
              </div>

              {/* ── Description ── */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider block mb-1.5">
                  {stb.descriptionLabel || 'Scenario Description'} <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={5}
                  placeholder={stb.descriptionPlaceholder || 'Describe what this team needs to do, their goals, and key responsibilities. The more detail you provide, the better the AI can design the team roles.'}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] text-slate-800 dark:text-white/80 placeholder-slate-400 dark:placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/50 resize-none leading-relaxed transition-all"
                />
                <p className="text-[10px] text-slate-400 dark:text-white/25 mt-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">lightbulb</span>
                  {stb.descriptionHint || 'Tip: Mention domain, tools, or communication style for better results'}
                </p>
              </div>

              {/* ── Team Size + Workflow compact dropdowns ── */}
              <div className="grid grid-cols-2 gap-3">
                {/* Team Size dropdown */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider block mb-1.5">
                    {stb.teamSizeLabel || 'Team Size'}
                  </label>
                  <div ref={teamSizeRef} className="relative">
                    <button
                      onClick={() => { setTeamSizeOpen(v => !v); setWorkflowOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-start transition-all ${
                        teamSizeOpen ? 'border-violet-500/50 ring-1 ring-violet-500/20 bg-violet-500/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-slate-50 dark:bg-white/[0.03]'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px] text-violet-500 shrink-0">
                        {TEAM_SIZES.find(s => s.value === teamSize)?.icon || 'groups'}
                      </span>
                      <span className="flex-1 text-[12px] font-medium text-slate-800 dark:text-white/80 truncate">
                        {stb[`teamSize_${teamSize}`] || teamSize.charAt(0).toUpperCase() + teamSize.slice(1)}
                        <span className="ms-1.5 text-[11px] font-normal text-slate-400 dark:text-white/30">
                          ({formatAgentCountLabel(teamSize)})
                        </span>
                      </span>
                      <span className={`material-symbols-outlined text-[14px] text-slate-400 dark:text-white/30 shrink-0 transition-transform ${teamSizeOpen ? 'rotate-180' : ''}`}>expand_more</span>
                    </button>
                    {teamSizeOpen && (
                      <div className="absolute start-0 end-0 top-full mt-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1e2028] shadow-xl shadow-black/10 dark:shadow-black/40 z-50 py-1 overflow-hidden">
                        {TEAM_SIZES.map(size => (
                          <button
                            key={size.value}
                            onClick={() => { setTeamSize(size.value); setTeamSizeOpen(false); }}
                            className={`w-full text-start px-3 py-2 flex items-center gap-2.5 transition-colors ${
                              size.value === teamSize ? 'bg-violet-500/5 text-violet-600 dark:text-violet-400' : 'text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/[0.06]'
                            }`}
                          >
                            <span className={`material-symbols-outlined text-[16px] ${size.value === teamSize ? 'text-violet-500' : 'text-slate-400 dark:text-white/30'}`}>{size.icon}</span>
                            <span className="text-[11px] font-medium">
                              {stb[`teamSize_${size.value}`] || size.value.charAt(0).toUpperCase() + size.value.slice(1)}
                            </span>
                            <span className="ms-auto text-[10px] text-slate-400 dark:text-white/30">{size.range}</span>
                            {size.value === teamSize && <span className="material-symbols-outlined text-[13px] text-violet-500">check</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Workflow Type dropdown */}
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider block mb-1.5">
                    {teamSize === 'single' ? (stb.agentModeLabel || 'Agent Mode') : (stb.workflowTypeLabel || 'Workflow Style')}
                  </label>
                  {teamSize === 'single' ? (
                    <div className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] text-start">
                      <span className="material-symbols-outlined text-[16px] text-violet-500 shrink-0">person</span>
                      <span className="flex-1 text-[12px] font-medium text-slate-800 dark:text-white/80 truncate">
                        {ma.workflowStandalone || stb.agentModeStandalone || 'Standalone'}
                      </span>
                    </div>
                  ) : (
                    <div ref={workflowRef} className="relative">
                      <button
                        onClick={() => { setWorkflowOpen(v => !v); setTeamSizeOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-start transition-all ${
                          workflowOpen ? 'border-violet-500/50 ring-1 ring-violet-500/20 bg-violet-500/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-slate-50 dark:bg-white/[0.03]'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[16px] text-violet-500 shrink-0">
                          {WORKFLOW_TYPES.find(w => w.value === workflowType)?.icon || 'hub'}
                        </span>
                        <span className="flex-1 text-[12px] font-medium text-slate-800 dark:text-white/80 truncate">
                          {ma[WORKFLOW_TYPES.find(w => w.value === workflowType)?.labelKey || 'workflowCollaborative'] || workflowType}
                        </span>
                        <span className={`material-symbols-outlined text-[14px] text-slate-400 dark:text-white/30 shrink-0 transition-transform ${workflowOpen ? 'rotate-180' : ''}`}>expand_more</span>
                      </button>
                      {workflowOpen && (
                        <div className="absolute start-0 end-0 top-full mt-1 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1e2028] shadow-xl shadow-black/10 dark:shadow-black/40 z-50 py-1 overflow-hidden">
                          {WORKFLOW_TYPES.map(wf => (
                            <button
                              key={wf.value}
                              onClick={() => { setWorkflowType(wf.value); setWorkflowOpen(false); }}
                              className={`w-full text-start px-3 py-2 flex items-center gap-2.5 transition-colors ${
                                wf.value === workflowType ? 'bg-violet-500/5 text-violet-600 dark:text-violet-400' : 'text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/[0.06]'
                              }`}
                            >
                              <span className={`material-symbols-outlined text-[16px] ${wf.value === workflowType ? 'text-violet-500' : 'text-slate-400 dark:text-white/30'}`}>{wf.icon}</span>
                              <span className="text-[11px] font-medium">{ma[wf.labelKey] || wf.value}</span>
                              {wf.value === workflowType && <span className="material-symbols-outlined text-[13px] text-violet-500 ms-auto">check</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Model Selector ── */}
              {modelOptions.length > 0 && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider block mb-1.5">
                    {stb.modelLabel || 'Generation Model'}
                    <span className="ms-1.5 normal-case font-normal text-slate-400 dark:text-white/25">{stb.modelHint || '(optional)'}</span>
                  </label>
                  <div ref={modelPickerRef} className="relative">
                    <button
                      onClick={() => setModelPickerOpen(v => !v)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border text-start transition-all ${modelPickerOpen ? 'border-violet-500/50 ring-1 ring-violet-500/20 bg-violet-500/5' : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 bg-slate-50 dark:bg-white/[0.03]'}`}
                    >
                      <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30 shrink-0">memory</span>
                      <span className={`flex-1 text-[12px] truncate ${selectedModel ? 'text-slate-800 dark:text-white/80 font-medium' : 'text-slate-400 dark:text-white/30'}`}>
                        {selectedModelLabel || stb.modelAuto || 'Auto (default model)'}
                      </span>
                      {selectedModel && (
                        <button
                          onClick={e => { e.stopPropagation(); setSelectedModel(''); }}
                          className="w-4 h-4 rounded flex items-center justify-center hover:bg-slate-200 dark:hover:bg-white/10 shrink-0"
                        >
                          <span className="material-symbols-outlined text-[12px] text-slate-400">close</span>
                        </button>
                      )}
                      <span className={`material-symbols-outlined text-[14px] text-slate-400 dark:text-white/30 shrink-0 transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`}>expand_more</span>
                    </button>

                    {modelPickerOpen && (
                      <div className="absolute start-0 end-0 top-full mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1e2028] shadow-xl shadow-black/10 dark:shadow-black/40 z-50 py-1">
                        <button
                          onClick={() => { setSelectedModel(''); setModelPickerOpen(false); }}
                          className={`w-full text-start px-3 py-2 text-[11px] transition-colors border-b border-slate-100 dark:border-white/[0.06] ${!selectedModel ? 'bg-violet-500/5 text-violet-600 dark:text-violet-400 font-bold' : 'text-slate-500 dark:text-white/40 hover:bg-slate-50 dark:hover:bg-white/[0.06]'}`}
                        >
                          <span className="material-symbols-outlined text-[12px] me-1.5 align-middle">auto_awesome</span>
                          {stb.modelAuto || 'Auto (default model)'}
                        </button>
                        {modelOptions.map(o => (
                          <button
                            key={o.value}
                            onClick={() => { setSelectedModel(o.value); setModelPickerOpen(false); }}
                            className={`w-full text-start px-3 py-2 text-[11px] transition-colors font-mono truncate ${o.value === selectedModel ? 'bg-violet-500/5 text-violet-600 dark:text-violet-400 font-bold' : 'text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/[0.06]'}`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ Step: Generating ══ */}
          {step === 'generating' && !minimized && (() => {
            const phases: { key: typeof genPhase; icon: string; labelKey: string; fallback: string }[] = [
              { key: 'connecting', icon: 'electrical_services', labelKey: 'genPhaseConnecting', fallback: 'Connecting to AI gateway...' },
              { key: 'sending',    icon: 'send',                labelKey: 'genPhaseSending',    fallback: 'Sending prompt to AI...' },
              { key: 'thinking',   icon: 'psychology',          labelKey: 'genPhaseThinking',   fallback: 'AI is generating your team...' },
              { key: 'parsing',    icon: 'data_object',         labelKey: 'genPhaseParsing',    fallback: 'Processing AI response...' },
            ];
            const phaseOrder: (typeof genPhase)[] = ['connecting', 'sending', 'thinking', 'parsing', 'done'];
            const currentIdx = phaseOrder.indexOf(genPhase);
            const currentPhase = phases.find(p => p.key === genPhase) ?? phases[2];
            return (
              <div className="p-6 flex flex-col items-center justify-center py-12 gap-5">
                {/* WS-pushed error banner — shown immediately when backend reports failure */}
                {genWsError && (
                  <div className="w-full max-w-xs rounded-xl border p-3 space-y-1.5 flex items-start gap-2.5
                    bg-red-500/10 border-red-500/25">
                    <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5 text-red-500">
                      {genWsError.code === 'GATEWAY_DISCONNECTED' ? 'wifi_off' : 'error'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-bold text-red-600 dark:text-red-400">
                        {genWsError.code === 'GATEWAY_DISCONNECTED'
                          ? (stb.genErrGateway || 'Gateway disconnected')
                          : missingModelConfig
                            ? missingModelTitle
                          : genWsError.code === 'TIMEOUT'
                            ? (stb.timeoutTitle || 'AI is taking longer than expected')
                            : (stb.generateFailed || 'Generation failed')}
                      </p>
                      <p className="text-[11px] text-red-500/80 dark:text-red-400/70 mt-0.5 break-words">
                        {genWsError.code === 'GATEWAY_DISCONNECTED'
                          ? (stb.genErrGatewayDesc || 'The gateway connection was lost. Check gateway status and retry.')
                          : missingModelConfig
                            ? missingModelDesc
                          : genWsError.msg}
                      </p>
                    </div>
                  </div>
                )}

                {/* Spinner — hidden while WS error is shown */}
                {!genWsError && (
                <div className="relative w-20 h-20">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-600/20 animate-pulse" />
                  <div className="absolute inset-2 rounded-full bg-gradient-to-br from-violet-500/30 to-purple-600/30 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[32px] text-violet-500 animate-spin" style={{ animationDuration: '2s' }}>
                      progress_activity
                    </span>
                  </div>
                </div>
                )}

                {/* Current phase label */}
                <div className="text-center">
                  <p className="text-[14px] font-bold text-slate-800 dark:text-white">
                    {genWsError
                      ? (stb.genErrWaiting || 'Waiting for result...')
                      : (stb[currentPhase.labelKey] || currentPhase.fallback)}
                  </p>
                  {selectedModelLabel && (
                    <p className="text-[10px] text-violet-500/70 mt-2 flex items-center justify-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">memory</span>
                      {selectedModelLabel}
                    </p>
                  )}
                </div>

                {/* Phase step list */}
                <div className="flex flex-col gap-2 w-full max-w-xs">
                  {phases.map((phase, i) => {
                    const phaseIdx = phaseOrder.indexOf(phase.key);
                    const isDone = phaseIdx < currentIdx;
                    const isActive = phase.key === genPhase;
                    return (
                      <div key={phase.key} className={`flex items-center gap-2.5 text-[11px] transition-all duration-500 ${
                        isActive ? 'text-violet-500 dark:text-violet-400' :
                        isDone   ? 'text-slate-400 dark:text-white/30' :
                                   'text-slate-300 dark:text-white/15'
                      }`}>
                        <span className={`material-symbols-outlined text-[15px] shrink-0 ${
                          isDone   ? 'text-violet-400/60' :
                          isActive ? 'animate-pulse' : 'opacity-30'
                        }`}>
                          {isDone ? 'check_circle' : phase.icon}
                        </span>
                        <span className={isActive ? 'font-semibold' : ''}>
                          {stb[phase.labelKey] || phase.fallback}
                        </span>
                        {isActive && (
                          <span className="ml-auto flex gap-0.5">
                            {[0,1,2].map(d => (
                              <span key={d} className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />
                            ))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Live elapsed counter — visible from thinking phase onward */}
                {(genPhase === 'thinking' || genPhase === 'parsing') && (
                  <div className="flex flex-col items-center gap-2 w-full max-w-xs">
                    {/* Elapsed time pill */}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                      </span>
                      <span className="text-[12px] font-mono font-bold text-violet-500 dark:text-violet-400 tabular-nums">
                        {String(Math.floor(genElapsed / 60)).padStart(2, '0')}:{String(genElapsed % 60).padStart(2, '0')}
                      </span>
                      <span className="text-[10px] text-violet-500/60">
                        {genStreamText
                          ? (stb.genAliveStreaming || 'tokens arriving')
                          : genServerActiveRef.current
                            ? (stb.genAliveServer || 'AI responding')
                            : (stb.genAliveClient || 'AI working...')}
                      </span>
                    </div>

                    {/* Live token stream preview */}
                    {genStreamText && (
                      <div className="w-full rounded-xl bg-slate-900/60 dark:bg-black/40 border border-violet-500/15 overflow-hidden">
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-violet-500/10">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                          </span>
                          <span className="text-[9px] font-bold text-green-400/70 uppercase tracking-wider">
                            {stb.genLivePreview || 'Live output'}
                          </span>
                        </div>
                        <div className="px-2.5 py-2 max-h-[90px] overflow-hidden relative">
                          <p className="text-[10px] font-mono text-slate-300/70 dark:text-white/40 leading-relaxed whitespace-pre-wrap break-all line-clamp-5">
                            {genStreamText}
                          </p>
                          {/* Fade-out at the bottom */}
                          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-slate-900/60 dark:from-black/40 to-transparent pointer-events-none" />
                        </div>
                      </div>
                    )}

                    {/* Hint only if waiting a while without stream */}
                    {genElapsed >= 20 && !genStreamText && (
                      <p className="text-[10px] text-slate-400 dark:text-white/25 text-center max-w-[220px]">
                        {stb.genThinkingHint || 'This may take 30–90 seconds depending on team size and model.'}
                      </p>
                    )}

                    {/* Minimize hint */}
                    {genTaskId && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-violet-500/15 bg-violet-500/5">
                        <span className="material-symbols-outlined text-[13px] text-violet-400">info</span>
                        <p className="text-[10px] text-violet-500/70">
                          {stb.minimizeHint || 'You can minimize this window — generation continues in the background.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}


          {/* ══ Step: Wizard ══ */}
          {step === 'wizard' && (
            <div className="flex flex-col">
              {/* Phase tabs */}
              <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-slate-100 dark:border-white/[0.06] shrink-0">
                {(['step1', 'step2'] as const).map((p, i) => {
                  const isActive = wzPhase === p;
                  const isDone = p === 'step1' && wzPhase === 'step2';
                  return (
                    <React.Fragment key={p}>
                      {i > 0 && <span className="w-5 h-px bg-slate-200 dark:bg-white/10 shrink-0" />}
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all ${
                        isDone ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
                        : isActive ? 'bg-violet-500/10 border-violet-500/30 text-violet-600 dark:text-violet-400'
                        : 'bg-slate-100 dark:bg-white/5 border-transparent text-slate-400 dark:text-white/25'
                      }`}>
                        <span className="material-symbols-outlined text-[13px]">
                          {isDone ? 'check_circle' : i === 0 ? 'account_tree' : 'auto_awesome'}
                        </span>
                        {p === 'step1' ? (stb.wzPhase1 || 'Team Structure') : (stb.wzPhase2 || 'Agent Files')}
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* ── Phase 1: Stream core structure ── */}
              {wzPhase === 'step1' && (
                <div className="p-4 space-y-3">
                  {/* Config summary chips */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10">
                      <span className="material-symbols-outlined text-[11px] text-violet-500">edit_note</span>
                      <span className="text-xs font-bold text-slate-700 dark:text-white/70 max-w-[120px] truncate">{scenarioName}</span>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10">
                      <span className="material-symbols-outlined text-[11px] text-violet-500">{TEAM_SIZES.find(s => s.value === teamSize)?.icon || 'groups'}</span>
                      <span className="text-xs text-slate-600 dark:text-white/60">{stb[`teamSize_${teamSize}`] || teamSize} · {TEAM_SIZES.find(s => s.value === teamSize)?.range}</span>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10">
                      <span className="material-symbols-outlined text-[11px] text-violet-500">
                        {effectiveWorkflowType === 'standalone' ? 'person' : (WORKFLOW_TYPES.find(w => w.value === workflowType)?.icon || 'hub')}
                      </span>
                      <span className="text-xs text-slate-600 dark:text-white/60">
                        {ma[getWorkflowLabelKey(effectiveWorkflowType)] || effectiveWorkflowType}
                      </span>
                    </div>
                    {selectedModelLabel && (
                      <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10">
                        <span className="material-symbols-outlined text-[11px] text-violet-500">memory</span>
                        <span className="text-xs text-slate-600 dark:text-white/60 max-w-[100px] truncate">{selectedModelLabel}</span>
                      </div>
                    )}
                  </div>
                  {/* Status + controls */}
                  <div className="flex items-center gap-2">
                    {wzStep1Running
                      ? <span className="material-symbols-outlined text-[17px] text-violet-500 animate-spin" style={{ animationDuration: '1.5s' }}>progress_activity</span>
                      : wzStep1Error ? <span className="material-symbols-outlined text-[17px] text-red-500">error</span>
                      : wzStep1Result ? <span className="material-symbols-outlined text-[17px] text-green-500">check_circle</span>
                      : <span className="material-symbols-outlined text-[17px] text-slate-300 dark:text-white/15">radio_button_unchecked</span>
                    }
                    <p className="text-[13px] font-bold text-slate-700 dark:text-white/80 flex-1 min-w-0">
                      {wzStep1Running ? (stb.wzStep1Running || 'Generating team structure…')
                        : wzStep1Error ? (stb.wzStep1Error || 'Generation failed')
                        : wzStep1Result ? (stb.wzStep1Done || 'Structure ready — click Next to continue')
                        : (stb.wzStep1Waiting || 'Ready to generate')}
                    </p>
                    {wzStep1Running && (
                      <button onClick={wzHandleStep1Stop} className="px-2.5 py-1 rounded-lg text-xs font-bold text-red-500 hover:bg-red-500/10 border border-red-500/20 transition-colors flex items-center gap-1 shrink-0">
                        <span className="material-symbols-outlined text-[12px]">stop</span>
                        {stb.wzStop || 'Stop'}
                      </button>
                    )}
                    {!wzStep1Running && wzStep1Result && (
                      <button onClick={wzHandleStep1Start} className="px-2.5 py-1 rounded-lg text-xs font-bold text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 border border-violet-500/20 transition-colors flex items-center gap-1 shrink-0">
                        <span className="material-symbols-outlined text-[12px]">refresh</span>
                        {stb.wzRegenerate || 'Regenerate'}
                      </button>
                    )}
                  </div>

                  {/* Error */}
                  {wzStep1Error && (
                    <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3">
                      {missingModelConfig ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-red-600 dark:text-red-400">{missingModelTitle}</p>
                          <p className="text-xs text-red-500/80 dark:text-red-400/70">{missingModelDesc}</p>
                          {modelOptions.length > 0 && (
                            <button
                              onClick={() => setModelPickerOpen(true)}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-red-500/20 hover:bg-red-500/10 transition-colors text-[10px] font-bold text-red-600 dark:text-red-400"
                            >
                              <span className="material-symbols-outlined text-[12px]">memory</span>
                              {stb.chooseModelNow || 'Choose model now'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-red-600 dark:text-red-400 font-mono break-all">{wzStep1Error}</p>
                      )}
                    </div>
                  )}

                  {/* Live stream */}
                  {(wzStep1Stream || wzStep1Running) && (
                    <div className="rounded-xl bg-slate-900/70 dark:bg-black/50 border border-violet-500/15 overflow-hidden">
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-violet-500/10">
                        {wzStep1Running && (
                          <span className="relative flex h-1.5 w-1.5 shrink-0">
                            <span className="animate-ping absolute inset-0 rounded-full bg-green-400 opacity-75" />
                            <span className="relative rounded-full h-1.5 w-1.5 bg-green-500" />
                          </span>
                        )}
                        <span className="text-[10px] font-bold text-green-400/70 uppercase tracking-wider">{stb.wzLiveOutput || 'Live output'}</span>
                        <span className="ms-auto text-[10px] text-slate-500 dark:text-white/20 font-mono">{wzStep1Stream.length} chars</span>
                      </div>
                      <div className="px-2.5 py-2 max-h-[180px] overflow-y-auto">
                        <pre className="text-xs font-mono text-slate-300/70 dark:text-white/40 leading-relaxed whitespace-pre-wrap break-all">
                          {wzStep1Stream || ' '}
                          {wzStep1Running && <span className="inline-block w-1.5 h-3 bg-violet-400 animate-pulse ml-0.5 align-middle" />}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Prompt editor — shares wzStep1Prompt with prompt-review step */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setWzPromptExpanded(v => !v)}
                      className="w-full flex items-center justify-between mb-1 group"
                    >
                      <span className="text-xs font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider flex items-center gap-1.5">
                        {stb.promptLabel || 'AI Prompt'}
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${
                          wzPromptUserEdited
                            ? 'bg-amber-500/10 text-amber-500 dark:text-amber-400'
                            : wzPromptSource
                              ? 'bg-violet-500/10 text-violet-500 dark:text-violet-400'
                              : 'bg-slate-200 dark:bg-white/10 text-slate-400 dark:text-white/30'
                        }`}>
                          {wzPromptUserEdited
                            ? (stb.promptSourceEdited || 'Edited')
                            : wzPromptSource
                              ? wzPromptSource
                              : (stb.promptSourceDefault || 'Default')}
                        </span>
                      </span>
                      <div className="flex items-center gap-2">
                        {wzPromptExpanded && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={e => { e.stopPropagation(); setWzStep1Prompt(''); setWzPromptUserEdited(false); setWzPromptSource(null); }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setWzStep1Prompt(''); setWzPromptUserEdited(false); setWzPromptSource(null); } }}
                            className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-500 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[12px]">restart_alt</span>
                            {stb.promptReset || 'Reset'}
                          </span>
                        )}
                        <span className="material-symbols-outlined text-[14px] text-slate-400 group-hover:text-slate-600 dark:group-hover:text-white/50 transition-colors">
                          {wzPromptExpanded ? 'expand_less' : 'expand_more'}
                        </span>
                      </div>
                    </button>
                    {wzPromptExpanded && (
                      <textarea
                        value={wzStep1Prompt}
                        onChange={e => { setWzStep1Prompt(e.target.value); setWzPromptUserEdited(true); setWzPromptSource(stb.promptSourceEdited || 'Edited'); }}
                        placeholder="Leave empty to use the default compact prompt (recommended)"
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-white/70 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-y leading-relaxed placeholder:text-slate-300 dark:placeholder:text-white/15"
                        style={{ minHeight: '96px', maxHeight: '480px' }}
                        spellCheck={false}
                      />
                    )}
                  </div>

                </div>
              )}

              {/* ── Phase 2: Per-agent file generation ── */}
              {wzPhase === 'step2' && (
                <div className="p-4 space-y-3">
                  {/* Summary + progress */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-700 dark:text-white/80">{stb.wzStep2Title || 'Generate agent workspace files'}</p>
                      <p className="text-xs text-slate-400 dark:text-white/30 mt-0.5">
                        {wzAgents.filter(a => a.status === 'done' || a.status === 'skipped').length}/{wzAgents.length} {stb.wzDone || 'done'}
                        {wzAgents.some(a => a.status === 'error') && (
                          <span className="ms-2 text-red-500 text-xs">{wzAgents.filter(a => a.status === 'error').length} {stb.wzErrors || 'errors'}</span>
                        )}
                      </p>
                    </div>
                    <div className="w-20 h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden shrink-0">
                      <div className="h-full rounded-full bg-violet-500 transition-all duration-500"
                        style={{ width: `${wzAgents.length ? (wzAgents.filter(a => a.status === 'done' || a.status === 'skipped').length / wzAgents.length) * 100 : 0}%` }} />
                    </div>
                  </div>

                  {/* Action row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {!wzStep2Running && wzAgents.some(a => a.status === 'pending') && (
                      <button onClick={wzHandleGenerateAll} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-500 hover:bg-violet-600 text-white flex items-center gap-1.5 transition-colors">
                        <span className="material-symbols-outlined text-[13px]">play_arrow</span>
                        {stb.wzGenerateAll || 'Generate all'}
                      </button>
                    )}
                    {wzStep2Running && (
                      <button onClick={wzHandleStop} className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 flex items-center gap-1.5 transition-colors">
                        <span className="material-symbols-outlined text-[13px]">stop</span>
                        {stb.wzStop || 'Stop'}
                      </button>
                    )}
                    {wzAgents.every(a => a.status !== 'pending' && a.status !== 'running') && (
                      <button onClick={wzHandleFinish} className="ms-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-green-500 hover:bg-green-600 text-white flex items-center gap-1.5 transition-colors">
                        <span className="material-symbols-outlined text-[13px]">check</span>
                        {stb.wzFinish || 'Continue to preview'}
                      </button>
                    )}
                    {!wzStep2Running && wzAgents.some(a => a.status === 'pending') && (
                      <button onClick={wzHandleFinish} className="ms-auto px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white/50 border border-dashed border-slate-200 dark:border-white/10 transition-colors">
                        {stb.wzSkipFiles || 'Skip files & continue'}
                      </button>
                    )}
                  </div>

                  {/* Agent cards */}
                  <div className="space-y-2">
                    {wzAgents.map((agent, idx) => {
                      const isActive = wzStep2Running && wzStep2ActiveIdxRef.current === idx && agent.status === 'running';
                      const colorStyle = resolveTemplateColor(agent.color);
                      const statusIcon = agent.status === 'done' ? 'check_circle'
                        : agent.status === 'error' ? 'error'
                        : agent.status === 'skipped' ? 'skip_next'
                        : agent.status === 'running' ? 'progress_activity'
                        : 'radio_button_unchecked';
                      const statusColor = agent.status === 'done' ? 'text-green-500'
                        : agent.status === 'error' ? 'text-red-500'
                        : agent.status === 'skipped' ? 'text-slate-400 dark:text-white/25'
                        : agent.status === 'running' ? 'text-violet-500'
                        : 'text-slate-300 dark:text-white/15';

                      return (
                        <div key={agent.id} className={`rounded-xl border overflow-hidden transition-all ${isActive ? 'border-violet-500/40 shadow-sm shadow-violet-500/10' : 'border-slate-200 dark:border-white/10'}`}>
                          {/* Header row */}
                          <div className="flex items-center gap-2.5 p-2.5 bg-white dark:bg-white/[0.02]">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={colorStyle}>
                              <span className="material-symbols-outlined text-white text-[15px]">{agent.icon}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-bold text-slate-700 dark:text-white/80 truncate">{agent.name}</p>
                              <p className="text-[11px] text-slate-400 dark:text-white/30 truncate">{agent.role}</p>
                            </div>
                            {/* Status icon */}
                            <span className={`material-symbols-outlined text-[16px] shrink-0 ${statusColor} ${isActive ? 'animate-spin' : ''}`}
                              style={isActive ? { animationDuration: '1.5s' } : {}}>{statusIcon}</span>
                            {/* Controls */}
                            <div className="flex items-center gap-0.5 shrink-0">
                              {/* ▶ Start — only for pending agents, when not running globally */}
                              {agent.status === 'pending' && !wzStep2Running && (
                                <button
                                  onClick={() => wzRunAgent(idx, wzAgents, true)}
                                  title={stb.wzStartAgent || 'Start this agent'}
                                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-violet-500/10 text-violet-500 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[15px]">play_arrow</span>
                                </button>
                              )}
                              {/* 🔄 Retry — for error/done agents */}
                              {(agent.status === 'error' || agent.status === 'done') && !wzStep2Running && (
                                <button
                                  onClick={() => {
                                    setWzAgents(prev => prev.map((a, i) => i === idx ? { ...a, status: 'pending', error: undefined } : a));
                                    setTimeout(() => wzRunAgent(idx, wzAgents.map((a, i) => i === idx ? { ...a, status: 'pending' } : a)), 0);
                                  }}
                                  title={stb.wzRetry || 'Retry'}
                                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-violet-500/10 text-violet-400 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[14px]">refresh</span>
                                </button>
                              )}
                              {/* ⏭ Skip */}
                              {agent.status !== 'skipped' && agent.status !== 'done' && (
                                <button
                                  onClick={() => wzHandleSkip(idx)}
                                  title={stb.wzSkip || 'Skip'}
                                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/5 text-slate-400 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[14px]">skip_next</span>
                                </button>
                              )}
                              {/* Re-include skipped */}
                              {agent.status === 'skipped' && (
                                <button
                                  onClick={() => setWzAgents(prev => prev.map((a, i) => i === idx ? { ...a, status: 'pending' } : a))}
                                  title={stb.wzInclude || 'Include'}
                                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/5 text-slate-400 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[14px]">add_circle</span>
                                </button>
                              )}
                              {/* Expand */}
                              <button
                                onClick={() => setWzAgents(prev => prev.map((a, i) => i === idx ? { ...a, expanded: !a.expanded } : a))}
                                className="w-6 h-6 rounded flex items-center justify-center hover:bg-slate-100 dark:hover:bg-white/5 text-slate-400 transition-colors"
                              >
                                <span className="material-symbols-outlined text-[14px]">{agent.expanded ? 'expand_less' : 'expand_more'}</span>
                              </button>
                            </div>
                          </div>

                          {/* Expanded detail */}
                          {agent.expanded && (
                            <div className="border-t border-slate-100 dark:border-white/[0.05] bg-slate-50 dark:bg-white/[0.01] p-2.5 space-y-2">
                              {/* Live stream */}
                              {agent.status === 'running' && agent.streamBuf && (
                                <div className="rounded-lg bg-slate-900/70 border border-violet-500/15 overflow-hidden">
                                  <div className="flex items-center gap-1.5 px-2 py-1 border-b border-violet-500/10">
                                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                                      <span className="animate-ping absolute inset-0 rounded-full bg-green-400 opacity-75" />
                                      <span className="relative rounded-full h-1.5 w-1.5 bg-green-500" />
                                    </span>
                                    <span className="text-[10px] font-bold text-green-400/70 uppercase tracking-wider">{stb.wzLiveOutput || 'Live output'}</span>
                                    <span className="ms-auto flex items-center gap-2">
                                      {agent.startedAt && (
                                        <ElapsedTimer startedAt={agent.startedAt} className="text-[10px] font-mono text-slate-500 dark:text-white/20" />
                                      )}
                                      {(agent.tokenCount ?? 0) > 0 && (
                                        <span className="text-[10px] font-mono text-slate-500 dark:text-white/20">{agent.tokenCount} chars</span>
                                      )}
                                    </span>
                                  </div>
                                  <StreamOutput content={agent.streamBuf} />
                                </div>
                              )}
                              {/* Done: file previews */}
                              {agent.status === 'done' && (
                                <div className="space-y-1.5">
                                  {(['soul', 'agentsMd', 'userMd', 'identityMd', 'heartbeat'] as const).map(key => {
                                    const labels: Record<string, string> = { soul: 'SOUL.md', agentsMd: 'AGENTS.md', userMd: 'USER.md', identityMd: 'IDENTITY.md', heartbeat: 'HEARTBEAT.md' };
                                    const val = agent[key];
                                    if (!val) return null;
                                    return (
                                      <div key={key} className="rounded-lg border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
                                        <div className="flex items-center gap-1.5 px-2 py-1 border-b border-slate-100 dark:border-white/[0.04]">
                                          <span className="material-symbols-outlined text-[11px] text-slate-400">description</span>
                                          <span className="text-[10px] font-bold text-slate-500 dark:text-white/40 font-mono">{labels[key]}</span>
                                        </div>
                                        <p className="px-2 py-1.5 text-xs text-slate-500 dark:text-white/40 line-clamp-2 font-mono leading-relaxed">{val}</p>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {/* Error */}
                              {agent.status === 'error' && <p className="text-xs text-red-500 font-mono break-all">{agent.error}</p>}
                              {/* Prompt editor */}
                              <div>
                                <button
                                  onClick={() => setWzAgents(prev => prev.map((a, i) => i === idx ? { ...a, showPrompt: !a.showPrompt } : a))}
                                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white/50 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[12px]">edit</span>
                                  {stb.wzEditPrompt || 'Edit prompt'}
                                </button>
                                {agent.showPrompt && (
                                  <textarea
                                    value={agent.customPrompt ?? ''}
                                    onChange={e => { const v = e.target.value; setWzAgents(prev => prev.map((a, i) => i === idx ? { ...a, customPrompt: v } : a)); }}
                                    className="mt-1.5 w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] text-[10px] font-mono text-slate-700 dark:text-white/70 resize-y focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                                    style={{ minHeight: '80px', maxHeight: '400px' }}
                                    spellCheck={false}
                                  />
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ══ Step: Preview ══ */}
          {step === 'preview' && generateResult && (
            <div className="p-5 space-y-4">
              {/* Team summary card */}
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-white text-[18px]">groups</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[13px] font-bold text-slate-800 dark:text-white">{generateResult.template.name}</h3>
                    <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5">{generateResult.template.description}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-[9px] font-bold border shrink-0 ${getWorkflowTypeColor(generateResult.template.workflow.type)}`}>
                    {ma[getWorkflowLabelKey(generateResult.template.workflow.type)] || generateResult.template.workflow.type}
                  </span>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-white/5">
                {(['agents', 'workflow', 'reasoning'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                      activeTab === tab
                        ? 'bg-white dark:bg-white/10 text-slate-800 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/60'
                    }`}
                  >
                    {tab === 'agents' && `${stb.tabAgents || 'Agents'} (${generateResult.template.agents.length})`}
                    {tab === 'workflow' && (stb.tabWorkflow || 'Workflow')}
                    {tab === 'reasoning' && (stb.tabReasoning || 'AI Reasoning')}
                  </button>
                ))}
              </div>

              {/* Tab: Agents */}
              {activeTab === 'agents' && (
                <div className="space-y-2">
                  {generateResult.template.agents.map(agent => {
                    const edited = getEffectiveAgent(agent.id);
                    const displayName = edited?.name ?? agent.name;
                    const displayRole = edited?.role ?? agent.role;
                    const displayColor = edited?.color ?? agent.color ?? 'from-blue-500 to-cyan-500';
                    const displayIcon = edited?.icon ?? agent.icon ?? 'person';
                    const isEdited = !!edited;
                    return (
                      <div key={agent.id} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] overflow-hidden">
                        <div className="p-3 flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={resolveTemplateColor(displayColor)}>
                            <span className="material-symbols-outlined text-white text-[17px]">{displayIcon}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[12px] font-bold text-slate-700 dark:text-white/80 truncate">{displayName}</p>
                              {isEdited && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">{stb.edited || 'Edited'}</span>}
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-white/40 truncate">{displayRole}</p>
                            <p className="text-[9px] text-slate-400 dark:text-white/25 font-mono mt-0.5">{agent.id}</p>
                          </div>
                          <button
                            onClick={() => handleOpenAgentEdit(agent)}
                            className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-white/70 flex items-center gap-1 transition-all shrink-0"
                          >
                            <span className="material-symbols-outlined text-[13px]">edit</span>
                            {stb.editAgent || 'Edit'}
                          </button>
                        </div>
                        {(edited?.soul ?? agent.soul) && (
                          <div className="px-3 pb-3 border-t border-slate-100 dark:border-white/5 pt-2">
                            <p className="text-[10px] text-slate-400 dark:text-white/30 font-mono line-clamp-2 leading-relaxed">
                              {(edited?.soul ?? agent.soul)?.substring(0, 180)}...
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tab: Workflow */}
              {activeTab === 'workflow' && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500 dark:text-white/40">{generateResult.template.workflow.description}</p>
                  <div className="relative">
                    <div className="absolute start-4 top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-white/10" />
                    <div className="space-y-2">
                      {generateResult.template.workflow.steps.map((wfStep, idx) => {
                        const agentId = wfStep.agent ?? (wfStep.agents?.[0] ?? '');
                        const agent = generateResult.template.agents.find(a => a.id === agentId);
                        const edited = agent ? getEffectiveAgent(agent.id) : null;
                        const displayColor = edited?.color ?? agent?.color ?? 'from-slate-400 to-slate-500';
                        const displayIcon = edited?.icon ?? agent?.icon ?? 'person';
                        return (
                          <div key={idx} className="relative flex items-start gap-3 ps-8">
                            <div className="absolute start-2 top-1.5 w-4 h-4 rounded-full flex items-center justify-center border-2 border-white dark:border-[#1a1a2e]" style={resolveTemplateColor(displayColor)}>
                              <span className="material-symbols-outlined text-white text-[10px]">{displayIcon}</span>
                            </div>
                            <div className="flex-1 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] p-2.5">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-[9px] font-bold text-slate-400 dark:text-white/30">#{idx + 1}</span>
                                <span className="text-[10px] font-bold text-slate-600 dark:text-white/60">{edited?.name ?? agent?.name ?? agentId}</span>
                                {wfStep.parallel && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-500/10 text-green-500">{ma.parallel || 'Parallel'}</span>}
                              </div>
                              <p className="text-[11px] text-slate-700 dark:text-white/70">{wfStep.action}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab: AI Reasoning */}
              {activeTab === 'reasoning' && (
                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-[18px] text-violet-500">psychology</span>
                    <p className="text-[11px] font-bold text-slate-600 dark:text-white/60">{stb.reasoningTitle || 'Why this team design?'}</p>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-white/60 leading-relaxed whitespace-pre-wrap">{generateResult.reasoning}</p>
                </div>
              )}

              {/* Regenerate */}
              <button
                onClick={() => setStep('input')}
                className="w-full py-2 rounded-xl border border-dashed border-slate-300 dark:border-white/10 text-[11px] text-slate-500 dark:text-white/40 hover:border-violet-500/40 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-500/5 flex items-center justify-center gap-1.5 transition-all"
              >
                <span className="material-symbols-outlined text-[14px]">refresh</span>
                {stb.regenerate || 'Regenerate with different settings'}
              </button>
            </div>
          )}

          {/* ══ Step: Edit Agent ══ */}
          {step === 'edit-agent' && editingAgent && (
            <div className="p-5 space-y-3">
              {/* Agent header + basic fields */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={resolveTemplateColor(editingAgent.color)}>
                  <span className="material-symbols-outlined text-white text-[18px]">{editingAgent.icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-bold text-slate-700 dark:text-white/80">{stb.editAgentTitle || 'Edit Agent'}</p>
                  <p className="text-[10px] text-slate-400 dark:text-white/30 font-mono">{editingAgent.id}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">{stb.agentName || 'Name'}</label>
                  <input type="text" value={editingAgent.name} onChange={e => setEditingAgent(prev => prev ? { ...prev, name: e.target.value } : prev)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] text-slate-800 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-violet-500/30" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">{stb.agentIcon || 'Icon'}</label>
                  <input type="text" value={editingAgent.icon} onChange={e => setEditingAgent(prev => prev ? { ...prev, icon: e.target.value } : prev)} placeholder="person"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] text-slate-800 dark:text-white/80 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/30" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">{stb.agentRole || 'Role'}</label>
                <input type="text" value={editingAgent.role} onChange={e => setEditingAgent(prev => prev ? { ...prev, role: e.target.value } : prev)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] text-slate-800 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-violet-500/30" />
              </div>

              {/* File tabs */}
              <div>
                <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-white/5 mb-2">
                  {([
                    { key: 'soul', label: 'SOUL.md', icon: 'psychology' },
                    { key: 'agentsMd', label: 'AGENTS.md', icon: 'home' },
                    { key: 'identityMd', label: 'IDENTITY.md', icon: 'badge' },
                    { key: 'userMd', label: 'USER.md', icon: 'person' },
                    { key: 'heartbeat', label: 'HEARTBEAT.md', icon: 'favorite' },
                  ] as const).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setEditingAgent(prev => prev ? { ...prev, _activeTab: tab.key } as any : prev)}
                      className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[9px] font-bold transition-all ${
                        ((editingAgent as any)._activeTab ?? 'soul') === tab.key
                          ? 'bg-white dark:bg-white/10 text-slate-800 dark:text-white shadow-sm'
                          : 'text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/60'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[12px]">{tab.icon}</span>
                      <span className="hidden sm:inline">{tab.label}</span>
                    </button>
                  ))}
                </div>

                {/* SOUL.md */}
                {((editingAgent as any)._activeTab ?? 'soul') === 'soul' && (
                  <textarea value={editingAgent.soul} onChange={e => setEditingAgent(prev => prev ? { ...prev, soul: e.target.value } : prev)} rows={10}
                    placeholder="# Agent Name&#10;&#10;**Role:** ...&#10;&#10;Describe persona, responsibilities, working style..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[11px] text-slate-800 dark:text-white/80 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none leading-relaxed" />
                )}

                {/* AGENTS.md */}
                {(editingAgent as any)._activeTab === 'agentsMd' && (
                  <textarea value={editingAgent.agentsMd} onChange={e => setEditingAgent(prev => prev ? { ...prev, agentsMd: e.target.value } : prev)} rows={10}
                    placeholder="# AGENTS.md - Workspace&#10;&#10;## Session Startup&#10;1. Read SOUL.md&#10;2. Read USER.md&#10;..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[11px] text-slate-800 dark:text-white/80 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none leading-relaxed" />
                )}

                {/* IDENTITY.md */}
                {(editingAgent as any)._activeTab === 'identityMd' && (
                  <textarea value={editingAgent.identityMd} onChange={e => setEditingAgent(prev => prev ? { ...prev, identityMd: e.target.value } : prev)} rows={10}
                    placeholder="# IDENTITY.md&#10;&#10;- **Name:**&#10;- **Creature:**&#10;- **Vibe:**&#10;- **Emoji:**"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[11px] text-slate-800 dark:text-white/80 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none leading-relaxed" />
                )}

                {/* USER.md */}
                {(editingAgent as any)._activeTab === 'userMd' && (
                  <textarea value={editingAgent.userMd} onChange={e => setEditingAgent(prev => prev ? { ...prev, userMd: e.target.value } : prev)} rows={10}
                    placeholder="# USER.md - About Your Human&#10;&#10;- **Name:**&#10;- **What to call them:**&#10;- **Timezone:**&#10;- **Notes:**"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[11px] text-slate-800 dark:text-white/80 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none leading-relaxed" />
                )}

                {/* HEARTBEAT.md */}
                {(editingAgent as any)._activeTab === 'heartbeat' && (
                  <textarea value={editingAgent.heartbeat} onChange={e => setEditingAgent(prev => prev ? { ...prev, heartbeat: e.target.value } : prev)} rows={10}
                    placeholder="- [ ] Check incoming requests&#10;- [ ] Review pending tasks&#10;- [ ] Update status"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[11px] text-slate-800 dark:text-white/80 font-mono focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-none leading-relaxed" />
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-3.5 border-t border-slate-100 dark:border-white/5 flex items-center justify-between shrink-0">
          <button
            onClick={
              step === 'edit-agent' ? () => setStep('preview')
              : step === 'wizard' ? () => { setStep('input'); setWzPromptUserEdited(false); }
              : step === 'generating' && genTaskId
                ? () => { setMinimized(true); onClose(); }
              : onClose
            }
            className="px-4 py-2 rounded-lg text-[11px] font-bold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            {step === 'edit-agent' ? (stb.backToPreview || 'Back')
              : step === 'wizard' ? (stb.back || 'Back')
              : step === 'generating' && genTaskId ? (stb.minimizeBtn || 'Minimize')
              : (stb.cancel || 'Cancel')}
          </button>

          <div className="flex items-center gap-2">
            {step === 'input' && (
              <button
                onClick={directLlm ? handlePreparePrompt : handleConfirmGenerate}
                disabled={!scenarioName.trim() || !description.trim()}
                className="px-5 py-2 rounded-lg text-[12px] font-bold bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 transition-all shadow-md shadow-violet-500/20"
              >
                <span className="material-symbols-outlined text-[16px]">{directLlm ? 'auto_fix_high' : 'auto_awesome'}</span>
                {directLlm ? (stb.generateWizardBtn || '生成团队') : (stb.generateBtn || 'Generate Team with AI')}
              </button>
            )}
            {step === 'wizard' && wzPhase === 'step1' && !wzStep1Running && !wzStep1Result && (
              <button
                onClick={wzHandleStep1Start}
                className="px-5 py-2 rounded-lg text-[12px] font-bold bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 flex items-center gap-2 transition-all shadow-md shadow-violet-500/20"
              >
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                {stb.wzStart || '开始'}
              </button>
            )}
            {step === 'wizard' && wzPhase === 'step1' && wzStep1Result && (
              <button
                onClick={() => setWzPhase('step2')}
                className="px-5 py-2 rounded-lg text-[12px] font-bold bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 flex items-center gap-2 transition-all shadow-md shadow-violet-500/20"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                {stb.wzNextToAgentFiles || 'Next: Generate Agent Files'}
              </button>
            )}
            {step === 'preview' && generateResult && (
              <button
                onClick={handleConfirmDeploy}
                className="px-5 py-2 rounded-lg text-[12px] font-bold bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 flex items-center gap-2 transition-all shadow-md shadow-violet-500/20"
              >
                <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
                {stb.deployBtn || 'Deploy This Team'}
              </button>
            )}
            {step === 'edit-agent' && (
              <button
                onClick={handleSaveAgentEdit}
                className="px-5 py-2 rounded-lg text-[12px] font-bold bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 flex items-center gap-2 transition-all"
              >
                <span className="material-symbols-outlined text-[16px]">save</span>
                {stb.saveAgent || 'Save Changes'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScenarioTeamBuilder;
