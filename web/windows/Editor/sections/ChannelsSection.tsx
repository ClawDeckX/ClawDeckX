import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, ConfigField, TextField, PasswordField, SelectField, SwitchField, ArrayField, NumberField, KeyValueField, EmptyState, DiscordGuildField, inputBase } from '../fields';
import { getTranslation } from '../../../locales';
import { schemaTooltip, schemaDefault } from '../schemaTooltip';
import { gwApi, gatewayApi, observabilityApi, pairingApi, pluginApi, weixinQRApi, GatewayObservedState } from '../../../services/api';
import { post } from '../../../services/request';
import CustomSelect from '../../../components/CustomSelect';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
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
  { id: 'openclaw-weixin', icon: 'mark_chat_unread', labelKey: 'chWeixin', category: 'china', descKey: 'chDescWeixin' },
  { id: 'qqbot', icon: 'smart_toy', labelKey: 'chQq', category: 'china', descKey: 'chDescQq' },
  { id: 'yuanbao', icon: 'token', labelKey: 'chYuanbao', category: 'china', descKey: 'chDescYuanbao' },
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
// Required credential fields per channel (used for wizard validation)
// 'when' is an optional predicate: the field is required only when when(cfg) returns true.
// ============================================================================
interface RequiredField { field: string; labelKey: string; when?: (cfg: any) => boolean; }
export const REQUIRED_CREDENTIALS: Record<string, RequiredField[]> = {
  telegram: [{ field: 'botToken', labelKey: 'botToken' }],
  discord: [{ field: 'token', labelKey: 'chToken' }],
  slack: [{ field: 'botToken', labelKey: 'botToken' }, { field: 'appToken', labelKey: 'appToken' }],
  signal: [{ field: 'account', labelKey: 'chAccount' }],
  feishu: [{ field: 'appId', labelKey: 'appId' }, { field: 'appSecret', labelKey: 'appSecret' }],
  wecom: [
    { field: 'botId', labelKey: 'botId' },
    { field: 'secret', labelKey: 'appSecret' },
    { field: 'token', labelKey: 'chToken', when: c => c?.connectionMode === 'webhook' },
    { field: 'encodingAESKey', labelKey: 'encodingAESKey', when: c => c?.connectionMode === 'webhook' },
  ],
  wecom_kf: [{ field: 'corpId', labelKey: 'corpId' }, { field: 'corpSecret', labelKey: 'corpSecret' }, { field: 'token', labelKey: 'chToken' }, { field: 'encodingAESKey', labelKey: 'encodingAESKey' }],
  wechat: [{ field: 'appId', labelKey: 'appId' }, { field: 'appSecret', labelKey: 'appSecret' }, { field: 'token', labelKey: 'chToken' }, { field: 'encodingAesKey', labelKey: 'encodingAESKey' }],
  dingtalk: [{ field: 'clientId', labelKey: 'clientId' }, { field: 'clientSecret', labelKey: 'clientSecret' }],
  doubao: [{ field: 'appId', labelKey: 'appId' }, { field: 'appSecret', labelKey: 'appSecret' }],
  msteams: [{ field: 'appId', labelKey: 'appId' }, { field: 'appPassword', labelKey: 'appPassword' }],
  matrix: [{ field: 'homeserver', labelKey: 'homeserver' }],
  yuanbao: [{ field: 'appKey', labelKey: 'appKey' }, { field: 'appSecret', labelKey: 'appSecret' }],
  mattermost: [{ field: 'botToken', labelKey: 'botToken' }, { field: 'baseUrl', labelKey: 'baseUrl' }],
  bluebubbles: [{ field: 'serverUrl', labelKey: 'serverUrl' }, { field: 'password', labelKey: 'password' }],
  qqbot: [{ field: 'appId', labelKey: 'appId' }, { field: 'clientSecret', labelKey: 'clientSecret' }],
  zalo: [{ field: 'botToken', labelKey: 'botToken' }],
};

export const getCredentialErrors = (chId: string, cfg: any, es: any): string[] => {
  const reqs = REQUIRED_CREDENTIALS[chId];
  if (!reqs) return [];
  return reqs
    .filter(r => {
      if (r.when && !r.when(cfg)) return false;
      return !cfg?.[r.field] || (typeof cfg[r.field] === 'string' && !cfg[r.field].trim());
    })
    .map(r => (es[r.labelKey] || r.field));
};

// Validate all channel accounts before save. Returns array of { channel, account, fields[] }
export const validateChannelsConfig = (config: Record<string, any>, es: any): { channel: string; account: string; fields: string[] }[] => {
  const channels = config?.channels;
  if (!channels || typeof channels !== 'object') return [];
  const errors: { channel: string; account: string; fields: string[] }[] = [];
  for (const ch of Object.keys(channels)) {
    if (ch === 'defaults') continue;
    const chCfg = channels[ch];
    if (!chCfg || typeof chCfg !== 'object') continue;
    const accounts = chCfg.accounts;
    if (accounts && typeof accounts === 'object') {
      for (const acct of Object.keys(accounts)) {
        const acctCfg = accounts[acct];
        if (!acctCfg || acctCfg.enabled === false) continue;
        const fields = getCredentialErrors(ch, acctCfg, es);
        if (fields.length > 0) errors.push({ channel: ch, account: acct, fields });
      }
    } else {
      // Legacy top-level format
      if (chCfg.enabled === false) continue;
      const fields = getCredentialErrors(ch, chCfg, es);
      if (fields.length > 0) errors.push({ channel: ch, account: 'default', fields });
    }
  }
  return errors;
};

