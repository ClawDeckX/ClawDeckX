import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, SelectField, SwitchField, KeyValueField, NumberField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

// Options moved inside component

export const MiscSection: React.FC<SectionProps> = ({ setField, getField, deleteField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);

  const UPDATE_CHANNEL_OPTIONS = useMemo(() => [
    { value: 'stable', label: es.optStable }, { value: 'beta', label: es.optBeta }, { value: 'dev', label: es.optDev },
  ], [es]);

  return (
    <div className="space-y-4">
      {/* Update */}
      <ConfigSection title={es.updateConfig} icon="system_update" iconColor="text-blue-500">
        <SelectField label={es.updateChannel} tooltip={tip('update.channel')} value={getField(['update', 'channel']) || 'stable'} onChange={v => setField(['update', 'channel'], v)} options={UPDATE_CHANNEL_OPTIONS} />
        <SwitchField label={es.checkOnStart} tooltip={tip('update.checkOnStart')} value={getField(['update', 'checkOnStart']) !== false} onChange={v => setField(['update', 'checkOnStart'], v)} />
        <SwitchField label={es.autoUpdateEnabled} tooltip={tip('update.auto.enabled')} value={getField(['update', 'auto', 'enabled']) === true} onChange={v => setField(['update', 'auto', 'enabled'], v)} />
        <NumberField label={es.autoStableDelayH} tooltip={tip('update.auto.stableDelayHours')} value={getField(['update', 'auto', 'stableDelayHours'])} onChange={v => setField(['update', 'auto', 'stableDelayHours'], v)} min={0} max={168} />
        <NumberField label={es.autoStableJitterH} tooltip={tip('update.auto.stableJitterHours')} value={getField(['update', 'auto', 'stableJitterHours'])} onChange={v => setField(['update', 'auto', 'stableJitterHours'], v)} min={0} max={168} />
        <NumberField label={es.autoBetaCheckH} tooltip={tip('update.auto.betaCheckIntervalHours')} value={getField(['update', 'auto', 'betaCheckIntervalHours'])} onChange={v => setField(['update', 'auto', 'betaCheckIntervalHours'], v)} min={1} max={24} />
      </ConfigSection>

      {/* UI */}
      <ConfigSection title={es.uiConfig} icon="palette" iconColor="text-pink-500" defaultOpen={false}>
        <TextField label={es.seamColor} tooltip={tip('ui.seamColor')} value={getField(['ui', 'seamColor']) || ''} onChange={v => setField(['ui', 'seamColor'], v)} placeholder={es.phColorHex} />
        <TextField label={es.assistantName} tooltip={tip('ui.assistant.name')} value={getField(['ui', 'assistant', 'name']) || ''} onChange={v => setField(['ui', 'assistant', 'name'], v)} mono={false} placeholder={es.phAssistantName} />
        <TextField label={es.assistantAvatar} tooltip={tip('ui.assistant.avatar')} value={getField(['ui', 'assistant', 'avatar']) || ''} onChange={v => setField(['ui', 'assistant', 'avatar'], v)} placeholder={es.phHttps} />
      </ConfigSection>

      {/* Env */}
      <ConfigSection title={es.envVars} icon="settings_system_daydream" iconColor="text-slate-500" defaultOpen={false}>
        <SwitchField label={es.shellEnvEnabled} tooltip={tip('env.shellEnv.enabled')} value={getField(['env', 'shellEnv', 'enabled']) === true} onChange={v => setField(['env', 'shellEnv', 'enabled'], v)} />
        <NumberField label={es.shellEnvTimeoutMs} tooltip={tip('env.shellEnv.timeoutMs')} value={getField(['env', 'shellEnv', 'timeoutMs'])} onChange={v => setField(['env', 'shellEnv', 'timeoutMs'], v)} min={0} step={1000} />
        <KeyValueField label={es.variables} tooltip={tip('env.vars')} value={getField(['env', 'vars']) || {}} onChange={v => setField(['env', 'vars'], v)} />
      </ConfigSection>

    </div>
  );
};
