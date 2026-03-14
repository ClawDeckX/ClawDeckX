
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gatewayApi, gwApi } from '../services/api';
import { subscribeManagerWS } from '../services/manager-ws';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import { copyToClipboard } from '../utils/clipboard';
import CustomSelect from '../components/CustomSelect';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import { ImageGallery } from '../components/ImageGallery';
import { ThinkingBlock } from '../components/ThinkingBlock';
import { ToolCallCard } from '../components/ToolCallCard';
import { UsagePanel } from '../components/UsagePanel';
import { extractImages, extractThinking, hasImages, hasThinking } from '../utils/content-blocks';
import { groupMessages, isFirstInGroup, isLastInGroup } from '../utils/message-grouping';

interface SessionsProps {
  language: Language;
  pendingSessionKey?: string | null;
  onSessionKeyConsumed?: () => void;
}

interface GwSession {
  key: string;
  label?: string;
  displayName?: string;
  kind?: string;
  lastActiveAt?: string;
  totalTokens?: number;
  lastMessagePreview?: string;
  model?: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  sendPolicy?: string;
  derivedTitle?: string;
  maxContextTokens?: number;
  compacted?: boolean;
  activeRun?: boolean;
  isStreaming?: boolean;
}

interface ChatMsg {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: unknown;
  timestamp?: number;
  usage?: { input?: number; output?: number; totalTokens?: number; inputTokens?: number; outputTokens?: number; cacheRead?: number; cost?: { total?: number } };
  cost?: { total?: number };
  model?: string;
  provider?: string;
  stopReason?: string;
}

type ChatRunPhase = 'idle' | 'sending' | 'streaming' | 'error';

function appendMessageDedup(
  prev: ChatMsg[],
  next: ChatMsg,
): ChatMsg[] {
  const text = extractText(next.content);
  const ts = next.timestamp || 0;
  const duplicated = prev.some((m) => {
    if (m.role !== next.role) return false;
    const mt = m.timestamp || 0;
    if (ts && mt && Math.abs(mt - ts) > 2000) return false;
    return extractText(m.content) === text;
  });
  return duplicated ? prev : [...prev, next];
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (typeof block === 'string') return block;
        if (block?.type === 'text' && typeof block.text === 'string') return block.text;
        if (block?.type === 'tool_use') return `[${block.name || 'tool'}](...)`;
        if (block?.type === 'tool_result') return typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    const c = content as any;
    if (typeof c.text === 'string') return c.text;
    if (typeof c.content === 'string') return c.content;
  }
  return '';
}

