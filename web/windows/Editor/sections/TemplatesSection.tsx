import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Language } from '../../../types';
import { getTranslation } from '../../../locales';
import { gwApi, templateApi } from '../../../services/api';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { FileApplyConfirm, FileApplyRequest } from '../../../components/FileApplyConfirm';
import CustomSelect from '../../../components/CustomSelect';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DBTemplate {
  id: number;
  template_id: string;
  target_file: string;
  icon: string;
  category: string;
  tags: string;
  author: string;
  built_in: boolean;
  i18n: string;
  version: number;
}

interface LangEntry {
  code: string;
  name: string;
  desc: string;
  content: string;
  isDefault: boolean;
}

interface TemplatesSectionProps {
  language: Language;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TARGET_FILES = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md', 'AGENTS.md', 'TOOLS.md', 'MEMORY.md'];
const CATEGORIES = ['persona', 'identity', 'user', 'heartbeat', 'agents', 'tools', 'memory'];

const COMMON_LANGS: { code: string; flag: string; label: string }[] = [
  { code: 'zh', flag: '🇨🇳', label: '中文' },
  { code: 'en', flag: '🇺🇸', label: 'English' },
  { code: 'ja', flag: '🇯🇵', label: '日本語' },
  { code: 'ko', flag: '🇰🇷', label: '한국어' },
  { code: 'de', flag: '🇩🇪', label: 'Deutsch' },
  { code: 'fr', flag: '🇫🇷', label: 'Français' },
  { code: 'es', flag: '🇪🇸', label: 'Español' },
  { code: 'pt', flag: '🇧🇷', label: 'Português' },
  { code: 'ru', flag: '🇷🇺', label: 'Русский' },
  { code: 'ar', flag: '🇸🇦', label: 'العربية' },
  { code: 'it', flag: '🇮🇹', label: 'Italiano' },
  { code: 'th', flag: '🇹🇭', label: 'ไทย' },
  { code: 'vi', flag: '🇻🇳', label: 'Tiếng Việt' },
];

function getLangFlag(code: string): string {
  return COMMON_LANGS.find(l => l.code === code)?.flag || '🌐';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function resolveI18n(tpl: DBTemplate, lang: string): { name: string; desc: string; content: string } {
  try {
    const map = JSON.parse(tpl.i18n);
    return map[lang] || map['en'] || Object.values(map)[0] as any || { name: tpl.template_id, desc: '', content: '' };
  } catch {
    return { name: tpl.template_id, desc: '', content: '' };
  }
}

function parseI18nToLangs(i18nStr: string): LangEntry[] {
  try {
    const map = JSON.parse(i18nStr) as Record<string, { name: string; desc: string; content: string }>;
    const keys = Object.keys(map);
    return keys.map((code, idx) => ({
      code,
      name: map[code]?.name || '',
      desc: map[code]?.desc || '',
      content: map[code]?.content || '',
      isDefault: idx === 0,
    }));
  } catch {
    return [{ code: 'zh', name: '', desc: '', content: '', isDefault: true }];
  }
}

function langsToI18nString(langs: LangEntry[]): string {
  const sorted = [...langs].sort((a, b) => (a.isDefault ? -1 : b.isDefault ? 1 : 0));
  const map: Record<string, { name: string; desc: string; content: string }> = {};
  for (const l of sorted) {
    map[l.code] = { name: l.name, desc: l.desc, content: l.content };
  }
  return JSON.stringify(map);
}

/** Very simple markdown → HTML for preview (headings, bold, italic, lists, code blocks, inline code) */
function simpleMarkdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-slate-100 dark:bg-white/5 p-2 rounded text-[10px] overflow-x-auto"><code>$2</code></pre>')
    // Headers
    .replace(/^#### (.+)$/gm, '<h4 class="text-[11px] font-bold mt-2 mb-1">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="text-[12px] font-bold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-[13px] font-bold mt-3 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-[14px] font-bold mt-3 mb-1.5">$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-slate-100 dark:bg-white/10 px-1 rounded text-[10px]">$1</code>')
    // Unordered list
    .replace(/^- \[ \] (.+)$/gm, '<div class="flex items-start gap-1 ml-2"><span class="text-slate-300">☐</span><span>$1</span></div>')
    .replace(/^- \[x\] (.+)$/gm, '<div class="flex items-start gap-1 ml-2"><span class="text-green-500">☑</span><span>$1</span></div>')
    .replace(/^- (.+)$/gm, '<div class="flex items-start gap-1 ml-2"><span class="text-slate-400">•</span><span>$1</span></div>')
    // Line breaks
    .replace(/\n\n/g, '<div class="h-2"></div>')
    .replace(/\n/g, '<br/>');
  return html;
}

function downloadJson(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const TemplatesSection: React.FC<TemplatesSectionProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const es = useMemo(() => (t as any).es || {}, [t]);
  const o = useMemo(() => (t as any).ow || {}, [t]);
  const { toast } = useToast();
  const { confirm } = useConfirm();

  // Core state
  const [templates, setTemplates] = useState<DBTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewTpl, setPreviewTpl] = useState<DBTemplate | null>(null);
  const [previewTab, setPreviewTab] = useState<'raw' | 'md'>('raw');
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [applyOk, setApplyOk] = useState<number | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingApply, setPendingApply] = useState<{ tplId: number; request: FileApplyRequest } | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [editTpl, setEditTpl] = useState<DBTemplate | null>(null);
  const [formId, setFormId] = useState('');
  const [formTarget, setFormTarget] = useState('SOUL.md');
  const [formIcon, setFormIcon] = useState('description');
  const [formCategory, setFormCategory] = useState('persona');
  const [formTags, setFormTags] = useState('');
  const [formAuthor, setFormAuthor] = useState('');
  const [formLangs, setFormLangs] = useState<LangEntry[]>([{ code: 'zh', name: '', desc: '', content: '', isDefault: true }]);
  const [formSaving, setFormSaving] = useState(false);
  const [activeLangIdx, setActiveLangIdx] = useState(0);
  const [contentTab, setContentTab] = useState<'edit' | 'preview'>('edit');

