import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Language } from '../../../types';
import { getTranslation } from '../../../locales';
import { gwApi } from '../../../services/api';
import SchemaField from '../../../components/SchemaField';
import type { UiHints } from '../../../components/SchemaField';
import { extractSchemaKeys, getUnmappedKeys, SCHEMA_KEYS_STORAGE_KEY } from '../sectionRegistry';

interface UnmappedConfigSectionProps {
  language: Language;
  config: Record<string, any> | null;
  setField: (path: string[], value: any) => void;
  onNewKeysCount?: (count: number) => void;
}

interface GroupedKeys {
  prefix: string;
  label: string;
  keys: string[];
  schema: any;
}

function getNestedSchema(rootSchema: any, dottedPath: string): any {
  const parts = dottedPath.split('.');
  let node = rootSchema;
  for (const p of parts) {
    node = node?.properties?.[p];
    if (!node) return null;
  }
  return node;
}

function getNestedValue(obj: any, path: string[]): any {
  let curr = obj;
  for (const p of path) {
    if (curr == null || typeof curr !== 'object') return undefined;
    curr = curr[p];
  }
  return curr;
}

export const UnmappedConfigSection: React.FC<UnmappedConfigSectionProps> = ({
  language, config, setField, onNewKeysCount,
}) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const ed = useMemo(() => (t as any).cfgEditor || {}, [t]);

  const [schema, setSchema] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newKeys, setNewKeys] = useState<string[]>([]);

  const loadSchema = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await gwApi.configSchema() as any;
      setSchema(res);
    } catch (e: any) {
      setError(e?.message || 'Failed to load schema');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSchema();
  }, [loadSchema]);

  const schemaObj = schema?.schema || schema;
  const hints: UiHints = schema?.uiHints || {};

  const unmappedGroups: GroupedKeys[] = useMemo(() => {
    if (!schemaObj?.properties) return [];
    const allKeys = extractSchemaKeys(schemaObj);
    const unmapped = getUnmappedKeys(allKeys);
    if (unmapped.length === 0) return [];

    // Group by top-level key
    const groupMap = new Map<string, string[]>();
    for (const key of unmapped) {
      const prefix = key.split('.')[0];
      if (!groupMap.has(prefix)) groupMap.set(prefix, []);
      groupMap.get(prefix)!.push(key);
    }

    return Array.from(groupMap.entries()).map(([prefix, keys]) => ({
      prefix,
      label: hints[prefix]?.label || prefix,
      keys,
      schema: getNestedSchema(schemaObj, prefix),
    }));
  }, [schemaObj, hints]);

  // Detect newly added keys vs last known schema
  useEffect(() => {
    if (!schemaObj?.properties) return;
    const allKeys = extractSchemaKeys(schemaObj);
    const currentKeySet = new Set(allKeys);

    try {
      const stored = window.localStorage.getItem(SCHEMA_KEYS_STORAGE_KEY);
      if (stored) {
        const prevKeys: string[] = JSON.parse(stored);
        const prevSet = new Set(prevKeys);
        const added = allKeys.filter(k => !prevSet.has(k));
        setNewKeys(added);
        onNewKeysCount?.(added.length);
      } else {
        setNewKeys([]);
        onNewKeysCount?.(0);
      }
      // Always update stored keys
      window.localStorage.setItem(SCHEMA_KEYS_STORAGE_KEY, JSON.stringify(allKeys));
    } catch { /* ignore */ }
  }, [schemaObj, onNewKeysCount]);

  const totalUnmapped = unmappedGroups.reduce((sum, g) => sum + g.keys.length, 0);

  if (loading) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/10 p-6 flex items-center justify-center">
        <span className="material-symbols-outlined text-[18px] text-slate-400 animate-spin mr-2">progress_activity</span>
        <span className="text-[11px] text-slate-400">{ed.loading || 'Loading schema...'}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-dashed border-red-300 dark:border-red-500/20 p-4 flex items-center gap-2">
        <span className="material-symbols-outlined text-[16px] text-red-500">error</span>
        <span className="text-[11px] text-red-500">{error}</span>
        <button onClick={loadSchema} className="ml-auto text-[10px] text-primary font-bold hover:opacity-80">
          {ed.retry || 'Retry'}
        </button>
      </div>
    );
  }

  if (totalUnmapped === 0) return null;

  const newKeySet = new Set(newKeys);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-amber-500">new_releases</span>
            <h3 className="text-[12px] font-bold text-slate-700 dark:text-white/70">
              {ed.unmappedTitle || 'Additional Config'}
            </h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">
              {totalUnmapped}
            </span>
          </div>
          <button onClick={loadSchema} className="text-[10px] text-slate-400 hover:text-primary transition-colors flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">refresh</span>
            {ed.refresh || 'Refresh'}
          </button>
        </div>

        <div className="px-4 py-2 bg-amber-50/50 dark:bg-amber-500/[0.03] border-b border-amber-100 dark:border-amber-500/10">
          <p className="text-[10px] text-amber-700 dark:text-amber-300/70 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[12px]">info</span>
            {ed.unmappedHint || 'These config keys are available in your OpenClaw version but don\'t have dedicated UI yet. They are auto-generated from the schema.'}
          </p>
        </div>

        <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar">
          {unmappedGroups.map(group => (
            <details key={group.prefix} className="group">
              <summary className="flex items-center gap-2 cursor-pointer select-none py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                <span className="material-symbols-outlined text-[14px] text-slate-400 group-open:rotate-90 transition-transform">chevron_right</span>
                <span className="text-[12px] font-bold text-slate-700 dark:text-white/70">{group.label}</span>
                <span className="text-[9px] px-1 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-white/40 font-bold">{group.keys.length}</span>
                {group.keys.some(k => newKeySet.has(k)) && (
                  <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold uppercase">NEW</span>
                )}
              </summary>
              <div className="ml-4 mt-1 pl-2 border-l-2 border-slate-200 dark:border-white/10 space-y-1">
                {group.keys.map(key => {
                  const keySchema = getNestedSchema(schemaObj, key);
                  if (!keySchema) return null;
                  const pathArr = key.split('.');
                  const val = getNestedValue(config, pathArr);
                  const isNew = newKeySet.has(key);
                  return (
                    <div key={key} className="relative">
                      {isNew && (
                        <span className="absolute -left-6 top-2 text-[7px] px-1 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold uppercase leading-none">NEW</span>
                      )}
                      <SchemaField
                        path={key}
                        schema={keySchema}
                        uiHints={hints}
                        value={val}
                        onChange={(p, v) => setField(p, v)}
                      />
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
};
