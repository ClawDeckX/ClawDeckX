import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, PasswordField, NumberField, SelectField, SwitchField, ArrayField, KeyValueField } from '../fields';
import { getTranslation } from '../../../locales';
import { schemaTooltip, schemaDefault } from '../schemaTooltip';
import { gwApi } from '../../../services/api';
import { useToast } from '../../../components/Toast';
import SchemaRemainder from '../SchemaRemainder';

/* ─── Types ─── */
interface TtsStatusData {
  enabled: boolean;
  auto: string; // TtsAutoMode: off | always | inbound | tagged
  provider: string;
  persona: string | null;
  personas: Array<{ id: string; label?: string; description?: string; provider?: string }>;
  fallbackProvider: string | null;
  fallbackProviders: string[];
  prefsPath?: string;
  providerStates?: Array<{ id: string; label: string; configured: boolean }>;
}

interface TtsProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  models?: string[];
  voices?: string[];
}

interface CatalogData {
  modes: string[];
  transports: string[];
  brains: string[];
  speech: { activeProvider?: string; providers: Array<{ id: string; label: string; configured: boolean; models?: string[]; voices?: string[] }> };
  transcription: { activeProvider?: string; providers: Array<{ id: string; label: string; configured: boolean; defaultModel?: string }> };
  realtime: { activeProvider?: string; providers: Array<{ id: string; label: string; configured: boolean; defaultModel?: string; transports?: string[]; supportsBargeIn?: boolean; supportsToolCalls?: boolean }> };
}

/* ─── Constants ─── */
const TTS_AUTO_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'always', label: 'Always' },
  { value: 'inbound', label: 'Inbound Only' },
  { value: 'tagged', label: 'Tagged Only' },
];

const TTS_MODE_OPTIONS = [
  { value: 'final', label: 'Final replies only' },
  { value: 'all', label: 'All replies' },
];

const REALTIME_MODE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'realtime', label: 'Realtime' },
  { value: 'stt-tts', label: 'STT + TTS' },
  { value: 'transcription', label: 'Transcription' },
];

const REALTIME_TRANSPORT_OPTIONS = [
  { value: '', label: '—' },
  { value: 'webrtc', label: 'WebRTC' },
  { value: 'provider-websocket', label: 'Provider WebSocket' },
  { value: 'gateway-relay', label: 'Gateway Relay' },
  { value: 'managed-room', label: 'Managed Room' },
];

const REALTIME_BRAIN_OPTIONS = [
  { value: '', label: '—' },
  { value: 'agent-consult', label: 'Agent Consult' },
  { value: 'direct-tools', label: 'Direct Tools' },
  { value: 'none', label: 'None' },
];

