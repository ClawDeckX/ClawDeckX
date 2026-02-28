import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { templateSystem, ScenarioTemplate, MultiAgentTemplate, AgentTemplate } from '../../services/template-system';
import ScenarioLibraryV2 from '../scenarios/ScenarioLibraryV2';
import MultiAgentCollaborationV2 from '../multiagent/MultiAgentCollaborationV2';
import TemplateSourceManagerUI from './TemplateSourceManager';
import { useToast } from '../Toast';

type Template = ScenarioTemplate | MultiAgentTemplate | AgentTemplate;

interface TemplateManagerProps {
  language: Language;
  defaultAgentId?: string;
}

type TabId = 'scenarios' | 'multi-agent' | 'agents' | 'search';

const TemplateManager: React.FC<TemplateManagerProps> = ({ language, defaultAgentId }) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const tm = (t.templateManager || {}) as any;
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<TabId>('scenarios');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSourceManager, setShowSourceManager] = useState(false);
  const [searchResults, setSearchResults] = useState<Template[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Search templates
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      setSearchLoading(true);
      templateSystem.searchAll(searchQuery, language)
        .then(results => setSearchResults(results as Template[]))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, language]);

  const tabs: { id: TabId; icon: string; label: string }[] = [
    { id: 'scenarios', icon: 'auto_awesome', label: tm.scenarios || 'Scenarios' },
    { id: 'multi-agent', icon: 'groups', label: tm.multiAgent || 'Multi-Agent' },
    { id: 'agents', icon: 'person', label: tm.agents || 'Agent Presets' },
    { id: 'search', icon: 'search', label: tm.search || 'Search' },
  ];

  const handleApplyScenario = useCallback((scenario: ScenarioTemplate) => {
    toast('success', `${tm.applied || 'Applied'}: ${scenario.metadata.name}`);
  }, [tm, toast]);

  const handleDeployMultiAgent = useCallback((template: MultiAgentTemplate) => {
    toast('success', `${tm.deployed || 'Deployed'}: ${template.metadata.name}`);
  }, [tm, toast]);

  const getTemplateTypeLabel = useCallback((type: string) => {
    const labels: Record<string, string> = {
      scenario: tm.typeScenario || 'Scenario',
      'multi-agent': tm.typeMultiAgent || 'Multi-Agent',
      agent: tm.typeAgent || 'Agent',
    };
    return labels[type] || type;
  }, [tm]);

  const getTemplateTypeColor = useCallback((type: string) => {
    const colors: Record<string, string> = {
      scenario: 'bg-blue-500/10 text-blue-500',
      'multi-agent': 'bg-purple-500/10 text-purple-500',
      agent: 'bg-green-500/10 text-green-500',
    };
    return colors[type] || 'bg-slate-500/10 text-slate-500';
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 dark:border-white/10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-white">{tm.title || 'Template Manager'}</h2>
            <p className="text-[10px] text-slate-500 dark:text-white/40">{tm.subtitle || 'Browse and deploy templates'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSourceManager(true)}
              className="h-8 px-3 rounded-lg text-[10px] font-bold border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] text-slate-600 dark:text-white/60 hover:border-primary/30 flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[14px]">settings</span>
              <span className="hidden sm:inline">{t.templateSource?.manageSource || 'Manage Sources'}</span>
            </button>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-slate-400 dark:text-white/30">
                search
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (e.target.value.trim()) {
                    setActiveTab('search');
                  }
                }}
                placeholder={tm.searchPlaceholder || 'Search all templates...'}
                className="h-8 pl-8 pr-3 w-56 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 text-[11px] text-slate-700 dark:text-white/70 placeholder:text-slate-400 dark:placeholder:text-white/30 focus:ring-1 focus:ring-primary/50 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id !== 'search') setSearchQuery('');
              }}
              className={`h-8 px-3 rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition-all ${
                activeTab === tab.id
                  ? 'bg-primary/15 text-primary'
                  : 'bg-slate-100 dark:bg-white/[0.04] text-slate-500 dark:text-white/40 hover:bg-slate-200 dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {activeTab === 'scenarios' && (
          <ScenarioLibraryV2
            language={language}
            defaultAgentId={defaultAgentId}
            onApplyScenario={handleApplyScenario}
          />
        )}

        {activeTab === 'multi-agent' && (
          <MultiAgentCollaborationV2
            language={language}
            onDeploy={handleDeployMultiAgent}
          />
        )}

        {activeTab === 'agents' && (
          <AgentPresetsPanel language={language} />
        )}

        {activeTab === 'search' && (
          <SearchResultsPanel
            results={searchResults}
            loading={searchLoading}
            query={searchQuery}
            language={language}
            getTypeLabel={getTemplateTypeLabel}
            getTypeColor={getTemplateTypeColor}
          />
        )}
      </div>

      {/* Template Source Manager Modal */}
      {showSourceManager && (
        <TemplateSourceManagerUI
          language={language}
          onClose={() => setShowSourceManager(false)}
        />
      )}
    </div>
  );
};

// Agent Presets Panel
interface AgentPresetsPanelProps {
  language: Language;
}

const AgentPresetsPanel: React.FC<AgentPresetsPanelProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const tm = (t.templateManager || {}) as any;
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  React.useEffect(() => {
    templateSystem.getAgentTemplates(language).then((data) => {
      setTemplates(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [language]);

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedId) || null;
  }, [templates, selectedId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="material-symbols-outlined text-[24px] text-primary animate-spin">progress_activity</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-800 dark:text-white">{tm.agentPresets || 'Agent Presets'}</h3>
        <p className="text-[11px] text-slate-500 dark:text-white/40">{tm.agentPresetsDesc || 'Personality and communication style presets'}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => setSelectedId(selectedId === template.id ? null : template.id)}
            className={`text-left p-4 rounded-xl border transition-all ${
              selectedId === template.id
                ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20'
                : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/20'
            }`}
          >
            <div
              className={`w-12 h-12 rounded-xl bg-gradient-to-br ${template.metadata.color || 'from-slate-500 to-gray-600'} flex items-center justify-center mb-3`}
            >
              <span className="material-symbols-outlined text-white text-[24px]">{template.metadata.icon || 'person'}</span>
            </div>
            <h4 className="text-[12px] font-bold text-slate-800 dark:text-white">{template.metadata.name}</h4>
            <p className="text-[10px] text-slate-500 dark:text-white/40 mt-1">{template.metadata.description}</p>

            {selectedId === template.id && template.content.soulSnippet && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
                <p className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-white/30 mb-1">{tm.preview || 'Preview'}</p>
                <pre className="text-[9px] text-slate-600 dark:text-white/50 whitespace-pre-wrap font-mono leading-relaxed">
                  {template.content.soulSnippet.slice(0, 200)}...
                </pre>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

// Search Results Panel
interface SearchResultsPanelProps {
  results: Template[];
  loading: boolean;
  query: string;
  language: Language;
  getTypeLabel: (type: string) => string;
  getTypeColor: (type: string) => string;
}

const SearchResultsPanel: React.FC<SearchResultsPanelProps> = ({
  results,
  loading,
  query,
  language,
  getTypeLabel,
  getTypeColor,
}) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const tm = (t.templateManager || {}) as any;

  if (!query.trim()) {
    return (
      <div className="text-center py-12">
        <span className="material-symbols-outlined text-[48px] text-slate-200 dark:text-white/10">search</span>
        <p className="mt-2 text-[11px] text-slate-400 dark:text-white/30">{tm.enterSearchQuery || 'Enter a search query'}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="material-symbols-outlined text-[24px] text-primary animate-spin">progress_activity</span>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="text-center py-12">
        <span className="material-symbols-outlined text-[48px] text-slate-200 dark:text-white/10">search_off</span>
        <p className="mt-2 text-[11px] text-slate-400 dark:text-white/30">
          {tm.noResults || 'No results found for'} "{query}"
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-500 dark:text-white/40">
        {results.length} {tm.resultsFor || 'results for'} "{query}"
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {results.map((template) => (
          <div
            key={`${template.type}-${template.id}`}
            className="p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.03]"
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-lg bg-gradient-to-br ${template.metadata.color || 'from-slate-500 to-gray-600'} flex items-center justify-center shrink-0`}
              >
                <span className="material-symbols-outlined text-white text-[20px]">{template.metadata.icon || 'auto_awesome'}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-[12px] font-bold text-slate-800 dark:text-white truncate">{template.metadata.name}</h4>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${getTypeColor(template.type)}`}>
                    {getTypeLabel(template.type)}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-white/40 mt-0.5 line-clamp-2">{template.metadata.description}</p>
              </div>
            </div>

            {template.metadata.tags && template.metadata.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {template.metadata.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/[0.05] text-[9px] text-slate-500 dark:text-white/40">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TemplateManager;
