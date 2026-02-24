import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, NumberField, SelectField, SwitchField, ArrayField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

// Options moved inside component

export const MessagesSection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['messages', ...p]);
  const s = (p: string[], v: any) => setField(['messages', ...p], v);

  const ACK_SCOPE_OPTIONS = useMemo(() => [
    { value: 'group-mentions', label: es.optGroupMentions }, { value: 'group-all', label: es.optGroupAll },
    { value: 'direct', label: es.optDirect }, { value: 'all', label: es.optAll },
  ], [es]);
  const QUEUE_MODE_OPTIONS = useMemo(() => [
    { value: 'fifo', label: es.optFifo }, { value: 'debounce', label: es.optDebounce }, { value: 'off', label: es.optOff },
  ], [es]);
  const BROADCAST_STRATEGY_OPTIONS = useMemo(() => [
    { value: 'parallel', label: es.optParallel }, { value: 'sequential', label: es.optSequential },
  ], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.prefixes} icon="format_quote" iconColor="text-cyan-500">
        <TextField label={es.messagePrefix} tooltip={tip('messages.messagePrefix')} value={g(['messagePrefix']) || ''} onChange={v => s(['messagePrefix'], v)} mono={false} placeholder="[User]" />
        <TextField label={es.responsePrefix} tooltip={tip('messages.responsePrefix')} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} mono={false} placeholder="[Bot]" />
      </ConfigSection>

      <ConfigSection title={es.ackReaction} icon="thumb_up" iconColor="text-amber-500">
        <TextField label={es.ackEmoji} tooltip={tip('messages.ackReaction')} value={g(['ackReaction']) || ''} onChange={v => s(['ackReaction'], v)} placeholder="👀" mono={false} />
        <SelectField label={es.ackScope} tooltip={tip('messages.ackReactionScope')} value={g(['ackReactionScope']) || 'group-mentions'} onChange={v => s(['ackReactionScope'], v)} options={ACK_SCOPE_OPTIONS} />
        <SwitchField label={es.removeAfterReply} tooltip={tip('messages.removeAckAfterReply')} value={g(['removeAckAfterReply']) === true} onChange={v => s(['removeAckAfterReply'], v)} />
      </ConfigSection>

      <ConfigSection title={es.groupChat} icon="group" iconColor="text-green-500" defaultOpen={false}>
        <ArrayField label={es.mentionPatterns} tooltip={tip('messages.groupChat.mentionPatterns')} value={g(['groupChat', 'mentionPatterns']) || []} onChange={v => s(['groupChat', 'mentionPatterns'], v)} placeholder="@bot, /ask" />
        <NumberField label={es.historyLimit} tooltip={tip('messages.groupChat.historyLimit')} value={g(['groupChat', 'historyLimit'])} onChange={v => s(['groupChat', 'historyLimit'], v)} min={0} />
      </ConfigSection>

      <ConfigSection title={es.messageQueue} icon="queue" iconColor="text-indigo-500" defaultOpen={false}>
        <SelectField label={es.mode} tooltip={tip('messages.queue.mode')} value={g(['queue', 'mode']) || 'debounce'} onChange={v => s(['queue', 'mode'], v)} options={QUEUE_MODE_OPTIONS} />
        <NumberField label={es.debounceMs} tooltip={tip('messages.queue.debounceMs')} value={g(['queue', 'debounceMs'])} onChange={v => s(['queue', 'debounceMs'], v)} min={0} step={100} />
        <NumberField label={es.queueCap} tooltip={tip('messages.queue.cap')} value={g(['queue', 'cap'])} onChange={v => s(['queue', 'cap'], v)} min={1} />
        <SwitchField label={es.dropWhenFull} tooltip={tip('messages.queue.drop')} value={g(['queue', 'drop']) === true} onChange={v => s(['queue', 'drop'], v)} />
      </ConfigSection>

      <ConfigSection title={es.inboundDebounce} icon="input" iconColor="text-teal-500" defaultOpen={false}>
        <NumberField label={es.debounceMs} tooltip={tip('messages.inbound.debounceMs')} value={g(['inbound', 'debounceMs'])} onChange={v => s(['inbound', 'debounceMs'], v)} min={0} step={100} />
      </ConfigSection>

      <ConfigSection title={es.broadcast} icon="campaign" iconColor="text-rose-500" defaultOpen={false}>
        <SelectField label={es.strategy} tooltip={tip('broadcast.strategy')} value={getField(['broadcast', 'strategy']) || 'parallel'} onChange={v => setField(['broadcast', 'strategy'], v)} options={BROADCAST_STRATEGY_OPTIONS} />
      </ConfigSection>
    </div>
  );
};
