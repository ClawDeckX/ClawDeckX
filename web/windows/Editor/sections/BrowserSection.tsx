import React, { useMemo, useState, useCallback } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, SwitchField, NumberField, ArrayField, SelectField } from '../fields';
import { getTranslation } from '../../../locales';
import { schemaTooltip, schemaDefault } from '../schemaTooltip';
import { gwApi } from '../../../services/api';
import CustomSelect from '../../../components/CustomSelect';
import SchemaRemainder from '../SchemaRemainder';

export const BrowserSection: React.FC<SectionProps> = ({ config, schema, setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => schemaTooltip(key, language, schema);
  const def = (key: string) => schemaDefault(key, schema);
  const g = (p: string[]) => getField(['browser', ...p]);
  const s = (p: string[], v: any) => setField(['browser', ...p], v);
  const wg = (p: string[]) => getField(['tools', 'web', ...p]);
  const ws = (p: string[], v: any) => setField(['tools', 'web', ...p], v);
  const gg = (p: string[]) => getField(['gateway', ...p]);
  const gs = (p: string[], v: any) => setField(['gateway', ...p], v);

  const NODE_BROWSER_MODE_OPTIONS = useMemo(() => [
    { value: 'auto', label: es.optAuto || 'Auto' },
    { value: 'manual', label: es.optManual || 'Manual' },
    { value: 'off', label: es.reloadOff },
  ], [es]);

  const [reqMethod, setReqMethod] = useState('GET');
  const [reqPath, setReqPath] = useState('');
  const [reqSending, setReqSending] = useState(false);
  const [reqResult, setReqResult] = useState<{ ok: boolean; text: string; body?: string } | null>(null);

  const handleBrowserRequest = useCallback(async () => {
    if (!reqPath.trim() || reqSending) return;
    setReqSending(true);
    setReqResult(null);
    try {
      const res = await gwApi.proxy('browser.request', { method: reqMethod, path: reqPath.trim() }) as any;
      setReqResult({ ok: true, text: `${res?.status || 200} OK`, body: typeof res?.body === 'string' ? res.body.slice(0, 2000) : JSON.stringify(res, null, 2).slice(0, 2000) });
    } catch (err: any) {
      setReqResult({ ok: false, text: es.browserFailed + ': ' + (err?.message || '') });
    }
    setReqSending(false);
  }, [reqMethod, reqPath, reqSending, es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.browserConfig} icon="language" iconColor="text-emerald-500">
        <SwitchField label={es.enabled} tooltip={tip('browser.enabled')} value={g(['enabled']) === true} onChange={v => s(['enabled'], v)} />
        <SwitchField label={es.brEvaluateEnabled} tooltip={tip('browser.evaluateEnabled')} value={g(['evaluateEnabled']) === true} onChange={v => s(['evaluateEnabled'], v)} />
        <TextField label={es.cdpUrl} tooltip={tip('browser.cdpUrl')} value={g(['cdpUrl']) || ''} onChange={v => s(['cdpUrl'], v)} placeholder={es.phBrowserCdpUrl} />
        <NumberField label={es.brRemoteCdpTimeout} tooltip={tip('browser.remoteCdpTimeoutMs')} value={g(['remoteCdpTimeoutMs'])} onChange={v => s(['remoteCdpTimeoutMs'], v)} min={0} step={1000} placeholder={def('browser.remoteCdpTimeoutMs')} />
        <NumberField label={es.brRemoteCdpHandshakeTimeout} tooltip={tip('browser.remoteCdpHandshakeTimeoutMs')} value={g(['remoteCdpHandshakeTimeoutMs'])} onChange={v => s(['remoteCdpHandshakeTimeoutMs'], v)} min={0} step={1000} placeholder={def('browser.remoteCdpHandshakeTimeoutMs')} />
        <TextField label={es.executablePath} tooltip={tip('browser.executablePath')} value={g(['executablePath']) || ''} onChange={v => s(['executablePath'], v)} placeholder={es.phBrowserExecPath} />
        <TextField label={es.brColor} tooltip={tip('browser.color')} value={g(['color']) || ''} onChange={v => s(['color'], v)} placeholder="#4285f4" />
        <SwitchField label={es.headless} tooltip={tip('browser.headless')} value={g(['headless']) !== false} onChange={v => s(['headless'], v)} />
        <SwitchField label={es.brNoSandbox} tooltip={tip('browser.noSandbox')} value={g(['noSandbox']) === true} onChange={v => s(['noSandbox'], v)} />
        <SwitchField label={es.brAttachOnly} tooltip={tip('browser.attachOnly')} value={g(['attachOnly']) === true} onChange={v => s(['attachOnly'], v)} />
        <TextField label={es.brDefaultProfile} tooltip={tip('browser.defaultProfile')} value={g(['defaultProfile']) || ''} onChange={v => s(['defaultProfile'], v)} />
        <NumberField label={es.brCdpPortRangeStart || 'CDP Port Range Start'} tooltip={tip('browser.cdpPortRangeStart')} value={g(['cdpPortRangeStart'])} onChange={v => s(['cdpPortRangeStart'], v)} min={1} max={65535} placeholder={def('browser.cdpPortRangeStart')} />
        <ArrayField label={es.brExtraArgs || 'Extra Chrome Args'} tooltip={tip('browser.extraArgs')} value={g(['extraArgs']) || []} onChange={v => s(['extraArgs'], v)} placeholder="--window-size=1920,1080" />
      </ConfigSection>

      <ConfigSection title={es.brSnapshotDefaults || 'Snapshot Defaults'} icon="photo_camera" iconColor="text-violet-500" defaultOpen={false}>
        <TextField label={es.brSnapshotMode || 'Mode'} tooltip={tip('browser.snapshotDefaults.mode')} value={g(['snapshotDefaults', 'mode']) || ''} onChange={v => s(['snapshotDefaults', 'mode'], v)} placeholder="full" />
      </ConfigSection>

      <ConfigSection title={es.brSsrfPolicy} icon="shield" iconColor="text-red-500" defaultOpen={false}>
        <SwitchField label={es.brDangerouslyAllowPrivateNetwork || 'Dangerously Allow Private Network'} tooltip={tip('browser.ssrfPolicy.dangerouslyAllowPrivateNetwork')} value={g(['ssrfPolicy', 'dangerouslyAllowPrivateNetwork']) === true} onChange={v => s(['ssrfPolicy', 'dangerouslyAllowPrivateNetwork'], v)} />
        <ArrayField label={es.brHostnameAllowlist} tooltip={tip('browser.ssrfPolicy.hostnameAllowlist')} value={g(['ssrfPolicy', 'hostnameAllowlist']) || []} onChange={v => s(['ssrfPolicy', 'hostnameAllowlist'], v)} placeholder="example.com" />
        <ArrayField label={es.brAllowedHostnames || 'Allowed Hostnames'} tooltip={tip('browser.ssrfPolicy.allowedHostnames')} value={g(['ssrfPolicy', 'allowedHostnames']) || []} onChange={v => s(['ssrfPolicy', 'allowedHostnames'], v)} placeholder="*.example.com" />
      </ConfigSection>

      <ConfigSection title={es.webSearch} icon="search" iconColor="text-blue-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('tools.web.search.enabled')} value={wg(['search', 'enabled']) !== false} onChange={v => ws(['search', 'enabled'], v)} />
        <TextField label={es.provider} tooltip={tip('tools.web.search.provider')} value={wg(['search', 'provider']) || ''} onChange={v => ws(['search', 'provider'], v)} placeholder={es.phWebSearchProvider} />
        <TextField label={es.apiKey} value={wg(['search', 'apiKey']) || ''} onChange={v => ws(['search', 'apiKey'], v)} placeholder={es.phApiKeyMask} />
      </ConfigSection>

      <ConfigSection title={es.webFetch} icon="language" iconColor="text-green-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('tools.web.fetch.enabled')} value={wg(['fetch', 'enabled']) !== false} onChange={v => ws(['fetch', 'enabled'], v)} />
        <TextField label={es.method} tooltip={tip('tools.web.fetch.method')} value={wg(['fetch', 'method']) || ''} onChange={v => ws(['fetch', 'method'], v)} placeholder={es.phWebFetchMethod} />
      </ConfigSection>

      <ConfigSection title={es.gwNodes} icon="hub" iconColor="text-slate-500" defaultOpen={false}>
        <SelectField label={es.nodeBrowserMode} tooltip={tip('gateway.nodes.browser.mode')} value={gg(['nodes', 'browser', 'mode']) || 'auto'} onChange={v => gs(['nodes', 'browser', 'mode'], v)} options={NODE_BROWSER_MODE_OPTIONS} />
        <TextField label={es.nodeBrowserNode} tooltip={tip('gateway.nodes.browser.node')} value={gg(['nodes', 'browser', 'node']) || ''} onChange={v => gs(['nodes', 'browser', 'node'], v)} />
      </ConfigSection>

      <ConfigSection title={es.browserRequest} icon="public" iconColor="text-emerald-500" defaultOpen={false}>
        <div className="space-y-2">
          <p className="text-[10px] text-slate-400 dark:text-white/35">{es.browserRequestDesc}</p>
          <div className="flex gap-2">
            <CustomSelect value={reqMethod} onChange={v => setReqMethod(v)}
              options={['GET', 'POST', 'PUT', 'DELETE'].map(m => ({ value: m, label: m }))}
              className="h-8 px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-bold text-slate-700 dark:text-white/70" />
            <input value={reqPath} onChange={e => setReqPath(e.target.value)}
              placeholder={es.phExampleUrl}
              onKeyDown={e => e.key === 'Enter' && handleBrowserRequest()}
              className="flex-1 h-8 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-mono text-slate-700 dark:text-white/70 outline-none" />
            <button onClick={handleBrowserRequest} disabled={reqSending || !reqPath.trim()}
              className="h-8 px-3 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">{reqSending ? 'progress_activity' : 'send'}</span>
              {reqSending ? '...' : es.browserSend}
            </button>
          </div>
          {reqResult && (
            <div className={`rounded-lg text-[10px] ${reqResult.ok ? 'bg-mac-green/10 border border-mac-green/20' : 'bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20'}`}>
              <div className={`px-2 py-1.5 font-bold ${reqResult.ok ? 'text-mac-green' : 'text-red-500'}`}>{reqResult.text}</div>
              {reqResult.body && (
                <pre className="px-2 pb-2 text-[11px] font-mono text-slate-500 dark:text-white/40 overflow-x-auto max-h-32 custom-scrollbar neon-scrollbar whitespace-pre-wrap">{reqResult.body}</pre>
              )}
            </div>
          )}
        </div>
      </ConfigSection>

      <SchemaRemainder
        sectionPath="browser"
        handledKeys={[
          'evaluate', 'headless', 'timeout', 'viewport',
          'noSandbox', 'attachOnly', 'defaultProfile',
          'ssrfPolicy', 'cdpUrl', 'executablePath', 'color',
        ]}
        config={config}
        setField={setField}
        language={language}
        schema={schema}
        title={es.schemaAdditional || 'Additional Browser Fields'}
      />
    </div>
  );
};
