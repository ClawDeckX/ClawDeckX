import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, PasswordField, NumberField, SelectField, SwitchField, ArrayField, KeyValueField } from '../fields';
import { getTranslation } from '../../../locales';
import { schemaTooltip, schemaDefault } from '../schemaTooltip';
import SchemaRemainder from '../SchemaRemainder';

// Options moved inside component

export const MessagesSection: React.FC<SectionProps> = ({ config, schema, setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => schemaTooltip(key, language, schema);
  const def = (key: string) => schemaDefault(key, schema);
  const g = (p: string[]) => getField(['messages', ...p]);
  const s = (p: string[], v: any) => setField(['messages', ...p], v);
  const tg = (p: string[]) => getField(['tools', 'message', ...p]);
  const ts = (p: string[], v: any) => setField(['tools', 'message', ...p], v);
  const sg = (p: string[]) => getField(['session', ...p]);
  const ss = (p: string[], v: any) => setField(['session', ...p], v);

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
  const TYPING_OPTIONS = useMemo(() => [
    { value: 'never', label: es.optNever }, { value: 'instant', label: es.optInstant }, { value: 'thinking', label: es.optThinking }, { value: 'message', label: es.optMessage },
  ], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.prefixes} icon="format_quote" iconColor="text-cyan-500">
        <TextField label={es.messagePrefix} tooltip={tip('messages.messagePrefix')} value={g(['messagePrefix']) || ''} onChange={v => s(['messagePrefix'], v)} mono={false} placeholder={es.phUserPrefix} />
        <TextField label={es.responsePrefix} tooltip={tip('messages.responsePrefix')} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} mono={false} placeholder={es.phBotPrefix} />
      </ConfigSection>

      <ConfigSection title={es.ackReaction} icon="thumb_up" iconColor="text-amber-500">
        <TextField label={es.ackEmoji} tooltip={tip('messages.ackReaction')} value={g(['ackReaction']) || ''} onChange={v => s(['ackReaction'], v)} placeholder={es.phAckEmoji} mono={false} />
        <SelectField label={es.ackScope} tooltip={tip('messages.ackReactionScope')} value={g(['ackReactionScope']) || 'group-mentions'} onChange={v => s(['ackReactionScope'], v)} options={ACK_SCOPE_OPTIONS} />
        <SwitchField label={es.removeAfterReply} tooltip={tip('messages.removeAckAfterReply')} value={g(['removeAckAfterReply']) === true} onChange={v => s(['removeAckAfterReply'], v)} />
      </ConfigSection>

      <ConfigSection title={es.replyVisibility || 'Reply Visibility'} icon="visibility" iconColor="text-blue-500" defaultOpen={false}>
        <SwitchField label={es.visibleReplies || 'Visible Replies'} desc={es.visibleRepliesDesc} tooltip={tip('messages.visibleReplies')} value={g(['visibleReplies']) === true} onChange={v => s(['visibleReplies'], v)} />
      </ConfigSection>

      <ConfigSection title={es.groupChat} icon="group" iconColor="text-green-500" defaultOpen={false}>
        <ArrayField label={es.mentionPatterns} tooltip={tip('messages.groupChat.mentionPatterns')} value={g(['groupChat', 'mentionPatterns']) || []} onChange={v => s(['groupChat', 'mentionPatterns'], v)} placeholder={es.phMentionPatterns} />
        <NumberField label={es.historyLimit} tooltip={tip('messages.groupChat.historyLimit')} value={g(['groupChat', 'historyLimit'])} onChange={v => s(['groupChat', 'historyLimit'], v)} min={0} placeholder={def('messages.groupChat.historyLimit')} />
        <SwitchField label={es.groupVisibleReplies || 'Group Visible Replies'} desc={es.groupVisibleRepliesDesc} tooltip={tip('messages.groupChat.visibleReplies')} value={g(['groupChat', 'visibleReplies']) === true} onChange={v => s(['groupChat', 'visibleReplies'], v)} />
      </ConfigSection>

      <ConfigSection title={es.messageQueue} icon="queue" iconColor="text-indigo-500" defaultOpen={false}>
        <SelectField label={es.mode} tooltip={tip('messages.queue.mode')} value={g(['queue', 'mode']) || 'debounce'} onChange={v => s(['queue', 'mode'], v)} options={QUEUE_MODE_OPTIONS} />
        <NumberField label={es.debounceMs} tooltip={tip('messages.queue.debounceMs')} value={g(['queue', 'debounceMs'])} onChange={v => s(['queue', 'debounceMs'], v)} min={0} step={100} placeholder={def('messages.queue.debounceMs')} />
        <NumberField label={es.queueCap} tooltip={tip('messages.queue.cap')} value={g(['queue', 'cap'])} onChange={v => s(['queue', 'cap'], v)} min={1} placeholder={def('messages.queue.cap')} />
        <SwitchField label={es.dropWhenFull} tooltip={tip('messages.queue.drop')} value={g(['queue', 'drop']) === true} onChange={v => s(['queue', 'drop'], v)} />
        <KeyValueField label={es.queueByChannel || 'Queue Mode by Channel'} tooltip={tip('messages.queue.byChannel')} value={g(['queue', 'byChannel']) || {}} onChange={v => s(['queue', 'byChannel'], v)} />
        <KeyValueField label={es.debounceMsByChannel || 'Debounce by Channel (ms)'} tooltip={tip('messages.queue.debounceMsByChannel')} value={g(['queue', 'debounceMsByChannel']) || {}} onChange={v => s(['queue', 'debounceMsByChannel'], v)} />
      </ConfigSection>

      <ConfigSection title={es.statusReactions || 'Status Reactions'} icon="emoji_emotions" iconColor="text-yellow-500" defaultOpen={false}>
        <SwitchField label={es.statusReactionsEnabled || 'Enable Status Reactions'} tooltip={tip('messages.statusReactions.enabled')} value={g(['statusReactions', 'enabled']) === true} onChange={v => s(['statusReactions', 'enabled'], v)} />
        <TextField label={es.statusReactionsEmojis || 'Emojis'} tooltip={tip('messages.statusReactions.emojis')} value={g(['statusReactions', 'emojis']) || ''} onChange={v => s(['statusReactions', 'emojis'], v)} mono={false} />
        <TextField label={es.statusReactionsTiming || 'Timing'} tooltip={tip('messages.statusReactions.timing')} value={g(['statusReactions', 'timing']) || ''} onChange={v => s(['statusReactions', 'timing'], v)} />
      </ConfigSection>

      <ConfigSection title={es.toolErrorWarnings || 'Tool Error Warnings'} icon="warning" iconColor="text-amber-500" defaultOpen={false}>
        <SwitchField label={es.suppressToolErrors || 'Suppress Tool Error Warnings'} tooltip={tip('messages.suppressToolErrors')} value={g(['suppressToolErrors']) === true} onChange={v => s(['suppressToolErrors'], v)} />
      </ConfigSection>

      <ConfigSection title={es.typingMode} icon="edit_note" iconColor="text-purple-500" defaultOpen={false}>
        <SelectField label={es.mode} tooltip={tip('session.typingMode')} value={sg(['typingMode']) || 'never'} onChange={v => ss(['typingMode'], v)} options={TYPING_OPTIONS} />
        <NumberField label={es.typingIntervalS} tooltip={tip('session.typingIntervalSeconds')} value={sg(['typingIntervalSeconds'])} onChange={v => ss(['typingIntervalSeconds'], v)} min={1} placeholder={def('session.typingIntervalSeconds')} />
      </ConfigSection>

      <ConfigSection title={es.ttsConfig} icon="record_voice_over" iconColor="text-fuchsia-500" defaultOpen={false}>
        <TextField label={es.ttsProvider} tooltip={tip('messages.tts.provider')} value={g(['tts', 'provider']) || ''} onChange={v => s(['tts', 'provider'], v || undefined)} placeholder="elevenlabs" />
        <SelectField label={es.autoTts} tooltip={tip('messages.tts.auto')} value={g(['tts', 'auto']) || 'off'} onChange={v => s(['tts', 'auto'], v === 'off' ? undefined : v)}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'always', label: 'Always' },
            { value: 'inbound', label: 'Inbound Only' },
            { value: 'tagged', label: 'Tagged Only' }
          ]} />
        <SelectField label={es.mode} tooltip={tip('messages.tts.mode')} value={g(['tts', 'mode']) || 'final'} onChange={v => s(['tts', 'mode'], v === 'final' ? undefined : v)}
          options={[
            { value: 'final', label: 'Final' },
            { value: 'all', label: 'All' }
          ]} />
        <TextField label={es.ttsPersona || 'Persona'} tooltip={tip('messages.tts.persona')} value={g(['tts', 'persona']) || ''} onChange={v => s(['tts', 'persona'], v || undefined)} placeholder="default" />
      </ConfigSection>

      <ConfigSection title={es.messageTools} icon="send" iconColor="text-cyan-500" defaultOpen={false}>
        <SwitchField label={es.crossContextSend} tooltip={tip('tools.message.crossContext')} value={tg(['crossContext']) === true} onChange={v => ts(['crossContext'], v)} />
        <SwitchField label={es.broadcast} tooltip={tip('tools.message.broadcast')} value={tg(['broadcast']) === true} onChange={v => ts(['broadcast'], v)} />
      </ConfigSection>

      <ConfigSection title={es.inboundDebounce} icon="input" iconColor="text-teal-500" defaultOpen={false}>
        <NumberField label={es.debounceMs} tooltip={tip('messages.inbound.debounceMs')} value={g(['inbound', 'debounceMs'])} onChange={v => s(['inbound', 'debounceMs'], v)} min={0} step={100} placeholder={def('messages.inbound.debounceMs')} />
        <KeyValueField label={es.inboundByChannel || 'Debounce by Channel'} tooltip={tip('messages.inbound.byChannel')} value={g(['inbound', 'byChannel']) || {}} onChange={v => s(['inbound', 'byChannel'], v)} />
      </ConfigSection>

      <ConfigSection title={es.broadcast} icon="campaign" iconColor="text-rose-500" defaultOpen={false}>
        <SelectField label={es.strategy} tooltip={tip('broadcast.strategy')} value={getField(['broadcast', 'strategy']) || 'parallel'} onChange={v => setField(['broadcast', 'strategy'], v)} options={BROADCAST_STRATEGY_OPTIONS} />
      </ConfigSection>

      <SchemaRemainder
        sectionPath="messages"
        handledKeys={[
          'prefix', 'responsePrefix', 'ack', 'typing', 'history',
          'queue', 'tts', 'statusReactions', 'inbound', 'visibleReplies',
          'groupChat', 'messagePrefix', 'responsePrefix', 'ackReaction',
          'ackReactionScope', 'removeAckAfterReply', 'suppressToolErrors',
        ]}
        config={config}
        setField={setField}
        language={language}
        schema={schema}
        title={es.schemaAdditional || 'Additional Message Fields'}
      />
    </div>
  );
};
