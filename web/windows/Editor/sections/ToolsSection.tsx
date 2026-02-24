import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, NumberField, SelectField, SwitchField, ArrayField, KeyValueField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

// Options moved inside component

export const ToolsSection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['tools', ...p]);
  const s = (p: string[], v: any) => setField(['tools', ...p], v);

  const PROFILE_OPTIONS = useMemo(() => [
    { value: 'minimal', label: es.profileMinimal || 'Minimal' }, { value: 'coding', label: es.profileCoding || 'Coding' },
    { value: 'messaging', label: es.profileMessaging || 'Messaging' }, { value: 'full', label: es.profileFull || 'Full' },
  ], [es]);

  const EXEC_HOST_OPTIONS = useMemo(() => [
    { value: 'local', label: es.optLocal || 'Local' }, { value: 'docker', label: es.optDocker || 'Docker' }, { value: 'ssh', label: es.optSsh || 'SSH' },
  ], [es]);

  const EXEC_SECURITY_OPTIONS = useMemo(() => [
    { value: 'standard', label: es.optStandard || 'Standard' }, { value: 'strict', label: es.optStrict || 'Strict' }, { value: 'permissive', label: es.optPermissive || 'Permissive' },
  ], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.toolProfile} icon="dashboard_customize" iconColor="text-orange-500">
        <SelectField label={es.profile} desc={es.profileDesc} tooltip={tip('tools.profile')} value={g(['profile']) || 'full'} onChange={v => s(['profile'], v)} options={PROFILE_OPTIONS} />
        <ArrayField label={es.allowList} tooltip={tip('tools.allow')} value={g(['allow']) || []} onChange={v => s(['allow'], v)} placeholder="tool_name" />
        <ArrayField label={es.denyList} tooltip={tip('tools.deny')} value={g(['deny']) || []} onChange={v => s(['deny'], v)} placeholder="tool_name" />
      </ConfigSection>

      <ConfigSection title={es.exec} icon="terminal" iconColor="text-red-500">
        <SelectField label={es.execHost} tooltip={tip('tools.exec.host')} value={g(['exec', 'host']) || 'local'} onChange={v => s(['exec', 'host'], v)} options={EXEC_HOST_OPTIONS} />
        <SelectField label={es.security} tooltip={tip('tools.exec.security')} value={g(['exec', 'security']) || 'standard'} onChange={v => s(['exec', 'security'], v)} options={EXEC_SECURITY_OPTIONS} />
        <SwitchField label={es.askBeforeExec} tooltip={tip('tools.exec.ask')} value={g(['exec', 'ask']) !== false} onChange={v => s(['exec', 'ask'], v)} />
        <NumberField label={es.timeoutS} tooltip={tip('tools.exec.timeout')} value={g(['exec', 'timeout'])} onChange={v => s(['exec', 'timeout'], v)} min={0} />
        <ArrayField label={es.safeBins} desc={es.safeBinsDesc} tooltip={tip('tools.exec.safeBins')} value={g(['exec', 'safeBins']) || []} onChange={v => s(['exec', 'safeBins'], v)} placeholder="ls, cat, grep..." />
      </ConfigSection>

      <ConfigSection title={es.webSearch} icon="search" iconColor="text-blue-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('tools.web.search.enabled')} value={g(['web', 'search', 'enabled']) !== false} onChange={v => s(['web', 'search', 'enabled'], v)} />
        <TextField label={es.provider} tooltip={tip('tools.web.search.provider')} value={g(['web', 'search', 'provider']) || ''} onChange={v => s(['web', 'search', 'provider'], v)} placeholder="brave / perplexity" />
        <TextField label={es.apiKeyTip || 'API Key'} value={g(['web', 'search', 'apiKey']) || ''} onChange={v => s(['web', 'search', 'apiKey'], v)} placeholder="..." />
      </ConfigSection>

      <ConfigSection title={es.webFetch} icon="language" iconColor="text-green-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('tools.web.fetch.enabled')} value={g(['web', 'fetch', 'enabled']) !== false} onChange={v => s(['web', 'fetch', 'enabled'], v)} />
        <TextField label={es.method} tooltip={tip('tools.web.fetch.method')} value={g(['web', 'fetch', 'method']) || ''} onChange={v => s(['web', 'fetch', 'method'], v)} placeholder="jina / browser" />
      </ConfigSection>

      <ConfigSection title={es.media} icon="image" iconColor="text-pink-500" defaultOpen={false}>
        <SwitchField label={es.imageUnderstanding} tooltip={tip('tools.media.image.enabled')} value={g(['media', 'image', 'enabled']) !== false} onChange={v => s(['media', 'image', 'enabled'], v)} />
        <SwitchField label={es.audioUnderstanding} tooltip={tip('tools.media.audio.enabled')} value={g(['media', 'audio', 'enabled']) !== false} onChange={v => s(['media', 'audio', 'enabled'], v)} />
        <SwitchField label={es.videoUnderstanding} tooltip={tip('tools.media.video.enabled')} value={g(['media', 'video', 'enabled']) !== false} onChange={v => s(['media', 'video', 'enabled'], v)} />
      </ConfigSection>

      <ConfigSection title={es.elevatedTools} icon="admin_panel_settings" iconColor="text-amber-500" defaultOpen={false}>
        <ArrayField label={es.allowedElevated} tooltip={tip('tools.elevated.allow')} value={g(['elevated', 'allow']) || []} onChange={v => s(['elevated', 'allow'], v)} placeholder="tool_name" />
      </ConfigSection>

      <ConfigSection title={es.messageTools} icon="send" iconColor="text-cyan-500" defaultOpen={false}>
        <SwitchField label={es.crossContextSend} tooltip={tip('tools.message.crossContext')} value={g(['message', 'crossContext']) === true} onChange={v => s(['message', 'crossContext'], v)} />
        <SwitchField label={es.broadcast} tooltip={tip('tools.message.broadcast')} value={g(['message', 'broadcast']) === true} onChange={v => s(['message', 'broadcast'], v)} />
      </ConfigSection>

      <ConfigSection title={es.agentToAgent} icon="swap_horiz" iconColor="text-violet-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('tools.agentToAgent.enabled')} value={g(['agentToAgent', 'enabled']) === true} onChange={v => s(['agentToAgent', 'enabled'], v)} />
      </ConfigSection>

      <ConfigSection title={es.canvasHost} icon="draw" iconColor="text-purple-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('canvasHost.enabled')} value={getField(['canvasHost', 'enabled']) === true} onChange={v => setField(['canvasHost', 'enabled'], v)} />
        <TextField label={es.root} tooltip={tip('canvasHost.root')} value={getField(['canvasHost', 'root']) || ''} onChange={v => setField(['canvasHost', 'root'], v)} />
        <NumberField label={es.port} tooltip={tip('canvasHost.port')} value={getField(['canvasHost', 'port'])} onChange={v => setField(['canvasHost', 'port'], v)} min={1} max={65535} />
        <SwitchField label={es.liveReload} tooltip={tip('canvasHost.liveReload')} value={getField(['canvasHost', 'liveReload']) !== false} onChange={v => setField(['canvasHost', 'liveReload'], v)} />
      </ConfigSection>

      <ConfigSection title={es.mediaFiles} icon="perm_media" iconColor="text-orange-500" defaultOpen={false}>
        <SwitchField label={es.preserveFilenames} tooltip={tip('media.preserveFilenames')} value={getField(['media', 'preserveFilenames']) === true} onChange={v => setField(['media', 'preserveFilenames'], v)} />
      </ConfigSection>
    </div>
  );
};
