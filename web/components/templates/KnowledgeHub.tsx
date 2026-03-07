import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { templateSystem, KnowledgeItem, KnowledgeItemType, KnowledgeStatusCheck } from '../../services/template-system';
import { recipeApi, gwApi } from '../../services/api';
import { FileApplyConfirm, FileApplyRequest } from '../FileApplyConfirm';
import AgentPickerModal from '../AgentPickerModal';
import { useToast } from '../Toast';
import { useConfirm } from '../ConfirmDialog';
import SimpleMarkdown from './SimpleMarkdown';

interface KnowledgeHubProps {
  language: Language;
  defaultAgentId?: string;
  pendingExpandItem?: string | null;
  onExpandItemConsumed?: () => void;
}

type FilterType = 'all' | KnowledgeItemType;

const TYPE_CONFIG: Record<KnowledgeItemType, { icon: string; colorClass: string; borderColor: string; iconBg: string; iconColor: string }> = {
  recipe: { icon: 'menu_book', colorClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', borderColor: 'border-l-amber-500', iconBg: 'bg-amber-500/10 dark:bg-amber-500/15', iconColor: 'text-amber-500' },
  tip: { icon: 'lightbulb', colorClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', borderColor: 'border-l-emerald-500', iconBg: 'bg-emerald-500/10 dark:bg-emerald-500/15', iconColor: 'text-emerald-500' },
  snippet: { icon: 'code', colorClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400', borderColor: 'border-l-blue-500', iconBg: 'bg-blue-500/10 dark:bg-blue-500/15', iconColor: 'text-blue-500' },
  faq: { icon: 'help', colorClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400', borderColor: 'border-l-purple-500', iconBg: 'bg-purple-500/10 dark:bg-purple-500/15', iconColor: 'text-purple-500' },
};

const KnowledgeHub: React.FC<KnowledgeHubProps> = ({ language, defaultAgentId, pendingExpandItem, onExpandItemConsumed }) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const tm = (t.templateManager || {}) as any;

  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [doctorStatusMap, setDoctorStatusMap] = useState<Record<string, 'ok' | 'warn' | 'error'>>({});
  const [gwConfig, setGwConfig] = useState<any>(null);
  const [gwChannels, setGwChannels] = useState<any[]>([]);
  const [gwAgentCount, setGwAgentCount] = useState(0);
  const [pendingFileApply, setPendingFileApply] = useState<FileApplyRequest | null>(null);
  const [pendingApplyData, setPendingApplyData] = useState<{ fileName: string; content: string; mode: 'append' | 'replace'; title: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    templateSystem.getKnowledgeItems(language)
      .then(data => setItems(data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [language]);

  // Handle deep link: auto-open detail modal for a specific item
  useEffect(() => {
    if (!pendingExpandItem || loading || items.length === 0) return;
    const target = items.find(item => item.id === pendingExpandItem);
    if (target) {
      setActiveFilter(target.type);
      setExpandedId(target.id);
    }
    onExpandItemConsumed?.();
  }, [pendingExpandItem, loading, items, onExpandItemConsumed]);

  // Load Doctor diagnostic status from cache
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('doctor.resultCache');
      if (!raw) return;
      const result = JSON.parse(raw);
      if (!result?.items) return;
      const map: Record<string, 'ok' | 'warn' | 'error'> = {};
      for (const item of result.items) {
        const key = item.id || item.code || '';
        if (key) map[key] = item.status;
      }
      setDoctorStatusMap(map);
    } catch { /* ignore */ }
  }, []);

  // Fetch gateway data for dynamic statusCheck evaluation
  useEffect(() => {
    const settle = (p: Promise<any>) => p.catch(() => null);
    Promise.all([
      settle(gwApi.configGet()),
      settle(gwApi.channels()),
      settle(gwApi.agents()),
    ]).then(([cfgData, chData, agData]) => {
      if (cfgData) setGwConfig(cfgData.config || cfgData.parsed || cfgData);
      const rawCh = chData?.channels ?? chData?.list ?? chData;
      if (Array.isArray(rawCh)) setGwChannels(rawCh);
      const agList = Array.isArray(agData) ? agData : agData?.agents || [];
      setGwAgentCount(agList.length || Object.keys(agList).length);
    });
  }, []);

  // Evaluate a statusCheck definition against live gateway data
  const evalStatusCheck = useCallback((check: KnowledgeStatusCheck): { ok: boolean; detail: string } => {
    const getField = (path: string): any => {
      if (!gwConfig || !path) return undefined;
      return path.split('.').reduce((o, k) => o?.[k], gwConfig);
    };
    const fill = (tpl: string | undefined, vars: Record<string, string | number>) => {
      if (!tpl) return '';
      let s = tpl;
      for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
      return s;
    };

    switch (check.type) {
      case 'channels_count': {
        const active = gwChannels.filter((ch: any) => ch.status === 'connected' || ch.connected);
        const n = active.length;
        const ok = n >= (check.threshold ?? 1);
        return { ok, detail: fill(ok ? check.okTemplate : check.failTemplate, { n }) };
      }
      case 'agent_count': {
        const n = gwAgentCount;
        const ok = n >= (check.threshold ?? 1);
        return { ok, detail: fill(ok ? check.okTemplate : check.failTemplate, { n }) };
      }
      case 'config_field': {
        const value = getField(check.field || '');
        let ok = false;
        const rule = check.okWhen || 'truthy';
        if (rule === 'truthy') ok = !!value;
        else if (rule.startsWith('gt:')) ok = Number(value) > Number(rule.slice(3));
        else if (rule.startsWith('eq:')) ok = String(value) === rule.slice(3);
        const display = value == null ? '' : String(value);
        return { ok, detail: fill(ok ? check.okTemplate : check.failTemplate, { value: display }) };
      }
      case 'security_configured': {
        const hasDm = gwChannels.some((ch: any) => ch.dmPolicy || ch.allowFrom?.length > 0);
        return { ok: hasDm, detail: fill(hasDm ? check.okTemplate : check.failTemplate, {}) };
      }
      default:
        return { ok: false, detail: '' };
    }
  }, [gwConfig, gwChannels, gwAgentCount]);

  const filteredItems = useMemo(() => {
    let result = activeFilter === 'all' ? items : items.filter(item => item.type === activeFilter);

    // Sort: featured first, then by lastUpdated (newest first), then by name
    result = [...result].sort((a, b) => {
      // Featured items always on top
      if (a.metadata.featured && !b.metadata.featured) return -1;
      if (!a.metadata.featured && b.metadata.featured) return 1;

      // Then by lastUpdated (newest first)
      const aDate = a.metadata.lastUpdated ? new Date(a.metadata.lastUpdated).getTime() : 0;
      const bDate = b.metadata.lastUpdated ? new Date(b.metadata.lastUpdated).getTime() : 0;
      if (aDate !== bDate) return bDate - aDate;

      // Fallback: alphabetical
      return a.metadata.name.localeCompare(b.metadata.name);
    });

    return result;
  }, [items, activeFilter]);

  const filterTabs: { id: FilterType; label: string; icon: string; activeColor: string }[] = [
    { id: 'all', label: tm.allTypes || 'All', icon: 'apps', activeColor: 'bg-primary/15 text-primary' },
    { id: 'recipe', label: tm.recipes || 'Recipes', icon: 'menu_book', activeColor: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
    { id: 'tip', label: tm.tips || 'Tips', icon: 'lightbulb', activeColor: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
    { id: 'snippet', label: tm.snippets || 'Snippets', icon: 'code', activeColor: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
    { id: 'faq', label: tm.faq || 'FAQ', icon: 'help', activeColor: 'bg-purple-500/15 text-purple-600 dark:text-purple-400' },
  ];

  const getTypeLabel = (type: KnowledgeItemType): string => {
    const labels: Record<KnowledgeItemType, string> = {
      recipe: tm.typeRecipe || 'Recipe',
      tip: tm.typeTip || 'Tip',
      snippet: tm.typeSnippet || 'Snippet',
      faq: tm.typeFaq || 'FAQ',
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="material-symbols-outlined text-[24px] text-primary animate-spin">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">{tm.knowledgeHub || 'Knowledge Hub'}</h3>
        <p className="text-[12px] text-slate-500 dark:text-white/40">{tm.knowledgeHubDesc || 'Recipes, tips, snippets, and FAQs'}</p>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {filterTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id)}
            className={`h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1 transition-all ${
              activeFilter === tab.id
                ? tab.activeColor
                : 'bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40 hover:bg-slate-200 dark:hover:bg-white/[0.06]'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {filteredItems.length === 0 ? (
        <EmptyState tm={tm} activeFilter={activeFilter} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredItems.map(item => (
            <KnowledgeCardSummary
              key={item.id}
              item={item}
              typeLabel={getTypeLabel(item.type)}
              typeConfig={TYPE_CONFIG[item.type]}
              onClick={() => setExpandedId(item.id)}
              tm={tm}
              evalStatusCheck={evalStatusCheck}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {expandedId && (() => {
        const item = items.find(i => i.id === expandedId);
        if (!item) return null;
        return (
          <KnowledgeDetailModal
            item={item}
            allItems={items}
            typeLabel={getTypeLabel(item.type)}
            typeConfig={TYPE_CONFIG[item.type]}
            onClose={() => setExpandedId(null)}
            onNavigate={(id) => setExpandedId(id)}
            onApplyFile={(fileName, content, mode) => {
              if (defaultAgentId) {
                setPendingFileApply({
                  agentId: defaultAgentId,
                  files: [{ fileName, mode, content }],
                  title: item.metadata.name,
                });
              } else {
                setPendingApplyData({ fileName, content, mode, title: item.metadata.name });
              }
            }}
            tm={tm}
            doctorStatusMap={doctorStatusMap}
            evalStatusCheck={evalStatusCheck}
          />
        );
      })()}

      {/* Agent Picker */}
      {pendingApplyData && (
        <AgentPickerModal
          locale={(t as any).agentPicker || {}}
          onSelect={(agentId) => {
            setPendingFileApply({
              agentId,
              files: [{ fileName: pendingApplyData.fileName, mode: pendingApplyData.mode, content: pendingApplyData.content }],
              title: pendingApplyData.title,
            });
            setPendingApplyData(null);
          }}
          onCancel={() => setPendingApplyData(null)}
        />
      )}

      {/* File Apply Confirm */}
      {pendingFileApply && (
        <FileApplyConfirm
          request={pendingFileApply}
          locale={(t as any).fileApply || {}}
          onDone={() => setPendingFileApply(null)}
          onCancel={() => setPendingFileApply(null)}
        />
      )}
    </div>
  );
};

// Empty state component
const EmptyState: React.FC<{ tm: any; activeFilter: FilterType }> = ({ tm, activeFilter }) => {
  const categoryDescriptions: Record<FilterType, { icon: string; title: string; desc: string }> = {
    all: {
      icon: 'auto_awesome',
      title: tm.noKnowledge || 'No knowledge items yet',
      desc: tm.noKnowledgeDesc || 'Knowledge content will be added here',
    },
    recipe: {
      icon: 'menu_book',
      title: tm.recipes || 'Recipes',
      desc: tm.recipesDesc || 'Step-by-step configuration guides',
    },
    tip: {
      icon: 'lightbulb',
      title: tm.tips || 'Tips & Tricks',
      desc: tm.tipsDesc || 'Quick knowledge cards',
    },
    snippet: {
      icon: 'code',
      title: tm.snippets || 'Config Snippets',
      desc: tm.snippetsDesc || 'Ready-to-use snippets',
    },
    faq: {
      icon: 'help',
      title: tm.faq || 'FAQ',
      desc: tm.faqDesc || 'Common questions',
    },
  };

  const info = categoryDescriptions[activeFilter];

  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-white/[0.04] flex items-center justify-center mx-auto mb-4">
        <span className="material-symbols-outlined text-[32px] text-slate-300 dark:text-white/15">{info.icon}</span>
      </div>
      <p className="text-[12px] font-bold text-slate-500 dark:text-white/40">{info.title}</p>
      <p className="text-[10px] text-slate-400 dark:text-white/25 mt-1 max-w-xs mx-auto">{info.desc}</p>
      <div className="mt-4 inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/5 text-primary text-[10px] font-bold">
        <span className="material-symbols-outlined text-[12px]">schedule</span>
        {tm.comingSoon || 'Coming soon'}
      </div>
    </div>
  );
};

// Summary card component (no expand, click opens modal)
interface KnowledgeCardSummaryProps {
  item: KnowledgeItem;
  typeLabel: string;
  typeConfig: { icon: string; colorClass: string; borderColor: string; iconBg: string; iconColor: string };
  onClick: () => void;
  tm: any;
  evalStatusCheck: (check: KnowledgeStatusCheck) => { ok: boolean; detail: string };
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-green-500/10 text-green-600 dark:text-green-400',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  hard: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

const KnowledgeCardSummary: React.FC<KnowledgeCardSummaryProps> = ({ item, typeLabel, typeConfig, onClick, tm, evalStatusCheck }) => {
  const statusCheck = item.content.statusCheck;
  const status = statusCheck ? evalStatusCheck(statusCheck) : null;

  return (
    <div
      id={`knowledge-card-${item.id}`}
      onClick={onClick}
      className={`p-3.5 rounded-xl border-l-[3px] border transition-all cursor-pointer hover:shadow-sm ${
        status
          ? status.ok
            ? 'border-emerald-300/40 dark:border-emerald-500/20 bg-emerald-50/30 dark:bg-emerald-500/[0.02] hover:bg-emerald-50/50 dark:hover:bg-emerald-500/[0.04]'
            : 'border-amber-300/40 dark:border-amber-500/20 bg-amber-50/30 dark:bg-amber-500/[0.02] hover:bg-amber-50/50 dark:hover:bg-amber-500/[0.04]'
          : `border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.05]`
      } ${typeConfig.borderColor}`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          item.metadata.color
            ? `bg-gradient-to-br ${item.metadata.color}`
            : typeConfig.iconBg
        }`}>
          <span className={`material-symbols-outlined text-[20px] ${item.metadata.color ? 'text-white' : typeConfig.iconColor}`}>
            {item.metadata.icon || typeConfig.icon}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.metadata.featured && (
              <span className="material-symbols-outlined text-[13px] text-amber-500" title="Featured">star</span>
            )}
            <h4 className="text-[13px] font-bold text-slate-800 dark:text-white truncate">{item.metadata.name}</h4>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${typeConfig.colorClass}`}>
              {typeLabel}
            </span>
            {item.metadata.difficulty && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${DIFFICULTY_COLORS[item.metadata.difficulty] || ''}`}>
                {({ easy: tm.diffEasy, medium: tm.diffMedium, hard: tm.diffHard } as Record<string, string>)[item.metadata.difficulty] || item.metadata.difficulty}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-white/40 mt-1 line-clamp-2">{item.metadata.description}</p>
        </div>
      </div>

      {/* Status badge */}
      {status && (
        <div className={`flex items-center gap-1.5 mt-2.5 px-2 py-1 rounded-lg text-[10px] font-bold ${
          status.ok
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        }`}>
          <span className="material-symbols-outlined text-[12px]">{status.ok ? 'check_circle' : 'info'}</span>
          {status.detail || (status.ok ? (tm.statusOk || 'Configured') : (tm.statusTodo || 'Not configured'))}
        </div>
      )}

      {(!status) && item.metadata.tags && item.metadata.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {item.metadata.tags.slice(0, 4).map(tag => (
            <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/[0.05] text-[10px] text-slate-500 dark:text-white/40">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// Detail modal component
interface KnowledgeDetailModalProps {
  item: KnowledgeItem;
  allItems: KnowledgeItem[];
  typeLabel: string;
  typeConfig: { icon: string; colorClass: string };
  onClose: () => void;
  onNavigate: (id: string) => void;
  onApplyFile?: (fileName: string, content: string, mode: 'append' | 'replace') => void;
  tm: any;
  doctorStatusMap: Record<string, 'ok' | 'warn' | 'error'>;
  evalStatusCheck: (check: KnowledgeStatusCheck) => { ok: boolean; detail: string };
}

const KnowledgeDetailModal: React.FC<KnowledgeDetailModalProps> = ({ item, allItems, typeLabel, typeConfig, onClose, onNavigate, onApplyFile, tm, doctorStatusMap, evalStatusCheck }) => {
  const [copied, setCopied] = useState(false);
  const [copiedStepIdx, setCopiedStepIdx] = useState<number | null>(null);
  const [applyingStepIdx, setApplyingStepIdx] = useState<number | null>(null);
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const handleCopySnippet = () => {
    const text = item.content.snippet || '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleStepAction = async (stepIdx: number) => {
    const step = item.content.steps?.[stepIdx];
    if (!step?.code) return;

    const action = step.action || 'copy';

    if (action === 'append' || action === 'replace') {
      if (!step.file) {
        navigator.clipboard.writeText(step.code);
        setCopiedStepIdx(stepIdx);
        setTimeout(() => setCopiedStepIdx(null), 2000);
        return;
      }
      const confirmMsg = action === 'replace'
        ? (tm.applyReplaceConfirm || 'This will replace the contents of {file}. A backup will be created. Continue?').replace('{file}', step.file)
        : (tm.applyAppendConfirm || 'This will append content to {file}. A backup will be created. Continue?').replace('{file}', step.file);
      const ok = await confirm({ title: tm.applyConfirmTitle || 'Apply Step', message: confirmMsg });
      if (!ok) return;
      setApplyingStepIdx(stepIdx);
      try {
        const res = await recipeApi.applyStep({ action, file: step.file, content: step.code, target: step.target });
        toast(res.message || (tm.applySuccess || 'Step applied successfully'), 'success');
      } catch (err: any) {
        toast(err?.message || (tm.applyFailed || 'Failed to apply step'), 'error');
      } finally {
        setApplyingStepIdx(null);
      }
      return;
    }

    navigator.clipboard.writeText(step.code).then(() => {
      setCopiedStepIdx(stepIdx);
      setTimeout(() => setCopiedStepIdx(null), 2000);
    });
  };

  const difficultyLabel = (d?: string) => {
    const map: Record<string, string> = {
      easy: tm.diffEasy || 'Beginner',
      medium: tm.diffMedium || 'Intermediate',
      hard: tm.diffHard || 'Advanced',
    };
    return d ? map[d] || d : null;
  };

  const relatedItems = useMemo(() => {
    if (!item.metadata.relatedTemplates?.length) return [];
    return item.metadata.relatedTemplates
      .map(id => allItems.find(i => i.id === id))
      .filter((i): i is KnowledgeItem => !!i);
  }, [item, allItems]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-[#1a1c20] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
              item.metadata.color
                ? `bg-gradient-to-br ${item.metadata.color}`
                : 'bg-slate-100 dark:bg-white/[0.06]'
            }`}>
              <span className={`material-symbols-outlined text-[22px] ${item.metadata.color ? 'text-white' : 'text-slate-500 dark:text-white/50'}`}>
                {item.metadata.icon || typeConfig.icon}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {item.metadata.featured && (
                  <span className="material-symbols-outlined text-[14px] text-amber-500">star</span>
                )}
                <h3 className="text-[15px] font-bold text-slate-800 dark:text-white">{item.metadata.name}</h3>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${typeConfig.colorClass}`}>
                  {typeLabel}
                </span>
                {item.metadata.difficulty && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${DIFFICULTY_COLORS[item.metadata.difficulty] || ''}`}>
                    {difficultyLabel(item.metadata.difficulty)}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-slate-500 dark:text-white/40 mt-0.5">{item.metadata.description}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60 p-1 shrink-0 ms-2">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4 select-text">
          {/* Tags */}
          {item.metadata.tags && item.metadata.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.metadata.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-white/[0.06] text-[11px] text-slate-500 dark:text-white/40">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Status check banner */}
          {item.content.statusCheck && (() => {
            const status = evalStatusCheck(item.content.statusCheck);
            return (
              <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border ${
                status.ok
                  ? 'bg-emerald-50/50 dark:bg-emerald-500/[0.04] border-emerald-200/50 dark:border-emerald-500/15'
                  : 'bg-amber-50/50 dark:bg-amber-500/[0.04] border-amber-200/50 dark:border-amber-500/15'
              }`}>
                <span className={`material-symbols-outlined text-[16px] ${status.ok ? 'text-emerald-500' : 'text-amber-500'}`}>
                  {status.ok ? 'check_circle' : 'info'}
                </span>
                <span className={`text-[11px] font-bold ${status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {status.detail || (status.ok ? (tm.statusOk || 'Configured') : (tm.statusTodo || 'Not configured'))}
                </span>
              </div>
            );
          })()}

          {/* Recipe steps */}
          {item.type === 'recipe' && item.content.steps && item.content.steps.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-2 font-bold">
                {tm.steps || 'Steps'} ({item.content.steps.length})
              </p>
              <div className="space-y-3">
                {item.content.steps.map((step, i) => (
                  <div key={i} className="rounded-xl border border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] p-3">
                    <div className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] font-semibold text-slate-700 dark:text-white/70">{step.title}</span>
                        {step.description && (
                          <p className="text-[11px] text-slate-500 dark:text-white/40 mt-0.5">{step.description}</p>
                        )}
                      </div>
                    </div>
                    {step.code && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          {step.file && (
                            <span className="text-[10px] text-slate-400 dark:text-white/25 font-mono">{step.file}</span>
                          )}
                          {step.language && !step.file && (
                            <span className="text-[10px] text-slate-400 dark:text-white/25 font-mono">{step.language}</span>
                          )}
                          {!step.file && !step.language && <span />}
                          <button
                            onClick={() => handleStepAction(i)}
                            disabled={applyingStepIdx === i}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-colors disabled:opacity-50 ${
                              step.action === 'append' || step.action === 'replace'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
                                : 'bg-primary/10 text-primary hover:bg-primary/20'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[12px]">
                              {applyingStepIdx === i ? 'sync' :
                               copiedStepIdx === i ? 'check' :
                               step.action === 'append' ? 'add_circle' :
                               step.action === 'replace' ? 'swap_horiz' :
                               step.action === 'command' ? 'terminal' : 'content_copy'}
                            </span>
                            {applyingStepIdx === i
                              ? (tm.applying || 'Applying...')
                              : copiedStepIdx === i
                                ? (tm.copied || 'Copied!')
                                : step.action === 'append'
                                  ? (tm.applyAppend || 'Append')
                                  : step.action === 'replace'
                                    ? (tm.applyReplace || 'Replace')
                                    : step.action === 'command'
                                      ? (tm.copyCommand || 'Copy command')
                                      : (tm.copyCode || 'Copy')}
                          </button>
                        </div>
                        <pre className="text-[11px] text-slate-600 dark:text-white/50 whitespace-pre-wrap font-mono leading-relaxed bg-white dark:bg-black/20 rounded-lg p-3 max-h-40 overflow-y-auto custom-scrollbar">
                          {step.code}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tip / Recipe body */}
          {(item.type === 'tip' || item.type === 'recipe') && item.content.body && (
            <SimpleMarkdown content={item.content.body} />
          )}

          {/* Snippet */}
          {item.type === 'snippet' && item.content.snippet && (
            <div className="space-y-2">
              <div className="relative">
                <pre className="text-[11px] text-slate-600 dark:text-white/50 whitespace-pre-wrap font-mono leading-relaxed bg-slate-50 dark:bg-black/20 rounded-xl p-4 max-h-60 overflow-y-auto custom-scrollbar">
                  {item.content.snippet}
                </pre>
                <button
                  onClick={handleCopySnippet}
                  className="absolute top-2 end-2 px-2 py-1 rounded-md bg-white dark:bg-white/10 text-[10px] font-bold text-slate-500 dark:text-white/50 hover:text-primary transition-colors shadow-sm"
                >
                  {copied ? (tm.copied || 'Copied!') : (tm.copySnippet || 'Copy')}
                </button>
              </div>
              {item.content.targetFile && (
                <div className="flex items-center gap-1 mt-1">
                  <span className="material-symbols-outlined text-[12px] text-slate-400 dark:text-white/30">description</span>
                  <span className="text-[10px] text-slate-400 dark:text-white/30 font-mono truncate" title={item.content.targetFile}>
                    {item.content.targetFile}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* FAQ answer */}
          {item.type === 'faq' && (
            <div className="space-y-3">
              {item.content.question && (
                <p className="text-[13px] font-bold text-slate-700 dark:text-white/70">
                  Q: {item.content.question}
                </p>
              )}
              {item.content.answer && (
                <SimpleMarkdown content={item.content.answer} />
              )}
              {item.content.relatedDoctorChecks && item.content.relatedDoctorChecks.length > 0 && Object.keys(doctorStatusMap).length > 0 && (
                <div className="pt-3 border-t border-slate-100 dark:border-white/5">
                  <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-1.5 font-bold">
                    {tm.diagnosticStatus || 'Diagnostic Status'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.content.relatedDoctorChecks.map(checkId => {
                      const status = doctorStatusMap[checkId];
                      if (!status) return null;
                      const statusCfg = status === 'ok'
                        ? { icon: 'check_circle', cls: 'text-emerald-500 bg-emerald-500/10' }
                        : status === 'warn'
                          ? { icon: 'warning', cls: 'text-amber-500 bg-amber-500/10' }
                          : { icon: 'error', cls: 'text-red-500 bg-red-500/10' };
                      return (
                        <span
                          key={checkId}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono ${statusCfg.cls}`}
                        >
                          <span className="material-symbols-outlined text-[11px]">{statusCfg.icon}</span>
                          {checkId}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Related items */}
          {relatedItems.length > 0 && (
            <div className="pt-3 border-t border-slate-100 dark:border-white/5">
              <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-1.5 font-bold">
                {tm.relatedTemplates || 'Related'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {relatedItems.map(r => (
                  <button
                    key={r.id}
                    onClick={() => onNavigate(r.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-white/[0.04] text-[11px] text-slate-600 dark:text-white/50 hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[13px]">
                      {TYPE_CONFIG[r.type]?.icon || 'article'}
                    </span>
                    {r.metadata.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 dark:border-white/10 shrink-0">
          <div>
            {item.content.targetFile && onApplyFile ? (
              <button
                onClick={() => onApplyFile(item.content.targetFile!, item.content.snippet!, 'replace')}
                className="h-8 px-4 rounded-lg text-[12px] font-bold bg-primary text-white hover:bg-primary/90 transition-colors flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">edit_document</span>
                {tm.applyToFile || 'Apply to File'}
              </button>
            ) : item.content.editorSection ? (
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('clawdeck:open-window', { detail: { id: 'editor', section: item.content.editorSection } }));
                  onClose();
                }}
                className="h-8 px-4 rounded-lg text-[12px] font-bold bg-primary text-white hover:bg-primary/90 transition-colors flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[14px]">settings</span>
                {tm.goToSettings || 'Go to Settings'}
              </button>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="h-8 px-4 rounded-lg text-[12px] font-bold text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors"
          >
            {tm.close || 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default KnowledgeHub;
