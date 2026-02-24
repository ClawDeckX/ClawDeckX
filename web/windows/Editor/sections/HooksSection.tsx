import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, ConfigCard, TextField, PasswordField, NumberField, SwitchField, ArrayField, AddButton, EmptyState } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

export const HooksSection: React.FC<SectionProps> = ({ setField, getField, deleteField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['hooks', ...p]);
  const s = (p: string[], v: any) => setField(['hooks', ...p], v);
  const mappings: any[] = g(['mappings']) || [];

  return (
    <div className="space-y-4">
      <ConfigSection title={es.basicSettings} icon="settings" iconColor="text-pink-500">
        <SwitchField label={es.enableHooks} tooltip={tip('hooks.enabled')} value={g(['enabled']) === true} onChange={v => s(['enabled'], v)} />
        <TextField label={es.webhookPath} tooltip={tip('hooks.path')} value={g(['path']) || ''} onChange={v => s(['path'], v)} placeholder="/hooks" />
        <PasswordField label={es.webhookToken} tooltip={tip('hooks.token')} value={g(['token']) || ''} onChange={v => s(['token'], v)} />
        <NumberField label={es.maxBodyBytes} tooltip={tip('hooks.maxBodyBytes')} value={g(['maxBodyBytes'])} onChange={v => s(['maxBodyBytes'], v)} min={0} />
        <ArrayField label={es.presets} tooltip={tip('hooks.presets')} value={g(['presets']) || []} onChange={v => s(['presets'], v)} placeholder="preset_name" />
      </ConfigSection>

      <ConfigSection
        title={es.hookMappings}
        icon="route"
        iconColor="text-pink-500"
        desc={`${mappings.length} ${es.rules}`}
        defaultOpen={false}
      >
        {mappings.length === 0 ? (
          <EmptyState message={es.noMappings} icon="route" />
        ) : (
          mappings.map((m: any, i: number) => (
            <ConfigCard key={i} title={m.match || m.action || `Mapping ${i + 1}`} icon="webhook" onDelete={() => {
              const next = mappings.filter((_: any, j: number) => j !== i);
              s(['mappings'], next);
            }}>
              <TextField label={es.hookMatch} value={m.match || ''} onChange={v => { const next = [...mappings]; next[i] = { ...next[i], match: v }; s(['mappings'], next); }} placeholder="pattern" />
              <TextField label={es.hookAction} value={m.action || ''} onChange={v => { const next = [...mappings]; next[i] = { ...next[i], action: v }; s(['mappings'], next); }} placeholder="send / forward" />
              <TextField label={es.hookChannel || es.channel} value={m.channel || ''} onChange={v => { const next = [...mappings]; next[i] = { ...next[i], channel: v }; s(['mappings'], next); }} placeholder="telegram" />
              <TextField label={es.hookModel || es.model} value={m.model || ''} onChange={v => { const next = [...mappings]; next[i] = { ...next[i], model: v }; s(['mappings'], next); }} placeholder="provider/model" />
            </ConfigCard>
          ))
        )}
        <AddButton label={es.addMapping} onClick={() => s(['mappings'], [...mappings, { match: '', action: 'send' }])} />
      </ConfigSection>

      <ConfigSection title={es.gmailConfig} icon="mail" iconColor="text-red-500" defaultOpen={false}>
        <SwitchField label={es.gmailEnabled} tooltip={tip('hooks.gmail.enabled')} value={g(['gmail', 'enabled']) === true} onChange={v => s(['gmail', 'enabled'], v)} />
        <TextField label={es.credentialsPath} tooltip={tip('hooks.gmail.credentialsPath')} value={g(['gmail', 'credentialsPath']) || ''} onChange={v => s(['gmail', 'credentialsPath'], v)} />
        <TextField label={es.tokenPath} tooltip={tip('hooks.gmail.tokenPath')} value={g(['gmail', 'tokenPath']) || ''} onChange={v => s(['gmail', 'tokenPath'], v)} />
      </ConfigSection>

      <ConfigSection title={es.internalHooks} icon="settings_ethernet" iconColor="text-slate-500" defaultOpen={false}>
        <SwitchField label={es.internalEnabled} tooltip={tip('hooks.internal.enabled')} value={g(['internal', 'enabled']) === true} onChange={v => s(['internal', 'enabled'], v)} />
      </ConfigSection>
    </div>
  );
};