/* ─── Component ─── */
export const AudioSection: React.FC<SectionProps> = ({ config, schema, setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => schemaTooltip(key, language, schema);
  const def = (key: string) => schemaDefault(key, schema);
  const { toast } = useToast();

  // TTS config lives under messages.tts.* in OpenClaw schema
  const ttsGet = (p: string[]) => getField(['messages', 'tts', ...p]);
  const ttsSet = (p: string[], v: any) => setField(['messages', 'tts', ...p], v);

  /* ─── TTS Live Status ─── */
  const [ttsStatus, setTtsStatus] = useState<TtsStatusData | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsToggling, setTtsToggling] = useState(false);

  /* ─── TTS Providers ─── */
  const [providers, setProviders] = useState<TtsProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState('');
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [switchingProvider, setSwitchingProvider] = useState(false);

  /* ─── TTS Personas ─── */
  const [personaSwitching, setPersonaSwitching] = useState(false);

  /* ─── Talk Catalog ─── */
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  /* ─── TTS Preview ─── */
  const [previewText, setPreviewText] = useState('');
  const [previewProvider, setPreviewProvider] = useState('');
  const [previewVoice, setPreviewVoice] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ ok: boolean; text: string } | null>(null);

  /* ─── Talk Mode ─── */
  const [talkMode, setTalkMode] = useState('');
  const [talkModeLoading, setTalkModeLoading] = useState(false);
  const [talkModeResult, setTalkModeResult] = useState<{ ok: boolean; text: string } | null>(null);

  /* ─── Voice Wake ─── */
  const [triggers, setTriggers] = useState<string[]>([]);
  const [triggersLoaded, setTriggersLoaded] = useState(false);
  const [triggerInput, setTriggerInput] = useState('');
  const [triggerSaving, setTriggerSaving] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* ─── Auto-load on mount (improvement #1) ─── */
  const didAutoLoad = useRef(false);
  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    loadProvidersRef.current();
  }, []);

  /* ─── Audio playback ref (improvement #3) ─── */
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* ─── Callbacks ─── */
  const loadTtsStatus = useCallback(async () => {
    setTtsLoading(true);
    try {
      const res = await gwApi.proxy('tts.status', {}) as TtsStatusData;
      setTtsStatus(res);
    } catch { /* ignore */ }
    setTtsLoading(false);
  }, []);

  const toggleTts = useCallback(async (enable: boolean) => {
    setTtsToggling(true);
    try {
      await gwApi.proxy(enable ? 'tts.enable' : 'tts.disable', {});
      setTtsStatus(prev => prev ? { ...prev, enabled: enable } : null);
      // Auto-refresh status (#5)
      setTimeout(() => loadTtsStatus(), 300);
    } catch (err: any) { toast('error', err?.message || es.ttsConvertFailed); }
    setTtsToggling(false);
  }, [es, toast, loadTtsStatus]);

  const loadProviders = useCallback(async () => {
    try {
      const res = await gwApi.proxy('tts.providers', {}) as any;
      setProviders(Array.isArray(res?.providers) ? res.providers : []);
      setActiveProvider(res?.active || '');
      setProvidersLoaded(true);
    } catch { /* ignore */ }
  }, []);
  const loadProvidersRef = useRef(loadProviders);
  loadProvidersRef.current = loadProviders;

  const switchProviderFn = useCallback(async (id: string) => {
    setSwitchingProvider(true);
    try {
      await gwApi.proxy('tts.setProvider', { provider: id });
      setActiveProvider(id);
      toast('success', `Provider → ${id}`);
      // Auto-refresh status (#5)
      loadTtsStatus();
    } catch (err: any) { toast('error', err?.message || es.configSetFailed); }
    setSwitchingProvider(false);
  }, [es, toast, loadTtsStatus]);

  const switchPersona = useCallback(async (persona: string | null) => {
    setPersonaSwitching(true);
    try {
      await gwApi.ttsSetPersona(persona);
      setTtsStatus(prev => prev ? { ...prev, persona } : null);
      toast('success', persona ? `Persona → ${persona}` : 'Persona cleared');
      // Auto-refresh status (#5)
      loadTtsStatus();
    } catch (err: any) { toast('error', err?.message || 'Failed'); }
    setPersonaSwitching(false);
  }, [toast, loadTtsStatus]);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const res = await gwApi.talkCatalog();
      setCatalog(res);
    } catch { /* ignore */ }
    setCatalogLoading(false);
  }, []);

  const handlePreview = useCallback(async () => {
    if (!previewText.trim()) return;
    setPreviewing(true);
    setPreviewResult(null);
    try {
      const params: any = { text: previewText.trim() };
      if (previewProvider) params.provider = previewProvider;
      if (previewVoice) params.voiceId = previewVoice;
      const res = await gwApi.proxy('tts.convert', params) as any;
      setPreviewResult({ ok: true, text: es.ttsConvertOk });
      // Play audio if returned (#3)
      if (res?.audioBase64 && res?.mimeType) {
        const dataUrl = `data:${res.mimeType};base64,${res.audioBase64}`;
        if (audioRef.current) { audioRef.current.pause(); }
        const audio = new Audio(dataUrl);
        audioRef.current = audio;
        audio.play().catch(() => {});
      }
    } catch (err: any) {
      setPreviewResult({ ok: false, text: `${es.ttsConvertFailed}: ${err?.message || ''}` });
    }
    setPreviewing(false);
  }, [previewText, previewProvider, previewVoice, es]);

  const handleTalkMode = useCallback(async (mode: string) => {
    setTalkModeLoading(true);
    setTalkModeResult(null);
    try {
      const enabled = mode !== 'off';
      await gwApi.talkMode(enabled, enabled ? mode : undefined);
      setTalkMode(mode);
      setTalkModeResult({ ok: true, text: `${es.talkModeOk}: ${mode}` });
      setTimeout(() => setTalkModeResult(null), 3000);
    } catch (err: any) {
      setTalkModeResult({ ok: false, text: `${es.talkModeFailed}: ${err?.message || ''}` });
    }
    setTalkModeLoading(false);
  }, [es]);

  const loadTriggers = useCallback(async () => {
    try {
      const res = await gwApi.proxy('voicewake.get', {}) as any;
      setTriggers(Array.isArray(res?.triggers) ? res.triggers : []);
      setTriggersLoaded(true);
    } catch { /* ignore */ }
  }, []);

  const saveTriggers = useCallback(async () => {
    setTriggerSaving(true);
    setTriggerMsg(null);
    try {
      const res = await gwApi.proxy('voicewake.set', { triggers }) as any;
      setTriggers(Array.isArray(res?.triggers) ? res.triggers : triggers);
      setTriggerMsg({ ok: true, text: es.voicewakeSaved });
    } catch (err: any) {
      setTriggerMsg({ ok: false, text: `${es.voicewakeFailed}: ${err?.message || ''}` });
    }
    setTriggerSaving(false);
  }, [triggers, es]);

  const addTrigger = useCallback(() => {
    const w = triggerInput.trim();
    if (w && !triggers.includes(w)) {
      setTriggers(prev => [...prev, w]);
      setTriggerInput('');
    }
  }, [triggerInput, triggers]);

  const removeTrigger = useCallback((idx: number) => {
    setTriggers(prev => prev.filter((_, i) => i !== idx));
  }, []);

  /* ─── Derived helpers ─── */
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const providerOptions = useMemo(() => {
    const opts = [{ value: '', label: '—' }];
    if (providersLoaded) {
      for (const p of providers) {
        opts.push({ value: p.id, label: `${p.name}${p.configured ? '' : ' ⚠'}` });
      }
    }
    return opts;
  }, [providers, providersLoaded]);

  const activeProviderVoices = useMemo(() => {
    if (!providersLoaded) return [];
    const p = providers.find(x => x.id === activeProvider);
    return p?.voices || [];
  }, [providers, activeProvider, providersLoaded]);

  const activeProviderModels = useMemo(() => {
    if (!providersLoaded) return [];
    const p = providers.find(x => x.id === activeProvider);
    return p?.models || [];
  }, [providers, activeProvider, providersLoaded]);

  return (
    <div className="space-y-4">
      {/* ═══ TTS Live Status ═══ */}
      <ConfigSection title={es.ttsStatus} icon="graphic_eq" iconColor="text-fuchsia-500">
        {!ttsStatus && !ttsLoading && (
          <button onClick={loadTtsStatus}
            className="h-8 px-4 bg-primary/10 text-primary text-[11px] font-bold rounded-lg hover:bg-primary/20 transition-colors flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px]">download</span>
            {es.ttsLoadStatus}
          </button>
        )}
        {ttsLoading && (
          <div className="flex items-center gap-2 text-slate-400 text-[10px]">
            <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
          </div>
        )}
        {ttsStatus && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
              <span className="text-slate-400 dark:text-white/40">{es.ttsStatus}</span>
              <span className={`font-bold ${ttsStatus.enabled ? 'text-mac-green' : 'text-slate-400'}`}>
                {ttsStatus.enabled ? es.ttsEnabled : es.ttsDisabled}
              </span>
              <span className="text-slate-400 dark:text-white/40">{es.ttsAuto}</span>
              <span className="text-slate-600 dark:text-white/60 font-mono">{ttsStatus.auto || 'off'}</span>
              <span className="text-slate-400 dark:text-white/40">{es.ttsActiveProvider}</span>
              <span className="text-slate-600 dark:text-white/60 font-mono">{ttsStatus.provider || '—'}</span>
              {ttsStatus.persona && (
                <>
                  <span className="text-slate-400 dark:text-white/40">{es.ttsPersona || 'Persona'}</span>
                  <span className="text-slate-600 dark:text-white/60 font-mono">{ttsStatus.persona}</span>
                </>
              )}
              {ttsStatus.fallbackProvider && (
                <>
                  <span className="text-slate-400 dark:text-white/40">{es.ttsFallback}</span>
                  <span className="text-slate-600 dark:text-white/60 font-mono">{ttsStatus.fallbackProvider}</span>
                </>
              )}
              {ttsStatus.fallbackProviders && ttsStatus.fallbackProviders.length > 1 && (
                <>
                  <span className="text-slate-400 dark:text-white/40">{es.ttsFallbackChain || 'Fallback Chain'}</span>
                  <span className="text-slate-600 dark:text-white/60 font-mono text-[10px]">{ttsStatus.fallbackProviders.join(' → ')}</span>
                </>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => toggleTts(!ttsStatus.enabled)} disabled={ttsToggling}
                className={`h-7 px-3 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1 ${ttsStatus.enabled ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20' : 'bg-mac-green/10 text-mac-green hover:bg-mac-green/20'}`}>
                <span className="material-symbols-outlined text-[12px]">{ttsStatus.enabled ? 'volume_off' : 'volume_up'}</span>
                {ttsStatus.enabled ? es.ttsDisable : es.ttsEnable}
              </button>
              <button onClick={loadTtsStatus} disabled={ttsLoading}
                className="h-7 px-3 bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 text-[10px] font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                <span className="material-symbols-outlined text-[12px]">refresh</span>
              </button>
            </div>

            {/* Persona quick-switch with details (#4) */}
            {ttsStatus.personas && ttsStatus.personas.length > 0 && (
              <div className="pt-2 border-t border-slate-200 dark:border-white/5 space-y-1.5">
                <p className="text-[10px] text-slate-400 dark:text-white/35 font-bold">{es.ttsPersona || 'Persona'}</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => switchPersona(null)} disabled={personaSwitching}
                    className={`h-6 px-2.5 text-[10px] font-bold rounded-lg transition-all ${!ttsStatus.persona ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 hover:bg-primary/10 hover:text-primary'}`}>
                    Default
                  </button>
                  {ttsStatus.personas.map(p => (
                    <button key={p.id} onClick={() => switchPersona(p.id)} disabled={personaSwitching}
                      title={[p.description, p.provider ? `Provider: ${p.provider}` : ''].filter(Boolean).join(' | ')}
                      className={`h-6 px-2.5 text-[10px] font-bold rounded-lg transition-all ${ttsStatus.persona === p.id ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 hover:bg-primary/10 hover:text-primary'}`}>
                      {p.label || p.id}
                    </button>
                  ))}
                </div>
                {/* Active persona details (#4) */}
                {ttsStatus.persona && (() => {
                  const ap = ttsStatus.personas.find(x => x.id === ttsStatus.persona);
                  if (!ap) return null;
                  return (
                    <div className="mt-2 p-2 rounded-lg bg-primary/5 border border-primary/10 text-[10px] space-y-0.5">
                      <div className="text-slate-600 dark:text-white/60 font-bold">{ap.label || ap.id}</div>
                      {ap.description && <div className="text-slate-400 dark:text-white/35">{ap.description}</div>}
                      {ap.provider && <div className="text-slate-400 dark:text-white/30">Provider: <span className="font-mono">{ap.provider}</span></div>}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </ConfigSection>

      {/* ═══ TTS Providers ═══ */}
      <ConfigSection title={es.ttsProviders} icon="tune" iconColor="text-fuchsia-500" defaultOpen={false}
        actions={!providersLoaded ? (
          <button onClick={loadProviders} className="text-[10px] text-primary hover:underline">{es.ttsLoadStatus}</button>
        ) : (
          <button onClick={loadProviders} className="text-[10px] text-slate-400 hover:text-primary">
            <span className="material-symbols-outlined text-[12px]">refresh</span>
          </button>
        )}>
        {providersLoaded && providers.length > 0 && (
          <div className="space-y-2">
            {providers.map(p => (
              <div key={p.id} className={`rounded-xl border transition-all ${activeProvider === p.id ? 'border-primary bg-primary/5' : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]'}`}>
                <div className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-white/70">{p.name}</span>
                      {activeProvider === p.id && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">active</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${p.configured ? 'bg-mac-green/10 text-mac-green' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                        {p.configured ? es.ttsConfigured : es.ttsNotConfigured}
                      </span>
                    </div>
                    {p.configured && (p.models?.length || p.voices?.length) ? (
                      <div className="flex gap-3 mt-1.5 text-[9px] text-slate-400 dark:text-white/30">
                        {p.models && p.models.length > 0 && (
                          <span>{es.audioModelId || 'Models'}: {p.models.join(', ')}</span>
                        )}
                        {p.voices && p.voices.length > 0 && (
                          <span>{es.voiceId || 'Voices'}: {p.voices.slice(0, 5).join(', ')}{p.voices.length > 5 ? ` +${p.voices.length - 5}` : ''}</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {activeProvider !== p.id && p.configured && (
                      <button onClick={() => switchProviderFn(p.id)} disabled={switchingProvider}
                        className="h-6 px-2.5 bg-primary/10 text-primary text-[10px] font-bold rounded-lg hover:bg-primary/20 transition-colors">
                        {es.ttsSetProvider}
                      </button>
                    )}
                    <button onClick={() => setExpandedProvider(expandedProvider === p.id ? null : p.id)}
                      className="h-6 w-6 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-white/5 text-slate-400 hover:text-primary hover:bg-primary/10 transition-colors">
                      <span className="material-symbols-outlined text-[12px]">{expandedProvider === p.id ? 'expand_less' : 'settings'}</span>
                    </button>
                  </div>
                </div>
                {/* Per-provider config panel */}
                {expandedProvider === p.id && (
                  <div className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-white/5 space-y-2">
                    <PasswordField label={es.audioApiKey || 'API Key'} tooltip={`messages.tts.providers.${p.id}.apiKey`}
                      value={ttsGet(['providers', p.id, 'apiKey']) || ''}
                      onChange={v => ttsSet(['providers', p.id, 'apiKey'], v || undefined)} />
                    <TextField label={es.ttsBaseUrl || 'Base URL'} tooltip={`messages.tts.providers.${p.id}.baseUrl`}
                      value={ttsGet(['providers', p.id, 'baseUrl']) || ''}
                      onChange={v => ttsSet(['providers', p.id, 'baseUrl'], v || undefined)}
                      placeholder="https://api.example.com/v1" />
                    {/* Voice ID: use SelectField if voices available, otherwise TextField */}
                    {p.voices && p.voices.length > 0 ? (
                      <SelectField label={es.voiceId || 'Voice ID'} tooltip={`messages.tts.providers.${p.id}.voice`}
                        value={ttsGet(['providers', p.id, 'voice']) || ''}
                        onChange={v => ttsSet(['providers', p.id, 'voice'], v || undefined)}
                        options={[{ value: '', label: '—' }, ...p.voices.map(v => ({ value: v, label: v }))]} />
                    ) : (
                      <TextField label={es.voiceId || 'Voice ID'} tooltip={`messages.tts.providers.${p.id}.voice`}
                        value={ttsGet(['providers', p.id, 'voice']) || ''}
                        onChange={v => ttsSet(['providers', p.id, 'voice'], v || undefined)}
                        placeholder="" />
                    )}
                    {/* Model ID: use SelectField if models available, otherwise TextField */}
                    {p.models && p.models.length > 0 ? (
                      <SelectField label={es.audioModelId || 'Model ID'} tooltip={`messages.tts.providers.${p.id}.model`}
                        value={ttsGet(['providers', p.id, 'model']) || ''}
                        onChange={v => ttsSet(['providers', p.id, 'model'], v || undefined)}
                        options={[{ value: '', label: '—' }, ...p.models.map(m => ({ value: m, label: m }))]} />
                    ) : (
                      <TextField label={es.audioModelId || 'Model ID'} tooltip={`messages.tts.providers.${p.id}.model`}
                        value={ttsGet(['providers', p.id, 'model']) || ''}
                        onChange={v => ttsSet(['providers', p.id, 'model'], v || undefined)}
                        placeholder="" />
                    )}
                    <NumberField label={es.speed || 'Speed'} tooltip={`messages.tts.providers.${p.id}.speed`}
                      value={ttsGet(['providers', p.id, 'speed'])}
                      onChange={v => ttsSet(['providers', p.id, 'speed'], v || undefined)}
                      min={0.25} max={4} step={0.25} placeholder="1.0" />
                    <TextField label={es.ttsResponseFormat || 'Output Format'} tooltip={`messages.tts.providers.${p.id}.responseFormat`}
                      value={ttsGet(['providers', p.id, 'responseFormat']) || ''}
                      onChange={v => ttsSet(['providers', p.id, 'responseFormat'], v || undefined)}
                      placeholder="mp3" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {providersLoaded && providers.length === 0 && (
          <p className="text-[10px] text-slate-400 py-4 text-center">—</p>
        )}
      </ConfigSection>

      {/* ═══ TTS Config (static — messages.tts) ═══ */}
      <ConfigSection title={es.ttsConfig || 'TTS Config'} icon="settings_voice" iconColor="text-fuchsia-500" defaultOpen={false}>
        <SelectField label={es.ttsAuto || 'Auto Mode'} tooltip={tip('messages.tts.auto')}
          value={ttsGet(['auto']) || 'off'}
          onChange={v => ttsSet(['auto'], v === 'off' ? undefined : v)}
          options={TTS_AUTO_OPTIONS} />
        <SelectField label={es.mode || 'Mode'} tooltip={tip('messages.tts.mode')}
          value={ttsGet(['mode']) || 'final'}
          onChange={v => ttsSet(['mode'], v === 'final' ? undefined : v)}
          options={TTS_MODE_OPTIONS} />
        <SelectField label={es.ttsProvider || 'Provider'} tooltip={tip('messages.tts.provider')}
          value={ttsGet(['provider']) || ''}
          onChange={v => ttsSet(['provider'], v || undefined)}
          options={providerOptions} />
        <TextField label={es.ttsPersona || 'Persona'} tooltip={tip('messages.tts.persona')}
          value={ttsGet(['persona']) || ''}
          onChange={v => ttsSet(['persona'], v || undefined)}
          placeholder="default" />
        <TextField label={es.ttsSummaryModel || 'Summary Model'} tooltip={tip('messages.tts.summaryModel')}
          value={ttsGet(['summaryModel']) || ''}
          onChange={v => ttsSet(['summaryModel'], v || undefined)}
          placeholder="gpt-4o-mini" />
        <NumberField label={es.ttsMaxTextLength || 'Max Text Length'} tooltip={tip('messages.tts.maxTextLength')}
          value={ttsGet(['maxTextLength'])}
          onChange={v => ttsSet(['maxTextLength'], v || undefined)}
          min={100} step={500} placeholder="4000" />
        <NumberField label={es.ttsTimeoutMs || 'Timeout (ms)'} tooltip={tip('messages.tts.timeoutMs')}
          value={ttsGet(['timeoutMs'])}
          onChange={v => ttsSet(['timeoutMs'], v || undefined)}
          min={1000} step={1000} placeholder="30000" />
      </ConfigSection>

      {/* ═══ TTS Model Overrides ═══ */}
      <ConfigSection title={es.ttsModelOverrides || 'Model Overrides'} icon="psychology" iconColor="text-fuchsia-500" defaultOpen={false}>
        <p className="text-[10px] text-slate-400 dark:text-white/35 pb-2">{es.ttsModelOverridesDesc || 'Control what the AI model can override in TTS output'}</p>
        <SwitchField label={es.ttsModelOverridesEnabled || 'Enabled'} tooltip={tip('messages.tts.modelOverrides.enabled')}
          value={ttsGet(['modelOverrides', 'enabled']) !== false}
          onChange={v => ttsSet(['modelOverrides', 'enabled'], v)} />
        <SwitchField label={es.ttsAllowText || 'Allow Text'} tooltip={tip('messages.tts.modelOverrides.allowText')}
          value={ttsGet(['modelOverrides', 'allowText']) === true}
          onChange={v => ttsSet(['modelOverrides', 'allowText'], v || undefined)} />
        <SwitchField label={es.ttsAllowProvider || 'Allow Provider'} tooltip={tip('messages.tts.modelOverrides.allowProvider')}
          value={ttsGet(['modelOverrides', 'allowProvider']) === true}
          onChange={v => ttsSet(['modelOverrides', 'allowProvider'], v || undefined)} />
        <SwitchField label={es.ttsAllowVoice || 'Allow Voice'} tooltip={tip('messages.tts.modelOverrides.allowVoice')}
          value={ttsGet(['modelOverrides', 'allowVoice']) === true}
          onChange={v => ttsSet(['modelOverrides', 'allowVoice'], v || undefined)} />
        <SwitchField label={es.ttsAllowModelId || 'Allow Model ID'} tooltip={tip('messages.tts.modelOverrides.allowModelId')}
          value={ttsGet(['modelOverrides', 'allowModelId']) === true}
          onChange={v => ttsSet(['modelOverrides', 'allowModelId'], v || undefined)} />
        <SwitchField label={es.ttsAllowVoiceSettings || 'Allow Voice Settings'} tooltip={tip('messages.tts.modelOverrides.allowVoiceSettings')}
          value={ttsGet(['modelOverrides', 'allowVoiceSettings']) === true}
          onChange={v => ttsSet(['modelOverrides', 'allowVoiceSettings'], v || undefined)} />
        <SwitchField label={es.ttsAllowSeed || 'Allow Seed'} tooltip={tip('messages.tts.modelOverrides.allowSeed')}
          value={ttsGet(['modelOverrides', 'allowSeed']) === true}
          onChange={v => ttsSet(['modelOverrides', 'allowSeed'], v || undefined)} />
      </ConfigSection>

      {/* ═══ TTS Preview ═══ */}
      <ConfigSection title={es.ttsConvert} icon="play_circle" iconColor="text-fuchsia-500" defaultOpen={false}>
        <div className="space-y-2">
          <input value={previewText} onChange={e => setPreviewText(e.target.value)}
            placeholder={es.ttsConvertText}
            className="w-full h-8 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] text-slate-700 dark:text-white/70 outline-none" />
          <div className="flex gap-2">
            <input value={previewProvider} onChange={e => setPreviewProvider(e.target.value)}
              placeholder={es.ttsProvider || 'Provider (optional)'}
              className="flex-1 h-7 px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] text-slate-700 dark:text-white/70 outline-none" />
            <input value={previewVoice} onChange={e => setPreviewVoice(e.target.value)}
              placeholder={es.voiceId || 'Voice (optional)'}
              className="flex-1 h-7 px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] text-slate-700 dark:text-white/70 outline-none" />
          </div>
          <button onClick={handlePreview} disabled={previewing || !previewText.trim()}
            className="h-7 px-3 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1 transition-all">
            <span className="material-symbols-outlined text-[12px]">{previewing ? 'progress_activity' : 'play_arrow'}</span>
            {previewing ? es.ttsConverting : es.ttsConvert}
          </button>
          {previewResult && (
            <div className={`px-2 py-1.5 rounded-lg text-[10px] ${previewResult.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-red-50 dark:bg-red-500/5 text-red-500'}`}>
              {previewResult.text}
            </div>
          )}
        </div>
      </ConfigSection>

      {/* ═══ Talk Mode (live) ═══ */}
      <ConfigSection title={es.talkMode} icon="record_voice_over" iconColor="text-fuchsia-500" defaultOpen={false}>
        <div className="space-y-2">
          <p className="text-[10px] text-slate-400 dark:text-white/35">{es.talkModeDesc}</p>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'push-to-talk', label: es.talkModePtt, icon: 'touch_app' },
              { value: 'voice-activity', label: es.talkModeVad, icon: 'mic' },
              { value: 'off', label: es.talkModeOff, icon: 'mic_off' }
            ].map(m => (
              <button key={m.value} onClick={() => handleTalkMode(m.value)} disabled={talkModeLoading}
                className={`h-7 px-3 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1 ${talkMode === m.value ? 'bg-primary text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/50 hover:bg-primary/10 hover:text-primary'}`}>
                <span className="material-symbols-outlined text-[12px]">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
          {talkModeResult && (
            <div className={`px-2 py-1.5 rounded-lg text-[10px] ${talkModeResult.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-red-50 dark:bg-red-500/5 text-red-500'}`}>
              {talkModeResult.text}
            </div>
          )}
        </div>
      </ConfigSection>

      {/* ═══ Talk Catalog (live capabilities) ═══ */}
      <ConfigSection title={es.talkCatalog || 'Voice Capabilities'} icon="hub" iconColor="text-fuchsia-500" defaultOpen={false}
        actions={!catalog ? (
          <button onClick={loadCatalog} disabled={catalogLoading} className="text-[10px] text-primary hover:underline">
            {catalogLoading ? '...' : (es.ttsLoadStatus || 'Load')}
          </button>
        ) : (
          <button onClick={loadCatalog} disabled={catalogLoading} className="text-[10px] text-slate-400 hover:text-primary">
            <span className="material-symbols-outlined text-[12px]">refresh</span>
          </button>
        )}>
        {catalog && (
          <div className="space-y-3">
            {/* Speech (TTS) providers */}
            <div>
              <p className="text-[10px] font-bold text-slate-500 dark:text-white/50 mb-1.5">Speech (TTS)</p>
              <div className="space-y-1">
                {catalog.speech.providers.map(p => (
                  <div key={p.id} className="flex items-center gap-2 text-[10px]">
                    <span className={`w-1.5 h-1.5 rounded-full ${p.configured ? 'bg-mac-green' : 'bg-slate-300 dark:bg-white/20'}`} />
                    <span className="text-slate-600 dark:text-white/60">{p.label}</span>
                    {catalog.speech.activeProvider === p.id && <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-bold">active</span>}
                    {p.voices && p.voices.length > 0 && (
                      <span className="text-[9px] text-slate-400 dark:text-white/25">{p.voices.length} voices</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* Transcription providers */}
            {catalog.transcription.providers.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 dark:text-white/50 mb-1.5">Transcription (STT)</p>
                <div className="space-y-1">
                  {catalog.transcription.providers.map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-[10px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${p.configured ? 'bg-mac-green' : 'bg-slate-300 dark:bg-white/20'}`} />
                      <span className="text-slate-600 dark:text-white/60">{p.label}</span>
                      {catalog.transcription.activeProvider === p.id && <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-bold">active</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Realtime voice providers */}
            {catalog.realtime.providers.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-500 dark:text-white/50 mb-1.5">Realtime Voice</p>
                <div className="space-y-1">
                  {catalog.realtime.providers.map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-[10px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${p.configured ? 'bg-mac-green' : 'bg-slate-300 dark:bg-white/20'}`} />
                      <span className="text-slate-600 dark:text-white/60">{p.label}</span>
                      {catalog.realtime.activeProvider === p.id && <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-bold">active</span>}
                      {p.supportsBargeIn && <span className="text-[9px] text-slate-400">barge-in</span>}
                      {p.supportsToolCalls && <span className="text-[9px] text-slate-400">tools</span>}
                      {p.transports && <span className="text-[9px] text-slate-400">{p.transports.join(', ')}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </ConfigSection>

      {/* ═══ Talk Config (static — talk.*) ═══ */}
      <ConfigSection title={es.audioConfig || 'Talk Config'} icon="mic" iconColor="text-fuchsia-500" defaultOpen={false}>
        <SelectField label={es.talkProvider || 'Talk Provider'} tooltip={tip('talk.provider')}
          value={getField(['talk', 'provider']) || ''}
          onChange={v => setField(['talk', 'provider'], v || undefined)}
          options={providerOptions} />
        {(() => {
          const prov = getField(['talk', 'provider']) || 'default';
          const pg = (k: string) => getField(['talk', 'providers', prov, k]);
          const ps = (k: string, v: any) => setField(['talk', 'providers', prov, k], v || undefined);
          return (
            <>
              <TextField label={es.voiceId || 'Voice ID'} tooltip={tip('talk.providers.*.voiceId')} value={pg('voiceId') || ''} onChange={v => ps('voiceId', v)} placeholder={es.phVoiceId || 'alloy'} />
              <TextField label={es.audioModelId || 'Model ID'} tooltip={tip('talk.providers.*.modelId')} value={pg('modelId') || ''} onChange={v => ps('modelId', v)} placeholder={es.phModelId || 'tts-1'} />
              <TextField label={es.talkOutputFormat || 'Output Format'} tooltip={tip('talk.providers.*.outputFormat')} value={pg('outputFormat') || ''} onChange={v => ps('outputFormat', v)} placeholder="mp3" />
              <PasswordField label={es.audioApiKey || 'API Key'} tooltip={tip('talk.providers.*.apiKey')} value={pg('apiKey') || ''} onChange={v => ps('apiKey', v)} />
            </>
          );
        })()}
        <SwitchField label={es.audioInterrupt || 'Interrupt on Speech'} tooltip={tip('talk.interruptOnSpeech')}
          value={getField(['talk', 'interruptOnSpeech']) === true}
          onChange={v => setField(['talk', 'interruptOnSpeech'], v)} />
        <NumberField label={es.talkSilenceTimeoutMs || 'Silence Timeout (ms)'} tooltip={tip('talk.silenceTimeoutMs')}
          value={getField(['talk', 'silenceTimeoutMs'])}
          onChange={v => setField(['talk', 'silenceTimeoutMs'], v || undefined)} min={0} step={100} placeholder={def('talk.silenceTimeoutMs')} />
        <TextField label={es.talkSpeechLocale || 'Speech Locale'} tooltip={tip('talk.speechLocale')}
          value={getField(['talk', 'speechLocale']) || ''}
          onChange={v => setField(['talk', 'speechLocale'], v || undefined)} placeholder="en-US" />
      </ConfigSection>

      {/* ═══ Realtime Voice Config (talk.realtime) ═══ */}
      <ConfigSection title={es.talkRealtime || 'Realtime Voice'} icon="stream" iconColor="text-fuchsia-500" defaultOpen={false}>
        <TextField label={es.talkProvider || 'Provider'} tooltip={tip('talk.realtime.provider')}
          value={getField(['talk', 'realtime', 'provider']) || ''}
          onChange={v => setField(['talk', 'realtime', 'provider'], v || undefined)} placeholder="openai-realtime" />
        <TextField label={es.audioModelId || 'Model'} tooltip={tip('talk.realtime.model')}
          value={getField(['talk', 'realtime', 'model']) || ''}
          onChange={v => setField(['talk', 'realtime', 'model'], v || undefined)} placeholder="gpt-4o-realtime" />
        <TextField label={es.voiceId || 'Voice'} tooltip={tip('talk.realtime.voice')}
          value={getField(['talk', 'realtime', 'voice']) || ''}
          onChange={v => setField(['talk', 'realtime', 'voice'], v || undefined)} placeholder="alloy" />
        <SelectField label={es.talkRealtimeMode || 'Mode'} tooltip={tip('talk.realtime.mode')}
          value={getField(['talk', 'realtime', 'mode']) || ''}
          onChange={v => setField(['talk', 'realtime', 'mode'], v || undefined)}
          options={REALTIME_MODE_OPTIONS} />
        <SelectField label={es.talkRealtimeTransport || 'Transport'} tooltip={tip('talk.realtime.transport')}
          value={getField(['talk', 'realtime', 'transport']) || ''}
          onChange={v => setField(['talk', 'realtime', 'transport'], v || undefined)}
          options={REALTIME_TRANSPORT_OPTIONS} />
        <SelectField label={es.talkRealtimeBrain || 'Brain'} tooltip={tip('talk.realtime.brain')}
          value={getField(['talk', 'realtime', 'brain']) || ''}
          onChange={v => setField(['talk', 'realtime', 'brain'], v || undefined)}
          options={REALTIME_BRAIN_OPTIONS} />
        <TextField label={es.talkRealtimeInstructions || 'Instructions'} tooltip={tip('talk.realtime.instructions')}
          value={getField(['talk', 'realtime', 'instructions']) || ''}
          onChange={v => setField(['talk', 'realtime', 'instructions'], v || undefined)}
          placeholder="System instructions for realtime voice..." />
      </ConfigSection>

      {/* ═══ Audio Transcription ═══ */}
      <ConfigSection title={es.audioTranscription} icon="hearing" iconColor="text-fuchsia-500" defaultOpen={false}>
        <ArrayField label={es.audioCommand || 'Command'} tooltip={tip('audio.transcription.command')}
          value={getField(['audio', 'transcription', 'command']) || []}
          onChange={v => setField(['audio', 'transcription', 'command'], v)} placeholder={es.phWhisperCommand} />
        <NumberField label={es.timeoutS || 'Timeout (s)'} tooltip={tip('audio.transcription.timeoutSeconds')}
          value={getField(['audio', 'transcription', 'timeoutSeconds'])}
          onChange={v => setField(['audio', 'transcription', 'timeoutSeconds'], v)} min={1} placeholder={def('audio.transcription.timeoutSeconds')} />
        <SwitchField label={es.echoTranscript || 'Echo Transcript'} tooltip={tip('audio.transcription.echoTranscript')}
          value={getField(['audio', 'transcription', 'echoTranscript']) === true}
          onChange={v => setField(['audio', 'transcription', 'echoTranscript'], v)} />
        <TextField label={es.echoFormat || 'Echo Format'} tooltip={tip('audio.transcription.echoFormat')}
          value={getField(['audio', 'transcription', 'echoFormat']) || ''}
          onChange={v => setField(['audio', 'transcription', 'echoFormat'], v)} placeholder="🎤 {text}" />
      </ConfigSection>

      {/* ═══ Voice Wake ═══ */}
      <ConfigSection title={es.voicewake} icon="mic_external_on" iconColor="text-fuchsia-500" defaultOpen={false}
        actions={!triggersLoaded ? (
          <button onClick={loadTriggers} className="text-[10px] text-primary hover:underline">{es.voicewakeLoad}</button>
        ) : undefined}>
        {triggersLoaded && (
          <div className="space-y-2">
            {triggers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {triggers.map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 font-bold">
                    {t}
                    <button onClick={() => removeTrigger(i)} className="hover:text-red-500 transition-colors">
                      <span className="material-symbols-outlined text-[10px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 dark:text-white/35">{es.voicewakeEmpty}</p>
            )}
            <div className="flex gap-2">
              <input value={triggerInput} onChange={e => setTriggerInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTrigger()}
                placeholder={es.voicewakeAdd}
                className="flex-1 h-7 px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] text-slate-700 dark:text-white/70 outline-none" />
              <button onClick={addTrigger} disabled={!triggerInput.trim()}
                className="h-7 px-2.5 bg-fuchsia-500/10 text-fuchsia-600 text-[10px] font-bold rounded-lg hover:bg-fuchsia-500/20 transition-colors disabled:opacity-40">
                <span className="material-symbols-outlined text-[12px]">add</span>
              </button>
            </div>
            <button onClick={saveTriggers} disabled={triggerSaving}
              className="h-7 px-3 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1 transition-all">
              <span className="material-symbols-outlined text-[12px]">{triggerSaving ? 'progress_activity' : 'save'}</span>
              {triggerSaving ? es.voicewakeSaving : es.voicewakeSave}
            </button>
            {triggerMsg && (
              <div className={`px-2 py-1.5 rounded-lg text-[10px] ${triggerMsg.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-red-50 dark:bg-red-500/5 text-red-500'}`}>
                {triggerMsg.text}
              </div>
            )}
          </div>
        )}
      </ConfigSection>

      <SchemaRemainder
        sectionPath="talk"
        handledKeys={[
          'provider', 'interruptOnSpeech', 'silenceTimeoutMs', 'speechLocale',
          'providers', 'openai', 'realtime', 'consultThinkingLevel', 'consultFastMode',
        ]}
        config={config}
        setField={setField}
        language={language}
        schema={schema}
        title={es.schemaAdditional || 'Additional Audio Fields'}
      />
    </div>
  );
};