function extractToolCalls(content: unknown): Array<{ id?: string; name: string; input?: string }> {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: any) => b?.type === 'tool_use')
    .map((b: any) => ({ id: b.id, name: b.name || 'tool', input: b.input ? JSON.stringify(b.input, null, 2) : undefined }));
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === 'tool_result' || b?.type === 'text')
      .map((b: any) => b?.text || (typeof b?.content === 'string' ? b.content : JSON.stringify(b?.content)))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function fmtTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const Sessions: React.FC<SessionsProps> = ({ language, pendingSessionKey, onSessionKeyConsumed }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const c = t.chat as any;
  const sessionDefault = (t as any).dash?.sessionDefault || c.sessionKey;
  const { toast } = useToast();
  const { confirm } = useConfirm();

  // Shared Manager WS subscription for chat streaming events
  const handleChatEventRef = useRef<(payload?: any) => void>(() => { });
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsConnecting, setWsConnecting] = useState(true);
  const [gwReady, setGwReady] = useState(false);
  const [gwChecked, setGwChecked] = useState(false);
  const lastGwReconnectAtRef = useRef(0);

  // Sessions — restore from sessionStorage for instant display
  const [sessions, setSessions] = useState<GwSession[]>(() => {
    try {
      const cached = sessionStorage.getItem('clawdeck-sessions-cache');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [initialDetecting, setInitialDetecting] = useState(false);
  const hasStartedInitialDetectingRef = useRef(false);
  const [sessionKey, setSessionKey] = useState('main');
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Talk mode (real-time event)
  const [talkMode, setTalkMode] = useState<string | null>(null);

  // Session history cleared notice (when navigating from Usage to a deleted/reset session)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  // Handle pending session key from cross-window navigation
  useEffect(() => {
    if (pendingSessionKey && pendingSessionKey !== sessionKey) {
      // Check if session exists in the list
      const exists = sessions.some(s => s.key === pendingSessionKey);
      setSessionKey(pendingSessionKey);
      setDrawerOpen(false);
      if (!exists && sessions.length > 0) {
        // Session not found - show notice to user
        setSessionNotice(c.sessionHistoryCleared);
      }
      onSessionKeyConsumed?.();
    }
  }, [pendingSessionKey, sessionKey, sessions, onSessionKeyConsumed, c]);

  // Chat
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [stream, setStream] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runPhase, setRunPhase] = useState<ChatRunPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const pendingRunRef = useRef<{ runId: string; beforeCount: number; startedAt: number } | null>(null);

  // --- New state for optimizations ---
  // Sidebar search
  const [sidebarSearch, setSidebarSearch] = useState('');
  // Input history (↑ key recall)
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  // Drafts per session (localStorage)
  const draftsRef = useRef<Record<string, string>>({});
  // Scroll to bottom visibility
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Long message expand state
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set());
  // Sidebar collapse (desktop)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Unread messages per session
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  // Stream throttle ref
  const streamTextRef = useRef('');
  const streamRafRef = useRef<number | null>(null);
  // Latency tracking
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [liveElapsed, setLiveElapsed] = useState<number>(0);
  // File/image attachments
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ dataUrl: string; mimeType: string; fileName: string; isImage: boolean; fileSize: number }>>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Message feedback
  const [feedbackMap, setFeedbackMap] = useState<Record<number, 'up' | 'down'>>({});
  // Message search
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  const [msgSearchQuery, setMsgSearchQuery] = useState('');
  const msgSearchRef = useRef<HTMLInputElement>(null);
  // Message context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; idx: number; text: string; isUser: boolean } | null>(null);
  // Reconnect banner
  const [showReconnectBanner, setShowReconnectBanner] = useState(false);
  const wasConnectedRef = useRef(false);

  // Session override settings panel
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [patchBusy, setPatchBusy] = useState(false);
  const [savedField, setSavedField] = useState<string | null>(null);

  // Inject system message
  const [injectOpen, setInjectOpen] = useState(false);
  const [injectMsg, setInjectMsg] = useState('');
  const [injectLabel, setInjectLabel] = useState('');
  const [injecting, setInjecting] = useState(false);
  const [injectResult, setInjectResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Resolve & Compact
  const [resolving, setResolving] = useState(false);
  const [resolveResult, setResolveResult] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Session repair
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairScanning, setRepairScanning] = useState(false);
  const [repairIssues, setRepairIssues] = useState<{ key: string; label: string; type: 'overflow' | 'stale'; detail: string }[]>([]);
  const [repairFixing, setRepairFixing] = useState(false);

  // Session actions (rename, delete)
  const [sessionMenuKey, setSessionMenuKey] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameKey, setRenameKey] = useState('');
  const [renameLabel, setRenameLabel] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Slash command popup
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashHighlight, setSlashHighlight] = useState(0);
  const slashRef = useRef<HTMLDivElement>(null);

  // Highlight search matches in text
  const highlightSearch = useCallback((text: string): React.ReactNode => {
    if (!msgSearchQuery || msgSearchQuery.length < 2) return text;
    const q = msgSearchQuery.toLowerCase();
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return text;
    const parts: React.ReactNode[] = [];
    let pos = 0;
    let searchIdx = text.toLowerCase().indexOf(q, pos);
    while (searchIdx !== -1) {
      if (searchIdx > pos) parts.push(text.slice(pos, searchIdx));
      parts.push(<mark key={searchIdx} className="bg-yellow-300/80 dark:bg-yellow-500/40 text-inherit rounded-sm px-0.5">{text.slice(searchIdx, searchIdx + msgSearchQuery.length)}</mark>);
      pos = searchIdx + msgSearchQuery.length;
      searchIdx = text.toLowerCase().indexOf(q, pos);
    }
    if (pos < text.length) parts.push(text.slice(pos));
    return <>{parts}</>;
  }, [msgSearchQuery]);

  const SLASH_COMMANDS = useMemo(() => [
    { cmd: '/help', desc: c.quickHelp, icon: 'help', cat: 'status' },
    { cmd: '/status', desc: c.quickStatus, icon: 'info', cat: 'status' },
    { cmd: '/model', desc: c.quickModel, icon: 'smart_toy', cat: 'options' },
    { cmd: '/think', desc: c.quickThink, icon: 'psychology', cat: 'options' },
    { cmd: '/verbose', desc: c.catOptions, icon: 'visibility', cat: 'options' },
    { cmd: '/reasoning', desc: c.catOptions, icon: 'neurology', cat: 'options' },
    { cmd: '/compact', desc: c.quickCompact, icon: 'compress', cat: 'session' },
    { cmd: '/new', desc: c.quickReset, icon: 'add_circle', cat: 'session' },
    { cmd: '/reset', desc: c.quickReset, icon: 'restart_alt', cat: 'session' },
    { cmd: '/abort', desc: c.abort, icon: 'stop_circle', cat: 'session' },
    { cmd: '/stop', desc: c.stop, icon: 'pause_circle', cat: 'session' },
    { cmd: '/usage', desc: c.tokens, icon: 'data_usage', cat: 'status' },
    { cmd: '/context', desc: c.catStatus, icon: 'memory', cat: 'status' },
    { cmd: '/whoami', desc: c.catStatus, icon: 'badge', cat: 'status' },
    { cmd: '/commands', desc: c.slashCommands, icon: 'terminal', cat: 'status' },
    { cmd: '/config', desc: c.catManagement, icon: 'settings', cat: 'management' },
    { cmd: '/elevated', desc: c.catOptions, icon: 'admin_panel_settings', cat: 'options' },
    { cmd: '/activation', desc: c.catManagement, icon: 'notifications_active', cat: 'management' },
    { cmd: '/tts', desc: c.catMedia, icon: 'record_voice_over', cat: 'media' },
    { cmd: '/skill', desc: c.catTools, icon: 'extension', cat: 'tools' },
    { cmd: '/subagents', desc: c.catManagement, icon: 'group', cat: 'management' },
    { cmd: '/restart', desc: c.catTools, icon: 'refresh', cat: 'tools' },
    { cmd: '/bash', desc: c.catTools, icon: 'terminal', cat: 'tools' },
  ], [c]);

  const slashFiltered = useMemo(() => {
    if (!slashOpen) return [];
    const q = input.slice(1).toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(s => s.cmd.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q));
  }, [slashOpen, input, SLASH_COMMANDS]);

  const CAT_LABELS: Record<string, string> = useMemo(() => ({
    session: c.catSession, options: c.catOptions, status: c.catStatus,
    tools: c.catTools, management: c.catManagement, media: c.catMedia, docks: c.catDocks,
  }), [c]);
  const runPhaseMeta = useMemo(() => {
    if (runPhase === 'sending') {
      return {
        text: c.runSending || '发送中',
        dot: 'bg-amber-400',
        textClass: 'text-amber-500',
      };
    }
    if (runPhase === 'streaming') {
      return {
        text: c.runStreaming || '流式回复',
        dot: 'bg-primary animate-pulse',
        textClass: 'text-primary',
      };
    }
    if (runPhase === 'error') {
      return {
        text: c.runError || '异常',
        dot: 'bg-red-500',
        textClass: 'text-red-500',
      };
    }
    return {
      text: c.runIdle || '空闲',
      dot: 'bg-mac-green',
      textClass: 'text-mac-green',
    };
  }, [runPhase, c.runSending, c.runStreaming, c.runError, c.runIdle]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = runPhase === 'streaming';
  const renderedMessages = useMemo(() => messages.slice(-200), [messages]);
  const omittedMessageCount = Math.max(0, messages.length - renderedMessages.length);
  const msgGroups = useMemo(() => groupMessages(renderedMessages), [renderedMessages]);

  // Check GW proxy connectivity + connect Manager WS for chat streaming events
  useEffect(() => {
    setWsConnecting(true);
    setWsError(null);
    setGwChecked(false);

    // 1) Check GW proxy is reachable via REST
    const refreshGwReady = () => {
      Promise.allSettled([gwApi.status(), gatewayApi.status()]).then(([rpc, svc]) => {
        const rpcConnected = rpc.status === 'fulfilled' && !!(rpc.value as any)?.connected;
        const gatewayRunning = svc.status === 'fulfilled' && !!(svc.value as any)?.running;
        const ready = rpcConnected || gatewayRunning;
        setGwReady(ready);
        setGwChecked(true);

        // Self-heal: gateway process is up but GW WS client is disconnected.
        if (!rpcConnected && gatewayRunning) {
          const now = Date.now();
          if (now - lastGwReconnectAtRef.current > 10000) {
            lastGwReconnectAtRef.current = now;
            void gwApi.reconnect().catch(() => { /* ignore */ });
          }
        }

        if (!ready) {
          setWsError(c.configMissing);
          // Once GW check finished AND is not ready, stop showing "connecting" spinner
          setWsConnecting(false);
          return;
        }
        // Clear ALL errors when gateway is reachable (not just configMissing).
        setWsError(null);
      }).catch(() => {
        setGwReady(false);
        setGwChecked(true);
        setWsConnecting(false);
        setWsError(c.configMissing);
      });
    };
    refreshGwReady();
    let gwTimer: ReturnType<typeof setInterval> | null = setInterval(refreshGwReady, 5000);
    const onVisibility = () => {
      if (document.hidden) {
        if (gwTimer) { clearInterval(gwTimer); gwTimer = null; }
      } else {
        if (!gwTimer) {
          gwTimer = setInterval(refreshGwReady, 5000);
          refreshGwReady();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // 2) Subscribe to shared Manager WS for real-time chat streaming events
    let opened = false;
    const connectTimeout = setTimeout(() => {
      if (!opened) {
        // Only clear connecting state; don't set wsError here.
        // The GW REST check is the source of truth for connectivity.
        setWsConnecting(false);
      }
    }, 10000);

    const unsubscribe = subscribeManagerWS((msg: any) => {
      try {
        if (msg.type === 'chat' || msg.type === 'session.message') {
          handleChatEventRef.current(msg.data);
        } else if (msg.type === 'talk.mode') {
          // Gateway payload: { enabled: boolean, phase?: string, ts: number }
          const d = msg.data;
          setTalkMode(d?.enabled ? (d.phase || 'listening') : null);
        }
      } catch { /* ignore */ }
    }, (status) => {
      if (status === 'open') {
        opened = true;
        clearTimeout(connectTimeout);
        setWsConnected(true);
        setWsConnecting(false);
        setWsError(null);
      } else if (status === 'closed') {
        setWsConnected(false);
      }
    });

    return () => {
      clearTimeout(connectTimeout);
      if (gwTimer) clearInterval(gwTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubscribe();
    };
  }, [c.configMissing, c.wsError]);

  // Chat event handler (streaming) - defined before useEffect to avoid closure issues
  const handleChatEvent = useCallback((payload?: any) => {
    if (!payload) return;
    // Only handle events for the current session
    const eventSessionKey = payload.sessionKey || payload.key;
    if (eventSessionKey && eventSessionKey !== sessionKeyRef.current) return;

    // session.message style payload (without state)
    if (!payload.state && (payload.role || payload.message?.role)) {
      const msg = payload.message || payload;
      const text = extractText(msg?.content ?? msg);
      if (text.trim()) {
        setMessages(prev => appendMessageDedup(prev, {
          role: (msg.role || 'assistant') as ChatMsg['role'],
          content: msg.content ?? [{ type: 'text', text }],
          timestamp: msg.timestamp || Date.now(),
        }));
        if ((msg.role || 'assistant') === 'assistant') {
          setRunId(null);
          setStream(null);
          setRunPhase('idle');
          setError(null);
          pendingRunRef.current = null;
        }
      }
      return;
    }

    if (payload.state === 'delta') {
      // Gateway sends: message: { role, content: [{ type: 'text', text }], timestamp }
      const msg = payload.message as any;
      const text = extractText(msg?.content ?? msg);
      if (typeof text === 'string' && text.trim().length > 0) {
        throttledSetStream(text);
        setRunPhase('streaming');
      }
    } else if (payload.state === 'final') {
      // Add final message directly from the event payload
      const msg = payload.message as any;
      if (msg) {
        const text = extractText(msg?.content ?? msg);
        if (text.trim()) {
          setMessages(prev => appendMessageDedup(prev, {
            role: (msg.role || 'assistant') as ChatMsg['role'],
            content: msg.content ?? [{ type: 'text', text }],
            timestamp: msg.timestamp || Date.now(),
          }));
        }
      }
      setStream(null);
      setRunId(null);
      setRunPhase('idle');
      setError(null);
      if (pendingRunRef.current?.startedAt) setLastLatencyMs(Date.now() - pendingRunRef.current.startedAt);
      pendingRunRef.current = null;
    } else if (payload.state === 'aborted') {
      // If there was partial stream text, keep it as a message
      setStream(prev => {
        if (prev) {
          setMessages(msgs => appendMessageDedup(msgs, {
            role: 'assistant',
            content: [{ type: 'text', text: prev }],
            timestamp: Date.now(),
          }));
        }
        return null;
      });
      setRunId(null);
      setRunPhase('idle');
      setError(null);
      pendingRunRef.current = null;
    } else if (payload.state === 'error') {
      setStream(null);
      setRunId(null);
      setRunPhase('error');
      pendingRunRef.current = null;
      setError(payload.errorMessage || c.error);
    }
  }, [c.error]);

  // Keep ref updated with latest handler
  useEffect(() => {
    handleChatEventRef.current = handleChatEvent;
  }, [handleChatEvent]);

  // Live elapsed timer during streaming
  useEffect(() => {
    if (runPhase !== 'streaming' && runPhase !== 'sending') {
      setLiveElapsed(0);
      return;
    }
    const started = pendingRunRef.current?.startedAt || Date.now();
    const tick = () => setLiveElapsed(Date.now() - started);
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [runPhase]);

  // Load sessions list (via REST proxy)
  const loadSessions = useCallback(async () => {
    if (!gwReady) return;
    setSessionsLoading(true);
    try {
      const res = await gwApi.proxy('sessions.list', {
        activeMinutes: 1440,
        limit: 50,
        includeDerivedTitles: true,
        includeLastMessage: true,
      }) as any;
      // Gateway returns { sessions: [...] }
      const list = Array.isArray(res?.sessions) ? res.sessions : [];
      const mapped = list.map((s: any) => ({
        key: s.key || s.id || '',
        label: s.derivedTitle || s.label || s.displayName || s.key || '',
        kind: s.chatType || s.kind || '',
        lastActiveAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : '',
        totalTokens: s.totalTokens || 0,
        lastMessagePreview: s.lastMessagePreview || '',
        model: s.model || '',
        modelProvider: s.modelProvider || '',
        inputTokens: s.inputTokens || 0,
        outputTokens: s.outputTokens || 0,
        thinkingLevel: s.thinkingLevel || '',
        verboseLevel: s.verboseLevel || '',
        reasoningLevel: s.reasoningLevel || '',
        sendPolicy: s.sendPolicy || '',
        derivedTitle: s.derivedTitle || '',
        maxContextTokens: s.maxContextTokens || s.contextWindow || s.maxTokens || 0,
        compacted: !!s.compacted,
      }));
      setSessions(mapped);
      // Persist to sessionStorage for instant display on next window open
      try { sessionStorage.setItem('clawdeck-sessions-cache', JSON.stringify(mapped)); } catch { /* ignore */ }
    } catch { /* ignore */ }
    finally { setSessionsLoading(false); }
  }, [gwReady]);

  // Track message count via ref to avoid loadHistory dependency on messages array
  const messagesLenRef = useRef(0);
  messagesLenRef.current = messages.length;

  // Load chat history (via REST proxy)
  const loadHistory = useCallback(async (opts?: { silent?: boolean }) => {
    if (!gwReady) return;
    // Only show loading spinner on first load (no existing messages)
    const showSpinner = !opts?.silent && messagesLenRef.current === 0;
    if (showSpinner) setChatLoading(true);
    try {
      const res = await gwApi.proxy('chat.history', { sessionKey, limit: 200 }) as any;
      const msgs = Array.isArray(res?.messages) ? res.messages : [];
      setMessages(msgs.map((m: any) => ({
        role: m.role || 'assistant',
        content: m.content,
        timestamp: m.timestamp || m.ts,
        ...(m.usage ? { usage: m.usage } : {}),
        ...(m.cost ? { cost: m.cost } : {}),
        ...(m.model ? { model: m.model } : {}),
        ...(m.provider ? { provider: m.provider } : {}),
        ...(m.stopReason ? { stopReason: m.stopReason } : {}),
      })));
    } catch {
      setMessages([]);
    } finally {
      if (showSpinner) setChatLoading(false);
    }
  }, [gwReady, sessionKey]);

  // On ready: load history first (user-visible), then sessions list (sidebar has cache).
  useEffect(() => {
    if (!gwReady) return;
    if (!hasStartedInitialDetectingRef.current) {
      hasStartedInitialDetectingRef.current = true;
      setInitialDetecting(true);
      // Priority: show chat history ASAP, then refresh sidebar sessions
      loadHistory().finally(() => {
        setInitialDetecting(false);
        loadSessions();
      });
    } else {
      loadSessions();
    }
    let timer: ReturnType<typeof setInterval> | null = setInterval(loadSessions, 30000);
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) { clearInterval(timer); timer = null; }
      } else {
        if (!timer) {
          timer = setInterval(loadSessions, 30000);
          loadSessions();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [gwReady, loadSessions, loadHistory]);

  // Load chat history only when selected session changes.
  useEffect(() => {
    if (gwReady && hasStartedInitialDetectingRef.current) {
      loadHistory();
    }
  }, [gwReady, sessionKey, loadHistory]);

  // Fallback reconciliation: if stream events are missing, poll history until assistant reply appears.
  useEffect(() => {
    if (!gwReady || !runId) return;
    const timer = setInterval(async () => {
      const pending = pendingRunRef.current;
      if (!pending || pending.runId !== runId) return;
      await loadHistory({ silent: true });
      setMessages((prev) => {
        const latest = prev[prev.length - 1];
        const hasAssistantReply = prev.length > pending.beforeCount && latest?.role === 'assistant';
        if (hasAssistantReply) {
          setRunId(null);
          setStream(null);
          setRunPhase('idle');
          pendingRunRef.current = null;
        } else if (Date.now() - pending.startedAt > 90000) {
          setRunId(null);
          setStream(null);
          setRunPhase('error');
          pendingRunRef.current = null;
          setError(c.error);
        }
        return prev;
      });
    }, 1500);
    return () => clearInterval(timer);
  }, [gwReady, runId, loadHistory, c.error]);

  // Safety net: if stream is empty string for too long without receiving events, reset to idle.
  // This prevents the "Generating..." indicator from getting stuck when final event is missed.
  useEffect(() => {
    if (stream !== '' || runPhase !== 'streaming') return;
    const timer = setTimeout(() => {
      setStream(prev => {
        if (prev === '') {
          setRunPhase('idle');
          setRunId(null);
          pendingRunRef.current = null;
          return null;
        }
        return prev;
      });
    }, 8000);
    return () => clearTimeout(timer);
  }, [stream, runPhase]);

  // Auto-scroll + scroll-to-bottom detection
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
  }, [messages, stream]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distFromBottom > 200);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Draft save on session switch
  useEffect(() => {
    try {
      const saved = localStorage.getItem('clawdeck-chat-drafts');
      if (saved) draftsRef.current = JSON.parse(saved);
    } catch { /* ignore */ }
  }, []);
  const saveDraft = useCallback((key: string, text: string) => {
    if (text.trim()) {
      draftsRef.current[key] = text;
    } else {
      delete draftsRef.current[key];
    }
    try { localStorage.setItem('clawdeck-chat-drafts', JSON.stringify(draftsRef.current)); } catch { /* ignore */ }
  }, []);
  const loadDraft = useCallback((key: string) => {
    return draftsRef.current[key] || '';
  }, []);

  // Reconnect banner
  useEffect(() => {
    if (gwReady) {
      if (wasConnectedRef.current === false && wasConnectedRef.current !== undefined) {
        // Was disconnected, now reconnected — hide banner after brief flash
        setShowReconnectBanner(false);
      }
      wasConnectedRef.current = true;
    } else if (wasConnectedRef.current) {
      setShowReconnectBanner(true);
    }
  }, [gwReady]);

  // Unread tracking: increment for non-active sessions on new messages via WS
  const prevMessagesLenRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMessagesLenRef.current && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.role === 'assistant') {
        // Mark other sessions as potentially having unread (simplified — real impl would track per-session via WS events)
      }
    }
    prevMessagesLenRef.current = messages.length;
  }, [messages]);

  // Sidebar: filtered + grouped sessions
  const filteredSessions = useMemo(() => {
    if (!sidebarSearch) return sessions;
    const q = sidebarSearch.toLowerCase();
    return sessions.filter(s => 
      (s.label || '').toLowerCase().includes(q) ||
      (s.key || '').toLowerCase().includes(q) ||
      (s.lastMessagePreview || '').toLowerCase().includes(q)
    );
  }, [sessions, sidebarSearch]);

  const groupedSessions = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const weekAgo = today - 7 * 86400000;
    const groups: Array<{ label: string; items: GwSession[] }> = [
      { label: c.groupToday || 'Today', items: [] },
      { label: c.groupYesterday || 'Yesterday', items: [] },
      { label: c.groupThisWeek || 'This Week', items: [] },
      { label: c.groupEarlier || 'Earlier', items: [] },
    ];
    for (const s of filteredSessions) {
      const ts = s.lastActiveAt ? new Date(s.lastActiveAt).getTime() : 0;
      if (ts >= today) groups[0].items.push(s);
      else if (ts >= yesterday) groups[1].items.push(s);
      else if (ts >= weekAgo) groups[2].items.push(s);
      else groups[3].items.push(s);
    }
    return groups.filter(g => g.items.length > 0);
  }, [filteredSessions, c]);

  // Stream throttle: batch rapid setStream updates into 50ms frames
  const throttledSetStream = useCallback((text: string) => {
    streamTextRef.current = text;
    if (streamRafRef.current === null) {
      streamRafRef.current = window.requestAnimationFrame(() => {
        setStream(streamTextRef.current);
        streamRafRef.current = null;
      });
    }
  }, []);

  // Read file as data URL (for attachments)
  const readFileAsDataUrl = useCallback((file: File): Promise<{ dataUrl: string; mimeType: string; fileName: string; isImage: boolean; fileSize: number }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result as string, mimeType: file.type || 'application/octet-stream', fileName: file.name, isImage: file.type.startsWith('image/'), fileSize: file.size });
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  // Handle paste (intercept pasted files/images)
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const file = items[i].getAsFile();
      if (file && (items[i].type.startsWith('image/') || items[i].type.startsWith('application/') || items[i].type.startsWith('text/'))) {
        pastedFiles.push(file);
      }
    }
    if (pastedFiles.length === 0) return;
    e.preventDefault();
    const results = await Promise.all(pastedFiles.map(readFileAsDataUrl));
    setPendingAttachments(prev => [...(prev || []), ...results].slice(0, 5));
  }, [readFileAsDataUrl]);

  // Handle file input change
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const validFiles = Array.from(files).filter(f => f.size <= MAX_FILE_SIZE);
    const results = await Promise.all(validFiles.map(readFileAsDataUrl));
    setPendingAttachments(prev => [...(prev || []), ...results].slice(0, 5));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [readFileAsDataUrl]);

  // Remove pending attachment
  const removePendingAttachment = useCallback((idx: number) => {
    setPendingAttachments(prev => (prev || []).filter((_, i) => i !== idx));
  }, []);

  // Send message (via REST proxy; streaming events come via Manager WS)
  const sendMessage = useCallback(async () => {
    if (!gwReady || sending || isStreaming) return;
    const msg = input.trim();
    const attachments_ = pendingAttachments || [];
    if (!msg && attachments_.length === 0) return;

    // Track input history for ↑ recall
    if (msg) {
      setInputHistory(prev => [msg, ...prev.slice(0, 49)]);
      setHistoryIdx(-1);
    }
    saveDraft(sessionKey, '');

    // Build optimistic user message content blocks
    const contentBlocks: Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> = [];
    if (msg) contentBlocks.push({ type: 'text', text: msg });
    for (const att of attachments_) {
      if (att.isImage) {
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: att.mimeType, data: att.dataUrl } });
      } else {
        contentBlocks.push({ type: 'text', text: `📎 ${att.fileName}` });
      }
    }
    setMessages(prev => [...prev, { role: 'user', content: contentBlocks.length === 1 && contentBlocks[0].type === 'text' ? contentBlocks : contentBlocks, timestamp: Date.now() }]);

    // Build attachments for API
    const attachments = attachments_.map(att => ({
      type: att.isImage ? 'image' as const : 'file' as const,
      mimeType: att.mimeType,
      fileName: att.fileName,
      content: att.dataUrl,
    }));

    setInput('');
    setPendingAttachments([]);
    setSending(true);
    setRunPhase('sending');
    setError(null);
    setStream('');

    const idempotencyKey = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    try {
      const res = await gwApi.proxy('chat.send', {
        sessionKey,
        message: msg,
        idempotencyKey,
        ...(attachments.length > 0 ? { attachments } : {}),
      }) as any;
      const nextRunId = res?.runId || idempotencyKey;
      setRunId(nextRunId);
      setRunPhase('streaming');
      setError(null);
      pendingRunRef.current = {
        runId: nextRunId,
        beforeCount: messages.length + 1,
        startedAt: Date.now(),
      };
    } catch (err: any) {
      setStream(null);
      setRunPhase('error');
      setError(err?.message || c.error);
      setMessages(prev => [...prev, { role: 'assistant', content: [{ type: 'text', text: 'Error: ' + (err?.message || c.error) }], timestamp: Date.now() }]);
      pendingRunRef.current = null;
      // If gateway connection just flapped, force a status refresh sooner.
      gwApi.status().then((res: any) => {
        if (res?.connected) setGwReady(true);
      }).catch(() => { /* ignore */ });
    } finally {
      setSending(false);
    }
  }, [gwReady, input, sending, isStreaming, sessionKey, messages.length, c.error, pendingAttachments]);

  // Abort (via REST proxy)
  const handleAbort = useCallback(async () => {
    if (!gwReady) return;
    try {
      await gwApi.proxy('chat.abort', { sessionKey, runId: runId || undefined });
    } catch { /* ignore */ }
    setRunId(null);
    setStream(null);
    setRunPhase('idle');
    setError(null);
    pendingRunRef.current = null;
  }, [gwReady, sessionKey, runId]);

  // Copy message
  const handleCopy = useCallback((idx: number, text: string) => {
    copyToClipboard(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    }).catch(() => {});
  }, []);

  // Inject system message (via REST proxy)
  const handleInject = useCallback(async () => {
    if (!gwReady || injecting) return;
    const msg = injectMsg.trim();
    if (!msg) return;
    setInjecting(true);
    setInjectResult(null);
    try {
      await gwApi.proxy('chat.inject', {
        sessionKey,
        message: msg,
        label: injectLabel.trim() || undefined,
      });
      setInjectResult({ ok: true, text: c.injectOk });
      setInjectMsg('');
      setInjectLabel('');
      // Add injected message to local chat view
      setMessages(prev => appendMessageDedup(prev, {
        role: 'assistant' as const,
        content: [{ type: 'text', text: (injectLabel.trim() ? `[${injectLabel.trim()}]\n\n` : '') + msg }],
        timestamp: Date.now(),
      }));
      setTimeout(() => { setInjectOpen(false); setInjectResult(null); }, 1200);
    } catch (err: any) {
      setInjectResult({ ok: false, text: `${c.injectFailed}: ${err?.message || ''}` });
    }
    setInjecting(false);
  }, [gwReady, sessionKey, injectMsg, injectLabel, injecting]);

  // Resolve session key (via REST proxy)
  const handleResolve = useCallback(async () => {
    if (!gwReady || resolving || !sessionKey.trim()) return;
    setResolving(true);
    setResolveResult(null);
    try {
      const res = await gwApi.sessionsResolve(sessionKey.trim()) as any;
      setResolveResult(res?.key || sessionKey);
      if (res?.key && res.key !== sessionKey) setSessionKey(res.key);
    } catch { /* ignore */ }
    setResolving(false);
  }, [gwReady, sessionKey, resolving]);

  // Compact session (via REST proxy)
  const handleCompact = useCallback(async () => {
    if (!gwReady || compacting || !sessionKey.trim()) return;
    setCompacting(true);
    setCompactResult(null);
    try {
      await gwApi.sessionsCompact(sessionKey.trim());
      setCompactResult({ ok: true, text: c.compactOk });
      setTimeout(() => setCompactResult(null), 3000);
    } catch (err: any) {
      setCompactResult({ ok: false, text: `${c.compactFailed}: ${err?.message || ''}` });
    }
    setCompacting(false);
  }, [gwReady, sessionKey, compacting, c]);

  // Session repair: scan all sessions for issues
  const handleRepairScan = useCallback(async () => {
    setRepairScanning(true);
    setRepairIssues([]);
    try {
      const res = await gwApi.sessions() as any[];
      const list: GwSession[] = Array.isArray(res) ? res : [];
      const issues: { key: string; label: string; type: 'overflow' | 'stale'; detail: string }[] = [];
      const now = Date.now();
      for (const s of list) {
        const label = s.derivedTitle || s.label || s.displayName || s.key || s.key;
        const maxCtx = s.maxContextTokens || (s as any).contextWindow || (s as any).maxTokens || 0;
        const total = s.totalTokens || 0;
        if (maxCtx > 0 && total > 0) {
          const pct = Math.min(100, (total / maxCtx) * 100);
          if (pct > 85) {
            issues.push({ key: s.key, label, type: 'overflow', detail: (c.repairContextOverflow || '').replace('{{pct}}', pct.toFixed(0)) });
          }
        }
        const lastActive = s.lastActiveAt ? new Date(s.lastActiveAt).getTime() : 0;
        if (lastActive > 0) {
          const days = Math.floor((now - lastActive) / 86400000);
          if (days > 14 && s.key !== 'main') {
            issues.push({ key: s.key, label, type: 'stale', detail: (c.repairStale || '').replace('{{days}}', String(days)) });
          }
        }
      }
      setRepairIssues(issues);
    } catch { /* ignore */ }
    setRepairScanning(false);
  }, [c]);

  const handleRepairCompactAll = useCallback(async () => {
    const overflow = repairIssues.filter(i => i.type === 'overflow');
    if (overflow.length === 0) return;
    setRepairFixing(true);
    let fixed = 0;
    for (const issue of overflow) {
      try { await gwApi.sessionsCompact(issue.key); fixed++; } catch { /* skip */ }
    }
    toast('success', (c.repairFixed || '').replace('{{n}}', String(fixed)));
    setRepairIssues(prev => prev.filter(i => i.type !== 'overflow'));
    setRepairFixing(false);
    loadSessions();
  }, [repairIssues, c, toast, loadSessions]);

  const handleRepairDeleteStale = useCallback(async () => {
    const stale = repairIssues.filter(i => i.type === 'stale');
    if (stale.length === 0) return;
    const ok = await confirm({
      title: c.confirmDeleteSession || 'Delete',
      message: (c.confirmDeleteSessionMsg || 'Delete {count} stale sessions?').replace('{count}', String(stale.length)),
      confirmText: c.deleteSession || 'Delete',
      danger: true,
    });
    if (!ok) return;
    setRepairFixing(true);
    let fixed = 0;
    for (const issue of stale) {
      try { await gwApi.sessionsDelete(issue.key); fixed++; } catch { /* skip */ }
    }
    toast('success', (c.repairFixed || '').replace('{{n}}', String(fixed)));
    setRepairIssues(prev => prev.filter(i => i.type !== 'stale'));
    setRepairFixing(false);
    loadSessions();
  }, [repairIssues, c, toast, loadSessions, confirm]);

  // Select session
  const selectSession = useCallback((key: string) => {
    // Save current draft before switching
    saveDraft(sessionKey, input);
    setSessionKey(key);
    setMessages([]);
    setStream(null);
    setRunId(null);
    setRunPhase('idle');
    pendingRunRef.current = null;
    setDrawerOpen(false);
    // Restore draft for new session
    setInput(loadDraft(key));
    // Clear unread
    setUnreadMap(prev => { const next = { ...prev }; delete next[key]; return next; });
    setExpandedMsgs(new Set());
  }, [sessionKey, input, saveDraft, loadDraft]);

  // New session
  const handleNewSession = useCallback(() => {
    const key = `web-${Date.now()}`;
    setSessionKey(key);
    setMessages([]);
    setStream(null);
    setRunId(null);
    setRunPhase('idle');
    pendingRunRef.current = null;
  }, []);

  // Rename session
  const openRenameDialog = useCallback((key: string, currentLabel: string) => {
    setRenameKey(key);
    setRenameLabel(currentLabel || '');
    setRenameOpen(true);
    setSessionMenuKey(null);
  }, []);

  const handleRenameSession = useCallback(async () => {
    if (!gwReady || renaming || !renameKey) return;
    setRenaming(true);
    try {
      await gwApi.proxy('sessions.patch', { key: renameKey, label: renameLabel.trim() || null });
      // Update local sessions list
      setSessions(prev => prev.map(s => s.key === renameKey ? { ...s, label: renameLabel.trim() || s.key } : s));
      setRenameOpen(false);
      setRenameKey('');
      setRenameLabel('');
    } catch (err: any) {
      console.error('Rename failed:', err);
    } finally {
      setRenaming(false);
    }
  }, [gwReady, renaming, renameKey, renameLabel]);

  // Delete session
  const handleDeleteSession = useCallback(async (key: string) => {
    if (!gwReady || deleting) return;
    // Cannot delete main session
    if (key === 'main') {
      setDeleteConfirmKey(null);
      return;
    }
    setDeleting(true);
    try {
      await gwApi.proxy('sessions.delete', { key });
      // Remove from local list
      setSessions(prev => prev.filter(s => s.key !== key));
      // If deleted current session, switch to main
      if (sessionKey === key) {
        setSessionKey('main');
        setMessages([]);
      }
      setDeleteConfirmKey(null);
    } catch (err: any) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  }, [gwReady, deleting, sessionKey]);

  // Slash command selection
  const selectSlashCommand = useCallback((cmd: string) => {
    setInput(cmd + ' ');
    setSlashOpen(false);
    setSlashHighlight(0);
    textareaRef.current?.focus();
  }, []);

  // Textarea auto-resize + Enter to send + slash command navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashFiltered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashHighlight(i => (i + 1) % slashFiltered.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashHighlight(i => (i - 1 + slashFiltered.length) % slashFiltered.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectSlashCommand(slashFiltered[slashHighlight].cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
    }
    // Input history recall with ↑/↓ when input is empty or navigating history
    if (e.key === 'ArrowUp' && !slashOpen && (!input || historyIdx >= 0) && inputHistory.length > 0) {
      e.preventDefault();
      const nextIdx = Math.min(historyIdx + 1, inputHistory.length - 1);
      setHistoryIdx(nextIdx);
      setInput(inputHistory[nextIdx]);
      return;
    }
    if (e.key === 'ArrowDown' && !slashOpen && historyIdx >= 0) {
      e.preventDefault();
      const nextIdx = historyIdx - 1;
      setHistoryIdx(nextIdx);
      setInput(nextIdx >= 0 ? inputHistory[nextIdx] : '');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage, slashOpen, slashFiltered, slashHighlight, selectSlashCommand, input, historyIdx, inputHistory]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    // Show slash popup when input starts with / and has no space yet (typing a command)
    if (val.startsWith('/') && !val.includes(' ') && val.length < 20) {
      setSlashOpen(true);
      setSlashHighlight(0);
    } else {
      setSlashOpen(false);
    }
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  // Export chat as Markdown
  const exportChat = useCallback((format: 'md' | 'json' = 'md') => {
    const dateStr = new Date().toISOString().split('T')[0];
    if (format === 'json') {
      const data = { session: sessionKey, exportedAt: new Date().toISOString(), messages: messages.map(m => ({ role: m.role, content: extractText(m.content), timestamp: m.timestamp })) };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `chat-${sessionKey}-${dateStr}.json`; a.click();
      URL.revokeObjectURL(url);
    } else {
      const lines = messages.map(m => {
        const text = extractText(m.content);
        const role = m.role === 'user' ? '**You**' : m.role === 'assistant' ? '**AI**' : `**${m.role}**`;
        const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
        return `${role} ${ts ? `(${ts})` : ''}\n\n${text}\n`;
      });
      const md = `# Chat: ${sessionKey}\n\n${lines.join('\n---\n\n')}`;
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `chat-${sessionKey}-${dateStr}.md`; a.click();
      URL.revokeObjectURL(url);
    }
  }, [messages, sessionKey]);

  // Resend a user message (edit + resend)
  const resendMessage = useCallback((idx: number) => {
    const msg = messages[idx];
    if (!msg || msg.role !== 'user') return;
    const text = extractText(msg.content);
    setInput(text);
    textareaRef.current?.focus();
  }, [messages]);

  // Scroll to bottom handler
  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Current session meta
  const activeSession = sessions.find(s => s.key === sessionKey);
  const activeLabel = activeSession?.label || sessionKey;

  // Override option constants
  const THINK_LEVELS = useMemo(() => ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'], []);
  const VERBOSE_VALUES = useMemo(() => ['', 'off', 'on', 'full'], []);
  const REASONING_LEVELS = useMemo(() => ['', 'off', 'on', 'stream'], []);
  const SEND_POLICIES = useMemo(() => ['', 'allow', 'deny'], []);

  // Available models for session override dropdown
  const [modelOptions, setModelOptions] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (!settingsOpen || !gwReady) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await gwApi.configGet() as any;
        if (cancelled) return;
        const providers = cfg?.models?.providers || cfg?.parsed?.models?.providers || cfg?.config?.models?.providers || {};
        const opts: { value: string; label: string }[] = [
          { value: '', label: c.inherit || 'Inherit' },
        ];
        const seen = new Set<string>();
        for (const [pName, pCfg] of Object.entries(providers) as [string, any][]) {
          const pModels = Array.isArray(pCfg?.models) ? pCfg.models : [];
          for (const m of pModels) {
            const id = typeof m === 'string' ? m : m?.id;
            if (!id) continue;
            const path = `${pName}/${id}`;
            if (seen.has(path)) continue;
            seen.add(path);
            const name = typeof m === 'object' && m?.name ? m.name : id;
            opts.push({ value: path, label: `${pName} / ${name}` });
          }
        }
        setModelOptions(opts);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [settingsOpen, gwReady, c.inherit]);

  // Patch session override (real-time)
  const patchSession = useCallback(async (field: string, patch: Record<string, unknown>) => {
    if (!sessionKey || patchBusy) return;
    setPatchBusy(true);
    setSavedField(null);
    try {
      await gwApi.sessionsPatch(sessionKey, patch as any);
      setSessions(prev => prev.map(s => s.key === sessionKey ? { ...s, ...patch } as GwSession : s));
      setSavedField(field);
      setTimeout(() => setSavedField(f => f === field ? null : f), 2000);
    } catch (e: any) {
      toast('error', e?.message || 'Patch failed');
    } finally {
      setPatchBusy(false);
    }
  }, [sessionKey, patchBusy, toast]);

  // Not connected state: only block UI when gateway itself is unreachable
  // AND we've actually checked (avoid flashing disconnected before first REST check).
  if (!gwReady && !wsConnecting && gwChecked) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-[#0d1117]">
        <div className="text-center max-w-sm px-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-[32px] text-red-400">cloud_off</span>
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-2">{c.disconnected}</h3>
          <p className="text-xs text-slate-500 dark:text-white/40 mb-4">{wsError}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl">
            {c.retry}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-white dark:bg-[#0d1117] relative">
      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="md:hidden fixed top-[32px] bottom-[72px] start-0 end-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Sidebar — desktop: static, mobile: slide-out drawer */}
      <aside className={`fixed md:static top-[32px] bottom-[72px] md:top-auto md:bottom-auto start-0 z-50 ${sidebarCollapsed ? 'w-0 md:w-0 overflow-hidden' : 'w-72 md:w-64 lg:w-72'} border-e border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d1117] md:bg-slate-50/80 md:dark:bg-black/20 flex flex-col shrink-0 transform transition-all duration-200 ease-out ${drawerOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full md:translate-x-0'}`}>
        <div className="p-3 border-b border-slate-200 dark:border-white/5">
          <button onClick={handleNewSession}
            className="w-full bg-primary text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all active:scale-[0.98] send-btn-glow">
            <span className="material-symbols-outlined text-sm">add</span> {c.new}
          </button>
        </div>

        {/* Session Key Input + Search */}
        <div className="px-3 py-2.5 border-b border-slate-200 dark:border-white/5 space-y-2">
          <div className="relative">
            <span className="material-symbols-outlined absolute start-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/20 text-[14px]">key</span>
            <input value={sessionKey} onChange={e => setSessionKey(e.target.value)}
              onBlur={() => loadHistory()}
              className="w-full h-9 ps-7 pe-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] font-mono text-slate-700 dark:text-white/70 focus:ring-1 focus:ring-primary/50 outline-none sci-input"
              placeholder={c.sessionKey} />
          </div>
          <div className="relative">
            <span className="material-symbols-outlined absolute start-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/20 text-[13px]">search</span>
            <input value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)}
              className="w-full h-8 ps-7 pe-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white/70 focus:ring-1 focus:ring-primary/50 outline-none sci-input"
              placeholder={c.searchSessions || 'Search...'} />
          </div>
        </div>

        {/* Sessions List — grouped by time */}
        <div className="flex-1 overflow-y-auto custom-scrollbar neon-scrollbar p-2 space-y-1">
          {initialDetecting && (
            <div className="mb-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-primary animate-spin">progress_activity</span>
              <span className="text-[11px] font-medium text-slate-600 dark:text-white/60">{c.connecting}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            </div>
          )}
          {/* Skeleton loading */}
          {sessionsLoading && sessions.length === 0 && !wsConnecting && (
            <div className="space-y-2 animate-pulse">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="rounded-xl border border-slate-200/40 dark:border-white/5 p-2.5">
                  <div className="h-2.5 w-12 bg-slate-200 dark:bg-white/10 rounded mb-2" />
                  <div className="h-3 w-32 bg-slate-200 dark:bg-white/10 rounded mb-1.5" />
                  <div className="h-2 w-20 bg-slate-100 dark:bg-white/5 rounded" />
                </div>
              ))}
            </div>
          )}
          {sessions.length === 0 && !sessionsLoading && !wsConnecting && (
            <EmptyState icon="chat_bubble_outline" title={c.noSessions} compact />
          )}
          {groupedSessions.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-bold text-slate-400 dark:text-white/25 uppercase tracking-widest px-2 pt-2.5 pb-1">{group.label}</p>
              {group.items.map(s => (
                <div key={s.key} className="relative group">
                  <button onClick={() => selectSession(s.key)}
                    className={`w-full text-start p-2.5 rounded-xl transition-all border ${sessionKey === s.key
                      ? 'bg-primary/10 border-primary/20 shadow-sm glow-subtle-blue'
                      : 'border-transparent hover:bg-slate-200/50 dark:hover:bg-white/5'
                      }`}>
                    <div className="flex items-start gap-2">
                      <div className={`relative w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${s.kind === 'direct' ? 'bg-blue-500/10 text-blue-500' : s.kind === 'group' ? 'bg-purple-500/10 text-purple-500' : 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-white/30'} ${(s.activeRun || s.isStreaming) ? 'ring-1 ring-primary/40 animate-pulse' : ''}`}>
                        <span className="material-symbols-outlined text-[12px]">{s.kind === 'group' ? 'group' : s.kind === 'global' ? 'public' : 'person'}</span>
                        {(s.activeRun || s.isStreaming) && <span className="absolute -top-0.5 -end-0.5 w-2 h-2 rounded-full bg-primary border border-white dark:border-[#0d1117]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${s.kind === 'direct' ? 'bg-blue-500/10 text-blue-500' :
                        s.kind === 'group' ? 'bg-purple-500/10 text-purple-500' :
                          'bg-slate-200 dark:bg-white/5 text-slate-400 dark:text-white/40'
                        }`}>{s.kind || sessionDefault}</span>
                      <div className="flex items-center gap-1">
                        {unreadMap[s.key] ? <span className="w-1.5 h-1.5 rounded-full bg-primary" /> : null}
                        {s.totalTokens ? <span className="text-[10px] text-slate-400 dark:text-white/20 font-mono">{(s.totalTokens / 1000).toFixed(1)}k</span> : null}
                      </div>
                    </div>
                    <h4 className={`text-[11px] font-bold truncate pe-12 ${sessionKey === s.key ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-white/50'}`}>
                      {s.label || s.key}
                    </h4>
                    {s.lastMessagePreview && (
                      <p className="text-[10px] text-slate-400 dark:text-white/25 truncate mt-0.5">{s.lastMessagePreview}</p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      {s.lastActiveAt && (
                        <span className="text-[10px] text-slate-400 dark:text-white/20">{new Date(s.lastActiveAt).toLocaleString()}</span>
                      )}
                      {s.model && (
                        <span className="text-[10px] text-slate-300 dark:text-white/15 font-mono truncate">{s.model}</span>
                      )}
                    </div>
                    {/* Context window micro progress bar */}
                    {s.totalTokens && s.maxContextTokens ? (() => {
                      const pct = Math.min(100, (s.totalTokens / s.maxContextTokens) * 100);
                      const barColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
                      return (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <div className="flex-1 h-1 rounded-full bg-slate-200/60 dark:bg-white/5 overflow-hidden">
                            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className={`text-[8px] tabular-nums font-bold ${pct > 90 ? 'text-red-500' : pct > 70 ? 'text-amber-500' : 'text-slate-400 dark:text-white/25'}`}>
                            {pct.toFixed(0)}%
                          </span>
                          {s.compacted && <span className="material-symbols-outlined text-[10px] text-amber-500" title={c.ctxCompacted || 'Compacted'}>compress</span>}
                        </div>
                      );
                    })() : null}
                      </div>
                    </div>
                  </button>
                  {/* Hover actions */}
                  <div className="absolute end-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); openRenameDialog(s.key, s.label || ''); }}
                      className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 hover:text-primary transition-all"
                      title={c.renameSession}>
                      <span className="material-symbols-outlined text-[14px]">edit</span>
                    </button>
                    {s.key !== 'main' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmKey(s.key); }}
                        className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-all"
                        title={c.deleteSession}>
                        <span className="material-symbols-outlined text-[14px]">delete</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Connection Status */}
        <div className="px-3 py-2 border-t border-slate-200 dark:border-white/5 flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${gwReady ? 'bg-mac-green animate-glow-pulse-green' : wsConnecting ? 'bg-mac-yellow animate-pulse' : 'bg-slate-300'}`} />
          <span className="text-[11px] font-medium text-slate-400 dark:text-white/40">
            {gwReady ? c.connected : wsConnecting ? c.connecting : c.disconnected}
          </span>
        </div>
      </aside>

      {/* Chat Area + Usage Panel */}
      <div className="flex-1 flex overflow-hidden relative">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Reconnect banner */}
        {showReconnectBanner && (
          <div className="px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-center gap-2 shrink-0 z-20">
            <span className="material-symbols-outlined text-[14px] text-amber-500 animate-spin">progress_activity</span>
            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">{c.reconnecting || 'Reconnecting...'}</span>
          </div>
        )}

        {/* Header */}
        <header className="px-4 md:px-6 py-2.5 md:py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0 bg-white/80 dark:bg-black/40 backdrop-blur-xl z-10 neon-divider">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            {/* Sidebar collapse toggle (desktop) */}
            <button onClick={() => setSidebarCollapsed(v => !v)}
              className="hidden md:flex p-1.5 -ms-1 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-lg transition-all"
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
              <span className="material-symbols-outlined text-[18px]">{sidebarCollapsed ? 'right_panel_open' : 'left_panel_close'}</span>
            </button>
            <button onClick={() => setDrawerOpen(true)}
              className="md:hidden p-1.5 -ms-1 text-slate-500 dark:text-white/50 hover:text-primary hover:bg-primary/5 rounded-lg transition-all">
              <span className="material-symbols-outlined text-[20px]">menu</span>
            </button>
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shrink-0 animate-glow-breathe">
              <span className="material-symbols-outlined text-[18px] md:text-[20px]">smart_toy</span>
            </div>
            <div className="truncate">
              <h2 className="text-xs md:text-sm font-bold text-slate-900 dark:text-white truncate">{activeLabel}</h2>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className={`w-1 h-1 rounded-full ${gwReady ? 'bg-mac-green' : 'bg-slate-300'}`} />
                <span className="text-[11px] text-slate-400 font-medium font-mono hidden sm:inline">{sessionKey}</span>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${runPhaseMeta.textClass}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${runPhaseMeta.dot}`} />
                  {runPhaseMeta.text}
                </span>
                {activeSession?.model && (
                  <>
                    <span className="text-slate-300 dark:text-white/15 hidden sm:inline">|</span>
                    <span className="text-[10px] font-medium font-mono truncate max-w-[100px] sm:max-w-[120px] px-1.5 py-0.5 rounded bg-gradient-to-r from-purple-500/10 to-blue-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/10">{activeSession.model}</span>
                  </>
                )}
                {(runPhase === 'streaming' || runPhase === 'sending') && liveElapsed > 0 ? (
                  <>
                    <span className="text-slate-300 dark:text-white/15">|</span>
                    <span className="text-[10px] text-primary font-mono tabular-nums">{(liveElapsed / 1000).toFixed(1)}s</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setSettingsOpen(v => !v)}
              className={`p-2 rounded-lg transition-colors ${settingsOpen ? 'text-primary bg-primary/10' : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-600'}`}
              title={c.overrides || 'Overrides'}>
              <span className="material-symbols-outlined text-[18px]">tune</span>
            </button>
            <div className="relative group/export">
              <button onClick={() => exportChat('md')} disabled={messages.length === 0}
                className="p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-600 rounded-lg transition-colors disabled:opacity-30"
                title={c.exportChat || 'Export Markdown'}>
                <span className="material-symbols-outlined text-[18px]">download</span>
              </button>
              <div className="absolute top-full end-0 mt-1 hidden group-hover/export:block z-30">
                <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a1c20] shadow-xl py-1 min-w-[120px]">
                  <button onClick={() => exportChat('md')} disabled={messages.length === 0}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30">
                    <span className="material-symbols-outlined text-[13px]">description</span>Markdown
                  </button>
                  <button onClick={() => exportChat('json')} disabled={messages.length === 0}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30">
                    <span className="material-symbols-outlined text-[13px]">data_object</span>JSON
                  </button>
                </div>
              </div>
            </div>
            <button onClick={() => setInjectOpen(true)} disabled={!gwReady}
              className="p-2 text-slate-400 hover:bg-purple-100 dark:hover:bg-purple-500/10 hover:text-purple-500 rounded-lg transition-colors disabled:opacity-30"
              title={c.inject}>
              <span className="material-symbols-outlined text-[18px]">add_comment</span>
            </button>
            <button onClick={handleResolve} disabled={!gwReady || resolving || !sessionKey.trim()}
              className="p-2 text-slate-400 hover:bg-blue-100 dark:hover:bg-blue-500/10 hover:text-blue-500 rounded-lg transition-colors disabled:opacity-30"
              title={c.resolve}>
              <span className={`material-symbols-outlined text-[18px] ${resolving ? 'animate-spin' : ''}`}>{resolving ? 'progress_activity' : 'link'}</span>
            </button>
            <button onClick={handleCompact} disabled={!gwReady || compacting || !sessionKey.trim()}
              className="p-2 text-slate-400 hover:bg-amber-100 dark:hover:bg-amber-500/10 hover:text-amber-500 rounded-lg transition-colors disabled:opacity-30"
              title={c.compact}>
              <span className={`material-symbols-outlined text-[18px] ${compacting ? 'animate-spin' : ''}`}>{compacting ? 'progress_activity' : 'compress'}</span>
            </button>
            <button onClick={() => { setRepairOpen(true); handleRepairScan(); }}
              className={`p-2 rounded-lg transition-colors ${repairIssues.length > 0 ? 'text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-500/10' : 'text-slate-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/10 hover:text-emerald-500'} disabled:opacity-30`}
              title={c.repair}>
              <span className={`material-symbols-outlined text-[18px] ${repairScanning ? 'animate-spin' : ''}`}>{repairScanning ? 'progress_activity' : 'healing'}</span>
            </button>
            <button onClick={() => { setMsgSearchOpen(v => !v); if (!msgSearchOpen) setTimeout(() => msgSearchRef.current?.focus(), 100); }}
              className={`p-2 rounded-lg transition-colors ${msgSearchOpen ? 'text-primary bg-primary/10' : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-600'}`}
              title={c.searchMessages || 'Search Messages'}>
              <span className="material-symbols-outlined text-[18px]">search</span>
            </button>
            <button onClick={() => { loadSessions(); loadHistory(); }}
              className="p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-colors">
              <span className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
          </div>
        </header>

        {/* Collapsible message search bar */}
        {msgSearchOpen && (
          <div className="shrink-0 border-b border-slate-200/60 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.015] px-4 py-2 animate-fade-in">
            <div className="flex items-center gap-2 max-w-2xl mx-auto">
              <span className="material-symbols-outlined text-[16px] text-slate-400">search</span>
              <input ref={msgSearchRef} type="text" value={msgSearchQuery} onChange={e => setMsgSearchQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setMsgSearchOpen(false); setMsgSearchQuery(''); } }}
                className="flex-1 bg-transparent text-[12px] text-slate-700 dark:text-white/70 placeholder:text-slate-400 dark:placeholder:text-white/25 outline-none"
                placeholder={c.searchPlaceholder || 'Search in messages...'} />
              {msgSearchQuery && (
                <span className="text-[10px] text-slate-400 dark:text-white/30 font-mono tabular-nums shrink-0">
                  {renderedMessages.filter(m => extractText(m.content).toLowerCase().includes(msgSearchQuery.toLowerCase())).length} {c.matches || 'matches'}
                </span>
              )}
              <button onClick={() => { setMsgSearchOpen(false); setMsgSearchQuery(''); }}
                className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-white/60 rounded transition-colors">
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          </div>
        )}

        {/* Collapsible Session Override Settings Panel */}
        {settingsOpen && activeSession && (
          <div className="shrink-0 border-b border-slate-200/60 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.015] px-4 py-3 animate-fade-in">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-primary">tune</span>
                  {c.overrides || 'Session Overrides'}
                </h3>
                <button onClick={() => setSettingsOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white/60 rounded transition-colors">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {/* Label */}
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                    {c.sessionLabel || 'Label'}
                    {savedField === 'label' && <span className="material-symbols-outlined text-[11px] text-mac-green">check_circle</span>}
                  </span>
                  <input defaultValue={activeSession.label || ''} disabled={patchBusy} key={`ol-${sessionKey}`}
                    onBlur={e => { const v = e.target.value.trim(); if (v !== (activeSession.label || '')) patchSession('label', { label: v || null }); }}
                    className="w-full mt-0.5 px-2 py-1 rounded-lg bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                </label>
                {/* Thinking */}
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                    {c.thinking || 'Thinking'}
                    {savedField === 'thinking' && <span className="material-symbols-outlined text-[11px] text-mac-green">check_circle</span>}
                  </span>
                  <CustomSelect value={activeSession.thinkingLevel || ''} disabled={patchBusy}
                    onChange={v => patchSession('thinking', { thinkingLevel: v || null })}
                    options={THINK_LEVELS.map(lv => ({ value: lv, label: lv || (c.inherit || 'Inherit') }))}
                    className="w-full mt-0.5 px-2 py-1 rounded-lg bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                </label>
                {/* Verbose */}
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                    {c.verbose || 'Verbose'}
                    {savedField === 'verbose' && <span className="material-symbols-outlined text-[11px] text-mac-green">check_circle</span>}
                  </span>
                  <CustomSelect value={activeSession.verboseLevel || ''} disabled={patchBusy}
                    onChange={v => patchSession('verbose', { verboseLevel: v || null })}
                    options={VERBOSE_VALUES.map(lv => ({ value: lv, label: lv || (c.inherit || 'Inherit') }))}
                    className="w-full mt-0.5 px-2 py-1 rounded-lg bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                </label>
                {/* Reasoning */}
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                    {c.reasoning || 'Reasoning'}
                    {savedField === 'reasoning' && <span className="material-symbols-outlined text-[11px] text-mac-green">check_circle</span>}
                  </span>
                  <CustomSelect value={activeSession.reasoningLevel || ''} disabled={patchBusy}
                    onChange={v => patchSession('reasoning', { reasoningLevel: v || null })}
                    options={REASONING_LEVELS.map(lv => ({ value: lv, label: lv || (c.inherit || 'Inherit') }))}
                    className="w-full mt-0.5 px-2 py-1 rounded-lg bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                </label>
                {/* Send Policy */}
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                    {c.sendPolicy || 'Policy'}
                    {savedField === 'sendPolicy' && <span className="material-symbols-outlined text-[11px] text-mac-green">check_circle</span>}
                  </span>
                  <CustomSelect value={activeSession.sendPolicy || ''} disabled={patchBusy}
                    onChange={v => patchSession('sendPolicy', { sendPolicy: v || null })}
                    options={SEND_POLICIES.map(lv => ({ value: lv, label: lv || (c.inherit || 'Inherit') }))}
                    className="w-full mt-0.5 px-2 py-1 rounded-lg bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                </label>
                {/* Model Override */}
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                    {c.modelOverride || 'Model'}
                    {savedField === 'model' && <span className="material-symbols-outlined text-[11px] text-mac-green">check_circle</span>}
                  </span>
                  {modelOptions.length > 1 ? (
                    <CustomSelect value={activeSession.model || ''} disabled={patchBusy}
                      onChange={v => patchSession('model', { model: v || null })}
                      options={modelOptions}
                      className="w-full mt-0.5 px-2 py-1 rounded-lg bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                  ) : (
                    <input defaultValue={activeSession.model || ''} disabled={patchBusy} key={`om-${sessionKey}`}
                      placeholder={c.modelPlaceholder || 'e.g. anthropic/claude-sonnet-4-5'}
                      onBlur={e => { const v = e.target.value.trim(); if (v !== (activeSession.model || '')) patchSession('model', { model: v || null }); }}
                      className="w-full mt-0.5 px-2 py-1 rounded-lg bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70 focus:outline-none focus:ring-1 focus:ring-primary/30" />
                  )}
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar neon-scrollbar relative">
          <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
            {/* Session history cleared notice */}
            {sessionNotice && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 mb-4">
                <span className="material-symbols-outlined text-[18px] text-amber-500 mt-0.5">info</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">{sessionNotice}</p>
                </div>
                <button onClick={() => setSessionNotice(null)} className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            )}

            {/* Welcome + Quick Start */}
            {messages.length === 0 && !chatLoading && !stream && (
              <div className="flex flex-col items-center justify-center py-10 md:py-16 relative">
                {/* Decorative gradient orbs */}
                <div className="absolute top-0 left-1/4 w-48 h-48 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute bottom-0 right-1/4 w-36 h-36 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

                <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-5 border border-primary/10 shadow-lg shadow-primary/5">
                  <span className="material-symbols-outlined text-[36px] text-primary">chat</span>
                  <div className="absolute -bottom-1 -end-1 w-5 h-5 rounded-full bg-mac-green border-2 border-white dark:border-[#0d1117] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[10px] text-white">check</span>
                  </div>
                </div>
                <p className="text-base font-bold text-slate-700 dark:text-white/60 mb-1">{c.welcome}</p>
                <p className="text-[11px] text-slate-400 dark:text-white/25 mb-7">{c.slashHint}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 w-full max-w-lg">
                  {[
                    { cmd: '/status', icon: 'info', label: c.quickStatus, color: 'text-blue-500 bg-gradient-to-br from-blue-500/15 to-blue-400/5 border-blue-500/10' },
                    { cmd: '/model', icon: 'smart_toy', label: c.quickModel, color: 'text-emerald-500 bg-gradient-to-br from-emerald-500/15 to-emerald-400/5 border-emerald-500/10' },
                    { cmd: '/think', icon: 'psychology', label: c.quickThink, color: 'text-purple-500 bg-gradient-to-br from-purple-500/15 to-purple-400/5 border-purple-500/10' },
                    { cmd: '/compact', icon: 'compress', label: c.quickCompact, color: 'text-amber-500 bg-gradient-to-br from-amber-500/15 to-amber-400/5 border-amber-500/10' },
                    { cmd: '/new', icon: 'restart_alt', label: c.quickReset, color: 'text-red-400 bg-gradient-to-br from-red-500/15 to-red-400/5 border-red-500/10' },
                    { cmd: '/help', icon: 'help', label: c.quickHelp, color: 'text-slate-500 bg-gradient-to-br from-slate-500/10 to-slate-400/5 border-slate-400/10' },
                  ].map(q => (
                    <button key={q.cmd} onClick={() => selectSlashCommand(q.cmd)}
                      className="flex items-center gap-2.5 px-3 py-3 rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white/80 dark:bg-white/[0.02] hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all text-start group backdrop-blur-sm">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${q.color}`}>
                        <span className="material-symbols-outlined text-[16px]">{q.icon}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11px] font-bold text-slate-700 dark:text-white/70 block truncate">{q.cmd}</span>
                        <span className="text-[10px] text-slate-400 dark:text-white/30 block truncate">{q.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="hidden sm:flex flex-wrap justify-center gap-4 mt-7 text-[9px] text-slate-400 dark:text-white/20">
                  <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 font-mono text-[8px] border border-slate-200/60 dark:border-white/[0.06] shadow-sm">↑</kbd> {c.historyRecall || 'History'}</span>
                  <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 font-mono text-[8px] border border-slate-200/60 dark:border-white/[0.06] shadow-sm">/</kbd> {c.slashCommands || 'Commands'}</span>
                  <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 font-mono text-[8px] border border-slate-200/60 dark:border-white/[0.06] shadow-sm">Shift+Enter</kbd> {c.newLine || 'New line'}</span>
                </div>
              </div>
            )}

            {(chatLoading || initialDetecting) && messages.length === 0 && (
              <div className="space-y-4 animate-pulse">
                {/* Skeleton chat bubbles */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-slate-200/60 dark:bg-white/5 shrink-0" />
                  <div className="space-y-1.5 flex-1 max-w-[70%]">
                    <div className="h-3 w-32 rounded bg-slate-200/60 dark:bg-white/5" />
                    <div className="h-16 rounded-2xl bg-slate-100/80 dark:bg-white/[0.03] border border-slate-200/40 dark:border-white/[0.04]" />
                  </div>
                </div>
                <div className="flex items-start gap-3 justify-end">
                  <div className="space-y-1.5 max-w-[60%]">
                    <div className="h-10 rounded-2xl bg-primary/5 border border-primary/10" />
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-slate-200/60 dark:bg-white/5 shrink-0" />
                  <div className="space-y-1.5 flex-1 max-w-[80%]">
                    <div className="h-3 w-24 rounded bg-slate-200/60 dark:bg-white/5" />
                    <div className="h-28 rounded-2xl bg-slate-100/80 dark:bg-white/[0.03] border border-slate-200/40 dark:border-white/[0.04]" />
                  </div>
                </div>
              </div>
            )}

            {/* Message List */}
            {omittedMessageCount > 0 && (
              <div className="flex justify-center">
                <div className="px-3 py-1 rounded-full bg-slate-100 dark:bg-white/5 text-[10px] text-slate-500 dark:text-white/35">
                  +{omittedMessageCount}
                </div>
              </div>
            )}
            {renderedMessages.map((msg, idx) => {
              const text = extractText(msg.content);
              const tools = extractToolCalls(msg.content);
              const images = extractImages(msg.content);
              const thinkingBlocks = extractThinking(msg.content);
              const isUser = msg.role === 'user';
              const isSystem = msg.role === 'system';
              const isTool = msg.role === 'tool';
              const showAvatar = isFirstInGroup(msgGroups, idx);
              const isLast = isLastInGroup(msgGroups, idx);

              // Filter empty bubbles (P0 fix)
              if (!text.trim() && tools.length === 0 && !isTool && images.length === 0) return null;

              // Date separator between messages on different days
              let dateSeparator: React.ReactNode = null;
              if (msg.timestamp) {
                const msgDate = new Date(msg.timestamp);
                const prevMsg = idx > 0 ? renderedMessages[idx - 1] : null;
                const prevDate = prevMsg?.timestamp ? new Date(prevMsg.timestamp) : null;
                const isDiffDay = !prevDate || msgDate.toDateString() !== prevDate.toDateString();
                if (isDiffDay) {
                  const today = new Date();
                  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                  const label = msgDate.toDateString() === today.toDateString() ? (c.today || 'Today')
                    : msgDate.toDateString() === yesterday.toDateString() ? (c.yesterday || 'Yesterday')
                    : msgDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: msgDate.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
                  dateSeparator = (
                    <div className="flex items-center gap-3 my-3">
                      <div className="flex-1 h-px bg-slate-200/60 dark:bg-white/[0.06]" />
                      <span className="text-[10px] font-bold text-slate-400 dark:text-white/30 shrink-0">{label}</span>
                      <div className="flex-1 h-px bg-slate-200/60 dark:bg-white/[0.06]" />
                    </div>
                  );
                }
              }

              if (isSystem) {
                return (
                  <React.Fragment key={idx}>
                    {dateSeparator}
                    <div className="flex justify-center">
                      <div className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 text-[10px] text-slate-500 dark:text-white/40 font-medium max-w-md truncate">
                        {text}
                      </div>
                    </div>
                  </React.Fragment>
                );
              }

              if (isTool) {
                const toolName = (msg as any).name || (msg as any).tool_use_id || c.toolResult || 'Tool Result';
                const isErr = (msg as any).is_error === true;
                return (
                  <React.Fragment key={idx}>
                    {dateSeparator}
                    <div className="ms-10 md:ms-12">
                      <ToolCallCard
                        name={toolName}
                        input={undefined}
                        result={text}
                        isError={isErr}
                        labels={{ toolCall: c.toolInput, toolResult: c.toolOutput }}
                      />
                    </div>
                  </React.Fragment>
                );
              }

              // Long message collapse
              const isLong = text.length > 1500;
              const isMsgExpanded = expandedMsgs.has(idx);
              const displayText = isLong && !isMsgExpanded ? text.slice(0, 1500) : text;

              return (
                <React.Fragment key={idx}>
                {dateSeparator}
                <div className={`flex items-start gap-2.5 md:gap-3 ${isUser ? 'flex-row-reverse' : ''} ${!showAvatar ? 'mt-0.5' : ''}`}>
                  {showAvatar ? (
                    <div className={`w-7 h-7 md:w-8 md:h-8 shrink-0 rounded-xl flex items-center justify-center border mt-0.5 ${isUser
                      ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-black border-slate-700 dark:border-slate-300'
                      : 'bg-primary/10 border-primary/20 text-primary'
                      }`}>
                      <span className="material-symbols-outlined text-[14px] md:text-[16px]">
                        {isUser ? 'person' : 'smart_toy'}
                      </span>
                    </div>
                  ) : (
                    <div className="w-7 md:w-8 shrink-0" />
                  )}
                  <div className={`max-w-[85%] md:max-w-[75%] group ${isUser ? 'ms-auto' : ''}`}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, idx, text, isUser }); }}>
                    <div className={`p-3.5 md:p-4 shadow-sm border backdrop-blur-sm select-text cursor-text ${isUser
                      ? `bg-primary/95 text-white border-primary/30 ${showAvatar ? 'rounded-2xl rounded-se-sm' : isLast ? 'rounded-2xl rounded-se-sm' : 'rounded-xl rounded-se-sm'}`
                      : `bg-white/80 dark:bg-white/[0.05] text-slate-800 dark:text-slate-200 border-slate-200/70 dark:border-white/[0.08] msg-glow-accent ${showAvatar ? 'rounded-2xl rounded-ss-sm' : isLast ? 'rounded-2xl rounded-ss-sm' : 'rounded-xl rounded-ss-sm'}`
                      }`}>
                      {/* Thinking blocks (folded) */}
                      {thinkingBlocks.length > 0 && (
                        <div className="mb-2">
                          {thinkingBlocks.map((tb, ti) => (
                            <ThinkingBlock key={`think-${idx}-${ti}`} content={tb} labels={{ thinking: c.thinkingLabel }} />
                          ))}
                        </div>
                      )}

                      {/* Main text — Markdown for assistant, plain for user */}
                      {isUser ? (
                        <div className="text-[13px] md:text-[14px] leading-relaxed whitespace-pre-wrap break-words">{highlightSearch(displayText)}</div>
                      ) : (
                        <MarkdownRenderer content={displayText} labels={{ copyCode: c.copyCode }} />
                      )}

                      {/* Images */}
                      {images.length > 0 && (
                        <ImageGallery images={images} labels={{ imageUnavailable: c.imageUnavailable }} />
                      )}

                      {/* Expand/collapse long messages */}
                      {isLong && (
                        <button onClick={() => setExpandedMsgs(prev => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next; })}
                          className={`mt-1.5 text-[11px] font-bold ${isUser ? 'text-white/70 hover:text-white' : 'text-primary/70 hover:text-primary'} transition-colors`}>
                          {isMsgExpanded ? (c.collapse || 'Collapse') : (c.expand || 'Expand')} ({Math.ceil(text.length / 1000)}k chars)
                        </button>
                      )}

                      {/* Tool calls — ToolCallCard with paired results */}
                      {tools.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {tools.map((tool, ti) => {
                            // Look ahead for matching tool_result in subsequent tool-role messages
                            let result: string | undefined;
                            let isErr = false;
                            if (tool.id) {
                              for (let j = idx + 1; j < renderedMessages.length && j <= idx + tools.length + 2; j++) {
                                const nm = renderedMessages[j];
                                if (nm?.role === 'tool' && (nm as any).tool_use_id === tool.id) {
                                  result = extractToolResultText(nm.content);
                                  isErr = (nm as any).is_error === true;
                                  break;
                                }
                              }
                            }
                            return (
                              <ToolCallCard
                                key={ti}
                                name={tool.name}
                                input={tool.input}
                                result={result}
                                isError={isErr}
                                labels={{ toolCall: c.toolInput, toolResult: c.toolOutput }}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Actions row */}
                    <div className={`flex items-center gap-2 mt-1 ${isUser ? 'justify-end' : ''} opacity-0 group-hover:opacity-100 transition-opacity`}>
                      {msg.timestamp && (
                        <span className="text-[11px] text-slate-400 dark:text-white/20">{fmtTime(msg.timestamp)}</span>
                      )}
                      {!isUser && text && (
                        <button onClick={() => handleCopy(idx, text)}
                          className="flex items-center gap-0.5 text-[11px] text-slate-400 hover:text-primary transition-colors">
                          <span className="material-symbols-outlined text-[12px]">{copiedIdx === idx ? 'check' : 'content_copy'}</span>
                          {copiedIdx === idx ? c.copied : c.copy}
                        </button>
                      )}
                      {/* Resend for user messages */}
                      {isUser && (
                        <button onClick={() => resendMessage(idx)}
                          className="flex items-center gap-0.5 text-[11px] text-white/60 hover:text-white transition-colors">
                          <span className="material-symbols-outlined text-[12px]">replay</span>
                          {c.resend || 'Edit'}
                        </button>
                      )}
                      {/* Rich metadata badges for assistant messages */}
                      {!isUser && !isSystem && !isTool && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Model badge — show when different from session default */}
                          {msg.model && msg.model !== activeSession?.model && (
                            <span className="inline-flex items-center gap-0.5 text-[8px] font-mono text-purple-400/60 dark:text-purple-400/40" title={`${msg.provider ? msg.provider + '/' : ''}${msg.model}`}>
                              <span className="material-symbols-outlined text-[9px]">model_training</span>
                              {msg.model.length > 20 ? msg.model.slice(0, 18) + '…' : msg.model}
                            </span>
                          )}
                          {/* stopReason badge — only show non-default (end_turn is default) */}
                          {msg.stopReason && msg.stopReason !== 'end_turn' && (() => {
                            const sr = msg.stopReason;
                            const meta = sr === 'max_tokens' ? { icon: 'warning', text: 'truncated', cls: 'text-amber-500/70' }
                              : sr === 'error' ? { icon: 'error', text: 'error', cls: 'text-red-500/70' }
                              : sr === 'aborted' ? { icon: 'cancel', text: 'aborted', cls: 'text-slate-400/60' }
                              : sr === 'timeout' ? { icon: 'timer_off', text: 'timeout', cls: 'text-amber-500/70' }
                              : (sr === 'tool_use' || sr === 'toolUse' || sr === 'tool_calls') ? { icon: 'build', text: 'tool', cls: 'text-purple-400/50' }
                              : null;
                            if (!meta) return null;
                            return (
                              <span className={`inline-flex items-center gap-0.5 text-[8px] font-bold ${meta.cls}`}>
                                <span className="material-symbols-outlined text-[9px]">{meta.icon}</span>
                                {meta.text}
                              </span>
                            );
                          })()}
                          {/* Per-message token badge */}
                          {msg.usage && (() => {
                            const u = msg.usage;
                            const inTok = u.inputTokens ?? u.input ?? 0;
                            const outTok = u.outputTokens ?? u.output ?? 0;
                            const total = u.totalTokens ?? (inTok + outTok);
                            const costVal = msg.cost?.total ?? u.cost?.total;
                            if (total <= 0) return null;
                            const fmtT = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
                            return (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-mono tabular-nums text-slate-300 dark:text-white/20" title={`In: ${inTok} Out: ${outTok}${u.cacheRead ? ` Cache: ${u.cacheRead}` : ''}${costVal ? ` Cost: $${costVal.toFixed(4)}` : ''}`}>
                                <span className="material-symbols-outlined text-[10px]">token</span>
                                {fmtT(total)}
                                {costVal != null && costVal > 0 && <span className="text-emerald-400/60 ms-0.5">${costVal < 0.01 ? costVal.toFixed(4) : costVal.toFixed(2)}</span>}
                              </span>
                            );
                          })()}
                          {/* Response latency */}
                          {(() => {
                            const prevUserMsg = renderedMessages.slice(0, idx).reverse().find(m => m.role === 'user');
                            if (prevUserMsg?.timestamp && msg.timestamp) {
                              const latMs = msg.timestamp - prevUserMsg.timestamp;
                              if (latMs > 0 && latMs < 300_000) return (
                                <span className="text-[9px] text-slate-300 dark:text-white/15 font-mono tabular-nums" title={c.latency || 'Response time'}>
                                  {latMs >= 1000 ? `${(latMs / 1000).toFixed(1)}s` : `${latMs}ms`}
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                </React.Fragment>
              );
            })}

            {/* Streaming indicator */}
            {stream !== null && (
              <div className="flex items-start gap-2.5 md:gap-3">
                <div className="w-7 h-7 md:w-8 md:h-8 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mt-0.5">
                  <span className="material-symbols-outlined text-[14px] md:text-[16px]">smart_toy</span>
                </div>
                <div className="max-w-[85%] md:max-w-[75%]">
                  <div className="p-3.5 md:p-4 rounded-2xl rounded-ss-sm shadow-sm border bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/[0.06]">
                    {stream ? (
                      <MarkdownRenderer content={stream} streaming labels={{ copyCode: c.copyCode }} />
                    ) : (
                      <div className="flex items-center gap-1.5 py-1">
                        {[0, 1, 2].map(i => (
                          <span key={i} className="w-2 h-2 rounded-full bg-slate-400 dark:bg-[var(--color-neon-cyan)] animate-bounce stream-dot" style={{ animationDelay: `${i * 150}ms`, animationDuration: '0.8s' }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] text-primary font-medium">{c.streaming}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex justify-center">
                <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-[11px] text-red-500 font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px]">error</span>
                  {error}
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Scroll to bottom button */}
          {showScrollBtn && (
            <button onClick={scrollToBottom}
              className="absolute bottom-4 end-4 w-9 h-9 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 shadow-lg flex items-center justify-center text-slate-500 dark:text-white/50 hover:text-primary hover:border-primary/30 transition-all z-10">
              <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
            </button>
          )}
        </div>

        {/* Message context menu */}
        {ctxMenu && (
          <div className="fixed inset-0 z-50" onClick={() => setCtxMenu(null)} onContextMenu={e => { e.preventDefault(); setCtxMenu(null); }}>
            <div className="absolute rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a1c20] shadow-2xl shadow-black/15 dark:shadow-black/40 py-1 min-w-[140px] animate-in fade-in zoom-in-95 duration-100"
              style={{ top: Math.min(ctxMenu.y, window.innerHeight - 180), left: Math.min(ctxMenu.x, window.innerWidth - 160) }}>
              <button onClick={() => { navigator.clipboard.writeText(ctxMenu.text); setCtxMenu(null); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                <span className="material-symbols-outlined text-[14px]">content_copy</span>
                {c.copy}
              </button>
              <button onClick={() => { setInput(prev => prev + (prev ? '\n' : '') + '> ' + ctxMenu.text.slice(0, 200)); setCtxMenu(null); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                <span className="material-symbols-outlined text-[14px]">format_quote</span>
                {c.quote || 'Quote'}
              </button>
              {ctxMenu.isUser && (
                <button onClick={() => { resendMessage(ctxMenu.idx); setCtxMenu(null); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                  <span className="material-symbols-outlined text-[14px]">replay</span>
                  {c.resend || 'Edit & Resend'}
                </button>
              )}
              <div className="border-t border-slate-100 dark:border-white/5 my-0.5" />
              <button onClick={() => { setMessages(prev => prev.filter((_, i) => i !== ctxMenu.idx)); setCtxMenu(null); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/5 transition-colors">
                <span className="material-symbols-outlined text-[14px]">delete</span>
                {c.delete}
              </button>
            </div>
          </div>
        )}

        {/* Token context bar above input */}
        {activeSession?.totalTokens && activeSession?.maxContextTokens ? (() => {
          const pct = Math.min(100, (activeSession.totalTokens / activeSession.maxContextTokens) * 100);
          const clr = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
          return (
            <div className="shrink-0 px-4 py-1 border-t border-slate-100/50 dark:border-white/[0.03] flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-slate-200/40 dark:bg-white/5 overflow-hidden">
                <div className={`h-full rounded-full ${clr} transition-all duration-500`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[8px] font-mono text-slate-400 dark:text-white/25 tabular-nums shrink-0">
                {(activeSession.totalTokens / 1000).toFixed(1)}k / {(activeSession.maxContextTokens / 1000).toFixed(0)}k
              </span>
            </div>
          );
        })() : null}

        {/* Input Area */}
        <div className="p-3 md:p-4 shrink-0 border-t border-slate-100 dark:border-white/5 bg-white/80 dark:bg-[#0d1117]/80 backdrop-blur-xl">
          <div className="max-w-4xl mx-auto relative">
            {/* Slash Command Popup */}
            {slashOpen && slashFiltered.length > 0 && (
              <div ref={slashRef}
                className="absolute bottom-full start-0 end-0 mb-2 max-h-64 overflow-y-auto custom-scrollbar rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a1c20] shadow-2xl shadow-black/10 dark:shadow-black/40 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="px-3 py-2 border-b border-slate-100 dark:border-white/5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] text-primary">terminal</span>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider">{c.slashCommands}</span>
                  <span className="text-[11px] text-slate-400 dark:text-white/20 ms-auto">{slashFiltered.length}</span>
                </div>
                {(() => {
                  let lastCat = '';
                  return slashFiltered.map((s, i) => {
                    const showCat = s.cat !== lastCat;
                    lastCat = s.cat;
                    return (
                      <div key={s.cmd}>
                        {showCat && (
                          <div className="px-3 pt-2 pb-0.5">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-white/20 uppercase tracking-widest">{CAT_LABELS[s.cat] || s.cat}</span>
                          </div>
                        )}
                        <button
                          onMouseDown={e => { e.preventDefault(); selectSlashCommand(s.cmd); }}
                          className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-start transition-colors ${i === slashHighlight
                            ? 'bg-primary/10 dark:bg-primary/15'
                            : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]'
                            }`}>
                          <span className={`material-symbols-outlined text-[16px] ${i === slashHighlight ? 'text-primary' : 'text-slate-400 dark:text-white/35'}`}>{s.icon}</span>
                          <span className={`text-[12px] font-bold font-mono ${i === slashHighlight ? 'text-primary' : 'text-slate-700 dark:text-white/60'}`}>{s.cmd}</span>
                          <span className="text-[10px] text-slate-400 dark:text-white/35 truncate">{s.desc}</span>
                        </button>
                      </div>
                    );
                  });
                })()}
                {slashFiltered.length === 0 && (
                  <div className="px-3 py-4 text-center text-[10px] text-slate-400 dark:text-white/20">{c.noCommandMatch}</div>
                )}
              </div>
            )}
            <div className="relative bg-white dark:bg-gradient-to-br dark:from-[#1a1c22] dark:to-[#14161a] border border-slate-200/80 dark:border-white/[0.08] rounded-2xl md:rounded-[22px] p-1.5 md:p-2 shadow-xl shadow-black/5 dark:shadow-black/30 transition-all sci-input">
              {/* Pending attachment previews */}
              {(pendingAttachments?.length || 0) > 0 && (
                <div className="flex gap-1.5 px-1.5 pt-1 pb-1.5 overflow-x-auto">
                  {(pendingAttachments || []).map((att, i) => (
                    <div key={i} className="relative shrink-0 group/img">
                      {att.isImage ? (
                        <img src={att.dataUrl} alt={att.fileName}
                          className="w-14 h-14 rounded-lg object-cover border border-slate-200 dark:border-white/10" />
                      ) : (
                        <div className="w-14 h-14 rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] flex flex-col items-center justify-center gap-0.5">
                          <span className="material-symbols-outlined text-[16px] text-slate-400">description</span>
                          <span className="text-[7px] text-slate-500 dark:text-white/40 truncate max-w-[48px] px-0.5">{att.fileName.split('.').pop()}</span>
                        </div>
                      )}
                      <button onClick={() => removePendingAttachment(i)}
                        className="absolute -top-1 -end-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity">
                        <span className="material-symbols-outlined text-[10px]">close</span>
                      </button>
                      <span className="absolute bottom-0.5 start-0.5 text-[7px] bg-black/50 text-white px-1 rounded truncate max-w-[52px]">{att.isImage ? att.mimeType.split('/')[1] : att.fileName.length > 8 ? att.fileName.slice(0, 6) + '..' : att.fileName}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-1.5">
                <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.csv,.md,.json,.xml,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.tar,.gz" multiple className="hidden" onChange={handleFileSelect} />
                <button onClick={() => fileInputRef.current?.click()} disabled={!gwReady || (pendingAttachments?.length || 0) >= 5}
                  className="w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center shrink-0 text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors disabled:opacity-30"
                  title={c.attachFile || 'Attach File'}>
                  <span className="material-symbols-outlined text-[18px]">attach_file</span>
                </button>
                <textarea
                  ref={textareaRef}
                  rows={1}
                  className="flex-1 bg-transparent border-none text-[13px] md:text-sm text-slate-800 dark:text-white py-2 px-2 focus:ring-0 outline-none resize-none max-h-40 placeholder:text-slate-400 dark:placeholder:text-white/25"
                  placeholder={(pendingAttachments?.length || 0) > 0 ? (c.attachCaption || c.imageCaption || 'Add a caption...') : c.inputPlaceholder}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  disabled={!gwReady}
                />
                {isStreaming ? (
                  <button onClick={handleAbort}
                    className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-red-500 text-white flex items-center justify-center shrink-0 shadow-lg transition-all hover:bg-red-600 active:scale-95">
                    <span className="material-symbols-outlined text-[18px]">stop</span>
                  </button>
                ) : (
                  <button onClick={sendMessage}
                    disabled={(!input.trim() && !(pendingAttachments?.length)) || sending || !gwReady}
                    className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90 ${(input.trim() || (pendingAttachments?.length || 0) > 0) && !sending && gwReady
                      ? 'bg-gradient-to-br from-primary to-primary/80 text-white shadow-lg shadow-primary/30 hover:shadow-primary/40 hover:scale-105 send-btn-glow'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-400'
                      }`}>
                    <span className={`material-symbols-outlined text-[18px] md:text-[20px] ${sending ? 'animate-spin' : ''}`}>
                      {sending ? 'progress_activity' : 'arrow_upward'}
                    </span>
                  </button>
                )}
              </div>
            </div>
            <div className="hidden md:flex items-center justify-between text-[11px] text-slate-400 dark:text-white/20 mt-2 px-1">
              <span>{c.poweredBy}</span>
              <div className="flex items-center gap-3">
                {input.length > 0 && <span className="tabular-nums">{input.length}</span>}
                <span className="text-slate-300 dark:text-white/15">Shift+Enter {c.newLine || 'new line'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
      {/* Usage Panel */}
      <UsagePanel
        sessionKey={sessionKey}
        gwReady={gwReady}
        loadUsage={async (key) => {
          const res = await gwApi.sessionsUsage({ key, limit: 1 }) as any;
          const entry = res?.sessions?.[0];
          return entry?.usage ?? null;
        }}
        labels={c}
        session={{
          model: activeSession?.model,
          modelProvider: activeSession?.modelProvider,
          totalTokens: activeSession?.totalTokens,
          maxContextTokens: activeSession?.maxContextTokens,
          compacted: activeSession?.compacted,
          thinkingLevel: activeSession?.thinkingLevel,
          messageCount: messages.length || undefined,
          lastLatencyMs: lastLatencyMs,
          liveElapsed: liveElapsed,
          runPhase: runPhase,
        }}
      />
      {/* Inject System Message Modal */}
      {injectOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl p-5">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-purple-500">add_comment</span>
              {c.inject}
            </h3>

            {injectResult && (
              <div className={`mb-3 px-3 py-2 rounded-xl text-[10px] ${injectResult.ok ? 'bg-mac-green/10 text-mac-green border border-mac-green/20' : 'bg-red-50 dark:bg-red-500/5 text-red-500 border border-red-200 dark:border-red-500/20'}`}>
                {injectResult.text}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">{c.injectLabel}</label>
                <input value={injectLabel} onChange={e => setInjectLabel(e.target.value)}
                  placeholder={c.injectLabelPlaceholder}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] text-slate-800 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                  disabled={injecting} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">{c.inject}</label>
                <textarea value={injectMsg} onChange={e => setInjectMsg(e.target.value)}
                  placeholder={c.injectPlaceholder}
                  rows={4}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] text-slate-800 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-purple-500/30 resize-none"
                  disabled={injecting} />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => { setInjectOpen(false); setInjectResult(null); }} disabled={injecting}
                className="px-4 py-2 rounded-xl text-[11px] font-bold text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">{c.cancel}</button>
              <button onClick={handleInject} disabled={injecting || !injectMsg.trim()}
                className="px-4 py-2 rounded-xl bg-purple-500 text-white text-[11px] font-bold disabled:opacity-40 transition-all">
                {injecting ? c.injecting : c.inject}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Session Modal */}
      {renameOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm"
          onClick={() => !renaming && setRenameOpen(false)}>
          <div className="w-full max-w-sm mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl p-5"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">edit</span>
              {c.renameSession}
            </h3>

            <div>
              <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">{c.sessionLabel}</label>
              <input
                value={renameLabel}
                onChange={e => setRenameLabel(e.target.value)}
                placeholder={c.sessionLabelPlaceholder}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] text-slate-800 dark:text-white/80 focus:outline-none focus:ring-2 focus:ring-primary/30"
                disabled={renaming}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') handleRenameSession(); }}
              />
              <p className="text-[10px] text-slate-400 dark:text-white/30 mt-1.5">
                Key: <code className="font-mono bg-slate-100 dark:bg-white/5 px-1 rounded">{renameKey}</code>
              </p>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setRenameOpen(false)} disabled={renaming}
                className="px-4 py-2 rounded-xl text-[11px] font-bold text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                {c.cancel}
              </button>
              <button onClick={handleRenameSession} disabled={renaming}
                className="px-4 py-2 rounded-xl bg-primary text-white text-[11px] font-bold disabled:opacity-40 transition-all flex items-center gap-1.5">
                {renaming && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                {renaming ? c.renaming : c.renameSession}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmKey && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm"
          onClick={() => !deleting && setDeleteConfirmKey(null)}>
          <div className="w-full max-w-sm mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl p-5"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px] text-red-500">delete</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-white">{c.deleteSession}</h3>
                <p className="text-[11px] text-slate-500 dark:text-white/40">{c.confirmDeleteSession}</p>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-white/[0.02] rounded-xl p-3 mb-4">
              <p className="text-[10px] text-slate-400 dark:text-white/30 mb-1">Session Key</p>
              <code className="text-[11px] font-mono text-slate-700 dark:text-white/70 break-all">{deleteConfirmKey}</code>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirmKey(null)} disabled={deleting}
                className="px-4 py-2 rounded-xl text-[11px] font-bold text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                {c.cancel}
              </button>
              <button onClick={() => handleDeleteSession(deleteConfirmKey)} disabled={deleting}
                className="px-4 py-2 rounded-xl bg-red-500 text-white text-[11px] font-bold disabled:opacity-40 transition-all flex items-center gap-1.5">
                {deleting && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                {deleting ? c.deleting : c.deleteSession}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Session Repair Panel */}
      {repairOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setRepairOpen(false)}>
          <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl p-5"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px] text-emerald-500">healing</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-white">{c.repair}</h3>
                <p className="text-[11px] text-slate-500 dark:text-white/40">{c.repairDesc}</p>
              </div>
            </div>

            {repairScanning && (
              <div className="flex items-center justify-center gap-2 py-8 text-slate-400 dark:text-white/40">
                <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
                <span className="text-[11px]">{c.repairScanning}</span>
              </div>
            )}

            {!repairScanning && repairIssues.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400 dark:text-white/40">
                <span className="material-symbols-outlined text-[32px] text-emerald-400 mb-2">check_circle</span>
                <span className="text-[12px] font-bold text-emerald-500">{c.repairHealthy}</span>
              </div>
            )}

            {!repairScanning && repairIssues.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-amber-500">
                    {(c.repairIssuesFound || '').replace('{{n}}', String(repairIssues.length))}
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1.5">
                  {repairIssues.map((issue, i) => (
                    <div key={`${issue.key}-${issue.type}-${i}`} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200/50 dark:border-white/[0.06]">
                      <span className={`material-symbols-outlined text-[14px] ${issue.type === 'overflow' ? 'text-red-400' : 'text-slate-400'}`}>
                        {issue.type === 'overflow' ? 'data_usage' : 'schedule'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-slate-700 dark:text-white/70 truncate">{issue.label}</p>
                        <p className="text-[10px] text-slate-400 dark:text-white/30">{issue.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-2">
                  {repairIssues.some(i => i.type === 'overflow') && (
                    <button onClick={handleRepairCompactAll} disabled={repairFixing}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-bold hover:bg-amber-500/20 disabled:opacity-40 transition-colors">
                      <span className="material-symbols-outlined text-[14px]">compress</span>
                      {c.repairCompactAll}
                    </button>
                  )}
                  {repairIssues.some(i => i.type === 'stale') && (
                    <button onClick={handleRepairDeleteStale} disabled={repairFixing}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 text-red-500 text-[11px] font-bold hover:bg-red-500/20 disabled:opacity-40 transition-colors">
                      <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
                      {c.repairDeleteStale}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-200/50 dark:border-white/5">
              <button onClick={handleRepairScan} disabled={repairScanning}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-primary hover:bg-primary/10 disabled:opacity-40 transition-colors flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">refresh</span>
                {c.repairScan}
              </button>
              <button onClick={() => setRepairOpen(false)}
                className="px-4 py-1.5 rounded-lg text-[11px] font-bold text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                {c.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Sessions;
