import { useState, useCallback, useRef, useEffect } from 'react';
import { configApi, gwApi } from '../../services/api';

export type ConfigMode = 'local' | 'remote';

export interface ValidationError {
  path: string[];
  message: string;
}

export interface UseConfigEditorReturn {
  config: Record<string, any> | null;
  schema: Record<string, any> | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  mode: ConfigMode;
  setMode: (m: ConfigMode) => void;
  errors: ValidationError[];
  /** Flat map of dotted-path → error message for field-level display */
  fieldErrors: Record<string, string>;
  configPath: string;

  load: () => Promise<void>;
  save: () => Promise<boolean>;
  reload: () => Promise<void>;

  getField: (path: string[]) => any;
  setField: (path: string[], value: any) => void;
  deleteField: (path: string[]) => void;
  appendToArray: (path: string[], value: any) => void;
  removeFromArray: (path: string[], index: number) => void;

  toJSON: () => string;
  fromJSON: (json: string) => boolean;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  saveError: string;
  loadError: string;
  loadErrorCode: string;
}

function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

function getNestedValue(obj: any, path: string[]): any {
  let current = obj;
  for (const key of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function setNestedValue(obj: any, path: string[], value: any): any {
  if (path.length === 0) return value;
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  const [head, ...rest] = path;
  if (rest.length === 0) {
    result[head] = value;
  } else {
    const child = result[head] ?? (isNaN(Number(rest[0])) ? {} : []);
    result[head] = setNestedValue(child, rest, value);
  }
  return result;
}

function deleteNestedValue(obj: any, path: string[]): any {
  if (path.length === 0) return obj;
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  if (path.length === 1) {
    if (Array.isArray(result)) {
      result.splice(Number(path[0]), 1);
    } else {
      delete result[path[0]];
    }
    return result;
  }
  const [head, ...rest] = path;
  if (result[head] != null && typeof result[head] === 'object') {
    result[head] = deleteNestedValue(result[head], rest);
  }
  return result;
}

const MAX_HISTORY = 50;

type JsonPatch = { path: string[]; prev: any; next: any }[];

function computePatch(prev: any, next: any, path: string[] = []): JsonPatch {
  const ops: JsonPatch = [];
  if (prev === next) return ops;
  if (prev == null || next == null || typeof prev !== 'object' || typeof next !== 'object' || Array.isArray(prev) !== Array.isArray(next)) {
    ops.push({ path, prev: structuredClone(prev), next: structuredClone(next) });
    return ops;
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      ops.push({ path, prev: structuredClone(prev), next: structuredClone(next) });
    }
    return ops;
  }
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of allKeys) {
    ops.push(...computePatch(prev[key], next[key], [...path, key]));
  }
  return ops;
}

function applyPatch(base: Record<string, any>, patch: JsonPatch, direction: 'forward' | 'backward'): Record<string, any> {
  let result = structuredClone(base);
  for (const op of patch) {
    const value = direction === 'forward' ? op.next : op.prev;
    if (op.path.length === 0) {
      result = structuredClone(value);
    } else {
      result = setNestedValue(result, op.path, value === undefined ? undefined : structuredClone(value));
      if (value === undefined) {
        result = deleteNestedValue(result, op.path);
      }
    }
  }
  return result;
}

