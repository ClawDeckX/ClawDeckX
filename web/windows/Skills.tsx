
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi, clawHubApi, skillTranslationApi } from '../services/api';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import CustomSelect from '../components/CustomSelect';
import TranslateModelPicker from '../components/TranslateModelPicker';
import EmptyState from '../components/EmptyState';
import PluginCenter from './PluginCenter';
import SkillHub from './SkillHub';
import { copyToClipboard } from '../utils/clipboard';

interface SkillsProps { language: Language; }

// 技能状态数据类型（来自 skills.status JSON-RPC）
interface SkillStatus {
  name: string; description: string; source: string; bundled: boolean;
  filePath: string; baseDir: string; skillKey: string;
  primaryEnv?: string; emoji?: string; homepage?: string;
  always: boolean; disabled: boolean; blockedByAllowlist: boolean; eligible: boolean;
  requirements: { bins: string[]; anyBins: string[]; env: string[]; config: string[]; os: string[] };
  missing: { bins: string[]; anyBins: string[]; env: string[]; config: string[]; os: string[] };
  configChecks: { path: string; value: unknown; satisfied: boolean }[];
  install: { id: string; kind: string; label: string; bins: string[] }[];
}

interface SkillsConfig { [key: string]: { enabled?: boolean; apiKey?: string; env?: Record<string, string> } }

type TabId = 'all' | 'market' | 'plugins' | 'skillhub';
type FilterId = 'all' | 'eligible' | 'missing';

type SkillMessage = { kind: 'success' | 'error'; message: string };
type SkillMessageMap = Record<string, SkillMessage>;

// 可展开描述组件
const ExpandableDesc: React.FC<{ text: string; moreLabel: string }> = ({ text, moreLabel }) => {
  const [expanded, setExpanded] = useState(false);
  if (!text) return null;
  const needsExpand = text.length > 80;
  return (
    <div className="mb-3">
      <p className={`text-[11px] text-slate-500 dark:text-white/40 leading-relaxed ${needsExpand ? 'cursor-pointer' : ''} ${expanded ? '' : 'line-clamp-2'}`}
        onClick={() => needsExpand && setExpanded(!expanded)}>
        {text}
      </p>
      {needsExpand && !expanded && (
        <button onClick={() => setExpanded(true)} className="text-[11px] text-primary/70 hover:text-primary font-medium mt-0.5">...{moreLabel}</button>
      )}
    </div>
  );
};

const SOURCE_GROUPS = [
  { id: 'workspace', sources: ['openclaw-workspace'] },
  { id: 'builtIn', sources: ['openclaw-bundled'] },
  { id: 'installedSkills', sources: ['openclaw-managed'] },
  { id: 'extra', sources: ['openclaw-extra'] },
];

function groupSkills(skills: SkillStatus[], sk: any): { id: string; label: string; skills: SkillStatus[] }[] {
  const groups = new Map<string, { id: string; label: string; skills: SkillStatus[] }>();
  for (const def of SOURCE_GROUPS) groups.set(def.id, { id: def.id, label: sk[def.id] || def.id, skills: [] });
  const other = { id: 'other', label: sk.other, skills: [] as SkillStatus[] };
  const builtInDef = SOURCE_GROUPS.find(g => g.id === 'builtIn');
  for (const skill of skills) {
    const match = skill.bundled ? builtInDef : SOURCE_GROUPS.find(g => g.sources.includes(skill.source));
    if (match) groups.get(match.id)?.skills.push(skill);
    else other.skills.push(skill);
  }
  const ordered = SOURCE_GROUPS.map(g => groups.get(g.id)).filter((g): g is NonNullable<typeof g> => !!g && g.skills.length > 0);
  if (other.skills.length > 0) ordered.push(other);
  return ordered;
}

// 构建本地技能安装 prompt
function buildInstallPrompt(skill: SkillStatus, sk: any): string {
  const lines: string[] = [sk.installPromptIntro, ''];
  lines.push(`- ${sk.installPromptName}: ${skill.name}`);
  if (skill.description) lines.push(`- ${sk.installPromptDesc}: ${skill.description}`);
  lines.push(`- ${sk.installPromptSource}: ${skill.source}`);
  const allMissingBins = [...skill.missing.bins, ...((skill.missing as any).anyBins || [])];
  if (allMissingBins.length > 0) lines.push(`- ${sk.installPromptDeps}: ${allMissingBins.join(', ')}`);
  if (skill.missing.env.length > 0) lines.push(`- ${sk.installPromptEnv}: ${skill.missing.env.join(', ')}`);
  if (skill.missing.config.length > 0) lines.push(`- ${sk.installPromptConfig}: ${skill.missing.config.join(', ')}`);
  if (skill.install.length > 0) {
    lines.push(`- ${sk.installPromptInstallCmd}: ${skill.install.map(i => i.label).join(', ')}`);
  }
  lines.push('', sk.installPromptSteps);
  return lines.join('\n');
}

// 构建市场技能安装 prompt
function buildMarketInstallPrompt(item: any, sk: any): string {
  const slug = item.slug || item.name || '';
  const lines: string[] = [sk.installPromptMarket, ''];
  lines.push(`- ${sk.installPromptSlug}: ${slug}`);
  lines.push(`- ${sk.installPromptName}: ${item.displayName || item.name || slug}`);
  if (item.summary || item.description) lines.push(`- ${sk.installPromptDesc}: ${item.summary || item.description}`);
  lines.push('', (sk.installPromptMarketSteps || '').replace('{slug}', slug));
  return lines.join('\n');
}

