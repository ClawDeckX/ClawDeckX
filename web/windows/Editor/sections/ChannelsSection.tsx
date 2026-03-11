import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, PasswordField, SelectField, SwitchField, ArrayField, NumberField, EmptyState, DiscordGuildField } from '../fields';
import { getTranslation } from '../../../locales';
import { gwApi, gatewayApi, pairingApi, pluginApi } from '../../../services/api';
import { post } from '../../../services/request';
import CustomSelect from '../../../components/CustomSelect';
import { useToast } from '../../../components/Toast';
import { copyToClipboard } from '../../../utils/clipboard';

// ============================================================================
// 频道定义：核心 + 扩展 + 国内平台
// ============================================================================
interface ChannelDef {
  id: string;
  icon: string;
  labelKey: string;
  category: 'global' | 'china' | 'enterprise' | 'other';
  descKey: string;
  disabled?: boolean; // true = no plugin available yet, hidden from wizard
}

const CHANNEL_TYPES: ChannelDef[] = [
  // Global
  { id: 'telegram', icon: 'send', labelKey: 'chTelegram', category: 'global', descKey: 'chDescTelegram' },
  { id: 'whatsapp', icon: 'chat', labelKey: 'chWhatsapp', category: 'global', descKey: 'chDescWhatsapp' },
  { id: 'discord', icon: 'sports_esports', labelKey: 'chDiscord', category: 'global', descKey: 'chDescDiscord' },
  { id: 'slack', icon: 'tag', labelKey: 'chSlack', category: 'enterprise', descKey: 'chDescSlack' },
  { id: 'signal', icon: 'security', labelKey: 'chSignal', category: 'global', descKey: 'chDescSignal' },
  { id: 'imessage', icon: 'chat_bubble', labelKey: 'chImessage', category: 'global', descKey: 'chDescImessage' },
  { id: 'bluebubbles', icon: 'sms', labelKey: 'chBluebubbles', category: 'global', descKey: 'chDescBluebubbles' },
  { id: 'googlechat', icon: 'forum', labelKey: 'chGooglechat', category: 'enterprise', descKey: 'chDescGooglechat' },
  // Enterprise
  { id: 'msteams', icon: 'groups', labelKey: 'chMsteams', category: 'enterprise', descKey: 'chDescMsteams' },
  { id: 'mattermost', icon: 'chat_bubble', labelKey: 'chMattermost', category: 'enterprise', descKey: 'chDescMattermost' },
  { id: 'matrix', icon: 'hub', labelKey: 'chMatrix', category: 'other', descKey: 'chDescMatrix' },
  // China
  { id: 'feishu', icon: 'apartment', labelKey: 'chFeishu', category: 'china', descKey: 'chDescFeishu' },
  { id: 'wecom', icon: 'business', labelKey: 'chWecom', category: 'china', descKey: 'chDescWecom' },
  { id: 'wecom_kf', icon: 'support_agent', labelKey: 'chWecomKf', category: 'china', descKey: 'chDescWecomKf' },
  { id: 'wechat', icon: 'mark_chat_unread', labelKey: 'chWechat', category: 'china', descKey: 'chDescWechat', disabled: true },
  { id: 'qq', icon: 'smart_toy', labelKey: 'chQq', category: 'china', descKey: 'chDescQq' },
  { id: 'dingtalk', icon: 'notifications', labelKey: 'chDingtalk', category: 'china', descKey: 'chDescDingtalk' },
  { id: 'doubao', icon: 'auto_awesome', labelKey: 'chDoubao', category: 'china', descKey: 'chDescDoubao', disabled: true },
  // Other
  { id: 'zalo', icon: 'language', labelKey: 'chZalo', category: 'other', descKey: 'chDescZalo' },
  { id: 'voicecall', icon: 'call', labelKey: 'chVoicecall', category: 'other', descKey: 'chDescVoicecall' },
];

const CATEGORY_ORDER: ChannelDef['category'][] = ['global', 'china', 'enterprise', 'other'];

const CATEGORY_KEYS: Record<ChannelDef['category'], string> = {
  global: 'catGlobal', china: 'catChina', enterprise: 'catEnterprise', other: 'catOther',
};

// ============================================================================
// i18n 下拉选项
// ============================================================================
const dmPolicy = (es: any) => [
  { value: 'pairing', label: es.optPairing },
  { value: 'open', label: es.optOpen },
  { value: 'allowlist', label: es.optAllowlist },
  { value: 'disabled', label: es.optDisabled },
];
const groupPolicy = (es: any) => [
  { value: 'allowlist', label: es.optAllowlist },
  { value: 'open', label: es.optOpen },
  { value: 'disabled', label: es.optDisabled },
];
const streaming = (es: any) => [
  { value: 'off', label: es.optOff },
  { value: 'partial', label: es.optPartial },
  { value: 'block', label: es.optBlock || 'Block' },
  { value: 'progress', label: es.optProgress || 'Progress' },
];
const replyToMode = (es: any) => [
  { value: 'off', label: es.optOff },
  { value: 'first', label: es.optFirst || 'First' },
  { value: 'all', label: es.optAll },
];
const reactionNotifications = (es: any) => [
  { value: 'off', label: es.optOff },
  { value: 'own', label: es.optOwn || 'Own' },
  { value: 'all', label: es.optAll },
];
const reactionLevel = (es: any) => [
  { value: 'off', label: es.optOff },
  { value: 'ack', label: es.optAck || 'Ack' },
  { value: 'minimal', label: es.optMinimal || 'Minimal' },
  { value: 'extensive', label: es.optExtensive || 'Extensive' },
];
const chunkMode = (es: any) => [
  { value: 'length', label: es.optLength || 'Length' },
  { value: 'newline', label: es.optNewline || 'Newline' },
];
const inboundPolicy = (es: any) => [
  { value: 'disabled', label: es.optDisabled },
  { value: 'allowlist', label: es.optAllowlist },
  { value: 'pairing', label: es.optPairing },
  { value: 'open', label: es.optOpen },
];

// ============================================================================
// tooltip 文本
// ============================================================================
const TIP_KEYS: Record<string, string> = {
  dmPolicy: 'tipDmPolicy', groupPolicy: 'tipGroupPolicy', streaming: 'tipStreaming',
  allowFrom: 'tipAllowFrom', botToken: 'tipBotToken', webhookUrl: 'tipWebhookUrl',
  replyToMode: 'tipReplyToMode', feishuDomain: 'tipFeishuDomain', feishuConn: 'tipFeishuConn',
  matrixHome: 'tipMatrixHome', voiceProvider: 'tipVoiceProvider',
  groupAllowFrom: 'tipGroupAllowFrom', historyLimit: 'tipHistoryLimit',
  dmHistoryLimit: 'tipDmHistoryLimit', textChunkLimit: 'tipTextChunkLimit',
  chunkMode: 'tipChunkMode', mediaMaxMb: 'tipMediaMaxMb',
  reactionNotifications: 'tipReactionNotifications', reactionLevel: 'tipReactionLevel',
  responsePrefix: 'tipResponsePrefix', ackReaction: 'tipAckReaction',
  defaultTo: 'tipDefaultTo', proxy: 'tipProxy',
};

// ============================================================================
// 组件
// ============================================================================

