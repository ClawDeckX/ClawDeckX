import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, SelectField, NumberField, SwitchField, TextField, ArrayField, KeyValueField } from '../fields';
import { getTranslation } from '../../../locales';
import { schemaTooltip, schemaDefault } from '../schemaTooltip';
import SchemaRemainder from '../SchemaRemainder';

// Options moved inside component

export const SessionSection: React.FC<SectionProps> = ({ config, schema, setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => schemaTooltip(key, language, schema);
  const def = (key: string) => schemaDefault(key, schema);
  const g = (p: string[]) => getField(['session', ...p]);
  const s = (p: string[], v: any) => setField(['session', ...p], v);

  const SCOPE_OPTIONS = useMemo(() => [{ value: 'per-sender', label: es.optPerSender }, { value: 'global', label: es.optGlobal }], [es]);
  const DM_SCOPE_OPTIONS = useMemo(() => [
    { value: 'main', label: es.optMain }, { value: 'per-peer', label: es.optPerPeer },
    { value: 'per-channel-peer', label: es.optPerChannelPeer }, { value: 'per-account-channel-peer', label: es.optPerAccountChannelPeer },
  ], [es]);
  const RESET_MODE_OPTIONS = useMemo(() => [{ value: 'daily', label: es.optDaily }, { value: 'idle', label: es.optIdle }, { value: 'off', label: es.optOff }], [es]);
  const MAINT_MODE_OPTIONS = useMemo(() => [{ value: 'enforce', label: es.maintEnforce || 'Enforce' }, { value: 'warn', label: es.maintWarn || 'Warn' }], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.sessionScope} icon="account_tree" iconColor="text-indigo-500">
        <SelectField label={es.scope} desc={es.scopeDesc} tooltip={tip('session.scope')} value={g(['scope']) || 'per-sender'} onChange={v => s(['scope'], v)} options={SCOPE_OPTIONS} />
        <SelectField label={es.dmScope} tooltip={tip('session.dmScope')} value={g(['dmScope']) || 'main'} onChange={v => s(['dmScope'], v)} options={DM_SCOPE_OPTIONS} />
        <NumberField label={es.idleMinutes} tooltip={tip('session.idleMinutes')} value={g(['idleMinutes'])} onChange={v => s(['idleMinutes'], v)} min={0} placeholder={def('session.idleMinutes')} />
        <TextField label={es.sessionStore} tooltip={tip('session.store')} value={g(['store']) || ''} onChange={v => s(['store'], v)} />
        <TextField label={es.sessionMainKey} tooltip={tip('session.mainKey')} value={g(['mainKey']) || ''} onChange={v => s(['mainKey'], v)} placeholder="main" />
        <ArrayField label={es.resetTriggers} tooltip={tip('session.resetTriggers')} value={g(['resetTriggers']) || []} onChange={v => s(['resetTriggers'], v)} placeholder="/reset" />
        <KeyValueField label={es.identityLinks || 'Identity Links'} tooltip={tip('session.identityLinks')} value={g(['identityLinks']) || {}} onChange={v => s(['identityLinks'], v)} />
      </ConfigSection>

      <ConfigSection title={es.sessionReset} icon="restart_alt" iconColor="text-orange-500">
        <SelectField label={es.resetMode} tooltip={tip('session.reset.mode')} value={g(['reset', 'mode']) || 'idle'} onChange={v => s(['reset', 'mode'], v)} options={RESET_MODE_OPTIONS} />
        {g(['reset', 'mode']) === 'daily' && (
          <NumberField label={es.atHour} tooltip={tip('session.reset.atHour')} value={g(['reset', 'atHour'])} onChange={v => s(['reset', 'atHour'], v)} min={0} max={23} placeholder={def('session.reset.atHour')} />
        )}
        {g(['reset', 'mode']) === 'idle' && (
          <NumberField label={es.idleMinutes} tooltip={tip('session.reset.idleMinutes')} value={g(['reset', 'idleMinutes'])} onChange={v => s(['reset', 'idleMinutes'], v)} min={1} placeholder={def('session.reset.idleMinutes')} />
        )}
      </ConfigSection>

      <ConfigSection title={es.resetByType} icon="category" iconColor="text-teal-500" defaultOpen={false}>
        <SelectField label={es.direct || 'Direct'} tooltip={tip('session.resetByType.direct')} value={g(['resetByType', 'direct', 'mode']) || ''} onChange={v => s(['resetByType', 'direct', 'mode'], v)} options={RESET_MODE_OPTIONS} allowEmpty />
        <SelectField label={es.dm} tooltip={tip('session.resetByType.dm')} value={g(['resetByType', 'dm', 'mode']) || ''} onChange={v => s(['resetByType', 'dm', 'mode'], v)} options={RESET_MODE_OPTIONS} allowEmpty />
        <SelectField label={es.group} tooltip={tip('session.resetByType.group')} value={g(['resetByType', 'group', 'mode']) || ''} onChange={v => s(['resetByType', 'group', 'mode'], v)} options={RESET_MODE_OPTIONS} allowEmpty />
        <SelectField label={es.thread} tooltip={tip('session.resetByType.thread')} value={g(['resetByType', 'thread', 'mode']) || ''} onChange={v => s(['resetByType', 'thread', 'mode'], v)} options={RESET_MODE_OPTIONS} allowEmpty />
        <KeyValueField label={es.resetByChannel || 'Reset by Channel'} tooltip={tip('session.resetByChannel')} value={g(['resetByChannel']) || {}} onChange={v => s(['resetByChannel'], v)} />
      </ConfigSection>

      <ConfigSection title={es.threadBindings} icon="link" iconColor="text-cyan-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('session.threadBindings.enabled')} value={g(['threadBindings', 'enabled']) === true} onChange={v => s(['threadBindings', 'enabled'], v)} />
        <NumberField label={es.tbIdleHours} tooltip={tip('session.threadBindings.idleHours')} value={g(['threadBindings', 'idleHours'])} onChange={v => s(['threadBindings', 'idleHours'], v)} min={0} placeholder={def('session.threadBindings.idleHours')} />
        <NumberField label={es.tbMaxAgeHours} tooltip={tip('session.threadBindings.maxAgeHours')} value={g(['threadBindings', 'maxAgeHours'])} onChange={v => s(['threadBindings', 'maxAgeHours'], v)} min={0} placeholder={def('session.threadBindings.maxAgeHours')} />
      </ConfigSection>

      <ConfigSection title={es.sessionMaintenance} icon="cleaning_services" iconColor="text-amber-500" defaultOpen={false}>
        <SelectField label={es.maintMode} tooltip={tip('session.maintenance.mode')} value={g(['maintenance', 'mode']) || 'enforce'} onChange={v => s(['maintenance', 'mode'], v)} options={MAINT_MODE_OPTIONS} />
        <TextField label={es.maintPruneAfter} tooltip={tip('session.maintenance.pruneAfter')} value={String(g(['maintenance', 'pruneAfter']) ?? '')} onChange={v => s(['maintenance', 'pruneAfter'], v)} placeholder="30d" />
        <NumberField label={es.maintMaxEntries} tooltip={tip('session.maintenance.maxEntries')} value={g(['maintenance', 'maxEntries'])} onChange={v => s(['maintenance', 'maxEntries'], v)} min={1} placeholder={def('session.maintenance.maxEntries')} />
        <TextField label={es.maintRotateBytes} tooltip={tip('session.maintenance.rotateBytes')} value={String(g(['maintenance', 'rotateBytes']) ?? '')} onChange={v => s(['maintenance', 'rotateBytes'], v)} placeholder="50mb" />
        <TextField label={es.maintMaxDiskBytes} tooltip={tip('session.maintenance.maxDiskBytes')} value={String(g(['maintenance', 'maxDiskBytes']) ?? '')} onChange={v => s(['maintenance', 'maxDiskBytes'], v)} placeholder="500mb" />
        <TextField label={es.maintHighWaterBytes || 'High-water Target'} tooltip={tip('session.maintenance.highWaterBytes')} value={String(g(['maintenance', 'highWaterBytes']) ?? '')} onChange={v => s(['maintenance', 'highWaterBytes'], v)} placeholder="400mb" />
        <NumberField label={es.maintPruneDays || 'Prune Days (Deprecated)'} tooltip={tip('session.maintenance.pruneDays')} value={g(['maintenance', 'pruneDays'])} onChange={v => s(['maintenance', 'pruneDays'], v)} min={0} placeholder={def('session.maintenance.pruneDays')} />
        <TextField label={es.maintResetArchiveRetention || 'Reset Archive Retention'} tooltip={tip('session.maintenance.resetArchiveRetention')} value={String(g(['maintenance', 'resetArchiveRetention']) ?? '')} onChange={v => s(['maintenance', 'resetArchiveRetention'], v)} placeholder="7d" />
      </ConfigSection>

      <ConfigSection title={es.sendPolicy || 'Send Policy'} icon="security" iconColor="text-rose-500" defaultOpen={false}>
        <SelectField label={es.sendPolicyDefault || 'Default Action'} tooltip={tip('session.sendPolicy.default')} value={g(['sendPolicy', 'default']) || 'allow'} onChange={v => s(['sendPolicy', 'default'], v)} options={[{ value: 'allow', label: es.optAllow || 'Allow' }, { value: 'deny', label: es.optDeny || 'Deny' }]} />
      </ConfigSection>

      <ConfigSection title={es.agentToAgentSession} icon="swap_horiz" iconColor="text-violet-500" defaultOpen={false}>
        <NumberField label={es.maxPingPongTurns} tooltip={tip('session.agentToAgent.maxPingPongTurns')} value={g(['agentToAgent', 'maxPingPongTurns'])} onChange={v => s(['agentToAgent', 'maxPingPongTurns'], v)} min={1} placeholder={def('session.agentToAgent.maxPingPongTurns')} />
      </ConfigSection>

      <SchemaRemainder
        sectionPath="session"
        handledKeys={[
          'scope', 'dmScope', 'idleMinutes', 'store', 'mainKey',
          'resetTriggers', 'identityLinks',
          'reset', 'resetByType', 'resetByChannel',
          'threadBindings', 'maintenance', 'sendPolicy', 'agentToAgent',
        ]}
        config={config}
        setField={setField}
        language={language}
        schema={schema}
        title={es.schemaAdditional || 'Additional Session Fields'}
      />
    </div>
  );
};