// 配置弹窗
const ConfigModal: React.FC<{
  skill: SkillStatus; config: SkillsConfig; language: Language;
  onSave: (skillKey: string, data: { enabled?: boolean; apiKey?: string; env?: Record<string, string> }) => Promise<void>;
  onClose: () => void;
}> = ({ skill, config, language, onSave, onClose }) => {
  const sk = (getTranslation(language) as any).sk;
  const entry = config[skill.skillKey] || {};
  const [enabled, setEnabled] = useState(entry.enabled !== false);
  const [apiKey, setApiKey] = useState(entry.apiKey || '');
  const [envPairs, setEnvPairs] = useState<[string, string][]>(() => {
    const e = entry.env || {};
    const pairs = Object.entries(e) as [string, string][];
    // 补充 missing env 的空行
    for (const envName of skill.missing.env) {
      if (!pairs.some(([k]) => k === envName)) pairs.push([envName, '']);
    }
    return pairs.length > 0 ? pairs : [['', '']];
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of envPairs) { if (k.trim()) env[k.trim()] = v; }
      await onSave(skill.skillKey, { enabled, apiKey: apiKey.trim() || undefined, env: Object.keys(env).length > 0 ? env : undefined });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md mx-4 bg-white dark:bg-[#1c1e24] rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/5 flex items-center gap-3">
          <span className="text-xl">{skill.emoji || '⚙️'}</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm text-slate-800 dark:text-white truncate">{sk.configureSkill}: {skill.name}</h3>
            <p className="text-[10px] text-slate-400 truncate">{skill.skillKey}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
            <span className="material-symbols-outlined text-[16px] text-slate-400">close</span>
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {/* 启用/禁用 */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 dark:text-white/80">{enabled ? sk.enable : sk.disable}</span>
            <button onClick={() => setEnabled(!enabled)} className={`w-10 h-5 rounded-full transition-colors relative ${enabled ? 'bg-mac-green' : 'bg-slate-300 dark:bg-white/20'}`}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
            </button>
          </div>
          {/* API Key */}
          {skill.primaryEnv && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1 block">{sk.apiKey} ({skill.primaryEnv})</label>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={skill.primaryEnv}
                className="w-full h-9 px-3 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-xs font-mono text-slate-800 dark:text-white outline-none focus:border-primary" />
            </div>
          )}
          {/* 环境变量 */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1 block">{sk.envVars}</label>
            {envPairs.map(([k, v], i) => (
              <div key={i} className="flex gap-1.5 mb-1.5">
                <input value={k} onChange={e => { const n = [...envPairs]; n[i] = [e.target.value, v]; setEnvPairs(n); }} placeholder={sk.key}
                  className="flex-1 h-8 px-2 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded text-[10px] font-mono text-slate-800 dark:text-white outline-none focus:border-primary" />
                <input value={v} onChange={e => { const n = [...envPairs]; n[i] = [k, e.target.value]; setEnvPairs(n); }} placeholder={sk.value}
                  className="flex-1 h-8 px-2 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded text-[10px] font-mono text-slate-800 dark:text-white outline-none focus:border-primary" />
                <button onClick={() => setEnvPairs(envPairs.filter((_, j) => j !== i))} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-mac-red">
                  <span className="material-symbols-outlined text-[14px]">remove_circle</span>
                </button>
              </div>
            ))}
            <button onClick={() => setEnvPairs([...envPairs, ['', '']])} className="text-[10px] text-primary font-bold hover:underline">+ {sk.addEnv}</button>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-200 dark:border-white/5 flex justify-end gap-2">
          <button onClick={onClose} className="h-8 px-4 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-white/50 dark:hover:text-white">{sk.cancel}</button>
          <button onClick={handleSave} disabled={saving} className="h-8 px-5 bg-primary text-white text-xs font-bold rounded-lg disabled:opacity-50">
            {saving ? sk.loading : sk.save}
          </button>
        </div>
      </div>
    </div>
  );
};

// 技能卡片
const SkillCard: React.FC<{
  skill: SkillStatus; config: SkillsConfig; language: Language;
  onConfigure: (skill: SkillStatus) => void;
  onCopyInstall: (skill: SkillStatus) => void;
  onSendInstall: (skill: SkillStatus) => void;
  onToggle: (skill: SkillStatus) => void;
  gwReady: boolean;
  busyKey: string | null;
  message: SkillMessage | null;
  translation?: { name: string; description: string; status: string };
  autoTranslate: boolean;
}> = ({ skill, config, language, onConfigure, onCopyInstall, onSendInstall, onToggle, gwReady, busyKey, message, translation, autoTranslate }) => {
  const sk = (getTranslation(language) as any).sk;
  const showTranslated = autoTranslate && language !== 'en' && translation?.status === 'cached';
  const entry = config[skill.skillKey];
  const isDisabled = entry?.enabled === false || skill.disabled;
  const isBusy = busyKey === skill.skillKey;
  const hasMissing = !skill.eligible && !skill.always;
  const missingBins = skill.missing.bins.length + (skill.missing as any).anyBins?.length || 0;
  const missingEnv = skill.missing.env.length;
  const missingOs = skill.missing.os.length;
  const missingConfig = skill.missing.config.length;

  const unsupportedOs = missingOs > 0;

  return (
    <div className={`bg-slate-50 dark:bg-white/[0.02] border rounded-2xl p-4 transition-all group shadow-sm flex flex-col ${isDisabled ? 'border-slate-200/50 dark:border-white/5 opacity-60' :
        unsupportedOs ? 'border-slate-200/50 dark:border-white/5 opacity-40' :
          skill.eligible ? 'border-mac-green/30 dark:border-mac-green/20 hover:border-mac-green/60' :
            'border-slate-200 dark:border-white/10 hover:border-primary/40'
      }`}>
      {/* 头部 */}
      <div className="flex items-center gap-2.5 mb-2">
        <span className="text-lg leading-none">{skill.emoji || '⚙️'}</span>
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-[13px] text-slate-800 dark:text-white truncate">{showTranslated && translation?.name ? translation.name : skill.name}</h4>
          {translation?.status === 'translating' && <span className="text-[9px] text-primary animate-pulse">{sk.translating}</span>}
        </div>
        {/* 内联 Enable/Disable 开关 */}
        <button onClick={(e) => { e.stopPropagation(); onToggle(skill); }} disabled={isBusy || hasMissing}
          className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${hasMissing ? 'bg-slate-300 dark:bg-white/20 opacity-50 cursor-not-allowed' : isDisabled ? 'bg-slate-300 dark:bg-white/20' : 'bg-mac-green'}`}>
          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isDisabled || hasMissing ? 'translate-x-0.5 rtl:-translate-x-0.5' : 'translate-x-[18px] rtl:-translate-x-[18px]'}`} />
        </button>
      </div>

      {/* 状态标签行 */}
      <div className="flex flex-wrap gap-1 mb-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 font-bold">{skill.source}</span>
        {skill.bundled && skill.source !== 'openclaw-bundled' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold">{sk.bundled}</span>
        )}
        {isDisabled ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-white/10 text-slate-500 font-bold">{sk.disabled}</span>
        ) : skill.eligible ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-mac-green/15 text-mac-green font-bold">{sk.eligible}</span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold">{sk.notEligible}</span>
        )}
        {skill.blockedByAllowlist && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-mac-red/10 text-mac-red font-bold">{sk.blockedByAllowlist}</span>
        )}
      </div>

      {/* 描述 */}
      <ExpandableDesc text={showTranslated && translation?.description ? translation.description : skill.description} moreLabel={sk.expandMore} />

      {/* 缺失依赖提示 */}
      {hasMissing && !isDisabled && (
        <div className="mb-3 space-y-1">
          {missingBins > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              <span className="material-symbols-outlined text-[12px]">terminal</span>
              <span className="truncate">{sk.missingBins}: {[...skill.missing.bins, ...(skill.missing as any).anyBins || []].join(', ')}</span>
            </div>
          )}
          {missingEnv > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              <span className="material-symbols-outlined text-[12px]">key</span>
              <span className="truncate">{sk.missingEnv}: {skill.missing.env.join(', ')}</span>
            </div>
          )}
          {missingOs > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-500">
              <span className="material-symbols-outlined text-[12px]">desktop_windows</span>
              <span>{sk.missingOs}</span>
            </div>
          )}
          {missingConfig > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              <span className="material-symbols-outlined text-[12px]">settings</span>
              <span className="truncate">{sk.missingConfig}: {skill.missing.config.join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Per-skill message */}
      {message && (
        <p className={`text-[11px] font-bold mb-2 ${message.kind === 'error' ? 'text-mac-red' : 'text-mac-green'}`}>{message.message}</p>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-1.5 mt-auto pt-1" onClick={e => e.stopPropagation()}>
        {hasMissing && !unsupportedOs && (
          gwReady ? (
            <button onClick={() => onSendInstall(skill)}
              className="flex-1 h-7 bg-primary/15 text-primary hover:bg-primary/25 text-[10px] font-bold rounded-lg transition-colors flex items-center justify-center gap-1 truncate">
              <span className="material-symbols-outlined text-[12px]">send</span>
              <span className="truncate">{sk.requestInstall}</span>
            </button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onCopyInstall(skill); }}
              className="flex-1 h-7 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 text-[10px] font-bold rounded-lg transition-colors flex items-center justify-center gap-1 truncate">
              <span className="material-symbols-outlined text-[12px]">content_copy</span>
              <span className="truncate">{sk.copyInstallInfo}</span>
            </button>
          )
        )}
        {unsupportedOs && (
          <span className="flex-1 h-7 bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-white/20 text-[10px] font-bold rounded-lg flex items-center justify-center gap-1">
            <span className="material-symbols-outlined text-[12px]">block</span>
            {sk.missingOs}
          </span>
        )}
        <button onClick={() => onConfigure(skill)} className="h-7 px-2.5 bg-white dark:bg-white/10 text-[10px] font-bold rounded-lg border border-slate-200 dark:border-white/5 hover:border-primary/40 transition-colors flex items-center gap-1 shrink-0">
          <span className="material-symbols-outlined text-[12px]">tune</span>
          {sk.configure}
        </button>
        {skill.homepage && (
          <a href={skill.homepage} target="_blank" rel="noopener noreferrer" className="h-7 w-7 flex items-center justify-center bg-white dark:bg-white/10 rounded-lg border border-slate-200 dark:border-white/5 hover:border-primary/40 transition-colors shrink-0">
            <span className="material-symbols-outlined text-[12px] text-slate-400">open_in_new</span>
          </a>
        )}
      </div>
    </div>
  );
};

