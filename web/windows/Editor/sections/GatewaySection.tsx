import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, PasswordField, NumberField, SelectField, SwitchField, ArrayField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

const GatewaySection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['gateway', ...p]);
  const s = (p: string[], v: any) => setField(['gateway', ...p], v);

  const bindOptions = useMemo(() => [
    { value: 'auto', label: es.bindAuto },
    { value: 'lan', label: es.bindLan },
    { value: 'loopback', label: es.bindLoopback },
    { value: 'custom', label: es.bindCustom },
    { value: 'tailnet', label: es.bindTailnet },
  ], [es]);

  const modeOptions = useMemo(() => [
    { value: 'local', label: es.modeLocal },
    { value: 'remote', label: es.modeRemote },
  ], [es]);

  const authModeOptions = useMemo(() => [
    { value: 'token', label: es.authToken },
    { value: 'password', label: es.authPassword },
    { value: 'none', label: es.authNone },
  ], [es]);

  const tsModeOptions = useMemo(() => [
    { value: 'off', label: es.reloadOff },
    { value: 'serve', label: es.tsServe },
    { value: 'funnel', label: es.tsFunnel },
  ], [es]);

  const mdnsModeOptions = useMemo(() => [
    { value: 'off', label: es.mdnsOff }, { value: 'minimal', label: es.mdnsMinimal }, { value: 'full', label: es.mdnsFull },
  ], [es]);

  const reloadModeOptions = useMemo(() => [
    { value: 'off', label: es.reloadOff },
    { value: 'restart', label: es.reloadRestart },
    { value: 'hot', label: es.reloadHot },
    { value: 'hybrid', label: es.reloadHybrid },
  ], [es]);

  const transportOptions = useMemo(() => [
    { value: 'direct', label: es.transportDirect },
    { value: 'ssh', label: es.transportSsh },
  ], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.basicSettings} icon="settings" iconColor="text-teal-500">
        <NumberField label={es.port} tooltip={tip('gateway.port')} value={g(['port'])} onChange={v => s(['port'], v)} min={1} max={65535} />
        <SelectField label={es.runMode} tooltip={tip('gateway.mode')} value={g(['mode']) || 'local'} onChange={v => s(['mode'], v)} options={modeOptions} />
        <SelectField label={es.bind} tooltip={tip('gateway.bind')} value={g(['bind']) || 'auto'} onChange={v => s(['bind'], v)} options={bindOptions} />
      </ConfigSection>

      <ConfigSection title={es.authentication} icon="lock" iconColor="text-red-500">
        <SelectField label={es.authMode} tooltip={tip('gateway.auth.mode')} value={g(['auth', 'mode']) || 'token'} onChange={v => s(['auth', 'mode'], v)} options={authModeOptions} />
        {g(['auth', 'mode']) === 'token' && (
          <PasswordField label={es.authToken} tooltip={tip('gateway.auth.token')} value={g(['auth', 'token']) || ''} onChange={v => s(['auth', 'token'], v)} />
        )}
        {g(['auth', 'mode']) === 'password' && (
          <PasswordField label={es.authPassword} tooltip={tip('gateway.auth.password')} value={g(['auth', 'password']) || ''} onChange={v => s(['auth', 'password'], v)} />
        )}
        <SwitchField label={es.allowTailscaleAuth} tooltip={tip('gateway.auth.allowTailscale')} value={g(['auth', 'allowTailscale']) === true} onChange={v => s(['auth', 'allowTailscale'], v)} />
      </ConfigSection>

      <ConfigSection title={es.tailscale} icon="vpn_lock" iconColor="text-blue-500" defaultOpen={false}>
        <SelectField label={es.mode} tooltip={tip('gateway.tailscale.mode')} value={g(['tailscale', 'mode']) || 'off'} onChange={v => s(['tailscale', 'mode'], v)} options={tsModeOptions} />
        <SwitchField label={es.resetOnExit} tooltip={tip('gateway.tailscale.resetOnExit')} value={g(['tailscale', 'resetOnExit']) === true} onChange={v => s(['tailscale', 'resetOnExit'], v)} />
      </ConfigSection>

      <ConfigSection title={es.tls} icon="https" iconColor="text-green-500" defaultOpen={false}>
        <SwitchField label={es.tlsEnabled} tooltip={tip('gateway.tls.enabled')} value={g(['tls', 'enabled']) === true} onChange={v => s(['tls', 'enabled'], v)} />
        <SwitchField label={es.autoGenerate} tooltip={tip('gateway.tls.autoGenerate')} value={g(['tls', 'autoGenerate']) === true} onChange={v => s(['tls', 'autoGenerate'], v)} />
        <TextField label={es.certPath} tooltip={tip('gateway.tls.certPath')} value={g(['tls', 'certPath']) || ''} onChange={v => s(['tls', 'certPath'], v)} />
        <TextField label={es.keyPath} tooltip={tip('gateway.tls.keyPath')} value={g(['tls', 'keyPath']) || ''} onChange={v => s(['tls', 'keyPath'], v)} />
        <TextField label={es.caPath} tooltip={tip('gateway.tls.caPath')} value={g(['tls', 'caPath']) || ''} onChange={v => s(['tls', 'caPath'], v)} />
      </ConfigSection>

      <ConfigSection title={es.remoteConn} icon="cloud" iconColor="text-purple-500" defaultOpen={false}>
        <TextField label={es.remoteUrl} tooltip={tip('gateway.remote.url')} value={g(['remote', 'url']) || ''} onChange={v => s(['remote', 'url'], v)} placeholder="ws://..." />
        <SelectField label={es.transport} tooltip={tip('gateway.remote.transport')} value={g(['remote', 'transport']) || 'direct'} onChange={v => s(['remote', 'transport'], v)} options={transportOptions} />
        <PasswordField label={es.authToken} tooltip={tip('gateway.remote.token')} value={g(['remote', 'token']) || ''} onChange={v => s(['remote', 'token'], v)} />
        <TextField label={es.sshTarget} tooltip={tip('gateway.remote.sshTarget')} value={g(['remote', 'sshTarget']) || ''} onChange={v => s(['remote', 'sshTarget'], v)} placeholder="user@host" />
        <TextField label={es.sshIdentity} tooltip={tip('gateway.remote.sshIdentity')} value={g(['remote', 'sshIdentity']) || ''} onChange={v => s(['remote', 'sshIdentity'], v)} placeholder="~/.ssh/id_ed25519" />
      </ConfigSection>

      <ConfigSection title={es.reload} icon="refresh" iconColor="text-amber-500" defaultOpen={false}>
        <SelectField label={es.reloadMode} tooltip={tip('gateway.reload.mode')} value={g(['reload', 'mode']) || 'hybrid'} onChange={v => s(['reload', 'mode'], v)} options={reloadModeOptions} />
        <NumberField label={es.debounceMs} tooltip={tip('gateway.reload.debounceMs')} value={g(['reload', 'debounceMs'])} onChange={v => s(['reload', 'debounceMs'], v)} min={0} step={100} />
      </ConfigSection>

      <ConfigSection title={es.controlUi} icon="dashboard" iconColor="text-indigo-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('gateway.controlUi.enabled')} value={g(['controlUi', 'enabled']) !== false} onChange={v => s(['controlUi', 'enabled'], v)} />
        <TextField label={es.basePath} tooltip={tip('gateway.controlUi.basePath')} value={g(['controlUi', 'basePath']) || ''} onChange={v => s(['controlUi', 'basePath'], v)} placeholder="/" />
        <ArrayField label={es.allowedOrigins} tooltip={tip('gateway.controlUi.allowedOrigins')} value={g(['controlUi', 'allowedOrigins']) || []} onChange={v => s(['controlUi', 'allowedOrigins'], v)} placeholder="https://..." />
      </ConfigSection>

      <ConfigSection title={es.httpConfig} icon="http" iconColor="text-sky-500" defaultOpen={false}>
        <SwitchField label={es.httpChat} tooltip={tip('gateway.http.endpoints.chatCompletions')} value={g(['http', 'endpoints', 'chatCompletions']) !== false} onChange={v => s(['http', 'endpoints', 'chatCompletions'], v)} />
        <SwitchField label={es.httpResponses} tooltip={tip('gateway.http.endpoints.responses')} value={g(['http', 'endpoints', 'responses']) !== false} onChange={v => s(['http', 'endpoints', 'responses'], v)} />
      </ConfigSection>

      <ConfigSection title={es.trustedProxies} icon="verified_user" iconColor="text-emerald-500" defaultOpen={false}>
        <ArrayField label={es.proxyIps} tooltip={tip('gateway.trustedProxies')} value={g(['trustedProxies']) || []} onChange={v => s(['trustedProxies'], v)} placeholder="10.0.0.0/8" />
      </ConfigSection>

      <ConfigSection title={es.discovery} icon="explore" iconColor="text-green-500" defaultOpen={false}>
        <SwitchField label={es.wideArea} tooltip={tip('discovery.wideArea.enabled')} value={getField(['discovery', 'wideArea', 'enabled']) === true} onChange={v => setField(['discovery', 'wideArea', 'enabled'], v)} />
        <SelectField label="mDNS" tooltip={tip('discovery.mdns.mode')} value={getField(['discovery', 'mdns', 'mode']) || 'off'} onChange={v => setField(['discovery', 'mdns', 'mode'], v)} options={mdnsModeOptions} />
      </ConfigSection>

      <ConfigSection title={es.webConfig} icon="public" iconColor="text-cyan-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('web.enabled')} value={getField(['web', 'enabled']) !== false} onChange={v => setField(['web', 'enabled'], v)} />
        <NumberField label={es.heartbeatS} tooltip={tip('web.heartbeatSeconds')} value={getField(['web', 'heartbeatSeconds'])} onChange={v => setField(['web', 'heartbeatSeconds'], v)} min={1} />
        <SwitchField label={es.reconnect} tooltip={tip('web.reconnect')} value={getField(['web', 'reconnect']) !== false} onChange={v => setField(['web', 'reconnect'], v)} />
      </ConfigSection>
    </div>
  );
};
export { GatewaySection };