  // Language add dropdown
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [customLangCode, setCustomLangCode] = useState('');
  const langDropdownRef = useRef<HTMLDivElement>(null);

  // Import conflict
  const [conflictItem, setConflictItem] = useState<any | null>(null);
  const [importQueue, setImportQueue] = useState<any[]>([]);

  const [deleting, setDeleting] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------
  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await templateApi.list();
      setTemplates(Array.isArray(data) ? data : []);
    } catch { setTemplates([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTemplates();
    gwApi.agents().then((data: any) => {
      const list = Array.isArray(data) ? data : data?.agents || [];
      setDefaultAgentId(data?.defaultId || list[0]?.id || null);
    }).catch(() => { });
  }, [fetchTemplates]);

  // Close lang dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langDropdownRef.current && !langDropdownRef.current.contains(e.target as Node)) {
        setShowLangDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ---------------------------------------------------------------------------
  // Template actions
  // ---------------------------------------------------------------------------
  const applyToAgent = useCallback((tpl: DBTemplate) => {
    if (!defaultAgentId) return;
    const resolved = resolveI18n(tpl, language);
    setApplyOk(null);
    setPendingApply({
      tplId: tpl.id,
      request: {
        agentId: defaultAgentId,
        title: resolved.name,
        files: [{ fileName: tpl.target_file, mode: 'replace', content: resolved.content }],
      },
    });
  }, [defaultAgentId, language]);

  const handleApplyDone = useCallback(() => {
    if (pendingApply) {
      setApplyOk(pendingApply.tplId);
      setTimeout(() => setApplyOk(null), 2000);
    }
    setPendingApply(null);
  }, [pendingApply]);

  const handleDelete = useCallback(async (id: number) => {
    const ok = await confirm({
      title: es.tplDelete,
      message: es.tplDeleteConfirm,
      confirmText: es.tplDelete,
      cancelText: es.cancel,
      danger: true,
    });
    if (!ok) return;
    setDeleting(id);
    try {
      await templateApi.remove(id);
      await fetchTemplates();
    } catch (err: any) { toast('error', err?.message || es.tplDeleteFailed); }
    setDeleting(null);
  }, [fetchTemplates]);

  // ---------------------------------------------------------------------------
  // Modal (Create / Edit)
  // ---------------------------------------------------------------------------
  const openCreateModal = useCallback(() => {
    setIsNew(true);
    setEditTpl(null);
    setFormId(''); setFormTarget('SOUL.md'); setFormIcon('description'); setFormCategory('persona');
    setFormTags(''); setFormAuthor('');
    setFormLangs([
      { code: 'zh', name: '', desc: '', content: '', isDefault: true },
      { code: 'en', name: '', desc: '', content: '', isDefault: false },
    ]);
    setActiveLangIdx(0);
    setContentTab('edit');
    setShowModal(true);
  }, []);

  const openEditModal = useCallback((tpl: DBTemplate) => {
    setIsNew(false);
    setEditTpl(tpl);
    setFormId(tpl.template_id);
    setFormTarget(tpl.target_file);
    setFormIcon(tpl.icon);
    setFormCategory(tpl.category);
    setFormTags(tpl.tags);
    setFormAuthor(tpl.author);
    setFormLangs(parseI18nToLangs(tpl.i18n));
    setActiveLangIdx(0);
    setContentTab('edit');
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditTpl(null);
    setIsNew(false);
  }, []);

  const saveForm = useCallback(async () => {
    const i18n = langsToI18nString(formLangs);
    setFormSaving(true);
    try {
      if (isNew) {
        await templateApi.create({ template_id: formId, target_file: formTarget, icon: formIcon, category: formCategory, tags: formTags, author: formAuthor, i18n });
      } else if (editTpl) {
        await templateApi.update({ id: editTpl.id, template_id: formId, target_file: formTarget, icon: formIcon, category: formCategory, tags: formTags, author: formAuthor, i18n });
      }
      closeModal();
      await fetchTemplates();
      toast('success', es.tplSaved);
    } catch (err: any) { toast('error', err?.message || es.tplSaveFailed); }
    setFormSaving(false);
  }, [isNew, editTpl, formId, formTarget, formIcon, formCategory, formTags, formAuthor, formLangs, closeModal, fetchTemplates]);

  // ---------------------------------------------------------------------------
  // Language management
  // ---------------------------------------------------------------------------
  const addLanguage = useCallback((code: string) => {
    if (!code.trim()) return;
    const lc = code.toLowerCase().trim();
    if (formLangs.some(l => l.code === lc)) {
      toast('error', es.tplLangExists + `: "${lc}"`);
      return;
    }
    setFormLangs(prev => [...prev, { code: lc, name: '', desc: '', content: '', isDefault: prev.length === 0 }]);
    setActiveLangIdx(formLangs.length);
    setShowLangDropdown(false);
    setCustomLangCode('');
  }, [formLangs]);

  const removeLanguage = useCallback((idx: number) => {
    setFormLangs(prev => {
      const next = prev.filter((_, i) => i !== idx);
      if (prev[idx]?.isDefault && next.length > 0) {
        next[0].isDefault = true;
      }
      return next;
    });
    setActiveLangIdx(i => Math.max(0, Math.min(i, formLangs.length - 2)));
  }, [formLangs]);

  const setDefaultLang = useCallback((idx: number) => {
    setFormLangs(prev => prev.map((l, i) => ({ ...l, isDefault: i === idx })));
  }, []);

  const updateLang = useCallback((idx: number, field: 'name' | 'desc' | 'content', value: string) => {
    setFormLangs(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  }, []);

  // ---------------------------------------------------------------------------
  // Copy built-in as custom
  // ---------------------------------------------------------------------------
  const copyAsCustom = useCallback((tpl: DBTemplate) => {
    setIsNew(true);
    setEditTpl(null);
    setFormId(tpl.template_id + '-copy');
    setFormTarget(tpl.target_file);
    setFormIcon(tpl.icon);
    setFormCategory(tpl.category);
    setFormTags(tpl.tags);
    setFormAuthor(tpl.author || es.tplAuthorDefault);
    setFormLangs(parseI18nToLangs(tpl.i18n));
    setActiveLangIdx(0);
    setContentTab('edit');
    setShowModal(true);
  }, [es]);

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  const exportSingle = useCallback((tpl: DBTemplate) => {
    try {
      const i18nParsed = JSON.parse(tpl.i18n);
      const payload = {
        format: 'openclaw-template',
        version: 1,
        template_id: tpl.template_id,
        target_file: tpl.target_file,
        icon: tpl.icon,
        category: tpl.category,
        tags: tpl.tags,
        author: tpl.author,
        template_version: tpl.version,
        i18n: i18nParsed,
        exported_at: new Date().toISOString(),
      };
      downloadJson(payload, `${tpl.template_id}.json`);
      toast('success', es.tplExportSuccess);
    } catch { toast('error', es.tplExportFailed); }
  }, []);

  const exportAll = useCallback(() => {
    try {
      const payload = templates.map(tpl => {
        let i18nParsed = {};
        try { i18nParsed = JSON.parse(tpl.i18n); } catch { }
        return {
          template_id: tpl.template_id,
          target_file: tpl.target_file,
          icon: tpl.icon,
          category: tpl.category,
          tags: tpl.tags,
          author: tpl.author,
          version: tpl.version,
          i18n: i18nParsed,
        };
      });
      const wrapper = {
        format: 'openclaw-templates',
        version: 1,
        exported_at: new Date().toISOString(),
        templates: payload,
      };
      const date = new Date().toISOString().slice(0, 10);
      downloadJson(wrapper, `openclaw-templates-${date}.json`);
      toast('success', es.tplExportSuccess);
    } catch { toast('error', es.tplExportFailed); }
  }, [templates]);

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------
  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      let items: any[] = [];
      if (Array.isArray(data)) {
        items = data;
      } else if (data.templates && Array.isArray(data.templates)) {
        items = data.templates;
      } else if (data.template_id) {
        items = [data];
      } else {
        toast('error', es.tplImportFailed + ': ' + es.tplImportInvalidFormat);
        return;
      }
      // Validate each item
      for (const item of items) {
        if (!item.template_id || !item.target_file || !item.i18n) {
          toast('error', es.tplImportFailed + ': ' + es.tplImportMissingFields);
          return;
        }
      }
      // Process queue
      processImportQueue(items);
    } catch {
      toast('error', es.tplImportFailed + ': ' + es.tplImportInvalidJson);
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [templates]);

  const processImportQueue = useCallback(async (items: any[]) => {
    let successCount = 0;
    const remaining = [...items];

    while (remaining.length > 0) {
      const item = remaining.shift()!;
      const existing = templates.find(t => t.template_id === item.template_id);
      if (existing) {
        // Show conflict dialog and wait
        setConflictItem(item);
        setImportQueue(remaining);
        return; // Will be continued from conflict resolution
      }
      // No conflict, create
      try {
        const i18nStr = typeof item.i18n === 'string' ? item.i18n : JSON.stringify(item.i18n);
        await templateApi.create({
          template_id: item.template_id,
          target_file: item.target_file,
          icon: item.icon || 'description',
          category: item.category || 'persona',
          tags: item.tags || '',
          author: item.author || '',
          i18n: i18nStr,
        });
        successCount++;
      } catch { /* skip on error */ }
    }
    await fetchTemplates();
    if (successCount > 0) toast('success', `${es.tplImportSuccess} (${successCount})`);
  }, [templates, fetchTemplates]);

  const resolveConflict = useCallback(async (action: 'overwrite' | 'skip' | 'rename') => {
    if (!conflictItem) return;
    const item = conflictItem;
    setConflictItem(null);

    if (action === 'skip') {
      // Continue with remaining
      if (importQueue.length > 0) {
        processImportQueue(importQueue);
      } else {
        await fetchTemplates();
      }
      return;
    }

    const i18nStr = typeof item.i18n === 'string' ? item.i18n : JSON.stringify(item.i18n);

    if (action === 'overwrite') {
      const existing = templates.find(t => t.template_id === item.template_id);
      if (existing && !existing.built_in) {
        try {
          await templateApi.update({
            id: existing.id,
            template_id: item.template_id,
            target_file: item.target_file,
            icon: item.icon || existing.icon,
            category: item.category || existing.category,
            tags: item.tags || existing.tags,
            author: item.author || existing.author,
            i18n: i18nStr,
          });
        } catch { }
      }
    } else if (action === 'rename') {
      let suffix = 2;
      let newId = `${item.template_id}-${suffix}`;
      while (templates.some(t => t.template_id === newId)) {
        suffix++;
        newId = `${item.template_id}-${suffix}`;
      }
      try {
        await templateApi.create({
          template_id: newId,
          target_file: item.target_file,
          icon: item.icon || 'description',
          category: item.category || 'persona',
          tags: item.tags || '',
          author: item.author || '',
          i18n: i18nStr,
        });
      } catch { }
    }

    // Continue with remaining
    if (importQueue.length > 0) {
      await fetchTemplates();
      processImportQueue(importQueue);
    } else {
      await fetchTemplates();
      toast('success', es.tplImportSuccess);
    }
  }, [conflictItem, importQueue, templates, fetchTemplates, processImportQueue]);


  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------
  const filteredTemplates = useMemo(() => {
    let list = templates;
    if (activeFile) list = list.filter(t => t.target_file === activeFile);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(tpl => {
        const resolved = resolveI18n(tpl, language);
        return (
          resolved.name.toLowerCase().includes(q) ||
          resolved.desc.toLowerCase().includes(q) ||
          tpl.template_id.toLowerCase().includes(q) ||
          tpl.tags.toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [templates, activeFile, searchQuery, language]);

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------
  const inputCls = "w-full h-7 px-2.5 rounded-lg bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 text-[10px] font-mono text-slate-700 dark:text-white/70 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20";
  const textareaCls = "w-full p-2.5 rounded-lg bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 text-[10px] font-mono text-slate-700 dark:text-white/70 resize-none outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 custom-scrollbar";
  const btnSecondary = "text-[10px] px-2.5 py-1 rounded-lg text-slate-500 hover:text-primary hover:bg-primary/5 font-bold transition-colors flex items-center gap-1";
  const btnPrimary = "text-[10px] px-2.5 py-1 rounded-lg bg-primary text-white font-bold flex items-center gap-1 hover:bg-primary/90 transition-colors";

  const currentLang = formLangs[activeLangIdx] || null;
  const hasValidLang = formLangs.some(l => l.name.trim());

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[10px] text-slate-500 dark:text-white/40">{es.tplDesc}</p>
        <div className="flex items-center gap-1.5">
          <button onClick={() => fileInputRef.current?.click()} className={btnSecondary}>
            <span className="material-symbols-outlined text-[12px]">upload</span>{es.tplImport}
          </button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          <button onClick={exportAll} className={btnSecondary} disabled={templates.length === 0}>
            <span className="material-symbols-outlined text-[12px]">download</span>{es.tplExportAll}
          </button>
          <button onClick={openCreateModal} className={btnPrimary}>
            <span className="material-symbols-outlined text-[12px]">add</span>{es.tplAdd}
          </button>
        </div>
      </div>

      {/* Search + File filter */}
      <div className="space-y-2">
        <div className="relative">
          <span className="material-symbols-outlined text-[14px] text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={es.tplSearch}
            className={`${inputCls} pl-8`}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setActiveFile(null)}
            className={`text-[10px] px-2.5 py-1 rounded-lg font-bold transition-colors ${!activeFile ? 'bg-primary/10 text-primary border border-primary/20' : 'text-slate-500 hover:text-slate-700 dark:hover:text-white/60 border border-transparent'}`}>
            {es.tplAll}
          </button>
          {TARGET_FILES.map(f => (
            <button key={f} onClick={() => setActiveFile(activeFile === f ? null : f)}
              className={`text-[10px] px-2.5 py-1 rounded-lg font-mono font-bold transition-colors ${activeFile === f ? 'bg-primary/10 text-primary border border-primary/20' : 'text-slate-500 hover:text-slate-700 dark:hover:text-white/60 border border-transparent'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-8">
          <span className="material-symbols-outlined text-2xl text-primary animate-spin">progress_activity</span>
        </div>
      )}

      {/* Template grid */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredTemplates.map(tpl => {
            const resolved = resolveI18n(tpl, language);
            return (
              <div key={tpl.id} className="rounded-xl border transition-all border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02]">
                {/* Card header */}
                <div className="flex items-center gap-2.5 p-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[16px] text-primary">{tpl.icon}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[11px] font-bold text-slate-700 dark:text-white/70">{resolved.name}</p>
                      <span className={`text-[9px] px-1 py-0.5 rounded-full font-bold ${tpl.built_in ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-500' : 'bg-green-100 dark:bg-green-500/10 text-green-600'}`}>
                        {tpl.built_in ? es.tplBuiltIn : es.tplUser}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 dark:text-white/35 truncate">{resolved.desc}</p>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-400 font-mono shrink-0">{tpl.target_file}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 px-3 pb-3 flex-wrap">
                  <button onClick={() => { setPreviewTpl(tpl); setPreviewTab('raw'); }} className={btnSecondary}>
                    <span className="material-symbols-outlined text-[12px]">visibility</span>
                    {es.tplPreview}
                  </button>
                  {tpl.built_in ? (
                    <button onClick={() => copyAsCustom(tpl)} className={btnSecondary}>
                      <span className="material-symbols-outlined text-[12px]">content_copy</span>{es.tplCopy}
                    </button>
                  ) : (
                    <>
                      <button onClick={() => openEditModal(tpl)} className={btnSecondary}>
                        <span className="material-symbols-outlined text-[12px]">edit</span>{es.tplEdit}
                      </button>
                      <button onClick={() => handleDelete(tpl.id)} disabled={deleting === tpl.id}
                        className="text-[10px] px-2 py-1 rounded-lg text-slate-500 hover:text-mac-red hover:bg-mac-red/5 font-bold transition-colors flex items-center gap-1">
                        {deleting === tpl.id ? <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[12px]">delete</span>}
                        {es.tplDelete}
                      </button>
                    </>
                  )}
                  <button onClick={() => exportSingle(tpl)} className={btnSecondary}>
                    <span className="material-symbols-outlined text-[12px]">download</span>{es.tplExport}
                  </button>
                  <div className="flex-1" />
                  {applyOk === tpl.id ? (
                    <span className="text-[10px] text-mac-green font-bold flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">check_circle</span>{es.tplApplied}
                    </span>
                  ) : (
                    <button onClick={() => applyToAgent(tpl)}
                      disabled={!defaultAgentId}
                      className="text-[10px] px-2.5 py-1 rounded-lg bg-primary text-white font-bold disabled:opacity-30 flex items-center gap-1 transition-colors hover:bg-primary/90">
                      <span className="material-symbols-outlined text-[12px]">play_arrow</span>
                      {es.tplApply}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && filteredTemplates.length === 0 && (
        <div className="text-center py-8 text-[11px] text-slate-400 dark:text-white/20">
          {o.noTemplates}
        </div>
      )}

      {defaultAgentId && (
        <p className="text-[11px] text-slate-400 dark:text-white/20 text-center">
          {es.tplApplyTarget}: <span className="font-mono font-bold">{defaultAgentId}</span>
        </p>
      )}

      {/* ================================================================= */}
      {/* MODAL — Create / Edit template */}
      {/* ================================================================= */}
      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={closeModal}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          {/* Modal content */}
          <div
            className="relative z-10 w-full max-w-[640px] max-h-[85vh] mx-4 rounded-2xl bg-white dark:bg-[#1c1f26] border border-slate-200 dark:border-white/10 shadow-2xl flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-white/10 shrink-0">
              <p className="text-[13px] font-bold text-slate-700 dark:text-white/80">
                {isNew ? es.tplAdd : es.tplEdit}
              </p>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60 transition-colors" title={es.tplClose} aria-label={es.tplClose}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">
              {/* Basic fields */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-slate-500 dark:text-white/40 font-bold">{es.tplId}</label>
                  <input type="text" value={formId} onChange={e => setFormId(e.target.value)} placeholder={es.tplIdPh} className={inputCls} disabled={!isNew && editTpl?.built_in} />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 dark:text-white/40 font-bold">{es.tplTargetFile}</label>
                  <CustomSelect value={formTarget} onChange={v => setFormTarget(v)} options={TARGET_FILES.map(f => ({ value: f, label: f }))} className={inputCls} />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 dark:text-white/40 font-bold">{es.tplIcon}</label>
                  <input type="text" value={formIcon} onChange={e => setFormIcon(e.target.value)} placeholder={es.tplIconPh} className={inputCls} />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 dark:text-white/40 font-bold">{es.tplCategory}</label>
                  <CustomSelect value={formCategory} onChange={v => setFormCategory(v)} options={CATEGORIES.map(c => ({ value: c, label: (es as any)[`cat${c.charAt(0).toUpperCase() + c.slice(1)}`] || c }))} className={inputCls} />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 dark:text-white/40 font-bold">{es.tplTags}</label>
                  <input type="text" value={formTags} onChange={e => setFormTags(e.target.value)} placeholder={es.tplTagsPh} className={inputCls} />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500 dark:text-white/40 font-bold">{es.tplAuthor}</label>
                  <input type="text" value={formAuthor} onChange={e => setFormAuthor(e.target.value)} className={inputCls} />
                </div>
              </div>

              {/* Language tabs */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-slate-600 dark:text-white/50">{es.tplLangCode}</p>
                  <div className="relative" ref={langDropdownRef}>
                    <button onClick={() => setShowLangDropdown(!showLangDropdown)} className={btnSecondary}>
                      <span className="material-symbols-outlined text-[12px]">add</span>{es.tplAddLang}
                    </button>
                    {showLangDropdown && (
                      <div className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-[#1e1e36] border border-slate-200 dark:border-white/10 rounded-xl shadow-xl z-50 overflow-hidden">
                        <div className="max-h-48 overflow-y-auto custom-scrollbar">
                          {COMMON_LANGS.filter(l => !formLangs.some(fl => fl.code === l.code)).map(l => (
                            <button key={l.code} onClick={() => addLanguage(l.code)}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] text-slate-600 dark:text-white/60 hover:bg-primary/5 transition-colors text-left">
                              <span>{l.flag}</span>
                              <span className="font-mono font-bold">{l.code}</span>
                              <span className="text-slate-400 dark:text-white/40">{l.label}</span>
                            </button>
                          ))}
                        </div>
                        <div className="border-t border-slate-100 dark:border-white/[0.06] p-2 flex items-center gap-1.5">
                          <input
                            type="text"
                            value={customLangCode}
                            onChange={e => setCustomLangCode(e.target.value)}
                            placeholder={es.tplCustomCode}
                            className={`${inputCls} flex-1`}
                            onKeyDown={e => { if (e.key === 'Enter') { addLanguage(customLangCode); } }}
                          />
                          <button onClick={() => addLanguage(customLangCode)} disabled={!customLangCode.trim()}
                            className="text-[10px] px-2 py-1 bg-primary text-white rounded-lg font-bold disabled:opacity-30">
                            {es.add}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Language tab bar */}
                <div className="flex items-center gap-1 flex-wrap">
                  {formLangs.map((lang, idx) => (
                    <button key={lang.code} onClick={() => { setActiveLangIdx(idx); setContentTab('edit'); }}
                      className={`group flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${activeLangIdx === idx
                        ? 'bg-primary/10 text-primary border border-primary/20'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-white/60 border border-transparent hover:border-slate-200 dark:hover:border-white/10'
                        }`}>
                      <span className="text-[12px]">{getLangFlag(lang.code)}</span>
                      <span className="font-mono">{lang.code}</span>
                      {lang.isDefault && <span className="material-symbols-outlined text-[10px] text-amber-500">star</span>}
                    </button>
                  ))}
                </div>

                {/* Active language editor */}
                {currentLang && (
                  <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-slate-50 dark:bg-white/[0.02] p-3 space-y-2.5">
                    {/* Lang action bar */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px]">{getLangFlag(currentLang.code)}</span>
                        <span className="text-[11px] font-mono font-bold text-slate-600 dark:text-white/50">{currentLang.code}</span>
                        {currentLang.isDefault && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/10 text-amber-600 font-bold">{es.tplDefaultLang}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {!currentLang.isDefault && (
                          <button onClick={() => setDefaultLang(activeLangIdx)} className="text-[11px] px-2 py-0.5 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[11px]">star</span>{es.tplSetDefault}
                          </button>
                        )}
                        {formLangs.length > 1 && (
                          <button onClick={() => removeLanguage(activeLangIdx)} className="text-[11px] px-2 py-0.5 rounded text-slate-400 hover:text-mac-red hover:bg-mac-red/5 transition-colors flex items-center gap-0.5">
                            <span className="material-symbols-outlined text-[11px]">delete</span>{es.tplRemoveLang}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Name + Desc */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-slate-500 dark:text-white/40 font-bold">{es.tplLangName}</label>
                        <input type="text" value={currentLang.name} onChange={e => updateLang(activeLangIdx, 'name', e.target.value)} placeholder={es.tplLangName} className={inputCls} />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-500 dark:text-white/40 font-bold">{es.tplLangDesc}</label>
                        <input type="text" value={currentLang.desc} onChange={e => updateLang(activeLangIdx, 'desc', e.target.value)} placeholder={es.tplLangDesc} className={inputCls} />
                      </div>
                    </div>

                    {/* Content with tabs */}
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <button onClick={() => setContentTab('edit')}
                          className={`text-[11px] px-2 py-0.5 rounded font-bold transition-colors ${contentTab === 'edit' ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:text-slate-600'}`}>
                          {es.tplEditContent}
                        </button>
                        <button onClick={() => setContentTab('preview')}
                          className={`text-[11px] px-2 py-0.5 rounded font-bold transition-colors ${contentTab === 'preview' ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:text-slate-600'}`}>
                          {es.tplPreviewMd}
                        </button>
                      </div>
                      {contentTab === 'edit' ? (
                        <textarea
                          value={currentLang.content}
                          onChange={e => updateLang(activeLangIdx, 'content', e.target.value)}
                          placeholder={es.tplLangContent}
                          rows={10}
                          className={textareaCls}
                        />
                      ) : (
                        <div
                          className="w-full min-h-[200px] max-h-[400px] overflow-y-auto p-3 rounded-lg bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 text-[10px] text-slate-700 dark:text-white/70 custom-scrollbar leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(currentLang.content || '') }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 dark:border-white/[0.06] shrink-0">
              <button onClick={closeModal} className="text-[10px] px-3 py-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white/50 font-bold transition-colors">
                {es.cancel}
              </button>
              <button onClick={saveForm} disabled={formSaving || !formId.trim() || !hasValidLang}
                className="text-[10px] px-4 py-1.5 bg-primary text-white rounded-lg font-bold disabled:opacity-40 flex items-center gap-1 hover:bg-primary/90 transition-colors">
                {formSaving && <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>}
                {es.tplSave}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* Preview Modal */}
      {/* ================================================================= */}
      {previewTpl && (() => {
        const resolved = resolveI18n(previewTpl, language);
        return (
          <div className="fixed inset-0 z-[9998] flex items-center justify-center" onClick={() => setPreviewTpl(null)}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div
              className="relative z-10 w-full max-w-[600px] max-h-[80vh] mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.06] shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[14px] text-primary">{previewTpl.icon}</span>
                  </div>
                  <div>
                    <p className="text-[12px] font-bold text-slate-700 dark:text-white/80">{resolved.name}</p>
                    <p className="text-[11px] text-slate-400 dark:text-white/40">{resolved.desc}</p>
                  </div>
                </div>
                <button onClick={() => setPreviewTpl(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60 transition-colors" title={es.tplClose} aria-label={es.tplClose}>
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>

              {/* Tab bar */}
              <div className="flex items-center gap-2 px-5 pt-3">
                <button onClick={() => setPreviewTab('raw')}
                  className={`text-[11px] px-2.5 py-1 rounded-lg font-bold transition-colors ${previewTab === 'raw' ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:text-slate-600'}`}>
                  {es.tplEditContent}
                </button>
                <button onClick={() => setPreviewTab('md')}
                  className={`text-[11px] px-2.5 py-1 rounded-lg font-bold transition-colors ${previewTab === 'md' ? 'bg-primary/10 text-primary' : 'text-slate-400 hover:text-slate-600'}`}>
                  {es.tplPreviewMd}
                </button>
                <div className="flex-1" />
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-400 font-mono">{previewTpl.target_file}</span>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-3">
                {previewTab === 'raw' ? (
                  <pre className="text-[10px] font-mono text-slate-600 dark:text-white/50 whitespace-pre-wrap leading-relaxed">
                    {resolved.content}
                  </pre>
                ) : (
                  <div
                    className="text-[10px] text-slate-700 dark:text-white/70 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: simpleMarkdownToHtml(resolved.content || '') }}
                  />
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 dark:border-white/[0.06] shrink-0">
                <button onClick={() => setPreviewTpl(null)} className="text-[10px] px-3 py-1.5 text-slate-400 hover:text-slate-600 font-bold transition-colors">
                  {es.tplClose}
                </button>
                <button onClick={() => { applyToAgent(previewTpl); setPreviewTpl(null); }}
                  disabled={!defaultAgentId}
                  className="text-[10px] px-3 py-1.5 bg-primary text-white rounded-lg font-bold disabled:opacity-30 flex items-center gap-1 hover:bg-primary/90 transition-colors">
                  <span className="material-symbols-outlined text-[12px]">play_arrow</span>
                  {es.tplApply}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================================================================= */}
      {/* Import conflict dialog */}
      {/* ================================================================= */}
      {conflictItem && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center" onClick={() => { setConflictItem(null); setImportQueue([]); }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-sm mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl p-5 space-y-3"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-amber-500">warning</span>
              <p className="text-[12px] font-bold text-slate-700 dark:text-white/80">{es.tplConflictTitle}</p>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-white/40">
              {es.tplConflictMsg}: <span className="font-mono font-bold text-primary">{conflictItem.template_id}</span>
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => resolveConflict('skip')} className="text-[10px] px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 font-bold transition-colors">
                {es.tplSkip}
              </button>
              <button onClick={() => resolveConflict('rename')} className="text-[10px] px-3 py-1.5 rounded-lg text-primary hover:bg-primary/10 font-bold transition-colors">
                {es.tplRename}
              </button>
              <button onClick={() => resolveConflict('overwrite')} className="text-[10px] px-3 py-1.5 rounded-lg bg-amber-500 text-white font-bold hover:bg-amber-600 transition-colors">
                {es.tplOverwrite}
              </button>
            </div>
          </div>
        </div>
      )}

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
