import React, { useMemo, useState, useCallback } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, PasswordField, NumberField, SelectField, SwitchField, ArrayField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';
import { gwApi } from '../../../services/api';
import { useToast } from '../../../components/Toast';

interface TtsStatus {
  enabled: boolean;
  auto: boolean;
  provider: string;
  fallbackProvider: string | null;
  fallbackProviders: string[];
  hasOpenAIKey: boolean;
  hasElevenLabsKey: boolean;
  edgeEnabled: boolean;
}

interface TtsProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  models?: string[];
  voices?: string[];
}

export const AudioSection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const { toast } = useToast();

  // TTS live status
  const [ttsStatus, setTtsStatus] = useState<TtsStatus | null>(null);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [ttsToggling, setTtsToggling] = useState(false);

  // TTS providers
  const [providers, setProviders] = useState<TtsProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState('');
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [switchingProvider, setSwitchingProvider] = useState(false);

  // TTS preview
  const [previewText, setPreviewText] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Talk mode
  const [talkMode, setTalkMode] = useState('');
  const [talkModeLoading, setTalkModeLoading] = useState(false);
  const [talkModeResult, setTalkModeResult] = useState<{ ok: boolean; text: string } | null>(null);

  const handleTalkMode = useCallback(async (mode: string) => {
    setTalkModeLoading(true);
    setTalkModeResult(null);
    try {
      await gwApi.talkMode(mode);
      setTalkMode(mode);
      setTalkModeResult({ ok: true, text: `${es.talkModeOk}: ${mode}` });
      setTimeout(() => setTalkModeResult(null), 3000);
    } catch (err: any) {
      setTalkModeResult({ ok: false, text: `${es.talkModeFailed}: ${err?.message || ''}` });
    }
    setTalkModeLoading(false);
  }, [es]);

  // Voice wake
  const [triggers, setTriggers] = useState<string[]>([]);
  const [triggersLoaded, setTriggersLoaded] = useState(false);
  const [triggerInput, setTriggerInput] = useState('');
  const [triggerSaving, setTriggerSaving] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadTtsStatus = useCallback(async () => {
    setTtsLoading(true);
    try {
      const res = await gwApi.proxy('tts.status', {}) as TtsStatus;
      setTtsStatus(res);
    } catch { /* ignore */ }
    setTtsLoading(false);
  }, []);

  const toggleTts = useCallback(async (enable: boolean) => {
    setTtsToggling(true);
    try {
      await gwApi.proxy(enable ? 'tts.enable' : 'tts.disable', {});
      setTtsStatus(prev => prev ? { ...prev, enabled: enable } : null);
    } catch (err: any) { toast('error', err?.message || es.ttsConvertFailed); }
    setTtsToggling(false);
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const res = await gwApi.proxy('tts.providers', {}) as any;
      setProviders(Array.isArray(res?.providers) ? res.providers : []);
      setActiveProvider(res?.active || '');
      setProvidersLoaded(true);
    } catch { /* ignore */ }
  }, []);

  const switchProvider = useCallback(async (id: string) => {
    setSwitchingProvider(true);
    try {
      await gwApi.proxy('tts.setProvider', { provider: id });
      setActiveProvider(id);
    } catch (err: any) { toast('error', err?.message || es.configSetFailed); }
    setSwitchingProvider(false);
  }, [es, toast]);

  const handlePreview = useCallback(async () => {
    if (!previewText.trim()) return;
    setPreviewing(true);
    setPreviewResult(null);
    try {
      await gwApi.proxy('tts.convert', { text: previewText.trim() });
      setPreviewResult({ ok: true, text: es.ttsConvertOk });
    } catch (err: any) {
      setPreviewResult({ ok: false, text: `${es.ttsConvertFailed}: ${err?.message || ''}` });
    }
    setPreviewing(false);
  }, [previewText, es]);

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

  return (
    <div className="space-y-4">
      {/* TTS Live Status */}
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
              <span className="text-slate-600 dark:text-white/60">{ttsStatus.auto ? '✓' : '✗'}</span>
              <span className="text-slate-400 dark:text-white/40">{es.ttsActiveProvider}</span>
              <span className="text-slate-600 dark:text-white/60 font-mono">{ttsStatus.provider || '—'}</span>
              {ttsStatus.fallbackProvider && (
                <>
                  <span className="text-slate-400 dark:text-white/40">{es.ttsFallback}</span>
                  <span className="text-slate-600 dark:text-white/60 font-mono">{ttsStatus.fallbackProvider}</span>
                </>
              )}
            </div>
            <div className="flex gap-2">
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
          </div>
        )}
      </ConfigSection>

      {/* TTS Providers */}
      <ConfigSection title={es.ttsProviders} icon="tune" iconColor="text-fuchsia-500" defaultOpen={false}
        actions={!providersLoaded ? (
          <button onClick={loadProviders} className="text-[10px] text-primary hover:underline">{es.ttsLoadStatus}</button>
        ) : undefined}>
        {providersLoaded && providers.length > 0 && (
          <div className="space-y-2">
            {providers.map(p => (
              <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${activeProvider === p.id ? 'border-primary bg-primary/5' : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-700 dark:text-white/70">{p.name}</span>
                    {activeProvider === p.id && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">active</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${p.configured ? 'bg-mac-green/10 text-mac-green' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                      {p.configured ? es.ttsConfigured : es.ttsNotConfigured}
                    </span>
                  </div>
                </div>
                {activeProvider !== p.id && p.configured && (
                  <button onClick={() => switchProvider(p.id)} disabled={switchingProvider}
                    className="h-6 px-2.5 bg-primary/10 text-primary text-[11px] font-bold rounded-lg hover:bg-primary/20 transition-colors">
                    {es.ttsSetProvider}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {providersLoaded && providers.length === 0 && (
          <p className="text-[10px] text-slate-400 py-4 text-center">—</p>
        )}
      </ConfigSection>

      {/* TTS Preview */}
      <ConfigSection title={es.ttsConvert} icon="play_circle" iconColor="text-fuchsia-500" defaultOpen={false}>
        <div className="space-y-2">
          <input value={previewText} onChange={e => setPreviewText(e.target.value)}
            placeholder={es.ttsConvertText}
            className="w-full h-8 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] text-slate-700 dark:text-white/70 outline-none" />
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

      {/* Talk Mode (live) */}
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

      {/* Voice Config (static) */}
      <ConfigSection title={es.audioConfig} icon="mic" iconColor="text-fuchsia-500" defaultOpen={false}>
        <TextField label={es.talkProvider} tooltip={tip('talk.provider')} value={getField(['talk', 'provider']) || ''} onChange={v => setField(['talk', 'provider'], v)} placeholder="elevenlabs" />
        <TextField label={es.voiceId} tooltip={tip('talk.voiceId')} value={getField(['talk', 'voiceId']) || ''} onChange={v => setField(['talk', 'voiceId'], v)} placeholder={es.phVoiceId} />
        <TextField label={es.audioModelId} tooltip={tip('talk.modelId')} value={getField(['talk', 'modelId']) || ''} onChange={v => setField(['talk', 'modelId'], v)} placeholder={es.phModelId} />
        <TextField label={es.talkOutputFormat} tooltip={tip('talk.outputFormat')} value={getField(['talk', 'outputFormat']) || ''} onChange={v => setField(['talk', 'outputFormat'], v)} placeholder="mp3" />
        <PasswordField label={es.audioApiKey} tooltip={tip('talk.apiKey')} value={getField(['talk', 'apiKey']) || ''} onChange={v => setField(['talk', 'apiKey'], v)} />
        <SwitchField label={es.audioInterrupt} tooltip={tip('talk.interruptOnSpeech')} value={getField(['talk', 'interruptOnSpeech']) === true} onChange={v => setField(['talk', 'interruptOnSpeech'], v)} />
      </ConfigSection>

      <ConfigSection title={es.audioTranscription} icon="hearing" iconColor="text-fuchsia-500" defaultOpen={false}>
        <ArrayField label={es.audioCommand} tooltip={tip('audio.transcription.command')} value={getField(['audio', 'transcription', 'command']) || []} onChange={v => setField(['audio', 'transcription', 'command'], v)} placeholder={es.phWhisperCommand} />
        <NumberField label={es.timeoutS} tooltip={tip('audio.transcription.timeoutSeconds')} value={getField(['audio', 'transcription', 'timeoutSeconds'])} onChange={v => setField(['audio', 'transcription', 'timeoutSeconds'], v)} min={1} />
      </ConfigSection>

      <ConfigSection title={es.ttsConfig} icon="record_voice_over" iconColor="text-fuchsia-500" defaultOpen={false}>
        <SelectField label={es.ttsProvider} tooltip={tip('messages.tts.provider')} value={getField(['messages', 'tts', 'provider']) || ''} onChange={v => setField(['messages', 'tts', 'provider'], v)}
          options={[
            { value: '', label: '—' },
            { value: 'elevenlabs', label: es.ttsProviderElevenLabs },
            { value: 'openai', label: es.ttsProviderOpenAI },
            { value: 'edge', label: es.ttsProviderEdge }
          ]} />
        <SwitchField label={es.autoTts} tooltip={tip('messages.tts.auto')} value={getField(['messages', 'tts', 'auto']) === true} onChange={v => setField(['messages', 'tts', 'auto'], v)} />
        <TextField label={es.mode} tooltip={tip('messages.tts.mode')} value={getField(['messages', 'tts', 'mode']) || ''} onChange={v => setField(['messages', 'tts', 'mode'], v)} placeholder={es.phReplyInline} />
        <PasswordField label={es.audioApiKey} value={getField(['messages', 'tts', 'apiKey']) || ''} onChange={v => setField(['messages', 'tts', 'apiKey'], v)} />
        <TextField label={es.voiceId} value={getField(['messages', 'tts', 'voiceId']) || ''} onChange={v => setField(['messages', 'tts', 'voiceId'], v)} />
      </ConfigSection>

      {/* Voice Wake */}
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
    </div>
  );
};
