import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, SelectField, NumberField, SwitchField, TextField, ArrayField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

// Options moved inside component

export const SessionSection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['session', ...p]);
  const s = (p: string[], v: any) => setField(['session', ...p], v);

  const SCOPE_OPTIONS = useMemo(() => [{ value: 'per-sender', label: es.optPerSender }, { value: 'global', label: es.optGlobal }], [es]);
  const DM_SCOPE_OPTIONS = useMemo(() => [
    { value: 'main', label: es.optMain }, { value: 'per-peer', label: es.optPerPeer },
    { value: 'per-channel-peer', label: es.optPerChannelPeer }, { value: 'per-account-channel-peer', label: es.optPerAccountChannelPeer },
  ], [es]);
  const RESET_MODE_OPTIONS = useMemo(() => [{ value: 'daily', label: es.optDaily }, { value: 'idle', label: es.optIdle }, { value: 'off', label: es.optOff }], [es]);
  const TYPING_OPTIONS = useMemo(() => [{ value: 'never', label: es.optNever }, { value: 'instant', label: es.optInstant }, { value: 'thinking', label: es.optThinking }, { value: 'message', label: es.optMessage }], [es]);
  const MAINT_MODE_OPTIONS = useMemo(() => [{ value: 'enforce', label: es.maintEnforce || 'Enforce' }, { value: 'warn', label: es.maintWarn || 'Warn' }], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.sessionScope} icon="account_tree" iconColor="text-indigo-500">
        <SelectField label={es.scope} desc={es.scopeDesc} tooltip={tip('session.scope')} value={g(['scope']) || 'per-sender'} onChange={v => s(['scope'], v)} options={SCOPE_OPTIONS} />
        <SelectField label={es.dmScope} tooltip={tip('session.dmScope')} value={g(['dmScope']) || 'main'} onChange={v => s(['dmScope'], v)} options={DM_SCOPE_OPTIONS} />
        <NumberField label={es.idleMinutes} tooltip={tip('session.idleMinutes')} value={g(['idleMinutes'])} onChange={v => s(['idleMinutes'], v)} min={0} />
        <TextField label={es.sessionStore} tooltip={tip('session.store')} value={g(['store']) || ''} onChange={v => s(['store'], v)} />
        <TextField label={es.sessionMainKey} tooltip={tip('session.mainKey')} value={g(['mainKey']) || ''} onChange={v => s(['mainKey'], v)} placeholder="main" />
        <NumberField label={es.typingIntervalS} tooltip={tip('session.typingIntervalSeconds')} value={g(['typingIntervalSeconds'])} onChange={v => s(['typingIntervalSeconds'], v)} min={1} />
        <NumberField label={es.parentForkMaxTokens} tooltip={tip('session.parentForkMaxTokens')} value={g(['parentForkMaxTokens'])} onChange={v => s(['parentForkMaxTokens'], v)} min={0} />
        <ArrayField label={es.resetTriggers} tooltip={tip('session.resetTriggers')} value={g(['resetTriggers']) || []} onChange={v => s(['resetTriggers'], v)} placeholder="/reset" />
      </ConfigSection>

      <ConfigSection title={es.sessionReset} icon="restart_alt" iconColor="text-orange-500">
        <SelectField label={es.resetMode} tooltip={tip('session.reset.mode')} value={g(['reset', 'mode']) || 'idle'} onChange={v => s(['reset', 'mode'], v)} options={RESET_MODE_OPTIONS} />
        {g(['reset', 'mode']) === 'daily' && (
          <NumberField label={es.atHour} tooltip={tip('session.reset.atHour')} value={g(['reset', 'atHour'])} onChange={v => s(['reset', 'atHour'], v)} min={0} max={23} />
        )}
        {g(['reset', 'mode']) === 'idle' && (
          <NumberField label={es.idleMinutes} tooltip={tip('session.reset.idleMinutes')} value={g(['reset', 'idleMinutes'])} onChange={v => s(['reset', 'idleMinutes'], v)} min={1} />
        )}
      </ConfigSection>

      <ConfigSection title={es.resetByType} icon="category" iconColor="text-teal-500" defaultOpen={false}>
        <SelectField label={es.dm} value={g(['resetByType', 'dm', 'mode']) || ''} onChange={v => s(['resetByType', 'dm', 'mode'], v)} options={RESET_MODE_OPTIONS} allowEmpty />
        <SelectField label={es.group} value={g(['resetByType', 'group', 'mode']) || ''} onChange={v => s(['resetByType', 'group', 'mode'], v)} options={RESET_MODE_OPTIONS} allowEmpty />
        <SelectField label={es.thread} value={g(['resetByType', 'thread', 'mode']) || ''} onChange={v => s(['resetByType', 'thread', 'mode'], v)} options={RESET_MODE_OPTIONS} allowEmpty />
      </ConfigSection>

      <ConfigSection title={es.typingMode} icon="edit_note" iconColor="text-purple-500" defaultOpen={false}>
        <SelectField label={es.mode} tooltip={tip('session.typingMode')} value={g(['typingMode']) || 'never'} onChange={v => s(['typingMode'], v)} options={TYPING_OPTIONS} />
      </ConfigSection>

      <ConfigSection title={es.threadBindings} icon="link" iconColor="text-cyan-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('session.threadBindings.enabled')} value={g(['threadBindings', 'enabled']) === true} onChange={v => s(['threadBindings', 'enabled'], v)} />
        <NumberField label={es.tbIdleHours} tooltip={tip('session.threadBindings.idleHours')} value={g(['threadBindings', 'idleHours'])} onChange={v => s(['threadBindings', 'idleHours'], v)} min={0} />
        <NumberField label={es.tbMaxAgeHours} tooltip={tip('session.threadBindings.maxAgeHours')} value={g(['threadBindings', 'maxAgeHours'])} onChange={v => s(['threadBindings', 'maxAgeHours'], v)} min={0} />
      </ConfigSection>

      <ConfigSection title={es.sessionMaintenance} icon="cleaning_services" iconColor="text-amber-500" defaultOpen={false}>
        <SelectField label={es.maintMode} tooltip={tip('session.maintenance.mode')} value={g(['maintenance', 'mode']) || 'enforce'} onChange={v => s(['maintenance', 'mode'], v)} options={MAINT_MODE_OPTIONS} />
        <TextField label={es.maintPruneAfter} tooltip={tip('session.maintenance.pruneAfter')} value={String(g(['maintenance', 'pruneAfter']) ?? '')} onChange={v => s(['maintenance', 'pruneAfter'], v)} placeholder="30d" />
        <NumberField label={es.maintMaxEntries} tooltip={tip('session.maintenance.maxEntries')} value={g(['maintenance', 'maxEntries'])} onChange={v => s(['maintenance', 'maxEntries'], v)} min={1} />
        <TextField label={es.maintRotateBytes} tooltip={tip('session.maintenance.rotateBytes')} value={String(g(['maintenance', 'rotateBytes']) ?? '')} onChange={v => s(['maintenance', 'rotateBytes'], v)} placeholder="50mb" />
        <TextField label={es.maintMaxDiskBytes} tooltip={tip('session.maintenance.maxDiskBytes')} value={String(g(['maintenance', 'maxDiskBytes']) ?? '')} onChange={v => s(['maintenance', 'maxDiskBytes'], v)} placeholder="500mb" />
      </ConfigSection>

      <ConfigSection title={es.agentToAgentSession} icon="swap_horiz" iconColor="text-violet-500" defaultOpen={false}>
        <NumberField label={es.maxPingPongTurns} tooltip={tip('session.agentToAgent.maxPingPongTurns')} value={g(['agentToAgent', 'maxPingPongTurns'])} onChange={v => s(['agentToAgent', 'maxPingPongTurns'], v)} min={1} />
      </ConfigSection>
    </div>
  );
};
