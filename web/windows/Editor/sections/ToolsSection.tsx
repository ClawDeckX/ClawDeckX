import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, NumberField, SelectField, SwitchField, ArrayField, KeyValueField } from '../fields';
import { getTranslation } from '../../../locales';
import { schemaTooltip, schemaDefault } from '../schemaTooltip';
import { RequestOverridePanel } from './RequestOverridePanel';
import SchemaRemainder from '../SchemaRemainder';

// Options moved inside component

export const ToolsSection: React.FC<SectionProps> = ({ config, schema, setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => schemaTooltip(key, language, schema);
  const def = (key: string) => schemaDefault(key, schema);
  const g = (p: string[]) => getField(['tools', ...p]);
  const s = (p: string[], v: any) => setField(['tools', ...p], v);

  const PROFILE_OPTIONS = useMemo(() => [
    { value: 'minimal', label: es.profileMinimal }, { value: 'coding', label: es.profileCoding },
    { value: 'messaging', label: es.profileMessaging }, { value: 'full', label: es.profileFull },
  ], [es]);

  const EXEC_HOST_OPTIONS = useMemo(() => [
    { value: 'auto', label: es.optAuto || 'Auto' }, { value: 'sandbox', label: es.optSandbox || 'Sandbox' }, { value: 'gateway', label: es.optGateway || 'Gateway' }, { value: 'node', label: es.optNode || 'Node' },
  ], [es]);

  const EXEC_SECURITY_OPTIONS = useMemo(() => [
    { value: 'deny', label: es.optDeny || 'Deny' }, { value: 'allowlist', label: es.optAllowlist || 'Allowlist' }, { value: 'full', label: es.optFull },
  ], [es]);

  const EXEC_ASK_OPTIONS = useMemo(() => [
    { value: 'off', label: es.optOff }, { value: 'on-miss', label: es.optOnMiss || 'On Miss' }, { value: 'always', label: es.optAlways || 'Always' },
  ], [es]);

  const EXEC_ASK_FALLBACK_OPTIONS = useMemo(() => [
    { value: 'deny', label: es.optDeny || 'Deny' }, { value: 'allowlist', label: es.optAllowlist || 'Allowlist' },
  ], [es]);

  const SESSION_VISIBILITY_OPTIONS = useMemo(() => [
    { value: 'self', label: es.optSelf || 'Self' }, { value: 'tree', label: es.optTree || 'Tree' }, { value: 'agent', label: es.optAgent || 'Agent' }, { value: 'all', label: es.optAll || 'All' },
  ], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.toolProfile} icon="dashboard_customize" iconColor="text-orange-500">
        <SelectField label={es.profile} desc={es.profileDesc} tooltip={tip('tools.profile')} value={g(['profile']) || 'full'} onChange={v => s(['profile'], v)} options={PROFILE_OPTIONS} />
        <ArrayField label={es.allowList} tooltip={tip('tools.allow')} value={g(['allow']) || []} onChange={v => s(['allow'], v)} placeholder={es.phToolName} />
        <ArrayField label={es.denyList} tooltip={tip('tools.deny')} value={g(['deny']) || []} onChange={v => s(['deny'], v)} placeholder={es.phToolName} />
        <ArrayField label={es.alsoAllow || 'Also Allow'} tooltip={tip('tools.alsoAllow')} value={g(['alsoAllow']) || []} onChange={v => s(['alsoAllow'], v)} placeholder={es.phToolName} />
        <KeyValueField label={es.byProvider || 'Policy by Provider'} tooltip={tip('tools.byProvider')} value={g(['byProvider']) || {}} onChange={v => s(['byProvider'], v)} />
      </ConfigSection>

      <ConfigSection title={es.exec} icon="terminal" iconColor="text-red-500">
        <SelectField label={es.execHost} tooltip={tip('tools.exec.host')} value={g(['exec', 'host']) || 'auto'} onChange={v => s(['exec', 'host'], v)} options={EXEC_HOST_OPTIONS} />
        <SelectField label={es.security} tooltip={tip('tools.exec.security')} value={g(['exec', 'security']) || 'full'} onChange={v => s(['exec', 'security'], v)} options={EXEC_SECURITY_OPTIONS} />
        <SelectField label={es.askBeforeExec} tooltip={tip('tools.exec.ask')} value={g(['exec', 'ask']) || 'off'} onChange={v => s(['exec', 'ask'], v)} options={EXEC_ASK_OPTIONS} />
        <SelectField label={es.askFallback || 'Ask Fallback'} desc={es.askFallbackDesc} tooltip={tip('tools.exec.askFallback')} value={g(['exec', 'askFallback']) || 'deny'} onChange={v => s(['exec', 'askFallback'], v)} options={EXEC_ASK_FALLBACK_OPTIONS} />
        <NumberField label={es.timeoutS} tooltip={tip('tools.exec.timeout')} value={g(['exec', 'timeout'])} onChange={v => s(['exec', 'timeout'], v)} min={0} placeholder={def('tools.exec.timeout')} />
        <SwitchField label={es.strictInlineEval || 'Strict Inline Eval'} desc={es.strictInlineEvalDesc} tooltip={tip('tools.exec.strictInlineEval')} value={g(['exec', 'strictInlineEval']) === true} onChange={v => s(['exec', 'strictInlineEval'], v)} />
        <ArrayField label={es.safeBins} desc={es.safeBinsDesc} tooltip={tip('tools.exec.safeBins')} value={g(['exec', 'safeBins']) || []} onChange={v => s(['exec', 'safeBins'], v)} placeholder={es.phSafeBins} />
        <ArrayField label={es.safeBinTrustedDirs || 'Trusted Directories'} desc={es.safeBinTrustedDirsDesc} tooltip={tip('tools.exec.safeBinTrustedDirs')} value={g(['exec', 'safeBinTrustedDirs']) || []} onChange={v => s(['exec', 'safeBinTrustedDirs'], v)} placeholder={es.phSafeBinTrustedDirs || '/usr/local/bin, ~/bin'} />
        <KeyValueField label={es.execSafeBinProfiles || 'Safe Bin Profiles'} tooltip={tip('tools.exec.safeBinProfiles')} value={g(['exec', 'safeBinProfiles']) || {}} onChange={v => s(['exec', 'safeBinProfiles'], v)} />
        <ArrayField label={es.execPathPrepend || 'PATH Prepend'} tooltip={tip('tools.exec.pathPrepend')} value={g(['exec', 'pathPrepend']) || []} onChange={v => s(['exec', 'pathPrepend'], v)} placeholder="/usr/local/bin" />
        <TextField label={es.execNode || 'Node Binding'} tooltip={tip('tools.exec.node')} value={g(['exec', 'node']) || ''} onChange={v => s(['exec', 'node'], v)} placeholder="auto" />
        <SwitchField label={es.execNotifyOnExit || 'Notify on Exit'} tooltip={tip('tools.exec.notifyOnExit')} value={g(['exec', 'notifyOnExit']) === true} onChange={v => s(['exec', 'notifyOnExit'], v)} />
        <SwitchField label={es.execNotifyOnExitEmptySuccess || 'Notify on Empty Success'} tooltip={tip('tools.exec.notifyOnExitEmptySuccess')} value={g(['exec', 'notifyOnExitEmptySuccess']) === true} onChange={v => s(['exec', 'notifyOnExitEmptySuccess'], v)} />
        <NumberField label={es.execApprovalRunningNoticeMs || 'Approval Running Notice (ms)'} tooltip={tip('tools.exec.approvalRunningNoticeMs')} value={g(['exec', 'approvalRunningNoticeMs'])} onChange={v => s(['exec', 'approvalRunningNoticeMs'], v)} min={0} placeholder={def('tools.exec.approvalRunningNoticeMs')} />
        <SwitchField label={es.execApplyPatchEnabled || 'Enable apply_patch'} tooltip={tip('tools.exec.applyPatch.enabled')} value={g(['exec', 'applyPatch', 'enabled']) !== false} onChange={v => s(['exec', 'applyPatch', 'enabled'], v)} />
        <SwitchField label={es.execApplyPatchWorkspaceOnly || 'apply_patch Workspace-Only'} tooltip={tip('tools.exec.applyPatch.workspaceOnly')} value={g(['exec', 'applyPatch', 'workspaceOnly']) === true} onChange={v => s(['exec', 'applyPatch', 'workspaceOnly'], v)} />
        <ArrayField label={es.execApplyPatchAllowModels || 'apply_patch Model Allowlist'} tooltip={tip('tools.exec.applyPatch.allowModels')} value={g(['exec', 'applyPatch', 'allowModels']) || []} onChange={v => s(['exec', 'applyPatch', 'allowModels'], v)} placeholder="gpt-4o" />
      </ConfigSection>

      <ConfigSection title={es.fsConfig || 'Filesystem'} icon="folder" iconColor="text-yellow-500" defaultOpen={false}>
        <SwitchField label={es.fsWorkspaceOnly || 'Workspace Only'} tooltip={tip('tools.fs.workspaceOnly')} value={g(['fs', 'workspaceOnly']) === true} onChange={v => s(['fs', 'workspaceOnly'], v)} />
      </ConfigSection>

      <ConfigSection title={es.loopDetection || 'Loop Detection'} icon="all_inclusive" iconColor="text-rose-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('tools.loopDetection.enabled')} value={g(['loopDetection', 'enabled']) === true} onChange={v => s(['loopDetection', 'enabled'], v)} />
        <NumberField label={es.loopHistorySize || 'History Size'} tooltip={tip('tools.loopDetection.historySize')} value={g(['loopDetection', 'historySize'])} onChange={v => s(['loopDetection', 'historySize'], v)} min={1} placeholder={def('tools.loopDetection.historySize')} />
        <NumberField label={es.warningThreshold || 'Warning Threshold'} tooltip={tip('tools.loopDetection.warningThreshold')} value={g(['loopDetection', 'warningThreshold'])} onChange={v => s(['loopDetection', 'warningThreshold'], v)} min={1} placeholder={def('tools.loopDetection.warningThreshold')} />
        <NumberField label={es.criticalThreshold || 'Critical Threshold'} tooltip={tip('tools.loopDetection.criticalThreshold')} value={g(['loopDetection', 'criticalThreshold'])} onChange={v => s(['loopDetection', 'criticalThreshold'], v)} min={1} placeholder={def('tools.loopDetection.criticalThreshold')} />
        <NumberField label={es.unknownToolThreshold || 'Unknown-tool Threshold'} desc={es.unknownToolThresholdDesc || 'Stop hallucinated tool loops after N unknown-tool stream attempts (default 10; stream guard is on by default).'} tooltip={tip('tools.loopDetection.unknownToolThreshold')} value={g(['loopDetection', 'unknownToolThreshold'])} onChange={v => s(['loopDetection', 'unknownToolThreshold'], v)} min={1} placeholder={def('tools.loopDetection.unknownToolThreshold')} />
        <NumberField label={es.loopGlobalCircuitBreaker || 'Global Circuit Breaker'} tooltip={tip('tools.loopDetection.globalCircuitBreakerThreshold')} value={g(['loopDetection', 'globalCircuitBreakerThreshold'])} onChange={v => s(['loopDetection', 'globalCircuitBreakerThreshold'], v)} min={0} placeholder={def('tools.loopDetection.globalCircuitBreakerThreshold')} />
        <SwitchField label={es.loopDetectorGenericRepeat || 'Generic Repeat Detection'} tooltip={tip('tools.loopDetection.detectors.genericRepeat')} value={g(['loopDetection', 'detectors', 'genericRepeat']) !== false} onChange={v => s(['loopDetection', 'detectors', 'genericRepeat'], v)} />
        <SwitchField label={es.loopDetectorPollNoProgress || 'Poll No-Progress Detection'} tooltip={tip('tools.loopDetection.detectors.knownPollNoProgress')} value={g(['loopDetection', 'detectors', 'knownPollNoProgress']) !== false} onChange={v => s(['loopDetection', 'detectors', 'knownPollNoProgress'], v)} />
        <SwitchField label={es.loopDetectorPingPong || 'Ping-Pong Detection'} tooltip={tip('tools.loopDetection.detectors.pingPong')} value={g(['loopDetection', 'detectors', 'pingPong']) !== false} onChange={v => s(['loopDetection', 'detectors', 'pingPong'], v)} />
      </ConfigSection>

      <ConfigSection title={es.sessionTools || 'Session Tools'} icon="forum" iconColor="text-blue-500" defaultOpen={false}>
        <SelectField label={es.sessionsVisibility || 'Visibility'} tooltip={tip('tools.sessions.visibility')} value={g(['sessions', 'visibility']) || 'tree'} onChange={v => s(['sessions', 'visibility'], v)} options={SESSION_VISIBILITY_OPTIONS} />
      </ConfigSection>

      <ConfigSection title={es.linkTools || 'Link Understanding'} icon="link" iconColor="text-indigo-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('tools.links.enabled')} value={g(['links', 'enabled']) !== false} onChange={v => s(['links', 'enabled'], v)} />
        <NumberField label={es.linksMaxLinks || 'Max Links'} tooltip={tip('tools.links.maxLinks')} value={g(['links', 'maxLinks'])} onChange={v => s(['links', 'maxLinks'], v)} min={0} placeholder={def('tools.links.maxLinks')} />
        <NumberField label={es.linksTimeoutS || 'Timeout (sec)'} tooltip={tip('tools.links.timeoutSeconds')} value={g(['links', 'timeoutSeconds'])} onChange={v => s(['links', 'timeoutSeconds'], v)} min={0} placeholder={def('tools.links.timeoutSeconds')} />
        <TextField label={es.linksModels || 'Models'} tooltip={tip('tools.links.models')} value={g(['links', 'models']) || ''} onChange={v => s(['links', 'models'], v)} />
        <TextField label={es.linksScope || 'Scope'} tooltip={tip('tools.links.scope')} value={g(['links', 'scope']) || ''} onChange={v => s(['links', 'scope'], v)} />
      </ConfigSection>

      <ConfigSection title={es.media} icon="image" iconColor="text-pink-500" defaultOpen={false}>
        <TextField label={es.mediaSharedModels || 'Shared Models'} tooltip={tip('tools.media.models')} value={g(['media', 'models']) || ''} onChange={v => s(['media', 'models'], v)} />
        <NumberField label={es.mediaConcurrency || 'Concurrency'} tooltip={tip('tools.media.concurrency')} value={g(['media', 'concurrency'])} onChange={v => s(['media', 'concurrency'], v)} min={1} placeholder={def('tools.media.concurrency')} />
        <SwitchField label={es.imageUnderstanding} tooltip={tip('tools.media.image.enabled')} value={g(['media', 'image', 'enabled']) !== false} onChange={v => s(['media', 'image', 'enabled'], v)} />
        <NumberField label={es.imageMaxBytes || 'Image Max Bytes'} tooltip={tip('tools.media.image.maxBytes')} value={g(['media', 'image', 'maxBytes'])} onChange={v => s(['media', 'image', 'maxBytes'], v)} min={0} placeholder={def('tools.media.image.maxBytes')} />
        <NumberField label={es.imageMaxChars || 'Image Max Chars'} tooltip={tip('tools.media.image.maxChars')} value={g(['media', 'image', 'maxChars'])} onChange={v => s(['media', 'image', 'maxChars'], v)} min={0} placeholder={def('tools.media.image.maxChars')} />
        <TextField label={es.imagePrompt || 'Image Prompt'} tooltip={tip('tools.media.image.prompt')} value={g(['media', 'image', 'prompt']) || ''} onChange={v => s(['media', 'image', 'prompt'], v)} />
        <NumberField label={es.imageTimeoutS || 'Image Timeout (sec)'} tooltip={tip('tools.media.image.timeoutSeconds')} value={g(['media', 'image', 'timeoutSeconds'])} onChange={v => s(['media', 'image', 'timeoutSeconds'], v)} min={0} placeholder={def('tools.media.image.timeoutSeconds')} />
        <TextField label={es.imageAttachments || 'Image Attachments'} tooltip={tip('tools.media.image.attachments')} value={g(['media', 'image', 'attachments']) || ''} onChange={v => s(['media', 'image', 'attachments'], v)} />
        <TextField label={es.imageModels || 'Image Models'} tooltip={tip('tools.media.image.models')} value={g(['media', 'image', 'models']) || ''} onChange={v => s(['media', 'image', 'models'], v)} />
        <TextField label={es.imageScope || 'Image Scope'} tooltip={tip('tools.media.image.scope')} value={g(['media', 'image', 'scope']) || ''} onChange={v => s(['media', 'image', 'scope'], v)} />
        <SwitchField label={es.audioUnderstanding} tooltip={tip('tools.media.audio.enabled')} value={g(['media', 'audio', 'enabled']) !== false} onChange={v => s(['media', 'audio', 'enabled'], v)} />
        <RequestOverridePanel
          title={es.audioReqOverrides || 'Audio Request Overrides'}
          tipPrefix="tools.media.audio.request"
          tip={tip}
          g={(p) => g(['media', 'audio', 'request', ...p])}
          s={(p, v) => s(['media', 'audio', 'request', ...p], v)}
          es={es}
        />
        <SwitchField label={es.videoUnderstanding} tooltip={tip('tools.media.video.enabled')} value={g(['media', 'video', 'enabled']) !== false} onChange={v => s(['media', 'video', 'enabled'], v)} />
        <NumberField label={es.videoMaxBytes || 'Video Max Bytes'} tooltip={tip('tools.media.video.maxBytes')} value={g(['media', 'video', 'maxBytes'])} onChange={v => s(['media', 'video', 'maxBytes'], v)} min={0} placeholder={def('tools.media.video.maxBytes')} />
        <NumberField label={es.videoMaxChars || 'Video Max Chars'} tooltip={tip('tools.media.video.maxChars')} value={g(['media', 'video', 'maxChars'])} onChange={v => s(['media', 'video', 'maxChars'], v)} min={0} placeholder={def('tools.media.video.maxChars')} />
        <TextField label={es.videoPrompt || 'Video Prompt'} tooltip={tip('tools.media.video.prompt')} value={g(['media', 'video', 'prompt']) || ''} onChange={v => s(['media', 'video', 'prompt'], v)} />
        <NumberField label={es.videoTimeoutS || 'Video Timeout (sec)'} tooltip={tip('tools.media.video.timeoutSeconds')} value={g(['media', 'video', 'timeoutSeconds'])} onChange={v => s(['media', 'video', 'timeoutSeconds'], v)} min={0} placeholder={def('tools.media.video.timeoutSeconds')} />
        <TextField label={es.videoAttachments || 'Video Attachments'} tooltip={tip('tools.media.video.attachments')} value={g(['media', 'video', 'attachments']) || ''} onChange={v => s(['media', 'video', 'attachments'], v)} />
        <TextField label={es.videoModels || 'Video Models'} tooltip={tip('tools.media.video.models')} value={g(['media', 'video', 'models']) || ''} onChange={v => s(['media', 'video', 'models'], v)} />
        <TextField label={es.videoScope || 'Video Scope'} tooltip={tip('tools.media.video.scope')} value={g(['media', 'video', 'scope']) || ''} onChange={v => s(['media', 'video', 'scope'], v)} />
        <SwitchField label={es.asyncDirectSend || 'Async Completion: Direct Send'} tooltip={tip('tools.media.asyncCompletion.directSend')} value={g(['media', 'asyncCompletion', 'directSend']) === true} onChange={v => s(['media', 'asyncCompletion', 'directSend'], v)} />
      </ConfigSection>

      <ConfigSection title={es.pdfConfig || 'PDF'} icon="picture_as_pdf" iconColor="text-red-400" defaultOpen={false}>
        <TextField label={es.pdfModel || 'PDF Model'} tooltip={tip('tools.pdf.model')} value={g(['pdf', 'model']) || ''} onChange={v => s(['pdf', 'model'], v)} placeholder="gpt-4o-mini" />
        <NumberField label={es.pdfMaxBytes || 'PDF Max Bytes'} tooltip={tip('tools.pdf.maxBytes')} value={g(['pdf', 'maxBytes'])} onChange={v => s(['pdf', 'maxBytes'], v)} placeholder="10485760" />
        <NumberField label={es.pdfMaxPages || 'PDF Max Pages'} tooltip={tip('tools.pdf.maxPages')} value={g(['pdf', 'maxPages'])} onChange={v => s(['pdf', 'maxPages'], v)} placeholder="50" />
      </ConfigSection>

      <ConfigSection title={es.perplexityWebSearch || 'Perplexity Web Search'} icon="travel_explore" iconColor="text-cyan-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('tools.webSearch.enabled')} value={g(['webSearch', 'enabled']) === true} onChange={v => s(['webSearch', 'enabled'], v)} />
        <TextField label={es.perplexityModel || 'Model'} tooltip={tip('tools.webSearch.model')} value={g(['webSearch', 'model']) || ''} onChange={v => s(['webSearch', 'model'], v)} placeholder="sonar" />
        <TextField label={es.perplexityApiKey || 'API Key'} tooltip={tip('tools.webSearch.apiKey')} value={g(['webSearch', 'apiKey']) || ''} onChange={v => s(['webSearch', 'apiKey'], v)} placeholder="pplx-..." />
      </ConfigSection>

      <ConfigSection title={es.elevatedTools} icon="admin_panel_settings" iconColor="text-amber-500" defaultOpen={false}>
        <SwitchField label={es.elevatedEnabled} desc={es.elevatedEnabledDesc} tooltip={tip('tools.elevated.enabled')} value={g(['elevated', 'enabled']) === true} onChange={v => s(['elevated', 'enabled'], v)} />
        <ArrayField label={es.allowedElevated} tooltip={tip('tools.elevated.allow')} value={g(['elevated', 'allow']) || []} onChange={v => s(['elevated', 'allow'], v)} placeholder={es.phToolName} />
        <KeyValueField label={es.elevatedAllowFrom} desc={es.elevatedAllowFromDesc || 'Per-provider allowlist. Use * to allow all tools.'} tooltip={tip('tools.elevated.allowFrom')}
          value={Object.fromEntries(Object.entries(g(['elevated', 'allowFrom']) || {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '*')]))}
          onChange={v => s(['elevated', 'allowFrom'], Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val.split(',').map((s: string) => s.trim()).filter(Boolean)])) as any)}
          valuePlaceholder="* (all tools)" />
      </ConfigSection>

      <ConfigSection title={es.agentToAgent} icon="swap_horiz" iconColor="text-violet-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('tools.agentToAgent.enabled')} value={g(['agentToAgent', 'enabled']) === true} onChange={v => s(['agentToAgent', 'enabled'], v)} />
        <ArrayField label={es.agentToAgentAllow || 'Target Allowlist'} tooltip={tip('tools.agentToAgent.allow')} value={g(['agentToAgent', 'allow']) || []} onChange={v => s(['agentToAgent', 'allow'], v)} placeholder="agent-id" />
      </ConfigSection>

      <ConfigSection title={es.subagentTools || 'Subagent Tools'} icon="group" iconColor="text-teal-500" defaultOpen={false}>
        <KeyValueField label={es.subagentToolsPolicy || 'Subagent Tool Allow/Deny'} tooltip={tip('tools.subagents.tools')} value={g(['subagents', 'tools']) || {}} onChange={v => s(['subagents', 'tools'], v)} />
      </ConfigSection>

      <ConfigSection title={es.sandboxTools || 'Sandbox Tools'} icon="shield" iconColor="text-emerald-500" defaultOpen={false}>
        <KeyValueField label={es.sandboxToolsPolicy || 'Sandbox Tool Allow/Deny'} tooltip={tip('tools.sandbox.tools')} value={g(['sandbox', 'tools']) || {}} onChange={v => s(['sandbox', 'tools'], v)} />
      </ConfigSection>

      <ConfigSection title={es.mediaFiles} icon="perm_media" iconColor="text-orange-500" defaultOpen={false}>
        <SwitchField label={es.preserveFilenames} tooltip={tip('media.preserveFilenames')} value={getField(['media', 'preserveFilenames']) === true} onChange={v => setField(['media', 'preserveFilenames'], v)} />
        <NumberField label={es.mediaRetentionTTL || 'Retention TTL (hours)'} tooltip={tip('media.ttlHours')} value={getField(['media', 'ttlHours'])} onChange={v => setField(['media', 'ttlHours'], v)} min={0} step={1} placeholder={def('media.ttlHours')} />
      </ConfigSection>

      <SchemaRemainder
        sectionPath="tools"
        handledKeys={[
          'profile', 'allow', 'deny', 'alsoAllow', 'byProvider',
          'exec', 'fs', 'loopDetection', 'sessions', 'links', 'media',
          'pdf', 'webSearch', 'elevated', 'agentToAgent', 'subagents', 'sandbox',
        ]}
        config={config}
        setField={setField}
        language={language}
        schema={schema}
        title={es.schemaAdditional || 'Additional Tool Fields'}
      />
    </div>
  );
};
