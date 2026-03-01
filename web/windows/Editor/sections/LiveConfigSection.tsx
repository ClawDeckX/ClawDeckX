import React, { useMemo, useState, useCallback } from 'react';
import { Language } from '../../../types';
import { getTranslation } from '../../../locales';
import { gwApi } from '../../../services/api';
import { SchemaSection } from '../../../components/SchemaField';
import type { UiHints } from '../../../components/SchemaField';

interface LiveConfigSectionProps {
  language: Language;
}

export const LiveConfigSection: React.FC<LiveConfigSectionProps> = ({ language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const ed = useMemo(() => (getTranslation(language) as any).cfgEditor || {}, [language]);

  // Config raw editor state
  const [rawText, setRawText] = useState('');
  const [baseHash, setBaseHash] = useState('');
  const [schema, setSchema] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState('');
  const [configResult, setConfigResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Config.set single key
  const [setKey, setSetKey] = useState('');
  const [setVal, setSetVal] = useState('');
  const [setSending, setSetSending] = useState(false);
  const [setResult, setSetResult] = useState<{ ok: boolean; text: string } | null>(null);



  // Wizard state
  const [wizardSessionId, setWizardSessionId] = useState('');
  const [wizardStep, setWizardStep] = useState<any>(null);
  const [wizardInput, setWizardInput] = useState('');
  const [wizardLoading, setWizardLoading] = useState(false);
  const [wizardError, setWizardError] = useState('');

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError('');
    try {
      const res = await gwApi.configGet() as any;
      setRawText(typeof res?.raw === 'string' ? res.raw : JSON.stringify(res?.config || res, null, 2));
      setBaseHash(res?.hash || res?.baseHash || '');
    } catch (err: any) {
      setConfigError(err?.message || es.fetchFailed);
    }
    setConfigLoading(false);
  }, [es]);

  const loadSchema = useCallback(async () => {
    try {
      const res = await gwApi.configSchema() as any;
      setSchema(res);
    } catch { /* ignore */ }
  }, [es]);

  const handleApply = useCallback(async () => {
    if (!rawText.trim()) return;
    setConfigResult(null);
    try {
      await gwApi.configApply(rawText, baseHash);
      setConfigResult({ ok: true, text: es.configApplyOk });
      setTimeout(() => setConfigResult(null), 3000);
      loadConfig();
    } catch (err: any) {
      setConfigResult({ ok: false, text: `${es.configApplyFailed}: ${err?.message || ''}` });
    }
  }, [rawText, baseHash, es, loadConfig]);

  const handlePatch = useCallback(async () => {
    if (!rawText.trim()) return;
    setConfigResult(null);
    try {
      await gwApi.configPatch(rawText, baseHash);
      setConfigResult({ ok: true, text: es.configPatchOk });
      setTimeout(() => setConfigResult(null), 3000);
      loadConfig();
    } catch (err: any) {
      setConfigResult({ ok: false, text: `${es.configPatchFailed}: ${err?.message || ''}` });
    }
  }, [rawText, baseHash, es, loadConfig]);

  // Config.set single key handler
  const handleConfigSet = useCallback(async () => {
    if (!setKey.trim() || setSending) return;
    setSetSending(true);
    setSetResult(null);
    try {
      let val: any = setVal.trim();
      try { val = JSON.parse(val); } catch { /* keep as string */ }
      await gwApi.configSet(setKey.trim(), val);
      setSetResult({ ok: true, text: `${es.configSetOk}: ${setKey.trim()}` });
      setSetKey('');
      setSetVal('');
      setTimeout(() => setSetResult(null), 3000);
    } catch (err: any) {
      setSetResult({ ok: false, text: `${es.configSetFailed}: ${err?.message || ''}` });
    }
    setSetSending(false);
  }, [setKey, setVal, setSending, es]);



  // Wizard handlers
  const handleWizardStart = useCallback(async () => {
    setWizardLoading(true);
    setWizardError('');
    try {
      const res = await gwApi.wizardStart({}) as any;
      setWizardSessionId(res?.sessionId || '');
      setWizardStep(res);
    } catch (err: any) {
      setWizardError(err?.message || es.failed);
    }
    setWizardLoading(false);
  }, []);

  const handleWizardNext = useCallback(async () => {
    if (!wizardSessionId) return;
    setWizardLoading(true);
    setWizardError('');
    try {
      let input: any = wizardInput.trim();
      try { input = JSON.parse(input); } catch { /* keep as string */ }
      const res = await gwApi.wizardNext(wizardSessionId, input) as any;
      setWizardStep(res);
      setWizardInput('');
      if (res?.done || res?.complete) {
        setWizardSessionId('');
      }
    } catch (err: any) {
      setWizardError(err?.message || es.failed);
    }
    setWizardLoading(false);
  }, [wizardSessionId, wizardInput, es]);

  const handleWizardCancel = useCallback(async () => {
    if (!wizardSessionId) return;
    try {
      await gwApi.wizardCancel(wizardSessionId);
    } catch { /* ignore */ }
    setWizardSessionId('');
    setWizardStep(null);
    setWizardInput('');
  }, [wizardSessionId]);

  return (
    <div className="space-y-4">
      {/* Raw Config Editor (config.get / config.apply / config.patch) */}
      <div className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-amber-500">data_object</span>
            <h3 className="text-[12px] font-bold text-slate-700 dark:text-white/70">{es.liveConfig}</h3>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadSchema} className="text-[10px] text-slate-400 hover:text-primary transition-colors">
              {es.viewSchema}
            </button>
            <button onClick={loadConfig} disabled={configLoading}
              className="h-7 px-3 bg-primary/10 text-primary text-[10px] font-bold rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-40 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">{configLoading ? 'progress_activity' : 'download'}</span>
              {configLoading ? '...' : es.liveLoadConfig}
            </button>
          </div>
        </div>

        {configError && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-500/5 text-[10px] text-red-500 font-bold">{configError}</div>
        )}

        {rawText && (
          <div className="p-4 space-y-3">
            {baseHash && (
              <div className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-white/35">
                <span className="material-symbols-outlined text-[11px]">tag</span>
                Hash: <span className="font-mono">{baseHash.slice(0, 16)}...</span>
              </div>
            )}
            <textarea
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              spellCheck={false}
              className="w-full p-3 rounded-xl bg-[#fafafa] dark:bg-[#141418] border border-slate-200 dark:border-white/[0.06] text-[11px] font-mono text-slate-800 dark:text-[#d4d4d4] resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
              style={{ minHeight: '300px', tabSize: 2 }}
            />
            <div className="flex items-center gap-2">
              <button onClick={handleApply}
                className="h-7 px-3 bg-primary text-white text-[10px] font-bold rounded-lg flex items-center gap-1 transition-all hover:bg-primary/90">
                <span className="material-symbols-outlined text-[12px]">check</span>
                {es.configApplyBtn}
              </button>
              <button onClick={handlePatch}
                className="h-7 px-3 bg-amber-500 text-white text-[10px] font-bold rounded-lg flex items-center gap-1 transition-all hover:bg-amber-600">
                <span className="material-symbols-outlined text-[12px]">edit_note</span>
                {es.configPatchBtn}
              </button>
              <button onClick={loadConfig} disabled={configLoading}
                className="h-7 px-3 bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 text-[10px] font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                <span className="material-symbols-outlined text-[12px]">refresh</span>
              </button>
            </div>
            {configResult && (
              <div className={`px-2 py-1.5 rounded-lg text-[10px] font-bold ${configResult.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-red-50 dark:bg-red-500/5 text-red-500'}`}>
                {configResult.text}
              </div>
            )}
          </div>
        )}

        {!rawText && !configLoading && !configError && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-white/20">
            <span className="material-symbols-outlined text-3xl mb-2">data_object</span>
            <p className="text-[11px]">{es.loadConfigHint}</p>
          </div>
        )}
      </div>

      {/* Config Schema Visual Editor */}
      {schema && rawText && (() => {
        const schemaObj = schema?.schema || schema;
        const hints: UiHints = schema?.uiHints || {};
        const topLevelKeys = Object.keys(schemaObj?.properties || {}).sort((a, b) => {
          const ha = hints[a]?.order ?? 999;
          const hb = hints[b]?.order ?? 999;
          return ha - hb;
        });
        let parsedConfig: Record<string, any> = {};
        try { parsedConfig = JSON.parse(rawText); } catch { /* ignore */ }

        return (
          <div className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-sky-500">schema</span>
                <h3 className="text-[12px] font-bold text-slate-700 dark:text-white/70">{es.configSchema} — Visual</h3>
              </div>
              <button onClick={() => setSchema(null)} className="text-[10px] text-slate-400 hover:text-red-500 transition-colors">
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
            <div className="p-4 space-y-4 max-h-[500px] overflow-y-auto custom-scrollbar">
              {topLevelKeys.map(key => {
                const sectionHint = hints[key];
                const sectionLabel = sectionHint?.label || key;
                return (
                  <details key={key} className="group">
                    <summary className="flex items-center gap-2 cursor-pointer select-none py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors">
                      <span className="material-symbols-outlined text-[14px] text-slate-400 group-open:rotate-90 transition-transform">chevron_right</span>
                      <span className="text-[12px] font-bold text-slate-700 dark:text-white/70">{sectionLabel}</span>
                      {sectionHint?.help && <span className="text-[10px] text-slate-400 dark:text-white/30 truncate max-w-[300px]">{sectionHint.help}</span>}
                    </summary>
                    <div className="ml-4 mt-1 pl-2 border-l-2 border-slate-200 dark:border-white/10">
                      <SchemaSection
                        sectionKey={key}
                        schema={schemaObj}
                        uiHints={hints}
                        config={parsedConfig}
                        onChange={(pathArr, val) => {
                          try {
                            const cfg = JSON.parse(rawText);
                            let target = cfg;
                            for (let i = 0; i < pathArr.length - 1; i++) {
                              if (target[pathArr[i]] == null) target[pathArr[i]] = {};
                              target = target[pathArr[i]];
                            }
                            target[pathArr[pathArr.length - 1]] = val;
                            setRawText(JSON.stringify(cfg, null, 2));
                          } catch { /* ignore parse errors */ }
                        }}
                      />
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Config Schema Raw JSON */}
      {schema && !rawText && (
        <div className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-sky-500">schema</span>
              <h3 className="text-[12px] font-bold text-slate-700 dark:text-white/70">{es.configSchema}</h3>
            </div>
            <button onClick={() => setSchema(null)} className="text-[10px] text-slate-400 hover:text-red-500 transition-colors">
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
          <pre className="p-4 text-[10px] font-mono text-slate-600 dark:text-white/50 overflow-auto max-h-64 custom-scrollbar">
            {JSON.stringify(schema, null, 2)}
          </pre>
        </div>
      )}

      {/* Configuration Wizard */}
      <div className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-violet-500">auto_fix_high</span>
            <h3 className="text-[12px] font-bold text-slate-700 dark:text-white/70">{es.wizardTitle}</h3>
          </div>
          {!wizardSessionId ? (
            <button onClick={handleWizardStart} disabled={wizardLoading}
              className="h-7 px-3 bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[10px] font-bold rounded-lg hover:bg-violet-500/20 transition-colors disabled:opacity-40 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">{wizardLoading ? 'progress_activity' : 'play_arrow'}</span>
              {es.wizardStart}
            </button>
          ) : (
            <button onClick={handleWizardCancel}
              className="h-7 px-3 bg-red-500/10 text-red-500 text-[10px] font-bold rounded-lg hover:bg-red-500/20 transition-colors flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">close</span>
              {es.wizardCancel}
            </button>
          )}
        </div>

        {wizardError && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-500/5 text-[10px] text-red-500 font-bold">{wizardError}</div>
        )}

        {wizardStep && (
          <div className="p-4 space-y-3">
            {wizardStep.title && (
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{wizardStep.title}</h4>
            )}
            {wizardStep.description && (
              <p className="text-[11px] text-slate-500 dark:text-white/40">{wizardStep.description}</p>
            )}
            {wizardStep.prompt && (
              <p className="text-[11px] text-slate-600 dark:text-white/50 font-medium">{wizardStep.prompt}</p>
            )}
            {wizardStep.options && Array.isArray(wizardStep.options) && (
              <div className="flex flex-wrap gap-2">
                {wizardStep.options.map((opt: any, i: number) => (
                  <button key={i} onClick={() => { setWizardInput(typeof opt === 'string' ? opt : opt.value || opt.id || String(i)); }}
                    className={`h-7 px-3 text-[10px] font-bold rounded-lg transition-all ${wizardInput === (typeof opt === 'string' ? opt : opt.value || opt.id || String(i)) ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/50 hover:bg-primary/10 hover:text-primary'}`}>
                    {typeof opt === 'string' ? opt : opt.label || opt.name || opt.value}
                  </button>
                ))}
              </div>
            )}
            {!wizardStep.done && !wizardStep.complete && (
              <div className="flex gap-2">
                <input value={wizardInput} onChange={e => setWizardInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleWizardNext()}
                  placeholder={es.wizardInputPlaceholder}
                  className="flex-1 h-8 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] text-slate-700 dark:text-white/70 outline-none" />
                <button onClick={handleWizardNext} disabled={wizardLoading}
                  className="h-8 px-4 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">{wizardLoading ? 'progress_activity' : 'arrow_forward'}</span>
                  {es.wizardNext}
                </button>
              </div>
            )}
            {(wizardStep.done || wizardStep.complete) && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-mac-green/10 text-mac-green text-[11px] font-bold">
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                {es.wizardDone}
              </div>
            )}
            {wizardStep.result && (
              <pre className="p-2 bg-black/5 dark:bg-black/30 rounded-lg text-[11px] font-mono text-slate-500 dark:text-white/40 overflow-x-auto max-h-32 custom-scrollbar">
                {typeof wizardStep.result === 'string' ? wizardStep.result : JSON.stringify(wizardStep.result, null, 2)}
              </pre>
            )}
          </div>
        )}

        {!wizardSessionId && !wizardStep && (
          <div className="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-white/20">
            <span className="material-symbols-outlined text-3xl mb-2">auto_fix_high</span>
            <p className="text-[11px]">{es.wizardHint}</p>
          </div>
        )}
      </div>

      {/* Config Set Single Key */}
      <div className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-teal-500">edit_attributes</span>
          <h3 className="text-[12px] font-bold text-slate-700 dark:text-white/70">{es.configSetTitle}</h3>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-[10px] text-slate-400 dark:text-white/35">{es.configSetDesc}</p>
          <div className="flex gap-2">
            <input value={setKey} onChange={e => setSetKey(e.target.value)}
              placeholder={es.configSetKeyPlaceholder}
              className="flex-1 h-8 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-mono text-slate-700 dark:text-white/70 outline-none" />
            <input value={setVal} onChange={e => setSetVal(e.target.value)}
              placeholder={es.configSetValPlaceholder}
              onKeyDown={e => e.key === 'Enter' && handleConfigSet()}
              className="flex-1 h-8 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-mono text-slate-700 dark:text-white/70 outline-none" />
            <button onClick={handleConfigSet} disabled={setSending || !setKey.trim()}
              className="h-8 px-3 bg-teal-500 text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1 transition-all hover:bg-teal-600">
              <span className="material-symbols-outlined text-[12px]">{setSending ? 'progress_activity' : 'check'}</span>
              {es.configSetBtn}
            </button>
          </div>
          {setResult && (
            <div className={`px-2 py-1.5 rounded-lg text-[10px] font-bold ${setResult.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-red-50 dark:bg-red-500/5 text-red-500'}`}>
              {setResult.text}
            </div>
          )}
        </div>
      </div>


    </div>
  );
};
