import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { templateSourceManager, TemplateSource, TemplateSourceType } from '../../services/template-sources';
import { templateCache } from '../../services/template-loaders';
import { useToast } from '../Toast';

interface TemplateSourceManagerProps {
  language: Language;
  onClose?: () => void;
}

const TemplateSourceManagerUI: React.FC<TemplateSourceManagerProps> = ({ language, onClose }) => {
  const t = useMemo(() => getTranslation(language) as any, [language]);
  const ts = (t.templateSource || {}) as any;
  const { toast } = useToast();

  const [sources, setSources] = useState<TemplateSource[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = useCallback(() => {
    setSources(templateSourceManager.getSources());
  }, []);

  const handleToggleSource = useCallback((id: string, enabled: boolean) => {
    if (enabled) {
      templateSourceManager.enableSource(id);
    } else {
      templateSourceManager.disableSource(id);
    }
    loadSources();
    toast('success', enabled ? ts.sourceEnabled || 'Source enabled' : ts.sourceDisabled || 'Source disabled');
  }, [loadSources, toast, ts]);

  const handleDeleteSource = useCallback((id: string) => {
    if (confirm(ts.confirmDelete || 'Are you sure you want to delete this source?')) {
      templateSourceManager.removeSource(id);
      loadSources();
      toast('success', ts.sourceDeleted || 'Source deleted');
    }
  }, [loadSources, toast, ts]);

  const handleClearCache = useCallback(() => {
    templateCache.clear();
    toast('success', ts.cacheCleared || 'Cache cleared');
  }, [toast, ts]);

  const handleResetDefaults = useCallback(() => {
    if (confirm(ts.confirmReset || 'Reset to default sources?')) {
      templateSourceManager.resetToDefaults();
      loadSources();
      toast('success', ts.resetSuccess || 'Reset to defaults');
    }
  }, [loadSources, toast, ts]);

  const getCacheSize = useCallback(() => {
    const bytes = templateCache.getCacheSize();
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  const getSourceTypeIcon = useCallback((type: TemplateSourceType) => {
    const icons: Record<TemplateSourceType, string> = {
      local: 'folder',
      cdn: 'cloud',
      github: 'code',
      api: 'api',
    };
    return icons[type] || 'source';
  }, []);

  const getSourceTypeLabel = useCallback((type: TemplateSourceType) => {
    const labels: Record<TemplateSourceType, string> = {
      local: ts.typeLocal || 'Local',
      cdn: ts.typeCdn || 'CDN',
      github: ts.typeGithub || 'GitHub',
      api: ts.typeApi || 'API',
    };
    return labels[type] || type;
  }, [ts]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1a1c20] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-white">{ts.title || 'Template Sources'}</h2>
            <p className="text-[10px] text-slate-500 dark:text-white/40">{ts.subtitle || 'Manage template sources and cache'}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60 p-1">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
          {/* Cache Info */}
          <div className="mb-4 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold text-slate-700 dark:text-white/80">{ts.cacheSize || 'Cache Size'}</p>
                <p className="text-[10px] text-slate-500 dark:text-white/40">{getCacheSize()}</p>
              </div>
              <button
                onClick={handleClearCache}
                className="h-7 px-3 rounded-lg text-[10px] font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">delete</span>
                {ts.clearCache || 'Clear Cache'}
              </button>
            </div>
          </div>

          {/* Sources List */}
          <div className="space-y-2">
            {sources.map((source) => (
              <div
                key={source.id}
                className={`p-3 rounded-xl border transition-all ${
                  source.enabled
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      source.enabled ? 'bg-primary/15 text-primary' : 'bg-slate-100 dark:bg-white/[0.05] text-slate-400 dark:text-white/30'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">{getSourceTypeIcon(source.type)}</span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-[12px] font-bold text-slate-800 dark:text-white">{source.name}</h3>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 dark:bg-white/[0.05] text-slate-500 dark:text-white/40">
                        {getSourceTypeLabel(source.type)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-500">
                        {ts.priority || 'Priority'}: {source.priority}
                      </span>
                      {source.offline && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-500/10 text-green-500">
                          {ts.offline || 'Offline'}
                        </span>
                      )}
                    </div>

                    {/* Source Details */}
                    <div className="text-[10px] text-slate-500 dark:text-white/40 space-y-0.5">
                      {source.type === 'local' && source.path && <p>Path: {source.path}</p>}
                      {source.type === 'cdn' && source.url && <p>URL: {source.url}</p>}
                      {source.type === 'github' && source.repo && (
                        <p>
                          Repo: {source.repo} ({source.branch})
                        </p>
                      )}
                      {source.fallback && <p>Fallback: {source.fallback}</p>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggleSource(source.id, !source.enabled)}
                      className={`h-7 px-2 rounded-lg text-[10px] font-bold flex items-center gap-1 ${
                        source.enabled
                          ? 'bg-slate-100 dark:bg-white/[0.05] text-slate-600 dark:text-white/60'
                          : 'bg-primary/15 text-primary'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[14px]">{source.enabled ? 'toggle_on' : 'toggle_off'}</span>
                    </button>
                    {source.id !== 'local' && (
                      <button
                        onClick={() => handleDeleteSource(source.id)}
                        className="h-7 px-2 rounded-lg text-[10px] font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[14px]">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Add Source Button */}
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full mt-3 h-10 rounded-xl border-2 border-dashed border-slate-200 dark:border-white/10 text-[11px] font-bold text-slate-400 dark:text-white/30 hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {ts.addSource || 'Add Source'}
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-white/10 shrink-0">
          <button
            onClick={handleResetDefaults}
            className="h-8 px-3 rounded-lg text-[10px] font-bold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.02]"
          >
            {ts.resetDefaults || 'Reset to Defaults'}
          </button>
          <button
            onClick={onClose}
            className="h-8 px-4 rounded-lg text-[10px] font-bold bg-primary text-white hover:bg-primary/90"
          >
            {ts.close || 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateSourceManagerUI;
