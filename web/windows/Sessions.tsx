
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Language, dispatchOpenWindow } from '../types';
import { getTranslation } from '../locales';
import { gwApi } from '../services/api';
import { useGatewayStatus } from '../hooks/useGatewayStatus';
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
import { extractImages, extractThinking, hasImages, hasThinking, stripSilentSentinel } from '../utils/content-blocks';
import { groupMessages, isFirstInGroup, isLastInGroup } from '../utils/message-grouping';
import { resolveEffectivePolicy } from '../utils/exec-policy';

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
  fastMode?: boolean;
  lastTo?: string;
  parentKey?: string;
  spawnedBy?: string;
  status?: 'running' | 'done' | 'failed' | 'killed' | 'timeout';
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  abortedLastRun?: boolean;
  estimatedCostUsd?: number;
  runner?: string;
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
  sendFailed?: boolean;
  sendError?: string;
}

type ChatRunPhase = 'idle' | 'sending' | 'waiting' | 'streaming' | 'running' | 'error';

interface LiveToolCall {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  phase: 'start' | 'running' | 'done';
  startedAt?: number;
  endedAt?: number;
  meta?: Record<string, unknown>;
  expanded?: boolean;
}

/** Extract original-case peer ID from a session's lastTo field.
 *  lastTo format is typically "channel:<peerId>" (e.g. "channel:wrG05CBgAAdaBosTJfzemv-S9FYE66yQ").
 *  Returns the peerId portion preserving original casing, or null if not extractable.
 */
function extractPeerIdFromLastTo(lastTo: string | undefined): string | null {
  if (!lastTo) return null;
  // Format: "channel:<peerId>" or "room:<peerId>" — extract after first ":"
  const idx = lastTo.indexOf(':');
  if (idx >= 0 && idx < lastTo.length - 1) {
    return lastTo.slice(idx + 1).trim() || null;
  }
  return lastTo.trim() || null;
}

/** Parse peer info from an agent session key. Format: agent:<agentId>:<rest> where rest can be:
 *  - <channel>:group:<peerId>  (group chat)
 *  - <channel>:channel:<peerId> (channel chat)
 *  - <channel>:direct:<peerId> (DM per-channel-peer)
 *  - main (main session, no peer)
 */
function parseSessionKeyPeer(sessionKey: string): { channel: string; peerKind: string; peerId: string; accountId: string } | null {
  const parts = sessionKey.trim().toLowerCase().split(':').filter(Boolean);
  // agent:<agentId>:<channel>:<peerKind>:<peerId...>
  if (parts.length < 5 || parts[0] !== 'agent') return null;
  const channel = parts[2];
  const peerKind = parts[3];
  if (!channel || !peerKind) return null;
  if (!['group', 'channel', 'direct'].includes(peerKind)) return null;
  // peerId may contain colons (e.g. thread suffixes), take everything after peerKind
  const peerId = parts.slice(4).join(':');
  if (!peerId) return null;
  // Strip thread suffix if present
  const threadIdx = peerId.indexOf(':thread:');
  const cleanPeerId = threadIdx >= 0 ? peerId.slice(0, threadIdx) : peerId;
  return { channel, peerKind, peerId: cleanPeerId, accountId: 'default' };
}

/** 判断一个 session key 是否属于 AgentRoom（包含主会话 key 与 aux key）。
 *  约定：
 *    - agent:<agentId>:agentroom:<roomId>:<memberId>
 *    - agent:<agentId>:agentroom-aux:<roomId>
 */
function isAgentRoomSessionKey(sessionKey: string | null | undefined): boolean {
  if (!sessionKey) return false;
  const parts = sessionKey.trim().toLowerCase().split(':').filter(Boolean);
  if (parts.length < 4 || parts[0] !== 'agent') return false;
  return parts[2] === 'agentroom' || parts[2] === 'agentroom-aux';
}

function isProtectedMainSessionKey(sessionKey: string | null | undefined): boolean {
  if (!sessionKey) return false;
  const trimmed = sessionKey.trim().toLowerCase();
  if (trimmed === 'main') return true;
  const parts = trimmed.split(':').filter(Boolean);
  return parts.length === 3 && parts[0] === 'agent' && parts[2] === 'main';
}

interface MarkdownMessageBoundaryProps {
  content: string;
  streaming?: boolean;
  copyCodeLabel?: string;
}

interface MarkdownMessageBoundaryState {
  hasError: boolean;
}

class MarkdownMessageBoundary extends React.Component<MarkdownMessageBoundaryProps, MarkdownMessageBoundaryState> {
  state: MarkdownMessageBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MarkdownMessageBoundaryState {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: MarkdownMessageBoundaryProps) {
    if (this.state.hasError && (prevProps.content !== this.props.content || prevProps.streaming !== this.props.streaming)) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return <pre className="text-[11px] whitespace-pre-wrap break-words text-text">{this.props.content}</pre>;
    }
    return <MarkdownRenderer content={this.props.content} streaming={this.props.streaming} labels={{ copyCode: this.props.copyCodeLabel }} />;
  }
}

const WAITING_PHRASE_KEYS = [
  'waitPondering', 'waitConjuring', 'waitNoodling', 'waitMoseying', 'waitHobnobbing',
  'waitKerfuffling', 'waitDillydallying', 'waitTwiddling', 'waitBamboozling',
] as const;

function appendMessageDedup(
  prev: ChatMsg[],
  next: ChatMsg,
  recentRef?: React.MutableRefObject<Set<string>>,
): ChatMsg[] {
  const text = extractText(next.content);
  const ts = next.timestamp || 0;
  // Ref-based guard: prevent React 18 batching from allowing duplicates
  // when two setMessages updaters run against the same base state.
  // Include 10s time bucket so identical text at different times isn't falsely deduped.
  const tsBucket = ts ? Math.floor(ts / 10000) : 0;
  const fingerprint = `${next.role}:${tsBucket}:${text}`;
  if (recentRef?.current.has(fingerprint)) return prev;
  const duplicated = prev.some((m) => {
    if (m.role !== next.role) return false;
    const mt = m.timestamp || 0;
    if (ts && mt && Math.abs(mt - ts) > 30000) return false;
    return extractText(m.content) === text;
  });
  if (duplicated) return prev;
  // Mark as recently added; clear after a short delay
  if (recentRef) {
    recentRef.current.add(fingerprint);
    setTimeout(() => recentRef.current.delete(fingerprint), 5000);
    // Cap set size to prevent unbounded growth in long sessions
    if (recentRef.current.size > 200) {
      const first = recentRef.current.values().next().value;
      if (first) recentRef.current.delete(first);
    }
  }
  return [...prev, next];
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

function summarizeToolArgs(toolName: string, args: unknown, maxLen = 60): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  // Common tool patterns — show the most relevant arg
  if (a.command && typeof a.command === 'string') return truncStr(a.command, maxLen);
  if (a.path && typeof a.path === 'string') return truncStr(a.path, maxLen);
  if (a.file_path && typeof a.file_path === 'string') return truncStr(String(a.file_path), maxLen);
  if (a.query && typeof a.query === 'string') return truncStr(a.query, maxLen);
  if (a.url && typeof a.url === 'string') return truncStr(String(a.url), maxLen);
  if (a.message && typeof a.message === 'string') return truncStr(a.message, maxLen);
  if (a.content && typeof a.content === 'string') return truncStr(a.content, maxLen);
  // Fallback: first string value
  for (const v of Object.values(a)) {
    if (typeof v === 'string' && v.length > 0) return truncStr(v, maxLen);
  }
  return '';
}

function summarizeToolResult(result: unknown, maxLen = 80): string {
  if (!result) return '';
  if (typeof result === 'string') return truncStr(result, maxLen);
  if (typeof result === 'object') {
    try { return truncStr(JSON.stringify(result), maxLen); } catch { return ''; }
  }
  return '';
}