export function useConfigEditor(): UseConfigEditorReturn {
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [schema, setSchema] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mode, setModeState] = useState<ConfigMode>('remote');
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [configPath, setConfigPath] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadErrorCode, setLoadErrorCode] = useState('');
  const baseHashRef = useRef<string | null>(null);

  // undo/redo history — stores patches (diffs) instead of full snapshots
  const patchHistoryRef = useRef<JsonPatch[]>([]);
  const historyIndexRef = useRef(-1);
  const prevConfigRef = useRef<Record<string, any> | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushHistory = useCallback((cfg: Record<string, any>) => {
    const prev = prevConfigRef.current;
    if (!prev) {
      prevConfigRef.current = structuredClone(cfg);
      return;
    }
    const patch = computePatch(prev, cfg);
    if (patch.length === 0) return;
    const idx = historyIndexRef.current;
    // truncate forward history
    patchHistoryRef.current = patchHistoryRef.current.slice(0, idx + 1);
    patchHistoryRef.current.push(patch);
    if (patchHistoryRef.current.length > MAX_HISTORY) {
      patchHistoryRef.current.shift();
    }
    historyIndexRef.current = patchHistoryRef.current.length - 1;
    prevConfigRef.current = structuredClone(cfg);
    setCanUndo(historyIndexRef.current >= 0);
    setCanRedo(false);
  }, []);

  const setMode = useCallback((m: ConfigMode) => {
    setModeState(m);
    setConfig(null);
    setDirty(false);
    setErrors([]);
    setSaveError('');
    setLoadError('');
    patchHistoryRef.current = [];
    historyIndexRef.current = -1;
    prevConfigRef.current = null;
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  // extract config object from API response
  const extractConfig = useCallback((data: any): Record<string, any> | null => {
    if (!data) return null;
    // local mode: { config: {...}, path: "...", parsed: true }
    if (data.config && typeof data.config === 'object') return data.config;
    // remote mode: { parsed: {...} } or direct object
    if (data.parsed && typeof data.parsed === 'object') return data.parsed;
    // direct config object
    if (typeof data === 'object' && !Array.isArray(data)) return data;
    return null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setLoadErrorCode('');
    baseHashRef.current = null;
    try {
      let data: any;
      // 统一优先走 WebSocket（本地/远程网关均适用），失败时降级读本地文件
      try {
        data = await gwApi.configGet();
        if (data?.hash) baseHashRef.current = data.hash;
        gwApi.configSchema().then((s: any) => setSchema(s)).catch(() => {});
      } catch {
        // WS 不可用（网关未连接），降级读本地文件
        if (mode === 'local') {
          data = await configApi.get();
          if (data?.path) setConfigPath(data.path);
        } else {
          throw new Error('Gateway not connected');
        }
      }
      const cfg = extractConfig(data);
      if (cfg) {
        setConfig(cfg);
        setDirty(false);
        setErrors([]);
        patchHistoryRef.current = [];
        historyIndexRef.current = -1;
        prevConfigRef.current = structuredClone(cfg);
        setCanUndo(false);
        setCanRedo(false);
      } else {
        setLoadError('Failed to parse config data');
      }
    } catch (e: any) {
      setLoadError(e?.message || 'Failed to load config');
      setLoadErrorCode(e?.code || '');
    } finally {
      setLoading(false);
    }
  }, [mode, extractConfig]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!config) return false;
    setSaving(true);
    setSaveError('');
    try {
      const raw = JSON.stringify(config, null, 2);
      // 统一优先走 WebSocket 保存（本地/远程网关均适用）
      if (baseHashRef.current) {
        // 有 hash → 用 configApply（原子写入+重载）
        const res: any = await gwApi.configApply(raw, baseHashRef.current);
        if (res?.config) setConfig(res.config);
        const freshData: any = await gwApi.configGet().catch(() => null);
        if (freshData?.hash) baseHashRef.current = freshData.hash;
      } else {
        // 无 hash → 尝试 configSetAll + reload，失败时降级本地写入
        try {
          await gwApi.configSetAll(config);
          await gwApi.configReload().catch(() => {});
          // 刷新 hash 以便后续保存走 configApply
          const freshData: any = await gwApi.configGet().catch(() => null);
          if (freshData?.hash) baseHashRef.current = freshData.hash;
        } catch {
          // WS 不可用，降级本地写入
          if (mode === 'local') {
            await configApi.update(config);
            await gwApi.configReload().catch(() => {});
          } else {
            throw new Error('Gateway not connected');
          }
        }
      }
      setDirty(false);
      return true;
    } catch (e: any) {
      const msg = e?.message || 'Failed to save config';
      setSaveError(msg);
      // Parse field-level validation issues from backend error response
      const issues: any[] = e?.details?.issues || e?.issues || [];
      if (issues.length > 0) {
        const errs: ValidationError[] = issues.map((i: any) => ({
          path: typeof i.path === 'string' ? i.path.split('.') : (i.path || []),
          message: i.message || 'Invalid value',
        }));
        setErrors(errs);
        const fe: Record<string, string> = {};
        for (const err of errs) {
          fe[err.path.join('.')] = err.message;
        }
        setFieldErrors(fe);
      }
      return false;
    } finally {
      setSaving(false);
    }
  }, [config, mode]);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  const updateConfig = useCallback((updater: (cfg: Record<string, any>) => Record<string, any>) => {
    setConfig(prev => {
      if (!prev) return prev;
      const next = updater(deepClone(prev));
      setDirty(true);
      pushHistory(next);
      setFieldErrors({});
      setErrors([]);
      return next;
    });
  }, [pushHistory]);

  const getField = useCallback((path: string[]): any => {
    if (!config) return undefined;
    return getNestedValue(config, path);
  }, [config]);

  const setField = useCallback((path: string[], value: any) => {
    updateConfig(cfg => setNestedValue(cfg, path, value));
  }, [updateConfig]);

  const deleteField = useCallback((path: string[]) => {
    updateConfig(cfg => deleteNestedValue(cfg, path));
  }, [updateConfig]);

  const appendToArray = useCallback((path: string[], value: any) => {
    updateConfig(cfg => {
      const arr = getNestedValue(cfg, path);
      const newArr = Array.isArray(arr) ? [...arr, value] : [value];
      return setNestedValue(cfg, path, newArr);
    });
  }, [updateConfig]);

  const removeFromArray = useCallback((path: string[], index: number) => {
    updateConfig(cfg => {
      const arr = getNestedValue(cfg, path);
      if (!Array.isArray(arr)) return cfg;
      const newArr = arr.filter((_, i) => i !== index);
      return setNestedValue(cfg, path, newArr);
    });
  }, [updateConfig]);

  const toJSON = useCallback((): string => {
    return config ? JSON.stringify(config, null, 2) : '';
  }, [config]);

  const fromJSON = useCallback((json: string): boolean => {
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) return false;
      setConfig(parsed);
      setDirty(true);
      pushHistory(parsed);
      setErrors([]);
      return true;
    } catch {
      return false;
    }
  }, [pushHistory]);

  const undo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx < 0) return;
    setConfig(prev => {
      if (!prev) return prev;
      const patch = patchHistoryRef.current[idx];
      const cfg = applyPatch(prev, patch, 'backward');
      prevConfigRef.current = structuredClone(cfg);
      return cfg;
    });
    historyIndexRef.current = idx - 1;
    setDirty(true);
    setCanUndo(idx - 1 >= 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx >= patchHistoryRef.current.length - 1) return;
    const nextIdx = idx + 1;
    setConfig(prev => {
      if (!prev) return prev;
      const patch = patchHistoryRef.current[nextIdx];
      const cfg = applyPatch(prev, patch, 'forward');
      prevConfigRef.current = structuredClone(cfg);
      return cfg;
    });
    historyIndexRef.current = nextIdx;
    setDirty(true);
    setCanUndo(true);
    setCanRedo(nextIdx < patchHistoryRef.current.length - 1);
  }, []);

  // initial load
  useEffect(() => {
    load();
  }, [mode]);

  return {
    config, schema, loading, saving, dirty, mode, setMode, errors, fieldErrors, configPath,
    load, save, reload,
    getField, setField, deleteField, appendToArray, removeFromArray,
    toJSON, fromJSON,
    undo, redo, canUndo, canRedo,
    saveError, loadError, loadErrorCode,
  };
}
