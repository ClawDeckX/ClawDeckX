import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, ConfigCard, TextField, PasswordField, SelectField, ArrayField, AddButton, EmptyState } from '../fields';
import { getTranslation } from '../../../locales';

// Options moved inside component

export const AuthSection: React.FC<SectionProps> = ({ setField, getField, deleteField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const rawProfiles = getField(['auth', 'profiles']);
  const profiles: any[] = Array.isArray(rawProfiles) ? rawProfiles : [];
  const rawOrder = getField(['auth', 'order']);
  const order: string[] = Array.isArray(rawOrder) ? rawOrder : [];

  const AUTH_MODE_OPTIONS = useMemo(() => [
    { value: 'api-key', label: es.modeApiKey }, { value: 'oauth', label: es.modeOAuth }, { value: 'token', label: es.modeToken },
  ], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.authOrderTitle} icon="sort" iconColor="text-red-500">
        <ArrayField label={es.providerOrderLabel} desc={es.authOrderHint} value={order} onChange={v => setField(['auth', 'order'], v)} placeholder="provider_name" />
      </ConfigSection>

      <ConfigSection
        title={es.authConfig}
        icon="key"
        iconColor="text-red-500"
        desc={`${profiles.length} ${es.authProfiles}`}
      >
        {profiles.length === 0 ? (
          <EmptyState message={es.noAuthProfiles} icon="key_off" />
        ) : (
          profiles.map((p: any, i: number) => (
            <ConfigCard key={i} title={p.provider || `${es.profileN} ${i + 1}`} icon="key" onDelete={() => {
              const next = profiles.filter((_: any, j: number) => j !== i);
              setField(['auth', 'profiles'], next);
            }}>
              <TextField label={es.provider} value={p.provider || ''} onChange={v => {
                const next = [...profiles]; next[i] = { ...next[i], provider: v }; setField(['auth', 'profiles'], next);
              }} />
              <SelectField label={es.mode} value={p.mode || 'api-key'} onChange={v => {
                const next = [...profiles]; next[i] = { ...next[i], mode: v }; setField(['auth', 'profiles'], next);
              }} options={AUTH_MODE_OPTIONS} />
              <TextField label={es.authEmail} value={p.email || ''} onChange={v => {
                const next = [...profiles]; next[i] = { ...next[i], email: v }; setField(['auth', 'profiles'], next);
              }} placeholder="user@example.com" />
            </ConfigCard>
          ))
        )}
        <AddButton label={es.addAuthProfile} onClick={() => {
          setField(['auth', 'profiles'], [...profiles, { provider: '', mode: 'api-key' }]);
        }} />
      </ConfigSection>

      <ConfigSection title={es.authCooldowns} icon="timer" iconColor="text-red-500" defaultOpen={false}>
        <TextField label={es.authCooldownConfig} desc={es.authCooldownDesc} value={JSON.stringify(getField(['auth', 'cooldowns']) || {}, null, 2)} onChange={v => {
          try { setField(['auth', 'cooldowns'], JSON.parse(v)); } catch {}
        }} multiline />
      </ConfigSection>
    </div>
  );
};
