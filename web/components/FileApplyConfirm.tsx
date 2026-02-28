import React, { useState, useCallback, useMemo } from 'react';
import { gwApi } from '../services/api';
import { useToast } from './Toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileApplyItem {
  fileName: string;
  mode: 'append' | 'replace';
  content: string;
}

export interface FileApplyRequest {
  agentId: string;
  files: FileApplyItem[];
  title?: string;
  description?: string;
  advancedFeatures?: {
    skills?: Array<{ name: string; permissions?: string[]; config?: Record<string, any> }>;
    cronJobs?: Array<{ name: string; schedule: string; task: string; enabled?: boolean; timezone?: string }>;
    integrations?: Array<{ service: string; permissions: string[]; config?: Record<string, any> }>;
  };
}

interface FileApplyConfirmProps {
  request: FileApplyRequest;
  locale: {
    title: string;
    affectedFiles: string;
    modeAppend: string;
    modeReplace: string;
    fileExists: string;
    fileNew: string;
    previewContent: string;
    existingContent: string;
    newContent: string;
    emptyFile: string;
    backupToggle: string;
    backupHint: string;
    confirm: string;
    cancel: string;
    applying: string;
    applied: string;
    backupCreated: string;
    applyFailed: string;
    selectAll?: string;
    deselectAll?: string;
    selected?: string;
    selectAtLeastOne?: string;
    cronJobs?: string;
    cronName?: string;
    cronSchedule?: string;
    cronTask?: string;
    cronTimezone?: string;
    cronEnabled?: string;
    cronEditTitle?: string;
    cronReset?: string;
    cronDone?: string;
    cronModified?: string;
    requiredSkills?: string;
    fileEditTitle?: string;
    fileEditReset?: string;
    fileEditDone?: string;
    fileEditPlaceholder?: string;
    fileModified?: string;
  };
  onDone: () => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FileApplyConfirm: React.FC<FileApplyConfirmProps> = ({ request, locale, onDone, onCancel }) => {
  const { toast } = useToast();
  const [applying, setApplying] = useState(false);
  const [existsMap, setExistsMap] = useState<Record<string, boolean>>({});
  const [contentCache, setContentCache] = useState<Record<string, string>>({});
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [selectedFiles, setSelectedFiles] = useState<Record<string, boolean>>(() => {
    // 默认全选所有文件
    const initial: Record<string, boolean> = {};
    request.files.forEach(f => { initial[f.fileName] = true; });
    return initial;
  });

  // 文件操作模式状态（可切换追加/覆盖）
  const [fileModes, setFileModes] = useState<Record<string, 'append' | 'replace'>>(() => {
    const initial: Record<string, 'append' | 'replace'> = {};
    request.files.forEach(f => { initial[f.fileName] = f.mode; });
    return initial;
  });

  // 切换文件操作模式
  const toggleFileMode = useCallback((fileName: string) => {
    setFileModes(prev => ({
      ...prev,
      [fileName]: prev[fileName] === 'append' ? 'replace' : 'append'
    }));
  }, []);

  // 获取文件当前模式
  const getFileMode = useCallback((fileName: string, defaultMode: 'append' | 'replace') => {
    return fileModes[fileName] ?? defaultMode;
  }, [fileModes]);

  // 定时任务选择和编辑状态
  const [selectedCronJobs, setSelectedCronJobs] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    request.advancedFeatures?.cronJobs?.forEach((_, idx) => { initial[idx] = true; });
    return initial;
  });
  const [editingCronJob, setEditingCronJob] = useState<number | null>(null);
  const [editedCronJobs, setEditedCronJobs] = useState<Record<number, { name: string; schedule: string; task: string; timezone?: string; enabled?: boolean }>>({});

  // Check which files exist on mount (parallel) and cache content for append
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        request.files.map(async (f) => {
          try {
            const res = await gwApi.agentFileGet(request.agentId, f.fileName);
            const content = (res as any)?.file?.content || '';
            return { name: f.fileName, exists: !!content, content };
          } catch {
            return { name: f.fileName, exists: false, content: '' };
          }
        })
      );
      if (!cancelled) {
        const eMap: Record<string, boolean> = {};
        const cMap: Record<string, string> = {};
        for (const r of results) { eMap[r.name] = r.exists; cMap[r.name] = r.content; }
        setExistsMap(eMap);
        setContentCache(cMap);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [request.agentId, request.files]);

  // Helper: Replace or append workflow block intelligently
  const applyBlockContent = useCallback((existing: string, newContent: string, blockId?: string): string => {
    if (!blockId) {
      // No block ID, just append
      return existing + newContent;
    }

    const blockStart = `<!-- workflow:${blockId} -->`;
    const blockEnd = `<!-- /workflow:${blockId} -->`;
    const blockRegex = new RegExp(
      `\\n?${blockStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${blockEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`,
      'g'
    );

    if (existing.includes(blockStart)) {
      // Block exists, replace it
      return existing.replace(blockRegex, newContent);
    } else {
      // Block doesn't exist, append
      return existing + newContent;
    }
  }, []);

  const getFileContent = useCallback((fileName: string, originalContent: string) => {
    return editedContent[fileName] !== undefined ? editedContent[fileName] : originalContent;
  }, [editedContent]);

  // 切换单个文件选择
  const toggleFileSelection = useCallback((fileName: string) => {
    setSelectedFiles(prev => ({ ...prev, [fileName]: !prev[fileName] }));
  }, []);

  // 全选/取消全选
  const toggleAllFiles = useCallback(() => {
    const allSelected = request.files.every(f => selectedFiles[f.fileName]);
    const newState: Record<string, boolean> = {};
    request.files.forEach(f => { newState[f.fileName] = !allSelected; });
    setSelectedFiles(newState);
  }, [request.files, selectedFiles]);

  // 获取选中的文件数量
  const selectedCount = useMemo(() => {
    return request.files.filter(f => selectedFiles[f.fileName]).length;
  }, [request.files, selectedFiles]);

  // 切换单个定时任务选择
  const toggleCronJobSelection = useCallback((idx: number) => {
    setSelectedCronJobs(prev => ({ ...prev, [idx]: !prev[idx] }));
  }, []);

  // 全选/取消全选定时任务
  const toggleAllCronJobs = useCallback(() => {
    const cronJobs = request.advancedFeatures?.cronJobs || [];
    const allSelected = cronJobs.every((_, idx) => selectedCronJobs[idx]);
    const newState: Record<number, boolean> = {};
    cronJobs.forEach((_, idx) => { newState[idx] = !allSelected; });
    setSelectedCronJobs(newState);
  }, [request.advancedFeatures?.cronJobs, selectedCronJobs]);

  // 获取选中的定时任务数量
  const selectedCronCount = useMemo(() => {
    const cronJobs = request.advancedFeatures?.cronJobs || [];
    return cronJobs.filter((_, idx) => selectedCronJobs[idx]).length;
  }, [request.advancedFeatures?.cronJobs, selectedCronJobs]);

  // 获取定时任务内容（编辑后或原始）
  const getCronJobContent = useCallback((idx: number, original: { name: string; schedule: string; task: string; timezone?: string; enabled?: boolean }) => {
    return editedCronJobs[idx] !== undefined ? editedCronJobs[idx] : original;
  }, [editedCronJobs]);

  const handleApply = useCallback(async () => {
    // 检查是否有选中的文件
    const filesToApply = request.files.filter(f => selectedFiles[f.fileName]);
    if (filesToApply.length === 0) {
      toast('error', locale.selectAtLeastOne || 'Please select at least one file to apply');
      return;
    }

    setApplying(true);
    try {
      // Apply file changes (only selected files, use edited content if available)
      for (const f of filesToApply) {
        const mode = getFileMode(f.fileName, f.mode);
        const current = mode === 'append' ? (contentCache[f.fileName] || '') : '';
        const blockId = (f as any).blockId;
        const finalContent = getFileContent(f.fileName, f.content);
        const newContent = mode === 'append' 
          ? applyBlockContent(current, finalContent, blockId)
          : finalContent;
        await gwApi.agentFileSet(request.agentId, f.fileName, newContent);
      }

      // Apply advanced features if present (only selected cron jobs with edited content)
      if (request.advancedFeatures) {
        const { cronJobs } = request.advancedFeatures;
        
        // Add cron jobs (only selected ones)
        if (cronJobs && cronJobs.length > 0) {
          for (let idx = 0; idx < cronJobs.length; idx++) {
            if (!selectedCronJobs[idx]) continue; // 跳过未选中的
            const job = getCronJobContent(idx, cronJobs[idx]);
            try {
              await gwApi.cronAdd({
                name: job.name,
                schedule: job.schedule,
                task: job.task,
                enabled: job.enabled ?? true,
                timezone: job.timezone || 'local',
                agentId: request.agentId,
              });
            } catch (e) {
              console.warn(`[FileApplyConfirm] Failed to add cron job "${job.name}":`, e);
            }
          }
        }
      }

      toast('success', locale.applied);
      onDone();
    } catch (err: any) {
      toast('error', err?.message || locale.applyFailed);
    }
    setApplying(false);
  }, [request, contentCache, locale, toast, onDone, applyBlockContent, selectedFiles, getFileContent, selectedCronJobs, getCronJobContent, getFileMode]);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white dark:bg-[#1c1f26] rounded-2xl shadow-2xl border border-slate-200 dark:border-white/10 w-[460px] max-w-[92vw] max-h-[85vh] overflow-hidden animate-scale-in flex flex-col">
        {/* Header */}
        <div className="px-6 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-[22px] text-amber-500">edit_document</span>
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-white">{request.title || locale.title}</h3>
              {request.description && (
                <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{request.description}</p>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 custom-scrollbar space-y-4">
          {/* Affected files */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-500 dark:text-white/40">{locale.affectedFiles}</p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 dark:text-white/30">
                  {selectedCount}/{request.files.length} {locale.selected || 'selected'}
                </span>
                <button
                  onClick={toggleAllFiles}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/[0.05] text-slate-500 dark:text-white/50 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                >
                  {request.files.every(f => selectedFiles[f.fileName]) ? (locale.deselectAll || 'Deselect All') : (locale.selectAll || 'Select All')}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {request.files.map(f => {
                const exists = existsMap[f.fileName];
                const isPreview = previewFile === f.fileName;
                return (
                  <div key={f.fileName} className={`rounded-xl border overflow-hidden transition-all ${
                    selectedFiles[f.fileName] 
                      ? 'border-slate-200/60 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.02]' 
                      : 'border-slate-200/30 dark:border-white/[0.03] bg-slate-100/30 dark:bg-white/[0.01] opacity-60'
                  }`}>
                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                      {/* 复选框 */}
                      <label className="relative flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedFiles[f.fileName] || false}
                          onChange={() => toggleFileSelection(f.fileName)}
                          className="sr-only peer"
                        />
                        <div className="w-4 h-4 rounded border-2 border-slate-300 dark:border-white/20 peer-checked:border-primary peer-checked:bg-primary flex items-center justify-center transition-colors">
                          {selectedFiles[f.fileName] && (
                            <span className="material-symbols-outlined text-[12px] text-white">check</span>
                          )}
                        </div>
                      </label>
                      <span className="material-symbols-outlined text-[16px] text-primary">description</span>
                      <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-white/70 flex-1">{f.fileName}</span>
                      <button
                        onClick={() => toggleFileMode(f.fileName)}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold cursor-pointer hover:opacity-80 transition-opacity flex items-center gap-1 ${getFileMode(f.fileName, f.mode) === 'append' ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-500' : 'bg-amber-100 dark:bg-amber-500/10 text-amber-600'}`}
                        title="Click to toggle mode"
                      >
                        <span className="material-symbols-outlined text-[10px]">{getFileMode(f.fileName, f.mode) === 'append' ? 'add' : 'sync'}</span>
                        {getFileMode(f.fileName, f.mode) === 'append' ? locale.modeAppend : locale.modeReplace}
                      </button>
                      {loaded && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${exists ? 'bg-mac-green/10 text-mac-green' : 'bg-slate-100 dark:bg-white/[0.04] text-slate-400 dark:text-white/40'}`}>
                          {exists ? locale.fileExists : locale.fileNew}
                        </span>
                      )}
                      {editedContent[f.fileName] !== undefined && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-amber-100 dark:bg-amber-500/10 text-amber-600">
                          {locale.fileModified || 'Modified'}
                        </span>
                      )}
                      <button onClick={() => setEditingFile(editingFile === f.fileName ? null : f.fileName)}
                        className="text-[10px] text-slate-400 hover:text-amber-500 transition-colors" title="Edit content">
                        <span className="material-symbols-outlined text-[14px]">edit</span>
                      </button>
                      <button onClick={() => setPreviewFile(isPreview ? null : f.fileName)}
                        className="text-[10px] text-slate-400 hover:text-primary transition-colors">
                        <span className={`material-symbols-outlined text-[14px] transition-transform ${isPreview ? 'rotate-180' : ''}`}>expand_more</span>
                      </button>
                    </div>
                    {/* Edit Mode */}
                    {editingFile === f.fileName && (
                      <div className="border-t border-amber-200/40 dark:border-amber-500/20 px-3 py-2.5 bg-amber-50/50 dark:bg-amber-500/5">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">edit</span>
                            {locale.fileEditTitle || 'Edit Template Content'}
                          </p>
                          <div className="flex gap-1.5">
                            {editedContent[f.fileName] !== undefined && (
                              <button 
                                onClick={() => setEditedContent(prev => { const n = {...prev}; delete n[f.fileName]; return n; })}
                                className="text-[10px] px-2 py-1 rounded-md bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors"
                              >
                                {locale.fileEditReset || 'Reset'}
                              </button>
                            )}
                            <button 
                              onClick={() => setEditingFile(null)}
                              className="text-[10px] px-2 py-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                            >
                              {locale.fileEditDone || 'Done'}
                            </button>
                          </div>
                        </div>
                        <textarea
                          value={getFileContent(f.fileName, f.content)}
                          onChange={(e) => setEditedContent(prev => ({ ...prev, [f.fileName]: e.target.value }))}
                          className="w-full h-48 text-[11px] font-mono leading-relaxed rounded-lg bg-white dark:bg-black/30 border border-amber-200 dark:border-amber-500/30 p-2.5 resize-none focus:ring-2 focus:ring-amber-500/30 outline-none text-slate-700 dark:text-white/80"
                          placeholder={locale.fileEditPlaceholder || 'Edit template content...'}
                        />
                      </div>
                    )}
                    {/* Preview Mode */}
                    {isPreview && editingFile !== f.fileName && (() => {
                      const currentMode = getFileMode(f.fileName, f.mode);
                      return (
                        <div className="border-t border-slate-200/40 dark:border-white/[0.04] px-3 py-2.5">
                          <p className="text-[10px] font-bold text-slate-400 dark:text-white/35 mb-1">{locale.previewContent}</p>
                          <div className="text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto custom-scrollbar rounded-lg bg-slate-50 dark:bg-black/20 p-2.5">
                            {currentMode === 'append' ? (
                              <>
                                {/* 原有内容 */}
                                <div className="text-slate-500 dark:text-white/40 pb-2 border-b border-slate-200 dark:border-white/10 mb-2">
                                  <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400 dark:text-white/30 mb-1">
                                    {locale.existingContent || '原有内容'}
                                  </div>
                                  {contentCache[f.fileName]?.trim() || <span className="italic text-slate-400 dark:text-white/30">{locale.emptyFile || '(空文件)'}</span>}
                                </div>
                                {/* 新增内容 */}
                                <div className="text-blue-600 dark:text-blue-400">
                                  <div className="text-[9px] uppercase tracking-wider font-bold text-blue-500 dark:text-blue-400 mb-1">
                                    {locale.newContent || '新增内容'}
                                  </div>
                                  {getFileContent(f.fileName, f.content).trim()}
                                </div>
                              </>
                            ) : (
                              <div className="text-amber-600 dark:text-amber-400">
                                <div className="text-[9px] uppercase tracking-wider font-bold text-amber-500 dark:text-amber-400 mb-1">
                                  {locale.modeReplace || '覆盖内容'}
                                </div>
                                {getFileContent(f.fileName, f.content).trim()}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Advanced Features - Cron Jobs */}
          {request.advancedFeatures?.cronJobs && request.advancedFeatures.cronJobs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-slate-500 dark:text-white/40 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  {locale.cronJobs || 'Cron Jobs'}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 dark:text-white/30">
                    {selectedCronCount}/{request.advancedFeatures.cronJobs.length} {locale.selected || 'selected'}
                  </span>
                  <button
                    onClick={toggleAllCronJobs}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-100 dark:bg-white/[0.05] text-slate-500 dark:text-white/50 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors"
                  >
                    {request.advancedFeatures.cronJobs.every((_, idx) => selectedCronJobs[idx]) ? (locale.deselectAll || 'Deselect All') : (locale.selectAll || 'Select All')}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {request.advancedFeatures.cronJobs.map((job, idx) => {
                  const currentJob = getCronJobContent(idx, job);
                  const isEditing = editingCronJob === idx;
                  const isModified = editedCronJobs[idx] !== undefined;
                  return (
                    <div key={idx} className={`rounded-xl border overflow-hidden transition-all ${
                      selectedCronJobs[idx]
                        ? 'border-purple-200/60 dark:border-purple-500/20 bg-purple-50/50 dark:bg-purple-500/5'
                        : 'border-slate-200/30 dark:border-white/[0.03] bg-slate-100/30 dark:bg-white/[0.01] opacity-60'
                    }`}>
                      <div className="flex items-center gap-2.5 px-3 py-2.5">
                        {/* 复选框 */}
                        <label className="relative flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedCronJobs[idx] || false}
                            onChange={() => toggleCronJobSelection(idx)}
                            className="sr-only peer"
                          />
                          <div className="w-4 h-4 rounded border-2 border-slate-300 dark:border-white/20 peer-checked:border-purple-500 peer-checked:bg-purple-500 flex items-center justify-center transition-colors">
                            {selectedCronJobs[idx] && (
                              <span className="material-symbols-outlined text-[12px] text-white">check</span>
                            )}
                          </div>
                        </label>
                        <span className="material-symbols-outlined text-[16px] text-purple-500">timer</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[11px] font-bold text-purple-700 dark:text-purple-300">{currentJob.name}</span>
                          <span className="text-[10px] text-purple-500 dark:text-purple-400 ml-2 font-mono">{currentJob.schedule}</span>
                        </div>
                        {isModified && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-amber-100 dark:bg-amber-500/10 text-amber-600">
                            {locale.cronModified || 'Modified'}
                          </span>
                        )}
                        <button 
                          onClick={() => setEditingCronJob(isEditing ? null : idx)}
                          className="text-[10px] text-slate-400 hover:text-purple-500 transition-colors" 
                          title="Edit cron job"
                        >
                          <span className="material-symbols-outlined text-[14px]">edit</span>
                        </button>
                      </div>
                      {/* Edit Mode */}
                      {isEditing && (
                        <div className="border-t border-purple-200/40 dark:border-purple-500/20 px-3 py-2.5 bg-purple-50/50 dark:bg-purple-500/5">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">edit</span>
                              {locale.cronEditTitle || 'Edit Cron Job'}
                            </p>
                            <div className="flex gap-1.5">
                              {isModified && (
                                <button 
                                  onClick={() => setEditedCronJobs(prev => { const n = {...prev}; delete n[idx]; return n; })}
                                  className="text-[10px] px-2 py-1 rounded-md bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors"
                                >
                                  {locale.cronReset || 'Reset'}
                                </button>
                              )}
                              <button 
                                onClick={() => setEditingCronJob(null)}
                                className="text-[10px] px-2 py-1 rounded-md bg-purple-500 text-white hover:bg-purple-600 transition-colors"
                              >
                                {locale.cronDone || 'Done'}
                              </button>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="text-[9px] text-purple-600 dark:text-purple-400 font-bold mb-0.5 block">{locale.cronName || 'Name'}</label>
                                <input
                                  type="text"
                                  value={currentJob.name}
                                  onChange={(e) => setEditedCronJobs(prev => ({ ...prev, [idx]: { ...currentJob, name: e.target.value } }))}
                                  className="w-full h-7 px-2 text-[11px] font-mono rounded-md bg-white dark:bg-black/30 border border-purple-200 dark:border-purple-500/30 text-slate-700 dark:text-white/80 focus:ring-2 focus:ring-purple-500/30 outline-none"
                                />
                              </div>
                              <div className="flex-1">
                                <label className="text-[9px] text-purple-600 dark:text-purple-400 font-bold mb-0.5 block">{locale.cronSchedule || 'Schedule'}</label>
                                <input
                                  type="text"
                                  value={currentJob.schedule}
                                  onChange={(e) => setEditedCronJobs(prev => ({ ...prev, [idx]: { ...currentJob, schedule: e.target.value } }))}
                                  className="w-full h-7 px-2 text-[11px] font-mono rounded-md bg-white dark:bg-black/30 border border-purple-200 dark:border-purple-500/30 text-slate-700 dark:text-white/80 focus:ring-2 focus:ring-purple-500/30 outline-none"
                                  placeholder="*/5 * * * *"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-[9px] text-purple-600 dark:text-purple-400 font-bold mb-0.5 block">{locale.cronTask || 'Task'}</label>
                              <textarea
                                value={currentJob.task}
                                onChange={(e) => setEditedCronJobs(prev => ({ ...prev, [idx]: { ...currentJob, task: e.target.value } }))}
                                className="w-full h-20 px-2 py-1.5 text-[11px] font-mono rounded-md bg-white dark:bg-black/30 border border-purple-200 dark:border-purple-500/30 text-slate-700 dark:text-white/80 focus:ring-2 focus:ring-purple-500/30 outline-none resize-none"
                                placeholder="Task description..."
                              />
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="text-[9px] text-purple-600 dark:text-purple-400 font-bold mb-0.5 block">{locale.cronTimezone || 'Timezone'}</label>
                                <input
                                  type="text"
                                  value={currentJob.timezone || 'local'}
                                  onChange={(e) => setEditedCronJobs(prev => ({ ...prev, [idx]: { ...currentJob, timezone: e.target.value } }))}
                                  className="w-full h-7 px-2 text-[11px] font-mono rounded-md bg-white dark:bg-black/30 border border-purple-200 dark:border-purple-500/30 text-slate-700 dark:text-white/80 focus:ring-2 focus:ring-purple-500/30 outline-none"
                                  placeholder="local"
                                />
                              </div>
                              <div className="flex items-end pb-0.5">
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={currentJob.enabled ?? true}
                                    onChange={(e) => setEditedCronJobs(prev => ({ ...prev, [idx]: { ...currentJob, enabled: e.target.checked } }))}
                                    className="w-4 h-4 rounded border-purple-300 text-purple-500 focus:ring-purple-500"
                                  />
                                  <span className="text-[10px] text-purple-600 dark:text-purple-400 font-bold">{locale.cronEnabled || 'Enabled'}</span>
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {request.advancedFeatures?.skills && request.advancedFeatures.skills.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-500 dark:text-white/40 mb-2 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">extension</span>
                {locale.requiredSkills || 'Required Skills'} ({request.advancedFeatures.skills.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {request.advancedFeatures.skills.map((skill, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-500/10 text-[10px] text-blue-600 dark:text-blue-400 font-medium border border-blue-200/50 dark:border-blue-500/20">
                    <span className="material-symbols-outlined text-[12px]">extension</span>
                    {skill.name}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-5 pt-2 shrink-0 border-t border-slate-100 dark:border-white/[0.04]">
          <button onClick={onCancel} disabled={applying}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-600 dark:text-white/60 rounded-xl text-sm font-medium transition-colors disabled:opacity-40">
            {locale.cancel}
          </button>
          <button onClick={handleApply} disabled={applying || !loaded}
            className="flex-1 py-2.5 bg-primary hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
            {applying && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
            {applying ? locale.applying : locale.confirm}
          </button>
        </div>
      </div>
    </div>
  );
};
