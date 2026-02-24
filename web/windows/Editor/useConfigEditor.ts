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
  return JSON.parse(JSON.stringify(obj));
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

export function useConfigEditor(): UseConfigEditorReturn {
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [schema, setSchema] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mode, setModeState] = useState<ConfigMode>('remote');
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [configPath, setConfigPath] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loadErrorCode, setLoadErrorCode] = useState('');
  const baseHashRef = useRef<string | null>(null);

  // undo/redo history
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushHistory = useCallback((cfg: Record<string, any>) => {
    const json = JSON.stringify(cfg);
    const idx = historyIndexRef.current;
    // truncate forward history
    historyRef.current = historyRef.current.slice(0, idx + 1);
    historyRef.current.push(json);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
    historyIndexRef.current = historyRef.current.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, []);

  const setMode = useCallback((m: ConfigMode) => {
    setModeState(m);
    setConfig(null);
    setDirty(false);
    setErrors([]);
    setSaveError('');
    setLoadError('');
    historyRef.current = [];
    historyIndexRef.current = -1;
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
        historyRef.current = [JSON.stringify(cfg)];
        historyIndexRef.current = 0;
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
      setSaveError(e?.message || 'Failed to save config');
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
    if (idx <= 0) return;
    historyIndexRef.current = idx - 1;
    const cfg = JSON.parse(historyRef.current[idx - 1]);
    setConfig(cfg);
    setDirty(true);
    setCanUndo(idx - 1 > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    const idx = historyIndexRef.current;
    if (idx >= historyRef.current.length - 1) return;
    historyIndexRef.current = idx + 1;
    const cfg = JSON.parse(historyRef.current[idx + 1]);
    setConfig(cfg);
    setDirty(true);
    setCanUndo(true);
    setCanRedo(idx + 1 < historyRef.current.length - 1);
  }, []);

  // initial load
  useEffect(() => {
    load();
  }, [mode]);

  return {
    config, schema, loading, saving, dirty, mode, setMode, errors, configPath,
    load, save, reload,
    getField, setField, deleteField, appendToArray, removeFromArray,
    toJSON, fromJSON,
    undo, redo, canUndo, canRedo,
    saveError, loadError, loadErrorCode,
  };
}