const getAccessWarnings = (chId: string, cfg: any, es: any): string[] => {
  const warnings: string[] = [];
  const dm = cfg?.dmPolicy || 'pairing';
  const gp = cfg?.groupPolicy;
  const allowFrom = cfg?.allowFrom;
  const groupAllowFrom = cfg?.groupAllowFrom;

  if (dm === 'allowlist' && (!Array.isArray(allowFrom) || allowFrom.length === 0)) {
    warnings.push(es.wizWarnDmAllowlistEmpty || 'DM policy is "allowlist" but Allow From is empty — all DMs will be dropped');
  }
  if (gp === 'allowlist' && (!Array.isArray(groupAllowFrom) || groupAllowFrom.length === 0) && (!Array.isArray(allowFrom) || allowFrom.length === 0)) {
    warnings.push(es.wizWarnGroupAllowlistEmpty || 'Group policy is "allowlist" but group allow list is empty — all group messages will be dropped');
  }
  return warnings;
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
          <label className="text-[11px] md:text-xs font-semibold theme-text-secondary select-none">
            {cw.pairingCodeLabel || es.pairingCode || 'Pairing Code'}
          </label>
          <span className="material-symbols-outlined text-[13px] theme-text-muted cursor-help" title={es.tipPairingCode || 'Enter the pairing code from the channel'}>info</span>
        </div>
      </div>
      <div className="md:col-span-8 lg:col-span-7 flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={pairingCode}
            onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
            placeholder={cw.pairingCodePlaceholder || 'Enter pairing code'}
            className="h-8 theme-field rounded-md px-3 text-[12px] md:text-xs font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-600 w-full md:w-64"
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
          <div className="text-[10px] theme-text-secondary">
            {cw.pendingRequests || es.pendingRequests || 'Pending requests'}: {pendingRequests.length}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
export const ChannelsSection: React.FC<SectionProps> = ({ config, schema, setField, getField, deleteField, language, reload }) => {
  const { toast } = useToast();
  const { confirm } = useConfirm();
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

  // Auto-migrate legacy single-account configs into accounts.default
  const [migrated, setMigrated] = useState<Record<string, boolean>>({});
  useEffect(() => {
    for (const ch of channelKeys) {
      if (ch === 'defaults' || migrated[ch]) continue;
      const chCfg = channels[ch];
      if (!chCfg || typeof chCfg !== 'object') continue;
      // Check if there are top-level account fields (legacy format)
      const CHANNEL_GLOBAL_KEYS = ['accounts', 'defaultAccount'];
      const legacyKeys = Object.keys(chCfg).filter(k => !CHANNEL_GLOBAL_KEYS.includes(k));
      if (legacyKeys.length === 0) continue;
      // Migrate: move all top-level fields into accounts.default
      const acctData: Record<string, any> = {};
      for (const k of legacyKeys) acctData[k] = chCfg[k];
      // Write accounts.default with the legacy fields
      const currentDefault = chCfg.accounts?.default && typeof chCfg.accounts.default === 'object' ? chCfg.accounts.default : {};
      setField(['channels', ch, 'accounts', 'default'], { ...acctData, ...currentDefault });
      // Remove legacy top-level fields
      for (const k of legacyKeys) deleteField(['channels', ch, k]);
      setMigrated(prev => ({ ...prev, [ch]: true }));
    }
  }, [channelKeys.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Multi-account state: tracks which account tab is active per channel
  const [activeAccounts, setActiveAccounts] = useState<Record<string, string>>({});
  const [addAccountChannel, setAddAccountChannel] = useState<string | null>(null);
  const [newAccountName, setNewAccountName] = useState('');
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState<{ ch: string; acct: string } | null>(null);

  // Get the list of account IDs for a channel (reads from channels.{ch}.accounts)
  const getAccountIds = useCallback((ch: string): string[] => {
    const chCfg = channels[ch] || {};
    const accounts = chCfg.accounts;
    if (!accounts || typeof accounts !== 'object') return ['default'];
    const keys = Object.keys(accounts).filter(Boolean);
    return keys.length > 0 ? keys : ['default'];
  }, [channels]);

  // Get the active account for a channel (default to 'default')
  const getActiveAccount = useCallback((ch: string): string => {
    return activeAccounts[ch] || 'default';
  }, [activeAccounts]);

  // Build the config path prefix for a given channel + account
  const accountPath = useCallback((ch: string, acct: string): string[] => {
    return ['channels', ch, 'accounts', acct];
  }, []);

  const handleAddAccount = useCallback((ch: string) => {
    const name = newAccountName.trim().toLowerCase();
    if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      toast('error', es.acctNameInvalid);
      return;
    }
    const existing = getAccountIds(ch);
    if (existing.includes(name)) {
      toast('error', es.acctNameExists);
      return;
    }
    setField(['channels', ch, 'accounts', name], { enabled: true });
    setActiveAccounts(prev => ({ ...prev, [ch]: name }));
    setAddAccountChannel(null);
    setNewAccountName('');
    // Trigger wizard flow for the new account (skip step 0 select + step 1 prep)
    setAddingChannel(ch);
    setWizardAccount(name);
    setWizardStep(2);
  }, [newAccountName, getAccountIds, setField, es, toast]);

  const handleDeleteAccount = useCallback((ch: string, acct: string) => {
    const acctIds = getAccountIds(ch);
    if (acctIds.length <= 1) return;
    deleteField(['channels', ch, 'accounts', acct]);
    // If this was the active tab, switch to another account
    setActiveAccounts(prev => {
      const next = { ...prev };
      if (next[ch] === acct) {
        const remaining = acctIds.filter(a => a !== acct);
        next[ch] = remaining[0] || 'default';
      }
      return next;
    });
    // If default account was this one, clear it
    const defaultAcct = getField(['channels', ch, 'defaultAccount']);
    if (defaultAcct === acct) {
      deleteField(['channels', ch, 'defaultAccount']);
    }
    setDeleteAccountConfirm(null);
  }, [deleteField, getField]);

  const handleSetDefaultAccount = useCallback((ch: string, acct: string) => {
    setField(['channels', ch, 'defaultAccount'], acct);
  }, [setField]);

  const [addingChannel, setAddingChannel] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState(0); // 0=select, 1=prep, 2=creds, 3=access, 4=confirm
  const [wizardAccount, setWizardAccount] = useState<string | null>(null); // non-null = adding named account to existing channel
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
  const [showWebLogin, setShowWebLogin] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [pairingStatus, setPairingStatus] = useState<'idle' | 'approving' | 'success' | 'error'>('idle');
  const [pairingError, setPairingError] = useState('');

  // Plugin install state
  const [canInstallPlugin, setCanInstallPlugin] = useState<boolean | null>(null);
  const [pluginInstalled, setPluginInstalled] = useState<Record<string, boolean>>({});
  // True while checkCanInstallPlugin() is running — used to gate the install
  // button so users can't click it before detection completes and accidentally
  // reinstall an already-installed plugin.
  const [pluginCheckInProgress, setPluginCheckInProgress] = useState(false);
  const [pluginInstalling, setPluginInstalling] = useState(false);
  const [pluginInstallResult, setPluginInstallResult] = useState<{
    ok: boolean;
    msg: string;
    phase?: 'installed' | 'restarting' | 'ready';
    gatewayState?: GatewayObservedState;
    timedOut?: boolean;
    canForceRetry?: boolean;
    retryKind?: 'exists' | 'security';
    pendingSpec?: string;
    pendingChannelId?: string;
  } | null>(null);

  const pluginGatewayRecoveryView = useMemo(() => {
    const state = pluginInstallResult?.gatewayState;
    const phase = state?.phase || (pluginInstallResult?.phase === 'restarting' ? 'starting' : 'installed');
    const probe = state?.probe || {};
    const ws = state?.ws || {};
    const rpc = state?.rpc || {};
    const steps = [
      { key: 'tcp', label: 'TCP', ok: !!probe.tcp_reachable || ['http_live', 'http_ready', 'ws_connected', 'rpc_ready'].includes(phase), active: phase === 'tcp_open' },
      { key: 'health', label: '/health', ok: !!probe.live?.ok || ['http_ready', 'ws_connected', 'rpc_ready'].includes(phase), active: phase === 'http_live' },
      { key: 'ready', label: '/ready', ok: !!probe.ready?.ok || ['ws_connected', 'rpc_ready'].includes(phase), active: phase === 'http_ready' },
      { key: 'ws', label: 'WS', ok: !!ws.connected || phase === 'rpc_ready', active: phase === 'pairing' || phase === 'auth_refresh' || phase === 'ws_connected' },
      { key: 'rpc', label: 'RPC', ok: !!rpc.ready || phase === 'rpc_ready' || !!state?.ready, active: phase === 'rpc_ready' },
    ];
    const labels: Record<string, string> = {
      installed: cw.pluginInstallSuccess || 'Plugin installed',
      starting: cw.gatewayRestarting || 'Gateway restarting...',
      restarting: cw.gatewayRestarting || 'Gateway restarting...',
      grace: cw.gatewayRestarting || 'Gateway restart grace active',
      tcp_open: cw.gatewayTcpOpen || 'TCP port is open',
      http_live: cw.gatewayHealthOk || 'HTTP health is available',
      http_ready: cw.gatewayReadyOk || 'HTTP ready is available',
      pairing: cw.gatewayPairing || 'Approving pairing...',
      auth_refresh: cw.gatewayAuthRefresh || 'Refreshing gateway token...',
      ws_connected: cw.gatewayWsConnected || 'WebSocket connected',
      rpc_ready: cw.pluginReady || 'Gateway ready',
    };
    return {
      phase,
      steps,
      label: pluginInstallResult?.timedOut
        ? (cw.gatewayStillStarting || 'Gateway is still starting in the background')
        : (labels[phase] || labels.starting),
    };
  }, [pluginInstallResult, cw]);

  const handleWizardTest = useCallback(async (chId: string, acctKey?: string) => {
    setWizTestStatus('testing');
    setWizTestMsg('');
    try {
      // Read from multi-account path: channels.{ch}.accounts.{acct}
      const chCfg = channels[chId] || {};
      const acct = acctKey || 'default';
      const cfg = chCfg?.accounts?.[acct] || chCfg || {};
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
      else if (chId === 'yuanbao') { tokenMap.appKey = cfg.appKey || ''; tokenMap.appSecret = cfg.appSecret || ''; }
      else if (chId === 'mattermost') { tokenMap.botToken = cfg.botToken || ''; tokenMap.baseUrl = cfg.baseUrl || ''; }
      else {
        // Generic: collect all string fields that look like tokens
        for (const [k, v] of Object.entries(cfg)) {
          if (typeof v === 'string' && v && k !== 'enabled') tokenMap[k] = v;
        }
      }
      const res = await post<any>('/api/v1/setup/test-channel', { channel: chId, tokens: tokenMap }, { signal: AbortSignal.timeout(25000) });
      if (res?.status === 'ok') {
        setWizTestStatus('ok');
        setWizTestMsg(res?.message || '');
      } else {
        setWizTestStatus('fail');
        setWizTestMsg(res?.message || '');
      }
    } catch (err: any) {
      setWizTestStatus('fail');
      setWizTestMsg(err?.name === 'TimeoutError' ? 'Connection timeout' : (err?.message || es.chSendFailed));
    }
    setTimeout(() => { setWizTestStatus('idle'); setWizTestMsg(''); }, 5000);
  }, [channels, es]);

  // WhatsApp / Weixin QR web login
  const [webLoginBusy, setWebLoginBusy] = useState(false);
  const [webLoginResult, setWebLoginResult] = useState<{ ok: boolean; text: string; qr?: string; qrDataUrl?: string } | null>(null);

  // Weixin (openclaw-weixin) uses a dedicated flow that bypasses the plugin's
  // missing web.login.start gateway method and talks to iLink's public HTTP
  // API directly via the ClawDeckX backend.
  const handleWeixinQRLogin = useCallback(async () => {
    setWebLoginBusy(true);
    setWebLoginResult(null);
    try {
      const start = await weixinQRApi.start();
      if (!start.qrImgUrl) {
        setWebLoginResult({ ok: false, text: cw.loginFailed });
        setWebLoginBusy(false);
        return;
      }
      setWebLoginResult({ ok: true, text: cw.qrReady, qrDataUrl: start.qrImgUrl });

      // Poll every 2s up to the session TTL (10 min ≈ 300 polls).
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));
        let poll;
        try {
          poll = await weixinQRApi.poll();
        } catch {
          continue;
        }
        // Refresh QR image on refresh / scan state changes.
        if (poll.qrImgUrl && poll.status !== 'confirmed') {
          setWebLoginResult({ ok: true, text: poll.message || cw.qrReady, qrDataUrl: poll.qrImgUrl });
        }
        if (poll.status === 'confirmed') {
          setWebLoginResult({ ok: true, text: cw.loginSuccess });
          return;
        }
        if (poll.status === 'error' || poll.status === 'timeout' || poll.status === 'cancelled') {
          setWebLoginResult({ ok: false, text: poll.message || cw.loginTimeout });
          return;
        }
      }
      setWebLoginResult({ ok: false, text: cw.loginTimeout });
    } catch (err: any) {
      setWebLoginResult({ ok: false, text: `${cw.loginFailed}: ${err?.message || ''}` });
    } finally {
      setWebLoginBusy(false);
    }
  }, [cw]);

  // WhatsApp (and any other plugin that actually implements web.login.start).
  const handleWhatsAppLogin = useCallback(async () => {
    setWebLoginBusy(true);
    setWebLoginResult(null);
    try {
      const res = await gwApi.webLoginStart({}) as any;
      if (res?.qr || res?.qrDataUrl) {
        setWebLoginResult({ ok: true, text: res?.message || cw.qrReady, qr: res.qr, qrDataUrl: res.qrDataUrl });
        try {
          await gwApi.webLoginWait({ timeoutMs: res?.qrDataUrl ? 480000 : 60000, sessionKey: res?.sessionKey });
          setWebLoginResult({ ok: true, text: cw.loginSuccess });
        } catch { setWebLoginResult({ ok: false, text: cw.loginTimeout }); }
      } else {
        setWebLoginResult({ ok: true, text: res?.message || res?.status || cw.started });
      }
    } catch (err: any) {
      const msg = err?.message || '';
      const isPluginError = /web\.login\.start|no provider|provider is not available|plugin.*load|not found/i.test(msg);
      setWebLoginResult({ ok: false, text: isPluginError ? (cw.webLoginPluginError || `${cw.loginFailed}: ${msg}`) : `${cw.loginFailed}: ${msg}` });
    }
    setWebLoginBusy(false);
  }, [cw]);

  // Dispatch by channel id.
  const handleWebLogin = useCallback((chId?: string) => {
    if (chId === 'openclaw-weixin') {
      return handleWeixinQRLogin();
    }
    return handleWhatsAppLogin();
  }, [handleWeixinQRLogin, handleWhatsAppLogin]);

  // Check if plugin install is available (local gateway only) and check installed status
  const checkCanInstallPlugin = useCallback(async () => {
    setPluginCheckInProgress(true);
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
      wecom: '@wecom/wecom-openclaw-plugin',
      wecom_kf: '@openclaw-china/wecom-app',
      'openclaw-weixin': '@tencent-weixin/openclaw-weixin',
      qqbot: '@openclaw/qqbot',
      yuanbao: 'openclaw-plugin-yuanbao@latest',
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
    setPluginCheckInProgress(false);
  }, []);

  // Install plugin with gateway restart detection.
  // `opts.dangerouslyForce` bypasses the upstream install-time security scanner
  // (used after user confirms a SECURITY_BLOCKED retry).
  const handleInstallPlugin = useCallback(async (
    spec: string,
    channelId: string,
    opts?: { force?: boolean; dangerouslyForce?: boolean },
  ) => {
    setPluginInstalling(true);
    setPluginInstallResult(null);
    try {
      const res = await pluginApi.install(spec, {
        force: !!opts?.force,
        dangerouslyForce: !!opts?.dangerouslyForce,
      });
      if (res.success) {
        // Phase 1: Plugin installed — gateway auto-restarts via config change detection
        // (no need to call gatewayApi.restart() — that caused a redundant double restart)
        setPluginInstallResult({ ok: true, msg: 'success', phase: 'restarting' });
        setPluginInstalling(false);
        
        // Phase 2: Poll the unified gateway observability state (gateway restart can take a while)
        let retries = 0;
        const maxRetries = 180;
        const pollInterval = 1000;

        const poll = setInterval(async () => {
          retries++;
          let state: GatewayObservedState | undefined;
          let ready = false;
          try {
            state = await observabilityApi.gatewayState();
            ready = !!state?.ready || state?.phase === 'rpc_ready';
            setPluginInstallResult({ ok: true, msg: 'success', phase: 'restarting', gatewayState: state });
          } catch {
            try {
              await gwApi.proxy('health', {});
              ready = true;
            } catch { /* not ready */ }
          }
          
          if (ready) {
            clearInterval(poll);
            // Phase 3: Gateway ready, refresh plugin status
            setPluginInstallResult({ ok: true, msg: 'success', phase: 'ready', gatewayState: state });
            // Trust the successful install — checkInstalled can race with the
            // gateway's plugin registry reload and return false for a few
            // seconds after restart, which leaves the UI stuck showing the
            // "install" button for an already-installed plugin.
            setPluginInstalled(prev => ({ ...prev, [channelId]: true }));
            // Reload editor config so the in-memory snapshot includes the newly
            // installed plugin's plugins.installs record.  Without this, a
            // subsequent save() would push the stale pre-install snapshot back
            // to the gateway, overwriting the plugin install state (size-drop).
            try {
              if (reload) await reload();
            } catch { /* ignore */ }
            // Clear result after 2 seconds
            setTimeout(() => setPluginInstallResult(null), 2000);
          } else if (retries >= maxRetries) {
            clearInterval(poll);
            // Timeout - gateway didn't come back, but plugin was installed
            setPluginInstallResult({ ok: true, msg: 'success', phase: 'ready', gatewayState: state, timedOut: true });
            setPluginInstalled(prev => ({ ...prev, [channelId]: true }));
            // Still try to reload config even on timeout
            try {
              if (reload) await reload();
            } catch { /* ignore */ }
            setTimeout(() => setPluginInstallResult(null), 2000);
          }
        }, pollInterval);
      } else {
        setPluginInstallResult({ ok: false, msg: res.output || es.failed });
        setPluginInstalling(false);
      }
    } catch (err: any) {
      // PLUGIN_EXISTS: residue directory from a prior failed install → offer
      // force-reinstall (uninstall residue, then reinstall).
      // SECURITY_BLOCKED: upstream install-time scanner flagged dangerous code
      // patterns (often false-positive on plugin test files). Offer explicit
      // force-unsafe retry with a clear warning.
      const code: string | undefined = err?.code;
      const isExistsErr = code === 'PLUGIN_EXISTS';
      const isSecurityErr = code === 'SECURITY_BLOCKED';
      const canRetry = !opts?.force && !opts?.dangerouslyForce && (isExistsErr || isSecurityErr);
      setPluginInstallResult({
        ok: false,
        msg: err?.message || es.failed,
        canForceRetry: canRetry,
        retryKind: isSecurityErr ? 'security' : isExistsErr ? 'exists' : undefined,
        pendingSpec: spec,
        pendingChannelId: channelId,
      });
      setPluginInstalling(false);
    }
  }, [es, reload]);

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
    if (channelKeys.includes(type)) {
      // Channel already exists — open the card and show the add-account inline form
      setAddAccountChannel(type);
      setNewAccountName('');
      return;
    }
    // First account: save directly under accounts.default
    setField(['channels', type, 'accounts', 'default'], { enabled: true });
    setAddingChannel(type);
    setWizardStep(1);
  }, [setField, channelKeys]);

  const resetWizard = useCallback(() => {
    setAddingChannel(null);
    setWizardStep(0);
    setWizardAccount(null);
    setShowPairing(false);
    setShowWebLogin(false);
    setPairingCode('');
    setPairingStatus('idle');
    setPairingError('');
  }, []);

  const waitGatewayReady = useCallback(async (timeoutMs = 120000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const state = await observabilityApi.gatewayState();
        if (state?.ready || state?.phase === 'rpc_ready') {
          return true;
        }
      } catch {
        try {
          const st = (await gwApi.status()) as any;
          if (st?.connected) {
            await gwApi.proxy('health', {});
            return true;
          }
        } catch { /* keep polling */ }
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }, []);

  const saveWizardChannelConfig = useCallback(async (chId: string, acctKey: string): Promise<boolean> => {
    const chCfg = channels[chId] || {};
    const acctCfg = chCfg?.accounts?.[acctKey] || {};
    const patch: Record<string, any> = {
      channels: {
        [chId]: {
          accounts: {
            [acctKey]: acctCfg,
          },
        },
      },
    };
    const defaultAccount = getField(['channels', chId, 'defaultAccount']);
    if (defaultAccount) {
      patch.channels[chId].defaultAccount = defaultAccount;
    }
    await gwApi.configSafePatch(patch);
    return true;
  }, [channels, getField]);

  const handleFinishWizard = useCallback(async (chId: string) => {
    const acctKey = wizardAccount || 'default';
    const acctCfg = channels[chId]?.accounts?.[acctKey] || {};
    const credErrors = getCredentialErrors(chId, acctCfg, es);
    if (credErrors.length > 0) {
      toast('error', (es.wizCredentialRequired || 'Required fields missing') + ': ' + credErrors.join(', '));
      setWizardStep(2);
      return;
    }
    const dmPolicy = getField(['channels', chId, 'accounts', acctKey, 'dmPolicy']) || 'pairing';
    const requiresPairing = chId !== 'yuanbao' && dmPolicy === 'pairing';
    setRestarting(true);
    let completed = false;
    try {
      const saved = await saveWizardChannelConfig(chId, acctKey);
      if (!saved) {
        console.error('Failed to save channel config before restart');
        throw new Error(cw.saveFailed || 'Failed to save channel config');
      }
      await gatewayApi.restart();
      await new Promise(r => setTimeout(r, 2000));
      // Wait for WS to reconnect + health probe to succeed before exposing
      // QR / pairing UI. Otherwise the user clicks "Generate QR" before the
      // plugin has finished loading and hits a transient failure.
      const ready = await waitGatewayReady();
      if (!ready) {
        toast('error', cw.gatewayRestartTimeout || 'Gateway restart timeout — please retry');
      }
      if (reload) await reload();
      completed = true;
    } catch (err) {
      console.error('Failed to finish wizard:', err);
      toast('error', err instanceof Error ? err.message : (cw.saveFailed || 'Failed to save channel config'));
    }
    setRestarting(false);
    if (!completed) return;
    const isQrChannel = chId === 'whatsapp' || chId === 'openclaw-weixin';
    if (isQrChannel) {
      setShowWebLogin(true);
    } else if (requiresPairing) {
      setShowPairing(true);
    } else {
      resetWizard();
    }
  }, [getField, resetWizard, saveWizardChannelConfig, channels, es, toast, wizardAccount, waitGatewayReady, cw, reload]);

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

  const renderAccountTabBar = (ch: string) => {
    const acctIds = getAccountIds(ch);
    const activeAcct = getActiveAccount(ch);
    const defaultAcct = getField(['channels', ch, 'defaultAccount']) || '';
    if (acctIds.length <= 1 && addAccountChannel !== ch) return null;
    return (
      <div className="mb-3 pb-2 border-b border-slate-100 dark:border-white/[0.06]">
        <div className="flex items-center gap-1 flex-wrap">
          {acctIds.map(aid => {
            const isActive = aid === activeAcct;
            const isDefAcct = !defaultAcct ? aid === 'default' : aid === defaultAcct;
            return (
              <button key={aid} onClick={() => setActiveAccounts(prev => ({ ...prev, [ch]: aid }))}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${isActive ? 'bg-primary/10 text-primary border border-primary/30' : 'text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'}`}>
                {aid === 'default' ? es.acctDefault : aid}
                {isDefAcct && <span className="material-symbols-outlined text-[10px] text-amber-500" title={es.acctIsDefault}>star</span>}
                {isActive && acctIds.length > 1 && (
                  <span className="inline-flex items-center gap-0.5 ms-0.5">
                    {!isDefAcct && (
                      <span role="button" tabIndex={0} onClick={e => { e.stopPropagation(); handleSetDefaultAccount(ch, aid); }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); handleSetDefaultAccount(ch, aid); } }}
                        className="text-slate-400 hover:text-amber-500 cursor-pointer" title={es.acctSetDefault}>
                        <span className="material-symbols-outlined text-[11px]">star</span>
                      </span>
                    )}
                    <span role="button" tabIndex={0} onClick={e => { e.stopPropagation(); setDeleteAccountConfirm({ ch, acct: aid }); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setDeleteAccountConfirm({ ch, acct: aid }); } }}
                      className="text-slate-400 hover:text-red-500 cursor-pointer" title={es.acctDeleteAccount}>
                      <span className="material-symbols-outlined text-[11px]">close</span>
                    </span>
                  </span>
                )}
              </button>
            );
          })}
          {addAccountChannel !== ch && (
            <button onClick={() => { setAddAccountChannel(ch); setNewAccountName(''); }}
              className="px-1.5 py-1 rounded-lg text-[10px] text-primary/60 hover:text-primary hover:bg-primary/5 border border-dashed border-primary/20 hover:border-primary/40 transition-all">
              <span className="material-symbols-outlined text-[12px]">add</span>
            </button>
          )}
        </div>
        {addAccountChannel === ch && (
          <div className="mt-2 px-3 py-2.5 rounded-xl bg-primary/[0.04] dark:bg-primary/[0.06] border border-primary/20 dark:border-primary/15 space-y-2">
            <div className="text-[10px] font-bold text-primary flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">person_add</span>
              {es.acctAddAccount}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-white/40">{es.acctNamePrompt}</div>
            <div className="flex items-center gap-2">
              <input value={newAccountName} onChange={e => setNewAccountName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddAccount(ch); if (e.key === 'Escape') setAddAccountChannel(null); }}
                placeholder={es.acctNamePlaceholder} autoFocus
                className="flex-1 h-8 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-xs text-slate-700 dark:text-white/70 outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all sci-input" />
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <button onClick={() => handleAddAccount(ch)} disabled={!newAccountName.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary text-white text-[10px] font-bold disabled:opacity-40 hover:bg-primary/90 transition-all">
                {es.acctAddAccount}
              </button>
              <button onClick={() => setAddAccountChannel(null)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold theme-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                {es.cancel}
              </button>
            </div>
          </div>
        )}
        {deleteAccountConfirm?.ch === ch && (
          <div className="mt-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 space-y-2">
            <div className="text-[10px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">warning</span>
              {es.acctDeleteAccount}
            </div>
            <p className="text-[10px] text-red-600/80 dark:text-red-400/80">{es.acctDeleteConfirm}</p>
            <div className="flex items-center gap-2 pt-0.5">
              <button onClick={() => handleDeleteAccount(ch, deleteAccountConfirm.acct)}
                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-[10px] font-bold hover:bg-red-600 transition-all">{es.delete}</button>
              <button onClick={() => setDeleteAccountConfirm(null)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">{es.cancel}</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderChannelFields = (ch: string, cfg: any, basePath?: string[]) => {
    const base = basePath || ['channels', ch];
    const p = (f: string[]) => [...base, ...f];
    const g = (f: string[]) => getField(p(f));
    const s = (f: string[], v: any) => setField(p(f), v);
    const labelToken = es.chToken;
    const labelBotToken = es.botToken;
    const labelAppToken = es.appToken;
    const labelWebhookUrl = es.webhookUrl;
    const labelHttpUrl = es.httpUrl;
    const labelWebhookPath = es.chWebhookPath;
    const labelAppId = es.appId;
    const labelAppKey = es.appKey || 'App Key';
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
            <ConfigField label={es.dmPolicy} tooltip={tip('dmPolicy')}>
              <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className={`${inputBase} w-full md:w-64`}
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
            </ConfigField>
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
                  <span className="text-[11px] font-bold theme-text-muted">{es.topicBindings || 'Topic Bindings'}</span>
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
              <span className="text-[11px] font-bold theme-text-muted">{es.discordVoiceTitle || 'Voice'}</span>
            </div>
            <SwitchField label={es.discordVoiceEnabled || 'Voice Enabled'} value={g(['voice', 'enabled']) !== false} onChange={v => s(['voice', 'enabled'], v)} tooltip={es.tipDiscordVoice} />
            {/* Discord Intents */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.discordIntentsTitle || 'Privileged Intents'}</span>
            </div>
            <SwitchField label={es.discordIntentPresence || 'Presence Intent'} value={g(['intents', 'presence']) === true} onChange={v => s(['intents', 'presence'], v)} tooltip={es.tipDiscordIntentPresence} />
            <SwitchField label={es.discordIntentMembers || 'Guild Members Intent'} value={g(['intents', 'guildMembers']) === true} onChange={v => s(['intents', 'guildMembers'], v)} tooltip={es.tipDiscordIntentMembers} />
            {/* Discord Actions */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.discordActionsTitle || 'Actions'}</span>
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
            <SwitchField label={es.threadRequireExplicitMention || 'Thread Require @mention'} value={g(['thread', 'requireExplicitMention']) === true} onChange={v => s(['thread', 'requireExplicitMention'], v)} tooltip={es.tipSlackThreadMention} />
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
              <span className="text-[11px] font-bold theme-text-muted">{es.slackSlashTitle || 'Slash Command'}</span>
            </div>
            <SwitchField label={es.slackSlashEnabled || 'Enabled'} value={g(['slashCommand', 'enabled']) === true} onChange={v => s(['slashCommand', 'enabled'], v)} tooltip={es.tipSlackSlash} />
            <TextField label={es.slackSlashName || 'Command Name'} value={g(['slashCommand', 'name']) || 'openclaw'} onChange={v => s(['slashCommand', 'name'], v)} tooltip={es.tipSlackSlashName} />
            {/* Slack Actions */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.slackActionsTitle || 'Actions'}</span>
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
            <ConfigField label={es.dmPolicy} tooltip={tip('dmPolicy')}>
              <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className={`${inputBase} w-full md:w-64`}
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
            </ConfigField>
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
            <ConfigField label={es.dmPolicy} tooltip={tip('dmPolicy')}>
              <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className={`${inputBase} w-full md:w-64`}
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
            </ConfigField>
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
            <ConfigField label={es.dmPolicy} tooltip={tip('dmPolicy')}>
              <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className={`${inputBase} w-full md:w-64`}
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
            </ConfigField>
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
            <ConfigField label={es.dmPolicy} tooltip={tip('dmPolicy')}>
              <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dm', 'policy']) || 'pairing'}
                    onChange={v => s(['dm', 'policy'], v)}
                    options={dmPolicy(es)}
                    className={`${inputBase} w-full md:w-64`}
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
            </ConfigField>
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
            <SelectField label={es.chDomain}
              value={(() => { const d = g(['domain']) || 'feishu'; return (d === 'feishu' || d === 'lark') ? d : 'custom'; })()}
              onChange={v => s(['domain'], v === 'custom' ? 'https://' : v)}
              options={[
                { value: 'feishu', label: es.optFeishu },
                { value: 'lark', label: es.optLark },
                { value: 'custom', label: es.optDomainCustom || 'Custom URL' },
              ]} tooltip={tip('feishuDomain')} />
            {(() => { const d = g(['domain']) || 'feishu'; return d !== 'feishu' && d !== 'lark' ? (
              <TextField label={es.feishuDomainCustom || 'Custom Domain URL'} value={d} onChange={v => s(['domain'], v)} placeholder="https://open.larksuite.com" tooltip={es.tipFeishuDomainCustom} />
            ) : null; })()}
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
            <ConfigField label={es.dmPolicy} tooltip={tip('dmPolicy')}>
              <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className={`${inputBase} w-full md:w-64`}
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
            </ConfigField>
            {showFeishuPairing && (g(['dmPolicy']) || 'pairing') === 'pairing' && (
              <PairingSection channel="feishu" es={es} cw={cw} toast={toast} />
            )}
            <ArrayField label={es.allowFrom || 'Allow From'} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.feishuAllowFromPh || 'ou_xxx'} tooltip={es.tipFeishuAllowFrom} />
            <SelectField label={es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
            <ArrayField label={es.feishuGroupAllowFrom || 'Group Allow From'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.feishuGroupAllowFromPh || 'oc_xxx'} tooltip={es.tipFeishuGroupAllowFrom} />
            <ArrayField label={es.feishuGroupSenderAllowFrom || 'Group Sender Allow From'} value={g(['groupSenderAllowFrom']) || []} onChange={v => s(['groupSenderAllowFrom'], v)} placeholder={es.feishuGroupSenderAllowFromPh || 'ou_xxx'} tooltip={es.tipFeishuGroupSenderAllowFrom} />
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
              <span className="text-[11px] font-bold theme-text-muted">{es.feishuToolsTitle || 'Feishu Tools'}</span>
            </div>
            <SwitchField label={es.feishuToolDoc || 'Document'} value={g(['tools', 'doc']) !== false} onChange={v => s(['tools', 'doc'], v)} tooltip={es.tipFeishuToolDoc} />
            <SwitchField label={es.feishuToolChat || 'Chat'} value={g(['tools', 'chat']) !== false} onChange={v => s(['tools', 'chat'], v)} tooltip={es.tipFeishuToolChat} />
            <SwitchField label={es.feishuToolWiki || 'Wiki'} value={g(['tools', 'wiki']) !== false} onChange={v => s(['tools', 'wiki'], v)} tooltip={es.tipFeishuToolWiki} />
            <SwitchField label={es.feishuToolDrive || 'Drive'} value={g(['tools', 'drive']) !== false} onChange={v => s(['tools', 'drive'], v)} tooltip={es.tipFeishuToolDrive} />
            <SwitchField label={es.feishuToolPerm || 'Permissions'} value={g(['tools', 'perm']) === true} onChange={v => s(['tools', 'perm'], v)} tooltip={es.tipFeishuToolPerm} />
            <SwitchField label={es.feishuToolScopes || 'Scopes Diagnostic'} value={g(['tools', 'scopes']) !== false} onChange={v => s(['tools', 'scopes'], v)} tooltip={es.tipFeishuToolScopes} />

            {/* History & Chunking */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.feishuHistoryTitle || 'History & Chunking'}</span>
            </div>
            <NumberField label={es.feishuHistoryLimit || 'History Limit'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} placeholder="0" tooltip={es.tipFeishuHistoryLimit} />
            <NumberField label={es.feishuDmHistoryLimit || 'DM History Limit'} value={g(['dmHistoryLimit'])} onChange={v => s(['dmHistoryLimit'], v)} placeholder="0" tooltip={es.tipFeishuDmHistoryLimit} />
            <SelectField label={es.feishuChunkMode || 'Chunk Mode'} value={g(['chunkMode']) || 'length'} onChange={v => s(['chunkMode'], v)} options={[
              { value: 'length', label: es.optChunkLength || 'By Length' },
              { value: 'newline', label: es.optChunkNewline || 'By Newline' },
            ]} tooltip={es.tipFeishuChunkMode} />
            <NumberField label={es.feishuHttpTimeoutMs || 'HTTP Timeout (ms)'} value={g(['httpTimeoutMs'])} onChange={v => s(['httpTimeoutMs'], v)} placeholder="30000" tooltip={es.tipFeishuHttpTimeout} />

            {/* Heartbeat */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.feishuHeartbeatTitle || 'Heartbeat'}</span>
            </div>
            <SelectField label={es.feishuHeartbeatVisibility || 'Visibility'} value={g(['heartbeat', 'visibility']) || 'visible'} onChange={v => s(['heartbeat', 'visibility'], v)} options={[
              { value: 'visible', label: es.optHeartbeatVisible || 'Visible' },
              { value: 'hidden', label: es.optHeartbeatHidden || 'Hidden' },
            ]} tooltip={es.tipFeishuHeartbeat} />
            <NumberField label={es.feishuHeartbeatInterval || 'Interval (ms)'} value={g(['heartbeat', 'intervalMs'])} onChange={v => s(['heartbeat', 'intervalMs'], v)} placeholder="5000" tooltip={es.tipFeishuHeartbeat} />

            {/* Streaming Coalesce */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.feishuCoalesceTitle || 'Streaming Coalesce'}</span>
            </div>
            <SwitchField label={es.feishuCoalesceEnabled || 'Enabled'} value={g(['blockStreamingCoalesce', 'enabled']) === true} onChange={v => s(['blockStreamingCoalesce', 'enabled'], v)} tooltip={es.tipFeishuCoalesce} />
            <NumberField label={es.feishuCoalesceMin || 'Min Delay (ms)'} value={g(['blockStreamingCoalesce', 'minDelayMs'])} onChange={v => s(['blockStreamingCoalesce', 'minDelayMs'], v)} placeholder="300" tooltip={es.tipFeishuCoalesce} />
            <NumberField label={es.feishuCoalesceMax || 'Max Delay (ms)'} value={g(['blockStreamingCoalesce', 'maxDelayMs'])} onChange={v => s(['blockStreamingCoalesce', 'maxDelayMs'], v)} placeholder="1500" tooltip={es.tipFeishuCoalesce} />

            {/* Markdown Rendering */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.feishuMarkdownTitle || 'Markdown Rendering'}</span>
            </div>
            <SelectField label={es.feishuMarkdownMode || 'Mode'} value={g(['markdown', 'mode']) || 'native'} onChange={v => s(['markdown', 'mode'], v)} options={[
              { value: 'native', label: es.optMdNative || 'Native' },
              { value: 'escape', label: es.optMdEscape || 'Escape' },
              { value: 'strip', label: es.optMdStrip || 'Strip' },
            ]} tooltip={es.tipFeishuMarkdown} />
            <SelectField label={es.feishuMarkdownTableMode || 'Table Mode'} value={g(['markdown', 'tableMode']) || 'native'} onChange={v => s(['markdown', 'tableMode'], v)} options={[
              { value: 'native', label: es.optMdNative || 'Native' },
              { value: 'ascii', label: es.optMdTableAscii || 'ASCII' },
              { value: 'simple', label: es.optMdTableSimple || 'Simple' },
            ]} tooltip={es.tipFeishuMarkdown} />

            {/* Advanced */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.feishuAdvancedTitle || 'Advanced'}</span>
            </div>
            <SwitchField label={es.feishuConfigWrites || 'Allow Config Writes'} value={g(['configWrites']) === true} onChange={v => s(['configWrites'], v)} tooltip={es.tipFeishuConfigWrites} />
            <SwitchField label={es.feishuActionsReactions || 'Reaction Actions'} value={g(['actions', 'reactions']) === true} onChange={v => s(['actions', 'reactions'], v)} tooltip={es.tipFeishuActionsReactions} />

            {/* Dynamic Agent Creation */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.feishuDynamicAgent || 'Dynamic Agent'}</span>
            </div>
            <SwitchField label={es.feishuDynamicAgentEnabled || 'Enabled'} value={g(['dynamicAgentCreation', 'enabled']) === true} onChange={v => s(['dynamicAgentCreation', 'enabled'], v)} tooltip={es.tipFeishuDynamicAgent} />
            <NumberField label={es.feishuDynamicAgentMax || 'Max Agents'} value={g(['dynamicAgentCreation', 'maxAgents'])} onChange={v => s(['dynamicAgentCreation', 'maxAgents'], v)} placeholder="100" tooltip={es.tipFeishuDynamicAgent} />

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
            <ConfigField label={es.dmPolicy} tooltip={tip('dmPolicy')}>
              <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className={`${inputBase} w-full md:w-64`}
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
            </ConfigField>
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

        {/* QQ Bot */}
        {ch === 'qqbot' && (
          <>
            <TextField label={labelAppId} value={g(['appId']) || ''} onChange={v => s(['appId'], v)} tooltip={es.tipQQAppId} />
            <PasswordField label={labelClientSecret} value={g(['clientSecret']) || ''} onChange={v => s(['clientSecret'], v)} tooltip={es.tipQQClientSecret} />
            <TextField label={es.qqClientSecretFile || 'Client Secret File'} value={g(['clientSecretFile']) || ''} onChange={v => s(['clientSecretFile'], v)} tooltip={es.tipQQClientSecretFile} />
            <TextField label={es.qqName || 'Display Name'} value={g(['name']) || ''} onChange={v => s(['name'], v)} tooltip={es.tipQQName} />
            <SwitchField label={es.chMarkdownSupport} value={g(['markdownSupport']) === true} onChange={v => s(['markdownSupport'], v)} tooltip={es.tipQQMarkdown} />
            {/* DM + Group policy (OpenClaw 2026.4.27 — full group chat support) */}
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'allowlist'} onChange={v => s(['dmPolicy'], v)} options={[
              { value: 'open', label: es.optOpen },
              { value: 'allowlist', label: es.optAllowlist },
              { value: 'disabled', label: es.optDisabled },
            ]} tooltip={es.tipQQDmPolicy || tip('dmPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phQQAllowFrom || 'qqbot:user-xxx'} tooltip={es.tipQQAllowFrom} />
            <SelectField label={es.qqGroupPolicy || es.groupPolicy} value={g(['groupPolicy']) || 'allowlist'} onChange={v => s(['groupPolicy'], v)} options={groupPolicy(es)} tooltip={es.tipQQGroupPolicy || tip('groupPolicy')} />
            <ArrayField label={es.qqGroupAllowFrom || 'Group Allowlist'} value={g(['groupAllowFrom']) || []} onChange={v => s(['groupAllowFrom'], v)} placeholder={es.phQQGroupAllowFrom || 'qqbot:group-xxx'} tooltip={es.tipQQGroupAllowFrom} />
            <TextField label={es.systemPrompt || 'System Prompt'} value={g(['systemPrompt']) || ''} onChange={v => s(['systemPrompt'], v)} tooltip={es.tipQQSystemPrompt} />
            <SwitchField label={es.qqUrlDirectUpload || 'URL Direct Upload'} value={g(['urlDirectUpload']) === true} onChange={v => s(['urlDirectUpload'], v)} tooltip={es.tipQQUrlDirectUpload} />
            <TextField label={es.qqUpgradeUrl || 'Upgrade URL'} value={g(['upgradeUrl']) || ''} onChange={v => s(['upgradeUrl'], v)} tooltip={es.tipQQUpgradeUrl} />
            <SelectField label={es.qqUpgradeMode || 'Upgrade Mode'} value={g(['upgradeMode']) || 'doc'} onChange={v => s(['upgradeMode'], v)} options={[
              { value: 'doc', label: es.optDoc || 'Doc' },
              { value: 'hot-reload', label: es.optHotReload || 'Hot Reload' },
            ]} tooltip={es.tipQQUpgradeMode} />
            <ArrayField label={es.qqVoiceDirectFormats || 'Voice Direct Upload Formats'} value={g(['voiceDirectUploadFormats']) || []} onChange={v => s(['voiceDirectUploadFormats'], v)} placeholder="silk,amr" tooltip={es.tipQQVoiceDirectFormats} />
            {/* Audio Format Policy */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.qqAudioFormatPolicy || 'Audio Format Policy'}</span>
            </div>
            <ArrayField label={es.qqSttDirectFormats || 'STT Direct Formats'} value={g(['audioFormatPolicy', 'sttDirectFormats']) || []} onChange={v => s(['audioFormatPolicy', 'sttDirectFormats'], v)} placeholder="silk,amr,wav" tooltip={es.tipQQSttDirectFormats} />
            <ArrayField label={es.qqUploadDirectFormats || 'Upload Direct Formats'} value={g(['audioFormatPolicy', 'uploadDirectFormats']) || []} onChange={v => s(['audioFormatPolicy', 'uploadDirectFormats'], v)} placeholder="silk,amr" tooltip={es.tipQQUploadDirectFormats} />
            <SwitchField label={es.qqTranscodeEnabled || 'Transcode Enabled'} value={g(['audioFormatPolicy', 'transcodeEnabled']) !== false} onChange={v => s(['audioFormatPolicy', 'transcodeEnabled'], v)} tooltip={es.tipQQTranscodeEnabled} />
            {/* STT */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.qqSttTitle || 'Speech-to-Text (STT)'}</span>
            </div>
            <SwitchField label={es.enabled || 'Enabled'} value={g(['stt', 'enabled']) === true} onChange={v => s(['stt', 'enabled'], v)} tooltip={es.tipQQSttEnabled} />
            {g(['stt', 'enabled']) === true && (
              <>
                <TextField label={es.qqSttProvider || 'Provider'} value={g(['stt', 'provider']) || ''} onChange={v => s(['stt', 'provider'], v)} placeholder="openai" tooltip={es.tipQQSttProvider} />
                <TextField label={labelBaseUrl} value={g(['stt', 'baseUrl']) || ''} onChange={v => s(['stt', 'baseUrl'], v)} placeholder="https://api.openai.com/v1" tooltip={es.tipQQSttBaseUrl} />
                <PasswordField label={labelApiKey} value={g(['stt', 'apiKey']) || ''} onChange={v => s(['stt', 'apiKey'], v)} tooltip={es.tipQQSttApiKey} />
                <TextField label={es.qqSttModel || 'Model'} value={g(['stt', 'model']) || ''} onChange={v => s(['stt', 'model'], v)} placeholder="whisper-1" tooltip={es.tipQQSttModel} />
              </>
            )}
            {/* TTS */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.qqTtsTitle || 'Text-to-Speech (TTS)'}</span>
            </div>
            <SwitchField label={es.enabled || 'Enabled'} value={g(['tts', 'enabled']) === true} onChange={v => s(['tts', 'enabled'], v)} tooltip={es.tipQQTtsEnabled} />
            {g(['tts', 'enabled']) === true && (
              <>
                <TextField label={es.qqTtsProvider || 'Provider'} value={g(['tts', 'provider']) || ''} onChange={v => s(['tts', 'provider'], v)} placeholder="openai" tooltip={es.tipQQTtsProvider} />
                <TextField label={labelBaseUrl} value={g(['tts', 'baseUrl']) || ''} onChange={v => s(['tts', 'baseUrl'], v)} placeholder="https://api.openai.com/v1" tooltip={es.tipQQTtsBaseUrl} />
                <PasswordField label={labelApiKey} value={g(['tts', 'apiKey']) || ''} onChange={v => s(['tts', 'apiKey'], v)} tooltip={es.tipQQTtsApiKey} />
                <TextField label={es.qqTtsModel || 'Model'} value={g(['tts', 'model']) || ''} onChange={v => s(['tts', 'model'], v)} placeholder="tts-1" tooltip={es.tipQQTtsModel} />
                <TextField label={es.qqTtsVoice || 'Voice'} value={g(['tts', 'voice']) || ''} onChange={v => s(['tts', 'voice'], v)} placeholder="alloy" tooltip={es.tipQQTtsVoice} />
                <SelectField label={es.qqTtsAuthStyle || 'Auth Style'} value={g(['tts', 'authStyle']) || 'bearer'} onChange={v => s(['tts', 'authStyle'], v)} options={[
                  { value: 'bearer', label: 'Bearer' },
                  { value: 'api-key', label: 'API Key' },
                ]} tooltip={es.tipQQTtsAuthStyle} />
                <NumberField label={es.qqTtsSpeed || 'Speed'} value={g(['tts', 'speed'])} onChange={v => s(['tts', 'speed'], v)} placeholder="1.0" tooltip={es.tipQQTtsSpeed} />
                <KeyValueField label={es.qqTtsQueryParams || 'Query Params'} value={g(['tts', 'queryParams']) || {}} onChange={v => s(['tts', 'queryParams'], v)} tooltip={es.tipQQTtsQueryParams} />
              </>
            )}
            {/* Streaming */}
            <SelectField label={es.qqStreaming || 'Streaming'} value={(() => { const v = g(['streaming']); if (v === true || (v && typeof v === 'object' && v.mode === 'partial')) return 'partial'; if (v === false || (v && typeof v === 'object' && v.mode === 'off')) return 'off'; return 'partial'; })()} onChange={v => { const cur = g(['streaming']); const c2c = (cur && typeof cur === 'object' && cur.c2cStreamApi) ? true : undefined; s(['streaming'], v === 'partial' ? { mode: 'partial', ...(c2c ? { c2cStreamApi: true } : {}) } : { mode: 'off' }); }} options={[
              { value: 'partial', label: es.optPartial || 'Partial' },
              { value: 'off', label: es.optOff || 'Off' },
            ]} tooltip={es.tipQQStreaming} />
            {(() => { const v = g(['streaming']); const partial = v === true || (v && typeof v === 'object' && v.mode !== 'off'); return partial; })() && (
              <SwitchField
                label={es.qqC2cStreamApi || 'C2C stream_messages API'}
                desc={es.qqC2cStreamApiDesc || 'OpenClaw 2026.4.27+: use the official QQ C2C stream_messages API for true incremental streaming.'}
                tooltip={es.tipQQC2cStreamApi}
                value={(() => { const v = g(['streaming']); return !!(v && typeof v === 'object' && v.c2cStreamApi); })()}
                onChange={v => { const cur = g(['streaming']) || { mode: 'partial' }; const next = (typeof cur === 'object' ? { ...cur } : { mode: 'partial' }) as any; if (v) next.c2cStreamApi = true; else delete next.c2cStreamApi; s(['streaming'], next); }}
              />
            )}
          </>
        )}

        {/* 元宝派 (Yuanbao) — OpenClaw 2026.4.26+ external channel plugin (openclaw-plugin-yuanbao) */}
        {ch === 'yuanbao' && (
          <>
            <TextField label={labelAppKey} value={g(['appKey']) || ''} onChange={v => s(['appKey'], v)} tooltip={es.tipYuanbaoAppKey} />
            <PasswordField label={labelAppSecret} value={g(['appSecret']) || ''} onChange={v => s(['appSecret'], v)} tooltip={es.tipYuanbaoAppSecret} />
            <TextField label={es.ybName || 'Display Name'} value={g(['name']) || ''} onChange={v => s(['name'], v)} tooltip={es.tipYbName} />
            {/* DM policy — nested under `dm.*` per upstream docs */}
            <SelectField label={es.dmPolicy} value={g(['dm', 'policy']) || 'open'} onChange={v => s(['dm', 'policy'], v)} options={dmPolicy(es)} tooltip={es.tipYbDmPolicy || tip('dmPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['dm', 'allowFrom']) || []} onChange={v => s(['dm', 'allowFrom'], v)} placeholder={es.phYbAllowFrom || 'user_xxx'} tooltip={es.tipYbAllowFrom} />
            {/* Group chat */}
            <SwitchField label={es.ybRequireMention || 'Group: require @mention'} desc={es.ybRequireMentionDesc || 'Default true. Set false to respond without @mention. Replying to bot is treated as implicit mention.'} value={g(['requireMention']) !== false} onChange={v => s(['requireMention'], v)} tooltip={es.tipYbRequireMention} />
            <NumberField label={es.ybHistoryLimit || 'Group history limit'} tooltip={es.tipYbHistoryLimit || 'Group chat history entries included in AI context. 0 disables.'} value={g(['historyLimit'])} onChange={v => s(['historyLimit'], v)} min={0} placeholder="100" />
            <SelectField label={es.ybReplyToMode || 'Reply-to mode'} value={g(['replyToMode']) || 'first'} onChange={v => s(['replyToMode'], v)} options={replyToMode(es)} tooltip={es.tipYbReplyToMode} />
            {/* Outbound queue */}
            <SelectField label={es.ybOutboundQueueStrategy || 'Outbound queue strategy'} value={g(['outboundQueueStrategy']) || 'merge-text'} onChange={v => s(['outboundQueueStrategy'], v)} options={[
              { value: 'merge-text', label: es.optMergeText || 'Merge Text' },
              { value: 'immediate', label: es.optImmediate || 'Immediate' },
            ]} tooltip={es.tipYbOutboundQueueStrategy} />
            {(g(['outboundQueueStrategy']) || 'merge-text') === 'merge-text' && (
              <>
                <NumberField label={es.ybMinChars || 'Merge: min chars'} tooltip={es.tipYbMinChars} value={g(['minChars'])} onChange={v => s(['minChars'], v)} min={0} placeholder="2800" />
                <NumberField label={es.ybMaxChars || 'Merge: max chars'} tooltip={es.tipYbMaxChars} value={g(['maxChars'])} onChange={v => s(['maxChars'], v)} min={0} placeholder="3000" />
                <NumberField label={es.ybIdleMs || 'Merge: idle flush (ms)'} tooltip={es.tipYbIdleMs} value={g(['idleMs'])} onChange={v => s(['idleMs'], v)} min={0} placeholder="5000" />
              </>
            )}
            {/* Streaming + media */}
            <SwitchField label={es.ybDisableBlockStreaming || 'Disable block streaming'} desc={es.ybDisableBlockStreamingDesc || 'When true, sends complete reply in one message instead of block streaming.'} value={g(['disableBlockStreaming']) === true} onChange={v => s(['disableBlockStreaming'], v)} tooltip={es.tipYbDisableBlockStreaming} />
            <NumberField label={es.ybMediaMaxMb || 'Media max (MB)'} tooltip={es.tipYbMediaMaxMb} value={g(['mediaMaxMb'])} onChange={v => s(['mediaMaxMb'], v)} min={0} placeholder="20" />
            <SelectField label={es.ybOverflowPolicy || 'Overflow policy'} value={g(['overflowPolicy']) || 'split'} onChange={v => s(['overflowPolicy'], v)} options={[
              { value: 'split', label: es.optSplit || 'Split' },
              { value: 'stop', label: es.optStop || 'Stop' },
            ]} tooltip={es.tipYbOverflowPolicy} />
            <TextField label={es.ybFallbackReply || 'Fallback reply'} value={g(['fallbackReply']) || ''} onChange={v => s(['fallbackReply'], v)} placeholder="暂时无法解答，你可以换个问题问问我哦" tooltip={es.tipYbFallbackReply} />
            <SwitchField label={es.ybMarkdownHintEnabled || 'Markdown hint injection'} desc={es.ybMarkdownHintEnabledDesc || 'Inject system prompt instructions to prevent the model from wrapping the entire reply in a code block.'} value={g(['markdownHintEnabled']) !== false} onChange={v => s(['markdownHintEnabled'], v)} tooltip={es.tipYbMarkdownHintEnabled} />
          </>
        )}

        {/* 微信 ClawBot (openclaw-weixin) */}
        {ch === 'openclaw-weixin' && (
          <>
            <TextField label={es.weixinName || 'Display Name'} value={g(['name']) || ''} onChange={v => s(['name'], v)} tooltip={es.tipWeixinName} />
            <TextField label={labelBaseUrl} value={g(['baseUrl']) || ''} onChange={v => s(['baseUrl'], v)} placeholder="https://ilinkai.weixin.qq.com" tooltip={es.tipWeixinBaseUrl} />
            <TextField label={es.cdnBaseUrl || 'CDN Base URL'} value={g(['cdnBaseUrl']) || ''} onChange={v => s(['cdnBaseUrl'], v)} placeholder="https://novac2c.cdn.weixin.qq.com/c2c" tooltip={es.tipWeixinCdnUrl} />
            <NumberField label={es.routeTag || 'Route Tag'} value={g(['routeTag'])} onChange={v => s(['routeTag'], v)} tooltip={es.tipWeixinRouteTag} />
            <SelectField label={es.dmPolicy} value={g(['dmPolicy']) || 'pairing'} onChange={v => s(['dmPolicy'], v)} options={dmPolicy(es)} tooltip={tip('dmPolicy')} />
            <ArrayField label={es.allowFrom} value={g(['allowFrom']) || []} onChange={v => s(['allowFrom'], v)} placeholder={es.phWeixinUserId || 'xxx@im.wechat'} tooltip={tip('allowFrom')} />
            <TextField label={es.defaultTo || 'Default To'} value={g(['defaultTo']) || ''} onChange={v => s(['defaultTo'], v)} tooltip={tip('defaultTo')} />
            <NumberField label={es.textChunkLimit || 'Text Chunk Limit'} value={g(['textChunkLimit'])} onChange={v => s(['textChunkLimit'], v)} placeholder="4000" tooltip={tip('textChunkLimit')} />
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
            <ConfigField label={es.dmPolicy} tooltip={tip('dmPolicy')}>
              <div className="flex items-center gap-2">
                  <CustomSelect
                    value={g(['dmPolicy']) || 'pairing'}
                    onChange={v => s(['dmPolicy'], v)}
                    options={dmPolicy(es)}
                    className={`${inputBase} w-full md:w-64`}
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
            </ConfigField>
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
              <span className="text-[11px] font-bold theme-text-muted">{es.voiceServeTitle || 'Webhook Server'}</span>
            </div>
            <NumberField label={es.webhookPort || 'Port'} value={g(['serve', 'port'])} onChange={v => s(['serve', 'port'], v)} placeholder="3334" tooltip={es.tipVoiceServePort} />
            <TextField label={es.serveBind || 'Bind'} value={g(['serve', 'bind']) || ''} onChange={v => s(['serve', 'bind'], v)} placeholder="127.0.0.1" tooltip={es.tipVoiceServeBind} />
            <TextField label={es.webhookPath || 'Path'} value={g(['serve', 'path']) || ''} onChange={v => s(['serve', 'path'], v)} placeholder="/voice/webhook" tooltip={es.tipVoiceServePath} />
            {/* Voice Call - Tunnel */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.voiceTunnelTitle || 'Tunnel'}</span>
            </div>
            <SelectField label={es.tunnelProvider || 'Tunnel Provider'} value={g(['tunnel', 'provider']) || 'none'} onChange={v => s(['tunnel', 'provider'], v)} options={[
              { value: 'none', label: es.optNone || 'None' },
              { value: 'ngrok', label: 'ngrok' },
              { value: 'tailscale-serve', label: 'Tailscale Serve' },
              { value: 'tailscale-funnel', label: 'Tailscale Funnel' },
            ]} tooltip={es.tipTunnelProvider} />
            {/* Voice Call - Outbound */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.voiceOutboundTitle || 'Outbound'}</span>
            </div>
            <SelectField label={es.callMode || 'Default Mode'} value={g(['outbound', 'defaultMode']) || 'notify'} onChange={v => s(['outbound', 'defaultMode'], v)} options={[
              { value: 'notify', label: es.optNotify || 'Notify' },
              { value: 'conversation', label: es.optConversation || 'Conversation' },
            ]} tooltip={es.tipCallMode} />
            {/* Voice Call - Response */}
            <div className="pt-2 pb-1">
              <span className="text-[11px] font-bold theme-text-muted">{es.voiceResponseTitle || 'Response'}</span>
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
              forceOpen={sendChannel === ch || logoutChannel === ch || addAccountChannel === ch}
              actions={
                <div className="flex items-center gap-1">
                  <button onClick={e => { e.stopPropagation(); setAddAccountChannel(addAccountChannel === ch ? null : ch); setNewAccountName(''); }} className="text-slate-400 hover:text-primary transition-colors" title={es.acctAddAccount} aria-label={es.acctAddAccount}>
                    <span className="material-symbols-outlined text-[14px]">person_add</span>
                  </button>
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
                      className="px-3 py-1 rounded-lg text-[10px] font-bold theme-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
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
              {renderAccountTabBar(ch)}
              {(() => {
                const act = getActiveAccount(ch);
                const bp = accountPath(ch, act);
                const ac = getField(bp) || {};
                return renderChannelFields(ch, ac, bp);
              })()}
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
        const chCfg = chId ? (channels[chId] || {}) : {};
        const wizAcctKey = wizardAccount || 'default';
        const cfg = chId ? (chCfg?.accounts?.[wizAcctKey] || {}) : {};
        const wizBasePath = chId ? ['channels', chId, 'accounts', wizAcctKey] : undefined;
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
                {wizardAccount ? `${es.acctAddAccount || 'Add Account'}: ${wizardAccount}` : es.addChannel}
              </h3>
              <button onClick={() => {
                if (wizardAccount && chId) {
                  deleteField(['channels', chId, 'accounts', wizardAccount]);
                } else if (chId) {
                  deleteField(['channels', chId]);
                }
                resetWizard();
              }} className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-white/60">
                {es.cancel}
              </button>
            </div>

            {/* ── Step 0: 选择频道 (hidden in account wizard mode) ── */}
            {!wizardAccount && <div className={`border rounded-xl overflow-hidden transition-colors ${stepActive(0) ? 'border-primary/40 bg-white dark:bg-white/[0.02]' : stepDone(0) ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5' : 'border-slate-200 dark:border-white/[0.06] opacity-50'}`}>
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
                      const items = CHANNEL_TYPES.filter(c => c.category === cat && !c.disabled);
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
                                  <div className="text-[11px] font-bold text-slate-700 dark:text-white/80 group-hover:text-primary transition-colors truncate flex items-center gap-1">
                                    {(es as any)[c.labelKey]}
                                    {channelKeys.includes(c.id) && <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold shrink-0">+ {es.acctAddAccount}</span>}
                                  </div>
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
            </div>}

            {/* ── Step 1: 前置准备 (hidden in account wizard mode) ── */}
            {!wizardAccount && <div className={`border rounded-xl overflow-hidden transition-colors ${stepActive(1) ? 'border-primary/40 bg-white dark:bg-white/[0.02]' : stepDone(1) ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5' : 'border-slate-200 dark:border-white/[0.06] opacity-50'}`}>
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
                    {chId && ['feishu', 'dingtalk', 'qqbot', 'yuanbao', 'msteams', 'zalo', 'voicecall', 'matrix', 'wecom', 'wecom_kf', 'openclaw-weixin'].includes(chId) && (() => {
                      const pluginSpec = chId === 'feishu' ? '@openclaw/feishu' :
                        chId === 'dingtalk' ? '@openclaw-china/dingtalk' :
                          chId === 'wecom' ? '@wecom/wecom-openclaw-plugin' :
                            chId === 'wecom_kf' ? '@openclaw-china/wecom-app' :
                              chId === 'openclaw-weixin' ? '@tencent-weixin/openclaw-weixin' :
                                chId === 'qqbot' ? '@openclaw/qqbot' :
                                  chId === 'yuanbao' ? 'openclaw-plugin-yuanbao@latest' :
                                  chId === 'msteams' ? '@openclaw/msteams' :
                                    chId === 'zalo' ? '@openclaw/zalo' :
                                      chId === 'matrix' ? '@openclaw/matrix' :
                                        chId === 'voicecall' ? '@openclaw/voice-call' : '';
                      const isInstalled = pluginInstalled[chId] === true;

                      // Still detecting — show a neutral "checking" pill so users
                      // cannot click "install" before the status is known (which
                      // would trigger a redundant reinstall of an already-present
                      // plugin).
                      if (pluginCheckInProgress && !isInstalled) {
                        return (
                          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06]">
                            <span className="material-symbols-outlined text-[14px] text-slate-500 animate-spin">progress_activity</span>
                            <p className="text-[10px] font-bold text-slate-600 dark:text-white/60">{cw.pluginChecking}</p>
                          </div>
                        );
                      }

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
                                    <div className={`px-2 py-1.5 rounded text-[10px] flex flex-col gap-1.5 ${pluginInstallResult.ok ? 'bg-green-100 dark:bg-green-500/10 text-green-600' : 'bg-red-100 dark:bg-red-500/10 text-red-500'}`}>
                                      <div className="flex items-center gap-1.5">
                                        {pluginInstallResult.ok ? (
                                          <>
                                            {pluginInstallResult.phase === 'restarting' && (
                                              <>
                                                <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                                                {pluginGatewayRecoveryView.label}
                                              </>
                                            )}
                                            {pluginInstallResult.phase === 'ready' && (
                                              <>
                                                <span className="material-symbols-outlined text-[12px]">check_circle</span>
                                                {pluginInstallResult.timedOut ? pluginGatewayRecoveryView.label : cw.pluginReady}
                                              </>
                                            )}
                                            {!pluginInstallResult.phase && cw.pluginInstallSuccess}
                                          </>
                                        ) : pluginInstallResult.msg}
                                      </div>
                                      {pluginInstallResult.ok && pluginInstallResult.phase === 'restarting' && (
                                        <div className="flex items-center gap-1 flex-wrap ps-4">
                                          {pluginGatewayRecoveryView.steps.map((step, i) => (
                                            <span key={step.key} className="contents">
                                              <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold ${
                                                step.ok ? 'text-green-600 dark:text-green-400' : step.active ? 'text-amber-500' : 'text-slate-400 dark:text-white/35'
                                              }`}>
                                                <span className={`material-symbols-outlined text-[10px] ${step.active && !step.ok ? 'animate-spin' : ''}`}>
                                                  {step.ok ? 'check_circle' : step.active ? 'progress_activity' : 'radio_button_unchecked'}
                                                </span>
                                                {step.label}
                                              </span>
                                              {i < pluginGatewayRecoveryView.steps.length - 1 && (
                                                <span className="material-symbols-outlined text-[8px] text-slate-400 dark:text-white/35 mx-0.5">chevron_right</span>
                                              )}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                      {pluginInstallResult.canForceRetry && pluginInstallResult.pendingSpec && pluginInstallResult.pendingChannelId && (
                                        pluginInstallResult.retryKind === 'security' ? (
                                          <div className="flex flex-col gap-1">
                                            <p className="text-[10px] text-red-600 dark:text-red-400 leading-snug">
                                              {cw.pluginSecurityWarning || '⚠️ The upstream installer blocked this plugin due to dangerous code patterns (often false-positive on plugin test files). Only proceed if you trust this plugin source.'}
                                            </p>
                                            <button
                                              onClick={async () => {
                                                const ok = await confirm({
                                                  title: cw.pluginForceUnsafeInstall || 'Force install',
                                                  message: cw.pluginForceUnsafeConfirm || 'This will install the plugin WITHOUT security scanning. Continue only if you trust the source. Proceed?',
                                                  danger: true,
                                                  confirmText: cw.pluginForceUnsafeInstall || 'Force install',
                                                });
                                                if (ok) handleInstallPlugin(pluginInstallResult.pendingSpec!, pluginInstallResult.pendingChannelId!, { dangerouslyForce: true });
                                              }}
                                              disabled={pluginInstalling}
                                              className="flex items-center justify-center gap-1 px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold transition-all disabled:opacity-50 self-start"
                                            >
                                              <span className="material-symbols-outlined text-[12px]">warning</span>
                                              {cw.pluginForceUnsafeInstall || 'Force install (skip security scan)'}
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => handleInstallPlugin(pluginInstallResult.pendingSpec!, pluginInstallResult.pendingChannelId!, { force: true })}
                                            disabled={pluginInstalling}
                                            className="flex items-center justify-center gap-1 px-2 py-1 rounded bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold transition-all disabled:opacity-50 self-start"
                                          >
                                            <span className="material-symbols-outlined text-[12px]">restart_alt</span>
                                            {cw.pluginForceReinstall || 'Force reinstall (uninstall residue first)'}
                                          </button>
                                        )
                                      )}
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
                        <pre className="text-[11px] text-slate-500 dark:text-white/40 bg-slate-100 dark:bg-black/20 p-2 rounded overflow-x-auto max-h-20 overflow-y-auto custom-scrollbar neon-scrollbar font-mono leading-relaxed select-text">{cw.feishuPermJson}</pre>
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
            </div>}

            {/* ── Step 2: 填写凭证 ── */}
            <div className={`border rounded-xl overflow-hidden transition-colors ${stepActive(2) ? 'border-primary/40 bg-white dark:bg-white/[0.02]' : stepDone(2) ? 'border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5' : 'border-slate-200 dark:border-white/[0.06] opacity-50'}`}>
              <div className={`flex items-center gap-2.5 px-4 py-3 ${stepDone(2) ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02]' : ''}`} onClick={() => stepDone(2) && setWizardStep(2)}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${stepDone(2) ? 'bg-green-500 text-white' : stepActive(2) ? 'bg-primary text-white' : 'bg-slate-200 dark:bg-white/10 text-slate-400'}`}>
                  {stepDone(2) ? <span className="material-symbols-outlined text-[14px]">check</span> : wizardAccount ? 1 : 3}
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
                    {/* QR login channels: show simplified hint instead of advanced config fields */}
                    {(chId === 'openclaw-weixin' || chId === 'whatsapp') ? (
                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-green-50 dark:bg-green-500/5 border border-green-200 dark:border-green-500/20">
                        <span className="material-symbols-outlined text-[18px] text-green-500 mt-0.5 shrink-0">qr_code_2</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-bold text-green-700 dark:text-green-400">
                            {chId === 'openclaw-weixin' ? (cw.weixinQrHint || 'This channel uses QR code scanning to connect — no credentials needed.') : (cw.whatsappQrHint || 'This channel uses QR code scanning to connect — no credentials needed.')}
                          </p>
                          <p className="text-[10px] text-green-600/70 dark:text-green-400/60 mt-1">
                            {cw.qrSaveFirstHint || 'Click Next to configure access control, then save and scan the QR code.'}
                          </p>
                        </div>
                      </div>
                    ) : renderChannelFields(chId, cfg, wizBasePath)}
                  </div>
                  {/* Test connection (non-QR channels only; QR login moved to Step 4 post-save) */}
                  {chId !== 'whatsapp' && chId !== 'openclaw-weixin' && (
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => handleWizardTest(chId, wizAcctKey)} disabled={wizTestStatus === 'testing'}
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
                  {/* Credential validation errors */}
                  {(() => {
                    const credErrors = getCredentialErrors(chId, cfg, es);
                    return credErrors.length > 0 ? (
                      <div className="mt-3 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 flex items-start gap-2">
                        <span className="material-symbols-outlined text-[14px] text-red-500 mt-0.5 shrink-0">error</span>
                        <div className="text-[10px] text-red-600 dark:text-red-400">
                          <span className="font-bold">{es.wizCredentialRequired || 'Required fields missing'}:</span>{' '}
                          {credErrors.join(', ')}
                        </div>
                      </div>
                    ) : null;
                  })()}
                  <div className="flex justify-between mt-3 pt-3 border-t border-slate-100 dark:border-white/[0.04]">
                    <button onClick={() => setWizardStep(1)}
                      className="px-4 py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-700 dark:hover:text-white/70 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">arrow_back</span> {cw.back}
                    </button>
                    <button
                      onClick={() => {
                        const credErrors = getCredentialErrors(chId, cfg, es);
                        if (credErrors.length > 0) {
                          toast('error', (es.wizCredentialRequired || 'Required fields missing') + ': ' + credErrors.join(', '));
                          return;
                        }
                        setWizardStep(3);
                      }}
                      className={`px-4 py-1.5 text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 ${getCredentialErrors(chId, cfg, es).length > 0 ? 'bg-slate-300 dark:bg-white/10 text-slate-500 dark:text-white/40 cursor-not-allowed' : 'bg-primary hover:bg-primary/90 text-white'}`}>
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
                  {stepDone(3) ? <span className="material-symbols-outlined text-[14px]">check</span> : wizardAccount ? 2 : 4}
                </div>
                <span className={`material-symbols-outlined text-[16px] ${stepDone(3) ? 'text-green-500' : stepActive(3) ? 'text-primary' : 'text-slate-400'}`}>shield</span>
                <div className="flex-1 min-w-0">
                  <span className={`text-xs font-bold ${stepActive(3) ? 'text-slate-800 dark:text-white' : 'text-slate-600 dark:text-white/60'}`}>{WIZARD_STEPS[3].label}</span>
                  {stepDone(3) && <p className="text-[10px] text-slate-400 dark:text-white/40 truncate">{dmPolicyText(getField([...(wizBasePath || ['channels', chId]), 'dmPolicy']) || 'pairing')}</p>}
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
                          <button key={opt.value} onClick={() => setField([...(wizBasePath || ['channels', chId]), 'dmPolicy'], opt.value)}
                            className={`p-2.5 rounded-lg border-2 text-start transition-all ${(getField([...(wizBasePath || ['channels', chId]), 'dmPolicy']) || 'pairing') === opt.value ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-slate-200 dark:border-white/10 hover:border-primary/40'}`}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className={`material-symbols-outlined text-[14px] ${(getField([...(wizBasePath || ['channels', chId]), 'dmPolicy']) || 'pairing') === opt.value ? 'text-primary' : 'text-slate-400 dark:text-white/40'}`}>{opt.icon}</span>
                              <span className="text-[11px] font-bold text-slate-700 dark:text-white/80">{opt.label}</span>
                            </div>
                            {opt.desc && <div className="text-[11px] text-slate-400 dark:text-white/35 leading-relaxed">{opt.desc}</div>}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-600 dark:text-white/60 mb-1.5 block">{es.allowFrom}</label>
                      <ArrayField label="" value={getField([...(wizBasePath || ['channels', chId]), 'allowFrom']) || []} onChange={v => setField([...(wizBasePath || ['channels', chId]), 'allowFrom'], v)} placeholder={es.tipAllowFromPh} />
                    </div>
                  </div>
                  {/* Access control warnings */}
                  {(() => {
                    const accessWarns = getAccessWarnings(chId, cfg, es);
                    return accessWarns.length > 0 ? (
                      <div className="mt-3 px-3 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 flex items-start gap-2">
                        <span className="material-symbols-outlined text-[14px] text-amber-500 mt-0.5 shrink-0">warning</span>
                        <div className="text-[10px] text-amber-700 dark:text-amber-400 space-y-1">
                          {accessWarns.map((w, i) => <p key={i}>{w}</p>)}
                        </div>
                      </div>
                    ) : null;
                  })()}
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
                    {showWebLogin ? (
                      /* ── QR Login (post-save) ── */
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-primary text-[18px]">qr_code_2</span>
                          <span className="text-[11px] font-bold text-slate-700 dark:text-white/80">
                            {chId === 'openclaw-weixin' ? (cw.weixinLogin || 'WeChat QR Login') : cw.whatsappLogin}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-white/50">
                          {chId === 'openclaw-weixin' ? (cw.weixinLoginDesc || 'Scan the QR code with WeChat to connect your account.') : cw.whatsappLoginDesc}
                        </p>
                        <button onClick={() => handleWebLogin(chId)} disabled={webLoginBusy}
                          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[11px] font-bold bg-green-500 hover:bg-green-600 text-white transition-all disabled:opacity-50">
                          <span className={`material-symbols-outlined text-[16px] ${webLoginBusy ? 'animate-spin' : ''}`}>
                            {webLoginBusy ? 'progress_activity' : 'qr_code_2'}
                          </span>
                          {webLoginBusy ? cw.generating : cw.generateQR}
                        </button>
                        {webLoginResult && (
                          <div className={`px-3 py-2.5 rounded-lg text-[10px] ${webLoginResult.ok ? 'bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-500/20' : 'bg-red-50 dark:bg-red-500/10 text-red-500 border border-red-200 dark:border-red-500/20'}`}>
                            <p className="font-bold">{webLoginResult.text}</p>
                            {webLoginResult.qrDataUrl && (
                              <div className="mt-2 flex flex-col items-center gap-2">
                                <img src={webLoginResult.qrDataUrl} alt="QR" className="w-48 h-48 rounded-lg border border-slate-200 dark:border-white/10" />
                                <a href={webLoginResult.qrDataUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 hover:underline break-all">{cw.openQrInBrowser || 'Open QR in browser'}</a>
                              </div>
                            )}
                            {webLoginResult.qr && (
                              <pre className="mt-2 p-2 bg-white dark:bg-black/20 rounded text-[9px] font-mono whitespace-pre overflow-x-auto">{webLoginResult.qr}</pre>
                            )}
                          </div>
                        )}
                      </div>
                    ) : !showPairing ? (
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
                    {showWebLogin ? (
                      <button onClick={() => {
                        setShowWebLogin(false);
                        const acctKey = wizardAccount || 'default';
                        const dmPolicy = getField(['channels', chId, 'accounts', acctKey, 'dmPolicy']) || 'pairing';
                        const requiresPairing = chId !== 'yuanbao' && dmPolicy === 'pairing';
                        if (requiresPairing) { setShowPairing(true); } else { resetWizard(); }
                      }}
                        className="px-5 py-1.5 bg-primary hover:bg-primary/90 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1">
                        {cw.next || es.done} <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </button>
                    ) : !showPairing ? (
                      <button onClick={() => handleFinishWizard(chId)} disabled={restarting}
                        className="px-5 py-1.5 bg-green-500 hover:bg-green-600 text-white text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50">
                        {restarting ? <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[14px]">check</span>}
                        {restarting ? (cw.restartingGateway || 'Restarting gateway...') : (cw.finish || es.done)}
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
      {/* 频道全局默认 / 按频道模型 / Matrix */}
      {/* ================================================================ */}
      <ConfigSection title={es.channelConfig} icon="settings" iconColor="text-slate-500" defaultOpen={false}>
        <SelectField label={es.groupMode} value={getField(['channels', 'defaults', 'groupPolicy']) || 'allowlist'} onChange={v => setField(['channels', 'defaults', 'groupPolicy'], v)} options={groupPolicy(es)} tooltip={tip('groupPolicy')} />
        <TextField label={es.chDefaultsContextVisibility || 'Context Visibility'} tooltip={schemaTooltip('channels.defaults.contextVisibility', language, schema)} value={getField(['channels', 'defaults', 'contextVisibility']) || ''} onChange={v => setField(['channels', 'defaults', 'contextVisibility'], v)} placeholder="full" />
        <SwitchField label={es.chDefaultsHeartbeatShowOk || 'Heartbeat: Show OK'} tooltip={schemaTooltip('channels.defaults.heartbeat.showOk', language, schema)} value={getField(['channels', 'defaults', 'heartbeat', 'showOk']) !== false} onChange={v => setField(['channels', 'defaults', 'heartbeat', 'showOk'], v)} />
        <SwitchField label={es.chDefaultsHeartbeatShowAlerts || 'Heartbeat: Show Alerts'} tooltip={schemaTooltip('channels.defaults.heartbeat.showAlerts', language, schema)} value={getField(['channels', 'defaults', 'heartbeat', 'showAlerts']) !== false} onChange={v => setField(['channels', 'defaults', 'heartbeat', 'showAlerts'], v)} />
        <SwitchField label={es.chDefaultsHeartbeatUseIndicator || 'Heartbeat: Use Indicator'} tooltip={schemaTooltip('channels.defaults.heartbeat.useIndicator', language, schema)} value={getField(['channels', 'defaults', 'heartbeat', 'useIndicator']) === true} onChange={v => setField(['channels', 'defaults', 'heartbeat', 'useIndicator'], v)} />
      </ConfigSection>

      <ConfigSection title={es.chModelByChannel || 'Model by Channel'} icon="tune" iconColor="text-indigo-500" defaultOpen={false}>
        <KeyValueField label={es.chModelByChannelKv || 'Channel → Model Override'} tooltip={schemaTooltip('channels.modelByChannel', language, schema)} value={getField(['channels', 'modelByChannel']) || {}} onChange={v => setField(['channels', 'modelByChannel'], v)} />
      </ConfigSection>

      <ConfigSection title={es.chMatrixConfig || 'Matrix Defaults'} icon="hub" iconColor="text-teal-500" defaultOpen={false}>
        <SwitchField label={es.chMatrixAllowBots || 'Allow Bot Messages'} tooltip={schemaTooltip('channels.matrix.allowBots', language, schema)} value={getField(['channels', 'matrix', 'allowBots']) === true} onChange={v => setField(['channels', 'matrix', 'allowBots'], v)} />
      </ConfigSection>

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