function truncStr(s: string, max: number): string {
  const clean = s.replace(/\n/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function getMessageRenderKey(msg: ChatMsg, idx: number): string {
  const text = extractText(msg.content).slice(0, 80);
  const toolId = typeof msg.content === 'object' && msg.content && !Array.isArray(msg.content)
    ? String((msg.content as any).tool_use_id || (msg.content as any).id || '')
    : '';
  return [msg.role, msg.timestamp || 0, msg.model || '', toolId, text, idx].join(':');
}

function areSessionsEquivalent(a: GwSession[], b: GwSession[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((session, idx) => {
    const next = b[idx];
    if (!next) return false;
    return session.key === next.key &&
      session.label === next.label &&
      session.kind === next.kind &&
      session.lastActiveAt === next.lastActiveAt &&
      session.totalTokens === next.totalTokens &&
      session.lastMessagePreview === next.lastMessagePreview &&
      session.model === next.model &&
      session.modelProvider === next.modelProvider &&
      session.inputTokens === next.inputTokens &&
      session.outputTokens === next.outputTokens &&
      session.thinkingLevel === next.thinkingLevel &&
      session.verboseLevel === next.verboseLevel &&
      session.reasoningLevel === next.reasoningLevel &&
      session.sendPolicy === next.sendPolicy &&
      session.derivedTitle === next.derivedTitle &&
      session.maxContextTokens === next.maxContextTokens &&
      session.compacted === next.compacted &&
      session.fastMode === next.fastMode &&
      session.parentKey === next.parentKey &&
      session.spawnedBy === next.spawnedBy &&
      session.status === next.status &&
      session.startedAt === next.startedAt &&
      session.runtimeMs === next.runtimeMs &&
      session.estimatedCostUsd === next.estimatedCostUsd;
  });
}

/* ── In-memory config cache (avoids re-fetch on re-mount) ── */
let _cfgCache: { data: any; ts: number } | null = null;
const CFG_CACHE_TTL = 60_000;
async function getCachedConfig() {
  if (_cfgCache && Date.now() - _cfgCache.ts < CFG_CACHE_TTL) return _cfgCache.data;
  const data = await gwApi.configGet();
  _cfgCache = { data, ts: Date.now() };
  return data;
}

function getSessionModelKey(session?: { model?: string; modelProvider?: string } | null): string {
  // Gateway sessions often split provider/model; config lookup uses provider/model.
  const provider = session?.modelProvider?.trim();
  const model = session?.model?.trim();
  if (provider && model) return `${provider}/${model}`;
  return model || provider || '';
}

const Sessions: React.FC<SessionsProps> = ({ language, pendingSessionKey, onSessionKeyConsumed }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const c = t.chat as any;
  const es = (t as any).es as any;
  const sessionDefault = (t as any).dash?.sessionDefault || c.sessionKey;
  const { toast } = useToast();
  const { confirm } = useConfirm();

  // Shared Manager WS subscription for chat streaming events
  const handleChatEventRef = useRef<(payload?: any) => void>(() => { });
  const handleAgentEventRef = useRef<(payload?: any) => void>(() => { });
  const [wsConnected, setWsConnected] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsConnecting, setWsConnecting] = useState(true);
  const wasWsDisconnectedRef = useRef(false);
  const cRef = useRef(c);
  cRef.current = c;
  const { ready: gwReady, checked: gwChecked, refresh: gwRefresh } = useGatewayStatus();
  const gwReadyRef = useRef(gwReady);
  gwReadyRef.current = gwReady;

  // Debounced gwReady: goes true immediately, delays 3s before going false.
  // Prevents brief connectivity blips from unmounting the entire chat UI.
  // Start optimistically true so the disconnected guard never flashes before
  // the first async status check completes (which confirms the real state).
  const [gwReadyStable, setGwReadyStable] = useState(true);
  useEffect(() => {
    if (gwReady) {
      setGwReadyStable(true);
      return;
    }
    const timer = setTimeout(() => setGwReadyStable(false), 3000);
    return () => clearTimeout(timer);
  }, [gwReady]);

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
  const hasAutoSelectedRef = useRef(false);
  const [sessionKey, setSessionKey] = useState('main');
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Gateway dynamic commands (4.10+)
  const [gwCommands, setGwCommands] = useState<Array<{ name: string; description: string; category?: string; source: string }>>([]);

  // Talk mode (real-time event)
  const [talkMode, setTalkMode] = useState<string | null>(null);

  // Session history cleared notice (when navigating from Usage to a deleted/reset session)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);

  // Load gateway commands list (4.10+) — merges plugin/skill commands into slash palette
  useEffect(() => {
    if (!gwReady) return;
    let cancelled = false;
    gwApi.commandsList({ scope: 'text', includeArgs: false }).then(res => {
      if (cancelled || !res?.commands) return;
      setGwCommands(res.commands);
    }).catch(() => { /* gateway may not support commands.list yet */ });
    return () => { cancelled = true; };
  }, [gwReady]);

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
  const [isSwitchingSession, setIsSwitchingSession] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [stream, setStream] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [runPhase, setRunPhase] = useState<ChatRunPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const pendingRunRef = useRef<{ runId: string; beforeCount: number; startedAt: number } | null>(null);
  const finalizedAtRef = useRef<number>(0);
  // Track finalized run IDs to reject late-arriving deltas from completed runs
  const finalizedRunsRef = useRef<Set<string>>(new Set());
  // Dedup guard: track recently added message fingerprints to prevent React batching duplicates
  const recentAddedRef = useRef<Set<string>>(new Set());
  const historyRequestSeqRef = useRef(0);
  const sessionsRequestSeqRef = useRef(0);
  const sendingRef = useRef(false);
  // Pagination state for cursor-based history loading
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const nextCursorRef = useRef<string | undefined>(undefined);
  const loadingOlderRef = useRef(false);
  // Session message cache: stores messages + pagination state per session key
  const sessionCacheRef = useRef<Map<string, { messages: ChatMsg[]; hasMore: boolean; cursor?: string }>>(new Map());

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
  // Track last delta arrival time for idle timeout detection
  const lastDeltaAtRef = useRef<number>(0);
  // Latency tracking
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [liveElapsed, setLiveElapsed] = useState<number>(0);
  // File/image attachments
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ dataUrl: string; mimeType: string; fileName: string; isImage: boolean; fileSize: number }>>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // Model image capability map: { "provider/modelId": boolean }
  const [modelImageMap, setModelImageMap] = useState<Record<string, boolean>>({});
  // Model context window map: { "provider/modelId": number } — fallback when gateway doesn't report maxContextTokens
  const [modelCtxMap, setModelCtxMap] = useState<Record<string, number>>({});
  // Live tool calls (real-time streaming from agent events)
  const [liveToolCalls, setLiveToolCalls] = useState<Map<string, LiveToolCall>>(new Map());
  // Fun waiting phrase (picked once per waiting session, rotates)
  const [waitingPhrase, setWaitingPhrase] = useState('');
  const waitingPhraseRef = useRef('');
  // Btw / side-result inline messages from gateway
  const [btwMessage, setBtwMessage] = useState<{ question: string; text: string; isError?: boolean } | null>(null);

  // Fetch agents list on mount for sidebar filter
  useEffect(() => {
    if (!gwReady) return;
    gwApi.agents().then((data: any) => {
      const list = Array.isArray(data) ? data : data?.agents;
      if (Array.isArray(list)) {
        setAgentsList(list.map((a: any) => ({ id: a.id || '', label: a.name?.trim() || a.label || a.id || '' })).filter((a: { id: string }) => a.id));
      }
    }).catch(() => {});
  }, [gwReady]);

  // Load model capabilities from config (for image support detection)
  useEffect(() => {
    if (!gwReady) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await gwApi.configGet() as any;
        if (cancelled) return;
        const providers = cfg?.models?.providers || cfg?.parsed?.models?.providers || cfg?.config?.models?.providers || {};
        const map: Record<string, boolean> = {};
        const ctxMap: Record<string, number> = {};
        for (const [pName, pCfg] of Object.entries(providers) as [string, any][]) {
          const pModels = Array.isArray(pCfg?.models) ? pCfg.models : [];
          for (const m of pModels) {
            const id = typeof m === 'string' ? m : m?.id;
            if (!id) continue;
            const input = Array.isArray(m?.input) ? m.input : ['text', 'image'];
            map[`${pName}/${id}`] = input.includes('image');
            if (typeof m === 'object' && m?.contextWindow > 0) ctxMap[`${pName}/${id}`] = m.contextWindow;
          }
        }
        setModelImageMap(map);
        setModelCtxMap(ctxMap);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [gwReady]);

  // Derive whether current model supports images
  const modelSupportsImages = useMemo(() => {
    const currentSession = sessions.find(s => s.key === sessionKey);
    const modelPath = getSessionModelKey(currentSession);
    if (!modelPath) return true;
    if (modelPath in modelImageMap) return modelImageMap[modelPath];
    return true;
  }, [sessions, sessionKey, modelImageMap]);

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
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const [patchBusy, setPatchBusy] = useState(false);
  const [savedField, setSavedField] = useState<string | null>(null);
  // Grace window: recently-patched session fields that loadSessions should not overwrite.
  // Map<sessionKey, { fields: Record<string, unknown>, expiresAt: number }>
  const patchGraceRef = useRef<Map<string, { fields: Record<string, unknown>; expiresAt: number }>>(new Map());

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

  // Compaction history
  const [compactionHistoryOpen, setCompactionHistoryOpen] = useState(false);
  const [compactionCheckpoints, setCompactionCheckpoints] = useState<Array<{ id: string; createdAt: string; tokensBefore: number; tokensAfter: number; messagesBefore: number; messagesAfter: number }>>([]);
  const [compactionLoading, setCompactionLoading] = useState(false);
  const [compactionExpandedId, setCompactionExpandedId] = useState<string | null>(null);
  const [compactionDetail, setCompactionDetail] = useState<{ summary?: string } | null>(null);
  const [compactionDetailLoading, setCompactionDetailLoading] = useState(false);

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
  const [bindAgentId, setBindAgentId] = useState('');
  const [bindAgentOriginal, setBindAgentOriginal] = useState('');
  const [bindPeerIdOriginal, setBindPeerIdOriginal] = useState('');
  const [agentsList, setAgentsList] = useState<Array<{ id: string; label?: string }>>([]);
  const [bindAgentsList, setBindAgentsList] = useState<Array<{ id: string; label?: string }>>([]);
  const [agentFilter, setAgentFilter] = useState('');
  const agentFilterRef = useRef(agentFilter);
  agentFilterRef.current = agentFilter;
  // v0.9.1：默认隐藏 AgentRoom 派生会话，减少主会话列表的干扰；用户可在 sidebar 顶部开关。
  // 持久化到 localStorage，避免每次打开都要重开。
  const [showAgentRoomSessions, setShowAgentRoomSessions] = useState<boolean>(() => {
    try { return localStorage.getItem('clawdeck:sessions-show-agentroom') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('clawdeck:sessions-show-agentroom', showAgentRoomSessions ? '1' : '0'); } catch { /* ignore */ }
  }, [showAgentRoomSessions]);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Recently-deleted session keys: prevents loadSessions / ensureSessionPresent from
  // re-adding a session that was just deleted (gateway may still broadcast it briefly).
  // Entries auto-expire after 60s.
  const deletedKeysRef = useRef<Map<string, number>>(new Map());
  // Local-only session keys: sessions created in handleNewSession that the gateway
  // doesn't know about yet.  Cleared when the gateway returns the key in sessions.list
  // or when the first message is sent successfully.
  const localOnlyKeysRef = useRef<Set<string>>(new Set());

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
    // — Status —
    { cmd: '/help', desc: c.quickHelp, icon: 'help', cat: 'status' },
    { cmd: '/status', desc: c.quickStatus, icon: 'info', cat: 'status' },
    { cmd: '/commands', desc: c.slashCommands, icon: 'terminal', cat: 'status' },
    { cmd: '/tasks', desc: c.cmdTasks, icon: 'task_alt', cat: 'status' },
    { cmd: '/tools', desc: c.cmdTools, icon: 'build', cat: 'status' },
    { cmd: '/usage', desc: c.tokens, icon: 'data_usage', cat: 'status' },
    { cmd: '/context', desc: c.catStatus, icon: 'memory', cat: 'status' },
    { cmd: '/whoami', desc: c.catStatus, icon: 'badge', cat: 'status' },
    { cmd: '/export', desc: c.cmdExport, icon: 'download', cat: 'status' },
    { cmd: '/export-session', desc: c.cmdExportSession, icon: 'file_download', cat: 'status' },
    { cmd: '/export-trajectory', desc: c.cmdExportTrajectory || 'Export trajectory bundle', icon: 'folder_zip', cat: 'status' },
    // — Options —
    { cmd: '/model', desc: c.quickModel, icon: 'smart_toy', cat: 'options' },
    { cmd: '/models', desc: c.cmdModels, icon: 'list', cat: 'options' },
    { cmd: '/think', desc: c.quickThink, icon: 'psychology', cat: 'options' },
    { cmd: '/verbose', desc: c.catOptions, icon: 'visibility', cat: 'options' },
    { cmd: '/reasoning', desc: c.catOptions, icon: 'neurology', cat: 'options' },
    { cmd: '/fast', desc: c.cmdFast, icon: 'bolt', cat: 'options' },
    { cmd: '/elevated', desc: c.catOptions, icon: 'admin_panel_settings', cat: 'options' },
    { cmd: '/exec', desc: c.cmdExec, icon: 'play_arrow', cat: 'options' },
    { cmd: '/queue', desc: c.cmdQueue, icon: 'queue', cat: 'options' },
    // — Session —
    { cmd: '/new', desc: c.quickReset, icon: 'add_circle', cat: 'session' },
    { cmd: '/reset', desc: c.quickReset, icon: 'restart_alt', cat: 'session' },
    { cmd: '/compact', desc: c.quickCompact, icon: 'compress', cat: 'session' },
    { cmd: '/abort', desc: c.abort, icon: 'stop_circle', cat: 'session' },
    { cmd: '/stop', desc: c.stop, icon: 'pause_circle', cat: 'session' },
    { cmd: '/session', desc: c.cmdSession, icon: 'tune', cat: 'session' },
    // — Tools —
    { cmd: '/skill', desc: c.catTools, icon: 'extension', cat: 'tools' },
    { cmd: '/btw', desc: c.cmdBtw, icon: 'chat_bubble', cat: 'tools' },
    { cmd: '/bash', desc: c.catTools, icon: 'terminal', cat: 'tools' },
    { cmd: '/restart', desc: c.catTools, icon: 'refresh', cat: 'tools' },
    // — Management —
    { cmd: '/config', desc: c.catManagement, icon: 'settings', cat: 'management' },
    { cmd: '/mcp', desc: c.cmdMcp, icon: 'hub', cat: 'management' },
    { cmd: '/plugins', desc: c.cmdPlugins, icon: 'widgets', cat: 'management' },
    { cmd: '/acp', desc: c.cmdAcp, icon: 'swap_horiz', cat: 'management' },
    { cmd: '/subagents', desc: c.catManagement, icon: 'group', cat: 'management' },
    { cmd: '/agents', desc: c.cmdAgents, icon: 'smart_toy', cat: 'management' },
    { cmd: '/kill', desc: c.cmdKill, icon: 'dangerous', cat: 'management' },
    { cmd: '/steer', desc: c.cmdSteer, icon: 'assistant_direction', cat: 'management' },
    { cmd: '/focus', desc: c.cmdFocus, icon: 'center_focus_strong', cat: 'management' },
    { cmd: '/unfocus', desc: c.cmdUnfocus, icon: 'center_focus_weak', cat: 'management' },
    { cmd: '/activation', desc: c.catManagement, icon: 'notifications_active', cat: 'management' },
    { cmd: '/send', desc: c.cmdSend, icon: 'send', cat: 'management' },
    { cmd: '/allowlist', desc: c.cmdAllowlist, icon: 'checklist', cat: 'management' },
    { cmd: '/approve', desc: c.cmdApprove, icon: 'verified', cat: 'management' },
    { cmd: '/debug', desc: c.cmdDebug, icon: 'bug_report', cat: 'management' },
    // — Memory —
    { cmd: '/dreaming', desc: c.cmdDreaming, icon: 'bedtime', cat: 'management' },
    { cmd: '/active-memory', desc: c.cmdActiveMemory || 'Enable, disable, or inspect Active Memory for this session.', icon: 'memory_alt', cat: 'management' },
    // — Plugins (device-pair / line / phone-control) —
    { cmd: '/trace', desc: c.cmdTrace || 'Toggle plugin trace lines.', icon: 'analytics', cat: 'options' },
    { cmd: '/pair', desc: c.cmdPair || 'Generate setup codes and approve device pairing requests.', icon: 'qr_code', cat: 'management' },
    { cmd: '/card', desc: c.cmdCard || 'Send a rich card message (LINE).', icon: 'credit_card', cat: 'media' },
    { cmd: '/phone', desc: c.cmdPhone || 'Arm/disarm high-risk phone node commands.', icon: 'smartphone', cat: 'management' },
    // — Media —
    { cmd: '/tts', desc: c.catMedia, icon: 'record_voice_over', cat: 'media' },
    { cmd: '/tts latest', desc: c.cmdTtsLatest || 'Read aloud latest reply', icon: 'replay', cat: 'media' },
    { cmd: '/tts chat', desc: c.cmdTtsChat || 'Toggle auto-TTS for this chat', icon: 'voice_chat', cat: 'media' },
    { cmd: '/tts persona', desc: c.cmdTtsPersona || 'Select TTS persona', icon: 'face', cat: 'media' },
    { cmd: '/voice', desc: c.cmdVoice, icon: 'graphic_eq', cat: 'media' },
    // — Codex (2026.4.27) —
    { cmd: '/codex computer-use status', desc: c.cmdCodexComputerUseStatus || 'Codex Computer Use status', icon: 'desktop_windows', cat: 'management' },
    { cmd: '/codex computer-use install', desc: c.cmdCodexComputerUseInstall || 'Install Codex Computer Use', icon: 'install_desktop', cat: 'management' },
  ], [c]);

  // Merge gateway dynamic commands (plugin/skill) into the local slash palette
  const mergedSlashCommands = useMemo(() => {
    if (!gwCommands.length) return SLASH_COMMANDS;
    const localCmds = new Set(SLASH_COMMANDS.map(s => s.cmd.toLowerCase()));
    const CAT_ICON: Record<string, string> = {
      tools: 'build', session: 'tune', status: 'info', options: 'settings',
      management: 'settings', media: 'graphic_eq',
    };
    const extra = gwCommands
      .filter(gc => {
        const name = gc.name.startsWith('/') ? gc.name : `/${gc.name}`;
        return !localCmds.has(name.toLowerCase());
      })
      .map(gc => {
        const name = gc.name.startsWith('/') ? gc.name : `/${gc.name}`;
        const cat = gc.source === 'skill' ? 'tools' : (gc.category || 'management');
        return {
          cmd: name,
          desc: gc.description || name,
          icon: gc.source === 'skill' ? 'extension' : (gc.source === 'plugin' ? 'widgets' : (CAT_ICON[cat] || 'terminal')),
          cat,
        };
      });
    return [...SLASH_COMMANDS, ...extra];
  }, [SLASH_COMMANDS, gwCommands]);

  const slashFiltered = useMemo(() => {
    if (!slashOpen) return [];
    const q = input.slice(1).toLowerCase();
    if (!q) return mergedSlashCommands;
    return mergedSlashCommands.filter(s => s.cmd.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q));
  }, [slashOpen, input, mergedSlashCommands]);

  const CAT_LABELS: Record<string, string> = useMemo(() => ({
    session: c.catSession, options: c.catOptions, status: c.catStatus,
    tools: c.catTools, management: c.catManagement, media: c.catMedia, docks: c.catDocks,
  }), [c]);
  const runPhaseMeta = useMemo(() => {
    if (runPhase === 'sending') {
      return {
        text: c.runSending || 'Sending',
        dot: 'bg-amber-400',
        textClass: 'text-amber-500',
      };
    }
    if (runPhase === 'waiting') {
      let text = waitingPhrase || c.runWaiting || 'Waiting';
      if (liveElapsed > 30000) {
        text += ' — ' + (c.stillWorking || 'still working…');
      } else if (liveElapsed > 10000) {
        text += ' — ' + (c.modelWarmingUp || 'model warming up…');
      }
      return {
        text,
        dot: 'bg-amber-400 animate-pulse',
        textClass: 'text-amber-500',
      };
    }
    if (runPhase === 'streaming') {
      return {
        text: c.runStreaming || 'Streaming',
        dot: 'bg-primary animate-pulse',
        textClass: 'text-primary',
      };
    }
    if (runPhase === 'running') {
      return {
        text: c.runRunning || 'Running tools',
        dot: 'bg-purple-500 animate-pulse',
        textClass: 'text-purple-500',
      };
    }
    if (runPhase === 'error') {
      return {
        text: c.runError || 'Error',
        dot: 'bg-red-500',
        textClass: 'text-red-500',
      };
    }
    return {
      text: c.runIdle || 'Idle',
      dot: 'bg-mac-green',
      textClass: 'text-mac-green',
    };
  }, [runPhase, waitingPhrase, liveElapsed, c.runSending, c.runWaiting, c.runStreaming, c.runRunning, c.runError, c.runIdle]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = runPhase === 'streaming' || runPhase === 'running' || runPhase === 'waiting' || runPhase === 'sending';
  const renderedMessages = useMemo(() => messages.slice(-200), [messages]);
  const omittedMessageCount = Math.max(0, messages.length - renderedMessages.length);
  const msgGroups = useMemo(() => groupMessages(renderedMessages), [renderedMessages]);

  // Sync wsError with gateway status from shared hook
  useEffect(() => {
    if (gwChecked && !gwReady) {
      setWsError(cRef.current.configMissing);
      setWsConnecting(false);
    } else if (gwReady) {
      setWsError(null);
    }
  }, [gwChecked, gwReady]);

  // Subscribe to shared Manager WS for real-time chat streaming events
  useEffect(() => {
    setWsConnecting(true);

    // Subscribe to shared Manager WS for real-time chat streaming events
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
        if (msg.type === '_reconnected') {
          // WS reconnected after disconnect — full state sync
          loadHistoryRef.current?.({ silent: true });
          loadSessionsRef.current?.({ silent: true });
          gwRefreshRef.current?.();
          return;
        }
        if (msg.type === 'chat') {
          handleChatEventRef.current(msg.data);
        } else if (msg.type === 'agent') {
          handleAgentEventRef.current(msg.data);
        } else if (msg.type === 'chat.side_result') {
          const d = msg.data;
          if (d?.kind === 'btw' && d.sessionKey === sessionKeyRef.current) {
            const question = (d.question || '').trim();
            const text = (d.text || '').trim();
            if (question && text) {
              setBtwMessage({ question, text, isError: d.isError });
            }
          }
        } else if (msg.type === 'sessions.changed') {
          // Immediately patch session status from the event payload for instant UI feedback
          const d = msg.data;
          if (d?.sessionKey && (d.status || d.startedAt || d.endedAt !== undefined || d.runtimeMs !== undefined)) {
            setSessions(prev => prev.map(s => {
              if (s.key !== d.sessionKey) return s;
              return {
                ...s,
                ...(d.status ? { status: d.status } : {}),
                ...(d.startedAt ? { startedAt: d.startedAt } : {}),
                ...(d.endedAt ? { endedAt: d.endedAt } : {}),
                ...(typeof d.runtimeMs === 'number' ? { runtimeMs: d.runtimeMs } : {}),
                ...(typeof d.abortedLastRun === 'boolean' ? { abortedLastRun: d.abortedLastRun } : {}),
                ...(typeof d.estimatedCostUsd === 'number' ? { estimatedCostUsd: d.estimatedCostUsd } : {}),
              } as GwSession;
            }));
          }
          loadSessionsRef.current?.({ silent: true });
        } else if (msg.type === 'context_compaction.started') {
          // Gateway event: context compaction has begun for this session (openclaw >=2026.3.24)
          const d = msg.data;
          if (!d?.sessionKey || d.sessionKey === sessionKeyRef.current) {
            setCompacting(true);
          }
        } else if (msg.type === 'context_compaction.completed') {
          // Gateway event: context compaction finished
          const d = msg.data;
          if (!d?.sessionKey || d.sessionKey === sessionKeyRef.current) {
            setCompacting(false);
            loadSessionsRef.current?.({ silent: true });
            loadHistoryRef.current?.({ silent: true });
          }
        } else if (msg.type === 'talk.mode') {
          // Gateway payload: { enabled: boolean, phase?: string, ts: number }
          const d = msg.data;
          setTalkMode(d?.enabled ? (d.phase || 'listening') : null);
        }
      } catch { /* ignore */ }
    }, (status) => {
      if (status === 'open') {
        const wasDisconnected = wasWsDisconnectedRef.current;
        opened = true;
        clearTimeout(connectTimeout);
        setWsConnected(true);
        setWsConnecting(false);
        setWsError(null);
        if (wasDisconnected) {
          wasWsDisconnectedRef.current = false;
          toast('info', cRef.current.wsReconnected || 'Reconnected', 3000);
        }
      } else if (status === 'closed') {
        setWsConnected(false);
        wasWsDisconnectedRef.current = true;
        // Preserve partial stream text on disconnect so content isn't lost
        const partial = streamTextRef.current;
        if (partial) {
          setMessages(msgs => appendMessageDedup(msgs, {
            role: 'assistant',
            content: [{ type: 'text', text: partial + '\n\n*(partial — connection lost)*' }],
            timestamp: Date.now(),
          }, recentAddedRef));
          if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
          streamTextRef.current = '';
          setStream(null);
          setRunId(null);
          setRunPhase('idle');
          pendingRunRef.current = null;
        }
      }
    });

    return () => {
      clearTimeout(connectTimeout);
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chat event handler (streaming) - defined before useEffect to avoid closure issues
  const handleChatEvent = useCallback((payload?: any) => {
    if (!payload) return;
    // Only handle events for the current session
    const eventSessionKey = payload.sessionKey || payload.key;
    if (eventSessionKey && eventSessionKey !== sessionKeyRef.current) return;

    // session.message style payload (without state) — e.g. re-broadcast from backend
    if (!payload.state && (payload.role || payload.message?.role)) {
      // Skip during active streaming — state:'final' will handle the message
      if (pendingRunRef.current) return;
      // Skip if we just finalized — the re-broadcast of session.message arrives shortly after
      if (finalizedAtRef.current && Date.now() - finalizedAtRef.current < 3000) return;
      const msg = payload.message || payload;
      const text = extractText(msg?.content ?? msg);
      if (text.trim()) {
        setMessages(prev => appendMessageDedup(prev, {
          role: (msg.role || 'assistant') as ChatMsg['role'],
          content: msg.content ?? [{ type: 'text', text }],
          timestamp: msg.timestamp || Date.now(),
          ...(msg.usage ? { usage: msg.usage } : {}),
          ...(msg.cost ? { cost: msg.cost } : {}),
          ...(msg.model ? { model: msg.model } : {}),
          ...(msg.provider ? { provider: msg.provider } : {}),
          ...(msg.stopReason ? { stopReason: msg.stopReason } : {}),
        }, recentAddedRef));
        if ((msg.role || 'assistant') === 'assistant') {
          setRunId(null);
          if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
          streamTextRef.current = '';
          setStream(null);
          setRunPhase('idle');
          setError(null);
          pendingRunRef.current = null;
        }
      }
      return;
    }

    // Strict run tracking: reject events for already-finalized runs
    const eventRunId = payload.runId as string | undefined;
    if (eventRunId && finalizedRunsRef.current.has(eventRunId)) {
      return;
    }

    const markFinalized = (rid?: string) => {
      if (!rid) return;
      finalizedRunsRef.current.add(rid);
      // Cap at 100 entries to prevent unbounded growth
      if (finalizedRunsRef.current.size > 100) {
        const first = finalizedRunsRef.current.values().next().value;
        if (first) finalizedRunsRef.current.delete(first);
      }
    };

    if (payload.state === 'delta') {
      // Reject delta if it's for a different run than the current pending one.
      // When pendingRunRef is null (externally-triggered run from channels like
      // WeChat/Telegram), allow the delta through so the UI shows streaming status.
      if (eventRunId && pendingRunRef.current && eventRunId !== pendingRunRef.current.runId) {
        return;
      }
      // Gateway sends: message: { role, content: [{ type: 'text', text }], timestamp }
      const msg = payload.message as any;
      const text = extractText(msg?.content ?? msg);
      if (typeof text === 'string' && text.trim().length > 0) {
        lastDeltaAtRef.current = Date.now();
        throttledSetStream(text);
        setRunPhase('streaming');
        // Track externally-triggered runs: if no pendingRunRef exists, create one
        // so timeout recovery and latency tracking work for external runs too.
        if (!pendingRunRef.current && eventRunId) {
          pendingRunRef.current = {
            runId: eventRunId,
            beforeCount: 0,
            startedAt: Date.now(),
          };
          setRunId(eventRunId);
        }
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
            ...(msg.usage ? { usage: msg.usage } : {}),
            ...(msg.cost ? { cost: msg.cost } : {}),
            ...(msg.model ? { model: msg.model } : {}),
            ...(msg.provider ? { provider: msg.provider } : {}),
            ...(msg.stopReason ? { stopReason: msg.stopReason } : {}),
          }, recentAddedRef));
        }
      }
      markFinalized(eventRunId);
      finalizedAtRef.current = Date.now();
      if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
      streamTextRef.current = '';
      setStream(null);
      setRunId(null);
      setRunPhase('idle');
      setError(null);
      setLiveToolCalls(new Map());
      if (pendingRunRef.current?.startedAt) setLastLatencyMs(Date.now() - pendingRunRef.current.startedAt);
      pendingRunRef.current = null;
      // Delayed history refresh: gateway may take a moment to persist the final message
      setTimeout(() => loadHistoryRef.current?.({ silent: true }), 2000);
    } else if (payload.state === 'aborted') {
      // If there was partial stream text, keep it as a message
      const partialText = streamTextRef.current;
      if (partialText) {
        setMessages(msgs => appendMessageDedup(msgs, {
          role: 'assistant',
          content: [{ type: 'text', text: partialText }],
          timestamp: Date.now(),
        }, recentAddedRef));
      }
      markFinalized(eventRunId);
      if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
      streamTextRef.current = '';
      setStream(null);
      setRunId(null);
      setRunPhase('idle');
      setError(null);
      setLiveToolCalls(new Map());
      pendingRunRef.current = null;
    } else if (payload.state === 'error') {
      markFinalized(eventRunId);
      // If we have partial streamed content, preserve it as a message instead of
      // discarding it — the user already sees the text on screen.
      const partialText = streamTextRef.current;
      if (partialText) {
        setMessages(msgs => appendMessageDedup(msgs, {
          role: 'assistant',
          content: [{ type: 'text', text: partialText }],
          timestamp: Date.now(),
        }, recentAddedRef));
      }
      if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
      streamTextRef.current = '';
      setStream(null);
      setRunId(null);
      setRunPhase('error');
      setLiveToolCalls(new Map());
      pendingRunRef.current = null;
      // Enhance upstream API errors with HTTP status context
      let errMsg = payload.errorMessage || cRef.current.error;
      const httpMatch = typeof errMsg === 'string' && errMsg.match(/^(\d{3})\b/);
      if (httpMatch) {
        const code = Number(httpMatch[1]);
        const hints: Record<number, string> = {
          401: 'API key invalid or expired',
          403: 'Access denied — check API key permissions or model availability',
          429: 'Rate limited — too many requests, retry later',
          500: 'Provider internal error',
          502: 'Provider unreachable',
          503: 'Provider temporarily unavailable',
        };
        if (hints[code] && !errMsg.includes(hints[code])) {
          errMsg = `${errMsg}  (${hints[code]})`;
        }
      }
      // Surface provider-specific rate limit details from gateway (openclaw >=2026.3.28)
      // Gateway now returns structured messages like "Rate limited by <provider>: retry after <N>s"
      if (typeof errMsg === 'string') {
        const rlMatch = errMsg.match(/rate.?limit(?:ed)?(?:\s+by\s+([\w\s\-]+?))?(?:[:\s]+retry\s+after\s+(\d+)\s*s(?:ec(?:ond)?s?)?)?/i);
        if (rlMatch) {
          const provider = rlMatch[1]?.trim();
          const retryAfter = rlMatch[2] ? Number(rlMatch[2]) : null;
          const parts: string[] = [];
          if (provider) parts.push(provider);
          if (retryAfter !== null) parts.push(`retry in ${retryAfter}s`);
          if (parts.length > 0 && !errMsg.includes('retry in') && !errMsg.includes(parts[0])) {
            errMsg = `${errMsg}  (${parts.join(', ')})`;
          }
        }
      }
      setError(errMsg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Agent event handler (tool streaming)
  const handleAgentEvent = useCallback((payload?: any) => {
    if (!payload) return;
    const eventSessionKey = payload.sessionKey || payload.key;
    if (eventSessionKey && eventSessionKey !== sessionKeyRef.current) return;
    if (payload.stream === 'tool') {
      const data = payload.data || {};
      const phase = data.phase || '';
      const toolCallId = data.toolCallId || '';
      const toolName = data.name || 'tool';
      if (!toolCallId) return;
      if (phase === 'start') {
        setLiveToolCalls(prev => {
          const next = new Map(prev);
          next.set(toolCallId, { toolCallId, toolName, args: data.args, phase: 'start', startedAt: Date.now() });
          return next;
        });
        setRunPhase('running');
      } else if (phase === 'update') {
        setLiveToolCalls(prev => {
          const next = new Map(prev);
          const existing = next.get(toolCallId);
          if (existing) {
            next.set(toolCallId, { ...existing, args: data.args ?? existing.args, phase: 'running' });
          }
          return next;
        });
      } else if (phase === 'result') {
        setLiveToolCalls(prev => {
          const next = new Map(prev);
          const existing = next.get(toolCallId);
          if (existing) {
            next.set(toolCallId, { ...existing, result: data.result, isError: Boolean(data.isError), phase: 'done', endedAt: Date.now(), meta: data.meta as Record<string, unknown> | undefined });
          }
          return next;
        });
      }
    } else if (payload.stream === 'lifecycle') {
      const phase = typeof payload.data?.phase === 'string' ? payload.data.phase : '';
      const eventRunId = payload.runId as string | undefined;
      if (phase === 'start') {
        setRunPhase('running');
        // Track externally-triggered runs: if no pendingRunRef exists (run was
        // not initiated from this UI), create one so the status indicator, timeout
        // recovery, and latency tracking all work for external channel runs too.
        if (!pendingRunRef.current && eventRunId) {
          pendingRunRef.current = {
            runId: eventRunId,
            beforeCount: 0,
            startedAt: Date.now(),
          };
          setRunId(eventRunId);
        }
      } else if (phase === 'end' || phase === 'error') {
        // Lifecycle end/error for an externally-triggered run: if the chat event
        // handler hasn't already finalized this run (no state:'final' received),
        // clean up the run tracking so the UI returns to idle.
        // Only act if this run matches our currently tracked pending run.
        if (pendingRunRef.current && eventRunId && pendingRunRef.current.runId === eventRunId) {
          // Don't reset immediately if we're streaming — the chat final event
          // should handle that. Only reset from running/waiting phases.
          const currentStreamText = streamTextRef.current;
          if (!currentStreamText) {
            if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
            streamTextRef.current = '';
            setStream(null);
            setRunId(null);
            setRunPhase(phase === 'error' ? 'error' : 'idle');
            setLiveToolCalls(new Map());
            pendingRunRef.current = null;
            // Refresh history to pick up any messages we might have missed
            setTimeout(() => loadHistoryRef.current?.({ silent: true }), 1500);
          }
        }
      }
    }
  }, []);

  // Keep ref updated with latest handler
  useEffect(() => {
    handleChatEventRef.current = handleChatEvent;
    handleAgentEventRef.current = handleAgentEvent;
  }, [handleChatEvent, handleAgentEvent]);

  // Fun waiting phrase rotation during 'waiting' phase
  useEffect(() => {
    if (runPhase !== 'waiting') {
      if (waitingPhraseRef.current) {
        waitingPhraseRef.current = '';
        setWaitingPhrase('');
      }
      return;
    }
    const pick = () => {
      const key = WAITING_PHRASE_KEYS[Math.floor(Math.random() * WAITING_PHRASE_KEYS.length)];
      return (c as any)[key] || c.runWaiting || 'Waiting';
    };
    const phrase = pick();
    waitingPhraseRef.current = phrase;
    setWaitingPhrase(phrase);
    const timer = setInterval(() => {
      const next = pick();
      waitingPhraseRef.current = next;
      setWaitingPhrase(next);
    }, 3000);
    return () => clearInterval(timer);
  }, [runPhase, c]);

  // Live elapsed timer during streaming
  useEffect(() => {
    if (runPhase !== 'streaming' && runPhase !== 'sending' && runPhase !== 'running' && runPhase !== 'waiting') {
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
  const loadSessions = useCallback(async (opts?: { silent?: boolean }) => {
    if (!gwReadyRef.current) return;
    const requestSeq = ++sessionsRequestSeqRef.current;
    if (!opts?.silent) setSessionsLoading(true);
    try {
      const res = await gwApi.proxy('sessions.list', {
        limit: 50,
        includeDerivedTitles: true,
        includeLastMessage: true,
        ...(agentFilterRef.current ? { agentId: agentFilterRef.current } : {}),
      }) as any;
      if (sessionsRequestSeqRef.current !== requestSeq) {
        return;
      }
      // Gateway returns { sessions: [...] }
      const list = Array.isArray(res?.sessions) ? res.sessions : [];
      const mapped = list.map((s: any) => ({
        key: s.key || s.id || '',
        label: s.label || s.displayName || s.derivedTitle || s.key || '',
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
        fastMode: s.fastMode ?? undefined,
        lastTo: s.lastTo || s.deliveryContext?.to || '',
        parentKey: s.parentKey || s.parentSessionKey || '',
        spawnedBy: s.spawnedBy || s.ownerKey || '',
        status: s.status || undefined,
        startedAt: s.startedAt || undefined,
        endedAt: s.endedAt || undefined,
        runtimeMs: s.runtimeMs ?? undefined,
        abortedLastRun: s.abortedLastRun ?? undefined,
        estimatedCostUsd: s.estimatedCostUsd ?? undefined,
        runner: s.runner || s.harnessId || '',
      }));
      // Clean up expired patch grace entries and deleted-key entries
      const nowMs = Date.now();
      for (const [k, v] of patchGraceRef.current) {
        if (v.expiresAt <= nowMs) patchGraceRef.current.delete(k);
      }
      for (const [k, exp] of deletedKeysRef.current) {
        if (exp <= nowMs) deletedKeysRef.current.delete(k);
      }
      // Filter out recently-deleted sessions so they don't reappear
      const filtered = deletedKeysRef.current.size > 0
        ? mapped.filter((s: GwSession) => !deletedKeysRef.current.has(s.key))
        : mapped;
      // Clear local-only keys that the gateway now knows about, and prune stale
      // local-only keys that are no longer the active session (user created a new
      // session, then navigated away without sending a message).
      const gwKeySet = new Set(filtered.map((s: GwSession) => s.key));
      const activeKey = sessionKeyRef.current;
      for (const k of localOnlyKeysRef.current) {
        if (gwKeySet.has(k) || k !== activeKey) localOnlyKeysRef.current.delete(k);
      }
      setSessions(prev => {
        if (areSessionsEquivalent(prev, filtered)) {
          // Even if gateway data is unchanged, we may still need to preserve local-only keys
          if (localOnlyKeysRef.current.size === 0) return prev;
        }
        // Incremental merge: reuse previous objects by key when unchanged to preserve React identity
        const prevMap = new Map(prev.map(s => [s.key, s]));
        let changed = prev.length !== filtered.length;
        const merged = filtered.map((next: GwSession) => {
          // Re-apply grace-protected fields so recent patches aren't overwritten by stale server data
          const grace = patchGraceRef.current.get(next.key);
          const effective = grace ? { ...next, ...grace.fields } as GwSession : next;
          const existing = prevMap.get(effective.key);
          if (existing && areSessionsEquivalent([existing], [effective])) {
            return existing; // preserve identity
          }
          changed = true;
          return effective;
        });
        // Preserve all local-only sessions (created but not yet sent to gateway)
        for (const localKey of localOnlyKeysRef.current) {
          if (!merged.some(s => s.key === localKey) && !deletedKeysRef.current.has(localKey)) {
            const localOnly = prev.find(s => s.key === localKey);
            if (localOnly) {
              merged.unshift(localOnly);
              changed = true;
            }
          }
        }
        if (!changed) return prev;
        // Persist to sessionStorage for instant display on next window open
        try { sessionStorage.setItem('clawdeck-sessions-cache', JSON.stringify(merged)); } catch { /* ignore */ }
        return merged;
      });
    } catch { /* ignore */ }
    finally {
      if (sessionsRequestSeqRef.current === requestSeq) {
        setSessionsLoading(false);
      }
    }
  }, []);

  // Track message count via ref to avoid loadHistory dependency on messages array
  const messagesLenRef = useRef(0);
  messagesLenRef.current = messages.length;

  // Stable callbacks for UsagePanel — must NOT be inline arrows in JSX or
  // UsagePanel.loadData recreates on every render and fires repeated RPC calls.
  const loadUsageData = useCallback(async (key: string) => {
    // Skip for local-only sessions not yet known to the gateway
    if (localOnlyKeysRef.current.has(key)) return null;
    const res = await gwApi.sessionsUsage({ key, limit: 1 }) as any;
    const entry = res?.sessions?.[0];
    return entry?.usage ?? null;
  }, []);
  const loadTimeseriesData = useCallback(async (key: string) => {
    // Skip timeseries for ephemeral run sessions — they have no transcript
    // and the gateway returns INVALID_REQUEST for them.
    if (/:run-\d+$/.test(key)) return null;
    // Skip for local-only sessions not yet known to the gateway
    if (localOnlyKeysRef.current.has(key)) return null;
    return await gwApi.sessionsUsageTimeseries(key) as any;
  }, []);

  // Helper: map raw gateway messages to ChatMsg
  const mapMessages = useCallback((msgs: any[]): ChatMsg[] => msgs.map((m: any) => ({
    role: m.role || 'assistant',
    content: m.content,
    timestamp: m.timestamp || m.ts,
    ...(m.usage ? { usage: m.usage } : {}),
    ...(m.cost ? { cost: m.cost } : {}),
    ...(m.model ? { model: m.model } : {}),
    ...(m.provider ? { provider: m.provider } : {}),
    ...(m.stopReason ? { stopReason: m.stopReason } : {}),
  })), []);

  // Helper: restore optimistic image data stripped by gateway
  const restoreImages = useCallback((prev: ChatMsg[], mapped: ChatMsg[]): ChatMsg[] => {
    const prevUserWithImages: Array<{ ts: number; text: string; imgs: any[] }> = [];
    for (const m of prev) {
      if (m.role === 'user' && Array.isArray(m.content)) {
        const imgs = m.content.filter((b: any) => b?.type === 'image' && b?.source?.data);
        if (imgs.length > 0) {
          const text = m.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text || '').join('');
          prevUserWithImages.push({ ts: m.timestamp || 0, text, imgs });
        }
      }
    }
    if (prevUserWithImages.length === 0) return mapped;
    return mapped.map((m: ChatMsg) => {
      if (m.role !== 'user' || !Array.isArray(m.content)) return m;
      const hasOmitted = m.content.some((b: any) => b?.type === 'image' && (b?.omitted || (b?.source && !b?.source?.data)));
      if (!hasOmitted) return m;
      const mText = m.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text || '').join('');
      const mTs = m.timestamp || 0;
      const match = prevUserWithImages.find(p =>
        p.text === mText && (!mTs || !p.ts || Math.abs(mTs - p.ts) < 60000)
      );
      if (!match) return m;
      let imgIdx = 0;
      const restored = m.content.map((b: any) => {
        if (b?.type === 'image' && (b?.omitted || (b?.source && !b?.source?.data)) && imgIdx < match.imgs.length) {
          return match.imgs[imgIdx++];
        }
        return b;
      });
      return { ...m, content: restored };
    });
  }, []);

  // Load chat history — uses paginated endpoint for initial load, RPC for silent refresh
  const loadHistory = useCallback(async (opts?: { silent?: boolean; force?: boolean }) => {
    if (!gwReadyRef.current) return;
    const requestSeq = ++historyRequestSeqRef.current;
    const targetSessionKey = sessionKey;
    const historyMaxChars = 12000;
    const showSpinner = !opts?.silent && messagesLenRef.current === 0;
    if (showSpinner) setChatLoading(true);
    if (!opts?.silent) setError(null);
    try {
      const loadViaRpc = async (): Promise<ChatMsg[] | null> => {
        if (pendingRunRef.current && streamTextRef.current) return null;
        const res = await gwApi.sessionsHistory(targetSessionKey, { limit: 200, maxChars: historyMaxChars }) as any;
        if (historyRequestSeqRef.current !== requestSeq || sessionKeyRef.current !== targetSessionKey) return null;
        return mapMessages(Array.isArray(res?.messages) ? res.messages : []);
      };

      let mapped: ChatMsg[] | null = null;
      if (opts?.silent || opts?.force) {
        // Force refresh and silent reconciliation use the RPC history feed.
        mapped = await loadViaRpc();
        if (!mapped) return;
      } else {
        // Initial load: use paginated endpoint for fast first render.
        const res = await gwApi.sessionsHistoryPaginated(targetSessionKey, 50, undefined, historyMaxChars) as any;
        if (historyRequestSeqRef.current !== requestSeq || sessionKeyRef.current !== targetSessionKey) return;
        const msgs = Array.isArray(res?.messages) ? res.messages : [];
        mapped = mapMessages(msgs);
        // Update pagination state
        const more = Boolean(res?.hasMore);
        setHasMoreHistory(more);
        nextCursorRef.current = more ? (res?.nextCursor || undefined) : undefined;

        // If the paginated path returns nothing, fall back to RPC before we
        // touch the current message list. This avoids blanking sessions that
        // already have visible history in the sidebar.
        if (mapped.length === 0) {
          const rpcMapped = await loadViaRpc();
          if (!rpcMapped) return;
          if (rpcMapped.length > 0) {
            mapped = rpcMapped;
            setHasMoreHistory(false);
            nextCursorRef.current = undefined;
          }
        }
      }

      if (!mapped) return;
      // Preserve image data from optimistic user messages
      setMessages(prev => {
        const result = mapped.length === 0 && prev.length > 0 ? prev : restoreImages(prev, mapped);
        // Update session cache
        sessionCacheRef.current.set(targetSessionKey, { messages: result, hasMore: Boolean(nextCursorRef.current), cursor: nextCursorRef.current });
        return result;
      });
    } catch (err: any) {
      if (historyRequestSeqRef.current === requestSeq && sessionKeyRef.current === targetSessionKey) {
        const errMsg = err?.message || cRef.current.error || 'Failed to load history';
        if (showSpinner) {
          setMessages([]);
          setHasMoreHistory(false);
          nextCursorRef.current = undefined;
        }
        setError(errMsg);
      }
    } finally {
      if (showSpinner && historyRequestSeqRef.current === requestSeq && sessionKeyRef.current === targetSessionKey) {
        setChatLoading(false);
      }
      if (historyRequestSeqRef.current === requestSeq && sessionKeyRef.current === targetSessionKey) {
        setIsSwitchingSession(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, mapMessages, restoreImages]);

  // Load older messages when user scrolls to top (cursor-based pagination)
  const loadOlderMessages = useCallback(async () => {
    if (!gwReadyRef.current || loadingOlderRef.current || !nextCursorRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const targetSessionKey = sessionKeyRef.current;
    const cursor = nextCursorRef.current;
    const historyMaxChars = 12000;
    try {
      const res = await gwApi.sessionsHistoryPaginated(targetSessionKey, 50, cursor, historyMaxChars) as any;
      if (sessionKeyRef.current !== targetSessionKey) return;
      const msgs = Array.isArray(res?.messages) ? res.messages : [];
      if (msgs.length === 0) {
        setHasMoreHistory(false);
        nextCursorRef.current = undefined;
        return;
      }
      const mapped = mapMessages(msgs);
      const more = Boolean(res?.hasMore);
      setHasMoreHistory(more);
      nextCursorRef.current = more ? (res?.nextCursor || undefined) : undefined;
      // Preserve scroll position: measure scrollHeight before prepend
      const el = scrollContainerRef.current;
      const prevScrollHeight = el?.scrollHeight || 0;
      const prevScrollTop = el?.scrollTop || 0;
      setMessages(prev => {
        const combined = [...mapped, ...prev];
        // Update session cache with combined messages
        sessionCacheRef.current.set(targetSessionKey, { messages: combined, hasMore: more, cursor: nextCursorRef.current });
        return combined;
      });
      // Restore scroll position after React renders the prepended messages
      requestAnimationFrame(() => {
        if (el) {
          const newScrollHeight = el.scrollHeight;
          el.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
        }
      });
    } catch { /* ignore */ }
    finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [mapMessages]);

  // Refs to latest callbacks for use inside stable-dependency useEffects (e.g. WS subscription)
  const loadHistoryRef = useRef(loadHistory);
  loadHistoryRef.current = loadHistory;
  const loadSessionsRef = useRef(loadSessions);
  loadSessionsRef.current = loadSessions;
  const gwRefreshRef = useRef(gwRefresh);
  gwRefreshRef.current = gwRefresh;

  // On ready: load history first (user-visible), then sessions list (sidebar has cache).
  useEffect(() => {
    if (!gwReady) return;
    if (!hasStartedInitialDetectingRef.current) {
      hasStartedInitialDetectingRef.current = true;
      setInitialDetecting(true);
      // Load history + sessions in parallel for faster first paint
      const historyP = loadHistory().then(() => setInitialDetecting(false));
      const sessionsP = loadSessions({ silent: true });
      Promise.all([historyP, sessionsP]).then(() => {
        // Auto-select first session if current session has no messages
        if (!hasAutoSelectedRef.current) {
          hasAutoSelectedRef.current = true;
          setMessages(prev => {
            if (prev.length === 0) {
              setSessions(sess => {
                if (sess.length > 0 && sess[0].key !== sessionKeyRef.current) {
                  setSessionKey(sess[0].key);
                }
                return sess;
              });
            }
            return prev;
          });
        }
      });
    } else {
      loadSessions({ silent: true });
    }
    // Subscribe to session list changes via gateway RPC
    gwApi.sessionsSubscribe().catch(() => {});
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => loadSessions({ silent: true }), 30000);
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) { clearInterval(timer); timer = null; }
      } else {
        if (!timer) {
          timer = setInterval(() => loadSessions({ silent: true }), 30000);
          loadSessions({ silent: true });
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      gwApi.sessionsUnsubscribe().catch(() => {});
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gwReady]);

  // Session-level message subscription: subscribe to the active session's
  // message stream and unsubscribe from the previous one on switch.
  // This narrows the WS event flow to only the relevant session.
  const prevSessionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Clean up streaming state from the previous session
    if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
    streamTextRef.current = '';
    setStream(null);
    setRunId(null);
    setRunPhase('idle');
    setError(null);
    setLiveToolCalls(new Map());
    pendingRunRef.current = null;

    if (gwReady && hasStartedInitialDetectingRef.current) {
      // Unsubscribe from previous session's message stream
      if (prevSessionKeyRef.current && prevSessionKeyRef.current !== sessionKey) {
        gwApi.sessionsMessagesUnsubscribe(prevSessionKeyRef.current).catch(() => {});
      }
      // Subscribe to the new session's message stream
      gwApi.sessionsMessagesSubscribe(sessionKey).catch(() => {});
      prevSessionKeyRef.current = sessionKey;
      loadHistory();
    }
    return () => {
      // Cleanup: unsubscribe when unmounting or session changes
      if (sessionKey) {
        gwApi.sessionsMessagesUnsubscribe(sessionKey).catch(() => {});
      }
    };
  }, [gwReady, sessionKey, loadHistory]);

  // Fallback reconciliation: if stream events are missing, poll history until assistant reply appears.
  useEffect(() => {
    if (!gwReady || !runId) return;
    const timer = setInterval(async () => {
      const pending = pendingRunRef.current;
      if (!pending || pending.runId !== runId) return;
      await loadHistory({ silent: true });
      setMessages((prev) => {
        // After loadHistory replaces the messages array, check if the latest message
        // is an assistant reply that appeared after our user message.
        // Use a text-based check: find the last user message and see if there's an assistant after it.
        const lastIdx = prev.length - 1;
        const latest = prev[lastIdx];
        const lastUserIdx = prev.reduce((acc, m, i) => m.role === 'user' ? i : acc, -1);
        const hasAssistantAfterUser = lastUserIdx >= 0 && lastIdx > lastUserIdx && latest?.role === 'assistant';
        if (hasAssistantAfterUser) {
          setRunId(null);
          if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
          streamTextRef.current = '';
          setStream(null);
          setRunPhase('idle');
          pendingRunRef.current = null;
        } else if (Date.now() - pending.startedAt > 90000) {
          setRunId(null);
          if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
          streamTextRef.current = '';
          setStream(null);
          setRunPhase('error');
          pendingRunRef.current = null;
          setError(cRef.current.error);
        }
        return prev;
      });
    }, 1500);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  // Safety net: if stream is empty string for too long without receiving events, reset to idle.
  // This prevents the "Generating..." indicator from getting stuck when final event is missed.
  useEffect(() => {
    if (stream !== '' || runPhase !== 'streaming') return;
    const timer = setTimeout(() => {
      if (streamTextRef.current === '' || streamTextRef.current == null) {
        if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
        streamTextRef.current = '';
        setStream(null);
        setRunPhase('idle');
        setRunId(null);
        pendingRunRef.current = null;
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [stream, runPhase]);

  // Delta idle timeout: if actively streaming but no new delta for 60s, recover via history reload.
  useEffect(() => {
    if (runPhase !== 'streaming') return;
    const timer = setInterval(() => {
      if (lastDeltaAtRef.current && Date.now() - lastDeltaAtRef.current > 60000) {
        console.warn('[sessions] delta idle timeout (60s), recovering via history reload');
        if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
        streamTextRef.current = '';
        lastDeltaAtRef.current = 0;
        setStream(null);
        setRunId(null);
        setRunPhase('idle');
        pendingRunRef.current = null;
        loadHistoryRef.current?.({ silent: true });
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [runPhase]);

  // Auto-reset from 'error' phase: the error message is already displayed in chat,
  // so reset the run phase to 'idle' after a brief delay to restore the send button.
  useEffect(() => {
    if (runPhase !== 'error') return;
    const timer = setTimeout(() => {
      setRunPhase('idle');
    }, 3000);
    return () => clearTimeout(timer);
  }, [runPhase]);

  // Stuck 'waiting' phase recovery: if no first delta arrives within 90s after send,
  // auto-abort the run and recover. This covers cases where the gateway accepted the
  // request but the model/provider never responds.
  useEffect(() => {
    if (runPhase !== 'waiting') return;
    const timer = setInterval(() => {
      const pending = pendingRunRef.current;
      if (pending && Date.now() - pending.startedAt > 90000) {
        console.warn('[sessions] waiting phase idle (90s), auto-aborting and recovering');
        // Attempt to abort the stuck run
        gwApi.sessionsAbort(sessionKeyRef.current, pending.runId).catch(() => {});
        if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
        streamTextRef.current = '';
        setStream(null);
        setRunId(null);
        setRunPhase('idle');
        pendingRunRef.current = null;
        setError(cRef.current.sendTimeout || 'Request timed out — no response from model');
        loadHistoryRef.current?.({ silent: true });
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [runPhase]);

  // Stuck 'running' phase recovery: if runPhase is 'running' (tool execution) for over
  // 60s without any new events, assume the gateway failed to send a terminal event.
  // Recover by reloading history and resetting to idle.
  useEffect(() => {
    if (runPhase !== 'running') return;
    const timer = setInterval(() => {
      const pending = pendingRunRef.current;
      if (pending && Date.now() - pending.startedAt > 60000) {
        console.warn('[sessions] running phase stuck (120s), recovering via history reload');
        if (streamRafRef.current !== null) { clearTimeout(streamRafRef.current); streamRafRef.current = null; }
        streamTextRef.current = '';
        setStream(null);
        setRunId(null);
        setRunPhase('idle');
        pendingRunRef.current = null;
        loadHistoryRef.current?.({ silent: true });
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [runPhase]);

  // Track whether the user is near the bottom of the chat (within 300px)
  const nearBottomRef = useRef(true);

  // Auto-scroll: only scroll to bottom when the user is already near the bottom.
  // This preserves scroll position when reading older messages during silent reloads.
  // Depends on messages, stream, liveToolCalls and runPhase so that intermediate
  // execution states (tool calls, phase transitions) also trigger auto-scroll.
  useEffect(() => {
    if (nearBottomRef.current) {
      chatEndRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
    }
  }, [messages, stream, liveToolCalls, runPhase]);

  // Keep ref for loadOlderMessages to avoid stale closure in scroll handler
  const loadOlderRef = useRef(loadOlderMessages);
  loadOlderRef.current = loadOlderMessages;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      nearBottomRef.current = distFromBottom < 300;
      setShowScrollBtn(distFromBottom > 200);
      // Scroll-to-top: load older messages when near top
      if (el.scrollTop < 100 && !loadingOlderRef.current && nextCursorRef.current) {
        loadOlderRef.current();
      }
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

  const ensureSessionPresent = useCallback((key: string) => {
    setSessions(prev => {
      if (!key || prev.some(s => s.key === key)) return prev;
      // Don't re-add recently deleted sessions
      if (deletedKeysRef.current.has(key)) return prev;
      return [{
        key,
        label: key,
        kind: '',
        lastActiveAt: new Date().toISOString(),
        totalTokens: 0,
        lastMessagePreview: '',
        model: '',
        modelProvider: '',
        inputTokens: 0,
        outputTokens: 0,
        thinkingLevel: '',
        verboseLevel: '',
        reasoningLevel: '',
        sendPolicy: '',
        derivedTitle: key,
        maxContextTokens: 0,
        compacted: false,
        fastMode: undefined,
      }, ...prev];
    });
  }, []);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  useEffect(() => {
    if (!gwReadyRef.current || !sessionKey) return;
    if (deletedKeysRef.current.has(sessionKey)) return;
    if (!sessionsRef.current.some(s => s.key === sessionKey)) {
      ensureSessionPresent(sessionKey);
      loadSessions({ silent: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

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
  const agentRoomSessionCount = useMemo(
    () => sessions.reduce((n, s) => n + (isAgentRoomSessionKey(s.key) ? 1 : 0), 0),
    [sessions]
  );
  const filteredSessions = useMemo(() => {
    let list = sessions;
    if (showAgentRoomSessions) {
      list = list.filter(s => isAgentRoomSessionKey(s.key));
    } else {
      list = list.filter(s => !isAgentRoomSessionKey(s.key));
    }
    if (agentFilter) {
      list = list.filter(s => {
        const parts = (s.key || '').split(':');
        return parts[0] === 'agent' && parts[1] === agentFilter;
      });
    }
    if (!sidebarSearch) return list;
    const q = sidebarSearch.toLowerCase();
    return list.filter(s => 
      (s.label || '').toLowerCase().includes(q) ||
      (s.key || '').toLowerCase().includes(q) ||
      (s.lastMessagePreview || '').toLowerCase().includes(q)
    );
  }, [sessions, sidebarSearch, agentFilter, showAgentRoomSessions]);
  const showSidebarRefreshHint = false; // Suppress flashing refresh hint — background polls are silent
  const showSidebarSkeleton = sessionsLoading && sessions.length === 0 && !wsConnecting && !initialDetecting;
  const showSidebarEmpty = sessions.length === 0 && !sessionsLoading && !wsConnecting && !initialDetecting;

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

  // Stream throttle: batch rapid setStream updates into 50ms minimum intervals (max 20 renders/s).
  // Reduces React re-renders ~3x vs RAF (~16ms) with negligible visual impact.
  const throttledSetStream = useCallback((text: string) => {
    streamTextRef.current = text;
    if (streamRafRef.current === null) {
      streamRafRef.current = window.setTimeout(() => {
        streamRafRef.current = null;
        setStream(streamTextRef.current);
      }, 50) as unknown as number;
    }
  }, []);

  // Cancel any pending throttled stream update and clear stream state.
  // Must be called instead of bare setStream(null) to prevent timeout race condition.
  const clearStream = useCallback(() => {
    if (streamRafRef.current !== null) {
      clearTimeout(streamRafRef.current);
      streamRafRef.current = null;
    }
    streamTextRef.current = '';
    setStream(null);
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
      if (file && items[i].type.startsWith('image/')) {
        pastedFiles.push(file);
      }
    }
    if (pastedFiles.length === 0) return;
    e.preventDefault();
    const results = await Promise.all(pastedFiles.map(readFileAsDataUrl));
    setPendingAttachments(prev => [...(prev || []), ...results].slice(0, 5));
    if (!modelSupportsImages && results.some(r => r.isImage)) toast('warning', cRef.current.modelNoVision || 'Current model does not support image input');
  }, [readFileAsDataUrl, modelSupportsImages, toast]);

  // Handle file input change
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const validFiles = Array.from(files).filter(f => f.size <= MAX_FILE_SIZE && f.type.startsWith('image/'));
    if (validFiles.length === 0) { if (fileInputRef.current) fileInputRef.current.value = ''; return; }
    const results = await Promise.all(validFiles.map(readFileAsDataUrl));
    setPendingAttachments(prev => [...(prev || []), ...results].slice(0, 5));
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!modelSupportsImages) toast('warning', cRef.current.modelNoVision || 'Current model does not support image input');
  }, [readFileAsDataUrl, modelSupportsImages, toast]);

  // Handle drag & drop files into the input area
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    const validFiles = Array.from(files).filter(f => f.size <= MAX_FILE_SIZE && f.type.startsWith('image/'));
    if (validFiles.length === 0) return;
    const results = await Promise.all(validFiles.map(readFileAsDataUrl));
    setPendingAttachments(prev => [...(prev || []), ...results].slice(0, 5));
    if (!modelSupportsImages) toast('warning', cRef.current.modelNoVision || 'Current model does not support image input');
  }, [readFileAsDataUrl, modelSupportsImages, toast]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  // Remove pending attachment
  const removePendingAttachment = useCallback((idx: number) => {
    setPendingAttachments(prev => (prev || []).filter((_, i) => i !== idx));
  }, []);

  // Send message (via REST proxy; streaming events come via Manager WS)
  const sendMessage = useCallback(async () => {
    if (!gwReady || sending || sendingRef.current || isStreaming) return;
    const msg = input.trim();
    const attachments_ = pendingAttachments || [];
    if (!msg && attachments_.length === 0) return;
    sendingRef.current = true;
    ensureSessionPresent(sessionKey);

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
        const rawB64 = att.dataUrl.replace(/^data:[^;]+;base64,/, '');
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: att.mimeType, data: rawB64 } });
      } else {
        contentBlocks.push({ type: 'text', text: `📎 ${att.fileName}` });
      }
    }
    setMessages(prev => [...prev, { role: 'user', content: contentBlocks.length === 1 && contentBlocks[0].type === 'text' ? contentBlocks : contentBlocks, timestamp: Date.now() }]);

    // Build attachments for API — strip data URL prefix to send raw base64 (matches OpenClaw webchat protocol)
    const attachments = attachments_.filter(att => att.isImage).map(att => {
      const match = /^data:([^;]+);base64,(.+)$/.exec(att.dataUrl);
      return {
        type: 'image' as const,
        mimeType: match ? match[1] : att.mimeType,
        content: match ? match[2] : att.dataUrl,
      };
    });

    setInput('');
    setPendingAttachments([]);
    setSending(true);
    setRunPhase('sending');
    setError(null);
    setStream('');

    const idempotencyKey = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    try {
      const sendParams: any = {
        sessionKey,
        message: msg,
        deliver: false,
        idempotencyKey,
      };
      if (attachments.length > 0) {
        sendParams.attachments = attachments;
      }
      const res = await gwApi.proxy('chat.send', sendParams) as any;
      const nextRunId = res?.runId || idempotencyKey;
      // Session is now known to the gateway — remove from local-only set
      localOnlyKeysRef.current.delete(sessionKey);
      setRunId(nextRunId);
      setRunPhase('waiting');
      setError(null);
      void loadSessions();
      pendingRunRef.current = {
        runId: nextRunId,
        beforeCount: messages.length + 1,
        startedAt: Date.now(),
      };
    } catch (err: any) {
      clearStream();
      setRunPhase('error');
      let errMsg = err?.message || cRef.current.error;
      setError(errMsg);
      // Mark the optimistic user message as failed (instead of appending an error assistant msg)
      setMessages(prev => {
        const copy = [...prev];
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === 'user') {
            copy[i] = { ...copy[i], sendFailed: true, sendError: errMsg };
            break;
          }
        }
        return copy;
      });
      pendingRunRef.current = null;
      // If gateway connection just flapped, force a status refresh sooner.
      gwRefresh();
      // Async skill bins diagnostic: check if a missing skill binary caused the error
      if (typeof errMsg === 'string' && /skill|tool|binary|not found/i.test(errMsg)) {
        gwApi.skillsBins().then(bins => {
          if (Array.isArray(bins) && bins.length === 0) {
            setError(prev => prev ? `${prev}  (no skill binaries installed — run "openclaw skills install")` : prev);
          }
        }).catch(() => {});
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, sending, isStreaming, sessionKey, messages.length, pendingAttachments, ensureSessionPresent]);

  // Abort (via REST proxy)
  // IMPORTANT: reset local state FIRST so the UI unlocks immediately even if
  // the gateway is unreachable or the abort RPC hangs.
  const handleAbort = useCallback(async () => {
    const prevRunId = runId;
    setRunId(null);
    clearStream();
    setRunPhase('idle');
    setError(null);
    setLiveToolCalls(new Map());
    pendingRunRef.current = null;
    // Best-effort abort signal — don't await result, fire-and-forget
    if (gwReady) {
      gwApi.proxy('chat.abort', { sessionKey, runId: prevRunId || undefined }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, runId, clearStream, gwReady]);

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
      setInjectResult({ ok: false, text: `${cRef.current.injectFailed}: ${err?.message || ''}` });
    }
    setInjecting(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, injectMsg, injectLabel, injecting]);

  // Resolve session key (via REST proxy)
  const handleResolve = useCallback(async () => {
    if (!gwReady || resolving || !sessionKey.trim()) return;
    setResolving(true);
    setResolveResult(null);
    try {
      const res = await gwApi.sessionsResolve(sessionKey.trim()) as any;
      setResolveResult(res?.key || sessionKey);
      if (res?.key && res.key !== sessionKey) setSessionKey(res.key);
      toast('success', c.resolveOk || 'Session resolved');
    } catch (err: any) {
      toast('error', err?.message || c.resolveFailed || 'Resolve failed');
    }
    setResolving(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, resolving, toast]);

  // Compact session (via REST proxy)
  const handleCompact = useCallback(async () => {
    if (!gwReady || compacting || !sessionKey.trim()) return;
    setCompacting(true);
    setCompactResult(null);
    try {
      await gwApi.sessionsCompact(sessionKey.trim());
      setCompactResult({ ok: true, text: c.compactOk });
      toast('success', c.compactOk || 'Compacted');
      setTimeout(() => setCompactResult(null), 3000);
    } catch (err: any) {
      setCompactResult({ ok: false, text: `${cRef.current.compactFailed}: ${err?.message || ''}` });
      toast('error', err?.message || c.compactFailed || 'Compact failed');
    }
    setCompacting(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, compacting, toast]);

  // Load compaction history
  const handleLoadCompactionHistory = useCallback(async () => {
    if (!gwReady || !sessionKey.trim()) return;
    setCompactionLoading(true);
    setCompactionHistoryOpen(true);
    try {
      const res = await gwApi.sessionsCompactionList(sessionKey.trim()) as any;
      setCompactionCheckpoints(res?.checkpoints || []);
    } catch {
      setCompactionCheckpoints([]);
    }
    setCompactionLoading(false);
  }, [sessionKey, gwReady]);

  const handleCompactionExpand = useCallback(async (checkpointId: string) => {
    if (compactionExpandedId === checkpointId) {
      setCompactionExpandedId(null);
      setCompactionDetail(null);
      return;
    }
    setCompactionExpandedId(checkpointId);
    setCompactionDetailLoading(true);
    setCompactionDetail(null);
    try {
      const res = await gwApi.sessionsCompactionGet(sessionKey.trim(), checkpointId) as any;
      setCompactionDetail({ summary: res?.summary });
    } catch { /* non-critical */ }
    setCompactionDetailLoading(false);
  }, [compactionExpandedId, sessionKey]);

  const handleCompactionRestore = useCallback(async (checkpointId: string) => {
    if (!gwReady || !sessionKey.trim()) return;
    try {
      await gwApi.sessionsCompactionRestore(sessionKey.trim(), checkpointId);
      toast('success', c.compactionRestoreOk || 'Restored');
      loadHistoryRef.current?.({ silent: false });
      loadSessionsRef.current?.({ silent: true });
      setCompactionHistoryOpen(false);
    } catch (err: any) {
      toast('error', err?.message || c.compactionRestoreFailed || 'Restore failed');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, gwReady, toast]);

  const handleCompactionBranch = useCallback(async (checkpointId: string) => {
    if (!gwReady || !sessionKey.trim()) return;
    try {
      const res = await gwApi.sessionsCompactionBranch(sessionKey.trim(), checkpointId) as any;
      toast('success', `${c.compactionBranchOk || 'Branch created'}: ${res?.sessionKey || ''}`);
      loadSessionsRef.current?.({ silent: false });
    } catch (err: any) {
      toast('error', err?.message || c.compactionBranchFailed || 'Branch failed');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, gwReady, toast]);

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
    if (key === sessionKey) {
      setDrawerOpen(false);
      return;
    }
    // Save current draft before switching
    saveDraft(sessionKey, input);
    // Cache current session messages + pagination state before switching away
    setMessages(prev => {
      sessionCacheRef.current.set(sessionKey, { messages: prev, hasMore: hasMoreHistory, cursor: nextCursorRef.current });
      return prev;
    });
    ensureSessionPresent(key);
    clearStream();
    setRunId(null);
    setRunPhase('idle');
    pendingRunRef.current = null;
    setBtwMessage(null);
    setDrawerOpen(false);
    // Restore from cache if available (instant display)
    const cached = sessionCacheRef.current.get(key);
    if (cached) {
      setMessages(cached.messages);
      setHasMoreHistory(cached.hasMore);
      nextCursorRef.current = cached.cursor;
      setIsSwitchingSession(false);
    } else {
      setMessages([]);
      setHasMoreHistory(false);
      nextCursorRef.current = undefined;
      setIsSwitchingSession(true);
    }
    setSessionKey(key);
    // Restore draft for new session
    setInput(loadDraft(key));
    // Clear unread
    setUnreadMap(prev => { const next = { ...prev }; delete next[key]; return next; });
    setExpandedMsgs(new Set());
  }, [sessionKey, input, hasMoreHistory, saveDraft, loadDraft, clearStream, ensureSessionPresent]);

  // New session
  const handleNewSession = useCallback(() => {
    const ts = Date.now();
    // When an agent is selected in the filter, create session scoped to that agent
    const key = agentFilter ? `agent:${agentFilter}:web:${ts}` : `web-${ts}`;
    localOnlyKeysRef.current.add(key);
    ensureSessionPresent(key);
    setIsSwitchingSession(false);
    setSessionKey(key);
    setMessages([]);
    setError(null);
    clearStream();
    setRunId(null);
    setRunPhase('idle');
    pendingRunRef.current = null;
    setBtwMessage(null);
    // Reset pagination state for new session
    setHasMoreHistory(false);
    nextCursorRef.current = undefined;
    // Don't call loadSessions() here — the new session only exists locally until
    // the user sends a message.  An immediate loadSessions() would overwrite the
    // local placeholder with the gateway list (which doesn't know this key yet),
    // causing the session to flash and disappear.
  }, [agentFilter, clearStream, ensureSessionPresent]);

  // Rename session
  const openRenameDialog = useCallback((key: string, currentLabel: string) => {
    setRenameKey(key);
    setRenameLabel(currentLabel || '');
    setBindAgentId('');
    setBindAgentOriginal('');
    setBindPeerIdOriginal('');
    setRenameOpen(true);
    setSessionMenuKey(null);
    // For group/channel sessions, fetch agents + current binding
    const peer = parseSessionKeyPeer(key);
    if (peer && (peer.peerKind === 'group' || peer.peerKind === 'channel')) {
      // Extract original-case peer ID from session's lastTo (preserves casing from channel plugin)
      const sessionData = sessionsRef.current.find(s => s.key === key);
      const originalPeerId = extractPeerIdFromLastTo(sessionData?.lastTo);
      setBindPeerIdOriginal(originalPeerId || '');
      Promise.all([
        gwApi.agents().catch(() => null),
        gwApi.configGet().catch(() => null),
      ]).then(([agentsData, cfg]) => {
        const raw = Array.isArray(agentsData) ? agentsData : agentsData?.agents || [];
        const list = raw.map((a: any) => ({ id: a.id || '', label: a.name?.trim() || a.label || a.id || '' })).filter((a: { id: string }) => a.id);
        setBindAgentsList(list);
        // Find existing peer binding (case-insensitive match to handle mixed sources)
        const parsed = (cfg as any)?.parsed || (cfg as any)?.config || cfg || {};
        const bindings: any[] = Array.isArray(parsed.bindings) ? parsed.bindings : [];
        const existing = bindings.find((b: any) =>
          b.match?.channel?.toLowerCase() === peer.channel &&
          b.match?.peer?.id?.toLowerCase() === peer.peerId &&
          ['group', 'channel'].includes(b.match?.peer?.kind?.toLowerCase() || '')
        );
        const boundId = existing?.agentId || '';
        setBindAgentId(boundId);
        setBindAgentOriginal(boundId);
      });
    } else {
      setBindAgentsList([]);
    }
  }, []);

  const handleRenameSession = useCallback(async () => {
    if (!gwReady || renaming || !renameKey) return;
    setRenaming(true);
    try {
      // Save rename
      await gwApi.proxy('sessions.patch', { key: renameKey, label: renameLabel.trim() || null });
      setSessions(prev => prev.map(s => s.key === renameKey ? { ...s, label: renameLabel.trim() || s.key } : s));
      // Save peer binding if changed
      const peer = parseSessionKeyPeer(renameKey);
      if (peer && (peer.peerKind === 'group' || peer.peerKind === 'channel') && bindAgentId !== bindAgentOriginal) {
        try {
          const cfg = await gwApi.configGet() as any;
          const parsed = cfg?.parsed || cfg?.config || cfg || {};
          const allBindings: any[] = Array.isArray(parsed.bindings) ? parsed.bindings : [];
          // Remove existing peer binding for this channel+peer (case-insensitive match)
          let updated = allBindings.filter((b: any) => !(
            b.match?.channel?.toLowerCase() === peer.channel &&
            b.match?.peer?.id?.toLowerCase() === peer.peerId &&
            ['group', 'channel'].includes(b.match?.peer?.kind?.toLowerCase() || '')
          ));
          // Add new binding if agent selected
          // Use original-case peer ID from session's lastTo when available,
          // because OpenClaw's route matching is case-sensitive.
          if (bindAgentId) {
            const effectivePeerId = bindPeerIdOriginal || peer.peerId;
            updated.push({
              agentId: bindAgentId,
              match: { channel: peer.channel, peer: { kind: peer.peerKind, id: effectivePeerId } }
            });
          }
          await gwApi.configSafePatch({ bindings: updated });
          toast('success', bindAgentId ? (c.bindSaved || 'Agent binding saved') : (c.bindRemoved || 'Agent binding removed'));
        } catch (err: any) {
          toast('error', err?.message || c.bindFailed || 'Failed to save agent binding');
        }
      }
      setRenameOpen(false);
      setRenameKey('');
      setRenameLabel('');
      setBindAgentId('');
      setBindAgentOriginal('');
      setBindPeerIdOriginal('');
    } catch (err: any) {
      console.error('Rename failed:', err);
    } finally {
      setRenaming(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming, renameKey, renameLabel, bindAgentId, bindAgentOriginal, bindPeerIdOriginal, c]);

  // Delete session
  const handleDeleteSession = useCallback(async (key: string) => {
    if (!gwReady || deleting) return;
    if (isProtectedMainSessionKey(key)) {
      toast('error', c.confirmDeleteMain || 'The default main session cannot be deleted.');
      setDeleteConfirmKey(null);
      return;
    }
    setDeleting(true);
    try {
      await gwApi.proxy('sessions.delete', { key });
      // Mark as recently deleted so loadSessions won't re-add it
      deletedKeysRef.current.set(key, Date.now() + 60_000);
      localOnlyKeysRef.current.delete(key);
      // Unsubscribe from the deleted session's message stream
      gwApi.sessionsMessagesUnsubscribe(key).catch(() => {});
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleting, sessionKey, gwReady, toast, c]);

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
    // Escape: dismiss btw message or abort active run
    if (e.key === 'Escape') {
      if (btwMessage) {
        e.preventDefault();
        setBtwMessage(null);
        return;
      }
      if (isStreaming) {
        e.preventDefault();
        handleAbort();
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
  }, [sendMessage, slashOpen, slashFiltered, slashHighlight, selectSlashCommand, input, historyIdx, inputHistory, btwMessage, isStreaming, handleAbort]);

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
  const [securityCfg, setSecurityCfg] = useState<any>(null);
  // Load securityCfg eagerly on gwReady so the right-panel Tool Policy shows immediately
  useEffect(() => {
    if (!gwReady) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getCachedConfig() as any;
        if (!cancelled) setSecurityCfg(cfg);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [gwReady]);
  // Load model options only when override panel is opened
  useEffect(() => {
    if (!settingsOpen || !gwReady) return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = securityCfg || await getCachedConfig() as any;
        if (cancelled) return;
        if (!securityCfg) setSecurityCfg(cfg);
        const providers = cfg?.models?.providers || cfg?.parsed?.models?.providers || cfg?.config?.models?.providers || {};
        const opts: { value: string; label: string }[] = [
          { value: '', label: cRef.current.inherit || 'Inherit' },
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
  }, [settingsOpen, gwReady]);

  // Patch session override (real-time)
  const patchSession = useCallback(async (field: string, patch: Record<string, unknown>) => {
    if (!sessionKey || patchBusy) return;
    setPatchBusy(true);
    setSavedField(null);
    try {
      await gwApi.sessionsPatch(sessionKey, patch as any);
      // For model patches, split "provider/model" into separate fields for correct local display
      let localPatch = patch;
      if (field === 'model' && typeof patch.model === 'string' && patch.model.includes('/')) {
        const parts = patch.model.split('/');
        localPatch = { ...patch, model: parts.slice(1).join('/'), modelProvider: parts[0] };
      }
      setSessions(prev => prev.map(s => s.key === sessionKey ? { ...s, ...localPatch } as GwSession : s));
      // Protect patched fields from being overwritten by the next loadSessions for 10s
      const existing = patchGraceRef.current.get(sessionKey);
      const merged = { ...(existing?.fields ?? {}), ...localPatch };
      patchGraceRef.current.set(sessionKey, { fields: merged, expiresAt: Date.now() + 10_000 });
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
  if (!gwReadyStable && !wsConnecting && gwChecked) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-[#0d1117]">
        <div className="text-center max-w-sm px-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-red-500/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-[32px] text-red-400">cloud_off</span>
            {isSwitchingSession && (
              <div className="absolute inset-0 bg-white/55 dark:bg-[#0d1117]/55 backdrop-blur-[2px] pointer-events-none">
                <div className="max-w-4xl mx-auto p-4 md:p-6">
                  <div className="rounded-xl border border-slate-200/70 dark:border-white/[0.06] bg-white/80 dark:bg-white/[0.03] px-3 py-2 inline-flex items-center gap-2 shadow-sm">
                    <span className="material-symbols-outlined text-[14px] text-primary animate-spin">progress_activity</span>
                    <span className="text-[11px] text-slate-600 dark:text-white/55">{c.connecting}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-2">{c.disconnected}</h3>
          <p className="text-xs theme-text-muted mb-4">{wsError}</p>
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

        {/* Agent Filter + Search */}
        <div className="px-3 py-2.5 border-b border-slate-200 dark:border-white/5 space-y-2">
          <CustomSelect
            value={agentFilter}
            onChange={(v: string) => setAgentFilter(v)}
            options={[
              { value: '', label: c.allAgents || 'All Agents' },
              ...agentsList.map(a => ({ value: a.id, label: a.label || a.id }))
            ]}
            className="w-full h-9 px-2.5 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white/70 sci-input"
          />
          <div className="relative">
            <span className="material-symbols-outlined absolute start-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-white/20 text-[13px]">search</span>
            <input value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)}
              className="w-full h-8 ps-7 pe-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white/70 focus:ring-1 focus:ring-primary/50 outline-none sci-input"
              placeholder={c.searchSessions || 'Search...'} />
          </div>
          {agentRoomSessionCount > 0 && (
            <label
              className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-white/50 cursor-pointer select-none"
              title="AgentRoom 房间派生的 AI 会话（主会话 + aux 会话）——默认隐藏，避免污染常规会话列表"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <span className="material-symbols-outlined text-[13px] text-primary/70">groups</span>
                <span className="truncate">显示 AgentRoom 会话</span>
                <span className="text-slate-400 dark:text-white/30">({agentRoomSessionCount})</span>
              </span>
              <input type="checkbox" checked={showAgentRoomSessions}
                onChange={e => setShowAgentRoomSessions(e.target.checked)}
                className="accent-primary" />
            </label>
          )}
        </div>

        {/* Sessions List — grouped by time */}
        <div className="flex-1 overflow-y-auto custom-scrollbar neon-scrollbar p-2 space-y-1">
          {initialDetecting && (
            <div className="mb-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 flex items-center gap-2">
              <span className="material-symbols-outlined text-[14px] text-primary animate-spin">progress_activity</span>
              <span className="text-[11px] font-medium theme-text-secondary">{c.connecting}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            </div>
          )}
          {showSidebarRefreshHint && (
            <div className="mb-2 px-2">
              <div className="rounded-lg border border-slate-200/70 dark:border-white/[0.06] bg-white/70 dark:bg-white/[0.03] px-2.5 py-1.5 flex items-center gap-2">
                <span className="material-symbols-outlined text-[12px] text-slate-400 dark:text-white/35 animate-spin">progress_activity</span>
                <span className="text-[10px] theme-text-muted">{c.connecting}</span>
              </div>
            </div>
          )}
          {/* Skeleton loading */}
          {showSidebarSkeleton && (
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
          {showSidebarEmpty && (
            <EmptyState icon="chat_bubble_outline" title={c.noSessions} compact />
          )}
          {groupedSessions.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-bold text-slate-400 dark:text-white/25 uppercase tracking-widest px-2 pt-2.5 pb-1">{group.label}</p>
              {group.items.map(s => (
                <div key={s.key} className="relative group">
                  <button onClick={() => selectSession(s.key)}
                    aria-current={sessionKey === s.key ? 'true' : undefined}
                    className={`w-full text-start p-2.5 rounded-xl transition-all border ${sessionKey === s.key
                      ? 'bg-primary/10 border-primary/20 shadow-sm glow-subtle-blue'
                      : 'border-transparent hover:bg-slate-200/50 dark:hover:bg-white/5'
                      }`}>
                    <div className="flex items-start gap-2">
                      <div className={`relative w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${s.kind === 'direct' ? 'bg-blue-500/10 text-blue-500' : s.kind === 'group' ? 'bg-purple-500/10 text-purple-500' : 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-white/30'} ${(s.activeRun || s.isStreaming || s.status === 'running') ? 'ring-1 ring-primary/40 animate-pulse' : ''}`}>
                        <span className="material-symbols-outlined text-[12px]">{s.kind === 'group' ? 'group' : s.kind === 'global' ? 'public' : 'person'}</span>
                        {(s.activeRun || s.isStreaming || s.status === 'running') && <span className="absolute -top-0.5 -end-0.5 w-2 h-2 rounded-full bg-primary border border-white dark:border-[#0d1117]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        {/* Agent name badge (before kind badge) */}
                        {(() => {
                          const kp = (s.key || '').split(':');
                          if (kp[0] !== 'agent' || !kp[1]) return null;
                          const aId = kp[1];
                          const aLabel = agentsList.find(a => a.id === aId)?.label || aId;
                          return (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 truncate max-w-[80px]" title={aId}>
                              {aLabel}
                            </span>
                          );
                        })()}
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${s.kind === 'direct' ? 'bg-blue-500/10 text-blue-500' :
                          s.kind === 'group' ? 'bg-purple-500/10 text-purple-500' :
                            'bg-slate-200 dark:bg-white/5 text-slate-400 dark:text-white/40'
                          }`}>{s.kind || sessionDefault}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {unreadMap[s.key] ? <span className="w-1.5 h-1.5 rounded-full bg-primary" /> : null}
                        {s.status === 'running' && (
                          <span className="text-[9px] font-bold px-1 py-px rounded bg-emerald-500/15 text-emerald-500 animate-pulse">RUN</span>
                        )}
                        {s.status === 'failed' && (
                          <span className="text-[9px] font-bold px-1 py-px rounded bg-red-500/15 text-red-500">ERR</span>
                        )}
                        {(s.status === 'killed' || s.status === 'timeout') && (
                          <span className="text-[9px] font-bold px-1 py-px rounded bg-amber-500/15 text-amber-500">{s.status === 'killed' ? 'STOP' : 'T/O'}</span>
                        )}
                        {s.runtimeMs != null && s.runtimeMs > 0 && s.status !== 'running' && (
                          <span className="text-[9px] text-slate-400 dark:text-white/20 font-mono">{s.runtimeMs < 1000 ? `${s.runtimeMs}ms` : `${(s.runtimeMs / 1000).toFixed(1)}s`}</span>
                        )}
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
                      {s.runner && (
                        <span className="text-[9px] font-bold px-1 py-px rounded bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 truncate max-w-[60px]" title={s.runner}>{s.runner}</span>
                      )}
                      {s.estimatedCostUsd != null && s.estimatedCostUsd > 0 && (
                        <span className="text-[9px] text-slate-400 dark:text-white/20 font-mono">${s.estimatedCostUsd < 0.01 ? s.estimatedCostUsd.toFixed(4) : s.estimatedCostUsd.toFixed(2)}</span>
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
                      title={c.editSession || c.renameSession}>
                      <span className="material-symbols-outlined text-[14px]">edit</span>
                    </button>
                    {!isProtectedMainSessionKey(s.key) && (
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
        <div className="px-3 py-2 border-t border-slate-200 dark:border-white/5 flex items-center gap-2"
          title={`GW: ${gwReady ? 'ready' : 'not ready'} | WS: ${wsConnected ? 'open' : wsConnecting ? 'connecting' : 'closed'}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${
            gwReady && wsConnected ? 'bg-mac-green animate-glow-pulse-green'
            : gwReady && !wsConnected ? 'bg-amber-400 animate-pulse'
            : wsConnecting ? 'bg-mac-yellow animate-pulse'
            : 'bg-slate-300 dark:bg-white/20'
          }`} />
          <span className="text-[11px] font-medium text-slate-400 dark:text-white/40">
            {gwReady && wsConnected ? c.connected
             : gwReady && !wsConnected ? (c.reconnecting || 'Reconnecting…')
             : wsConnecting ? c.connecting
             : c.disconnected}
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
                <span className={`w-1 h-1 rounded-full ${gwReady ? 'bg-mac-green' : 'bg-slate-300 dark:bg-white/20'}`} />
                <span className="text-[11px] text-slate-400 font-medium font-mono hidden sm:inline">{sessionKey}</span>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${runPhaseMeta.textClass}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${runPhaseMeta.dot}`} />
                  {runPhaseMeta.text}
                </span>
                {(runPhase === 'streaming' || runPhase === 'sending' || runPhase === 'running' || runPhase === 'waiting') && liveElapsed > 0 ? (
                  <>
                    <span className="text-slate-300 dark:text-white/15">|</span>
                    <span className="text-[10px] text-primary font-mono tabular-nums">{(liveElapsed / 1000).toFixed(1)}s</span>
                  </>
                ) : null}
                {/* Usage/cost summary from gateway session data */}
                {(() => {
                  const cur = sessions.find(s => s.key === sessionKey);
                  if (!cur) return null;
                  const parts: React.ReactNode[] = [];
                  if (cur.runtimeMs && cur.runtimeMs > 0 && runPhase === 'idle') {
                    parts.push(<span key="rt" className="text-[10px] text-slate-400 dark:text-white/20 font-mono tabular-nums">{fmtDuration(cur.runtimeMs)}</span>);
                  }
                  if (cur.totalTokens && cur.totalTokens > 0) {
                    parts.push(<span key="tk" className="text-[10px] text-slate-400 dark:text-white/20 font-mono tabular-nums" title={`In: ${cur.inputTokens || 0} / Out: ${cur.outputTokens || 0}`}>{(cur.totalTokens / 1000).toFixed(1)}k tok</span>);
                  }
                  if (cur.estimatedCostUsd != null && cur.estimatedCostUsd > 0) {
                    parts.push(<span key="cost" className="text-[10px] text-slate-400 dark:text-white/20 font-mono tabular-nums">${cur.estimatedCostUsd < 0.01 ? cur.estimatedCostUsd.toFixed(4) : cur.estimatedCostUsd.toFixed(2)}</span>);
                  }
                  if (parts.length === 0) return null;
                  return (
                    <>
                      <span className="text-slate-300 dark:text-white/15">|</span>
                      {parts.map((p, i) => <React.Fragment key={i}>{i > 0 && <span className="text-slate-300 dark:text-white/10">/</span>}{p}</React.Fragment>)}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setSettingsOpen(v => !v)}
              className={`p-2 rounded-lg transition-colors ${settingsOpen ? 'text-primary bg-primary/10' : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-600'}`}
              title={c.overrides || 'Overrides'}>
              <span className="material-symbols-outlined text-[18px]">tune</span>
            </button>
            <button onClick={() => { setMsgSearchOpen(v => !v); if (!msgSearchOpen) setTimeout(() => msgSearchRef.current?.focus(), 100); }}
              className={`p-2 rounded-lg transition-colors ${msgSearchOpen ? 'text-primary bg-primary/10' : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-600'}`}
              title={c.searchMessages || 'Search Messages'}>
              <span className="material-symbols-outlined text-[18px]">search</span>
            </button>
            <button onClick={() => { loadSessions(); void loadHistory({ force: true }); }}
              className="p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg transition-colors"
              title={c.refresh || 'Refresh'}>
              <span className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
            {/* Overflow menu for secondary actions */}
            <div className="relative">
              <button onClick={() => setToolbarMenuOpen(v => !v)}
                className={`p-2 rounded-lg transition-colors ${toolbarMenuOpen ? 'text-primary bg-primary/10' : 'text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-600'}`}
                title={c.moreActions || 'More actions'}>
                <span className="material-symbols-outlined text-[18px]">more_horiz</span>
              </button>
              {toolbarMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setToolbarMenuOpen(false)} />
                  <div className="absolute top-full end-0 mt-1 z-50 rounded-xl theme-panel sci-card shadow-xl py-1.5 min-w-[180px] animate-fade-in">
                    <button onClick={() => { exportChat('md'); setToolbarMenuOpen(false); }} disabled={messages.length === 0}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] theme-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 transition-colors">
                      <span className="material-symbols-outlined text-[16px]">description</span>
                      {c.exportMarkdown || 'Export Markdown'}
                    </button>
                    <button onClick={() => { exportChat('json'); setToolbarMenuOpen(false); }} disabled={messages.length === 0}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] theme-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 transition-colors">
                      <span className="material-symbols-outlined text-[16px]">data_object</span>
                      {c.exportJson || 'Export JSON'}
                    </button>
                    <div className="my-1 border-t border-slate-200/60 dark:border-white/[0.06]" />
                    <button onClick={() => { setInjectOpen(true); setToolbarMenuOpen(false); }} disabled={!gwReady}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] hover:bg-purple-50 dark:hover:bg-purple-500/10 text-purple-500/70 hover:text-purple-600 dark:hover:text-purple-400 disabled:opacity-30 transition-colors">
                      <span className="material-symbols-outlined text-[16px]">add_comment</span>
                      {c.inject || 'Inject Message'}
                    </button>
                    <button onClick={() => { handleResolve(); setToolbarMenuOpen(false); }} disabled={!gwReady || resolving || !sessionKey.trim()}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] hover:bg-blue-50 dark:hover:bg-blue-500/10 text-blue-500/70 hover:text-blue-600 dark:hover:text-blue-400 disabled:opacity-30 transition-colors">
                      <span className={`material-symbols-outlined text-[16px] ${resolving ? 'animate-spin' : ''}`}>{resolving ? 'progress_activity' : 'link'}</span>
                      {c.resolve || 'Resolve'}
                    </button>
                    <button onClick={() => { handleCompact(); setToolbarMenuOpen(false); }} disabled={!gwReady || compacting || !sessionKey.trim()}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] hover:bg-amber-50 dark:hover:bg-amber-500/10 text-amber-500/70 hover:text-amber-600 dark:hover:text-amber-400 disabled:opacity-30 transition-colors">
                      <span className={`material-symbols-outlined text-[16px] ${compacting ? 'animate-spin' : ''}`}>{compacting ? 'progress_activity' : 'compress'}</span>
                      {c.compact || 'Compact'}
                    </button>
                    <button onClick={() => { handleLoadCompactionHistory(); setToolbarMenuOpen(false); }} disabled={!gwReady || !sessionKey.trim()}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[11px] hover:bg-amber-50 dark:hover:bg-amber-500/10 text-amber-500/70 hover:text-amber-600 dark:hover:text-amber-400 disabled:opacity-30 transition-colors">
                      <span className="material-symbols-outlined text-[16px]">history</span>
                      {c.compactionHistory || 'Compaction History'}
                    </button>
                    <button onClick={() => { setRepairOpen(true); handleRepairScan(); setToolbarMenuOpen(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-[11px] transition-colors ${repairIssues.length > 0 ? 'text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10' : 'hover:bg-emerald-50 dark:hover:bg-emerald-500/10 text-emerald-500/70 hover:text-emerald-600 dark:hover:text-emerald-400'} disabled:opacity-30`}>
                      <span className={`material-symbols-outlined text-[16px] ${repairScanning ? 'animate-spin' : ''}`}>{repairScanning ? 'progress_activity' : 'healing'}</span>
                      {c.repair || 'Repair'}
                      {repairIssues.length > 0 && <span className="ms-auto text-[9px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded-full px-1.5 py-0.5">{repairIssues.length}</span>}
                    </button>
                  </div>
                </>
              )}
            </div>
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

        {/* Compaction History Panel */}
        {compactionHistoryOpen && (
          <div className="shrink-0 border-b border-slate-200/60 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.015] px-4 py-3 animate-fade-in">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold theme-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-amber-500">history</span>
                  {c.compactionHistory || 'Compaction History'}
                </h3>
                <button onClick={() => setCompactionHistoryOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white/60 rounded transition-colors">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
              {compactionLoading ? (
                <div className="flex items-center justify-center py-4">
                  <span className="material-symbols-outlined text-[18px] animate-spin text-amber-500">progress_activity</span>
                </div>
              ) : compactionCheckpoints.length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-white/30 text-center py-3">{c.compactionEmpty || 'No compaction history'}</p>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto neon-scrollbar">
                  {compactionCheckpoints.map(cp => {
                    const isExpanded = compactionExpandedId === cp.id;
                    return (
                    <div key={cp.id} className={`rounded-lg bg-white/50 dark:bg-white/[0.02] border transition-colors ${isExpanded ? 'border-amber-400/50 dark:border-amber-500/30' : 'border-slate-200/40 dark:border-white/[0.04] hover:border-amber-300/50 dark:hover:border-amber-500/20'}`}>
                      <div className="flex items-center gap-3 px-3 py-2 cursor-pointer" onClick={() => handleCompactionExpand(cp.id)}>
                        <span className={`material-symbols-outlined text-[14px] text-amber-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>chevron_right</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold text-slate-600 dark:text-white/60 truncate">
                            {c.compactionCheckpoint || 'Checkpoint'} — {new Date(cp.createdAt).toLocaleString()}
                          </p>
                          <p className="text-[9px] text-slate-400 dark:text-white/30">
                            {c.compactionBefore || 'Before'}: {cp.tokensBefore.toLocaleString()} tokens / {cp.messagesBefore} msgs → {c.compactionAfter || 'After'}: {cp.tokensAfter.toLocaleString()} tokens / {cp.messagesAfter} msgs
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                          <button onClick={() => handleCompactionBranch(cp.id)} title={c.compactionBranch || 'Branch'}
                            className="p-1 rounded text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors">
                            <span className="material-symbols-outlined text-[14px]">call_split</span>
                          </button>
                          <button onClick={() => handleCompactionRestore(cp.id)} title={c.compactionRestore || 'Restore'}
                            className="p-1 rounded text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors">
                            <span className="material-symbols-outlined text-[14px]">restore</span>
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="px-3 pb-2 pt-0 border-t border-slate-100 dark:border-white/[0.04] animate-fade-in">
                          {compactionDetailLoading ? (
                            <div className="flex items-center gap-1.5 py-1.5 text-[10px] theme-text-muted">
                              <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                              {c.loading || 'Loading...'}
                            </div>
                          ) : compactionDetail?.summary ? (
                            <div className="py-1.5">
                              <p className="text-[9px] font-bold theme-text-muted uppercase tracking-wider mb-1">{c.compactionSummary || 'Summary'}</p>
                              <p className="text-[10px] theme-text-secondary leading-relaxed whitespace-pre-wrap">{compactionDetail.summary}</p>
                            </div>
                          ) : (
                            <p className="text-[9px] text-slate-400 dark:text-white/25 py-1.5 italic">{c.compactionNoSummary || 'No summary available'}</p>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Collapsible Session Override Settings Panel */}
        {settingsOpen && activeSession && (
          <div className="shrink-0 border-b border-slate-200/60 dark:border-white/[0.06] bg-slate-50/50 dark:bg-white/[0.015] px-4 py-3 animate-fade-in">
            <div className="max-w-6xl mx-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-bold theme-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-primary">tune</span>
                  {c.overrides || 'Session Overrides'}
                </h3>
                <button onClick={() => setSettingsOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white/60 rounded transition-colors">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
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
                {/* Fast Mode */}
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                    {c.fastMode || 'Fast'}
                    {savedField === 'fastMode' && <span className="material-symbols-outlined text-[11px] text-mac-green">check_circle</span>}
                  </span>
                  <CustomSelect value={activeSession.fastMode === true ? 'on' : activeSession.fastMode === false ? 'off' : ''} disabled={patchBusy}
                    onChange={v => patchSession('fastMode', { fastMode: v === 'on' ? true : v === 'off' ? false : null })}
                    options={[{ value: '', label: c.inherit || 'Inherit' }, { value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
                    className="w-full mt-0.5 px-2 py-1 rounded-lg bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[10px] text-slate-700 dark:text-white/70" />
                </label>
                {/* Model Override */}
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 dark:text-white/40 uppercase flex items-center gap-1">
                    {c.modelOverride || 'Model'}
                    {savedField === 'model' && <span className="material-symbols-outlined text-[11px] text-mac-green">check_circle</span>}
                  </span>
                  {modelOptions.length > 1 ? (
                    <CustomSelect value={activeSession.modelProvider && activeSession.model ? `${activeSession.modelProvider}/${activeSession.model}` : activeSession.model || ''} disabled={patchBusy}
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
          <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4">
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

            {/* Load older messages indicator */}
            {loadingOlder && (
              <div className="flex items-center justify-center gap-2 py-3">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                <span className="text-[11px] text-text-secondary">{c.loadingOlder || 'Loading older messages…'}</span>
              </div>
            )}
            {!loadingOlder && !hasMoreHistory && messages.length > 0 && !chatLoading && (
              <div className="text-center py-2">
                <span className="text-[10px] text-text-muted">{c.noMoreHistory || 'Beginning of conversation'}</span>
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
                  <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded-md theme-field font-mono text-[8px] shadow-sm">↑</kbd> {c.historyRecall || 'History'}</span>
                  <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded-md theme-field font-mono text-[8px] shadow-sm">/</kbd> {c.slashCommands || 'Commands'}</span>
                  <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded-md theme-field font-mono text-[8px] shadow-sm">Shift+Enter</kbd> {c.newLine || 'New line'}</span>
                  <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 rounded-md theme-field font-mono text-[8px] shadow-sm">Esc</kbd> {c.abort || 'Abort'}</span>
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

            {error && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[11px] text-red-400">
                <div className="min-w-0">
                  <div className="font-bold uppercase tracking-wide">{c.error || 'Error'}</div>
                  <div className="truncate">{error}</div>
                </div>
                <button
                  onClick={() => { loadSessions(); void loadHistory({ force: true }); }}
                  className="shrink-0 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[10px] font-bold text-red-300 hover:bg-red-500/15 transition-colors"
                >
                  {c.refresh || 'Refresh'}
                </button>
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
              const text = stripSilentSentinel(extractText(msg.content));
              const tools = extractToolCalls(msg.content);
              const images = extractImages(msg.content);
              const thinkingBlocks = extractThinking(msg.content);
              const isUser = msg.role === 'user';
              const isSystem = msg.role === 'system';
              const isTool = msg.role === 'tool';
              const showAvatar = isFirstInGroup(msgGroups, idx);
              const isLast = isLastInGroup(msgGroups, idx);
              const messageKey = getMessageRenderKey(msg, idx);

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
                  <React.Fragment key={messageKey}>
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
                  <React.Fragment key={messageKey}>
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
                <React.Fragment key={messageKey}>
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
                  <div className={`max-w-[90%] md:max-w-[90%] group ${isUser ? 'ms-auto' : ''}`}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, idx, text, isUser }); }}>
                    <div className={`p-3.5 md:p-4 shadow-sm border backdrop-blur-sm select-text cursor-text ${isUser
                      ? `bg-primary/95 text-white border-primary/30 ${showAvatar ? 'rounded-2xl rounded-se-sm' : isLast ? 'rounded-2xl rounded-se-sm' : 'rounded-xl rounded-se-sm'}`
                      : `bg-white/80 dark:bg-white/[0.05] text-slate-800 dark:text-slate-200 border-slate-200/70 dark:border-white/[0.08] msg-glow-accent ${showAvatar ? 'rounded-2xl rounded-ss-sm' : isLast ? 'rounded-2xl rounded-ss-sm' : 'rounded-xl rounded-ss-sm'}`
                      }`}>
                      {/* Thinking blocks (folded) */}
                      {thinkingBlocks.length > 0 && (
                        <div className="mb-2">
                          {thinkingBlocks.map((tb, ti) => (
                            <ThinkingBlock key={`think-${messageKey}-${ti}`} content={tb} labels={{ thinking: c.thinkingLabel }} />
                          ))}
                        </div>
                      )}

                      {/* Main text — Markdown for assistant, plain for user */}
                      {isUser ? (
                        <div className="text-[13px] md:text-[14px] leading-relaxed whitespace-pre-wrap break-words">{highlightSearch(displayText)}</div>
                      ) : (
                        <MarkdownMessageBoundary content={displayText} copyCodeLabel={c.copyCode} />
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
                                key={`${messageKey}-tool-${ti}`}
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
                      {isUser && !msg.sendFailed && (
                        <button onClick={() => resendMessage(idx)}
                          className="flex items-center gap-0.5 text-[11px] text-white/60 hover:text-white transition-colors">
                          <span className="material-symbols-outlined text-[12px]">replay</span>
                          {c.resend || 'Edit'}
                        </button>
                      )}
                      {/* Send failed indicator + retry */}
                      {isUser && msg.sendFailed && (
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-0.5 text-[11px] text-red-400">
                            <span className="material-symbols-outlined text-[12px]">error</span>
                            {msg.sendError || c.error || 'Failed'}
                          </span>
                          <button onClick={() => resendMessage(idx)}
                            className="flex items-center gap-0.5 text-[11px] text-amber-400 hover:text-amber-300 transition-colors">
                            <span className="material-symbols-outlined text-[12px]">refresh</span>
                            {c.retry || 'Retry'}
                          </button>
                        </div>
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

            {/* Live tool calls (real-time tool execution) */}
            {liveToolCalls.size > 0 && (
              <div className="flex items-start gap-2.5 md:gap-3">
                <div className="w-7 h-7 md:w-8 md:h-8 shrink-0 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mt-0.5">
                  <span className="material-symbols-outlined text-[14px] md:text-[16px]">build</span>
                </div>
                <div className="max-w-[90%] md:max-w-[90%] space-y-1.5">
                  {Array.from(liveToolCalls.values()).map(tc => {
                    const argsSummary = summarizeToolArgs(tc.toolName, tc.args);
                    const resultSummary = tc.phase === 'done' ? summarizeToolResult(tc.result) : '';
                    const durationMs = tc.startedAt && tc.endedAt ? tc.endedAt - tc.startedAt : tc.startedAt ? Date.now() - tc.startedAt : 0;
                    return (
                    <div key={tc.toolCallId} className={`rounded-xl border overflow-hidden transition-all ${
                      tc.phase === 'done'
                        ? tc.isError
                          ? 'border-red-200/60 dark:border-red-500/15 bg-red-50/30 dark:bg-red-500/[0.03]'
                          : 'border-emerald-200/60 dark:border-emerald-500/15 bg-emerald-50/30 dark:bg-emerald-500/[0.03]'
                        : 'border-purple-200/40 dark:border-purple-500/10 bg-purple-50/20 dark:bg-purple-500/[0.02]'
                    }`}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                        onClick={() => setLiveToolCalls(prev => {
                          const next = new Map(prev);
                          const existing = next.get(tc.toolCallId);
                          if (existing) next.set(tc.toolCallId, { ...existing, expanded: !existing.expanded });
                          return next;
                        })}
                      >
                        <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                          tc.phase === 'done'
                            ? tc.isError ? 'bg-red-500/15 border border-red-500/15' : 'bg-emerald-500/15 border border-emerald-500/15'
                            : 'bg-purple-500/15 border border-purple-500/15'
                        }`}>
                          <span className={`material-symbols-outlined text-[11px] ${
                            tc.phase === 'done'
                              ? tc.isError ? 'text-red-400' : 'text-emerald-400'
                              : 'text-purple-400 animate-spin'
                          }`}>
                            {tc.phase === 'done' ? (tc.isError ? 'error' : 'check_circle') : 'progress_activity'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-semibold text-slate-600 dark:text-white/50 truncate">{tc.toolName}</span>
                            {durationMs > 0 && (
                              <span className="text-[9px] font-mono text-slate-400 dark:text-white/25 tabular-nums">{fmtDuration(durationMs)}</span>
                            )}
                          </div>
                          {argsSummary && (
                            <p className="text-[9px] text-slate-400 dark:text-white/25 truncate mt-0.5 font-mono">{argsSummary}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-[9px] font-bold uppercase tracking-wider ${
                            tc.phase === 'done'
                              ? tc.isError ? 'text-red-400/60' : 'text-emerald-400/60'
                              : 'text-purple-400/60'
                          }`}>
                            {tc.phase === 'done' ? (tc.isError ? c.toolError || 'Error' : c.toolDone || 'Done') : c.toolRunning || 'Running'}
                          </span>
                          <span className={`material-symbols-outlined text-[12px] transition-transform ${tc.expanded ? 'rotate-180' : ''} text-slate-400 dark:text-white/25`}>expand_more</span>
                        </div>
                      </button>
                      {tc.expanded && (
                        <div className="px-3 pb-2.5 pt-0 space-y-1.5 border-t border-inherit">
                          {tc.args && (
                            <div className="mt-1.5">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/30">{c.toolArgs || 'Args'}</span>
                              <pre className="text-[9px] font-mono text-slate-500 dark:text-white/35 mt-0.5 whitespace-pre-wrap break-all max-h-24 overflow-y-auto no-scrollbar leading-relaxed">{typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args, null, 2)}</pre>
                            </div>
                          )}
                          {tc.phase === 'done' && resultSummary && (
                            <div>
                              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/30">{c.toolResult || 'Result'}</span>
                              <pre className={`text-[9px] font-mono mt-0.5 whitespace-pre-wrap break-all max-h-24 overflow-y-auto no-scrollbar leading-relaxed ${tc.isError ? 'text-red-400/70' : 'text-slate-500 dark:text-white/35'}`}>{resultSummary}</pre>
                            </div>
                          )}
                          {tc.phase === 'done' && tc.meta && Object.keys(tc.meta).length > 0 && (
                            <div>
                              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-white/30">Meta</span>
                              <pre className="text-[9px] font-mono text-slate-400 dark:text-white/25 mt-0.5 whitespace-pre-wrap break-all max-h-16 overflow-y-auto no-scrollbar leading-relaxed">{JSON.stringify(tc.meta, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Streaming indicator */}
            {stream !== null && (
              <div className="flex items-start gap-2.5 md:gap-3">
                <div className="w-7 h-7 md:w-8 md:h-8 shrink-0 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mt-0.5">
                  <span className="material-symbols-outlined text-[14px] md:text-[16px]">smart_toy</span>
                </div>
                <div className="max-w-[90%] md:max-w-[90%]">
                  <div className="p-3.5 md:p-4 rounded-2xl rounded-ss-sm shadow-sm border bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/[0.06]">
                    {stream ? (
                      <MarkdownMessageBoundary content={stripSilentSentinel(stream)} streaming copyCodeLabel={c.copyCode} />
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

            {/* Compaction in-progress banner (context_compaction.started event from gateway) */}
            {compacting && stream === null && runPhase === 'idle' && (
              <div className="flex justify-center">
                <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600 dark:text-amber-400 font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                  {c.compacting || 'Compacting context…'}
                </div>
              </div>
            )}

            {/* Error — suppress while stream content is still visible */}
            {error && stream === null && (
              <div className="flex justify-center">
                <div className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-[11px] text-red-500 font-medium flex items-center gap-2">
                  <span className="material-symbols-outlined text-[14px]">error</span>
                  {error}
                </div>
              </div>
            )}

            {/* Btw / side-result inline message */}
            {btwMessage && (
              <div className="flex justify-center animate-in fade-in duration-200">
                <div className={`relative max-w-lg w-full mx-4 px-3.5 py-2.5 rounded-xl border text-[12px] ${btwMessage.isError
                  ? 'bg-red-500/5 border-red-500/20 text-red-600 dark:text-red-400'
                  : 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300'}`}>
                  <div className="flex items-start gap-2">
                    <span className={`material-symbols-outlined text-[14px] mt-0.5 shrink-0 ${btwMessage.isError ? 'text-red-500' : 'text-amber-500'}`}>
                      {btwMessage.isError ? 'error' : 'info'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-[11px] opacity-70 mb-0.5">{btwMessage.question}</div>
                      <div className="whitespace-pre-wrap break-words">{btwMessage.text}</div>
                    </div>
                    <button onClick={() => setBtwMessage(null)}
                      className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-current opacity-40 hover:opacity-80 transition-opacity">
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </div>
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
          <div className="fixed inset-0 z-50" onClick={() => setCtxMenu(null)} onContextMenu={e => { e.preventDefault(); setCtxMenu(null); }} onKeyDown={e => { if (e.key === 'Escape') setCtxMenu(null); }} tabIndex={-1} role="dialog" aria-modal="true">
            <div className="absolute rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#1a1c20] shadow-2xl shadow-black/15 dark:shadow-black/40 py-1 min-w-[140px] animate-in fade-in zoom-in-95 duration-100"
              style={{ top: Math.min(ctxMenu.y, window.innerHeight - 180), left: Math.min(ctxMenu.x, window.innerWidth - 160) }}>
              <button onClick={() => { copyToClipboard(ctxMenu.text).catch(() => {}); setCtxMenu(null); }}
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
        {activeSession?.totalTokens && (activeSession?.maxContextTokens || modelCtxMap[getSessionModelKey(activeSession)]) ? (() => {
          const maxCtx = activeSession.maxContextTokens || modelCtxMap[getSessionModelKey(activeSession)] || 0;
          const pct = Math.min(100, (activeSession.totalTokens / maxCtx) * 100);
          const clr = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-emerald-500';
          return (
            <div className="shrink-0 px-4 py-1 border-t border-slate-100/50 dark:border-white/[0.03] flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-slate-200/40 dark:bg-white/5 overflow-hidden">
                <div className={`h-full rounded-full ${clr} transition-all duration-500`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[8px] font-mono text-slate-400 dark:text-white/25 tabular-nums shrink-0">
                {(activeSession.totalTokens / 1000).toFixed(1)}k / {(maxCtx / 1000).toFixed(0)}k
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
            <div className={`relative bg-white dark:bg-gradient-to-br dark:from-[#1a1c22] dark:to-[#14161a] border rounded-2xl md:rounded-[22px] p-1.5 md:p-2 shadow-xl shadow-black/5 dark:shadow-black/30 transition-all sci-input ${dragOver ? 'border-primary border-dashed bg-primary/5 dark:bg-primary/10' : 'border-slate-200/80 dark:border-white/[0.08]'}`}
              onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
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
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
                <button onClick={() => fileInputRef.current?.click()} disabled={!gwReady || (pendingAttachments?.length || 0) >= 5}
                  className="relative w-9 h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center shrink-0 text-slate-400 hover:text-primary hover:bg-primary/5 transition-colors disabled:opacity-30"
                  title={!modelSupportsImages ? (c.modelNoVision || 'Current model does not support image input') : (c.attachFile || 'Attach File')}>
                  <span className="material-symbols-outlined text-[18px]">attach_file</span>
                  {!modelSupportsImages && <span className="absolute top-0.5 end-0.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-[#0d1117]" />}
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
        loadUsage={loadUsageData}
        loadTimeseries={loadTimeseriesData}
        labels={{ ...es, ...c }}
        securityInfo={(() => {
          if (!securityCfg) return undefined;
          const parsed = securityCfg?.parsed || securityCfg?.config || securityCfg || {};
          const globalTools = parsed?.tools || {};
          const agentsCfg = parsed?.agents || {};
          const agentId = sessionKey?.split(':')?.[1] || '';
          const agentList: any[] = agentsCfg?.list || [];
          const agentEntry = agentList.find((e: any) => e?.id === agentId) || {};
          const { policy } = resolveEffectivePolicy(globalTools, agentsCfg?.defaults || {}, agentEntry);
          return {
            toolProfile: policy.toolProfile,
            sandboxMode: policy.sandboxMode,
            execSecurity: policy.execSecurity || '—',
            execHost: policy.execHost,
            execAsk: policy.execAsk,
          };
        })()}
        session={(() => {
          const agentMatch = sessionKey.match(/^agent:([^:]+):/);
          const agentId = agentMatch?.[1];
          const agentObj = agentId ? agentsList.find(ag => ag.id === agentId) : undefined;
          const maxContextTokens = activeSession?.maxContextTokens || modelCtxMap[getSessionModelKey(activeSession)] || 0;
          return {
            model: activeSession?.model,
            modelProvider: activeSession?.modelProvider,
            totalTokens: activeSession?.totalTokens,
            inputTokens: activeSession?.inputTokens,
            outputTokens: activeSession?.outputTokens,
            maxContextTokens,
            compacted: activeSession?.compacted,
            thinkingLevel: activeSession?.thinkingLevel,
            reasoningLevel: activeSession?.reasoningLevel,
            verboseLevel: activeSession?.verboseLevel,
            sendPolicy: activeSession?.sendPolicy,
            fastMode: activeSession?.fastMode,
            kind: activeSession?.kind,
            messageCount: messages.length || undefined,
            lastLatencyMs: lastLatencyMs,
            liveElapsed: liveElapsed,
            runPhase: runPhase,
            agentId,
            agentLabel: agentObj?.label || agentObj?.id,
          };
        })()}
        onNavigateAgent={(() => {
          const agentMatch = sessionKey.match(/^agent:([^:]+):/);
          const agentId = agentMatch?.[1];
          if (!agentId) return undefined;
          return () => {
            dispatchOpenWindow({ id: 'agents', agentId, panel: 'tools' });
          };
        })()}
        onModelChange={async (model) => {
          try {
            await gwApi.sessionsPatch(sessionKey, { model: model || null });
            // Split "provider/model" into separate fields for correct local display
            const parts = model ? model.split('/') : [];
            const patch = parts.length >= 2
              ? { model: parts.slice(1).join('/'), modelProvider: parts[0] }
              : { model: model || '' };
            setSessions(prev => prev.map(s => s.key === sessionKey ? { ...s, ...patch } as GwSession : s));
            // Protect from loadSessions overwrite for 10s
            const existing = patchGraceRef.current.get(sessionKey);
            const merged = { ...(existing?.fields ?? {}), ...patch };
            patchGraceRef.current.set(sessionKey, { fields: merged, expiresAt: Date.now() + 10_000 });
            toast('info', `Model → ${model || 'inherit'}`, 2000);
          } catch (e: any) {
            toast('error', e?.message || 'Failed to change model');
          }
        }}
        loadModels={async () => {
          const cfg = await gwApi.configGet() as any;
          const providers = cfg?.models?.providers || cfg?.parsed?.models?.providers || cfg?.config?.models?.providers || {};
          const opts: { value: string; label: string }[] = [{ value: '', label: c.inherit || 'Inherit' }];
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
          return opts;
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
              {c.editSession || c.renameSession}
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

            {/* Bind Agent — only for group/channel sessions */}
            {bindAgentsList.length > 0 && parseSessionKeyPeer(renameKey) && (
              <div className="mt-4">
                <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">
                  <span className="material-symbols-outlined text-[12px] align-middle me-0.5">link</span>
                  {c.bindAgent || 'Bind Agent'}
                </label>
                <CustomSelect
                  value={bindAgentId}
                  onChange={setBindAgentId}
                  options={[
                    { value: '', label: c.bindDefault || 'Default (no override)' },
                    ...bindAgentsList.map(a => ({ value: a.id, label: a.label || a.id }))
                  ]}
                  className="w-full h-9 px-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-xl text-[12px] text-slate-800 dark:text-white/80"
                  disabled={renaming}
                />
                <p className="text-[10px] text-slate-400 dark:text-white/30 mt-1">
                  {c.bindAgentHint || "Route this peer's messages to a specific agent"}
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setRenameOpen(false)} disabled={renaming}
                className="px-4 py-2 rounded-xl text-[11px] font-bold text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                {c.cancel}
              </button>
              <button onClick={handleRenameSession} disabled={renaming}
                className="px-4 py-2 rounded-xl bg-primary text-white text-[11px] font-bold disabled:opacity-40 transition-all flex items-center gap-1.5">
                {renaming && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                {renaming ? c.renaming : (c.saveSession || c.renameSession)}
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
            {(() => {
              const protectedMain = isProtectedMainSessionKey(deleteConfirmKey);
              return (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${protectedMain ? 'bg-amber-500/10 text-amber-500' : 'bg-red-500/10 text-red-500'}`}>
                      <span className="material-symbols-outlined text-[22px]">{protectedMain ? 'warning' : 'delete'}</span>
                    </div>
                    <div>
                      <h3 className="text-[16px] font-bold text-slate-800 dark:text-white">{protectedMain ? c.protectedMainSessionTitle : c.deleteSession}</h3>
                      <p className="text-[12px] text-slate-400 dark:text-white/30">{protectedMain ? c.protectedMainSessionDesc : c.confirmDeleteSession}</p>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-white/[0.02] rounded-xl p-3 mb-4">
                    <p className="text-[10px] text-slate-400 dark:text-white/30 mb-1">{c.sessionKey}</p>
                    <code className="text-[11px] font-mono text-slate-700 dark:text-white/70 break-all">{deleteConfirmKey}</code>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button onClick={() => setDeleteConfirmKey(null)} disabled={deleting}
                      className="px-4 py-2 rounded-xl text-[11px] font-bold text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">
                      {c.cancel}
                    </button>
                    <button onClick={() => protectedMain ? setDeleteConfirmKey(null) : handleDeleteSession(deleteConfirmKey)} disabled={deleting}
                      className={`px-4 py-2 rounded-xl text-white text-[11px] font-bold disabled:opacity-40 transition-all flex items-center gap-1.5 ${protectedMain ? 'bg-amber-500' : 'bg-red-500'}`}>
                      {deleting && !protectedMain && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                      {protectedMain ? c.protectedMainSessionOk : (deleting ? c.deleting : c.deleteSession)}
                    </button>
                  </div>
                </div>
              );
            })()}
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
