import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Language } from '../../../types';
import { getTranslation } from '../../../locales';
import { gwApi } from '../../../services/api';
import { templateSystem, WorkspaceTemplate } from '../../../services/template-system';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { FileApplyConfirm, FileApplyRequest } from '../../../components/FileApplyConfirm';

interface TemplatesSectionV2Props {
  language: Language;
}

type ViewMode = 'all' | 'online' | 'installed';
type TargetFilter = 'all' | string;

const TARGET_FILES = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md', 'AGENTS.md', 'TOOLS.md', 'MEMORY.md'];

function simpleMarkdownToHtml(md: string): string {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-slate-100 dark:bg-white/5 p-2 rounded text-[10px] overflow-x-auto"><code>$2</code></pre>')
    .replace(/^#### (.+)$/gm, '<h4 class="text-[11px] font-bold mt-2 mb-1">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="text-[12px] font-bold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-[13px] font-bold mt-3 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-[14px] font-bold mt-3 mb-1.5">$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-slate-100 dark:bg-white/10 px-1 rounded text-[10px]">$1</code>')
    .replace(/^- (.+)$/gm, '<div class="flex items-start gap-1 ml-2"><span class="text-slate-400">•</span><span>$1</span></div>')
    .replace(/\n\n/g, '<div class="h-2"></div>')
    .replace(/\n/g, '<br/>');
}

export const TemplatesSectionV2: React.FC<TemplatesSectionV2Props> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const ts = useMemo(() => (t as any).templateSection || {}, [t]);
  const { toast } = useToast();
  const { confirm } = useConfirm();

  // State
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [targetFilter, setTargetFilter] = useState<TargetFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [previewTemplate, setPreviewTemplate] = useState<WorkspaceTemplate | null>(null);
  const [previewTab, setPreviewTab] = useState<'raw' | 'preview'>('raw');
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [pendingApply, setPendingApply] = useState<{ template: WorkspaceTemplate; request: FileApplyRequest } | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<WorkspaceTemplate | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; desc: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Load templates
  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      let data: WorkspaceTemplate[] = [];
      if (viewMode === 'online') {
        data = await templateSystem.getOnlineTemplates(language);
      } else if (viewMode === 'installed') {
        data = await templateSystem.getInstalledTemplates();
      } else {
        data = await templateSystem.getAllTemplates(language);
      }
      setTemplates(data);
    } catch (e) {
      console.error('[TemplatesSection] Failed to load:', e);
      setTemplates([]);
    }
    setLoading(false);
  }, [viewMode, language]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    gwApi.agents().then((data: any) => {
      const list = Array.isArray(data) ? data : data?.agents || [];
      setDefaultAgentId(data?.defaultId || list[0]?.id || null);
    }).catch(() => {});
  }, []);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    let result = templates;

    if (targetFilter !== 'all') {
      result = result.filter(t => t.targetFile === targetFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t => {
        const i18n = templateSystem.resolveI18n(t, language);
        return (
          i18n.name.toLowerCase().includes(q) ||
          i18n.desc.toLowerCase().includes(q) ||
          t.tags.some(tag => tag.toLowerCase().includes(q))
        );
      });
    }

    return result;
  }, [templates, targetFilter, searchQuery, language]);

  // Actions
  const handleInstall = useCallback(async (template: WorkspaceTemplate) => {
    setInstalling(template.id);
    try {
      await templateSystem.installTemplate(template);
      toast('success', ts.installed || 'Template installed');
      await loadTemplates();
    } catch (e: any) {
      toast('error', e?.message || ts.installFailed || 'Install failed');
    }
    setInstalling(null);
  }, [loadTemplates, toast, ts]);

  const handleDelete = useCallback(async (template: WorkspaceTemplate) => {
    if (!template.dbId) return;
    const ok = await confirm({
      title: ts.deleteTitle || 'Delete Template',
      message: ts.deleteConfirm || 'Are you sure you want to delete this template?',
      confirmText: ts.delete || 'Delete',
      cancelText: ts.cancel || 'Cancel',
      danger: true,
    });
    if (!ok) return;

    setDeleting(template.id);
    try {
      await templateSystem.removeTemplate(template.dbId);
      toast('success', ts.deleted || 'Template deleted');
      await loadTemplates();
    } catch (e: any) {
      toast('error', e?.message || ts.deleteFailed || 'Delete failed');
    }
    setDeleting(null);
  }, [confirm, loadTemplates, toast, ts]);

  const handleApply = useCallback((template: WorkspaceTemplate) => {
    if (!defaultAgentId) return;
    const resolved = templateSystem.resolveI18n(template, language);
    setPendingApply({
      template,
      request: {
        agentId: defaultAgentId,
        title: resolved.name,
        files: [{ fileName: template.targetFile, mode: 'replace', content: resolved.content }],
      },
    });
  }, [defaultAgentId, language]);

  const handleApplyDone = useCallback(() => {
    toast('success', ts.applied || 'Template applied');
    setPendingApply(null);
  }, [toast, ts]);

  const handleEdit = useCallback((template: WorkspaceTemplate) => {
    const resolved = templateSystem.resolveI18n(template, language);
    setEditingTemplate(template);
    setEditForm({
      name: resolved.name,
      desc: resolved.desc,
      content: resolved.content,
    });
  }, [language]);

  const handleSaveEdit = useCallback(async () => {
    if (!editingTemplate || !editForm) return;
    setSaving(true);
    try {
      const updatedTemplate = {
        ...editingTemplate,
        i18n: {
          ...editingTemplate.i18n,
          [language]: editForm,
        },
      };
      await templateSystem.updateTemplate(updatedTemplate);
      toast('success', ts.saved || 'Template saved');
      setEditingTemplate(null);
      setEditForm(null);
      await loadTemplates();
    } catch (e: any) {
      toast('error', e?.message || ts.saveFailed || 'Save failed');
    }
    setSaving(false);
  }, [editingTemplate, editForm, language, loadTemplates, toast, ts]);

  const getSourceBadge = (source: string) => {
    const badges: Record<string, { color: string; label: string }> = {
      local: { color: 'bg-blue-500/10 text-blue-500', label: ts.sourceLocal || '在线' },
      cdn: { color: 'bg-purple-500/10 text-purple-500', label: ts.sourceCdn || '在线' },
      github: { color: 'bg-green-500/10 text-green-500', label: ts.sourceGithub || '在线' },
      installed: { color: 'bg-amber-500/10 text-amber-500', label: ts.sourceInstalled || '本地' },
    };
    return badges[source] || { color: 'bg-slate-500/10 text-slate-500', label: source };
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-200 dark:border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-white">{ts.title || 'Template Center'}</h2>
            <p className="text-[10px] text-slate-500 dark:text-white/40">{ts.subtitle || 'Browse and install templates'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { templateSystem.clearCache(); loadTemplates(); }}
              className="h-7 px-2 rounded-lg text-[10px] font-bold border border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:bg-slate-50 dark:hover:bg-white/[0.02] flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
              {ts.refresh || 'Refresh'}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode */}
          <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
            {(['all', 'online', 'installed'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`h-7 px-3 text-[10px] font-bold transition-colors ${
                  viewMode === mode
                    ? 'bg-primary text-white'
                    : 'bg-white dark:bg-white/[0.02] text-slate-500 dark:text-white/50 hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                }`}
              >
                {mode === 'all' ? (ts.viewAll || 'All') : mode === 'online' ? (ts.viewOnline || 'Online') : (ts.viewInstalled || 'Installed')}
              </button>
            ))}
          </div>

          {/* Target file filter */}
          <select
            value={targetFilter}
            onChange={e => setTargetFilter(e.target.value)}
            className="h-7 px-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1e2028] text-[10px] text-slate-600 dark:text-white/60"
            style={{ colorScheme: 'dark' }}
          >
            <option value="all">{ts.allFiles || 'All Files'}</option>
            {TARGET_FILES.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[150px]">
            <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-slate-400 dark:text-white/30">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={ts.searchPlaceholder || 'Search templates...'}
              className="w-full h-7 pl-7 pr-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] text-[10px] text-slate-600 dark:text-white/60 placeholder:text-slate-400 dark:placeholder:text-white/30"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        <div className="max-w-6xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400 dark:text-white/30 text-[11px]">
              <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
              {ts.loading || 'Loading...'}
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-[32px] mb-2">inbox</span>
              <p className="text-[11px]">{ts.noTemplates || 'No templates found'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredTemplates.map(template => {
              const resolved = templateSystem.resolveI18n(template, language);
              const sourceBadge = getSourceBadge(template.source);
              const isInstalling = installing === template.id;
              const isDeleting = deleting === template.id;
              const isLocal = template.source === 'installed';

              return (
                <div
                  key={template.id}
                  className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:border-primary/30 transition-colors"
                >
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[20px] text-primary">{template.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-700 dark:text-white/80">{resolved.name}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${sourceBadge.color}`}>{sourceBadge.label}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 dark:text-white/40 mt-1 line-clamp-2">{resolved.desc}</p>
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/[0.05] text-slate-500 dark:text-white/40 font-mono">
                            {template.targetFile}
                          </span>
                          {template.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/[0.05] text-slate-500 dark:text-white/40">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.05]">
                      <button
                        onClick={() => setPreviewTemplate(template)}
                        className="h-7 px-2.5 rounded-lg text-[10px] font-bold text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/[0.05] flex items-center gap-1 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[14px]">visibility</span>
                        <span className="whitespace-nowrap">{ts.preview || 'Preview'}</span>
                      </button>

                      {!isLocal && (
                        <button
                          onClick={() => handleInstall(template)}
                          disabled={isInstalling}
                          className="h-7 px-2.5 rounded-lg text-[10px] font-bold text-primary hover:bg-primary/10 flex items-center gap-1 disabled:opacity-50 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">{isInstalling ? 'progress_activity' : 'download'}</span>
                          <span className="whitespace-nowrap">{ts.download || '下载'}</span>
                        </button>
                      )}

                      {defaultAgentId && (
                        <button
                          onClick={() => handleApply(template)}
                          className="h-7 px-3 rounded-lg text-[10px] font-bold bg-primary text-white hover:bg-primary/90 flex items-center gap-1 ml-auto transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                          <span className="whitespace-nowrap">{ts.apply || 'Apply'}</span>
                        </button>
                      )}

                      {isLocal && template.dbId && (
                        <>
                          <button
                            onClick={() => handleEdit(template)}
                            className="h-7 px-2.5 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/[0.05] flex items-center gap-1 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">edit</span>
                            <span className="whitespace-nowrap">{ts.edit || '编辑'}</span>
                          </button>
                          <button
                            onClick={() => handleDelete(template)}
                            disabled={isDeleting}
                            className="h-7 px-2.5 rounded-lg text-[10px] font-bold text-red-500 hover:bg-red-500/10 flex items-center gap-1 disabled:opacity-50 transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px]">{isDeleting ? 'progress_activity' : 'delete'}</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPreviewTemplate(null)}>
          <div className="bg-white dark:bg-[#1a1c20] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px] text-primary">{previewTemplate.icon}</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                    {templateSystem.resolveI18n(previewTemplate, language).name}
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-white/40">
                    {previewTemplate.targetFile} • {previewTemplate.author || 'ClawDeckX'}
                  </p>
                </div>
              </div>
              <button onClick={() => setPreviewTemplate(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60 p-1">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="flex items-center gap-1 px-5 py-2 border-b border-slate-200 dark:border-white/10 shrink-0">
              <button
                onClick={() => setPreviewTab('raw')}
                className={`h-7 px-3 rounded text-[10px] font-bold ${previewTab === 'raw' ? 'bg-primary text-white' : 'text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/[0.05]'}`}
              >
                {ts.rawContent || 'Raw'}
              </button>
              <button
                onClick={() => setPreviewTab('preview')}
                className={`h-7 px-3 rounded text-[10px] font-bold ${previewTab === 'preview' ? 'bg-primary text-white' : 'text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/[0.05]'}`}
              >
                {ts.previewContent || 'Preview'}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-5">
              {previewTab === 'raw' ? (
                <pre className="text-[11px] font-mono text-slate-700 dark:text-white/70 whitespace-pre-wrap">
                  {templateSystem.resolveI18n(previewTemplate, language).content}
                </pre>
              ) : (
                <div
                  className="text-[11px] text-slate-700 dark:text-white/70"
                  dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(templateSystem.resolveI18n(previewTemplate, language).content) }}
                />
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-white/10 shrink-0">
              {previewTemplate.source !== 'installed' && (
                <button
                  onClick={() => { handleInstall(previewTemplate); setPreviewTemplate(null); }}
                  className="h-8 px-3 rounded-lg text-[10px] font-bold border border-primary text-primary hover:bg-primary/10 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">download</span>
                  {ts.download || '下载'}
                </button>
              )}
              {defaultAgentId && (
                <button
                  onClick={() => { handleApply(previewTemplate); setPreviewTemplate(null); }}
                  className="h-8 px-4 rounded-lg text-[10px] font-bold bg-primary text-white hover:bg-primary/90 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                  {ts.apply || 'Apply'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingTemplate && editForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setEditingTemplate(null); setEditForm(null); }}>
          <div className="bg-white dark:bg-[#1a1c20] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px] text-primary">{editingTemplate.icon}</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-white">{ts.editTemplate || '编辑模板'}</h3>
                  <p className="text-[10px] text-slate-500 dark:text-white/40">{editingTemplate.targetFile}</p>
                </div>
              </div>
              <button onClick={() => { setEditingTemplate(null); setEditForm(null); }} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60 p-1">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-600 dark:text-white/60 mb-1.5">{ts.templateName || '模板名称'}</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] text-xs text-slate-700 dark:text-white/80 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 dark:text-white/60 mb-1.5">{ts.templateDesc || '模板描述'}</label>
                <input
                  type="text"
                  value={editForm.desc}
                  onChange={e => setEditForm({ ...editForm, desc: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] text-xs text-slate-700 dark:text-white/80 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-600 dark:text-white/60 mb-1.5">{ts.templateContent || '模板内容'}</label>
                <textarea
                  value={editForm.content}
                  onChange={e => setEditForm({ ...editForm, content: e.target.value })}
                  rows={16}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] text-[11px] font-mono text-slate-700 dark:text-white/80 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-white/10 shrink-0">
              <button
                onClick={() => { setEditingTemplate(null); setEditForm(null); }}
                className="h-8 px-4 rounded-lg text-[10px] font-bold text-slate-500 dark:text-white/50 hover:bg-slate-100 dark:hover:bg-white/[0.05]"
              >
                {ts.cancel || 'Cancel'}
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="h-8 px-4 rounded-lg text-[10px] font-bold bg-primary text-white hover:bg-primary/90 flex items-center gap-1 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]">{saving ? 'progress_activity' : 'save'}</span>
                {saving ? (ts.saving || 'Saving...') : (ts.save || 'Save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apply Confirm */}
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

export default TemplatesSectionV2;
