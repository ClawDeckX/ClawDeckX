import React, { useState, useCallback, useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, PasswordField, SelectField, SwitchField, ArrayField, NumberField, EmptyState, DiscordGuildField } from '../fields';
import { getTranslation } from '../../../locales';
import { gwApi, gatewayApi, pairingApi, pluginApi } from '../../../services/api';
import { post } from '../../../services/request';

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
  { value: 'closed', label: es.optClosed },
  { value: 'allowlist', label: es.optAllowlist },
];
const groupPolicy = (es: any) => [
  { value: 'allowlist', label: es.optAllowlist },
  { value: 'open', label: es.optOpen },
  { value: 'disabled', label: es.optDisabled },
];
const streamMode = (es: any) => [
  { value: 'partial', label: es.optPartial },
  { value: 'full', label: es.optFull },
  { value: 'off', label: es.optOff },
];
const replyMode = (es: any) => [
  { value: 'smart', label: es.optSmart },
  { value: 'always', label: es.optAlways },
  { value: 'never', label: es.optNever },
];

// ============================================================================
// tooltip 文本
// ============================================================================
const TIP_KEYS: Record<string, string> = {
  dmPolicy: 'tipDmPolicy', groupPolicy: 'tipGroupPolicy', streamMode: 'tipStreamMode',
  allowFrom: 'tipAllowFrom', botToken: 'tipBotToken', webhookUrl: 'tipWebhookUrl',
  replyMode: 'tipReplyMode', feishuDomain: 'tipFeishuDomain', feishuConn: 'tipFeishuConn',
  matrixHome: 'tipMatrixHome', voiceProvider: 'tipVoiceProvider',
};

