import React, { useMemo } from 'react';

interface DiffEntry {
  path: string;
  oldValue: any;
  newValue: any;
  type: 'added' | 'removed' | 'changed';
}

interface ConfigDiffViewProps {
  original: Record<string, any>;
  modified: Record<string, any>;
  onConfirm: () => void;
  onCancel: () => void;
  saving?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  title?: string;
}

function flattenObject(obj: any, prefix = ''): Record<string, any> {
  const result: Record<string, any> = {};
  if (obj == null || typeof obj !== 'object') {
    return { [prefix || '(root)']: obj };
  }
  if (Array.isArray(obj)) {
    result[prefix] = obj;
    return result;
  }
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

function computeDiff(original: Record<string, any>, modified: Record<string, any>): DiffEntry[] {
  const flatOrig = flattenObject(original);
  const flatMod = flattenObject(modified);
  const allKeys = new Set([...Object.keys(flatOrig), ...Object.keys(flatMod)]);
  const diffs: DiffEntry[] = [];

  for (const key of allKeys) {
    const hasOrig = key in flatOrig;
    const hasMod = key in flatMod;
    const origStr = JSON.stringify(flatOrig[key]);
    const modStr = JSON.stringify(flatMod[key]);

    if (!hasOrig && hasMod) {
      diffs.push({ path: key, oldValue: undefined, newValue: flatMod[key], type: 'added' });
    } else if (hasOrig && !hasMod) {
      diffs.push({ path: key, oldValue: flatOrig[key], newValue: undefined, type: 'removed' });
    } else if (origStr !== modStr) {
      diffs.push({ path: key, oldValue: flatOrig[key], newValue: flatMod[key], type: 'changed' });
    }
  }

  return diffs.sort((a, b) => a.path.localeCompare(b.path));
}

function formatValue(val: any): string {
  if (val === undefined) return '(undefined)';
  if (val === null) return 'null';
  if (typeof val === 'string') return val.length > 80 ? `"${val.slice(0, 80)}..."` : `"${val}"`;
  if (typeof val === 'object') return JSON.stringify(val).slice(0, 100);
  return String(val);
}

const ConfigDiffView: React.FC<ConfigDiffViewProps> = ({
  original, modified, onConfirm, onCancel, saving,
  confirmLabel = 'Save', cancelLabel = 'Cancel', title = 'Review Changes',
}) => {
  const diffs = useMemo(() => computeDiff(original, modified), [original, modified]);

  const added = diffs.filter(d => d.type === 'added');
  const removed = diffs.filter(d => d.type === 'removed');
  const changed = diffs.filter(d => d.type === 'changed');

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-[560px] max-h-[80vh] bg-white dark:bg-[#1e1e22] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scale-in">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-primary">difference</span>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">{title}</h3>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            {changed.length > 0 && <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/10 text-amber-600 font-bold">{changed.length} changed</span>}
            {added.length > 0 && <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 font-bold">{added.length} added</span>}
            {removed.length > 0 && <span className="px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-500/10 text-red-600 font-bold">{removed.length} removed</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5 custom-scrollbar">
          {diffs.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-3xl mb-2">check_circle</span>
              <p className="text-[12px]">No changes detected</p>
            </div>
          ) : (
            diffs.map(d => (
              <div key={d.path} className={`rounded-lg border px-3 py-2 ${
                d.type === 'added' ? 'border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-500/5' :
                d.type === 'removed' ? 'border-red-200 dark:border-red-500/20 bg-red-50/50 dark:bg-red-500/5' :
                'border-amber-200 dark:border-amber-500/20 bg-amber-50/50 dark:bg-amber-500/5'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`material-symbols-outlined text-[12px] ${
                    d.type === 'added' ? 'text-emerald-500' : d.type === 'removed' ? 'text-red-500' : 'text-amber-500'
                  }`}>
                    {d.type === 'added' ? 'add_circle' : d.type === 'removed' ? 'remove_circle' : 'edit'}
                  </span>
                  <span className="text-[11px] font-mono font-bold text-slate-700 dark:text-white/70">{d.path}</span>
                </div>
                {d.type === 'changed' && (
                  <div className="ml-5 text-[10px] font-mono space-y-0.5">
                    <div className="text-red-500/80 line-through">{formatValue(d.oldValue)}</div>
                    <div className="text-emerald-600 dark:text-emerald-400">{formatValue(d.newValue)}</div>
                  </div>
                )}
                {d.type === 'added' && (
                  <div className="ml-5 text-[10px] font-mono text-emerald-600 dark:text-emerald-400">{formatValue(d.newValue)}</div>
                )}
                {d.type === 'removed' && (
                  <div className="ml-5 text-[10px] font-mono text-red-500/80 line-through">{formatValue(d.oldValue)}</div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onCancel} className="px-4 py-2 text-[12px] font-medium text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} disabled={saving || diffs.length === 0}
            className="px-4 py-2 bg-primary text-white text-[12px] font-bold rounded-lg hover:opacity-90 disabled:opacity-40 transition-all flex items-center gap-1.5">
            <span className={`material-symbols-outlined text-[14px] ${saving ? 'animate-spin' : ''}`}>{saving ? 'progress_activity' : 'save'}</span>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfigDiffView;