const Skills: React.FC<SkillsProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const sk = t.sk as any;
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [filter, setFilter] = useState<FilterId>('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const SKILLS_CACHE_KEY = 'skills.cache.v1';
  const readCachedSkills = (): { skills: SkillStatus[]; config: SkillsConfig } | null => {
    try {
      const raw = localStorage.getItem(SKILLS_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  };
  const writeCachedSkills = (skills: SkillStatus[], config: SkillsConfig) => {
    try { localStorage.setItem(SKILLS_CACHE_KEY, JSON.stringify({ skills, config })); } catch { /* ignore */ }
  };
  const _cached = useMemo(() => readCachedSkills(), []);
  const [skills, setSkills] = useState<SkillStatus[]>(_cached?.skills ?? []);
  const [skillsConfig, setSkillsConfig] = useState<SkillsConfig>(_cached?.config ?? {});
  const [loading, setLoading] = useState(!_cached);
  const [error, setError] = useState('');
  const [configSkill, setConfigSkill] = useState<SkillStatus | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [skillMessages, setSkillMessages] = useState<SkillMessageMap>({});
  const [groupView, setGroupView] = useState(false);
  const [canSendToAgent, setCanSendToAgent] = useState(false);

  // Sort
  const [sortBy, setSortBy] = useState<'name' | 'status' | 'source'>('name');
  // Compact list view
  const [compactView, setCompactView] = useState(false);
  // Detail panel
  const [detailSkill, setDetailSkill] = useState<SkillStatus | null>(null);
  // Market detail
  const [marketDetail, setMarketDetail] = useState<any>(null);
  const [marketDetailLoading, setMarketDetailLoading] = useState(false);
  // Batch mode
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  // Search ref for keyboard shortcut
  const searchRef = useRef<HTMLInputElement>(null);

  // 自动翻译开关（默认开启，使用 localStorage 持久化）
  const [autoTranslate, setAutoTranslate] = useState(() => {
    const saved = localStorage.getItem('skills-auto-translate');
    return saved === null ? true : saved === 'true';
  });

  // 翻译引擎偏好: "" = auto (LLM优先), "free" = 仅免费API
  const [translateEngine, setTranslateEngine] = useState<'' | 'free'>(() => {
    const saved = localStorage.getItem('skills-translate-engine');
    return saved === 'free' ? 'free' : '';
  });

  // 技能翻译缓存: skillKey -> { name, description, status }
  const [translations, setTranslations] = useState<Record<string, { name: string; description: string; status: string; engine?: string }>>({});

  const sentinelRef = useRef<HTMLDivElement>(null);

  // ClawHub 市场
  const [marketQuery, setMarketQuery] = useState('');
  const [marketResults, setMarketResults] = useState<any[]>([]);
  const [marketSearching, setMarketSearching] = useState(false);
  const [marketSort, setMarketSort] = useState<'newest' | 'downloads' | 'stars'>('newest');
  const [marketCursor, setMarketCursor] = useState<string | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketLoaded, setMarketLoaded] = useState(false);
  const [marketLoadingMore, setMarketLoadingMore] = useState(false);
  const [marketInstalledSlugs, setMarketInstalledSlugs] = useState<Set<string>>(new Set());
  const [marketRateLimit, setMarketRateLimit] = useState<{ limit: string; remaining: string; reset: string } | null>(null);
  const skillsReqSeqRef = useRef(0);
  const marketListReqSeqRef = useRef(0);
  const marketSearchReqSeqRef = useRef(0);

  const fetchSkills = useCallback(async () => {
    const reqId = ++skillsReqSeqRef.current;
    setLoading(true);
    setError('');
    try {
      const [statusRes, configRes, installedRes] = await Promise.all([
        gwApi.skills(),
        gwApi.skillsConfig(),
        clawHubApi.installed().catch(() => null),
      ]);
      if (reqId !== skillsReqSeqRef.current) return;
      const statusData = statusRes as any;
      const configData = configRes as any;
      const newSkills = statusData?.skills || [];
      const newConfig = configData?.entries || {};
      setSkills(newSkills);
      setSkillsConfig(newConfig);
      writeCachedSkills(newSkills, newConfig);
      // 填充市场已安装 slug 集合
      if (installedRes) {
        const installedData = installedRes as any;
        const list = installedData?.skills || installedData || [];
        if (Array.isArray(list)) {
          setMarketInstalledSlugs(new Set(list.map((s: any) => s.slug || s.name || '').filter(Boolean)));
        }
      }
    } catch (e: any) {
      if (reqId !== skillsReqSeqRef.current) return;
      setError(e?.message || sk.loadFailed);
    } finally {
      if (reqId === skillsReqSeqRef.current) setLoading(false);
    }
  }, [sk.loadFailed]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 120);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { fetchSkills(); });
    return () => cancelAnimationFrame(raf);
  }, [fetchSkills]);

  // 检测 Gateway 连接状态 + 是否有可用频道 + 是否配置了模型
  useEffect(() => {
    (async () => {
      try {
        await gwApi.health();
        const [chData, cfgData] = await Promise.all([
          gwApi.channels() as Promise<any>,
          gwApi.configGet() as Promise<any>,
        ]);
        const list = chData?.channels ?? chData?.list ?? (Array.isArray(chData) ? chData : []);
        const active = Array.isArray(list) ? list.filter((ch: any) => ch.connected || ch.running || ch.status === 'connected') : [];
        const providers = cfgData?.models?.providers || {};
        const hasModel = Object.keys(providers).length > 0;
        setCanSendToAgent(active.length > 0 && hasModel);
      } catch {
        setCanSendToAgent(false);
      }
    })();
  }, []);

  // 通用异步翻译批处理：查询缓存 → 触发翻译 → 轮询结果
  const translateBatch = useCallback(async (
    lang: string,
    items: { skill_key: string; name: string; description: string }[],
    engine?: string,
  ) => {
    if (lang === 'en' || items.length === 0) return;

    // 先检查本地 state 缓存，过滤掉已经有缓存的项
    const itemsToCheck = items.filter(item => {
      const existing = translations[item.skill_key];
      if (!existing || existing.status !== 'cached') return true;
      // 如果指定了引擎，且缓存中的引擎不匹配，需要重新翻译
      if (engine && existing.engine && existing.engine !== engine) return true;
      return false;
    });

    if (itemsToCheck.length === 0) return; // 全部已缓存，无需请求

    try {
      const allKeys = itemsToCheck.map(s => s.skill_key);
      // 1. 查询服务端缓存
      const cached = await skillTranslationApi.get(lang, allKeys) as any;
      const entries: any[] = Array.isArray(cached) ? cached : (cached?.data || []);
      const cachedMap: Record<string, boolean> = {};

      // 立即设置已缓存的翻译（无延迟）
      if (entries.length > 0) {
        setTranslations(prev => {
          const next = { ...prev };
          for (const e of entries) {
            if (e.status === 'cached') {
              // 如果指定了引擎且缓存引擎不匹配，跳过（需要重新翻译）
              if (engine && e.engine && e.engine !== engine) continue;
              next[e.skill_key] = { name: e.name, description: e.description, status: 'cached', engine: e.engine || '' };
              cachedMap[e.skill_key] = true;
            }
          }
          return next;
        });
      }

      // 2. 收集真正需要翻译的（服务端也没缓存的）
      const needTranslate = itemsToCheck.filter(s => !cachedMap[s.skill_key] && (s.name || s.description));
      if (needTranslate.length === 0) return;

      // 3. 先设置 translating 状态（只针对需要翻译的项）
      setTranslations(prev => {
        const next = { ...prev };
        for (const s of needTranslate) {
          if (!next[s.skill_key] || next[s.skill_key].status !== 'cached') {
            next[s.skill_key] = { name: '', description: '', status: 'translating' };
          }
        }
        return next;
      });

      // 4. 触发后台翻译（传递引擎偏好）
      await skillTranslationApi.translate(lang, needTranslate, engine || undefined);

      // 5. 轮询获取翻译结果
      const pendingKeys = needTranslate.map(s => s.skill_key);
      let retries = 0;
      const poll = setInterval(async () => {
        retries++;
        if (retries > 30) { clearInterval(poll); return; }
        try {
          const res = await skillTranslationApi.get(lang, pendingKeys) as any;
          const list: any[] = Array.isArray(res) ? res : (res?.data || []);
          let allDone = true;
          setTranslations(prev => {
            const next = { ...prev };
            for (const e of list) {
              if (e.status === 'cached') {
                next[e.skill_key] = { name: e.name, description: e.description, status: 'cached', engine: e.engine || '' };
              } else {
                allDone = false;
              }
            }
            return next;
          });
          if (allDone) clearInterval(poll);
        } catch { /* ignore poll errors */ }
      }, 10000);
    } catch { /* ignore */ }
  }, [translations]);

  // 持久化自动翻译设置
  useEffect(() => {
    localStorage.setItem('skills-auto-translate', String(autoTranslate));
  }, [autoTranslate]);

  // 持久化翻译引擎偏好
  useEffect(() => {
    localStorage.setItem('skills-translate-engine', translateEngine);
  }, [translateEngine]);

  // 合并翻译请求：本地技能 + 市场技能，添加防抖避免频繁请求
  useEffect(() => {
    if (!autoTranslate || language === 'en') return;

    // 收集所有需要翻译的项
    const allItems: { skill_key: string; name: string; description: string }[] = [];

    // 本地技能
    for (const s of skills) {
      allItems.push({ skill_key: s.skillKey, name: s.name || '', description: s.description || '' });
    }

    // 市场技能
    for (const item of marketResults) {
      allItems.push({
        skill_key: `market:${(item as any).slug || (item as any).name || ''}`,
        name: (item as any).displayName || (item as any).name || '',
        description: (item as any).summary || (item as any).description || '',
      });
    }

    if (allItems.length === 0) return;

    // 防抖：500ms 后执行，避免快速连续触发
    const timer = setTimeout(() => {
      // 分批处理：每批最多 15 个，依次处理所有批次
      const batchSize = 15;
      const processBatches = async () => {
        for (let i = 0; i < allItems.length; i += batchSize) {
          const batch = allItems.slice(i, i + batchSize);
          if (batch.length > 0) {
            await translateBatch(language, batch, translateEngine || undefined);
          }
        }
      };
      processBatches();
    }, 500);

    return () => clearTimeout(timer);
  }, [autoTranslate, language, skills, marketResults, translateBatch, translateEngine]);

  // 复制技能安装信息到剪贴板
  const handleCopyInstall = useCallback((skill: SkillStatus) => {
    const prompt = buildInstallPrompt(skill, sk);
    if (!navigator.clipboard) {
      toast('error', 'Clipboard not available');
      return;
    }
    copyToClipboard(prompt).then(() => {
      toast('success', sk.copiedHint);
    }).catch(() => { toast('error', 'Copy failed'); });
  }, [sk, toast]);

  // 一键发送技能安装信息给代理
  const handleSendInstall = useCallback(async (skill: SkillStatus) => {
    const prompt = buildInstallPrompt(skill, sk);
    try {
      await gwApi.proxy('agent', { message: prompt });
      toast('success', sk.sentToAgentHint);
    } catch (err: any) {
      toast('error', `${sk.sendFailed}: ${err?.message || ''}`);
    }
  }, [sk, toast]);

  // 复制市场技能安装信息到剪贴板
  const handleCopyMarketInstall = useCallback((item: any) => {
    const prompt = buildMarketInstallPrompt(item, sk);
    if (!navigator.clipboard) {
      toast('error', 'Clipboard not available');
      return;
    }
    copyToClipboard(prompt).then(() => {
      toast('success', sk.copiedHint);
    }).catch(() => { toast('error', 'Copy failed'); });
  }, [sk, toast]);

  // 一键发送市场技能安装信息给代理
  const handleSendMarketInstall = useCallback(async (item: any) => {
    const prompt = buildMarketInstallPrompt(item, sk);
    try {
      await gwApi.proxy('agent', { message: prompt });
      toast('success', sk.sentToAgentHint);
    } catch (err: any) {
      toast('error', `${sk.sendFailed}: ${err?.message || ''}`);
    }
  }, [sk, toast]);

  // 过滤技能
  const filteredSkills = useMemo(() => {
    let list = skills;
    // Filter within skills tab
    if (filter === 'eligible') list = list.filter(s => s.eligible);
    else if (filter === 'missing') {
      list = list.filter(s => !s.eligible && !s.always);
      // 排序：可安装的在前，不支持当前系统的在后
      list = [...list].sort((a, b) => {
        const aUnsupported = a.missing.os.length > 0 ? 1 : 0;
        const bUnsupported = b.missing.os.length > 0 ? 1 : 0;
        if (aUnsupported !== bUnsupported) return aUnsupported - bUnsupported;
        // 有安装选项的排前面
        const aInstallable = a.install.length > 0 ? 0 : 1;
        const bInstallable = b.install.length > 0 ? 0 : 1;
        return aInstallable - bInstallable;
      });
    }
    // 搜索过滤 — also match translated name/description
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s => {
        if (s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.skillKey.toLowerCase().includes(q)) return true;
        const tr = translations[s.skillKey];
        if (tr?.status === 'cached') {
          if (tr.name?.toLowerCase().includes(q) || tr.description?.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    // Sort
    if (filter !== 'missing') {
      list = [...list].sort((a, b) => {
        if (sortBy === 'status') {
          const aScore = a.eligible ? 0 : a.missing.os.length > 0 ? 2 : 1;
          const bScore = b.eligible ? 0 : b.missing.os.length > 0 ? 2 : 1;
          if (aScore !== bScore) return aScore - bScore;
        } else if (sortBy === 'source') {
          const cmp = a.source.localeCompare(b.source);
          if (cmp !== 0) return cmp;
        }
        return a.name.localeCompare(b.name);
      });
    }
    return list;
  }, [skills, filter, searchQuery, translations, sortBy]);
  const renderedSkills = useMemo(() => filteredSkills.slice(0, 120), [filteredSkills]);
  const omittedSkills = Math.max(0, filteredSkills.length - renderedSkills.length);

  const eligibleCount = useMemo(() => skills.filter(s => s.eligible).length, [skills]);
  const missingCount = useMemo(() => skills.filter(s => !s.eligible && !s.always).length, [skills]);

  // 配置保存
  const handleConfigSave = useCallback(async (skillKey: string, data: { enabled?: boolean; apiKey?: string; env?: Record<string, string> }) => {
    await gwApi.skillsConfigure({ skillKey, ...data });
    const configRes = await gwApi.skillsConfig() as any;
    setSkillsConfig(configRes?.entries || {});
  }, []);

  // 内联 Enable/Disable with confirm for disable
  const handleToggle = useCallback(async (skill: SkillStatus) => {
    const willEnable = skill.disabled;
    if (!willEnable) {
      const ok = await confirm({ title: sk.disableSkill || 'Disable', message: `${sk.confirmDisable || 'Disable'} "${skill.name}"?`, danger: true, confirmText: sk.disable });
      if (!ok) return;
    }
    setBusyKey(skill.skillKey);
    try {
      await gwApi.skillsUpdate({ skillKey: skill.skillKey, enabled: willEnable });
      await fetchSkills();
      const msg = willEnable ? `${skill.name} ${sk.skillEnabled}` : `${skill.name} ${sk.skillDisabled}`;
      setSkillMessages(prev => ({ ...prev, [skill.skillKey]: { kind: 'success', message: msg } }));
    } catch (e: any) {
      setSkillMessages(prev => ({ ...prev, [skill.skillKey]: { kind: 'error', message: String(e) } }));
    }
    setBusyKey(null);
  }, [fetchSkills, sk, confirm]);

  // Auto-clear skill messages after 4 seconds
  useEffect(() => {
    const keys = Object.keys(skillMessages);
    if (keys.length === 0) return;
    const timer = setTimeout(() => setSkillMessages({}), 4000);
    return () => clearTimeout(timer);
  }, [skillMessages]);

  // Market detail — show card data immediately, then enrich with API detail
  const handleMarketDetail = useCallback(async (slug: string, cardItem?: any) => {
    if (cardItem) setMarketDetail({ ...cardItem, slug, _partial: true });
    else setMarketDetail({ slug, _partial: true });
    setMarketDetailLoading(true);
    try {
      const data = await clawHubApi.detail(slug);
      setMarketDetail((prev: any) => ({ ...prev, ...data, _partial: false }));
    } catch { /* keep card-level data */ }
    setMarketDetailLoading(false);
  }, []);

  // Batch enable/disable
  const handleBatchAction = useCallback(async (enable: boolean) => {
    const keys = [...batchSelected];
    if (keys.length === 0) return;
    const action = enable ? sk.batchEnable || 'Enable' : sk.batchDisable || 'Disable';
    const ok = await confirm({ title: action, message: `${action} ${keys.length} ${sk.skillCount || 'skills'}?`, danger: !enable });
    if (!ok) return;
    for (const key of keys) {
      try { await gwApi.skillsUpdate({ skillKey: key, enabled: enable }); } catch { /* continue */ }
    }
    await fetchSkills();
    setBatchSelected(new Set());
    setBatchMode(false);
    toast('success', `${action} ${keys.length} ${sk.skillCount || 'skills'}`);
  }, [batchSelected, confirm, fetchSkills, sk, toast]);

  // Export skills config
  const handleExport = useCallback(() => {
    const data = { skills: skills.map(s => ({ key: s.skillKey, name: s.name, enabled: !(skillsConfig[s.skillKey]?.enabled === false), eligible: s.eligible })), config: skillsConfig };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `skills-config-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  }, [skills, skillsConfig]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') { setConfigSkill(null); setDetailSkill(null); setMarketDetail(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const skillGroups = useMemo(() => groupSkills(renderedSkills, sk), [renderedSkills, sk]);

  const renderedMarketResults = useMemo(() => marketResults.slice(0, 120), [marketResults]);
  const omittedMarketResults = Math.max(0, marketResults.length - renderedMarketResults.length);

  // ClawHub 列表加载 — auto retry with exponential backoff (max 3 attempts)
  const fetchMarketList = useCallback(async (sort: string, cursor?: string, append = false) => {
    const reqId = ++marketListReqSeqRef.current;
    if (append) setMarketLoadingMore(true); else setMarketLoading(true);
    const MAX_RETRIES = 3;
    let lastErr: any = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (reqId !== marketListReqSeqRef.current) return;
      try {
        const res = await clawHubApi.list(sort, 20, cursor || undefined) as any;
        if (reqId !== marketListReqSeqRef.current) return;
        const items = res?.items || [];
        setMarketResults(prev => append ? [...prev, ...items] : items);
        setMarketCursor(res?.nextCursor || null);
        setMarketLoaded(true);
        if (res?._rateLimit) setMarketRateLimit(res._rateLimit);
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); // 1s, 2s, 4s
        }
      }
    }
    if (reqId === marketListReqSeqRef.current) {
      if (lastErr) {
        if (!append) setMarketResults([]);
        toast('error', `${sk.marketFetchFailed || 'Market fetch failed'} (${lastErr?.message || ''})`);
      }
      setMarketLoading(false);
      setMarketLoadingMore(false);
    }
  }, [sk, toast]);

  // 切换到市场 Tab 时自动加载
  useEffect(() => {
    if (activeTab === 'market' && !marketLoaded && !marketQuery.trim()) {
      fetchMarketList(marketSort);
    }
  }, [activeTab, marketLoaded, marketSort, marketQuery, fetchMarketList]);

  // 切换排序
  const handleSortChange = useCallback((sort: 'newest' | 'downloads' | 'stars') => {
    setMarketSort(sort);
    setMarketQuery('');
    setMarketResults([]);
    setMarketCursor(null);
    setMarketLoaded(false);
    fetchMarketList(sort);
  }, [fetchMarketList]);

  // ClawHub 搜索 — auto retry with exponential backoff (max 3 attempts)
  const handleMarketSearch = useCallback(async () => {
    if (!marketQuery.trim()) {
      // 清空搜索时回到列表模式
      setMarketResults([]);
      setMarketLoaded(false);
      marketSearchReqSeqRef.current += 1;
      fetchMarketList(marketSort);
      return;
    }
    const reqId = ++marketSearchReqSeqRef.current;
    marketListReqSeqRef.current += 1;
    setMarketSearching(true);
    const MAX_RETRIES = 3;
    let lastErr: any = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (reqId !== marketSearchReqSeqRef.current) return;
      try {
        const res = await clawHubApi.search(marketQuery) as any;
        if (reqId !== marketSearchReqSeqRef.current) return;
        const items = Array.isArray(res) ? res : (res?.results || res?.skills || res?.data || res?.items || []);
        setMarketResults(Array.isArray(items) ? items : []);
        setMarketCursor(null);
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err;
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
    if (reqId === marketSearchReqSeqRef.current) {
      if (lastErr) {
        setMarketResults([]);
        toast('error', `${sk.marketSearchFailed || 'Search failed'} (${lastErr?.message || ''})`);
      }
      setMarketSearching(false);
    }
  }, [marketQuery, marketSort, fetchMarketList, sk, toast]);

  // 瀑布流自动加载更多
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !marketCursor || marketQuery || marketLoadingMore) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && marketCursor && !marketLoadingMore) {
        fetchMarketList(marketSort, marketCursor, true);
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [marketCursor, marketQuery, marketLoadingMore, marketSort, fetchMarketList]);

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'all', label: sk.skillsTab || sk.allSkills, count: skills.length },
    { id: 'plugins', label: sk.pluginCenter || 'Plugins' },
    { id: 'market', label: 'ClawHub' },
    { id: 'skillhub', label: 'SkillHub' },
  ];

  const skillFilters: { id: FilterId; label: string; count: number }[] = [
    { id: 'all', label: sk.allSkills, count: skills.length },
    { id: 'eligible', label: sk.onlyEligible, count: eligibleCount },
    { id: 'missing', label: sk.onlyMissing, count: missingCount },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#0f1115]">
      {/* 顶部工具栏 */}
      <div className="flex flex-col border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/20 shrink-0">
        {/* 标签页 */}
        <div className="h-12 flex items-center justify-center px-4 border-b border-slate-200/50 dark:border-white/5">
          <div className="flex bg-slate-200 dark:bg-black/40 p-0.5 rounded-xl shadow-inner">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 ${activeTab === tab.id ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}>
                {tab.label}
                {tab.count !== undefined && <span className="text-[11px] opacity-60">{tab.count}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* 搜索栏 */}
        {activeTab !== 'plugins' && activeTab !== 'skillhub' && (
        <div className="p-3 flex flex-row items-center gap-2">
          {activeTab !== 'market' ? (
            <>
              <div className="relative flex-1 min-w-0">
                <span className="material-symbols-outlined absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 text-[16px]">search</span>
                <input ref={searchRef} className="w-full h-9 ps-9 pe-4 bg-white dark:bg-[#1a1c22] border border-slate-200 dark:border-white/10 rounded-lg text-xs text-slate-800 dark:text-white placeholder:text-slate-400 focus:ring-1 focus:ring-primary outline-none"
                  placeholder={`${sk.search} (Ctrl+K)`} value={searchInput} onChange={e => setSearchInput(e.target.value)} />
              </div>
              {/* Filter pills: all / eligible / missing */}
              <div className="flex bg-slate-200 dark:bg-black/40 p-0.5 rounded-lg shadow-inner shrink-0">
                {skillFilters.map(f => (
                  <button key={f.id} onClick={() => setFilter(f.id)}
                    className={`px-2 py-1 rounded text-[10px] font-bold transition-all whitespace-nowrap flex items-center gap-1 ${filter === f.id
                      ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white'
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}>
                    {f.label}<span className="opacity-60">({f.count})</span>
                  </button>
                ))}
              </div>
              {/* 自动翻译开关 + 模型选择 + 进度 + 刷新 */}
              {language !== 'en' && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setAutoTranslate(!autoTranslate)}
                    className={`h-9 px-3 flex items-center gap-1.5 border rounded-lg text-[11px] font-bold transition-all ${autoTranslate
                        ? 'bg-primary/10 dark:bg-primary/20 border-primary/30 text-primary hover:bg-primary/20'
                        : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20'
                      }`}
                    title={autoTranslate ? sk.autoTranslateOn : sk.autoTranslateOff}>
                    <span className="material-symbols-outlined text-[16px]">{autoTranslate ? 'translate' : 'g_translate'}</span>
                    {sk.autoTranslate}
                  </button>
                  {autoTranslate && (
                    <button
                      onClick={() => { setTranslateEngine(prev => prev === 'free' ? '' : 'free'); setTranslations({}); }}
                      className={`h-9 w-9 flex items-center justify-center border rounded-lg shrink-0 transition-all ${translateEngine === 'free'
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                        : 'bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-500/20'
                      }`}
                      title={translateEngine === 'free' ? 'Google Translate (Free)' : 'LLM (AI)'}
                    >
                      <span className="material-symbols-outlined text-[16px]">{translateEngine === 'free' ? 'g_translate' : 'smart_toy'}</span>
                    </button>
                  )}
                  {autoTranslate && translateEngine !== 'free' && <TranslateModelPicker sk={sk} compact />}
                  {/* 翻译进度指示 */}
                  {autoTranslate && (() => {
                    const total = skills.length + marketResults.length;
                    const vals = Object.values(translations);
                    const translating = vals.filter(t => t.status === 'translating').length;
                    const cached = vals.filter(t => t.status === 'cached').length;
                    if (translating > 0) {
                      return (
                        <span className="h-9 px-2 flex items-center gap-1 text-[10px] text-primary bg-primary/5 border border-primary/20 rounded-lg"
                          title={`${sk.translating || 'Translating'}: ${translating}/${total}`}>
                          <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                          {translating}/{total}
                        </span>
                      );
                    }
                    if (cached > 0 && cached < total) {
                      return (
                        <span className="h-9 px-2 flex items-center gap-1 text-[10px] text-slate-500 dark:text-white/50 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg"
                          title={`${sk.translated || 'Translated'}: ${cached}/${total}`}>
                          <span className="material-symbols-outlined text-[12px]">{translateEngine === 'free' ? 'g_translate' : 'smart_toy'}</span>
                          {cached}/{total}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}
              {/* 刷新数据按钮 */}
              <button
                onClick={() => { fetchSkills(); setSkillMessages({}); }}
                className="h-9 w-9 flex items-center justify-center bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg shrink-0"
                title={sk.refresh}>
                <span className={`material-symbols-outlined text-[16px] text-slate-500 ${loading ? 'animate-spin' : ''}`}>{loading ? 'progress_activity' : 'refresh'}</span>
              </button>
              {/* Sort */}
              <CustomSelect
                value={sortBy}
                onChange={(v) => setSortBy(v as any)}
                options={[
                  { value: 'name', label: sk.sortName || 'Name' },
                  { value: 'status', label: sk.sortStatus || 'Status' },
                  { value: 'source', label: sk.sortSource || 'Source' },
                ]}
                className="h-9 px-2 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 outline-none shrink-0"
              />
              {/* Batch mode */}
              <button onClick={() => { setBatchMode(!batchMode); setBatchSelected(new Set()); }}
                className={`h-9 w-9 flex items-center justify-center border rounded-lg shrink-0 transition-all ${batchMode ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500'}`}
                title={sk.batchMode || 'Batch'}>
                <span className="material-symbols-outlined text-[16px]">checklist</span>
              </button>
              {/* Compact / Group / Flat */}
              <button onClick={() => { if (compactView) { setCompactView(false); } else if (groupView) { setGroupView(false); setCompactView(true); } else { setGroupView(true); } }}
                className="h-9 w-9 flex items-center justify-center bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg shrink-0"
                title={compactView ? sk.cardView || 'Cards' : groupView ? sk.flatView : sk.groupedView}>
                <span className="material-symbols-outlined text-[16px] text-slate-500">{compactView ? 'grid_view' : groupView ? 'view_list' : 'folder'}</span>
              </button>
            </>
          ) : (
            <>
              <div className="relative flex-1 min-w-0">
                <span className="material-symbols-outlined absolute start-3 top-1/2 -translate-y-1/2 text-slate-400 text-[16px]">search</span>
                <input className="w-full h-9 ps-9 pe-4 bg-white dark:bg-[#1a1c22] border border-slate-200 dark:border-white/10 rounded-lg text-xs text-slate-800 dark:text-white placeholder:text-slate-400 focus:ring-1 focus:ring-primary outline-none"
                  placeholder={sk.searchMarket} value={marketQuery} onChange={e => setMarketQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleMarketSearch()} />
              </div>
              <button onClick={handleMarketSearch} disabled={marketSearching} className="h-9 px-3 bg-primary text-white text-[11px] font-bold rounded-lg disabled:opacity-50 shrink-0 whitespace-nowrap">
                {marketSearching ? sk.searching : sk.search}
              </button>
              {/* 自动翻译开关 + 模型选择 */}
              {language !== 'en' && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setAutoTranslate(!autoTranslate)}
                    className={`h-9 px-3 flex items-center gap-1.5 border rounded-lg text-[11px] font-bold transition-all ${autoTranslate
                        ? 'bg-primary/10 dark:bg-primary/20 border-primary/30 text-primary hover:bg-primary/20'
                        : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20'
                      }`}
                    title={autoTranslate ? sk.autoTranslateOn : sk.autoTranslateOff}>
                    <span className="material-symbols-outlined text-[16px]">{autoTranslate ? 'translate' : 'g_translate'}</span>
                    {sk.autoTranslate}
                  </button>
                  {autoTranslate && (
                    <button
                      onClick={() => { setTranslateEngine(prev => prev === 'free' ? '' : 'free'); setTranslations({}); }}
                      className={`h-9 w-9 flex items-center justify-center border rounded-lg shrink-0 transition-all ${translateEngine === 'free'
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                        : 'bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-500/20'
                      }`}
                      title={translateEngine === 'free' ? 'Google Translate (Free)' : 'LLM (AI)'}
                    >
                      <span className="material-symbols-outlined text-[16px]">{translateEngine === 'free' ? 'g_translate' : 'smart_toy'}</span>
                    </button>
                  )}
                  {autoTranslate && translateEngine !== 'free' && <TranslateModelPicker sk={sk} compact />}
                  {/* 翻译进度指示 + 速率限制 */}
                  {autoTranslate && (() => {
                    const total = marketResults.length;
                    const marketEntries = Object.entries(translations).filter(([k]) => k.startsWith('market:'));
                    const translating = marketEntries.filter(([, t]) => t.status === 'translating').length;
                    const cached = marketEntries.filter(([, t]) => t.status === 'cached').length;
                    if (translating > 0) {
                      return (
                        <span className="h-9 px-2 flex items-center gap-1 text-[10px] text-primary bg-primary/5 border border-primary/20 rounded-lg"
                          title={`${sk.translating || 'Translating'}: ${translating}/${total}`}>
                          <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                          {translating}/{total}
                        </span>
                      );
                    }
                    if (cached > 0 && cached < total) {
                      return (
                        <span className="h-9 px-2 flex items-center gap-1 text-[10px] text-slate-500 dark:text-white/50 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg"
                          title={`${sk.translated || 'Translated'}: ${cached}/${total}`}>
                          <span className="material-symbols-outlined text-[12px]">{translateEngine === 'free' ? 'g_translate' : 'smart_toy'}</span>
                          {cached}/{total}
                        </span>
                      );
                    }
                    return null;
                  })()}
                  {/* 速率限制信息 */}
                  {marketRateLimit && (
                    <span className="h-9 px-2 flex items-center gap-1 text-[10px] text-slate-500 dark:text-white/50 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-lg whitespace-nowrap"
                      title={`${sk.rateLimitInfo || 'API Rate Limit'}: ${marketRateLimit.remaining}/${marketRateLimit.limit}${marketRateLimit.reset ? ` (reset: ${marketRateLimit.reset}s)` : ''}`}>
                      <span className="material-symbols-outlined text-[12px]">schedule</span>
                      {marketRateLimit.remaining}/{marketRateLimit.limit}
                    </span>
                  )}
                </div>
              )}
              {/* 刷新数据按钮 */}
              <button onClick={() => { setMarketResults([]); setMarketCursor(null); setMarketLoaded(false); if (marketQuery.trim()) handleMarketSearch(); else fetchMarketList(marketSort); }}
                disabled={marketLoading || marketSearching}
                className="h-9 w-9 flex items-center justify-center bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg shrink-0 disabled:opacity-40"
                title={sk.refresh}>
                <span className={`material-symbols-outlined text-[16px] text-slate-500 ${marketLoading || marketSearching ? 'animate-spin' : ''}`}>{marketLoading || marketSearching ? 'progress_activity' : 'refresh'}</span>
              </button>
              {/* 排序按钮组 */}
              <div className="flex bg-slate-200 dark:bg-black/40 p-0.5 rounded-lg shadow-inner shrink-0">
                {([['newest', sk.sortNewest], ['downloads', sk.sortDownloads], ['stars', sk.sortStars]] as const).map(([val, label]) => (
                  <button key={val} onClick={() => handleSortChange(val as any)}
                    className={`px-2 py-1 rounded text-[10px] font-bold transition-all whitespace-nowrap ${marketSort === val ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {/* 插件中心 */}
      {activeTab === 'plugins' && (
        <PluginCenter language={language} />
      )}

      {/* SkillHub */}
      {activeTab === 'skillhub' && (
        <SkillHub language={language} />
      )}

      {/* 内容区 */}
      {activeTab !== 'plugins' && activeTab !== 'skillhub' && (
      <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
        <div className="max-w-6xl mx-auto">
          {/* 加载/错误状态 */}
          {activeTab !== 'market' && loading && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <span className="material-symbols-outlined text-4xl animate-spin mb-3">progress_activity</span>
              <span className="text-xs">{sk.loadFailed === error ? sk.loadFailed : sk.loading}</span>
            </div>
          )}
          {activeTab !== 'market' && error && !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <span className="material-symbols-outlined text-4xl mb-3 text-mac-red">error</span>
              <span className="text-xs mb-3">{error}</span>
              <button onClick={fetchSkills} className="h-8 px-4 bg-primary text-white text-xs font-bold rounded-lg">{sk.retry}</button>
            </div>
          )}

          {/* Batch action bar */}
          {batchMode && activeTab !== 'market' && (
            <div className="mb-3 flex items-center gap-2 p-2 rounded-xl bg-primary/5 border border-primary/20">
              <span className="text-[11px] font-bold text-primary">{batchSelected.size} {sk.selected || 'selected'}</span>
              <button onClick={() => setBatchSelected(new Set(renderedSkills.map(s => s.skillKey)))} className="text-[10px] text-primary/70 hover:text-primary font-bold">{sk.selectAll || 'All'}</button>
              <button onClick={() => setBatchSelected(new Set())} className="text-[10px] text-primary/70 hover:text-primary font-bold">{sk.selectNone || 'None'}</button>
              <div className="flex-1" />
              <button onClick={() => handleBatchAction(true)} disabled={batchSelected.size === 0}
                className="h-7 px-3 bg-mac-green/15 text-mac-green text-[10px] font-bold rounded-lg disabled:opacity-40">{sk.batchEnable || 'Enable'}</button>
              <button onClick={() => handleBatchAction(false)} disabled={batchSelected.size === 0}
                className="h-7 px-3 bg-mac-red/15 text-mac-red text-[10px] font-bold rounded-lg disabled:opacity-40">{sk.batchDisable || 'Disable'}</button>
            </div>
          )}

          {/* 技能网格 */}
          {activeTab !== 'market' && !loading && !error && (
            <>
              {filteredSkills.length === 0 ? (
                <EmptyState icon="extension_off" title={sk.noSkills} />
              ) : compactView ? (
                /* Compact list view */
                <div className="space-y-1">
                  {renderedSkills.map(skill => {
                    const entry = skillsConfig[skill.skillKey];
                    const isDisabled = entry?.enabled === false || skill.disabled;
                    const cTrans = translations[skill.skillKey];
                    const cShowTrans = autoTranslate && language !== 'en' && cTrans?.status === 'cached';
                    return (
                      <div key={skill.skillKey} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all hover:bg-slate-50 dark:hover:bg-white/[0.02] cursor-pointer ${isDisabled ? 'opacity-50 border-slate-200/50 dark:border-white/5' : skill.eligible ? 'border-mac-green/20' : 'border-slate-200 dark:border-white/10'}`}
                        onClick={() => setDetailSkill(skill)}>
                        {batchMode && (
                          <input type="checkbox" checked={batchSelected.has(skill.skillKey)} onClick={e => e.stopPropagation()}
                            onChange={() => setBatchSelected(prev => { const n = new Set(prev); if (n.has(skill.skillKey)) n.delete(skill.skillKey); else n.add(skill.skillKey); return n; })}
                            className="w-3.5 h-3.5 rounded accent-primary shrink-0" />
                        )}
                        <span className="text-sm leading-none shrink-0">{skill.emoji || '⚙️'}</span>
                        <span className="text-[12px] font-bold text-slate-800 dark:text-white truncate min-w-0">{cShowTrans && cTrans?.name ? cTrans.name : skill.name}</span>
                        <span className="text-[10px] text-slate-400 dark:text-white/30 truncate">{skill.source}</span>
                        <div className="flex-1" />
                        {skill.eligible ? (
                          <span className="w-2 h-2 rounded-full bg-mac-green shrink-0" />
                        ) : skill.missing.os.length > 0 ? (
                          <span className="w-2 h-2 rounded-full bg-mac-red shrink-0" />
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                        )}
                        <button onClick={e => { e.stopPropagation(); handleToggle(skill); }} disabled={busyKey === skill.skillKey || (!skill.eligible && !skill.always)}
                          className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${(!skill.eligible && !skill.always) ? 'bg-slate-300 dark:bg-white/20 opacity-50 cursor-not-allowed' : isDisabled ? 'bg-slate-300 dark:bg-white/20' : 'bg-mac-green'}`}>
                          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${isDisabled || (!skill.eligible && !skill.always) ? 'translate-x-0.5 rtl:-translate-x-0.5' : 'translate-x-[14px] rtl:-translate-x-[14px]'}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : groupView && skillGroups.length >= 1 ? (
                <div className="space-y-4">
                  {skillGroups.map(group => (
                    <details key={group.id} open={group.id !== 'workspace' && group.id !== 'builtIn'}>
                      <summary className="flex items-center gap-2 cursor-pointer select-none mb-2 group/sum">
                        <span className="material-symbols-outlined text-[14px] text-slate-400 group-open/sum:rotate-90 transition-transform">chevron_right</span>
                        <span className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{group.label}</span>
                        <span className="text-[11px] text-slate-400 dark:text-white/35">{group.skills.length}</span>
                      </summary>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {group.skills.map(skill => (
                          <div key={skill.skillKey} className="relative" onClick={() => batchMode ? null : setDetailSkill(skill)}>
                            {batchMode && (
                              <input type="checkbox" checked={batchSelected.has(skill.skillKey)}
                                onChange={() => setBatchSelected(prev => { const n = new Set(prev); if (n.has(skill.skillKey)) n.delete(skill.skillKey); else n.add(skill.skillKey); return n; })}
                                className="absolute top-2 start-2 z-10 w-4 h-4 rounded accent-primary" />
                            )}
                            <SkillCard skill={skill} config={skillsConfig} language={language}
                              onConfigure={setConfigSkill} onCopyInstall={handleCopyInstall} onSendInstall={handleSendInstall} onToggle={handleToggle}
                              gwReady={canSendToAgent} busyKey={busyKey} message={skillMessages[skill.skillKey] || null}
                              translation={translations[skill.skillKey]} autoTranslate={autoTranslate} />
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {renderedSkills.map(skill => (
                    <div key={skill.skillKey} className="relative" onClick={() => batchMode ? null : setDetailSkill(skill)}>
                      {batchMode && (
                        <input type="checkbox" checked={batchSelected.has(skill.skillKey)}
                          onChange={() => setBatchSelected(prev => { const n = new Set(prev); if (n.has(skill.skillKey)) n.delete(skill.skillKey); else n.add(skill.skillKey); return n; })}
                          className="absolute top-2 start-2 z-10 w-4 h-4 rounded accent-primary" />
                      )}
                      <SkillCard skill={skill} config={skillsConfig} language={language}
                        onConfigure={setConfigSkill} onCopyInstall={handleCopyInstall} onSendInstall={handleSendInstall} onToggle={handleToggle}
                        gwReady={canSendToAgent} busyKey={busyKey} message={skillMessages[skill.skillKey] || null}
                        translation={translations[skill.skillKey]} autoTranslate={autoTranslate} />
                    </div>
                  ))}
                </div>
              )}
              {omittedSkills > 0 && (
                <div className="text-center text-[10px] text-slate-400 dark:text-white/35 mt-2">+{omittedSkills}</div>
              )}
            </>
          )}

          {/* ClawHub 市场 */}
          {activeTab === 'market' && (
            <div className="space-y-4">
              {/* 加载中 */}
              {(marketLoading || marketSearching) && marketResults.length === 0 && (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  <span className="material-symbols-outlined text-3xl animate-spin me-2">progress_activity</span>
                  <span className="text-xs">{marketSearching ? sk.searching : sk.loading}</span>
                </div>
              )}
              {/* 搜索无结果 */}
              {!marketSearching && !marketLoading && marketResults.length === 0 && marketQuery && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <span className="material-symbols-outlined text-4xl mb-3">search_off</span>
                  <span className="text-xs">{sk.noResults}</span>
                </div>
              )}
              {/* 列表无数据 */}
              {!marketSearching && !marketLoading && marketResults.length === 0 && !marketQuery && marketLoaded && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <span className="material-symbols-outlined text-5xl mb-4 text-primary/30">store</span>
                  <span className="text-sm font-bold mb-1 text-slate-600 dark:text-white/50">{sk.noMarketData}</span>
                </div>
              )}
              {/* 技能卡片列表 */}
              {marketResults.length > 0 && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {renderedMarketResults.map((item: any, i: number) => {
                      const slug = item.slug || item.name || `item-${i}`;
                      const marketKey = `market:${slug}`;
                      const mTrans = translations[marketKey];
                      const mTransReady = autoTranslate && language !== 'en' && mTrans?.status === 'cached';
                      const stats = item.stats || {};
                      const ver = item.latestVersion?.version || item.tags?.latest || '';
                      const isInstalled = marketInstalledSlugs.has(slug) || skills.some(s => s.skillKey === slug || s.name === slug);
                      return (
                        <div key={slug + '-' + i} className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 rounded-2xl p-4 hover:border-primary/30 transition-all group shadow-sm flex flex-col cursor-pointer"
                          onClick={() => handleMarketDetail(slug, item)}>
                          {/* 头部 */}
                          <div className="flex items-start gap-3 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/15 to-purple-500/15 flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-white/5">
                              <span className="text-lg">{item.emoji || '📦'}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-[13px] text-slate-800 dark:text-white truncate">{mTransReady && mTrans?.name ? mTrans.name : (item.displayName || item.name || slug)}</h4>
                              {mTrans?.status === 'translating' && <span className="text-[10px] text-primary animate-pulse">{sk.translating}</span>}
                              {ver && <span className="text-[11px] font-mono text-slate-400 dark:text-white/40">v{ver}</span>}
                            </div>
                          </div>
                          {/* 描述 */}
                          <ExpandableDesc text={mTransReady && mTrans?.description ? mTrans.description : (item.summary || item.description || '')} moreLabel={sk.expandMore} />
                          {/* Tags */}
                          {item.tags && typeof item.tags === 'object' && Object.keys(item.tags).length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {Object.keys(item.tags).filter(t => t !== 'latest').slice(0, 5).map(tag => (
                                <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40">{tag}</span>
                              ))}
                            </div>
                          )}
                          {/* 统计 + 链接 */}
                          <div className="flex items-center gap-2 mt-auto text-[10px] text-slate-400 dark:text-white/35 overflow-hidden whitespace-nowrap">
                            {stats.downloads > 0 && (
                              <span className="flex items-center gap-0.5 shrink-0">
                                <span className="material-symbols-outlined text-[10px]">download</span>
                                {stats.downloads >= 1000 ? `${(stats.downloads / 1000).toFixed(1)}k` : stats.downloads}
                              </span>
                            )}
                            {stats.stars > 0 && (
                              <span className="flex items-center gap-0.5 shrink-0">
                                <span className="material-symbols-outlined text-[10px]">star</span>
                                {stats.stars}
                              </span>
                            )}
                            {stats.versions > 0 && (
                              <span className="flex items-center gap-0.5 shrink-0">
                                <span className="material-symbols-outlined text-[10px]">history</span>
                                {stats.versions}
                              </span>
                            )}
                            {item.createdAt && (
                              <span className="shrink-0">{new Date(item.createdAt).toLocaleDateString()}</span>
                            )}
                            <a href={`https://clawhub.ai/skills/${encodeURIComponent(slug)}`} target="_blank" rel="noopener noreferrer"
                              className="ms-auto flex items-center shrink-0 text-primary/60 hover:text-primary transition-colors" onClick={e => e.stopPropagation()}>
                              <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                            </a>
                          </div>
                          {/* 操作行 */}
                          <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100 dark:border-white/5" onClick={e => e.stopPropagation()}>
                            {isInstalled && (
                              <span className="h-6 px-2 bg-mac-green/10 text-mac-green text-[10px] font-bold rounded-md flex items-center gap-1 shrink-0">
                                <span className="material-symbols-outlined text-[11px]">check_circle</span>
                                {sk.installed}
                              </span>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); handleCopyMarketInstall(item); }}
                              className="h-6 px-2 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10 text-[10px] font-bold rounded-md transition-colors flex items-center gap-1">
                              <span className="material-symbols-outlined text-[11px]">content_copy</span>
                              <span>{sk.copyInstallInfo}</span>
                            </button>
                            {canSendToAgent && (
                              <button onClick={() => handleSendMarketInstall(item)}
                                className="h-6 w-6 flex items-center justify-center bg-primary/10 text-primary hover:bg-primary hover:text-white rounded-md transition-all shrink-0" title={sk.sendToAgent}>
                                <span className="material-symbols-outlined text-[11px]">send</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {omittedMarketResults > 0 && (
                    <div className="text-center text-[10px] text-slate-400 dark:text-white/35 mt-2">+{omittedMarketResults}</div>
                  )}
                  {/* 瀑布流加载更多 */}
                  {marketCursor && !marketQuery && (
                    <div className="flex justify-center py-6">
                      {marketLoadingMore ? (
                        <span className="material-symbols-outlined text-2xl animate-spin text-primary/40">progress_activity</span>
                      ) : (
                        <div ref={sentinelRef} className="h-1" />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {/* 底部状态栏 */}
      {activeTab !== 'plugins' && (
      <footer className="h-8 px-4 border-t border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/20 flex items-center justify-between shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/20">
        <div className="flex items-center gap-3">
          <span>{skills.length} {sk.skillCount}</span>
          <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
          <span className="text-mac-green">{eligibleCount} {sk.eligibleCount}</span>
          <span className="text-amber-500">{missingCount} {sk.missingLabel || 'missing'}</span>
          {(() => { const d = skills.filter(s => skillsConfig[s.skillKey]?.enabled === false).length; return d > 0 ? <span className="text-slate-500">{d} {sk.disabledLabel || 'off'}</span> : null; })()}
        </div>
        <div className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[12px]">verified_user</span>
          <span>{sk.bundled}: {skills.filter(s => s.bundled).length}</span>
        </div>
      </footer>
      )}

      {/* 配置弹窗 */}
      {configSkill && (
        <ConfigModal skill={configSkill} config={skillsConfig} language={language} onSave={handleConfigSave} onClose={() => setConfigSkill(null)} />
      )}

      {/* Skill detail panel */}
      {detailSkill && (() => {
        const dTrans = translations[detailSkill.skillKey];
        const dShowTrans = autoTranslate && language !== 'en' && dTrans?.status === 'cached';
        return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setDetailSkill(null)}>
          <div className="w-full max-w-lg mx-4 bg-white dark:bg-[#1c1e24] rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 dark:border-white/5 flex items-center gap-3 shrink-0">
              <span className="text-xl">{detailSkill.emoji || '⚙️'}</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-sm text-slate-800 dark:text-white truncate">{dShowTrans && dTrans?.name ? dTrans.name : detailSkill.name}</h3>
                <p className="text-[10px] text-slate-400 font-mono truncate">{detailSkill.skillKey}</p>
              </div>
              <button onClick={() => setDetailSkill(null)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
                <span className="material-symbols-outlined text-[16px] text-slate-400">close</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
              {/* Description */}
              {detailSkill.description && <p className="text-[12px] text-slate-600 dark:text-white/50 leading-relaxed">{dShowTrans && dTrans?.description ? dTrans.description : detailSkill.description}</p>}
              {/* Status badges */}
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 font-bold">{detailSkill.source}</span>
                {detailSkill.eligible ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-mac-green/15 text-mac-green font-bold">{sk.eligible}</span>
                  : <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 font-bold">{sk.notEligible}</span>}
                {detailSkill.bundled && <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold">{sk.bundled}</span>}
                {detailSkill.blockedByAllowlist && <span className="text-[10px] px-2 py-0.5 rounded-full bg-mac-red/10 text-mac-red font-bold">{sk.blockedByAllowlist}</span>}
              </div>
              {/* Requirements */}
              {(detailSkill.requirements.bins.length > 0 || detailSkill.requirements.env.length > 0 || detailSkill.requirements.config.length > 0 || detailSkill.requirements.os.length > 0) && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1.5">{sk.requirements || 'Requirements'}</h4>
                  <div className="space-y-1 text-[11px]">
                    {detailSkill.requirements.bins.length > 0 && <div className="flex gap-2"><span className="text-slate-400 shrink-0">bins:</span><span className="text-slate-600 dark:text-white/60">{detailSkill.requirements.bins.join(', ')}</span></div>}
                    {detailSkill.requirements.anyBins?.length > 0 && <div className="flex gap-2"><span className="text-slate-400 shrink-0">anyBins:</span><span className="text-slate-600 dark:text-white/60">{detailSkill.requirements.anyBins.join(', ')}</span></div>}
                    {detailSkill.requirements.env.length > 0 && <div className="flex gap-2"><span className="text-slate-400 shrink-0">env:</span><span className="text-slate-600 dark:text-white/60">{detailSkill.requirements.env.join(', ')}</span></div>}
                    {detailSkill.requirements.config.length > 0 && <div className="flex gap-2"><span className="text-slate-400 shrink-0">config:</span><span className="text-slate-600 dark:text-white/60">{detailSkill.requirements.config.join(', ')}</span></div>}
                    {detailSkill.requirements.os.length > 0 && <div className="flex gap-2"><span className="text-slate-400 shrink-0">os:</span><span className="text-slate-600 dark:text-white/60">{detailSkill.requirements.os.join(', ')}</span></div>}
                  </div>
                </div>
              )}
              {/* Missing */}
              {(detailSkill.missing.bins.length > 0 || detailSkill.missing.env.length > 0 || detailSkill.missing.config.length > 0 || detailSkill.missing.os.length > 0) && (
                <div>
                  <h4 className="text-[10px] font-bold text-amber-500 uppercase tracking-wider mb-1.5">{sk.missingDeps || 'Missing'}</h4>
                  <div className="space-y-1 text-[11px] text-amber-600 dark:text-amber-400">
                    {detailSkill.missing.bins.length > 0 && <div>{sk.missingBins}: {detailSkill.missing.bins.join(', ')}</div>}
                    {(detailSkill.missing as any).anyBins?.length > 0 && <div>anyBins: {(detailSkill.missing as any).anyBins.join(', ')}</div>}
                    {detailSkill.missing.env.length > 0 && <div>{sk.missingEnv}: {detailSkill.missing.env.join(', ')}</div>}
                    {detailSkill.missing.config.length > 0 && <div>{sk.missingConfig}: {detailSkill.missing.config.join(', ')}</div>}
                    {detailSkill.missing.os.length > 0 && <div className="text-mac-red">{sk.missingOs}</div>}
                  </div>
                </div>
              )}
              {/* Config checks */}
              {detailSkill.configChecks.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1.5">{sk.configChecks || 'Config Checks'}</h4>
                  <div className="space-y-1">
                    {detailSkill.configChecks.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        <span className={`material-symbols-outlined text-[12px] ${c.satisfied ? 'text-mac-green' : 'text-mac-red'}`}>{c.satisfied ? 'check_circle' : 'cancel'}</span>
                        <span className="text-slate-600 dark:text-white/60 font-mono">{c.path}</span>
                        {c.value !== undefined && <span className="text-slate-400">= {JSON.stringify(c.value)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Install options */}
              {detailSkill.install.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1.5">{sk.installOptions || 'Install Options'}</h4>
                  <div className="space-y-1">
                    {detailSkill.install.map((inst, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-white/60">
                        <span className="material-symbols-outlined text-[12px] text-primary">download</span>
                        <span className="font-bold">{inst.label}</span>
                        <span className="text-slate-400">({inst.kind})</span>
                        {inst.bins.length > 0 && <span className="text-slate-400 font-mono text-[10px]">{inst.bins.join(', ')}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* File path */}
              <div className="text-[10px] text-slate-400 dark:text-white/30 font-mono break-all">{detailSkill.filePath}</div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-white/5 flex items-center gap-2 shrink-0">
              <button onClick={() => { setConfigSkill(detailSkill); setDetailSkill(null); }}
                className="h-8 px-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 text-[11px] font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">tune</span>{sk.configure}
              </button>
              {detailSkill.homepage && (
                <a href={detailSkill.homepage} target="_blank" rel="noopener noreferrer"
                  className="h-8 px-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 text-[11px] font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>{sk.homepage}
                </a>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* Market detail modal */}
      {marketDetail && (() => {
        const md = marketDetail;
        const mdSlug = md.slug || '';
        const mdRawName = md.displayName || md.name || mdSlug;
        const mdRawDesc = md.description || md.summary || '';
        const mdVer = md.latestVersion?.version || md.tags?.latest || '';
        const mdAuthor = md.author ? (typeof md.author === 'string' ? md.author : md.author?.name) : '';
        const mdStats = md.stats || {};
        const mdTags = md.tags && typeof md.tags === 'object' ? Object.keys(md.tags).filter((t: string) => t !== 'latest') : [];
        const mdIsInstalled = marketInstalledSlugs.has(mdSlug) || skills.some(s => s.skillKey === mdSlug || s.name === mdSlug);
        const mdTrans = translations[`market:${mdSlug}`];
        const mdShowTrans = autoTranslate && language !== 'en' && mdTrans?.status === 'cached';
        const mdName = mdShowTrans && mdTrans?.name ? mdTrans.name : mdRawName;
        const mdDesc = mdShowTrans && mdTrans?.description ? mdTrans.description : mdRawDesc;
        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setMarketDetail(null)}>
            <div className="w-full max-w-lg mx-4 bg-white dark:bg-[#1c1e24] rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="px-5 py-4 border-b border-slate-200 dark:border-white/5 flex items-center gap-3 shrink-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/15 to-purple-500/15 flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-white/5">
                  <span className="text-lg">{md.emoji || '📦'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm text-slate-800 dark:text-white truncate">{mdName}</h3>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <span className="font-mono">{mdSlug}</span>
                    {mdVer && <span className="font-mono">v{mdVer}</span>}
                    {mdAuthor && <span>{sk.author || 'by'} {mdAuthor}</span>}
                  </div>
                </div>
                <button onClick={() => setMarketDetail(null)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
                  <span className="material-symbols-outlined text-[16px] text-slate-400">close</span>
                </button>
              </div>
              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
                {/* Description */}
                {mdDesc && <p className="text-[12px] text-slate-600 dark:text-white/50 leading-relaxed">{mdDesc}</p>}
                {/* Status badges */}
                <div className="flex flex-wrap gap-1.5">
                  {mdIsInstalled
                    ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-mac-green/15 text-mac-green font-bold">{sk.installed}</span>
                    : <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 font-bold">{sk.marketplace}</span>}
                  {mdTags.slice(0, 6).map((tag: string) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40">{tag}</span>
                  ))}
                </div>
                {/* Stats */}
                <div className="flex flex-wrap gap-4 text-[11px] text-slate-400">
                  {mdStats.downloads > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">download</span>
                      {mdStats.downloads.toLocaleString()} {sk.downloads}
                    </span>
                  )}
                  {mdStats.stars > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">star</span>
                      {mdStats.stars} {sk.stars}
                    </span>
                  )}
                  {mdStats.versions > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">history</span>
                      {mdStats.versions} {sk.versions}
                    </span>
                  )}
                  {md.createdAt && (
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">calendar_today</span>
                      {new Date(md.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {/* Loading indicator for API detail */}
                {marketDetailLoading && (
                  <div className="flex items-center gap-2 py-2">
                    <span className="material-symbols-outlined text-[16px] animate-spin text-primary/40">progress_activity</span>
                    <span className="text-[11px] text-slate-400">{sk.loading}</span>
                  </div>
                )}
                {/* README (from API detail) */}
                {md.readme && (
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1.5">README</h4>
                    <div className="text-[11px] text-slate-500 dark:text-white/40 leading-relaxed whitespace-pre-wrap font-mono bg-slate-50 dark:bg-black/20 rounded-lg p-3 max-h-[250px] overflow-y-auto custom-scrollbar">{md.readme}</div>
                  </div>
                )}
                {/* Versions */}
                {md.versions && Array.isArray(md.versions) && md.versions.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider mb-1.5">{sk.versionHistory || 'Versions'}</h4>
                    <div className="space-y-1 max-h-[120px] overflow-y-auto custom-scrollbar">
                      {md.versions.slice(0, 10).map((v: any, i: number) => (
                        <div key={i} className="text-[10px] text-slate-500 dark:text-white/40 font-mono flex gap-2">
                          <span>v{v.version || v}</span>
                          {v.createdAt && <span className="text-slate-400">{new Date(v.createdAt).toLocaleDateString()}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* Footer with actions */}
              <div className="px-5 py-3 border-t border-slate-200 dark:border-white/5 flex items-center gap-2 shrink-0">
                {mdIsInstalled && (
                  <span className="h-8 px-3 bg-mac-green/10 text-mac-green text-[11px] font-bold rounded-lg flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">check_circle</span>
                    {sk.installed}
                  </span>
                )}
                <button onClick={(e) => { e.stopPropagation(); handleCopyMarketInstall(marketDetail); }}
                  className="h-8 px-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 text-[11px] font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">content_copy</span>
                  {sk.copyInstallInfo}
                </button>
                {canSendToAgent && (
                  <button onClick={() => handleSendMarketInstall(marketDetail)}
                    className="h-8 px-4 bg-primary/10 text-primary text-[11px] font-bold rounded-lg hover:bg-primary hover:text-white transition-all flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">send</span>
                    {sk.sendToAgent}
                  </button>
                )}
                <a href={`https://clawhub.ai/skills/${encodeURIComponent(mdSlug)}`} target="_blank" rel="noopener noreferrer"
                  className="h-8 px-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 text-[11px] font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 flex items-center gap-1.5 ms-auto">
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>{sk.homepage}
                </a>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Skills;