// ============================================================================
// 组件
// ============================================================================
export const ChannelsSection: React.FC<SectionProps> = ({ config, setField, getField, deleteField, language, save }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
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
  const [sendMsg, setSendMsg] = useState('Hello from OpenClaw!');
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
      setWizTestMsg(err?.message || 'Test failed');
    }
    setTimeout(() => { setWizTestStatus('idle'); setWizTestMsg(''); }, 5000);
  }, [channels]);

  // WhatsApp web login
  const [webLoginBusy, setWebLoginBusy] = useState(false);
  const [webLoginResult, setWebLoginResult] = useState<{ ok: boolean; text: string; qr?: string } | null>(null);

  const handleWebLogin = useCallback(async () => {
    setWebLoginBusy(true);
    setWebLoginResult(null);
    try {
      const res = await gwApi.webLoginStart({}) as any;
      if (res?.qr) {
        setWebLoginResult({ ok: true, text: 'QR ready', qr: res.qr });
        // Wait for scan
        try {
          await gwApi.webLoginWait({ timeoutMs: 60000 });
          setWebLoginResult({ ok: true, text: 'Login success' });
        } catch { setWebLoginResult({ ok: false, text: 'Login timeout or failed' }); }
      } else {
        setWebLoginResult({ ok: true, text: res?.status || 'Started' });
      }
    } catch (err: any) {
      setWebLoginResult({ ok: false, text: 'Login failed: ' + (err?.message || '') });
    }
    setWebLoginBusy(false);
  }, []);

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
      feishu: '@m1heng-clawd/feishu',
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
        setPluginInstallResult({ ok: false, msg: res.output || 'Install failed' });
        setPluginInstalling(false);
      }
    } catch (err: any) {
      setPluginInstallResult({ ok: false, msg: err?.message || 'Install failed' });
      setPluginInstalling(false);
    }
  }, []);

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
      setSendResult({ ch, ok: false, text: (es.chSendFailed || 'Send failed') + ': ' + (err?.message || '') });
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
      setLogoutMsg({ ch, ok: false, text: (es.chLogoutFailed || 'Logout failed') + ': ' + (err?.message || '') });
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
      setPairingError(err?.message || 'Approval failed');
    }
  }, [pairingCode, resetWizard]);

  const tip = (key: string) => (es as any)[TIP_KEYS[key]] || '';

  const renderChannelFields = (ch: string, cfg: any) => {
    const p = (f: string[]) => ['channels', ch, ...f];
    const g = (f: string[]) => getField(p(f));
    const s = (f: string[], v: any) => setField(p(f), v);

    return (
      <>
        <SwitchField label={es.enabled} value={cfg.enabled !== false} onChange={v => s(['enabled'], v)} tooltip={es.tipEnableChannel} />

        {/* Telegram */}
        {ch === 'telegram' && (
          <>
            <PasswordField label="Bot Token" value={g(['botToken']) || ''} onChange={v => s(['botToken'], v)} placeholder="123456:ABC-DEF..." tooltip={tip('botToken')} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <SelectField label={es.streamMode} value={g(['streamMode']) || 'partial'} onChange={v => s(['streamMode'], v)} options={streamMode(es)} tooltip={tip('streamMode')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.tipAllowFromPh} tooltip={tip('allowFrom')} />
            <TextField label="Webhook URL" value={g(['webhookUrl']) || ''} onChange={v => s(['webhookUrl'], v)} placeholder="https://..." tooltip={tip('webhookUrl')} />
            <SelectField label={es.replyMode} value={g(['replyToMode']) || 'smart'} onChange={v => s(['replyToMode'], v)} options={replyMode(es)} tooltip={tip('replyMode')} />
            <SwitchField label={es.inlineButtons} value={g(['capabilities', 'inlineButtons']) !== false} onChange={v => s(['capabilities', 'inlineButtons'], v)} tooltip={es.tipInlineBtn} />
          </>
        )}

        {/* WhatsApp */}
        {ch === 'whatsapp' && (
          <>
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SwitchField label={es.selfChatMode} value={g(['selfChatMode']) === true} onChange={v => s(['selfChatMode'], v)} tooltip={es.tipSelfChat} />
            <NumberField label={es.chDebounceMs} value={g(['debounceMs'])} onChange={v => s(['debounceMs'], v)} placeholder="1500" tooltip={es.tipDebounce} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder="+8613800138000" tooltip={tip('allowFrom')} />
          </>
        )}

        {/* Discord */}
        {ch === 'discord' && (
          <>
            <PasswordField label="Token" value={g(['token']) || ''} onChange={v => s(['token'], v)} placeholder="Bot token..." tooltip={es.tipDiscordToken} />
            <SelectField label={es.dmPolicy} value={g(['dm', 'policy']) || 'pairing'} onChange={v => s(['dm', 'policy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <DiscordGuildField label={es.guildIds} value={g(['guilds']) || {}} onChange={v => s(['guilds'], v)} placeholder={es.guildIdPlaceholder || 'guild_id or channel URL'} tooltip={es.tipGuildIds} linkHint={es.guildIdLinkHint} />
            <SwitchField label="PluralKit" value={g(['pluralkit', 'enabled']) === true} onChange={v => s(['pluralkit', 'enabled'], v)} tooltip={es.tipPluralKit} />
            <NumberField label={es.maxLinesMsg} value={g(['maxLinesPerMessage'])} onChange={v => s(['maxLinesPerMessage'], v)} placeholder="40" tooltip={es.tipMaxLines} />
          </>
        )}

        {/* Slack */}
        {ch === 'slack' && (
          <>
            <PasswordField label="Bot Token" value={g(['botToken']) || ''} onChange={v => s(['botToken'], v)} placeholder="xoxb-..." tooltip={es.tipSlackBot} />
            <PasswordField label="App Token" value={g(['appToken']) || ''} onChange={v => s(['appToken'], v)} placeholder="xapp-..." tooltip={es.tipSlackApp} />
            <SelectField label={es.connMode} value={g(['mode']) || 'socket'} onChange={v => s(['mode'], v)} options={[{ value: 'socket', label: 'Socket Mode' }, { value: 'http', label: 'HTTP' }]} tooltip={es.tipSlackMode} />
            <SelectField label={es.dmPolicy} value={g(['dm', 'policy']) || 'pairing'} onChange={v => s(['dm', 'policy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <ArrayField label={es.chChannels} value={g(['channels']) || []} onChange={v => s(['channels'], v)} placeholder="channel_id" tooltip={es.tipSlackChannels} />
            <SwitchField label={es.threadMode} value={g(['thread']) === true} onChange={v => s(['thread'], v)} tooltip={es.tipSlackThread} />
            <SwitchField label={es.allowBots} value={g(['allowBots']) === true} onChange={v => s(['allowBots'], v)} tooltip={es.tipSlackBots} />
          </>
        )}

        {/* Signal */}
        {ch === 'signal' && (
          <>
            <TextField label={es.chAccount} value={g(['account']) || ''} onChange={v => s(['account'], v)} placeholder="+1234567890" tooltip={es.tipSignalAccount} />
            <TextField label="HTTP URL" value={g(['httpUrl']) || ''} onChange={v => s(['httpUrl'], v)} placeholder="http://localhost:8080" tooltip={es.tipSignalHttp} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <SelectField label={es.receiveMode} value={g(['receiveMode']) || 'http'} onChange={v => s(['receiveMode'], v)} options={[{ value: 'http', label: 'HTTP' }, { value: 'dbus', label: 'D-Bus' }, { value: 'json-rpc', label: 'JSON-RPC' }]} tooltip={es.tipSignalReceive} />
          </>
        )}

        {/* iMessage */}
        {ch === 'imessage' && (
          <>
            <TextField label={es.cliPath} value={g(['cliPath']) || ''} onChange={v => s(['cliPath'], v)} tooltip={es.tipImsgCli} />
            <TextField label={es.dbPath} value={g(['dbPath']) || ''} onChange={v => s(['dbPath'], v)} tooltip={es.tipImsgDb} />
            <SelectField label={es.chService} value={g(['service']) || 'iMessage'} onChange={v => s(['service'], v)} options={[{ value: 'iMessage', label: 'iMessage' }, { value: 'SMS', label: 'SMS' }]} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
          </>
        )}

        {/* BlueBubbles */}
        {ch === 'bluebubbles' && (
          <>
            <TextField label={es.serverUrl} value={g(['serverUrl']) || ''} onChange={v => s(['serverUrl'], v)} placeholder="http://localhost:1234" tooltip={es.tipBBServer} />
            <PasswordField label={es.chPassword} value={g(['password']) || ''} onChange={v => s(['password'], v)} tooltip={es.tipBBPassword} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
          </>
        )}

        {/* Google Chat */}
        {ch === 'googlechat' && (
          <>
            <TextField label={es.chAccount} value={g(['serviceAccount']) || ''} onChange={v => s(['serviceAccount'], v)} tooltip={es.tipGCServiceAccount} />
            <TextField label="Webhook Path" value={g(['webhookPath']) || ''} onChange={v => s(['webhookPath'], v)} tooltip={es.tipGCWebhook} />
          </>
        )}

        {/* MS Teams */}
        {ch === 'msteams' && (
          <>
            <TextField label="App ID" value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipTeamsAppId} />
            <PasswordField label="App Password" value={g(['appPassword']) || ''} onChange={v => s(['appPassword'], v)} tooltip={es.tipTeamsAppPwd} />
            <TextField label="Tenant ID" value={g(['tenantId']) || ''} onChange={v => s(['tenantId'], v)} tooltip={es.tipTeamsTenant} />
          </>
        )}

        {/* Mattermost */}
        {ch === 'mattermost' && (
          <>
            <PasswordField label="Bot Token" value={g(['botToken']) || ''} onChange={v => s(['botToken'], v)} tooltip={es.tipMMToken} />
            <TextField label="Base URL" value={g(['baseUrl']) || ''} onChange={v => s(['baseUrl'], v)} placeholder="https://chat.example.com" tooltip={es.tipMMUrl} />
            <SelectField label={es.chatMode} value={g(['chatmode']) || 'oncall'} onChange={v => s(['chatmode'], v)} options={[
              { value: 'oncall', label: es.optOnMention },
              { value: 'onchar', label: es.optOnChar },
              { value: 'onmessage', label: es.optOnMessage },
            ]} tooltip={es.tipMMChatMode} />
            <SwitchField label={es.requireMention} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipMMMention} />
          </>
        )}

        {/* Matrix */}
        {ch === 'matrix' && (
          <>
            <TextField label="Homeserver" value={g(['homeserver']) || ''} onChange={v => s(['homeserver'], v)} placeholder="https://matrix.org" tooltip={tip('matrixHome')} />
            <TextField label={es.userId} value={g(['userId']) || ''} onChange={v => s(['userId'], v)} placeholder="@bot:matrix.org" tooltip={es.tipMatrixUser} />
            <PasswordField label="Access Token" value={g(['accessToken']) || ''} onChange={v => s(['accessToken'], v)} tooltip={es.tipMatrixToken} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
          </>
        )}

        {/* 飞书 */}
        {ch === 'feishu' && (
          <>
            <TextField label="App ID" value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipFeishuAppId} />
            <PasswordField label="App Secret" value={g(['appSecret']) || ''} onChange={v => s(['appSecret'], v)} tooltip={es.tipFeishuSecret} />
            <SelectField label={es.chDomain} value={g(['domain']) || 'feishu'} onChange={v => s(['domain'], v)} options={[
              { value: 'feishu', label: es.optFeishu },
              { value: 'lark', label: es.optLark },
            ]} tooltip={tip('feishuDomain')} />
            <SelectField label={es.connModeLabel} value={g(['connectionMode']) || 'websocket'} onChange={v => s(['connectionMode'], v)} options={[
              { value: 'websocket', label: 'WebSocket' },
              { value: 'webhook', label: 'Webhook' },
            ]} tooltip={tip('feishuConn')} />
            <PasswordField label={es.encryptKey} value={g(['encryptKey']) || ''} onChange={v => s(['encryptKey'], v)} tooltip={es.tipFeishuEncrypt} />
            <PasswordField label={es.verificationToken} value={g(['verificationToken']) || ''} onChange={v => s(['verificationToken'], v)} tooltip={es.tipFeishuVerify} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
          </>
        )}

        {/* 企业微信（智能机器人） */}
        {ch === 'wecom' && (
          <>
            <TextField label={es.chWebhookPath} value={g(['webhookPath']) || '/wecom'} onChange={v => s(['webhookPath'], v)} tooltip={es.tipWecomWebhookPath} />
            <PasswordField label="Token" value={g(['token']) || ''} onChange={v => s(['token'], v)} tooltip={es.tipWecomToken} />
            <PasswordField label="EncodingAESKey" value={g(['encodingAESKey']) || ''} onChange={v => s(['encodingAESKey'], v)} tooltip={es.tipWecomAes} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'open'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'open'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <SwitchField label={es.requireMention} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipWecomMention} />
          </>
        )}

        {/* 企微自建应用 (wecom-app) */}
        {ch === 'wecom_kf' && (
          <>
            <TextField label={es.chWebhookPath} value={g(['webhookPath']) || '/wecom-app'} onChange={v => s(['webhookPath'], v)} tooltip={es.tipWecomAppWebhookPath} />
            <PasswordField label="Token" value={g(['token']) || ''} onChange={v => s(['token'], v)} tooltip={es.tipWecomToken} />
            <PasswordField label="EncodingAESKey" value={g(['encodingAESKey']) || ''} onChange={v => s(['encodingAESKey'], v)} tooltip={es.tipWecomAes} />
            <TextField label="Corp ID" value={g(['corpId']) || ''} onChange={v => s(['corpId'], v)} tooltip={es.tipWecomCorpId} />
            <PasswordField label="Corp Secret" value={g(['corpSecret']) || ''} onChange={v => s(['corpSecret'], v)} tooltip={es.tipWecomAppSecret} />
            <NumberField label="Agent ID" value={g(['agentId'])} onChange={v => s(['agentId'], v)} placeholder="1000002" tooltip={es.tipWecomAppAgentId} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'open'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
          </>
        )}

        {/* 微信 */}
        {ch === 'wechat' && (
          <>
            <TextField label="App ID" value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipWechatAppId} />
            <PasswordField label="App Secret" value={g(['appSecret']) || ''} onChange={v => s(['appSecret'], v)} tooltip={es.tipWechatSecret} />
            <PasswordField label="Token" value={g(['token']) || ''} onChange={v => s(['token'], v)} tooltip={es.tipWechatToken} />
            <PasswordField label="Encoding AES Key" value={g(['encodingAesKey']) || ''} onChange={v => s(['encodingAesKey'], v)} tooltip={es.tipWechatAes} />
          </>
        )}

        {/* QQ */}
        {ch === 'qq' && (
          <>
            <TextField label="App ID" value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipQQAppId} />
            <PasswordField label="Client Secret" value={g(['clientSecret']) || ''} onChange={v => s(['clientSecret'], v)} tooltip={es.tipQQClientSecret} />
            <SwitchField label={es.chMarkdownSupport} value={g(['markdownSupport']) === true} onChange={v => s(['markdownSupport'], v)} tooltip={es.tipQQMarkdown} />
          </>
        )}

        {/* 钉钉 */}
        {ch === 'dingtalk' && (
          <>
            <TextField label="Client ID" value={g(['clientId']) || ''} onChange={v => s(['clientId'], v)} tooltip={es.tipDTClientId} />
            <PasswordField label="Client Secret" value={g(['clientSecret']) || ''} onChange={v => s(['clientSecret'], v)} tooltip={es.tipDTClientSecret} />
            <SwitchField label={es.chEnableAICard} value={g(['enableAICard']) === true} onChange={v => s(['enableAICard'], v)} tooltip={es.tipDTAICard} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'open'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'open'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <SwitchField label={es.requireMention} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipDTMention} />
          </>
        )}

        {/* 豆包 */}
        {ch === 'doubao' && (
          <>
            <TextField label="App ID" value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipDoubaoAppId} />
            <PasswordField label="App Secret" value={g(['appSecret']) || ''} onChange={v => s(['appSecret'], v)} tooltip={es.tipDoubaoSecret} />
            <PasswordField label="Token" value={g(['token']) || ''} onChange={v => s(['token'], v)} tooltip={es.tipDoubaoToken} />
          </>
        )}

        {/* Zalo */}
        {ch === 'zalo' && (
          <>
            <PasswordField label={es.chToken} value={g(['botToken']) || ''} onChange={v => s(['botToken'], v)} tooltip={es.tipZaloToken} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder="user_id" tooltip={tip('allowFrom')} />
          </>
        )}

        {/* Voice Call */}
        {ch === 'voicecall' && (
          <>
            <SelectField label={es.voiceProvider} value={g(['provider']) || 'mock'} onChange={v => s(['provider'], v)} options={[
              { value: 'twilio', label: 'Twilio' },
              { value: 'telnyx', label: 'Telnyx' },
              { value: 'mock', label: es.mockDev },
            ]} tooltip={tip('voiceProvider')} />
            <TextField label={es.fromNumber} value={g(['fromNumber']) || ''} onChange={v => s(['fromNumber'], v)} placeholder="+15550001234" tooltip={es.tipVoiceFrom} />
            <TextField label={es.toNumber} value={g(['toNumber']) || ''} onChange={v => s(['toNumber'], v)} placeholder="+15550001234" tooltip={es.tipVoiceTo} />
            {g(['provider']) === 'twilio' && (
              <>
                <TextField label="Account SID" value={g(['twilio', 'accountSid']) || ''} onChange={v => s(['twilio', 'accountSid'], v)} />
                <PasswordField label="Auth Token" value={g(['twilio', 'authToken']) || ''} onChange={v => s(['twilio', 'authToken'], v)} />
              </>
            )}
            {g(['provider']) === 'telnyx' && (
              <>
                <PasswordField label="API Key" value={g(['telnyx', 'apiKey']) || ''} onChange={v => s(['telnyx', 'apiKey'], v)} />
                <TextField label="Connection ID" value={g(['telnyx', 'connectionId']) || ''} onChange={v => s(['telnyx', 'connectionId'], v)} />
              </>
            )}
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
                  <button onClick={() => { setSendChannel(sendChannel === ch ? null : ch); setSendResult(null); }} className="text-slate-400 hover:text-sky-500 transition-colors" title={es.chSendTest}>
                    <span className="material-symbols-outlined text-[14px]">send</span>
                  </button>
                  <button onClick={() => setLogoutChannel(logoutChannel === ch ? null : ch)} className="text-slate-400 hover:text-amber-500 transition-colors" title={es.chLogout}>
                    <span className="material-symbols-outlined text-[14px]">logout</span>
                  </button>
                  <button onClick={() => setDeleteConfirm(ch)} className="text-slate-400 hover:text-red-500 transition-colors">
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
        const cw = (getTranslation(language) as any).cw || {};
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
                                className="flex items-center gap-2.5 p-2.5 rounded-lg border-2 border-slate-200 dark:border-white/10 hover:border-primary/40 transition-all text-left group">
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
                  {stepDone(1) && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">{cw.prepDone || '✓'}</p>}
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
                        <span className="text-[11px] text-blue-400 dark:text-blue-500 truncate ml-auto">{(cw as any)[`${chId}HelpUrl`]}</span>
                      </a>
                    )}
                    {/* Plugin install hint for channels that need plugins */}
                    {chId && ['feishu', 'dingtalk', 'qq', 'msteams', 'zalo', 'voicecall', 'matrix', 'wecom', 'wecom_kf'].includes(chId) && (() => {
                      const pluginSpec = chId === 'feishu' ? '@m1heng-clawd/feishu' :
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
                            <p className="text-[10px] font-bold text-green-700 dark:text-green-400">{cw.pluginInstalled || 'Plugin installed'}</p>
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
                                    {pluginInstalling ? (cw.installing || 'Installing...') : (cw.installPlugin || 'Install Plugin')}
                                  </button>
                                  {pluginInstallResult && (
                                    <div className={`px-2 py-1.5 rounded text-[10px] flex items-center gap-1.5 ${pluginInstallResult.ok ? 'bg-green-100 dark:bg-green-500/10 text-green-600' : 'bg-red-100 dark:bg-red-500/10 text-red-500'}`}>
                                      {pluginInstallResult.ok ? (
                                        <>
                                          {pluginInstallResult.phase === 'restarting' && (
                                            <>
                                              <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                                              {cw.gatewayRestarting || 'Gateway restarting...'}
                                            </>
                                          )}
                                          {pluginInstallResult.phase === 'ready' && (
                                            <>
                                              <span className="material-symbols-outlined text-[12px]">check_circle</span>
                                              {cw.pluginReady || 'Plugin ready!'}
                                            </>
                                          )}
                                          {!pluginInstallResult.phase && (cw.pluginInstallSuccess || 'Plugin installed!')}
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
                                <p className="text-[10px] text-violet-500 dark:text-violet-400 mt-1">{cw.remoteGatewayHint || 'Remote gateway detected. Please install manually via CLI.'}</p>
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
                          <button onClick={() => { navigator.clipboard.writeText(cw.feishuPermJson); }}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold text-primary hover:bg-primary/10 transition-colors">
                            <span className="material-symbols-outlined text-[12px]">content_copy</span>
                            {cw.copyPermJson}
                          </button>
                        </div>
                        <pre className="text-[11px] text-slate-500 dark:text-white/40 bg-slate-100 dark:bg-black/20 p-2 rounded overflow-x-auto max-h-20 overflow-y-auto custom-scrollbar font-mono leading-relaxed">{cw.feishuPermJson}</pre>
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
                          <span className="text-[11px] font-bold text-slate-700 dark:text-white/80">{cw.whatsappLogin || 'WhatsApp Web 登录'}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-white/50">{cw.whatsappLoginDesc || '点击下方按钮生成二维码，然后用手机 WhatsApp 扫码登录'}</p>
                        <button onClick={handleWebLogin} disabled={webLoginBusy}
                          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[11px] font-bold bg-green-500 hover:bg-green-600 text-white transition-all disabled:opacity-50">
                          <span className={`material-symbols-outlined text-[16px] ${webLoginBusy ? 'animate-spin' : ''}`}>
                            {webLoginBusy ? 'progress_activity' : 'qr_code_2'}
                          </span>
                          {webLoginBusy ? (cw.generating || '生成中...') : (cw.generateQR || '生成二维码')}
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
                            {wizTestStatus === 'testing' ? (cw.testing || es.chSending) : wizTestStatus === 'ok' ? (cw.testOk || 'OK') : wizTestStatus === 'fail' ? (cw.testFail || 'Fail') : (cw.testConn || es.chSendTest)}
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
                  {stepDone(3) && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">{getField(['channels', chId, 'dmPolicy']) || 'pairing'}</p>}
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
                            className={`p-2.5 rounded-lg border-2 text-left transition-all ${(getField(['channels', chId, 'dmPolicy']) || 'pairing') === opt.value ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-slate-200 dark:border-white/10 hover:border-primary/40'}`}>
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
                      <ArrayField label="" value={getField(['channels', chId, 'allowFrom']) || []} onChange={v => setField(['channels', chId, 'allowFrom'], v)} placeholder={es.tipAllowFromPh || 'user_id'} />
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
                            <div className="text-[11px] font-bold text-slate-800 dark:text-white/90 mt-0.5">{getField(['channels', chId, 'dmPolicy']) || 'pairing'}</div>
                          </div>
                          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                            <div className="text-[11px] text-slate-400 dark:text-white/40">{es.enabled}</div>
                            <div className="text-[11px] font-bold text-slate-800 dark:text-white/90 mt-0.5">{cfg.enabled !== false ? '✅' : '❌'}</div>
                          </div>
                        </div>
                        {restarting && (
                          <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/20">
                            <span className="material-symbols-outlined text-primary animate-spin">progress_activity</span>
                            <span className="text-sm text-primary font-medium">{cw.restartingGateway || '正在重启网关...'}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-primary">
                          <span className="material-symbols-outlined text-xl">link</span>
                          <span className="text-sm font-bold">{cw.pairingGuideTitle || '配对验证'}</span>
                        </div>
                        <div className="text-xs text-slate-600 dark:text-white/60 space-y-1">
                          <p>1. {cw.pairingStep1 || '向 Bot 发送任意普通消息（不是命令）'}</p>
                          <p>2. {cw.pairingStep2 || 'Bot 会回复一个配对码'}</p>
                          <p>3. {cw.pairingStep3 || '在下方输入配对码并点击批准'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={pairingCode}
                            onChange={e => setPairingCode(e.target.value)}
                            placeholder={cw.pairingCodePlaceholder || '输入配对码'}
                            className="flex-1 h-9 px-3 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-sm outline-none"
                          />
                          <button
                            onClick={() => handleApprovePairing(chId)}
                            disabled={!pairingCode.trim() || pairingStatus === 'approving'}
                            className="h-9 px-4 bg-primary text-white text-xs font-bold rounded-lg disabled:opacity-50 flex items-center gap-1"
                          >
                            {pairingStatus === 'approving' && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
                            {pairingStatus === 'success' && <span className="material-symbols-outlined text-sm">check</span>}
                            {cw.pairingApprove || '批准'}
                          </button>
                        </div>
                        {pairingStatus === 'success' && (
                          <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">check_circle</span>
                            {cw.pairingSuccess || '配对成功！'}
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
                        {cw.skipPairing || '跳过'}
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
                <h3 className="text-sm font-bold text-slate-800 dark:text-white">{es.deleteConfirmTitle || '确认删除'}</h3>
                <p className="text-xs text-slate-500 dark:text-white/50">{es.deleteConfirmDesc || `确定要删除频道 ${deleteConfirm} 吗？`}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors">
                {es.cancel || '取消'}
              </button>
              <button onClick={() => { deleteField(['channels', deleteConfirm]); setDeleteConfirm(null); }}
                className="px-4 py-2 text-xs font-medium bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors">
                {es.delete || '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
