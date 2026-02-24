import React, { useState, useCallback } from 'react';
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
    backupToggle: string;
    backupHint: string;
    confirm: string;
    cancel: string;
    applying: string;
    applied: string;
    backupCreated: string;
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

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      for (const f of request.files) {
        // Use cached content for append mode (already fetched on mount)
        const current = f.mode === 'append' ? (contentCache[f.fileName] || '') : '';
        const newContent = f.mode === 'append' ? current + f.content : f.content;
        await gwApi.agentFileSet(request.agentId, f.fileName, newContent);
      }
      toast('success', locale.applied);
      onDone();
    } catch (err: any) {
      toast('error', err?.message || 'Apply failed');
    }
    setApplying(false);
  }, [request, contentCache, locale, toast, onDone]);

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
            <p className="text-[10px] font-bold text-slate-500 dark:text-white/40 mb-2">{locale.affectedFiles}</p>
            <div className="space-y-2">
              {request.files.map(f => {
                const exists = existsMap[f.fileName];
                const isPreview = previewFile === f.fileName;
                return (
                  <div key={f.fileName} className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.02] overflow-hidden">
                    <div className="flex items-center gap-2.5 px-3 py-2.5">
                      <span className="material-symbols-outlined text-[16px] text-primary">description</span>
                      <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-white/70 flex-1">{f.fileName}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${f.mode === 'append' ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-500' : 'bg-amber-100 dark:bg-amber-500/10 text-amber-600'}`}>
                        {f.mode === 'append' ? locale.modeAppend : locale.modeReplace}
                      </span>
                      {loaded && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${exists ? 'bg-mac-green/10 text-mac-green' : 'bg-slate-100 dark:bg-white/[0.04] text-slate-400 dark:text-white/40'}`}>
                          {exists ? locale.fileExists : locale.fileNew}
                        </span>
                      )}
                      <button onClick={() => setPreviewFile(isPreview ? null : f.fileName)}
                        className="text-[10px] text-slate-400 hover:text-primary transition-colors">
                        <span className={`material-symbols-outlined text-[14px] transition-transform ${isPreview ? 'rotate-180' : ''}`}>expand_more</span>
                      </button>
                    </div>
                    {isPreview && (
                      <div className="border-t border-slate-200/40 dark:border-white/[0.04] px-3 py-2.5">
                        <p className="text-[10px] font-bold text-slate-400 dark:text-white/35 mb-1">{locale.previewContent}</p>
                        <pre className="text-[11px] font-mono text-slate-600 dark:text-white/50 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto custom-scrollbar">{f.content.trim()}</pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

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