// 通用配对管理组件
const PairingSection: React.FC<{ channel: string; es: any; cw: any; toast: (type: string, msg: string) => void }> = ({ channel, es, cw, toast }) => {
  const [pairingCode, setPairingCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);

  const loadPendingRequests = useCallback(async () => {
    try {
      const res = await pairingApi.list(channel);
      setPendingRequests(res.requests || []);
    } catch (err) {
      console.error('Failed to load pairing requests:', err);
    }
  }, [channel]);

  useEffect(() => {
    loadPendingRequests();
  }, [loadPendingRequests]);

  const handleApprove = async (code: string) => {
    if (!code.trim()) return;
    setLoading(true);
    try {
      await pairingApi.approve(channel, code.trim());
      toast('success', cw.pairingApproved || 'Pairing approved!');
      setPairingCode('');
      await loadPendingRequests();
    } catch (err: any) {
      toast('error', err.message || 'Failed to approve pairing');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-2 md:py-1.5">
      <div className="md:col-span-4 lg:col-span-5 flex flex-col">
        <div className="flex items-center gap-1">
          <label className="text-[11px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none">
            {cw.pairingCodeLabel || es.pairingCode || 'Pairing Code'}
          </label>
          <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-slate-500 cursor-help" title={es.tipPairingCode || 'Enter the pairing code from the channel'}>info</span>
        </div>
      </div>
      <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
            placeholder={cw.pairingCodePlaceholder || 'Enter pairing code'}
            className="h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[12px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 w-full md:w-64"
          />
          <button
            onClick={() => handleApprove(pairingCode)}
            disabled={loading || !pairingCode.trim()}
            className="h-8 px-3 text-xs font-medium rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {loading ? (cw.pairingApproving || 'Approving...') : (cw.pairingApprove || 'Approve')}
          </button>
        </div>
        {pendingRequests.length > 0 && (
          <div className="text-[10px] text-slate-600 dark:text-white/60">
            {cw.pendingRequests || es.pendingRequests || 'Pending requests'}: {pendingRequests.length}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
export const ChannelsSection: React.FC<SectionProps> = ({ config, setField, getField, deleteField, language, save }) => {
  const { toast } = useToast();
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const cw = useMemo(() => (getTranslation(language) as any).cw || {}, [language]);
  const [showWecomPairing, setShowWecomPairing] = useState(false);
  const [showTelegramPairing, setShowTelegramPairing] = useState(false);
  const [showWhatsappPairing, setShowWhatsappPairing] = useState(false);
  const [showDiscordPairing, setShowDiscordPairing] = useState(false);
  const [showSignalPairing, setShowSignalPairing] = useState(false);
  const [showImessagePairing, setShowImessagePairing] = useState(false);
  const [showBluebubblesPairing, setShowBluebubblesPairing] = useState(false);
  const [showMatrixPairing, setShowMatrixPairing] = useState(false);
  const [showFeishuPairing, setShowFeishuPairing] = useState(false);
  const [showZaloPairing, setShowZaloPairing] = useState(false);
  const channels = getField(['channels']) || {};
  const channelKeys = Object.keys(channels);
  const [addingChannel, setAddingChannel] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState(0); // 0=select, 1=prep, 2=creds, 3=access, 4=confirm
  const [logoutChannel, setLogoutChannel] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutMsg, setLogoutMsg] = useState<{ ch: string; ok: boolean; text: string } | null>(null);

  // Send test message
  const [sendChannel, setSendChannel] = useState<string | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [sendMsg, setSendMsg] = useState(es.chSendMsgPlaceholder || '');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<{ ch: string; ok: boolean; text: string } | null>(null);

  // Wizard test connection
  const [wizTestStatus, setWizTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [wizTestMsg, setWizTestMsg] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [showPairing, setShowPairing] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingStatus, setPairingStatus] = useState<'idle' | 'approving' | 'success' | 'error'>('idle');
  const [pairingError, setPairingError] = useState('');

  // Plugin install state
  const [canInstallPlugin, setCanInstallPlugin] = useState<boolean | null>(null);
  const [pluginInstalled, setPluginInstalled] = useState<Record<string, boolean>>({});
  const [pluginInstalling, setPluginInstalling] = useState(false);
  const [pluginInstallResult, setPluginInstallResult] = useState<{ ok: boolean; msg: string; phase?: 'installed' | 'restarting' | 'ready' } | null>(null);

  const handleWizardTest = useCallback(async (chId: string) => {
    setWizTestStatus('testing');
    setWizTestMsg('');
    try {
      const cfg = channels[chId] || {};
      const tokenMap: Record<string, string> = {};
      // Extract token fields from current config for the channel
      if (chId === 'telegram') { tokenMap.botToken = cfg.botToken || ''; }
      else if (chId === 'discord') { tokenMap.token = cfg.token || ''; }
      else if (chId === 'slack') { tokenMap.appToken = cfg.appToken || ''; tokenMap.botToken = cfg.botToken || ''; }
      else if (chId === 'signal') { tokenMap.account = cfg.account || ''; }
      else if (chId === 'feishu') { tokenMap.appId = cfg.appId || ''; tokenMap.appSecret = cfg.appSecret || ''; }
      else if (chId === 'wecom') { tokenMap.token = cfg.token || ''; tokenMap.encodingAESKey = cfg.encodingAESKey || ''; }
      else if (chId === 'wecom_kf') { tokenMap.corpId = cfg.corpId || ''; tokenMap.corpSecret = cfg.corpSecret || ''; tokenMap.token = cfg.token || ''; }
      else if (chId === 'dingtalk') { tokenMap.clientId = cfg.clientId || ''; tokenMap.clientSecret = cfg.clientSecret || ''; }
      else if (chId === 'msteams') { tokenMap.appId = cfg.appId || ''; tokenMap.appPassword = cfg.appPassword || ''; }
      else if (chId === 'matrix') { tokenMap.accessToken = cfg.accessToken || ''; tokenMap.homeserver = cfg.homeserver || ''; }
      else if (chId === 'mattermost') { tokenMap.botToken = cfg.botToken || ''; tokenMap.baseUrl = cfg.baseUrl || ''; }
      else {
        // Generic: collect all string fields that look like tokens
        for (const [k, v] of Object.entries(cfg)) {
          if (typeof v === 'string' && v && k !== 'enabled') tokenMap[k] = v;
        }
      }
      const res = await post<any>('/api/v1/setup/test-channel', { channel: chId, tokens: tokenMap });
      if (res?.status === 'ok') {
        setWizTestStatus('ok');
        setWizTestMsg(res?.message || '');
      } else {
        setWizTestStatus('fail');
        setWizTestMsg(res?.message || '');
      }
    } catch (err: any) {
      setWizTestStatus('fail');
      setWizTestMsg(err?.message || es.chSendFailed);
    }
    setTimeout(() => { setWizTestStatus('idle'); setWizTestMsg(''); }, 5000);
  }, [channels, es]);

  // WhatsApp web login
  const [webLoginBusy, setWebLoginBusy] = useState(false);
  const [webLoginResult, setWebLoginResult] = useState<{ ok: boolean; text: string; qr?: string } | null>(null);

  const handleWebLogin = useCallback(async () => {
    setWebLoginBusy(true);
    setWebLoginResult(null);
    try {
      const res = await gwApi.webLoginStart({}) as any;
      if (res?.qr) {
        setWebLoginResult({ ok: true, text: cw.qrReady, qr: res.qr });
        // Wait for scan
        try {
          await gwApi.webLoginWait({ timeoutMs: 60000 });
          setWebLoginResult({ ok: true, text: cw.loginSuccess });
        } catch { setWebLoginResult({ ok: false, text: cw.loginTimeout }); }
      } else {
        setWebLoginResult({ ok: true, text: res?.status || cw.started });
      }
    } catch (err: any) {
      setWebLoginResult({ ok: false, text: `${cw.loginFailed}: ${err?.message || ''}` });
    }
    setWebLoginBusy(false);
  }, [cw]);

  // Check if plugin install is available (local gateway only) and check installed status
  const checkCanInstallPlugin = useCallback(async () => {
    try {
      const res = await pluginApi.canInstall();
      setCanInstallPlugin(res.can_install);
    } catch {
      setCanInstallPlugin(false);
    }
    // Check installed status for all plugin-required channels
    const pluginSpecs: Record<string, string> = {
      feishu: '@openclaw/feishu',
      dingtalk: '@openclaw-china/dingtalk',
      wecom: '@openclaw-china/wecom',
      wecom_kf: '@openclaw-china/wecom-app',
      qq: '@openclaw-china/qqbot',
      msteams: '@openclaw/msteams',
      zalo: '@openclaw/zalo',
      matrix: '@openclaw/matrix',
      voicecall: '@openclaw/voice-call',
    };
    const installed: Record<string, boolean> = {};
    await Promise.all(
      Object.entries(pluginSpecs).map(async ([ch, spec]) => {
        try {
          const res = await pluginApi.checkInstalled(spec);
          installed[ch] = res.installed;
        } catch {
          installed[ch] = false;
        }
      })
    );
    setPluginInstalled(installed);
  }, []);

  // Install plugin with gateway restart detection
  const handleInstallPlugin = useCallback(async (spec: string, channelId: string) => {
    setPluginInstalling(true);
    setPluginInstallResult(null);
    try {
      const res = await pluginApi.install(spec);
      if (res.success) {
        // Phase 1: Plugin installed, now restarting gateway
        setPluginInstallResult({ ok: true, msg: 'success', phase: 'restarting' });
        setPluginInstalling(false);
        
        // Trigger gateway restart
        try {
          await gatewayApi.restart();
        } catch { /* ignore restart errors */ }
        
        // Phase 2: Poll for gateway ready (up to 30 seconds)
        let retries = 0;
        const maxRetries = 30;
        const pollInterval = 1000;
        
        const checkGatewayReady = async (): Promise<boolean> => {
          try {
            const health = await gwApi.proxy('health', {});
            return !!health;
          } catch {
            return false;
          }
        };
        
        const poll = setInterval(async () => {
          retries++;
          const ready = await checkGatewayReady();
          
          if (ready) {
            clearInterval(poll);
            // Phase 3: Gateway ready, refresh plugin status
            setPluginInstallResult({ ok: true, msg: 'success', phase: 'ready' });
            // Update plugin installed status
            try {
              const checkRes = await pluginApi.checkInstalled(spec);
              if (checkRes.installed) {
                setPluginInstalled(prev => ({ ...prev, [channelId]: true }));
              }
            } catch { /* ignore */ }
            // Clear result after 2 seconds
            setTimeout(() => setPluginInstallResult(null), 2000);
          } else if (retries >= maxRetries) {
            clearInterval(poll);
            // Timeout - gateway didn't come back, but plugin was installed
            setPluginInstallResult({ ok: true, msg: 'success', phase: 'ready' });
            setTimeout(() => setPluginInstallResult(null), 2000);
          }
        }, pollInterval);
      } else {
        setPluginInstallResult({ ok: false, msg: res.output || es.failed });
        setPluginInstalling(false);
      }
    } catch (err: any) {
      setPluginInstallResult({ ok: false, msg: err?.message || es.failed });
      setPluginInstalling(false);
    }
  }, [es]);

  const handleSendTest = useCallback(async (ch: string) => {
    if (!sendTo.trim() || !sendMsg.trim()) return;
    setSendBusy(true);
    setSendResult(null);
    try {
      await gwApi.proxy('send', {
        to: sendTo.trim(),
        message: sendMsg.trim(),
        channel: ch,
        idempotencyKey: `test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      });
      setSendResult({ ch, ok: true, text: es.chSendOk });
    } catch (err: any) {
      setSendResult({ ch, ok: false, text: `${es.chSendFailed}: ${err?.message || ''}` });
    }
    setSendBusy(false);
  }, [sendTo, sendMsg, es]);

  const handleLogout = useCallback(async (ch: string) => {
    setLogoutBusy(true);
    setLogoutMsg(null);
    try {
      await gwApi.proxy('channels.logout', { channel: ch });
      setLogoutMsg({ ch, ok: true, text: es.chLogoutOk });
      setLogoutChannel(null);
    } catch (err: any) {
      setLogoutMsg({ ch, ok: false, text: `${es.chLogoutFailed}: ${err?.message || ''}` });
    }
    setLogoutBusy(false);
  }, [es]);

  const addChannel = useCallback((type: string) => {
    setField(['channels', type], { enabled: true });
    setAddingChannel(type);
    setWizardStep(1);
  }, [setField]);

  const resetWizard = useCallback(() => {
    setAddingChannel(null);
    setWizardStep(0);
    setShowPairing(false);
    setPairingCode('');
    setPairingStatus('idle');
    setPairingError('');
  }, []);

  const handleFinishWizard = useCallback(async (chId: string) => {
    const dmPolicy = getField(['channels', chId, 'dmPolicy']) || 'pairing';
    setRestarting(true);
    try {
      // First save the configuration
      if (save) {
        const saved = await save();
        if (!saved) {
          console.error('Failed to save config before restart');
        }
      }
      // Then restart the gateway
      await gatewayApi.restart();
    } catch (err) {
      console.error('Failed to finish wizard:', err);
    }
    setRestarting(false);
    if (dmPolicy === 'pairing') {
      setShowPairing(true);
    } else {
      resetWizard();
    }
  }, [getField, resetWizard, save]);

  const handleApprovePairing = useCallback(async (chId: string) => {
    if (!pairingCode.trim()) return;
    setPairingStatus('approving');
    setPairingError('');
    try {
      await pairingApi.approve(chId, pairingCode.trim());
      setPairingStatus('success');
      setTimeout(() => resetWizard(), 1500);
    } catch (err: any) {
      setPairingStatus('error');
      setPairingError(err?.message || es.decideFailed);
    }
  }, [pairingCode, resetWizard, es]);

  const tip = (key: string) => (es as any)[TIP_KEYS[key]] || '';
  const dmPolicyText = (value?: string) => {
    switch (value) {
      case 'allowlist': return es.optAllowlist;
      case 'open': return es.optOpen;
      case 'closed': return es.optClosed;
      case 'pairing':
      default: return es.optPairing;
    }
  };

  const renderChannelFields = (ch: string, cfg: any) => {
    const p = (f: string[]) => ['channels', ch, ...f];
    const g = (f: string[]) => getField(p(f));
    const s = (f: string[], v: any) => setField(p(f), v);
    const labelToken = es.chToken;
    const labelBotToken = es.botToken;
    const labelAppToken = es.appToken;
    const labelWebhookUrl = es.webhookUrl;
    const labelHttpUrl = es.httpUrl;
    const labelWebhookPath = es.chWebhookPath;
    const labelAppId = es.appId;
    const labelAppSecret = es.appSecret;
    const labelClientId = es.clientId;
    const labelClientSecret = es.clientSecret;
    const labelTenantId = es.tenantId;
    const labelBaseUrl = es.baseUrl;
    const labelHomeserver = es.homeserver;
    const labelAccessToken = es.accessToken;
    const labelCorpId = es.corpId;
    const labelCorpSecret = es.corpSecret;
    const labelAgentId = es.agentId;
    const labelApiKey = es.apiKey;
    const labelConnectionId = es.connectionId;
    const labelAccountSid = es.accountSid;
    const labelAuthToken = es.authToken;
    const labelEncodingAESKey = es.encodingAESKey;

    return (
      <>
        <SwitchField label={es.enabled} value={cfg.enabled !== false} onChange={v => s(['enabled'], v)} tooltip={es.tipEnableChannel} />

        {/* Telegram */}
        {ch === 'telegram' && (
          <>
            <PasswordField label={labelBotToken} value={g(['botToken']) || ''} onChange={v => s(['botToken'], v)} placeholder={es.phTelegramBotToken} tooltip={tip('botToken')} />
            <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-2 md:py-1.5">
              <div className="md:col-span-4 lg:col-span-5 flex flex-col">
                <div className="flex items-center gap-1">
                  <label className="text-[11px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none">
                    {es.dmPolicy}
                  </label>
                  <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-slate-500 cursor-help" title={tip('dmPolicy')}>info</span>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className="h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[12px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 w-full md:w-64"
                  />
                  {(g(['dmPolicy']) || 'pairing') === 'pairing' && (
                    <button
                      type="button"
                      onClick={() => setShowTelegramPairing(!showTelegramPairing)}
                      className="h-8 px-3 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors whitespace-nowrap"
                    >
                      {showTelegramPairing ? '隐藏配对' : '手动配对'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {showTelegramPairing && (g(['dmPolicy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="telegram" es={es} cw={cw} toast={toast} />
            )}
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.tipAllowFromPh} tooltip={tip('allowFrom')} />
            <ArrayField label={es.groupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.phUserId} tooltip={tip('groupAllowFrom')} />
            <TextField label={es.defaultTo || 'Default To'} value={g(['defaultTo']) || ''} onChange={v => s(['defaultTo'], v)} tooltip={tip('defaultTo')} />
            <SelectField label={es.streaming || 'Streaming'} value={g(['streaming']) || 'partial'} onChange={v => s(['streaming'], v)} options={streaming(es)} tooltip={tip('streaming')} />
            <SelectField label={es.replyToMode || 'Reply To Mode'} value={g(['replyToMode']) || 'off'} onChange={v => s(['replyToMode'], v)} options={replyToMode(es)} tooltip={tip('replyToMode')} />
            <SwitchField label={es.inlineButtons} value={g(['capabilities', 'inlineButtons']) !== false} onChange={v => s(['capabilities', 'inlineButtons'], v)} tooltip={es.tipInlineBtn} />
            <NumberField label={es.historyLimit || 'History Limit'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} placeholder="50" tooltip={tip('historyLimit')} />
            <NumberField label={es.dmHistoryLimit || 'DM History Limit'} value={g(['dmHistoryLimit'])} onChange={v => s(['dmHistoryLimit'], v)} placeholder="50" tooltip={tip('dmHistoryLimit')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
            <SelectField label={es.chunkMode || 'Chunk Mode'} value={g(['chunkMode']) || ''} onChange={v => s(['chunkMode'], v)} options={chunkMode(es)} allowEmpty tooltip={tip('chunkMode')} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="50" tooltip={tip('mediaMaxMb')} />
            <TextField label={labelWebhookUrl} value={g(['webhookUrl']) || ''} onChange={v => s(['webhookUrl'], v)} placeholder={es.phHttps} tooltip={tip('webhookUrl')} />
            <PasswordField label={es.webhookSecret || 'Webhook Secret'} value={g(['webhookSecret']) || ''} onChange={v => s(['webhookSecret'], v)} tooltip={es.tipTgWebhookSecret} />
            <TextField label={es.webhookPath || 'Webhook Path'} value={g(['webhookPath']) || ''} onChange={v => s(['webhookPath'], v)} tooltip={es.tipTgWebhookPath} />
            <TextField label={es.webhookHost || 'Webhook Host'} value={g(['webhookHost']) || ''} onChange={v => s(['webhookHost'], v)} placeholder="127.0.0.1" tooltip={es.tipTgWebhookHost} />
            <NumberField label={es.webhookPort || 'Webhook Port'} value={g(['webhookPort'])} onChange={v => s(['webhookPort'], v)} placeholder="8787" tooltip={es.tipTgWebhookPort} />
            <SelectField label={es.reactionNotifications || 'Reaction Notifications'} value={g(['reactionNotifications']) || 'off'} onChange={v => s(['reactionNotifications'], v)} options={reactionNotifications(es)} tooltip={tip('reactionNotifications')} />
            <SelectField label={es.reactionLevel || 'Reaction Level'} value={g(['reactionLevel']) || 'ack'} onChange={v => s(['reactionLevel'], v)} options={reactionLevel(es)} tooltip={tip('reactionLevel')} />
            <SwitchField label={es.linkPreview || 'Link Preview'} value={g(['linkPreview']) !== false} onChange={v => s(['linkPreview'], v)} tooltip={es.tipLinkPreview} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
            <TextField label={es.ackReaction || 'Ack Reaction'} value={g(['ackReaction']) || ''} onChange={v => s(['ackReaction'], v)} placeholder="👀" tooltip={tip('ackReaction')} />
            <TextField label={es.proxy || 'Proxy'} value={g(['proxy']) || ''} onChange={v => s(['proxy'], v)} placeholder="http://host:port" tooltip={tip('proxy')} />
            <NumberField label={es.timeoutSeconds || 'Timeout (s)'} value={g(['timeoutSeconds'])} onChange={v => s(['timeoutSeconds'], v)} placeholder="60" tooltip={es.tipTgTimeout} />
            <SwitchField label={es.dmTopics || 'DM Topics'} value={g(['dmTopics']) === true} onChange={v => s(['dmTopics'], v)} tooltip={es.tipDmTopics} />
            <SwitchField label={es.disableAudioPreflight || 'Disable Audio Preflight'} value={g(['disableAudioPreflight']) === true} onChange={v => s(['disableAudioPreflight'], v)} tooltip={es.tipDisableAudioPreflight} />
            {/* Telegram Topics */}
            {(() => {
              const rawTopics = g(['topics']);
              const topics: any[] = Array.isArray(rawTopics) ? rawTopics : [];
              return topics.length > 0 ? (
                <div className="pt-2 pb-1">
                  <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.topicBindings || 'Topic Bindings'}</span>
                  {topics.map((t: any, i: number) => (
                    <div key={i} className="flex gap-2 items-center mt-1">
                      <TextField label={es.topicId || 'Topic ID'} value={t.topicId || ''} onChange={v => { const next = [...topics]; next[i] = { ...next[i], topicId: v }; s(['topics'], next); }} placeholder="123" />
                      <TextField label={es.agentId || 'Agent ID'} value={t.agentId || ''} onChange={v => { const next = [...topics]; next[i] = { ...next[i], agentId: v }; s(['topics'], next); }} placeholder="agent-1" />
                      <button className="text-red-500 hover:text-red-700 text-xs mt-4" onClick={() => { s(['topics'], topics.filter((_: any, j: number) => j !== i)); }}>✕</button>
                    </div>
                  ))}
                </div>
              ) : null;
            })()}
            <button className="text-xs text-blue-500 hover:text-blue-700 mt-1" onClick={() => {
              const rawTopics = g(['topics']);
              const topics: any[] = Array.isArray(rawTopics) ? rawTopics : [];
              s(['topics'], [...topics, { topicId: '', agentId: '' }]);
            }}>+ {es.addTopicBinding || 'Add Topic Binding'}</button>
          </>
        )}

        {/* WhatsApp */}
        {ch === 'whatsapp' && (
          <>
            <div className="md:col-span-12 flex items-end gap-2">
              <div className="flex-1">
                <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
              </div>
              {(g(['dmPolicy']) || 'pairing') === 'pairing' && (
                <button
                  type="button"
                  onClick={() => setShowWhatsappPairing(!showWhatsappPairing)}
                  className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors h-8"
                >
                  {showWhatsappPairing ? '隐藏配对' : '手动配对'}
                </button>
              )}
            </div>
            {showWhatsappPairing && (g(['dmPolicy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="whatsapp" es={es} cw={cw} toast={toast} />
            )}
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <SwitchField label={es.selfChatMode} value={g(['selfChatMode']) === true} onChange={v => s(['selfChatMode'], v)} tooltip={es.tipSelfChat} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phPhoneCN} tooltip={tip('allowFrom')} />
            <ArrayField label={es.groupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.phPhoneCN} tooltip={tip('groupAllowFrom')} />
            <TextField label={es.defaultTo || 'Default To'} value={g(['defaultTo']) || ''} onChange={v => s(['defaultTo'], v)} tooltip={tip('defaultTo')} />
            <NumberField label={es.historyLimit || 'History Limit'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} placeholder="50" tooltip={tip('historyLimit')} />
            <NumberField label={es.dmHistoryLimit || 'DM History Limit'} value={g(['dmHistoryLimit'])} onChange={v => s(['dmHistoryLimit'], v)} placeholder="50" tooltip={tip('dmHistoryLimit')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
            <SelectField label={es.chunkMode || 'Chunk Mode'} value={g(['chunkMode']) || ''} onChange={v => s(['chunkMode'], v)} options={chunkMode(es)} allowEmpty tooltip={tip('chunkMode')} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="50" tooltip={tip('mediaMaxMb')} />
            <NumberField label={es.chDebounceMs} value={g(['debounceMs'])} onChange={v => s(['debounceMs'], v)} placeholder={es.phDebounceMs} tooltip={es.tipDebounce} />
            <SwitchField label={es.sendReadReceipts || 'Send Read Receipts'} value={g(['sendReadReceipts']) !== false} onChange={v => s(['sendReadReceipts'], v)} tooltip={es.tipSendReadReceipts} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
          </>
        )}

        {/* Discord */}
        {ch === 'discord' && (
          <>
            <PasswordField label={labelToken} value={g(['token']) || ''} onChange={v => s(['token'], v)} placeholder={es.phBotToken} tooltip={es.tipDiscordToken} />
            <div className="md:col-span-12 flex items-end gap-2">
              <div className="flex-1">
                <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
              </div>
              {(g(['dmPolicy']) || 'pairing') === 'pairing' && (
                <button
                  type="button"
                  onClick={() => setShowDiscordPairing(!showDiscordPairing)}
                  className="px-3 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors h-8"
                >
                  {showDiscordPairing ? '隐藏配对' : '手动配对'}
                </button>
              )}
            </div>
            {showDiscordPairing && (g(['dmPolicy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="discord" es={es} cw={cw} toast={toast} />
            )}
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phUserId} tooltip={tip('allowFrom')} />
            <TextField label={es.defaultTo || 'Default To'} value={g(['defaultTo']) || ''} onChange={v => s(['defaultTo'], v)} tooltip={tip('defaultTo')} />
            <DiscordGuildField label={es.guildIds} value={g(['guilds']) || {}} onChange={v => s(['guilds'], v)} placeholder={es.guildIdPlaceholder || es.phGuildIdOrUrl} tooltip={es.tipGuildIds} linkHint={es.guildIdLinkHint} />
            <SelectField label={es.streaming || 'Streaming'} value={g(['streaming']) || 'partial'} onChange={v => s(['streaming'], v)} options={streaming(es)} tooltip={tip('streaming')} />
            <SelectField label={es.replyToMode || 'Reply To Mode'} value={g(['replyToMode']) || 'off'} onChange={v => s(['replyToMode'], v)} options={replyToMode(es)} tooltip={tip('replyToMode')} />
            <NumberField label={es.historyLimit || 'History Limit'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} placeholder="50" tooltip={tip('historyLimit')} />
            <NumberField label={es.dmHistoryLimit || 'DM History Limit'} value={g(['dmHistoryLimit'])} onChange={v => s(['dmHistoryLimit'], v)} placeholder="50" tooltip={tip('dmHistoryLimit')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="2000" tooltip={tip('textChunkLimit')} />
            <SelectField label={es.chunkMode || 'Chunk Mode'} value={g(['chunkMode']) || ''} onChange={v => s(['chunkMode'], v)} options={chunkMode(es)} allowEmpty tooltip={tip('chunkMode')} />
            <NumberField label={es.maxLinesMsg} value={g(['maxLinesPerMessage'])} onChange={v => s(['maxLinesPerMessage'], v)} placeholder={es.phMaxLines} tooltip={es.tipMaxLines} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="25" tooltip={tip('mediaMaxMb')} />
            <SelectField label={es.reactionNotifications || 'Reaction Notifications'} value={g(['reactionNotifications']) || 'own'} onChange={v => s(['reactionNotifications'], v)} options={[...reactionNotifications(es), { value: 'allowlist', label: es.optAllowlist }]} tooltip={tip('reactionNotifications')} />
            <SwitchField label={es.pluralKit} value={g(['pluralkit', 'enabled']) === true} onChange={v => s(['pluralkit', 'enabled'], v)} tooltip={es.tipPluralKit} />
            <SelectField label={es.allowBots || 'Allow Bots'} value={String(g(['allowBots']) ?? 'false')} onChange={v => s(['allowBots'], v === 'true' ? true : v === 'false' ? false : v)} options={[
              { value: 'false', label: es.optOff },
              { value: 'true', label: es.optOn },
              { value: 'mentions', label: es.optAllowBotsMentions || 'Mentions Only' },
            ]} tooltip={es.tipAllowBots} />
            <TextField label={es.proxy || 'Proxy'} value={g(['proxy']) || ''} onChange={v => s(['proxy'], v)} placeholder="http://host:port" tooltip={tip('proxy')} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
            <TextField label={es.ackReaction || 'Ack Reaction'} value={g(['ackReaction']) || ''} onChange={v => s(['ackReaction'], v)} placeholder="👀" tooltip={tip('ackReaction')} />
            <TextField label={es.activity || 'Activity'} value={g(['activity']) || ''} onChange={v => s(['activity'], v)} tooltip={es.tipDiscordActivity} />
            <SelectField label={es.discordStatus || 'Status'} value={g(['status']) || ''} onChange={v => s(['status'], v)} options={[
              { value: 'online', label: es.optOnline || 'Online' },
              { value: 'dnd', label: es.optDnd || 'Do Not Disturb' },
              { value: 'idle', label: es.optIdle || 'Idle' },
              { value: 'invisible', label: es.optInvisible || 'Invisible' },
            ]} allowEmpty tooltip={es.tipDiscordStatus} />
            {/* Discord Voice */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.discordVoiceTitle || 'Voice'}</span>
            </div>
            <SwitchField label={es.discordVoiceEnabled || 'Voice Enabled'} value={g(['voice', 'enabled']) !== false} onChange={v => s(['voice', 'enabled'], v)} tooltip={es.tipDiscordVoice} />
            {/* Discord Intents */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.discordIntentsTitle || 'Privileged Intents'}</span>
            </div>
            <SwitchField label={es.discordIntentPresence || 'Presence Intent'} value={g(['intents', 'presence']) === true} onChange={v => s(['intents', 'presence'], v)} tooltip={es.tipDiscordIntentPresence} />
            <SwitchField label={es.discordIntentMembers || 'Guild Members Intent'} value={g(['intents', 'guildMembers']) === true} onChange={v => s(['intents', 'guildMembers'], v)} tooltip={es.tipDiscordIntentMembers} />
            {/* Discord Actions */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.discordActionsTitle || 'Actions'}</span>
            </div>
            <SwitchField label={es.actReactions || 'Reactions'} value={g(['actions', 'reactions']) !== false} onChange={v => s(['actions', 'reactions'], v)} />
            <SwitchField label={es.actMessages || 'Messages'} value={g(['actions', 'messages']) !== false} onChange={v => s(['actions', 'messages'], v)} />
            <SwitchField label={es.actThreads || 'Threads'} value={g(['actions', 'threads']) !== false} onChange={v => s(['actions', 'threads'], v)} />
            <SwitchField label={es.actPins || 'Pins'} value={g(['actions', 'pins']) !== false} onChange={v => s(['actions', 'pins'], v)} />
            <SwitchField label={es.actSearch || 'Search'} value={g(['actions', 'search']) !== false} onChange={v => s(['actions', 'search'], v)} />
            <SwitchField label={es.actPolls || 'Polls'} value={g(['actions', 'polls']) !== false} onChange={v => s(['actions', 'polls'], v)} />
            <SwitchField label={es.actStickers || 'Stickers'} value={g(['actions', 'stickers']) !== false} onChange={v => s(['actions', 'stickers'], v)} />
            <SwitchField label={es.actPermissions || 'Permissions'} value={g(['actions', 'permissions']) !== false} onChange={v => s(['actions', 'permissions'], v)} />
            <SwitchField label={es.actModeration || 'Moderation'} value={g(['actions', 'moderation']) !== false} onChange={v => s(['actions', 'moderation'], v)} />
            <SwitchField label={es.actPresence || 'Presence'} value={g(['actions', 'presence']) === true} onChange={v => s(['actions', 'presence'], v)} />
          </>
        )}

        {/* Slack */}
        {ch === 'slack' && (
          <>
            <PasswordField label={labelBotToken} value={g(['botToken']) || ''} onChange={v => s(['botToken'], v)} placeholder={es.phSlackBotToken} tooltip={es.tipSlackBot} />
            <PasswordField label={labelAppToken} value={g(['appToken']) || ''} onChange={v => s(['appToken'], v)} placeholder={es.phSlackAppToken} tooltip={es.tipSlackApp} />
            <PasswordField label={es.userToken || 'User Token'} value={g(['userToken']) || ''} onChange={v => s(['userToken'], v)} placeholder="xoxp-..." tooltip={es.tipSlackUserToken} />
            <SelectField label={es.connMode} value={g(['mode']) || 'socket'} onChange={v => s(['mode'], v)} options={[{ value: 'socket', label: es.optSocketMode }, { value: 'http', label: es.optHttp }]} tooltip={es.tipSlackMode} />
            {g(['mode']) === 'http' && (
              <PasswordField label={es.signingSecret || 'Signing Secret'} value={g(['signingSecret']) || ''} onChange={v => s(['signingSecret'], v)} tooltip={es.tipSlackSigningSecret} />
            )}
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'open'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phUserId} tooltip={tip('allowFrom')} />
            <TextField label={es.defaultTo || 'Default To'} value={g(['defaultTo']) || ''} onChange={v => s(['defaultTo'], v)} tooltip={tip('defaultTo')} />
            <SwitchField label={es.requireMention} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipSlackMention} />
            <SelectField label={es.streaming || 'Streaming'} value={g(['streaming']) || 'partial'} onChange={v => s(['streaming'], v)} options={streaming(es)} tooltip={tip('streaming')} />
            <SwitchField label={es.nativeStreaming || 'Native Streaming'} value={g(['nativeStreaming']) !== false} onChange={v => s(['nativeStreaming'], v)} tooltip={es.tipSlackNativeStreaming} />
            <SelectField label={es.replyToMode || 'Reply To Mode'} value={g(['replyToMode']) || 'off'} onChange={v => s(['replyToMode'], v)} options={replyToMode(es)} tooltip={tip('replyToMode')} />
            <NumberField label={es.historyLimit || 'History Limit'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} placeholder="50" tooltip={tip('historyLimit')} />
            <NumberField label={es.dmHistoryLimit || 'DM History Limit'} value={g(['dmHistoryLimit'])} onChange={v => s(['dmHistoryLimit'], v)} placeholder="50" tooltip={tip('dmHistoryLimit')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
            <SelectField label={es.chunkMode || 'Chunk Mode'} value={g(['chunkMode']) || ''} onChange={v => s(['chunkMode'], v)} options={chunkMode(es)} allowEmpty tooltip={tip('chunkMode')} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="50" tooltip={tip('mediaMaxMb')} />
            <SelectField label={es.reactionNotifications || 'Reaction Notifications'} value={g(['reactionNotifications']) || 'own'} onChange={v => s(['reactionNotifications'], v)} options={[...reactionNotifications(es), { value: 'allowlist', label: es.optAllowlist }]} tooltip={tip('reactionNotifications')} />
            <SwitchField label={es.allowBots} value={g(['allowBots']) === true} onChange={v => s(['allowBots'], v)} tooltip={es.tipSlackBots} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
            <TextField label={es.ackReaction || 'Ack Reaction'} value={g(['ackReaction']) || ''} onChange={v => s(['ackReaction'], v)} placeholder="eyes" tooltip={tip('ackReaction')} />
            <TextField label={es.typingReaction || 'Typing Reaction'} value={g(['typingReaction']) || ''} onChange={v => s(['typingReaction'], v)} placeholder="hourglass_flowing_sand" tooltip={es.tipTypingReaction} />
            {/* Slack Slash Command */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.slackSlashTitle || 'Slash Command'}</span>
            </div>
            <SwitchField label={es.slackSlashEnabled || 'Enabled'} value={g(['slashCommand', 'enabled']) === true} onChange={v => s(['slashCommand', 'enabled'], v)} tooltip={es.tipSlackSlash} />
            <TextField label={es.slackSlashName || 'Command Name'} value={g(['slashCommand', 'name']) || 'openclaw'} onChange={v => s(['slashCommand', 'name'], v)} tooltip={es.tipSlackSlashName} />
            {/* Slack Actions */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.slackActionsTitle || 'Actions'}</span>
            </div>
            <SwitchField label={es.actReactions || 'Reactions'} value={g(['actions', 'reactions']) !== false} onChange={v => s(['actions', 'reactions'], v)} />
            <SwitchField label={es.actMessages || 'Messages'} value={g(['actions', 'messages']) !== false} onChange={v => s(['actions', 'messages'], v)} />
            <SwitchField label={es.actPins || 'Pins'} value={g(['actions', 'pins']) !== false} onChange={v => s(['actions', 'pins'], v)} />
            <SwitchField label={es.actSearch || 'Search'} value={g(['actions', 'search']) !== false} onChange={v => s(['actions', 'search'], v)} />
          </>
        )}

        {/* Signal */}
        {ch === 'signal' && (
          <>
            <TextField label={es.chAccount} value={g(['account']) || ''} onChange={v => s(['account'], v)} placeholder={es.phPhoneIntl} tooltip={es.tipSignalAccount} />
            <TextField label={labelHttpUrl} value={g(['httpUrl']) || ''} onChange={v => s(['httpUrl'], v)} placeholder={es.phLocalHttp} tooltip={es.tipSignalHttp} />
            <TextField label={es.httpHost || 'HTTP Host'} value={g(['httpHost']) || ''} onChange={v => s(['httpHost'], v)} placeholder="127.0.0.1" tooltip={es.tipSignalHttpHost} />
            <NumberField label={es.httpPort || 'HTTP Port'} value={g(['httpPort'])} onChange={v => s(['httpPort'], v)} placeholder="8080" tooltip={es.tipSignalHttpPort} />
            <TextField label={es.cliPath || 'CLI Path'} value={g(['cliPath']) || ''} onChange={v => s(['cliPath'], v)} tooltip={es.tipSignalCliPath} />
            <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-2 md:py-1.5">
              <div className="md:col-span-4 lg:col-span-5 flex flex-col">
                <div className="flex items-center gap-1">
                  <label className="text-[11px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none">
                    {es.dmPolicy}
                  </label>
                  <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-slate-500 cursor-help" title={tip('dmPolicy')}>info</span>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className="h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[12px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 w-full md:w-64"
                  />
                  {(g(['dmPolicy']) || 'pairing') === 'pairing' && (
                    <button
                      type="button"
                      onClick={() => setShowSignalPairing(!showSignalPairing)}
                      className="h-8 px-3 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors whitespace-nowrap"
                    >
                      {showSignalPairing ? '隐藏配对' : '手动配对'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {showSignalPairing && (g(['dmPolicy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="signal" es={es} cw={cw} toast={toast} />
            )}
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phPhoneIntl} tooltip={tip('allowFrom')} />
            <ArrayField label={es.groupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.phPhoneIntl} tooltip={tip('groupAllowFrom')} />
            <TextField label={es.defaultTo || 'Default To'} value={g(['defaultTo']) || ''} onChange={v => s(['defaultTo'], v)} tooltip={tip('defaultTo')} />
            <SelectField label={es.receiveMode} value={g(['receiveMode']) || 'on-start'} onChange={v => s(['receiveMode'], v)} options={[{ value: 'on-start', label: es.optOnStart || 'On Start' }, { value: 'manual', label: es.optManual || 'Manual' }]} tooltip={es.tipSignalReceive} />
            <NumberField label={es.historyLimit || 'History Limit'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} placeholder="50" tooltip={tip('historyLimit')} />
            <NumberField label={es.dmHistoryLimit || 'DM History Limit'} value={g(['dmHistoryLimit'])} onChange={v => s(['dmHistoryLimit'], v)} placeholder="50" tooltip={tip('dmHistoryLimit')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="50" tooltip={tip('mediaMaxMb')} />
            <SelectField label={es.reactionNotifications || 'Reaction Notifications'} value={g(['reactionNotifications']) || 'own'} onChange={v => s(['reactionNotifications'], v)} options={[...reactionNotifications(es), { value: 'allowlist', label: es.optAllowlist }]} tooltip={tip('reactionNotifications')} />
            <SelectField label={es.reactionLevel || 'Reaction Level'} value={g(['reactionLevel']) || 'minimal'} onChange={v => s(['reactionLevel'], v)} options={reactionLevel(es)} tooltip={tip('reactionLevel')} />
            <SwitchField label={es.sendReadReceipts || 'Send Read Receipts'} value={g(['sendReadReceipts']) === true} onChange={v => s(['sendReadReceipts'], v)} tooltip={es.tipSendReadReceipts} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
          </>
        )}

        {/* iMessage */}
        {ch === 'imessage' && (
          <>
            <TextField label={es.cliPath} value={g(['cliPath']) || ''} onChange={v => s(['cliPath'], v)} tooltip={es.tipImsgCli} />
            <TextField label={es.dbPath} value={g(['dbPath']) || ''} onChange={v => s(['dbPath'], v)} tooltip={es.tipImsgDb} />
            <TextField label={es.remoteHost || 'Remote Host'} value={g(['remoteHost']) || ''} onChange={v => s(['remoteHost'], v)} tooltip={es.tipImsgRemoteHost} />
            <SelectField label={es.chService} value={g(['service']) || ''} onChange={v => s(['service'], v)} options={[
              { value: 'imessage', label: es.optIMessage },
              { value: 'sms', label: es.optSms },
              { value: 'auto', label: es.optAuto },
            ]} allowEmpty tooltip={es.tipImsgService} />
            <TextField label={es.region || 'Region'} value={g(['region']) || ''} onChange={v => s(['region'], v)} tooltip={es.tipImsgRegion} />
            <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-2 md:py-1.5">
              <div className="md:col-span-4 lg:col-span-5 flex flex-col">
                <div className="flex items-center gap-1">
                  <label className="text-[11px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none">
                    {es.dmPolicy}
                  </label>
                  <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-slate-500 cursor-help" title={tip('dmPolicy')}>info</span>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className="h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[12px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 w-full md:w-64"
                  />
                  {(g(['dmPolicy']) || 'pairing') === 'pairing' && (
                    <button
                      type="button"
                      onClick={() => setShowImessagePairing(!showImessagePairing)}
                      className="h-8 px-3 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors whitespace-nowrap"
                    >
                      {showImessagePairing ? '隐藏配对' : '手动配对'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {showImessagePairing && (g(['dmPolicy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="imessage" es={es} cw={cw} toast={toast} />
            )}
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phPhoneCN} tooltip={tip('allowFrom')} />
            <ArrayField label={es.groupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.phPhoneCN} tooltip={tip('groupAllowFrom')} />
            <TextField label={es.defaultTo || 'Default To'} value={g(['defaultTo']) || ''} onChange={v => s(['defaultTo'], v)} tooltip={tip('defaultTo')} />
            <NumberField label={es.historyLimit || 'History Limit'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} placeholder="50" tooltip={tip('historyLimit')} />
            <NumberField label={es.dmHistoryLimit || 'DM History Limit'} value={g(['dmHistoryLimit'])} onChange={v => s(['dmHistoryLimit'], v)} placeholder="50" tooltip={tip('dmHistoryLimit')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
            <SelectField label={es.chunkMode || 'Chunk Mode'} value={g(['chunkMode']) || ''} onChange={v => s(['chunkMode'], v)} options={chunkMode(es)} allowEmpty tooltip={tip('chunkMode')} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="50" tooltip={tip('mediaMaxMb')} />
            <SwitchField label={es.includeAttachments || 'Include Attachments'} value={g(['includeAttachments']) !== false} onChange={v => s(['includeAttachments'], v)} tooltip={es.tipImsgAttachments} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
          </>
        )}

        {/* BlueBubbles */}
        {ch === 'bluebubbles' && (
          <>
            <TextField label={es.serverUrl} value={g(['serverUrl']) || ''} onChange={v => s(['serverUrl'], v)} placeholder={es.phLocalServerUrl} tooltip={es.tipBBServer} />
            <PasswordField label={es.chPassword} value={g(['password']) || ''} onChange={v => s(['password'], v)} tooltip={es.tipBBPassword} />
            <TextField label={es.webhookPath || 'Webhook Path'} value={g(['webhookPath']) || ''} onChange={v => s(['webhookPath'], v)} tooltip={es.tipBBWebhookPath} />
            <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-2 md:py-1.5">
              <div className="md:col-span-4 lg:col-span-5 flex flex-col">
                <div className="flex items-center gap-1">
                  <label className="text-[11px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none">
                    {es.dmPolicy}
                  </label>
                  <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-slate-500 cursor-help" title={tip('dmPolicy')}>info</span>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className="h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[12px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 w-full md:w-64"
                  />
                  {(g(['dmPolicy']) || 'pairing') === 'pairing' && (
                    <button
                      type="button"
                      onClick={() => setShowBluebubblesPairing(!showBluebubblesPairing)}
                      className="h-8 px-3 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors whitespace-nowrap"
                    >
                      {showBluebubblesPairing ? '隐藏配对' : '手动配对'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {showBluebubblesPairing && (g(['dmPolicy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="bluebubbles" es={es} cw={cw} toast={toast} />
            )}
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phPhoneCN} tooltip={tip('allowFrom')} />
            <ArrayField label={es.groupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.phPhoneCN} tooltip={tip('groupAllowFrom')} />
            <NumberField label={es.historyLimit || 'History Limit'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} placeholder="50" tooltip={tip('historyLimit')} />
            <NumberField label={es.dmHistoryLimit || 'DM History Limit'} value={g(['dmHistoryLimit'])} onChange={v => s(['dmHistoryLimit'], v)} placeholder="50" tooltip={tip('dmHistoryLimit')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
            <SelectField label={es.chunkMode || 'Chunk Mode'} value={g(['chunkMode']) || ''} onChange={v => s(['chunkMode'], v)} options={chunkMode(es)} allowEmpty tooltip={tip('chunkMode')} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="50" tooltip={tip('mediaMaxMb')} />
            <SwitchField label={es.sendReadReceipts || 'Send Read Receipts'} value={g(['sendReadReceipts']) !== false} onChange={v => s(['sendReadReceipts'], v)} tooltip={es.tipSendReadReceipts} />
          </>
        )}

        {/* Google Chat */}
        {ch === 'googlechat' && (
          <>
            <TextField label={es.chAccount} value={g(['serviceAccount']) || ''} onChange={v => s(['serviceAccount'], v)} tooltip={es.tipGCServiceAccount} />
            <TextField label={es.serviceAccountFile || 'Service Account File'} value={g(['serviceAccountFile']) || ''} onChange={v => s(['serviceAccountFile'], v)} tooltip={es.tipGCServiceAccountFile} />
            <TextField label={labelWebhookPath} value={g(['webhookPath']) || ''} onChange={v => s(['webhookPath'], v)} tooltip={es.tipGCWebhook} />
            <TextField label={labelWebhookUrl} value={g(['webhookUrl']) || ''} onChange={v => s(['webhookUrl'], v)} placeholder={es.phHttps} tooltip={es.tipGCWebhookUrl} />
            <SelectField label={es.audienceType || 'Audience Type'} value={g(['audienceType']) || ''} onChange={v => s(['audienceType'], v)} options={[
              { value: 'app-url', label: 'App URL' },
              { value: 'project-number', label: 'Project Number' },
            ]} allowEmpty tooltip={es.tipGCAudienceType} />
            <TextField label={es.audience || 'Audience'} value={g(['audience']) || ''} onChange={v => s(['audience'], v)} tooltip={es.tipGCAudience} />
            <TextField label={es.botUser || 'Bot User'} value={g(['botUser']) || ''} onChange={v => s(['botUser'], v)} placeholder="users/..." tooltip={es.tipGCBotUser} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'open'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <SwitchField label={es.requireMention} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipGCMention} />
            <ArrayField label={es.groupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.phUserId} tooltip={tip('groupAllowFrom')} />
            <TextField label={es.defaultTo || 'Default To'} value={g(['defaultTo']) || ''} onChange={v => s(['defaultTo'], v)} tooltip={tip('defaultTo')} />
            <SwitchField label={es.allowBots || 'Allow Bots'} value={g(['allowBots']) === true} onChange={v => s(['allowBots'], v)} tooltip={es.tipAllowBots} />
            <NumberField label={es.historyLimit || 'History Limit'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} placeholder="50" tooltip={tip('historyLimit')} />
            <NumberField label={es.dmHistoryLimit || 'DM History Limit'} value={g(['dmHistoryLimit'])} onChange={v => s(['dmHistoryLimit'], v)} placeholder="50" tooltip={tip('dmHistoryLimit')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
            <SelectField label={es.chunkMode || 'Chunk Mode'} value={g(['chunkMode']) || ''} onChange={v => s(['chunkMode'], v)} options={chunkMode(es)} allowEmpty tooltip={tip('chunkMode')} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="50" tooltip={tip('mediaMaxMb')} />
            <SelectField label={es.replyToMode || 'Reply To Mode'} value={g(['replyToMode']) || 'off'} onChange={v => s(['replyToMode'], v)} options={replyToMode(es)} tooltip={tip('replyToMode')} />
            <SelectField label={es.typingIndicator || 'Typing Indicator'} value={g(['typingIndicator']) || 'message'} onChange={v => s(['typingIndicator'], v)} options={[
              { value: 'none', label: es.optNone || 'None' },
              { value: 'message', label: es.optMessage || 'Message' },
              { value: 'reaction', label: es.optReaction || 'Reaction' },
            ]} tooltip={es.tipGCTypingIndicator} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
          </>
        )}

        {/* MS Teams */}
        {ch === 'msteams' && (
          <>
            <TextField label={labelAppId} value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipTeamsAppId} />
            <PasswordField label={es.appPassword} value={g(['appPassword']) || ''} onChange={v => s(['appPassword'], v)} tooltip={es.tipTeamsAppPwd} />
            <TextField label={labelTenantId} value={g(['tenantId']) || ''} onChange={v => s(['tenantId'], v)} tooltip={es.tipTeamsTenant} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'open'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phUserId} tooltip={tip('allowFrom')} />
            <ArrayField label={es.groupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.phUserId} tooltip={tip('groupAllowFrom')} />
            <TextField label={es.defaultTo || 'Default To'} value={g(['defaultTo']) || ''} onChange={v => s(['defaultTo'], v)} tooltip={tip('defaultTo')} />
            <SwitchField label={es.requireMention} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipTeamsMention} />
            <SelectField label={es.replyStyle || 'Reply Style'} value={g(['replyStyle']) || 'thread'} onChange={v => s(['replyStyle'], v)} options={[
              { value: 'thread', label: es.optThread || 'Thread' },
              { value: 'top-level', label: es.optTopLevel || 'Top Level' },
            ]} tooltip={es.tipTeamsReplyStyle} />
            <NumberField label={es.webhookPort || 'Webhook Port'} value={g(['webhook', 'port'])} onChange={v => s(['webhook', 'port'], v)} placeholder="3978" tooltip={es.tipTeamsWebhookPort} />
            <TextField label={es.webhookPath || 'Webhook Path'} value={g(['webhook', 'path']) || ''} onChange={v => s(['webhook', 'path'], v)} placeholder="/api/messages" tooltip={es.tipTeamsWebhookPath} />
            <NumberField label={es.historyLimit || 'History Limit'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} placeholder="50" tooltip={tip('historyLimit')} />
            <NumberField label={es.dmHistoryLimit || 'DM History Limit'} value={g(['dmHistoryLimit'])} onChange={v => s(['dmHistoryLimit'], v)} placeholder="50" tooltip={tip('dmHistoryLimit')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
            <SelectField label={es.chunkMode || 'Chunk Mode'} value={g(['chunkMode']) || ''} onChange={v => s(['chunkMode'], v)} options={chunkMode(es)} allowEmpty tooltip={tip('chunkMode')} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="100" tooltip={tip('mediaMaxMb')} />
            <TextField label={es.sharePointSiteId || 'SharePoint Site ID'} value={g(['sharePointSiteId']) || ''} onChange={v => s(['sharePointSiteId'], v)} tooltip={es.tipTeamsSharePoint} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
          </>
        )}

        {/* Mattermost */}
        {ch === 'mattermost' && (
          <>
            <PasswordField label={labelBotToken} value={g(['botToken']) || ''} onChange={v => s(['botToken'], v)} tooltip={es.tipMMToken} />
            <TextField label={labelBaseUrl} value={g(['baseUrl']) || ''} onChange={v => s(['baseUrl'], v)} placeholder={es.phMattermostUrl} tooltip={es.tipMMUrl} />
            <SelectField label={es.chatMode} value={g(['chatmode']) || 'oncall'} onChange={v => s(['chatmode'], v)} options={[
              { value: 'oncall', label: es.optOnMention },
              { value: 'onchar', label: es.optOnChar },
              { value: 'onmessage', label: es.optOnMessage },
            ]} tooltip={es.tipMMChatMode} />
            <SwitchField label={es.requireMention} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipMMMention} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phUserId} tooltip={tip('allowFrom')} />
            <ArrayField label={es.groupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.phUserId} tooltip={tip('groupAllowFrom')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
            <SelectField label={es.chunkMode || 'Chunk Mode'} value={g(['chunkMode']) || ''} onChange={v => s(['chunkMode'], v)} options={chunkMode(es)} allowEmpty tooltip={tip('chunkMode')} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
          </>
        )}

        {/* Matrix */}
        {ch === 'matrix' && (
          <>
            <TextField label={labelHomeserver} value={g(['homeserver']) || ''} onChange={v => s(['homeserver'], v)} placeholder={es.phMatrixHomeserver} tooltip={tip('matrixHome')} />
            <TextField label={es.userId} value={g(['userId']) || ''} onChange={v => s(['userId'], v)} placeholder={es.phMatrixUserId} tooltip={es.tipMatrixUser} />
            <PasswordField label={labelAccessToken} value={g(['accessToken']) || ''} onChange={v => s(['accessToken'], v)} tooltip={es.tipMatrixToken} />
            <PasswordField label={es.matrixPassword || 'Password'} value={g(['password']) || ''} onChange={v => s(['password'], v)} tooltip={es.tipMatrixPassword} />
            <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-2 md:py-1.5">
              <div className="md:col-span-4 lg:col-span-5 flex flex-col">
                <div className="flex items-center gap-1">
                  <label className="text-[11px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none">
                    {es.dmPolicy}
                  </label>
                  <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-slate-500 cursor-help" title={tip('dmPolicy')}>info</span>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dm', 'policy']) || 'pairing'}
                    onChange={v => s(['dm', 'policy'], v)}
                    options={dmPolicy(es)}
                    className="h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[12px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 w-full md:w-64"
                  />
                  {(g(['dm', 'policy']) || 'pairing') === 'pairing' && (
                    <button
                      type="button"
                      onClick={() => setShowMatrixPairing(!showMatrixPairing)}
                      className="h-8 px-3 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors whitespace-nowrap"
                    >
                      {showMatrixPairing ? '隐藏配对' : '手动配对'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {showMatrixPairing && (g(['dm', 'policy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="matrix" es={es} cw={cw} toast={toast} />
            )}
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'open'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <SwitchField label={es.matrixEncryption || 'Encryption'} value={g(['encryption']) === true} onChange={v => s(['encryption'], v)} tooltip={es.tipMatrixEncryption} />
            <SelectField label={es.replyToMode || 'Reply To Mode'} value={g(['replyToMode']) || 'off'} onChange={v => s(['replyToMode'], v)} options={replyToMode(es)} tooltip={tip('replyToMode')} />
            <SelectField label={es.matrixThreadReplies || 'Thread Replies'} value={g(['threadReplies']) || 'off'} onChange={v => s(['threadReplies'], v)} options={[
              { value: 'off', label: es.optOff },
              { value: 'inbound', label: es.optInbound || 'Inbound' },
              { value: 'always', label: es.optAlways || 'Always' },
            ]} tooltip={es.tipMatrixThreadReplies} />
            <SelectField label={es.matrixAutoJoin || 'Auto Join'} value={g(['autoJoin']) || 'off'} onChange={v => s(['autoJoin'], v)} options={[
              { value: 'always', label: es.optAlways || 'Always' },
              { value: 'allowlist', label: es.optAllowlist },
              { value: 'off', label: es.optOff },
            ]} tooltip={es.tipMatrixAutoJoin} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
            <SelectField label={es.chunkMode || 'Chunk Mode'} value={g(['chunkMode']) || ''} onChange={v => s(['chunkMode'], v)} options={chunkMode(es)} allowEmpty tooltip={tip('chunkMode')} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="50" tooltip={tip('mediaMaxMb')} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
          </>
        )}

        {/* 飞书 */}
        {ch === 'feishu' && (
          <>
            <TextField label={labelAppId} value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipFeishuAppId} />
            <PasswordField label={labelAppSecret} value={g(['appSecret']) || ''} onChange={v => s(['appSecret'], v)} tooltip={es.tipFeishuSecret} />
            <SelectField label={es.chDomain} value={g(['domain']) || 'feishu'} onChange={v => s(['domain'], v)} options={[
              { value: 'feishu', label: es.optFeishu },
              { value: 'lark', label: es.optLark },
            ]} tooltip={tip('feishuDomain')} />
            <SelectField label={es.connModeLabel} value={g(['connectionMode']) || 'websocket'} onChange={v => s(['connectionMode'], v)} options={[
              { value: 'websocket', label: es.optWebSocket },
              { value: 'webhook', label: es.optWebhook },
            ]} tooltip={tip('feishuConn')} />
            {(g(['connectionMode']) || 'websocket') === 'webhook' && (
              <>
                <TextField label={es.feishuWebhookPath || 'Webhook Path'} value={g(['webhookPath']) || '/feishu/events'} onChange={v => s(['webhookPath'], v)} tooltip={es.tipFeishuWebhookPath} />
                <TextField label={es.feishuWebhookHost || 'Webhook Host'} value={g(['webhookHost']) || ''} onChange={v => s(['webhookHost'], v)} placeholder="127.0.0.1" tooltip={es.tipFeishuWebhookHost} />
                <NumberField label={es.feishuWebhookPort || 'Webhook Port'} value={g(['webhookPort'])} onChange={v => s(['webhookPort'], v)} placeholder="3000" tooltip={es.tipFeishuWebhookPort} />
              </>
            )}
            <PasswordField label={es.encryptKey} value={g(['encryptKey']) || ''} onChange={v => s(['encryptKey'], v)} tooltip={es.tipFeishuEncrypt} />
            <PasswordField label={es.verificationToken} value={g(['verificationToken']) || ''} onChange={v => s(['verificationToken'], v)} tooltip={es.tipFeishuVerify} />
            <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-2 md:py-1.5">
              <div className="md:col-span-4 lg:col-span-5 flex flex-col">
                <div className="flex items-center gap-1">
                  <label className="text-[11px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none">
                    {es.dmPolicy}
                  </label>
                  <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-slate-500 cursor-help" title={tip('dmPolicy')}>info</span>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className="h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[12px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 w-full md:w-64"
                  />
                  {(g(['dmPolicy']) || 'pairing') === 'pairing' && (
                    <button
                      type="button"
                      onClick={() => setShowFeishuPairing(!showFeishuPairing)}
                      className="h-8 px-3 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors whitespace-nowrap"
                    >
                      {showFeishuPairing ? '隐藏配对' : '手动配对'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {showFeishuPairing && (g(['dmPolicy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="feishu" es={es} cw={cw} toast={toast} />
            )}
            <ArrayField label={es.allowFrom || 'Allow From'} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.feishuAllowFromPh || 'ou_xxx'} tooltip={es.tipFeishuAllowFrom} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.feishuGroupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.feishuGroupAllowFromPh || 'oc_xxx'} tooltip={es.tipFeishuGroupAllowFrom} />
            <SwitchField label={es.feishuRequireMention || 'Require @Mention'} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipFeishuRequireMention} />
            <SwitchField label={es.feishuStreaming || 'Streaming'} value={g(['streaming']) !== false} onChange={v => s(['streaming'], v)} tooltip={es.tipFeishuStreaming} />
            <SelectField label={es.feishuRenderMode || 'Render Mode'} value={g(['renderMode']) || 'auto'} onChange={v => s(['renderMode'], v)} options={[
              { value: 'auto', label: es.optAuto || 'Auto' },
              { value: 'raw', label: es.optRaw || 'Raw' },
              { value: 'card', label: es.optCard || 'Card' },
            ]} tooltip={es.tipFeishuRenderMode} />
            <SelectField label={es.feishuReplyInThread || 'Reply in Thread'} value={g(['replyInThread']) || 'disabled'} onChange={v => s(['replyInThread'], v)} options={[
              { value: 'disabled', label: es.optDisabled },
              { value: 'enabled', label: es.optEnabled || 'Enabled' },
            ]} tooltip={es.tipFeishuReplyInThread} />
            <SwitchField label={es.feishuTypingIndicator || 'Typing Indicator'} value={g(['typingIndicator']) !== false} onChange={v => s(['typingIndicator'], v)} tooltip={es.tipFeishuTypingIndicator} />
            <SwitchField label={es.feishuResolveSenderNames || 'Resolve Sender Names'} value={g(['resolveSenderNames']) !== false} onChange={v => s(['resolveSenderNames'], v)} tooltip={es.tipFeishuResolveSenderNames} />
            <SelectField label={es.feishuGroupSessionScope || 'Group Session Scope'} value={g(['groupSessionScope']) || 'group'} onChange={v => s(['groupSessionScope'], v)} options={[
              { value: 'group', label: es.optScopeGroup || 'Per Group' },
              { value: 'group_sender', label: es.optScopeGroupSender || 'Per Group+Sender' },
              { value: 'group_topic', label: es.optScopeGroupTopic || 'Per Topic' },
              { value: 'group_topic_sender', label: es.optScopeGroupTopicSender || 'Per Topic+Sender' },
            ]} tooltip={es.tipFeishuGroupSessionScope} />
            <SelectField label={es.feishuReactionNotifications || 'Reaction Notifications'} value={g(['reactionNotifications']) || 'own'} onChange={v => s(['reactionNotifications'], v)} options={[
              { value: 'off', label: es.optOff },
              { value: 'own', label: es.optOwn || 'Own' },
              { value: 'all', label: es.optAll || 'All' },
            ]} tooltip={es.tipFeishuReactionNotifications} />
            <NumberField label={es.feishuTextChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="2000" tooltip={es.tipFeishuTextChunkLimit} />
            <NumberField label={es.feishuMediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="30" tooltip={es.tipFeishuMediaMaxMb} />
            {/* Feishu Tools */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.feishuToolsTitle || 'Feishu Tools'}</span>
            </div>
            <SwitchField label={es.feishuToolDoc || 'Document'} value={g(['tools', 'doc']) !== false} onChange={v => s(['tools', 'doc'], v)} tooltip={es.tipFeishuToolDoc} />
            <SwitchField label={es.feishuToolChat || 'Chat'} value={g(['tools', 'chat']) !== false} onChange={v => s(['tools', 'chat'], v)} tooltip={es.tipFeishuToolChat} />
            <SwitchField label={es.feishuToolWiki || 'Wiki'} value={g(['tools', 'wiki']) !== false} onChange={v => s(['tools', 'wiki'], v)} tooltip={es.tipFeishuToolWiki} />
            <SwitchField label={es.feishuToolDrive || 'Drive'} value={g(['tools', 'drive']) !== false} onChange={v => s(['tools', 'drive'], v)} tooltip={es.tipFeishuToolDrive} />
            <SwitchField label={es.feishuToolPerm || 'Permissions'} value={g(['tools', 'perm']) === true} onChange={v => s(['tools', 'perm'], v)} tooltip={es.tipFeishuToolPerm} />
            <SwitchField label={es.feishuToolScopes || 'Scopes Diagnostic'} value={g(['tools', 'scopes']) !== false} onChange={v => s(['tools', 'scopes'], v)} tooltip={es.tipFeishuToolScopes} />
            {/* Feishu Multi-Account */}
            <FeishuAccountsSection g={g} s={s} deleteField={deleteField} es={es} ch={ch} />
          </>
        )}

        {/* 企业微信（智能机器人） */}
        {ch === 'wecom' && (
          <>
            <TextField label="Bot ID" value={g(['botId']) || ''} onChange={v => s(['botId'], v)} tooltip={es.tipWecomBotId} />
            <PasswordField label="Secret" value={g(['secret']) || ''} onChange={v => s(['secret'], v)} tooltip={es.tipWecomBotSecret} />
            <SelectField label={es.connModeLabel} value={g(['connectionMode']) || 'longConnection'} onChange={v => s(['connectionMode'], v)} options={[
              { value: 'longConnection', label: es.optLongConnection || 'Long Connection' },
              { value: 'webhook', label: es.optWebhook },
            ]} tooltip={es.tipWecomConn} />
            {g(['connectionMode']) === 'webhook' && (
              <>
                <TextField label={es.chWebhookPath} value={g(['webhookPath']) || '/wecom'} onChange={v => s(['webhookPath'], v)} tooltip={es.tipWecomWebhookPath} />
                <PasswordField label={labelToken} value={g(['token']) || ''} onChange={v => s(['token'], v)} tooltip={es.tipWecomToken} />
                <PasswordField label={labelEncodingAESKey} value={g(['encodingAESKey']) || ''} onChange={v => s(['encodingAESKey'], v)} tooltip={es.tipWecomAes} />
              </>
            )}
            <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-2 md:py-1.5">
              <div className="md:col-span-4 lg:col-span-5 flex flex-col">
                <div className="flex items-center gap-1">
                  <label className="text-[11px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none">
                    {es.dmPolicy}
                  </label>
                  <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-slate-500 cursor-help" title={tip('dmPolicy')}>info</span>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className="h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[12px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 w-full md:w-64"
                  />
                  {(g(['dmPolicy']) || 'pairing') === 'pairing' && (
                    <button
                      type="button"
                      onClick={() => setShowWecomPairing(!showWecomPairing)}
                      className="h-8 px-3 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors whitespace-nowrap"
                    >
                      {showWecomPairing ? '隐藏配对' : '手动配对'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {showWecomPairing && (g(['dmPolicy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="wecom" es={es} cw={cw} toast={toast} />
            )}
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'open'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <SwitchField label={es.requireMention} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipWecomMention} />
          </>
        )}

        {/* 企微自建应用 (wecom-app) */}
        {ch === 'wecom_kf' && (
          <>
            <TextField label={es.chWebhookPath} value={g(['webhookPath']) || '/wecom-app'} onChange={v => s(['webhookPath'], v)} tooltip={es.tipWecomAppWebhookPath} />
            <PasswordField label={labelToken} value={g(['token']) || ''} onChange={v => s(['token'], v)} tooltip={es.tipWecomToken} />
            <PasswordField label={labelEncodingAESKey} value={g(['encodingAESKey']) || ''} onChange={v => s(['encodingAESKey'], v)} tooltip={es.tipWecomAes} />
            <TextField label={labelCorpId} value={g(['corpId']) || ''} onChange={v => s(['corpId'], v)} tooltip={es.tipWecomCorpId} />
            <PasswordField label={labelCorpSecret} value={g(['corpSecret']) || ''} onChange={v => s(['corpSecret'], v)} tooltip={es.tipWecomAppSecret} />
            <NumberField label={labelAgentId} value={g(['agentId'])} onChange={v => s(['agentId'], v)} placeholder={es.phAgentId} tooltip={es.tipWecomAppAgentId} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'open'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
          </>
        )}

        {/* 微信 */}
        {ch === 'wechat' && (
          <>
            <TextField label={labelAppId} value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipWechatAppId} />
            <PasswordField label={labelAppSecret} value={g(['appSecret']) || ''} onChange={v => s(['appSecret'], v)} tooltip={es.tipWechatSecret} />
            <PasswordField label={labelToken} value={g(['token']) || ''} onChange={v => s(['token'], v)} tooltip={es.tipWechatToken} />
            <PasswordField label={labelEncodingAESKey} value={g(['encodingAesKey']) || ''} onChange={v => s(['encodingAesKey'], v)} tooltip={es.tipWechatAes} />
          </>
        )}

        {/* QQ */}
        {ch === 'qq' && (
          <>
            <TextField label={labelAppId} value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipQQAppId} />
            <PasswordField label={labelClientSecret} value={g(['clientSecret']) || ''} onChange={v => s(['clientSecret'], v)} tooltip={es.tipQQClientSecret} />
            <SwitchField label={es.chMarkdownSupport} value={g(['markdownSupport']) === true} onChange={v => s(['markdownSupport'], v)} tooltip={es.tipQQMarkdown} />
          </>
        )}

        {/* 钉钉 */}
        {ch === 'dingtalk' && (
          <>
            <TextField label={labelClientId} value={g(['clientId']) || ''} onChange={v => s(['clientId'], v)} tooltip={es.tipDTClientId} />
            <PasswordField label={labelClientSecret} value={g(['clientSecret']) || ''} onChange={v => s(['clientSecret'], v)} tooltip={es.tipDTClientSecret} />
            <SwitchField label={es.chEnableAICard} value={g(['enableAICard']) === true} onChange={v => s(['enableAICard'], v)} tooltip={es.tipDTAICard} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'open'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'open'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <SwitchField label={es.requireMention} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipDTMention} />
          </>
        )}

        {/* 豆包 */}
        {ch === 'doubao' && (
          <>
            <TextField label={labelAppId} value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipDoubaoAppId} />
            <PasswordField label={labelAppSecret} value={g(['appSecret']) || ''} onChange={v => s(['appSecret'], v)} tooltip={es.tipDoubaoSecret} />
            <PasswordField label={labelToken} value={g(['token']) || ''} onChange={v => s(['token'], v)} tooltip={es.tipDoubaoToken} />
          </>
        )}

        {/* Zalo */}
        {ch === 'zalo' && (
          <>
            <PasswordField label={es.chToken} value={g(['botToken']) || ''} onChange={v => s(['botToken'], v)} tooltip={es.tipZaloToken} />
            <div className="flex flex-col md:grid md:grid-cols-12 md:items-start gap-2 md:gap-3 py-2 md:py-1.5">
              <div className="md:col-span-4 lg:col-span-5 flex flex-col">
                <div className="flex items-center gap-1">
                  <label className="text-[11px] md:text-xs font-semibold text-slate-500 dark:text-slate-400 select-none">
                    {es.dmPolicy}
                  </label>
                  <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-slate-500 cursor-help" title={tip('dmPolicy')}>info</span>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className="h-8 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-md px-3 text-[12px] md:text-xs font-mono text-slate-800 dark:text-slate-200 outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 w-full md:w-64"
                  />
                  {(g(['dmPolicy']) || 'pairing') === 'pairing' && (
                    <button
                      type="button"
                      onClick={() => setShowZaloPairing(!showZaloPairing)}
                      className="h-8 px-3 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors whitespace-nowrap"
                    >
                      {showZaloPairing ? '隐藏配对' : '手动配对'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {showZaloPairing && (g(['dmPolicy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="zalo" es={es} cw={cw} toast={toast} />
            )}
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'disabled'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phUserId} tooltip={tip('allowFrom')} />
            <ArrayField label={es.groupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.phUserId} tooltip={tip('groupAllowFrom')} />
            <TextField label={labelWebhookUrl} value={g(['webhookUrl']) || ''} onChange={v => s(['webhookUrl'], v)} placeholder={es.phHttps} tooltip={es.tipZaloWebhookUrl} />
            <PasswordField label={es.webhookSecret || 'Webhook Secret'} value={g(['webhookSecret']) || ''} onChange={v => s(['webhookSecret'], v)} tooltip={es.tipZaloWebhookSecret} />
            <TextField label={es.webhookPath || 'Webhook Path'} value={g(['webhookPath']) || ''} onChange={v => s(['webhookPath'], v)} tooltip={es.tipZaloWebhookPath} />
            <NumberField label={es.mediaMaxMb || 'Media Max MB'} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} placeholder="25" tooltip={tip('mediaMaxMb')} />
            <TextField label={es.proxy || 'Proxy'} value={g(['proxy']) || ''} onChange={v => s(['proxy'], v)} placeholder="http://host:port" tooltip={tip('proxy')} />
            <TextField label={es.responsePrefix || 'Response Prefix'} value={g(['responsePrefix']) || ''} onChange={v => s(['responsePrefix'], v)} tooltip={tip('responsePrefix')} />
          </>
        )}

        {/* Voice Call */}
        {ch === 'voicecall' && (
          <>
            <SelectField label={es.voiceProvider} value={g(['provider']) || 'mock'} onChange={v => s(['provider'], v)} options={[
              { value: 'twilio', label: es.optTwilio },
              { value: 'telnyx', label: es.optTelnyx },
              { value: 'plivo', label: es.optPlivo || 'Plivo' },
              { value: 'mock', label: es.mockDev },
            ]} tooltip={tip('voiceProvider')} />
            <TextField label={es.fromNumber} value={g(['fromNumber']) || ''} onChange={v => s(['fromNumber'], v)} placeholder={es.phVoiceNumber} tooltip={es.tipVoiceFrom} />
            <TextField label={es.toNumber} value={g(['toNumber']) || ''} onChange={v => s(['toNumber'], v)} placeholder={es.phVoiceNumber} tooltip={es.tipVoiceTo} />
            {g(['provider']) === 'twilio' && (
              <>
                <TextField label={labelAccountSid} value={g(['twilio', 'accountSid']) || ''} onChange={v => s(['twilio', 'accountSid'], v)} />
                <PasswordField label={labelAuthToken} value={g(['twilio', 'authToken']) || ''} onChange={v => s(['twilio', 'authToken'], v)} />
              </>
            )}
            {g(['provider']) === 'telnyx' && (
              <>
                <PasswordField label={labelApiKey} value={g(['telnyx', 'apiKey']) || ''} onChange={v => s(['telnyx', 'apiKey'], v)} />
                <TextField label={labelConnectionId} value={g(['telnyx', 'connectionId']) || ''} onChange={v => s(['telnyx', 'connectionId'], v)} />
                <PasswordField label={es.telnyxPublicKey || 'Public Key'} value={g(['telnyx', 'publicKey']) || ''} onChange={v => s(['telnyx', 'publicKey'], v)} tooltip={es.tipTelnyxPublicKey} />
              </>
            )}
            {g(['provider']) === 'plivo' && (
              <>
                <TextField label={es.plivoAuthId || 'Auth ID'} value={g(['plivo', 'authId']) || ''} onChange={v => s(['plivo', 'authId'], v)} tooltip={es.tipPlivoAuthId} />
                <PasswordField label={labelAuthToken} value={g(['plivo', 'authToken']) || ''} onChange={v => s(['plivo', 'authToken'], v)} tooltip={es.tipPlivoAuthToken} />
              </>
            )}
            <SelectField label={es.inboundPolicy || 'Inbound Policy'} value={g(['inboundPolicy']) || 'disabled'} onChange={v => s(['inboundPolicy'], v)} options={inboundPolicy(es)} tooltip={es.tipInboundPolicy} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phVoiceNumber} tooltip={es.tipVoiceAllowFrom} />
            <TextField label={es.inboundGreeting || 'Inbound Greeting'} value={g(['inboundGreeting']) || ''} onChange={v => s(['inboundGreeting'], v)} tooltip={es.tipInboundGreeting} />
            <NumberField label={es.maxDuration || 'Max Duration (s)'} value={g(['maxDurationSeconds'])} onChange={v => s(['maxDurationSeconds'], v)} placeholder="300" tooltip={es.tipMaxDuration} />
            <NumberField label={es.maxConcurrentCalls || 'Max Concurrent Calls'} value={g(['maxConcurrentCalls'])} onChange={v => s(['maxConcurrentCalls'], v)} placeholder="1" tooltip={es.tipMaxConcurrent} />
            <TextField label={es.publicUrl || 'Public URL'} value={g(['publicUrl']) || ''} onChange={v => s(['publicUrl'], v)} placeholder="https://..." tooltip={es.tipPublicUrl} />
            {/* Voice Call - Webhook Server */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.voiceServeTitle || 'Webhook Server'}</span>
            </div>
            <NumberField label={es.webhookPort || 'Port'} value={g(['serve', 'port'])} onChange={v => s(['serve', 'port'], v)} placeholder="3334" tooltip={es.tipVoiceServePort} />
            <TextField label={es.serveBind || 'Bind'} value={g(['serve', 'bind']) || ''} onChange={v => s(['serve', 'bind'], v)} placeholder="127.0.0.1" tooltip={es.tipVoiceServeBind} />
            <TextField label={es.webhookPath || 'Path'} value={g(['serve', 'path']) || ''} onChange={v => s(['serve', 'path'], v)} placeholder="/voice/webhook" tooltip={es.tipVoiceServePath} />
            {/* Voice Call - Tunnel */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.voiceTunnelTitle || 'Tunnel'}</span>
            </div>
            <SelectField label={es.tunnelProvider || 'Tunnel Provider'} value={g(['tunnel', 'provider']) || 'none'} onChange={v => s(['tunnel', 'provider'], v)} options={[
              { value: 'none', label: es.optNone || 'None' },
              { value: 'ngrok', label: 'ngrok' },
              { value: 'tailscale-serve', label: 'Tailscale Serve' },
              { value: 'tailscale-funnel', label: 'Tailscale Funnel' },
            ]} tooltip={es.tipTunnelProvider} />
            {/* Voice Call - Outbound */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.voiceOutboundTitle || 'Outbound'}</span>
            </div>
            <SelectField label={es.callMode || 'Default Mode'} value={g(['outbound', 'defaultMode']) || 'notify'} onChange={v => s(['outbound', 'defaultMode'], v)} options={[
              { value: 'notify', label: es.optNotify || 'Notify' },
              { value: 'conversation', label: es.optConversation || 'Conversation' },
            ]} tooltip={es.tipCallMode} />
            {/* Voice Call - Response */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold text-slate-500 dark:text-white/40">{es.voiceResponseTitle || 'Response'}</span>
            </div>
            <TextField label={es.responseModel || 'Response Model'} value={g(['responseModel']) || ''} onChange={v => s(['responseModel'], v)} placeholder="openai/gpt-4o-mini" tooltip={es.tipResponseModel} />
            <TextField label={es.responseSystemPrompt || 'System Prompt'} value={g(['responseSystemPrompt']) || ''} onChange={v => s(['responseSystemPrompt'], v)} tooltip={es.tipResponseSystemPrompt} />
          </>
        )}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <ConfigSection title={es.channelConfig} icon="settings" iconColor="text-slate-500" defaultOpen={false}>
        <SelectField label={es.groupMode} value={getField(['channels', 'defaults', 'groupPolicy']) || 'allowlist'} onChange={v => setField(['channels', 'defaults', 'groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
      </ConfigSection>

      {channelKeys.filter(k => k !== 'defaults').length === 0 ? (
        <EmptyState message={es.noChannels} icon="forum" />
      ) : (
        channelKeys.filter(k => k !== 'defaults').map(ch => {
          const cfg = channels[ch] || {};
          const info = CHANNEL_TYPES.find(c => c.id === ch);
          return (
            <ConfigSection
              key={ch}
              title={info ? (es as any)[info.labelKey] : ch}
              icon={info?.icon || 'forum'}
              iconColor={cfg.enabled !== false ? 'text-green-500' : 'text-slate-400'}
              desc={info ? (es as any)[info.descKey] : undefined}
              defaultOpen={false}
              actions={
                <div className="flex items-center gap-1">
                  <button onClick={() => { setSendChannel(sendChannel === ch ? null : ch); setSendResult(null); }} className="text-slate-400 hover:text-sky-500 transition-colors" title={es.chSendTest} aria-label={es.chSendTest}>
                    <span className="material-symbols-outlined text-[14px]">send</span>
                  </button>
                  <button onClick={() => setLogoutChannel(logoutChannel === ch ? null : ch)} className="text-slate-400 hover:text-amber-500 transition-colors" title={es.chLogout} aria-label={es.chLogout}>
                    <span className="material-symbols-outlined text-[14px]">logout</span>
                  </button>
                  <button onClick={() => setDeleteConfirm(ch)} className="text-slate-400 hover:text-red-500 transition-colors" title={es.delete} aria-label={es.delete}>
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                  </button>
                </div>
              }
            >
              {sendChannel === ch && (
                <div className="mb-3 px-3 py-2.5 rounded-xl bg-sky-50 dark:bg-sky-500/5 border border-sky-200 dark:border-sky-500/20 space-y-2">
                  <div className="text-[10px] font-bold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">send</span>
                    {es.chSendTest}
                  </div>
                  <input value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder={es.chSendToPlaceholder}
                    className="w-full h-7 px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] text-slate-700 dark:text-white/70 outline-none" disabled={sendBusy} />
                  <input value={sendMsg} onChange={e => setSendMsg(e.target.value)} placeholder={es.chSendMsgPlaceholder}
                    className="w-full h-7 px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] text-slate-700 dark:text-white/70 outline-none" disabled={sendBusy} />
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleSendTest(ch)} disabled={sendBusy || !sendTo.trim()}
                      className="px-3 py-1 rounded-lg bg-sky-500 text-white text-[10px] font-bold disabled:opacity-40 transition-all">
                      {sendBusy ? es.chSending : es.chSendTest}
                    </button>
                    <button onClick={() => setSendChannel(null)} disabled={sendBusy}
                      className="px-3 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                      {es.cancel}
                    </button>
                  </div>
                  {sendResult && sendResult.ch === ch && (
                    <div className={`px-2 py-1.5 rounded-lg text-[10px] ${sendResult.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-red-50 dark:bg-red-500/5 text-red-500'}`}>
                      {sendResult.text}
                    </div>
                  )}
                </div>
              )}
              {logoutChannel === ch && (
                <div className="mb-3 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 mb-2">{es.chLogoutConfirm}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleLogout(ch)} disabled={logoutBusy}
                      className="px-3 py-1 rounded-lg bg-amber-500 text-white text-[10px] font-bold disabled:opacity-40 transition-all">
                      {logoutBusy ? es.chLoggingOut : es.chLogout}
                    </button>
                    <button onClick={() => setLogoutChannel(null)} disabled={logoutBusy}
                      className="px-3 py-1 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                      {es.cancel}
                    </button>
                  </div>
                </div>
              )}
              {logoutMsg && logoutMsg.ch === ch && (
                <div className={`mb-3 px-3 py-2 rounded-xl text-[10px] ${logoutMsg.ok ? 'bg-mac-green/10 text-mac-green border border-mac-green/20' : 'bg-red-50 dark:bg-red-500/5 text-red-500 border border-red-200 dark:border-red-500/20'}`}>
                  {logoutMsg.text}
                </div>
              )}
              {renderChannelFields(ch, cfg)}
            </ConfigSection>
          );
        })
      )}

      {/* ================================================================ */}
      {/* 添加频道向导（5-Step Accordion Stepper） */}
      {/* ================================================================ */}
      {!addingChannel ? (
        <button
          onClick={() => { setAddingChannel('selecting'); setWizardStep(0); checkCanInstallPlugin(); }}
          className="w-full py-3 border-2 border-dashed border-primary/30 hover:border-primary/60 rounded-xl text-xs font-bold text-primary hover:bg-primary/5 transition-all flex items-center justify-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">add_circle</span>
          {es.addChannel}
        </button>
      ) : (() => {
        const chId = addingChannel !== 'selecting' ? addingChannel : '';
        const chInfo = CHANNEL_TYPES.find(c => c.id === chId);
        const cfg = chId ? (channels[chId] || {}) : {};
        const prepSteps: string[] = chId ? ((cw as any)[`${chId}Prep`] || []) : [];
        const pitfall: string = chId ? ((cw as any)[`${chId}Pitfall`] || '') : '';

        const WIZARD_STEPS = [
          { icon: 'forum', label: es.selectChannel || cw.stepChannel },
          { icon: 'checklist', label: cw.stepPrep },
          { icon: 'key', label: cw.stepCredential },
          { icon: 'shield', label: cw.stepAccess },
          { icon: 'check_circle', label: cw.stepConfirm },
        ];

        const stepDone = (i: number) => i < wizardStep;
        const stepActive = (i: number) => i === wizardStep;
        const stepLocked = (i: number) => i > wizardStep;

        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-bold text-slate-700 dark:text-white/80 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-primary">auto_fix_high</span>
                {es.addChannel}
              </h3>
              <button onClick={() => { if (chId) deleteField(['channels', chId]); resetWizard(); }} className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-white/60">
                {es.cancel}
              </button>
            </div>

            {/* ── Step 0: 选择频道 ── */}
            <div className={`border rounded-xl overflow-hidden transition-colors ${stepActive(0) ? 'border-primary/40 bg-white dark:bg-white/[0.02]' : stepDone(0) ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5' : 'border-slate-200 dark:border-white/[0.06] opacity-50'}`}>
              <div className={`flex items-center gap-2.5 px-4 py-3 ${stepDone(0) ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]' : ''}`} onClick={() => stepDone(0) && setWizardStep(0)}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${stepDone(0) ? 'bg-green-500 text-white' : stepActive(0) ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-400'}`}>
                  {stepDone(0) ? <span className="material-symbols-outlined text-[14px]">check</span> : 1}
                </div>
                <span className={`material-symbols-outlined text-[16px] ${stepDone(0) ? 'text-green-500' : stepActive(0) ? 'text-primary' : 'text-slate-400'}`}>forum</span>
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-bold ${stepActive(0) ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-white/60'}`}>{WIZARD_STEPS[0].label}</span>
                  {stepDone(0) && chInfo && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">{(es as any)[chInfo.labelKey]}</p>}
                </div>
                <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${stepActive(0) ? 'rotate-180' : ''}`}>expand_more</span>
              </div>
              {stepActive(0) && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/[0.04]">
                  <div className="space-y-3 pt-3">
                    {CATEGORY_ORDER.map(cat => {
                      const items = CHANNEL_TYPES.filter(c => c.category === cat && !channelKeys.includes(c.id) && !c.disabled);
                      if (items.length === 0) return null;
                      return (
                        <div key={cat}>
                          <div className="text-[10px] font-medium text-slate-400 dark:text-white/40 mb-1.5">
                            {(es as any)[CATEGORY_KEYS[cat]]}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {items.map(c => (
                              <button key={c.id} onClick={() => addChannel(c.id)}
                                className="flex items-center gap-2.5 p-2.5 rounded-lg border-2 border-slate-200 dark:border-white/10 hover:border-primary/40 transition-all text-start group">
                                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/5 group-hover:bg-primary/10 flex items-center justify-center shrink-0 transition-colors">
                                  <span className="material-symbols-outlined text-[16px] text-slate-500 dark:text-white/40 group-hover:text-primary transition-colors">{c.icon}</span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] font-bold text-slate-700 dark:text-white/80 group-hover:text-primary transition-colors truncate">{(es as any)[c.labelKey]}</div>
                                  <div className="text-[11px] text-slate-400 dark:text-white/40 truncate">{(es as any)[c.descKey]}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Step 1: 前置准备 ── */}
            <div className={`border rounded-xl overflow-hidden transition-colors ${stepActive(1) ? 'border-primary/40 bg-white dark:bg-white/[0.02]' : stepDone(1) ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5' : 'border-slate-200 dark:border-white/[0.06] opacity-50'}`}>
              <div className={`flex items-center gap-2.5 px-4 py-3 ${stepDone(1) ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]' : ''}`} onClick={() => stepDone(1) && setWizardStep(1)}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${stepDone(1) ? 'bg-green-500 text-white' : stepActive(1) ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-400'}`}>
                  {stepDone(1) ? <span className="material-symbols-outlined text-[14px]">check</span> : 2}
                </div>
                <span className={`material-symbols-outlined text-[16px] ${stepDone(1) ? 'text-green-500' : stepActive(1) ? 'text-primary' : 'text-slate-400'}`}>checklist</span>
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-bold ${stepActive(1) ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-white/60'}`}>{WIZARD_STEPS[1].label}</span>
                  {stepDone(1) && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">{cw.prepDone}</p>}
                </div>
                <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${stepActive(1) ? 'rotate-180' : ''}`}>expand_more</span>
              </div>
              {stepActive(1) && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/[0.04]">
                  <div className="space-y-2 pt-3">
                    {/* Help link to open platform */}
                    {chId && (cw as any)[`${chId}HelpUrl`] && (
                      <a href={(cw as any)[`${chId}HelpUrl`]} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/5 border border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/10 transition-colors cursor-pointer">
                        <span className="material-symbols-outlined text-[14px] text-blue-500">open_in_new</span>
                        <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">{cw.openPlatform}</span>
                        <span className="text-[11px] text-blue-400 dark:text-blue-500 truncate ms-auto">{(cw as any)[`${chId}HelpUrl`]}</span>
                      </a>
                    )}
                    {/* Plugin install hint for channels that need plugins */}
                    {chId && ['feishu', 'dingtalk', 'qq', 'msteams', 'zalo', 'voicecall', 'matrix', 'wecom', 'wecom_kf'].includes(chId) && (() => {
                      const pluginSpec = chId === 'feishu' ? '@openclaw/feishu' :
                        chId === 'dingtalk' ? '@openclaw-china/dingtalk' :
                          chId === 'wecom' ? '@openclaw-china/wecom' :
                            chId === 'wecom_kf' ? '@openclaw-china/wecom-app' :
                              chId === 'qq' ? '@openclaw-china/qqbot' :
                                chId === 'msteams' ? '@openclaw/msteams' :
                                  chId === 'zalo' ? '@openclaw/zalo' :
                                    chId === 'matrix' ? '@openclaw/matrix' :
                                      chId === 'voicecall' ? '@openclaw/voice-call' : '';
                      const isInstalled = pluginInstalled[chId] === true;
                      
                      // Already installed - show green success
                      if (isInstalled) {
                        return (
                          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 dark:bg-green-500/5 border border-green-200 dark:border-green-500/20">
                            <span className="material-symbols-outlined text-[14px] text-green-500">check_circle</span>
                            <p className="text-[10px] font-bold text-green-700 dark:text-green-400">{cw.pluginInstalled}</p>
                          </div>
                        );
                      }
                      
                      // Not installed - show install UI
                      return (
                        <div className="flex flex-col gap-2 p-2.5 rounded-lg bg-violet-50 dark:bg-violet-500/5 border border-violet-200 dark:border-violet-500/20">
                          <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-[14px] text-violet-500 mt-0.5">extension</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-bold text-violet-700 dark:text-violet-400">{cw.pluginRequired}</p>
                              {canInstallPlugin === true ? (
                                <div className="mt-2 flex flex-col gap-2">
                                  <button
                                    onClick={() => handleInstallPlugin(pluginSpec, addingChannel)}
                                    disabled={pluginInstalling || pluginInstallResult?.phase === 'restarting'}
                                    className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white text-[11px] font-bold transition-all disabled:opacity-50"
                                  >
                                    <span className={`material-symbols-outlined text-[14px] ${pluginInstalling ? 'animate-spin' : ''}`}>
                                      {pluginInstalling ? 'progress_activity' : 'download'}
                                    </span>
                                    {pluginInstalling ? cw.installing : cw.installPlugin}
                                  </button>
                                  {pluginInstallResult && (
                                    <div className={`px-2 py-1.5 rounded text-[10px] flex items-center gap-1.5 ${pluginInstallResult.ok ? 'bg-green-100 dark:bg-green-500/10 text-green-600' : 'bg-red-100 dark:bg-red-500/10 text-red-500'}`}>
                                      {pluginInstallResult.ok ? (
                                        <>
                                          {pluginInstallResult.phase === 'restarting' && (
                                            <>
                                              <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                                              {cw.gatewayRestarting}
                                            </>
                                          )}
                                          {pluginInstallResult.phase === 'ready' && (
                                            <>
                                              <span className="material-symbols-outlined text-[12px]">check_circle</span>
                                              {cw.pluginReady}
                                            </>
                                          )}
                                          {!pluginInstallResult.phase && cw.pluginInstallSuccess}
                                        </>
                                      ) : pluginInstallResult.msg}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <code className="text-[11px] text-violet-600 dark:text-violet-300 bg-violet-100 dark:bg-violet-500/10 px-1.5 py-0.5 rounded mt-1 block break-all">
                                  openclaw plugins install {pluginSpec}
                                </code>
                              )}
                              {canInstallPlugin === false && (
                                <p className="text-[10px] text-violet-500 dark:text-violet-400 mt-1">{cw.remoteGatewayHint}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                    {prepSteps.length > 0 ? prepSteps.map((s: string, i: number) => (
                      <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.04]">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                        <p className="text-[11px] text-slate-700 dark:text-white/70 leading-relaxed">{s}</p>
                      </div>
                    )) : (
                      <p className="text-[11px] text-slate-400 dark:text-white/40 py-2">{cw.noPrepNeeded || es.noChannels}</p>
                    )}
                    {/* Feishu permission JSON copy button */}
                    {chId === 'feishu' && cw.feishuPermJson && (
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.04]">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] font-bold text-slate-600 dark:text-white/50">{cw.copyPermJson}</span>
                          <button onClick={() => {
                            copyToClipboard(cw.feishuPermJson).then(() => {
                              toast('success', cw.copied || 'Copied!');
                            }).catch(() => {});
                          }}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold text-primary hover:bg-primary/10 transition-colors">
                            <span className="material-symbols-outlined text-[12px]">content_copy</span>
                            {cw.copyPermJson}
                          </button>
                        </div>
                        <pre className="text-[11px] text-slate-500 dark:text-white/40 bg-slate-100 dark:bg-black/20 p-2 rounded overflow-x-auto max-h-20 overflow-y-auto custom-scrollbar font-mono leading-relaxed select-text">{cw.feishuPermJson}</pre>
                      </div>
                    )}
                    {pitfall && (
                      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20">
                        <span className="material-symbols-outlined text-[14px] text-amber-500 mt-0.5">warning</span>
                        <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-relaxed">{pitfall}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                    <button onClick={() => setWizardStep(2)}
                      className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1">
                      {cw.next || es.done} <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Step 2: 填写凭证 ── */}
            <div className={`border rounded-xl overflow-hidden transition-colors ${stepActive(2) ? 'border-primary/40 bg-white dark:bg-white/[0.02]' : stepDone(2) ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5' : 'border-slate-200 dark:border-white/[0.06] opacity-50'}`}>
              <div className={`flex items-center gap-2.5 px-4 py-3 ${stepDone(2) ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]' : ''}`} onClick={() => stepDone(2) && setWizardStep(2)}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${stepDone(2) ? 'bg-green-500 text-white' : stepActive(2) ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-400'}`}>
                  {stepDone(2) ? <span className="material-symbols-outlined text-[14px]">check</span> : 3}
                </div>
                <span className={`material-symbols-outlined text-[16px] ${stepDone(2) ? 'text-green-500' : stepActive(2) ? 'text-primary' : 'text-slate-400'}`}>key</span>
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-bold ${stepActive(2) ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-white/60'}`}>{WIZARD_STEPS[2].label}</span>
                  {stepDone(2) && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">✓</p>}
                </div>
                <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${stepActive(2) ? 'rotate-180' : ''}`}>expand_more</span>
              </div>
              {stepActive(2) && chId && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/[0.04]">
                  <div className="pt-3 space-y-2">
                    {renderChannelFields(chId, cfg)}
                  </div>
                  {/* WhatsApp QR Login */}
                  {chId === 'whatsapp' && (
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-primary text-[18px]">qr_code_2</span>
                          <span className="text-[11px] font-bold text-slate-700 dark:text-white/80">{cw.whatsappLogin}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-white/50">{cw.whatsappLoginDesc}</p>
                        <button onClick={handleWebLogin} disabled={webLoginBusy}
                          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[11px] font-bold bg-green-500 hover:bg-green-600 text-white transition-all disabled:opacity-50">
                          <span className={`material-symbols-outlined text-[16px] ${webLoginBusy ? 'animate-spin' : ''}`}>
                            {webLoginBusy ? 'progress_activity' : 'qr_code_2'}
                          </span>
                          {webLoginBusy ? cw.generating : cw.generateQR}
                        </button>
                        {webLoginResult && (
                          <div className={`px-3 py-2.5 rounded-lg text-[10px] ${webLoginResult.ok ? 'bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-500/20' : 'bg-red-50 dark:bg-red-500/10 text-red-500 border border-red-200 dark:border-red-500/20'}`}>
                            <p className="font-bold">{webLoginResult.text}</p>
                            {webLoginResult.qr && (
                              <pre className="mt-2 p-2 bg-white dark:bg-black/20 rounded text-[9px] font-mono whitespace-pre overflow-x-auto">{webLoginResult.qr}</pre>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Test connection */}
                  {chId !== 'whatsapp' && (
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => handleWizardTest(chId)} disabled={wizTestStatus === 'testing'}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5 transition-all disabled:opacity-50">
                          <span className={`material-symbols-outlined text-[14px] ${wizTestStatus === 'testing' ? 'animate-spin' : ''} ${wizTestStatus === 'ok' ? 'text-green-500' : wizTestStatus === 'fail' ? 'text-red-500' : 'text-primary'}`}>
                            {wizTestStatus === 'testing' ? 'progress_activity' : wizTestStatus === 'ok' ? 'check_circle' : wizTestStatus === 'fail' ? 'error' : 'wifi_tethering'}
                          </span>
                          <span className={wizTestStatus === 'ok' ? 'text-green-600 dark:text-green-400' : wizTestStatus === 'fail' ? 'text-red-500' : 'text-slate-700 dark:text-white/80'}>
                            {wizTestStatus === 'testing' ? cw.testing : wizTestStatus === 'ok' ? cw.testOk : wizTestStatus === 'fail' ? cw.testFail : cw.testConn}
                          </span>
                        </button>
                        {wizTestStatus === 'fail' && wizTestMsg && (
                          <span className="text-[10px] text-red-500">{wizTestMsg}</span>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                    <button onClick={() => setWizardStep(1)}
                      className="px-4 py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-white/70 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">arrow_back</span> {cw.back}
                    </button>
                    <button onClick={() => setWizardStep(3)}
                      className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1">
                      {cw.next || es.done} <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Step 3: 访问控制 ── */}
            <div className={`border rounded-xl overflow-hidden transition-colors ${stepActive(3) ? 'border-primary/40 bg-white dark:bg-white/[0.02]' : stepDone(3) ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5' : 'border-slate-200 dark:border-white/[0.06] opacity-50'}`}>
              <div className={`flex items-center gap-2.5 px-4 py-3 ${stepDone(3) ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]' : ''}`} onClick={() => stepDone(3) && setWizardStep(3)}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${stepDone(3) ? 'bg-green-500 text-white' : stepActive(3) ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-400'}`}>
                  {stepDone(3) ? <span className="material-symbols-outlined text-[14px]">check</span> : 4}
                </div>
                <span className={`material-symbols-outlined text-[16px] ${stepDone(3) ? 'text-green-500' : stepActive(3) ? 'text-primary' : 'text-slate-400'}`}>shield</span>
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-bold ${stepActive(3) ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-white/60'}`}>{WIZARD_STEPS[3].label}</span>
                  {stepDone(3) && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">{dmPolicyText(getField(['channels', chId, 'dmPolicy']) || 'pairing')}</p>}
                </div>
                <span className={`material-symbols-outlined text-[16px] text-slate-400 transition-transform ${stepActive(3) ? 'rotate-180' : ''}`}>expand_more</span>
              </div>
              {stepActive(3) && chId && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/[0.04]">
                  <div className="pt-3 space-y-3">
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 dark:text-white/60 mb-1 block">{cw.dmPolicy || es.dmPolicy}</label>
                      <p className="text-[11px] text-slate-400 dark:text-white/35 mb-2">{es.tipDmPolicy}</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {([
                          { value: 'pairing', icon: 'handshake', label: es.optPairing, desc: cw.pairingDesc || '' },
                          { value: 'allowlist', icon: 'checklist', label: es.optAllowlist, desc: cw.allowlistDesc || '' },
                          { value: 'open', icon: 'lock_open', label: es.optOpen, desc: cw.openDesc || '' },
                          { value: 'closed', icon: 'block', label: es.optClosed, desc: cw.disabledDesc || '' },
                        ] as const).map((opt) => (
                          <button key={opt.value} onClick={() => setField(['channels', chId, 'dmPolicy'], opt.value)}
                            className={`p-2.5 rounded-lg border-2 text-start transition-all ${(getField(['channels', chId, 'dmPolicy']) || 'pairing') === opt.value ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-slate-200 dark:border-white/10 hover:border-primary/40'}`}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className={`material-symbols-outlined text-[14px] ${(getField(['channels', chId, 'dmPolicy']) || 'pairing') === opt.value ? 'text-primary' : 'text-slate-400 dark:text-white/40'}`}>{opt.icon}</span>
                              <span className="text-[11px] font-bold text-slate-700 dark:text-white/80">{opt.label}</span>
                            </div>
                            {opt.desc && <div className="text-[11px] text-slate-400 dark:text-white/35 leading-relaxed">{opt.desc}</div>}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 dark:text-white/60 mb-1.5 block">{es.allowFrom}</label>
                      <ArrayField label="" value={getField(['channels', chId, 'allowFrom']) || []} onChange={v => setField(['channels', chId, 'allowFrom'], v)} placeholder={es.tipAllowFromPh} />
                    </div>
                  </div>
                  <div className="flex justify-between mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                    <button onClick={() => setWizardStep(2)}
                      className="px-4 py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-white/70 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">arrow_back</span> {cw.back}
                    </button>
                    <button onClick={() => setWizardStep(4)}
                      className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1">
                      {cw.next || es.done} <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Step 4: 确认完成 ── */}
            <div className={`border rounded-xl overflow-hidden transition-colors ${stepActive(4) ? 'border-primary/40 bg-white dark:bg-white/[0.02]' : stepDone(4) ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5' : 'border-slate-200 dark:border-white/[0.06] opacity-50'}`}>
              <div className={`flex items-center gap-2.5 px-4 py-3`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${stepActive(4) ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-400'}`}>
                  5
                </div>
                <span className={`material-symbols-outlined text-[16px] ${stepActive(4) ? 'text-primary' : 'text-slate-400'}`}>check_circle</span>
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-bold ${stepActive(4) ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-white/60'}`}>{WIZARD_STEPS[4].label}</span>
                </div>
              </div>
              {stepActive(4) && chId && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-white/[0.04]">
                  <div className="pt-3 space-y-3">
                    {!showPairing ? (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                            <div className="text-[11px] text-slate-400 dark:text-white/40">{es.selectChannel}</div>
                            <div className="text-[11px] font-bold text-slate-800 dark:text-white/90 mt-0.5">{chInfo ? (es as any)[chInfo.labelKey] : chId}</div>
                          </div>
                          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                            <div className="text-[11px] text-slate-400 dark:text-white/40">{es.dmPolicy}</div>
                            <div className="text-[11px] font-bold text-slate-800 dark:text-white/90 mt-0.5">{dmPolicyText(getField(['channels', chId, 'dmPolicy']) || 'pairing')}</div>
                          </div>
                          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                            <div className="text-[11px] text-slate-400 dark:text-white/40">{es.enabled}</div>
                            <div className="text-[11px] font-bold text-slate-800 dark:text-white/90 mt-0.5">{cfg.enabled !== false ? '✅' : '❌'}</div>
                          </div>
                        </div>
                        {restarting && (
                          <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/20">
                            <span className="material-symbols-outlined text-primary animate-spin">progress_activity</span>
                            <span className="text-sm text-primary font-medium">{cw.restartingGateway}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-primary">
                          <span className="material-symbols-outlined text-xl">link</span>
                          <span className="text-sm font-bold">{cw.pairingGuideTitle}</span>
                        </div>
                        <div className="text-xs text-slate-600 dark:text-white/60 space-y-1">
                          <p>1. {cw.pairingStep1}</p>
                          <p>2. {cw.pairingStep2}</p>
                          <p>3. {cw.pairingStep3}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={pairingCode}
                            onChange={e => setPairingCode(e.target.value)}
                            placeholder={cw.pairingCodePlaceholder}
                            className="flex-1 h-9 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none"
                          />
                          <button
                            onClick={() => handleApprovePairing(chId)}
                            disabled={!pairingCode.trim() || pairingStatus === 'approving'}
                            className="h-9 px-4 bg-primary text-white text-xs font-bold rounded-lg disabled:opacity-50 flex items-center gap-1"
                          >
                            {pairingStatus === 'approving' && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
                            {pairingStatus === 'success' && <span className="material-symbols-outlined text-sm">check</span>}
                            {cw.pairingApprove}
                          </button>
                        </div>
                        {pairingStatus === 'success' && (
                          <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">check_circle</span>
                            {cw.pairingSuccess}
                          </div>
                        )}
                        {pairingStatus === 'error' && pairingError && (
                          <div className="text-xs text-red-500 flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">error</span>
                            {pairingError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                    <button onClick={() => { deleteField(['channels', chId]); resetWizard(); }}
                      className="px-4 py-1.5 text-[11px] font-bold text-red-500 hover:text-red-600">
                      {es.deleteCancel}
                    </button>
                    {!showPairing ? (
                      <button onClick={() => handleFinishWizard(chId)} disabled={restarting}
                        className="px-5 py-1.5 bg-green-500 hover:bg-green-600 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50">
                        {restarting ? <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[14px]">check</span>}
                        {cw.finish || es.done}
                      </button>
                    ) : (
                      <button onClick={resetWizard}
                        className="px-5 py-1.5 bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white/70 text-[11px] font-bold rounded-lg transition-colors">
                        {cw.skipPairing}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-red-500 text-xl">warning</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-white">{es.deleteConfirmTitle}</h3>
                <p className="text-xs text-slate-500 dark:text-white/50">{es.deleteConfirmDesc}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                {es.cancel}
              </button>
              <button onClick={() => { deleteField(['channels', deleteConfirm]); setDeleteConfirm(null); }}
                className="px-4 py-2 text-xs font-medium bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors">
                {es.delete}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* ACP 持久绑定管理 */}
      {/* ================================================================ */}
      <AcpBindingsSection getField={getField} setField={setField} es={es} />
    </div>
  );
};

// ============================================================================
// ACP Persistent Bindings Sub-Section
// ============================================================================
const ACP_MODE_OPTIONS = (es: any) => [
  { value: 'persistent', label: es.optPersistent || 'Persistent' },
  { value: 'oneshot', label: es.optOneshot || 'Oneshot' },
];
const ACP_CHANNEL_OPTIONS = [
  { value: 'discord', label: 'Discord' },
  { value: 'telegram', label: 'Telegram' },
];

interface AcpBindingsSectionProps {
  getField: (path: string[]) => any;
  setField: (path: string[], value: any) => void;
  es: any;
}

const AcpBindingsSection: React.FC<AcpBindingsSectionProps> = ({ getField, setField, es }) => {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const allBindings: any[] = getField(['bindings']) || [];
  const acpBindings = allBindings
    .map((b: any, i: number) => ({ ...b, _idx: i }))
    .filter((b: any) => b.type === 'acp');

  const updateBinding = (idx: number, patch: Record<string, any>) => {
    const updated = [...allBindings];
    updated[idx] = { ...updated[idx], ...patch };
    setField(['bindings'], updated);
  };
  const updateBindingMatch = (idx: number, patch: Record<string, any>) => {
    const updated = [...allBindings];
    updated[idx] = { ...updated[idx], match: { ...updated[idx].match, ...patch } };
    setField(['bindings'], updated);
  };
  const updateBindingAcp = (idx: number, patch: Record<string, any>) => {
    const updated = [...allBindings];
    updated[idx] = { ...updated[idx], acp: { ...updated[idx].acp, ...patch } };
    setField(['bindings'], updated);
  };
  const deleteBinding = (idx: number) => {
    const updated = allBindings.filter((_: any, i: number) => i !== idx);
    setField(['bindings'], updated);
    setEditingIdx(null);
  };
  const addBinding = () => {
    const newBinding = {
      type: 'acp' as const,
      agentId: 'main',
      match: { channel: 'discord', peer: { kind: 'dm' as const, id: '' } },
      acp: { mode: 'persistent' },
    };
    setField(['bindings'], [...allBindings, newBinding]);
    setEditingIdx(allBindings.length);
    setAdding(false);
  };

  return (
    <ConfigSection title={es.acpBindings || 'ACP Persistent Bindings'} icon="link" iconColor="text-violet-500" defaultOpen={false}>
      {acpBindings.length === 0 && !adding && (
        <p className="text-[11px] text-slate-400 dark:text-white/30 italic py-1">{es.acpBindingsEmpty || 'No ACP bindings configured.'}</p>
      )}
      {acpBindings.map((b: any) => {
        const idx = b._idx;
        const isEditing = editingIdx === idx;
        const label = b.acp?.label || `${b.match?.channel || '?'}:${b.match?.peer?.id || '?'}`;
        return (
          <div key={idx} className="rounded-lg border border-slate-200 dark:border-white/[0.06] mb-2 overflow-hidden">
            <div
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/[0.03] transition-colors"
              onClick={() => setEditingIdx(isEditing ? null : idx)}
            >
              <span className="material-symbols-outlined text-[14px] text-slate-400 dark:text-white/30 transition-transform" style={{ transform: isEditing ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                chevron_right
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
              <span className="text-[12px] font-bold text-slate-700 dark:text-white/80 flex-1 truncate">{label}</span>
              <span className="text-[10px] text-slate-400 dark:text-white/30 font-mono">{b.agentId || 'main'}</span>
              <button
                onClick={e => { e.stopPropagation(); deleteBinding(idx); }}
                className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors"
                title={es.delete || 'Delete'}
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
            {isEditing && (
              <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-200/60 dark:border-white/[0.04]">
                <TextField label={es.agentId || 'Agent ID'} value={b.agentId || ''} onChange={v => updateBinding(idx, { agentId: v })} placeholder="main" />
                <SelectField label={es.acpChannel || 'Channel'} value={b.match?.channel || 'discord'} onChange={v => updateBindingMatch(idx, { channel: v })} options={ACP_CHANNEL_OPTIONS} />
                <TextField label={es.acpAccountId || 'Account ID'} value={b.match?.accountId || ''} onChange={v => updateBindingMatch(idx, { accountId: v })} placeholder="default" />
                <TextField label={es.acpPeerId || 'Peer ID'} value={b.match?.peer?.id || ''} onChange={v => updateBindingMatch(idx, { peer: { ...b.match?.peer, id: v } })} placeholder={es.acpPeerIdPh || 'Channel/Topic ID'} />
                <SelectField label={es.acpMode || 'Mode'} value={b.acp?.mode || 'persistent'} onChange={v => updateBindingAcp(idx, { mode: v })} options={ACP_MODE_OPTIONS(es)} />
                <TextField label={es.acpLabel || 'Label'} value={b.acp?.label || ''} onChange={v => updateBindingAcp(idx, { label: v })} placeholder={es.acpLabelPh || 'Optional label'} />
                <TextField label={es.acpCwd || 'Working Directory'} value={b.acp?.cwd || ''} onChange={v => updateBindingAcp(idx, { cwd: v })} placeholder="/path/to/project" />
                <TextField label={es.acpBackend || 'Backend'} value={b.acp?.backend || ''} onChange={v => updateBindingAcp(idx, { backend: v })} placeholder="acpx" />
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={addBinding}
        className="w-full py-2 border border-dashed border-violet-300 dark:border-violet-500/30 hover:border-violet-500 dark:hover:border-violet-400/60 rounded-lg text-[11px] font-bold text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-500/5 transition-all flex items-center justify-center gap-1.5"
      >
        <span className="material-symbols-outlined text-[14px]">add</span>
        {es.acpAddBinding || 'Add ACP Binding'}
      </button>
    </ConfigSection>
  );
};

// ============================================================================
// Feishu Multi-Account Sub-Section
// ============================================================================
interface FeishuAccountsSectionProps {
  g: (path: string[]) => any;
  s: (path: string[], value: any) => void;
  deleteField: (path: string[]) => void;
  es: any;
  ch: string;
}

const FeishuAccountsSection: React.FC<FeishuAccountsSectionProps> = ({ g, s, deleteField, es, ch }) => {
  const [expanded, setExpanded] = useState(false);
  const [editingAccount, setEditingAccount] = useState<string | null>(null);
  const [newAccountKey, setNewAccountKey] = useState('');
  const [addError, setAddError] = useState('');

  const accounts: Record<string, any> = g(['accounts']) || {};
  const accountKeys = Object.keys(accounts);
  const defaultAccount = g(['defaultAccount']) || '';

  const handleAddAccount = () => {
    const key = newAccountKey.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!key) { setAddError(es.feishuAccErrEmpty || 'Account key cannot be empty'); return; }
    if (accounts[key]) { setAddError(es.feishuAccErrDup || 'Account key already exists'); return; }
    s(['accounts', key], { enabled: true, name: key, appId: '', appSecret: '' });
    setNewAccountKey('');
    setAddError('');
    setEditingAccount(key);
  };

  const handleDeleteAccount = (key: string) => {
    deleteField(['accounts', key]);
    if (editingAccount === key) setEditingAccount(null);
    if (defaultAccount === key) deleteField(['defaultAccount']);
  };

  const ag = (key: string, path: string[]) => {
    const acc = accounts[key];
    if (!acc) return undefined;
    let v: any = acc;
    for (const p of path) { v = v?.[p]; }
    return v;
  };

  const as_ = (key: string, path: string[], value: any) => {
    s(['accounts', key, ...path], value);
  };

  return (
    <>
      <div className="pt-3 pb-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/60 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px] transition-transform" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            chevron_right
          </span>
          {es.feishuAccountsTitle || 'Multi-Account'}
          {accountKeys.length > 0 && (
            <span className="ms-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">{accountKeys.length}</span>
          )}
        </button>
      </div>
      {expanded && (
        <div className="space-y-2 ps-1">
          {accountKeys.length > 0 && (
            <div className="flex items-center gap-2 py-1">
              <span className="text-[11px] text-slate-500 dark:text-white/40 whitespace-nowrap">{es.feishuDefaultAccount || 'Default Account'}</span>
              <CustomSelect
                value={defaultAccount}
                onChange={v => s(['defaultAccount'], v)}
                options={[{ value: '', label: '-' }, ...accountKeys.map(k => ({ value: k, label: accounts[k]?.name || k }))]}
                className="text-[12px] px-2 py-1 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 w-40"
              />
            </div>
          )}
          {/* Account list */}
          {accountKeys.map(key => {
            const acc = accounts[key] || {};
            const isEditing = editingAccount === key;
            return (
              <div key={key} className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.02] overflow-hidden">
                {/* Account header */}
                <div
                  className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/[0.03] transition-colors"
                  onClick={() => setEditingAccount(isEditing ? null : key)}
                >
                  <span className="material-symbols-outlined text-[14px] text-slate-400 dark:text-white/30 transition-transform" style={{ transform: isEditing ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                    chevron_right
                  </span>
                  <span className={`w-1.5 h-1.5 rounded-full ${acc.enabled !== false ? 'bg-green-400' : 'bg-slate-300 dark:bg-white/20'}`} />
                  <span className="text-[12px] font-bold text-slate-700 dark:text-white/80 flex-1 truncate">{acc.name || key}</span>
                  <span className="text-[10px] text-slate-400 dark:text-white/30 font-mono">{key}</span>
                  {defaultAccount === key && (
                    <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-bold">{es.feishuAccDefault || 'DEFAULT'}</span>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteAccount(key); }}
                    className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors"
                    title={es.delete || 'Delete'}
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </div>
                {/* Account detail fields */}
                {isEditing && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-200/60 dark:border-white/[0.04]">
                    <SwitchField label={es.chEnabled || 'Enabled'} value={acc.enabled !== false} onChange={v => as_(key, ['enabled'], v)} />
                    <TextField label={es.feishuAccName || 'Display Name'} value={acc.name || ''} onChange={v => as_(key, ['name'], v)} tooltip={es.tipFeishuAccName} />
                    <TextField label={es.appId || 'App ID'} value={acc.appId || ''} onChange={v => as_(key, ['appId'], v)} tooltip={es.tipFeishuAppId} />
                    <PasswordField label={es.appSecret || 'App Secret'} value={acc.appSecret || ''} onChange={v => as_(key, ['appSecret'], v)} tooltip={es.tipFeishuSecret} />
                    <SelectField label={es.chDomain || 'Domain'} value={acc.domain || ''} onChange={v => as_(key, ['domain'], v)} options={[
                      { value: 'feishu', label: es.optFeishu || 'Feishu' },
                      { value: 'lark', label: es.optLark || 'Lark' },
                    ]} allowEmpty tooltip={es.tipFeishuDomain} />
                    <SelectField label={es.connModeLabel || 'Connection Mode'} value={acc.connectionMode || ''} onChange={v => as_(key, ['connectionMode'], v)} options={[
                      { value: 'websocket', label: es.optWebSocket || 'WebSocket' },
                      { value: 'webhook', label: es.optWebhook || 'Webhook' },
                    ]} allowEmpty tooltip={es.tipFeishuConn} />
                    {(acc.connectionMode === 'webhook') && (
                      <TextField label={es.feishuWebhookPath || 'Webhook Path'} value={acc.webhookPath || ''} onChange={v => as_(key, ['webhookPath'], v)} tooltip={es.tipFeishuWebhookPath} />
                    )}
                    <PasswordField label={es.encryptKey || 'Encrypt Key'} value={acc.encryptKey || ''} onChange={v => as_(key, ['encryptKey'], v)} tooltip={es.tipFeishuEncrypt} />
                    <PasswordField label={es.verificationToken || 'Verification Token'} value={acc.verificationToken || ''} onChange={v => as_(key, ['verificationToken'], v)} tooltip={es.tipFeishuVerify} />
                    <p className="text-[10px] text-slate-400 dark:text-white/30 italic pt-1">
                      {es.feishuAccInheritHint || 'Other settings (policies, tools, streaming, etc.) inherit from the top-level config unless overridden.'}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
          {/* Add new account */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="text"
              value={newAccountKey}
              onChange={e => { setNewAccountKey(e.target.value); setAddError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleAddAccount(); }}
              placeholder={es.feishuAccKeyPh || 'account-key'}
              className="text-[12px] px-2.5 py-1.5 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/80 placeholder-slate-400 dark:placeholder-white/30 w-40 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button
              onClick={handleAddAccount}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-primary hover:bg-primary/10 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              {es.feishuAccAdd || 'Add Account'}
            </button>
          </div>
          {addError && (
            <p className="text-[10px] text-red-500 ps-1">{addError}</p>
          )}
        </div>
      )}
    </>
  );
};
