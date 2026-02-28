import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { templateSystem, ScenarioTemplate } from '../../services/template-system';
import { scenarioApi } from '../../services/api';
import { useToast } from '../Toast';
import { FileApplyConfirm, FileApplyRequest } from '../FileApplyConfirm';

interface ScenarioLibraryProps {
  language: Language;
  defaultAgentId?: string;
  onApplyScenario?: (scenario: ScenarioTemplate) => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  all: 'apps',
  productivity: 'work',
  social: 'share',
  creative: 'edit',
  devops: 'terminal',
  research: 'school',
  finance: 'payments',
  family: 'home',
};

const ScenarioLibraryV2: React.FC<ScenarioLibraryProps> = ({ language, defaultAgentId, onApplyScenario }) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const s = (t.scenario || {}) as any;
  const { toast } = useToast();

  const [grouped, setGrouped] = useState<Record<string, ScenarioTemplate[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [category, setCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewScenario, setPreviewScenario] = useState<ScenarioTemplate | null>(null);
  const [settingUp, setSettingUp] = useState<string | null>(null);
  const [applyRequest, setApplyRequest] = useState<FileApplyRequest | null>(null);

  // Load scenarios
  useEffect(() => {
    setLoading(true);
    templateSystem.getGroupedScenarios(language)
      .then(data => {
        setGrouped(data);
        setError(null);
      })
      .catch(err => setError(err))
      .finally(() => setLoading(false));
  }, [language]);

  // Get all scenarios or filtered by category
  const scenarios = useMemo(() => {
    let result: ScenarioTemplate[] = [];

    if (category === 'all') {
      result = Object.values(grouped).flat();
    } else {
      result = grouped[category] || [];
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (sc) =>
          sc.metadata.name.toLowerCase().includes(query) ||
          sc.metadata.description.toLowerCase().includes(query) ||
          sc.metadata.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    return result;
  }, [grouped, category, searchQuery]);

  // Get available categories
  const categories = useMemo(() => {
    const cats = ['all', ...Object.keys(grouped)];
    return cats;
  }, [grouped]);

  const getCategoryLabel = useCallback(
    (cat: string) => {
      if (cat === 'all') return s.catAll || 'All';
      const key = `cat${cat.charAt(0).toUpperCase() + cat.slice(1)}` as keyof typeof s;
      return s[key] || cat.charAt(0).toUpperCase() + cat.slice(1);
    },
    [s]
  );

  const getDifficultyLabel = useCallback(
    (diff?: string) => {
      if (diff === 'easy') return s.diffEasy || 'Easy';
      if (diff === 'medium') return s.diffMedium || 'Medium';
      if (diff === 'hard') return s.diffHard || 'Hard';
      return diff || '';
    },
    [s]
  );

  const translateTag = useCallback(
    (tag: string) => {
      // Tags are already translated by template-i18n during template loading
      return tag;
    },
    []
  );

  const getDifficultyColor = useCallback((diff?: string) => {
    if (diff === 'easy') return 'bg-emerald-500/10 text-emerald-500';
    if (diff === 'medium') return 'bg-amber-500/10 text-amber-500';
    if (diff === 'hard') return 'bg-red-500/10 text-red-500';
    return 'bg-slate-500/10 text-slate-500';
  }, []);

  const handleQuickSetup = useCallback(
    (scenario: ScenarioTemplate) => {
      if (!defaultAgentId) {
        toast('error', s.noAgentSelected || 'No agent selected');
        return;
      }

      // Build file apply request
      const files = [];
      
      if (scenario.content.soulSnippet) {
        files.push({
          fileName: 'SOUL.md',
          mode: 'append' as const,
          content: `\n\n## ${scenario.metadata.name}\n${scenario.content.soulSnippet}\n`,
        });
      }

      if (scenario.content.heartbeatSnippet) {
        files.push({
          fileName: 'HEARTBEAT.md',
          mode: 'append' as const,
          content: `\n\n## ${scenario.metadata.name}\n${scenario.content.heartbeatSnippet}\n`,
        });
      }

      if (scenario.content.userSnippet) {
        files.push({
          fileName: 'USER.md',
          mode: 'append' as const,
          content: `\n\n${scenario.content.userSnippet}\n`,
        });
      }

      if (scenario.content.memorySnippet) {
        files.push({
          fileName: 'MEMORY.md',
          mode: 'append' as const,
          content: `\n\n${scenario.content.memorySnippet}\n`,
        });
      }

      if (scenario.content.toolsSnippet) {
        files.push({
          fileName: 'TOOLS.md',
          mode: 'append' as const,
          content: `\n\n${scenario.content.toolsSnippet}\n`,
        });
      }

      if (scenario.content.bootSnippet) {
        files.push({
          fileName: 'BOOTSTRAP.md',
          mode: 'append' as const,
          content: `\n\n${scenario.content.bootSnippet}\n`,
        });
      }

      if (files.length === 0) {
        toast('error', 'No content to apply');
        return;
      }

      setApplyRequest({
        agentId: defaultAgentId,
        files,
        title: scenario.metadata.name,
        description: scenario.metadata.description,
        // Pass advanced features for post-apply processing
        advancedFeatures: {
          skills: (scenario as any).skills,
          cronJobs: (scenario as any).cronJobs,
          integrations: (scenario as any).integrations,
        },
      });
    },
    [defaultAgentId, s, toast]
  );

  const handleApplyDone = useCallback(() => {
    setApplyRequest(null);
    onApplyScenario?.();
  }, [onApplyScenario]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="material-symbols-outlined text-[24px] text-primary animate-spin">progress_activity</span>
        <span className="ml-2 text-[11px] text-slate-500 dark:text-white/40">{s.loading || 'Loading...'}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <span className="material-symbols-outlined text-[32px] text-red-500">error</span>
        <p className="mt-2 text-[11px] text-red-500">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-white">{s.title || 'Scenario Library'}</h3>
          <p className="text-[11px] text-slate-500 dark:text-white/40">{s.subtitle || 'Pre-configured scenarios for common use cases'}</p>
        </div>
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-slate-400 dark:text-white/30">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={s.searchPlaceholder || 'Search scenarios...'}
            className="h-8 pl-8 pr-3 w-full sm:w-56 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-[11px] text-slate-700 dark:text-white/70 placeholder:text-slate-400 dark:placeholder:text-white/30 focus:ring-1 focus:ring-primary/50 outline-none"
          />
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => {
              setCategory(cat);
              setSearchQuery('');
            }}
            className={`h-8 px-3 rounded-lg text-[10px] font-bold flex items-center gap-1.5 whitespace-nowrap transition-all ${
              category === cat && !searchQuery
                ? 'bg-primary/15 text-primary'
                : 'bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40 hover:bg-slate-200 dark:hover:bg-white/[0.06]'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">{CATEGORY_ICONS[cat] || 'folder'}</span>
            <span className="hidden sm:inline">{getCategoryLabel(cat)}</span>
          </button>
        ))}
      </div>

      {/* Scenario Grid - 优化布局 */}
      {scenarios.length === 0 ? (
        <div className="text-center py-12 text-[11px] text-slate-400 dark:text-white/40">
          <span className="material-symbols-outlined text-[32px] mb-2 block">search_off</span>
          {s.noScenarios || 'No scenarios found'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {scenarios.map((scenario) => (
            <div
              key={scenario.id}
              className="rounded-xl border bg-white dark:bg-white/[0.03] overflow-hidden transition-all border-slate-200 dark:border-white/10 hover:border-primary/30 hover:shadow-lg"
            >
              {/* Card Header */}
              <div className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${scenario.metadata.color || 'from-blue-500 to-cyan-500'} flex items-center justify-center shrink-0`}
                  >
                    <span className="material-symbols-outlined text-white text-[24px]">{scenario.metadata.icon || 'auto_awesome'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[14px] font-bold text-slate-800 dark:text-white mb-1" title={scenario.metadata.name}>{scenario.metadata.name}</h4>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {scenario.metadata.difficulty && (
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${getDifficultyColor(scenario.metadata.difficulty)}`}>
                          {getDifficultyLabel(scenario.metadata.difficulty)}
                        </span>
                      )}
                      {scenario.metadata.newbie && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-primary/10 text-primary shrink-0">
                          {s.recommended || 'Recommended'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-[12px] text-slate-600 dark:text-white/50 mb-3 line-clamp-2">{scenario.metadata.description}</p>

                {/* Tags */}
                {scenario.metadata.tags && scenario.metadata.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {scenario.metadata.tags.slice(0, 5).map((tag) => (
                      <span key={tag} className="px-2 py-1 rounded-md bg-slate-100 dark:bg-white/[0.05] text-[10px] text-slate-600 dark:text-white/50">
                        {translateTag(tag)}
                      </span>
                    ))}
                  </div>
                )}

                {/* Advanced Features Indicators */}
                {((scenario as any).skills?.length > 0 || (scenario as any).cronJobs?.length > 0 || (scenario as any).integrations?.length > 0) && (
                  <div className="flex flex-wrap gap-1.5 mb-3 pb-3 border-b border-slate-100 dark:border-white/5">
                    {(scenario as any).skills?.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-purple-500/10 text-[10px] text-purple-600 dark:text-purple-400 font-medium">
                        <span className="material-symbols-outlined text-[12px]">extension</span>
                        {(scenario as any).skills.length} {s.skills || 'Skills'}
                      </span>
                    )}
                    {(scenario as any).cronJobs?.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                        <span className="material-symbols-outlined text-[12px]">schedule</span>
                        {(scenario as any).cronJobs.length} {s.cron || 'Cron'}
                      </span>
                    )}
                    {(scenario as any).integrations?.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-cyan-500/10 text-[10px] text-cyan-600 dark:text-cyan-400 font-medium">
                        <span className="material-symbols-outlined text-[12px]">link</span>
                        {(scenario as any).integrations.length} {s.integrations || 'Integrations'}
                      </span>
                    )}
                  </div>
                )}

                {/* Requirements */}
                {scenario.requirements && (scenario.requirements.skills?.length || scenario.requirements.channels?.length) ? (
                  <div className="mb-3 pb-3 border-b border-slate-100 dark:border-white/5">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-2 font-semibold">{s.requirements || 'Requirements'}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {scenario.requirements.skills?.map((skill) => (
                        <span key={skill} className="px-2 py-1 rounded-md bg-blue-500/10 text-[10px] text-blue-600 dark:text-blue-400 font-medium">
                          {skill}
                        </span>
                      ))}
                      {scenario.requirements.channels?.map((ch) => (
                        <span key={ch} className="px-2 py-1 rounded-md bg-green-500/10 text-[10px] text-green-600 dark:text-green-400 font-medium">
                          {ch}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreviewScenario(scenario)}
                    className="flex-1 h-9 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] text-slate-600 dark:text-white/60 hover:border-primary/30 hover:bg-primary/5 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <span className="material-symbols-outlined text-[16px]">visibility</span>
                    <span>{s.preview || 'Preview'}</span>
                  </button>
                  <button
                    onClick={() => handleQuickSetup(scenario)}
                    disabled={settingUp === scenario.id}
                    className="flex-1 h-9 rounded-lg text-[11px] font-bold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <span className={`material-symbols-outlined text-[16px] ${settingUp === scenario.id ? 'animate-spin' : ''}`}>
                      {settingUp === scenario.id ? 'progress_activity' : 'bolt'}
                    </span>
                    <span>{settingUp === scenario.id ? (s.settingUp || 'Setting up...') : (s.quickSetup || 'Quick Setup')}</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {previewScenario && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPreviewScenario(null)}>
          <div 
            className="bg-white dark:bg-[#1a1c20] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06] shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${previewScenario.metadata.color || 'from-blue-500 to-cyan-500'} flex items-center justify-center`}>
                  <span className="material-symbols-outlined text-white text-[20px]">{previewScenario.metadata.icon || 'auto_awesome'}</span>
                </div>
                <div>
                  <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">{previewScenario.metadata.name}</h3>
                  <p className="text-[11px] text-slate-500 dark:text-white/40">{previewScenario.metadata.description}</p>
                </div>
              </div>
              <button onClick={() => setPreviewScenario(null)} className="w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 flex items-center justify-center">
                <span className="material-symbols-outlined text-[18px] text-slate-400">close</span>
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Tags & Difficulty */}
              <div className="flex flex-wrap items-center gap-2">
                {previewScenario.metadata.difficulty && (
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-bold ${getDifficultyColor(previewScenario.metadata.difficulty)}`}>
                    {getDifficultyLabel(previewScenario.metadata.difficulty)}
                  </span>
                )}
                {previewScenario.metadata.newbie && (
                  <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-primary/10 text-primary">
                    {s.recommended || 'Recommended'}
                  </span>
                )}
                {previewScenario.metadata.tags?.map((tag) => (
                  <span key={tag} className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/[0.05] text-[10px] text-slate-500 dark:text-white/40">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Requirements */}
              {previewScenario.requirements && (previewScenario.requirements.skills?.length || previewScenario.requirements.channels?.length) ? (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-100 dark:border-white/5">
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-2 font-bold">{s.requirements || 'Requirements'}</p>
                  <div className="flex flex-wrap gap-2">
                    {previewScenario.requirements.skills?.map((skill) => (
                      <span key={skill} className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-[11px] text-blue-500 font-medium">
                        {skill}
                      </span>
                    ))}
                    {previewScenario.requirements.channels?.map((ch) => (
                      <span key={ch} className="px-2.5 py-1 rounded-lg bg-green-500/10 text-[11px] text-green-500 font-medium">
                        {ch}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Soul Snippet */}
              {previewScenario.content.soulSnippet && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-2 font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px]">psychology</span>
                    {s.soulSnippet || 'Soul Configuration'}
                  </p>
                  <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 p-4">
                    <pre className="text-[11px] text-slate-600 dark:text-white/60 whitespace-pre-wrap font-mono leading-relaxed">
                      {previewScenario.content.soulSnippet}
                    </pre>
                  </div>
                </div>
              )}

              {/* Heartbeat Snippet */}
              {previewScenario.content.heartbeatSnippet && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-2 font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px]">schedule</span>
                    {s.heartbeatSnippet || 'Heartbeat Tasks'}
                  </p>
                  <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 p-4">
                    <pre className="text-[11px] text-slate-600 dark:text-white/60 whitespace-pre-wrap font-mono leading-relaxed">
                      {previewScenario.content.heartbeatSnippet}
                    </pre>
                  </div>
                </div>
              )}

              {/* Tools Snippet */}
              {(previewScenario as any).content?.toolsSnippet && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-2 font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px]">build</span>
                    {s.toolsConfig || 'Tools Configuration'}
                  </p>
                  <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 p-4">
                    <pre className="text-[11px] text-slate-600 dark:text-white/60 whitespace-pre-wrap font-mono leading-relaxed">
                      {(previewScenario as any).content.toolsSnippet}
                    </pre>
                  </div>
                </div>
              )}

              {/* Skills Configuration */}
              {(previewScenario as any).skills?.length > 0 && (
                <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-500/5 border border-purple-200 dark:border-purple-500/20">
                  <p className="text-[11px] uppercase tracking-wider text-purple-600 dark:text-purple-400 mb-3 font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px]">extension</span>
                    {s.requiredSkills || 'Required Skills'}
                  </p>
                  <div className="space-y-2">
                    {(previewScenario as any).skills.map((skill: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-black/20">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px] text-purple-500">widgets</span>
                          <span className="text-[12px] font-bold text-slate-700 dark:text-white/80">{skill.name}</span>
                        </div>
                        <div className="flex gap-1">
                          {skill.permissions?.map((perm: string) => (
                            <span key={perm} className="px-1.5 py-0.5 rounded text-[9px] bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400">
                              {perm}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cron Jobs */}
              {(previewScenario as any).cronJobs?.length > 0 && (
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20">
                  <p className="text-[11px] uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-3 font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px]">schedule</span>
                    {s.scheduledTasks || 'Scheduled Tasks'}
                  </p>
                  <div className="space-y-2">
                    {(previewScenario as any).cronJobs.map((job: any, idx: number) => (
                      <div key={idx} className="p-2 rounded-lg bg-white dark:bg-black/20">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[12px] font-bold text-slate-700 dark:text-white/80">{job.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400">
                            {job.schedule}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-white/50">{job.task}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Integrations */}
              {(previewScenario as any).integrations?.length > 0 && (
                <div className="p-4 rounded-xl bg-cyan-50 dark:bg-cyan-500/5 border border-cyan-200 dark:border-cyan-500/20">
                  <p className="text-[11px] uppercase tracking-wider text-cyan-600 dark:text-cyan-400 mb-3 font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px]">link</span>
                    {s.serviceIntegrations || 'Service Integrations'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(previewScenario as any).integrations.map((integration: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-black/20">
                        <span className="material-symbols-outlined text-[14px] text-cyan-500">cloud</span>
                        <span className="text-[11px] font-medium text-slate-700 dark:text-white/80">{integration.service}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Examples */}
              {previewScenario.content.examples && previewScenario.content.examples.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-2 font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px]">lightbulb</span>
                    {s.examples || 'Usage Examples'}
                  </p>
                  <div className="space-y-2">
                    {previewScenario.content.examples.map((ex, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 dark:bg-white/[0.02]">
                        <span className="text-primary font-bold text-[11px]">{idx + 1}.</span>
                        <span className="text-[11px] text-slate-600 dark:text-white/60">{ex}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] shrink-0">
              <button
                onClick={() => setPreviewScenario(null)}
                className="h-9 px-4 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
              >
                {s.close || 'Close'}
              </button>
              <button
                onClick={() => {
                  handleQuickSetup(previewScenario);
                  setPreviewScenario(null);
                }}
                disabled={settingUp === previewScenario.id}
                className="h-9 px-5 rounded-lg text-[11px] font-bold bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">bolt</span>
                {s.quickSetup || 'Quick Setup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Apply Confirmation Dialog */}
      {applyRequest && (
        <FileApplyConfirm
          request={applyRequest}
          locale={t.fileApply || {}}
          onDone={handleApplyDone}
          onCancel={() => setApplyRequest(null)}
        />
      )}

      {/* Scenario Combination Tip */}
      <div className="mt-6 p-4 rounded-xl bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/20">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-[20px] text-blue-500 shrink-0 mt-0.5">info</span>
          <div className="flex-1 min-w-0">
            <h4 className="text-[12px] font-bold text-blue-900 dark:text-blue-300 mb-1">
              {s.combiningTipTitle || '💡 Combining Scenarios'}
            </h4>
            <p className="text-[11px] text-blue-700 dark:text-blue-400 leading-relaxed">
              {s.combiningTipDesc || 'You can combine multiple scenarios! For example, apply both "Personal Assistant" and "Email Manager" scenarios. Each scenario appends content to workspace files (like SOUL.md, HEARTBEAT.md) without overwriting existing content, giving your Agent multiple capabilities.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScenarioLibraryV2;
