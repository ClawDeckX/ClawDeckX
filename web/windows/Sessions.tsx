
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gatewayApi, gwApi } from '../services/api';
import { subscribeManagerWS } from '../services/manager-ws';

interface SessionsProps {
  language: Language;
  pendingSessionKey?: string | null;
  onSessionKeyConsumed?: () => void;
}

interface GwSession {
  key: string;
  label?: string;
  kind?: string;
  lastActiveAt?: string;
  totalTokens?: number;
}

interface ChatMsg {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: unknown;
  timestamp?: number;
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

function extractToolCalls(content: unknown): Array<{ name: string; input?: string }> {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: any) => b?.type === 'tool_use')
    .map((b: any) => ({ name: b.name || 'tool', input: b.input ? JSON.stringify(b.input, null, 2) : undefined }));
}

function fmtTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const Sessions: React.FC<SessionsProps> = ({ language, pendingSessionKey, onSessionKeyConsumed }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const c = t.chat as any;
  const sessionDefault = (t as any).dash?.sessionDefault || c.sessionKey;

  // Shared Manager WS subscription for chat streaming events
  const handleChatEventRef = useRef<(payload?: any) => void>(() => { });
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsConnecting, setWsConnecting] = useState(true);
  const [gwReady, setGwReady] = useState(false);
  const [gwChecked, setGwChecked] = useState(false);
  const lastGwReconnectAtRef = useRef(0);

  // Sessions
  const [sessions, setSessions] = useState<GwSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
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
          setTalkMode(msg.data?.mode || null);
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
        setStream(text);
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
      setSessions(list.map((s: any) => ({
        key: s.key || s.id || '',
        label: s.derivedTitle || s.label || s.displayName || s.key || '',
        kind: s.chatType || s.kind || '',
        lastActiveAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : '',
        totalTokens: s.totalTokens || 0,
      })));
    } catch { /* ignore */ }
    finally { setSessionsLoading(false); }
  }, [gwReady]);

  // Load chat history (via REST proxy)
  const loadHistory = useCallback(async (opts?: { silent?: boolean }) => {
    if (!gwReady) return;
    if (!opts?.silent) {
      setChatLoading(true);
    }
    try {
      const res = await gwApi.proxy('chat.history', { sessionKey, limit: 200 }) as any;
      const msgs = Array.isArray(res?.messages) ? res.messages : [];
      setMessages(msgs.map((m: any) => ({
        role: m.role || 'assistant',
        content: m.content,
        timestamp: m.timestamp || m.ts,
      })));
    } catch {
      setMessages([]);
    } finally {
      if (!opts?.silent) {
        setChatLoading(false);
      }
    }
  }, [gwReady, sessionKey]);

  // On ready: load sessions list and refresh it periodically.
  useEffect(() => {
    if (!gwReady) return;
    loadSessions();
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
  }, [gwReady, loadSessions]);

  // Load chat history only when selected session changes.
  useEffect(() => {
    if (gwReady) {
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

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
  }, [messages, stream]);

  // Send message (via REST proxy; streaming events come via Manager WS)
  const sendMessage = useCallback(async () => {
    if (!gwReady || sending || isStreaming) return;
    const msg = input.trim();
    if (!msg) return;

    // Optimistic user message
    setMessages(prev => [...prev, { role: 'user', content: [{ type: 'text', text: msg }], timestamp: Date.now() }]);
    setInput('');
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
  }, [gwReady, input, sending, isStreaming, sessionKey, messages.length, c.error]);

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
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
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

  // Select session
  const selectSession = useCallback((key: string) => {
    setSessionKey(key);
    setMessages([]);
    setStream(null);
    setRunId(null);
    setRunPhase('idle');
    pendingRunRef.current = null;
    setDrawerOpen(false);
  }, []);

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage, slashOpen, slashFiltered, slashHighlight, selectSlashCommand]);

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

  const activeLabel = sessions.find(s => s.key === sessionKey)?.label || sessionKey;

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
        <div className="md:hidden fixed top-[32px] bottom-[72px] left-0 right-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Sidebar — desktop: static, mobile: slide-out drawer */}
      <aside className={`fixed md:static top-[32px] bottom-[72px] md:top-auto md:bottom-auto left-0 z-50 w-72 md:w-64 lg:w-72 border-r border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0d1117] md:bg-slate-50/80 md:dark:bg-black/20 flex flex-col shrink-0 transform transition-transform duration-200 ease-out ${drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-3 border-b border-slate-200 dark:border-white/5">
          <button onClick={handleNewSession}
            className="w-full bg-primary text-white text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all active:scale-[0.98]">
            <span className="material-symbols-outlined text-sm">add</span> {c.new}
          </button>
        </div>

        {/* Session Key Input */}
        <div className="px-3 py-2 border-b border-slate-200 dark:border-white/5">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/20 text-[14px]">key</span>
            <input value={sessionKey} onChange={e => setSessionKey(e.target.value)}
              onBlur={() => loadHistory()}
              className="w-full h-8 pl-7 pr-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-mono text-slate-700 dark:text-white/70 focus:ring-1 focus:ring-primary/50 outline-none"
              placeholder={c.sessionKey} />
          </div>
        </div>

        {/* Sessions List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {sessionsLoading && sessions.length === 0 && !wsConnecting && (
            <div className="text-center py-8 text-slate-400 dark:text-white/20">
              <span className="material-symbols-outlined text-[20px] block mb-1 animate-spin">progress_activity</span>
              <span className="text-[10px]">{c.loading}</span>
            </div>
          )}
          {sessions.length === 0 && !sessionsLoading && !wsConnecting && (
            <div className="text-center py-8 text-slate-400 dark:text-white/20">
              <span className="material-symbols-outlined text-[24px] block mb-1">chat_bubble_outline</span>
              <span className="text-[10px]">{c.noSessions}</span>
            </div>
          )}
          {sessions.map(s => (
            <div key={s.key} className="relative group">
              <button onClick={() => selectSession(s.key)}
                className={`w-full text-left p-2.5 rounded-xl transition-all border ${sessionKey === s.key
                  ? 'bg-primary/10 border-primary/20 shadow-sm'
                  : 'border-transparent hover:bg-slate-200/50 dark:hover:bg-white/5'
                  }`}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${s.kind === 'direct' ? 'bg-blue-500/10 text-blue-500' :
                    s.kind === 'group' ? 'bg-purple-500/10 text-purple-500' :
                      'bg-slate-200 dark:bg-white/5 text-slate-400 dark:text-white/40'
                    }`}>{s.kind || sessionDefault}</span>
                  {s.totalTokens ? <span className="text-[10px] text-slate-400 dark:text-white/20 font-mono">{(s.totalTokens / 1000).toFixed(1)}k</span> : null}
                </div>
                <h4 className={`text-[11px] font-bold truncate pr-12 ${sessionKey === s.key ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-white/50'}`}>
                  {s.label || s.key}
                </h4>
                {s.lastActiveAt && (
                  <p className="text-[11px] text-slate-400 dark:text-white/20 mt-0.5">{new Date(s.lastActiveAt).toLocaleString()}</p>
                )}
              </button>
              {/* Hover actions */}
              <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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

        {/* Connection Status */}
        <div className="px-3 py-2 border-t border-slate-200 dark:border-white/5 flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${gwReady ? 'bg-mac-green animate-pulse' : wsConnecting ? 'bg-mac-yellow animate-pulse' : 'bg-slate-300'}`} />
          <span className="text-[11px] font-medium text-slate-400 dark:text-white/40">
            {gwReady ? c.connected : wsConnecting ? c.connecting : c.disconnected}
          </span>
        </div>
      </aside>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Header */}
        <header className="px-4 md:px-6 py-2.5 md:py-3 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0 bg-white/80 dark:bg-black/40 backdrop-blur-xl z-10">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <button onClick={() => setDrawerOpen(true)}
              className="md:hidden p-1.5 -ml-1 text-slate-500 dark:text-white/50 hover:text-primary hover:bg-primary/5 rounded-lg transition-all">
              <span className="material-symbols-outlined text-[20px]">menu</span>
            </button>
            <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20 shrink-0">
              <span className="material-symbols-outlined text-[18px] md:text-[20px]">smart_toy</span>
            </div>
            <div className="truncate">
              <h2 className="text-xs md:text-sm font-bold text-slate-900 dark:text-white truncate">{activeLabel}</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1 h-1 rounded-full ${gwReady ? 'bg-mac-green' : 'bg-slate-300'}`} />
                <span className="text-[11px] text-slate-400 font-medium font-mono">{sessionKey}</span>
                <span className="text-slate-300 dark:text-white/15">|</span>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${runPhaseMeta.textClass}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${runPhaseMeta.dot}`} />
                  {runPhaseMeta.text}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
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
            <button onClick={() => { loadSessions(); loadHistory(); }}
              className="p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-colors">
              <span className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
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
              <div className="flex flex-col items-center justify-center py-10 md:py-16">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-[32px] text-primary">chat</span>
                </div>
                <p className="text-sm font-medium text-slate-600 dark:text-white/40 mb-1">{c.welcome}</p>
                <p className="text-[10px] text-slate-400 dark:text-white/20 mb-6">{c.slashHint}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full max-w-lg">
                  {[
                    { cmd: '/status', icon: 'info', label: c.quickStatus, color: 'text-blue-500 bg-blue-500/10' },
                    { cmd: '/model', icon: 'smart_toy', label: c.quickModel, color: 'text-emerald-500 bg-emerald-500/10' },
                    { cmd: '/think', icon: 'psychology', label: c.quickThink, color: 'text-purple-500 bg-purple-500/10' },
                    { cmd: '/compact', icon: 'compress', label: c.quickCompact, color: 'text-amber-500 bg-amber-500/10' },
                    { cmd: '/new', icon: 'restart_alt', label: c.quickReset, color: 'text-red-400 bg-red-500/10' },
                    { cmd: '/help', icon: 'help', label: c.quickHelp, color: 'text-slate-500 bg-slate-500/10' },
                  ].map(q => (
                    <button key={q.cmd} onClick={() => selectSlashCommand(q.cmd)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] hover:border-primary/30 hover:shadow-sm transition-all text-left group">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${q.color}`}>
                        <span className="material-symbols-outlined text-[16px]">{q.icon}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[11px] font-bold text-slate-700 dark:text-white/70 block truncate">{q.cmd}</span>
                        <span className="text-[11px] text-slate-400 dark:text-white/35 block truncate">{q.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chatLoading && messages.length === 0 && (
              <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
                <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
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
              const isUser = msg.role === 'user';
              const isSystem = msg.role === 'system';
              const isTool = msg.role === 'tool';

              if (isSystem) {
                return (
                  <div key={idx} className="flex justify-center">
                    <div className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 text-[10px] text-slate-500 dark:text-white/40 font-medium">
                      {text}
                    </div>
                  </div>
                );
              }

              if (isTool) {
                return (
                  <div key={idx} className="ml-10 md:ml-12">
                    <div className="rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 p-3 text-[10px]">
                      <div className="flex items-center gap-1.5 mb-1.5 text-slate-500 dark:text-white/40">
                        <span className="material-symbols-outlined text-[12px]">build</span>
                        <span className="font-bold uppercase tracking-wider">{c.toolResult}</span>
                      </div>
                      <pre className="text-[10px] font-mono text-slate-600 dark:text-white/40 whitespace-pre-wrap break-all max-h-32 overflow-y-auto custom-scrollbar">{text}</pre>
                    </div>
                  </div>
                );
              }

              return (
                <div key={idx} className={`flex items-start gap-2.5 md:gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
                  <div className={`w-7 h-7 md:w-8 md:h-8 shrink-0 rounded-xl flex items-center justify-center border mt-0.5 ${isUser
                    ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-black border-slate-700 dark:border-slate-300'
                    : 'bg-primary/10 border-primary/20 text-primary'
                    }`}>
                    <span className="material-symbols-outlined text-[14px] md:text-[16px]">
                      {isUser ? 'person' : 'smart_toy'}
                    </span>
                  </div>
                  <div className={`max-w-[85%] md:max-w-[75%] group ${isUser ? 'text-right' : ''}`}>
                    <div className={`p-3 md:p-3.5 rounded-2xl shadow-sm border ${isUser
                      ? 'bg-primary text-white border-primary/30 rounded-tr-sm'
                      : 'bg-white dark:bg-white/[0.03] text-slate-800 dark:text-slate-200 border-slate-200 dark:border-white/[0.06] rounded-tl-sm'
                      }`}>
                      <div className="text-[12px] md:text-[13px] leading-relaxed whitespace-pre-wrap break-words">{text}</div>

                      {/* Tool calls */}
                      {tools.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {tools.map((tool, ti) => (
                            <div key={ti} className="rounded-lg bg-black/5 dark:bg-white/5 p-2 text-[10px]">
                              <div className="flex items-center gap-1 text-primary font-bold mb-1">
                                <span className="material-symbols-outlined text-[11px]">build</span>
                                {tool.name}
                              </div>
                              {tool.input && (
                                <pre className="font-mono text-[11px] text-slate-500 dark:text-white/40 whitespace-pre-wrap break-all max-h-20 overflow-hidden">{tool.input}</pre>
                              )}
                            </div>
                          ))}
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
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Streaming indicator */}
            {stream !== null && (
              <div className="flex items-start gap-2.5 md:gap-3">
                <div className="w-7 h-7 md:w-8 md:h-8 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mt-0.5">
                  <span className="material-symbols-outlined text-[14px] md:text-[16px]">smart_toy</span>
                </div>
                <div className="max-w-[85%] md:max-w-[75%]">
                  <div className="p-3 md:p-3.5 rounded-2xl rounded-tl-sm shadow-sm border bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/[0.06]">
                    {stream ? (
                      <div className="text-[12px] md:text-[13px] leading-relaxed whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">
                        {stream}
                        <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 align-text-bottom" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-slate-400">
                        <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                        <span className="text-[11px]">{c.thinking}</span>
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
        </div>

        {/* Input Area */}
        <div className="p-3 md:p-4 shrink-0 border-t border-slate-100 dark:border-white/5 bg-white/80 dark:bg-[#0d1117]/80 backdrop-blur-xl">
          <div className="max-w-3xl mx-auto relative">
            {/* Slash Command Popup */}
            {slashOpen && slashFiltered.length > 0 && (
              <div ref={slashRef}
                className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto custom-scrollbar rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a1c20] shadow-2xl shadow-black/10 dark:shadow-black/40 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="px-3 py-2 border-b border-slate-100 dark:border-white/5 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] text-primary">terminal</span>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider">{c.slashCommands}</span>
                  <span className="text-[11px] text-slate-400 dark:text-white/20 ml-auto">{slashFiltered.length}</span>
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
                          className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${i === slashHighlight
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
            <div className="relative flex items-end gap-1.5 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl md:rounded-[22px] p-1.5 md:p-2 shadow-xl shadow-black/5 dark:shadow-black/20 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
              <textarea
                ref={textareaRef}
                rows={1}
                className="flex-1 bg-transparent border-none text-[13px] md:text-sm text-slate-800 dark:text-white py-2 px-2 focus:ring-0 outline-none resize-none max-h-40 placeholder:text-slate-400 dark:placeholder:text-white/25"
                placeholder={c.inputPlaceholder}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={!gwReady}
              />
              {isStreaming ? (
                <button onClick={handleAbort}
                  className="w-9 h-9 md:w-10 md:h-10 rounded-full bg-red-500 text-white flex items-center justify-center shrink-0 shadow-lg transition-all hover:bg-red-600 active:scale-95">
                  <span className="material-symbols-outlined text-[18px]">stop</span>
                </button>
              ) : (
                <button onClick={sendMessage}
                  disabled={!input.trim() || sending || !gwReady}
                  className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 ${input.trim() && !sending && gwReady
                    ? 'bg-primary text-white shadow-lg shadow-primary/30'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-400'
                    }`}>
                  <span className="material-symbols-outlined text-[18px] md:text-[20px]">
                    {sending ? 'progress_activity' : 'arrow_upward'}
                  </span>
                </button>
              )}
            </div>
            <p className="hidden md:block text-[11px] text-center text-slate-400 dark:text-white/20 mt-2">
              {c.poweredBy}
            </p>
          </div>
        </div>
      </div>
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
    </div>
  );
};

export default Sessions;
