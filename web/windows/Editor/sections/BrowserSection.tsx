import React, { useMemo, useState, useCallback } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, SwitchField, NumberField, ArrayField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';
import { gwApi } from '../../../services/api';
import CustomSelect from '../../../components/CustomSelect';

export const BrowserSection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['browser', ...p]);
  const s = (p: string[], v: any) => setField(['browser', ...p], v);

  const [reqMethod, setReqMethod] = useState('GET');
  const [reqPath, setReqPath] = useState('');
  const [reqSending, setReqSending] = useState(false);
  const [reqResult, setReqResult] = useState<{ ok: boolean; text: string; body?: string } | null>(null);

  const handleBrowserRequest = useCallback(async () => {
    if (!reqPath.trim() || reqSending) return;
    setReqSending(true);
    setReqResult(null);
    try {
      const res = await gwApi.browserRequest(reqMethod, reqPath.trim()) as any;
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
        <NumberField label={es.brRemoteCdpTimeout} tooltip={tip('browser.remoteCdpTimeoutMs')} value={g(['remoteCdpTimeoutMs'])} onChange={v => s(['remoteCdpTimeoutMs'], v)} min={0} step={1000} />
        <NumberField label={es.brRemoteCdpHandshakeTimeout} tooltip={tip('browser.remoteCdpHandshakeTimeoutMs')} value={g(['remoteCdpHandshakeTimeoutMs'])} onChange={v => s(['remoteCdpHandshakeTimeoutMs'], v)} min={0} step={1000} />
        <TextField label={es.executablePath} tooltip={tip('browser.executablePath')} value={g(['executablePath']) || ''} onChange={v => s(['executablePath'], v)} placeholder={es.phBrowserExecPath} />
        <TextField label={es.brColor} tooltip={tip('browser.color')} value={g(['color']) || ''} onChange={v => s(['color'], v)} placeholder="#4285f4" />
        <SwitchField label={es.headless} tooltip={tip('browser.headless')} value={g(['headless']) !== false} onChange={v => s(['headless'], v)} />
        <SwitchField label={es.brNoSandbox} tooltip={tip('browser.noSandbox')} value={g(['noSandbox']) === true} onChange={v => s(['noSandbox'], v)} />
        <SwitchField label={es.brAttachOnly} tooltip={tip('browser.attachOnly')} value={g(['attachOnly']) === true} onChange={v => s(['attachOnly'], v)} />
        <TextField label={es.brDefaultProfile} tooltip={tip('browser.defaultProfile')} value={g(['defaultProfile']) || ''} onChange={v => s(['defaultProfile'], v)} />
      </ConfigSection>

      <ConfigSection title={es.brSsrfPolicy} icon="shield" iconColor="text-red-500" defaultOpen={false}>
        <SwitchField label={es.brAllowPrivateNetwork} tooltip={tip('browser.ssrfPolicy.allowPrivateNetwork')} value={g(['ssrfPolicy', 'allowPrivateNetwork']) === true} onChange={v => s(['ssrfPolicy', 'allowPrivateNetwork'], v)} />
        <ArrayField label={es.brHostnameAllowlist} tooltip={tip('browser.ssrfPolicy.hostnameAllowlist')} value={g(['ssrfPolicy', 'hostnameAllowlist']) || []} onChange={v => s(['ssrfPolicy', 'hostnameAllowlist'], v)} placeholder="example.com" />
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
                <pre className="px-2 pb-2 text-[11px] font-mono text-slate-500 dark:text-white/40 overflow-x-auto max-h-32 custom-scrollbar whitespace-pre-wrap">{reqResult.body}</pre>
              )}
            </div>
          )}
        </div>
      </ConfigSection>
    </div>
  );
};
