
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Language, dispatchOpenWindow } from '../types';
import { getTranslation } from '../locales';
import { gwApi, hostInfoApi, llmApi, gatewayProfileApi } from '../services/api';
import { fmtAgoCompact } from '../utils/time';
import { useToast } from '../components/Toast';
import { useGatewayEvents } from '../hooks/useGatewayEvents';
import CustomSelect from '../components/CustomSelect';
import NumberStepper from '../components/NumberStepper';
import EmptyState from '../components/EmptyState';
import { copyToClipboard } from '../utils/clipboard';
import { SecurityPolicyBadges } from '../components/SecurityPolicyBadges';
import { resolveEffectivePolicy } from '../utils/exec-policy';

interface NodesProps { language: Language; }

interface PresenceEntry {
  host?: string; ip?: string; version?: string; mode?: string;
  reason?: string; platform?: string; deviceFamily?: string;
  roles?: string[]; scopes?: string[]; ts: number;
}

interface NodeEntry {
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  remoteIp?: string;
  caps?: string[];
  commands?: string[];
  paired?: boolean;
  connected?: boolean;
  connectedAtMs?: number;
  pathEnv?: string[];
  permissions?: Record<string, unknown>;
}

interface DeviceTokenSummary {
  role: string;
  scopes?: string[];
  createdAtMs?: number;
  rotatedAtMs?: number;
  revokedAtMs?: number;
  lastUsedAtMs?: number;
}

interface PendingDevice {
  requestId: string;
  deviceId: string;
  displayName?: string;
  role?: string;
  remoteIp?: string;
  isRepair?: boolean;
  ts?: number;
}

interface PairedDevice {
  deviceId: string;
  displayName?: string;
  roles?: string[];
  scopes?: string[];
  remoteIp?: string;
  tokens?: DeviceTokenSummary[];
  createdAtMs?: number;
  approvedAtMs?: number;
}

interface NodeDetail {
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  remoteIp?: string;
  caps?: string[];
  commands?: string[];
  pathEnv?: string[];
  permissions?: Record<string, unknown>;
  connectedAtMs?: number;
  paired?: boolean;
  connected?: boolean;
}

interface BindingAgent {
  id: string;
  name?: string;
  index: number;
  isDefault: boolean;
  binding?: string | null;
}

interface NodeAlert {
  id: string;
  type: 'offline' | 'back' | 'heartbeat_lost';
  nodeName: string;
  nodeId: string;
  ts: number;
}

type TabId = 'nodes' | 'devices' | 'bindings';
type NodeFilter = 'all' | 'online' | 'offline';
type SortKey = 'name' | 'status' | 'platform' | 'lastSeen' | 'lastUsed' | 'connectedAt';
type GroupKey = 'none' | 'platform' | 'status' | 'version';
type ViewMode = 'grid' | 'list' | 'compact';
type NodeWizardPanel = 'connect' | 'approve' | 'status';

// --- Utility helpers ---

const fmtAge = (seconds?: number | null) => fmtAgoCompact(seconds ?? undefined, undefined, 'seconds') || '-';
// ...

function fmtTs(ms?: number | null): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString();
}

function truncateId(id: string, maxLen = 16): string {
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen - 3) + '...';
}

function isNodeOnline(node: NodeEntry): boolean {
  return node.connected === true;
}

function getHealthStatus(node: NodeEntry): 'healthy' | 'warning' | 'critical' | 'unknown' {
  if (node.connected == null) return 'unknown';
  return node.connected ? 'healthy' : 'critical';
}

const HEALTH_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  healthy:  { dot: 'bg-mac-green',            bg: 'bg-mac-green/10',   text: 'text-mac-green' },
  warning:  { dot: 'bg-amber-400',            bg: 'bg-amber-400/10',   text: 'text-amber-500' },
  critical: { dot: 'bg-mac-red',              bg: 'bg-mac-red/10',     text: 'text-mac-red' },
  unknown:  { dot: 'bg-slate-300 dark:bg-white/20', bg: 'bg-slate-100 dark:bg-white/5', text: 'text-slate-400 dark:text-white/40' },
};

function sortNodes(list: NodeEntry[], key: SortKey): NodeEntry[] {
  return [...list].sort((a, b) => {
    switch (key) {
      case 'name': return (a.displayName || a.nodeId).localeCompare(b.displayName || b.nodeId);
      case 'status': return (isNodeOnline(b) ? 1 : 0) - (isNodeOnline(a) ? 1 : 0);
      case 'lastUsed': return (b.connectedAtMs ?? 0) - (a.connectedAtMs ?? 0);
      case 'connectedAt': return (b.connectedAtMs ?? 0) - (a.connectedAtMs ?? 0);
      default: return 0;
    }
  });
}

function groupNodes(list: NodeEntry[], key: GroupKey, nd: any): { label: string; nodes: NodeEntry[] }[] {
  if (key === 'none') return [{ label: '', nodes: list }];
  const groups = new Map<string, NodeEntry[]>();
  for (const n of list) {
    let gk: string;
    switch (key) {
      case 'platform': gk = n.platform || nd?.ungrouped || '-'; break;
      case 'status': gk = n.connected ? (nd?.online || 'Online') : n.paired ? (nd?.paired || 'Paired') : (nd?.offline || 'Offline'); break;
      case 'version': gk = n.version || n.coreVersion || nd?.ungrouped || '-'; break;
      default: gk = '-';
    }
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk)!.push(n);
  }
  return Array.from(groups.entries()).map(([label, nodes]) => ({ label, nodes }));
}

function quoteCliArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

const Nodes: React.FC<NodesProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const nd = (t as any).nd;
  const es = (t as any).es as any;
  const chat = (t as any).chat as any;
  const ndRef = useRef(nd);
  ndRef.current = nd;
  const { toast } = useToast();

  const [tab, setTab] = useState<TabId>('nodes');
  const [nodes, setNodes] = useState<NodeEntry[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const [pending, setPending] = useState<PendingDevice[]>([]);
  const [paired, setPaired] = useState<PairedDevice[]>([]);
  
  // Search and filter state
  const [nodeSearchInput, setNodeSearchInput] = useState('');
  const [nodeSearch, setNodeSearch] = useState('');
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>('all');
  const [deviceSearchInput, setDeviceSearchInput] = useState('');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [showEventLog, setShowEventLog] = useState(false);
  const [showPairFlow, setShowPairFlow] = useState(false);
  const [showAdvancedPairTools, setShowAdvancedPairTools] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState('');
  const [nodePending, setNodePending] = useState<any[]>([]);
  const [localDeviceId, setLocalDeviceId] = useState('');
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [selectedNode, setSelectedNode] = useState<NodeEntry | null>(null);
  const [nodeDetail, setNodeDetail] = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  // Invoke state
  const [invokeCmd, setInvokeCmd] = useState('');
  const [invokeParams, setInvokeParams] = useState('');
  const [invokeTimeout, setInvokeTimeout] = useState('');
  const [invoking, setInvoking] = useState(false);
  const [invokeResult, setInvokeResult] = useState<{ ok: boolean; text: string; payload?: unknown } | null>(null);

  // Pair request state
  const [pairNodeId, setPairNodeId] = useState('');
  const [pairName, setPairName] = useState('');
  const [pairPlatform, setPairPlatform] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairResult, setPairResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Pair verify state
  const [verifyNodeId, setVerifyNodeId] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Rename state
  const [renameNodeId, setRenameNodeId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Event log state
  const [eventLog, setEventLog] = useState<string[]>([]);

  // === NEW: Sort, Group, View, Batch, Auto-refresh, Alerts ===
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [groupKey, setGroupKey] = useState<GroupKey>('none');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterVersion, setFilterVersion] = useState('');
  const [filterHealth, setFilterHealth] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchCmd, setBatchCmd] = useState('');
  const [batchParams, setBatchParams] = useState('');
  const [batching, setBatching] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoRefreshSec, setAutoRefreshSec] = useState(15);
  const [alerts, setAlerts] = useState<NodeAlert[]>([]);
  const prevNodesRef = useRef<NodeEntry[]>([]);

  // === NEW: Devices tab enhancements ===
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [deviceFilterRole, setDeviceFilterRole] = useState('');
  const [deviceFilterTokenStatus, setDeviceFilterTokenStatus] = useState('');
  const [deviceFilterLastUsed, setDeviceFilterLastUsed] = useState('');
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; desc: string; onOk: () => void; variant?: 'danger' | 'success' } | null>(null);
  const [pairNodeIdError, setPairNodeIdError] = useState('');
  const [verifyTokenError, setVerifyTokenError] = useState('');
  const [showNodeWizard, setShowNodeWizard] = useState(false);
  const [nodeWizardPanel, setNodeWizardPanel] = useState<NodeWizardPanel>('connect');
  const [nodeWizardHost, setNodeWizardHost] = useState('127.0.0.1');
  const [nodeWizardPort, setNodeWizardPort] = useState('18789');
  const [nodeWizardTls, setNodeWizardTls] = useState(false);
  const [nodeWizardNodeId, setNodeWizardNodeId] = useState('');
  const [nodeWizardName, setNodeWizardName] = useState('');
  const [nodeWizardToken, setNodeWizardToken] = useState('');
  const [nodeWizardRunning, setNodeWizardRunning] = useState(false);
  const [nodeWizardResult, setNodeWizardResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [nodeWizardStep, setNodeWizardStep] = useState<1 | 2 | 3>(1);
  const [nodeWizardTesting, setNodeWizardTesting] = useState(false);
  const [nodeWizardTestResult, setNodeWizardTestResult] = useState<{ ok: boolean; http: boolean; ws: boolean; detail?: string } | null>(null);
  const [nodeWizardShowCmd, setNodeWizardShowCmd] = useState(false);
  const [nodeServiceStatus, setNodeServiceStatus] = useState<any>(null);
  const [nodeServiceLoading, setNodeServiceLoading] = useState(false);
  const [localNodeExpanded, setLocalNodeExpanded] = useState(false);

  // === NEW: Bindings tab enhancements ===
  const [bindingTestResults, setBindingTestResults] = useState<Record<string, { ok: boolean; ms?: number; error?: string; loading?: boolean }>>({});
  const [showBindingVisual, setShowBindingVisual] = useState(false);
  const [loadBalanceStrategy, setLoadBalanceStrategy] = useState('auto');
  const [bindingHistory, setBindingHistory] = useState<{ ts: number; config: any }[]>([]);
  const [showBindingHistory, setShowBindingHistory] = useState(false);
  const [bindingTemplates, setBindingTemplates] = useState<{ name: string; config: any }[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const fetchPresence = useCallback(async () => {
    try {
      const res = await gwApi.systemPresence();
      if (Array.isArray(res)) setPresence(res);
    } catch { /* silent */ }
  }, []);

  const fetchNodes = useCallback(async () => {
    setNodesLoading(true); setError('');
    try {
      const res = await gwApi.nodeList() as any;
      const list = Array.isArray(res?.nodes) ? res.nodes : [];
      setNodes(list);
    } catch (e: any) { setError(String(e)); }
    finally { setNodesLoading(false); }
  }, []);

  const fetchNodesQuiet = useCallback(async () => {
    try {
      const res = await gwApi.nodeList() as any;
      const list = Array.isArray(res?.nodes) ? res.nodes : [];
      setNodes(list);
    } catch { /* silent */ }
  }, []);

  const fetchPresenceQuiet = useCallback(async () => {
    try {
      const res = await gwApi.systemPresence();
      if (Array.isArray(res)) setPresence(res);
    } catch { /* silent */ }
  }, []);

  // Real-time: node.invoke.request events + node status tracking
  useGatewayEvents(useMemo(() => ({
    'node.invoke.request': (p) => {
      const cmd = p.command || p.requestId || '?';
      const node = p.nodeId || '?';
      setEventLog(prev => [`[${new Date().toLocaleTimeString()}] invoke.request → ${node}: ${cmd}`, ...prev.slice(0, 49)]);
    },
    'health': () => {
      if (autoRefresh) {
        fetchNodesQuiet();
        fetchPresenceQuiet();
      }
    },
  }), [autoRefresh, fetchNodesQuiet, fetchPresenceQuiet]));

  // Alert generation: detect node status changes
  useEffect(() => {
    const prev = prevNodesRef.current;
    if (prev.length === 0) { prevNodesRef.current = nodes; return; }
    const prevMap = new Map(prev.map(n => [n.nodeId, n]));
    const newAlerts: NodeAlert[] = [];
    for (const n of nodes) {
      const p = prevMap.get(n.nodeId);
      if (p && isNodeOnline(p) && !isNodeOnline(n)) {
        newAlerts.push({ id: `${n.nodeId}-${Date.now()}`, type: 'offline', nodeName: n.displayName || n.nodeId, nodeId: n.nodeId, ts: Date.now() });
      }
      if (p && !isNodeOnline(p) && isNodeOnline(n)) {
        newAlerts.push({ id: `${n.nodeId}-${Date.now()}`, type: 'back', nodeName: n.displayName || n.nodeId, nodeId: n.nodeId, ts: Date.now() });
      }
    }
    if (newAlerts.length > 0) {
      setAlerts(a => [...newAlerts, ...a].slice(0, 50));
      for (const al of newAlerts) {
        const msg = al.type === 'offline'
          ? (ndRef.current?.alertNodeOffline || '').replace('{name}', al.nodeName)
          : (ndRef.current?.alertNodeBack || '').replace('{name}', al.nodeName);
        toast(al.type === 'offline' ? 'error' : 'success', msg);
      }
    }
    prevNodesRef.current = nodes;
  }, [nodes, toast]);

  // Auto-refresh timer
  useEffect(() => {
    if (!autoRefresh || autoRefreshSec < 5) return;
    const timer = setInterval(fetchNodesQuiet, autoRefreshSec * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, autoRefreshSec, fetchNodesQuiet]);

  // Unique platform & version values for filter dropdowns
  const platformOptions = useMemo(() => {
    const set = new Set(nodes.map(n => n.platform).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [nodes]);
  const versionOptions = useMemo(() => {
    const set = new Set(nodes.map(n => n.version).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [nodes]);

  // Filtered nodes: search + status + platform + version + health
  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (nodeSearch.trim()) {
      const s = nodeSearch.toLowerCase();
      result = result.filter(n =>
        n.nodeId.toLowerCase().includes(s) ||
        n.displayName?.toLowerCase().includes(s) ||
        n.remoteIp?.toLowerCase().includes(s) ||
        n.platform?.toLowerCase().includes(s)
      );
    }
    if (nodeFilter === 'online') result = result.filter(isNodeOnline);
    else if (nodeFilter === 'offline') result = result.filter(n => !isNodeOnline(n));
    if (filterPlatform) result = result.filter(n => n.platform === filterPlatform);
    if (filterVersion) result = result.filter(n => n.version === filterVersion);
    if (filterHealth) result = result.filter(n => getHealthStatus(n) === filterHealth);
    return result;
  }, [nodes, nodeSearch, nodeFilter, filterPlatform, filterVersion, filterHealth]);

  // Sort & group
  const sortedNodes = useMemo(() => sortNodes(filteredNodes, sortKey), [filteredNodes, sortKey]);
  const groupedNodes = useMemo(() => groupNodes(sortedNodes, groupKey, nd), [sortedNodes, groupKey, nd]);

  const filteredPending = useMemo(() => {
    if (!deviceSearch.trim()) return pending;
    const s = deviceSearch.toLowerCase();
    return pending.filter(d =>
      d.deviceId.toLowerCase().includes(s) ||
      d.displayName?.toLowerCase().includes(s) ||
      d.remoteIp?.toLowerCase().includes(s)
    );
  }, [pending, deviceSearch]);

  const filteredPaired = useMemo(() => {
    if (!deviceSearch.trim()) return paired;
    const s = deviceSearch.toLowerCase();
    return paired.filter(d =>
      d.deviceId.toLowerCase().includes(s) ||
      d.displayName?.toLowerCase().includes(s) ||
      d.remoteIp?.toLowerCase().includes(s)
    );
  }, [paired, deviceSearch]);

  const renderedPending = useMemo(() => filteredPending.slice(0, 120), [filteredPending]);
  const omittedPending = Math.max(0, filteredPending.length - renderedPending.length);
  const renderedPaired = useMemo(() => filteredPaired.slice(0, 120), [filteredPaired]);
  const omittedPaired = Math.max(0, filteredPaired.length - renderedPaired.length);

  // Stats
  const onlineCount = useMemo(() => nodes.filter(isNodeOnline).length, [nodes]);
  const offlineCount = useMemo(() => nodes.length - onlineCount, [nodes, onlineCount]);
  const hasActiveFilters = filterPlatform || filterVersion || filterHealth;

  // Batch selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const selectAllVisible = useCallback(() => {
    const allIds = sortedNodes.map(n => n.nodeId);
    setSelectedIds(new Set(allIds));
  }, [sortedNodes]);
  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  // Batch invoke
  const handleBatchInvoke = useCallback(() => {
    if (selectedIds.size === 0 || !batchCmd.trim() || batching) return;
    const cmd = batchCmd.trim();
    setConfirmDialog({
      title: nd?.batchInvokeTitle || 'Batch Invoke',
      desc: (nd?.batchInvokeConfirm || 'Execute {cmd} on {count} nodes?').replace('{count}', String(selectedIds.size)).replace('{cmd}', cmd),
      onOk: async () => {
        setConfirmDialog(null);
        setBatching(true);
        let ok = 0;
        let fail = 0;
        let params: unknown = undefined;
        if (batchParams.trim()) {
          try { params = JSON.parse(batchParams); } catch { params = batchParams; }
        }
        for (const nodeId of selectedIds) {
          try {
            await gwApi.proxy('node.invoke', {
              nodeId, command: cmd, params,
              idempotencyKey: `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            });
            ok++;
          } catch { fail++; }
        }
        toast(fail === 0 ? 'success' : 'error',
          (ndRef.current?.batchInvokeOk || '').replace('{count}', String(ok)) + (fail > 0 ? ` (${fail} failed)` : ''));
        setBatching(false);
        setSelectedIds(new Set());
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, batchCmd, batchParams, batching, toast]);

  const handleCopy = useCallback((text: string) => {
    copyToClipboard(text).then(() => toast('success', ndRef.current.copied)).catch(() => toast('error', 'Copy failed'));
  }, [toast]);

  const fetchDevices = useCallback(async () => {
    setDevicesLoading(true); setDevicesError('');
    try {
      const [devRes, nodeRes] = await Promise.all([
        gwApi.devicePairList().catch(() => null),
        gwApi.nodePairList().catch(() => null),
      ]);
      if (devRes) {
        setPending(Array.isArray((devRes as any)?.pending) ? (devRes as any).pending : []);
        setPaired(Array.isArray((devRes as any)?.paired) ? (devRes as any).paired : []);
      }
      if (nodeRes) {
        setNodePending(Array.isArray((nodeRes as any)?.pending) ? (nodeRes as any).pending : []);
      }
    } catch (e: any) { setDevicesError(String(e)); }
    finally { setDevicesLoading(false); }
  }, []);

  const fetchNodeDetail = useCallback(async (nodeId: string) => {
    setDetailLoading(true);
    setNodeDetail(null);
    setInvokeResult(null);
    try {
      const res = await gwApi.proxy('node.describe', { nodeId }) as NodeDetail;
      setNodeDetail(res);
    } catch (err: any) { toast('error', err?.message || ndRef.current.invokeFailed); }
    finally { setDetailLoading(false); }
  }, [toast]);

  const handleSelectNode = useCallback((node: NodeEntry) => {
    if (selectedNode?.nodeId === node.nodeId) {
      setSelectedNode(null);
      setNodeDetail(null);
      setInvokeResult(null);
    } else {
      setSelectedNode(node);
      fetchNodeDetail(node.nodeId);
    }
  }, [selectedNode, fetchNodeDetail]);

  const handleInvoke = useCallback(async () => {
    if (!selectedNode || invoking || !invokeCmd.trim()) return;
    setInvoking(true);
    setInvokeResult(null);
    try {
      let params: unknown = undefined;
      if (invokeParams.trim()) {
        try { params = JSON.parse(invokeParams); } catch { params = invokeParams; }
      }
      const res = await gwApi.proxy('node.invoke', {
        nodeId: selectedNode.nodeId,
        command: invokeCmd.trim(),
        params,
        timeoutMs: invokeTimeout ? Number(invokeTimeout) : undefined,
        idempotencyKey: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      }) as any;
      setInvokeResult({ ok: true, text: ndRef.current.invokeOk, payload: res?.payload ?? res?.payloadJSON ?? null });
    } catch (err: any) {
      setInvokeResult({ ok: false, text: ndRef.current.invokeFailed + ': ' + (err?.message || '') });
    }
    setInvoking(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, invokeCmd, invokeParams, invokeTimeout, invoking]);

  const handlePairRequest = useCallback(async () => {
    if (!pairNodeId.trim() || pairing) return;
    setPairing(true);
    setPairResult(null);
    try {
      await gwApi.nodePairRequest({ nodeId: pairNodeId.trim(), displayName: pairName.trim() || undefined, platform: pairPlatform.trim() || undefined });
      setPairResult({ ok: true, text: ndRef.current.pairOk });
      setEventLog(prev => [`[${new Date().toLocaleTimeString()}] pair.request → ${pairNodeId.trim()}`, ...prev.slice(0, 49)]);
      setPairNodeId(''); setPairName(''); setPairPlatform('');
      fetchDevices();
    } catch (err: any) {
      setPairResult({ ok: false, text: ndRef.current.pairFailed + ': ' + (err?.message || '') });
    }
    setPairing(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairNodeId, pairName, pairPlatform, pairing, fetchDevices]);

  const handlePairVerify = useCallback(async () => {
    if (!verifyNodeId.trim() || !verifyToken.trim() || verifying) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await gwApi.nodePairVerify(verifyNodeId.trim(), verifyToken.trim()) as any;
      setVerifyResult({ ok: true, text: ndRef.current.pairVerifyOk + (res?.valid === false ? ` (${ndRef.current.invalid})` : '') });
    } catch (err: any) {
      setVerifyResult({ ok: false, text: ndRef.current.pairVerifyFailed + ': ' + (err?.message || '') });
    }
    setVerifying(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyNodeId, verifyToken, verifying]);

  const handleRename = useCallback(async (nodeId: string) => {
    if (!renameName.trim() || renaming) return;
    setRenaming(true);
    try {
      await gwApi.nodeRename(nodeId, renameName.trim());
      setRenameNodeId(null);
      setRenameName('');
      fetchNodes();
    } catch (err: any) { toast('error', err?.message || ndRef.current?.renameFailed); }
    setRenaming(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameName, renaming, fetchNodes, toast]);

  const fetchConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const res = await gwApi.configGet() as any;
      setConfig(res?.config || res || {});
    } catch { }
    finally { setConfigLoading(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setNodeSearch(nodeSearchInput.trim()), 120);
    return () => clearTimeout(timer);
  }, [nodeSearchInput]);

  useEffect(() => {
    const timer = setTimeout(() => setDeviceSearch(deviceSearchInput.trim()), 120);
    return () => clearTimeout(timer);
  }, [deviceSearchInput]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { fetchNodes(); fetchPresence(); fetchDevices(); });
    return () => cancelAnimationFrame(raf);
  }, [fetchNodes, fetchPresence, fetchDevices]);
  useEffect(() => {
    if (tab === 'devices') {
      fetchDevices();
      if (!localDeviceId) {
        hostInfoApi.deviceId().then(res => {
          if (res?.deviceId) setLocalDeviceId(res.deviceId);
        }).catch(() => {});
      }
    }
  }, [tab, fetchDevices, localDeviceId]);
  useEffect(() => { if (tab === 'bindings' && !config) fetchConfig(); }, [tab, config, fetchConfig]);

  const handleApprove = useCallback((requestId: string, displayName?: string) => {
    setConfirmDialog({
      title: ndRef.current?.confirmApproveTitle || 'Approve',
      desc: (ndRef.current?.confirmApproveDesc || 'Approve pairing request from {name}?').replace('{name}', displayName || requestId),
      variant: 'success',
      onOk: () => {
        setConfirmDialog(null);
        gwApi.devicePairApprove(requestId).then(() => {
          toast('success', ndRef.current.approved);
          fetchDevices();
        }).catch((e: any) => { toast('error', String(e)); });
      },
    });
  }, [fetchDevices, toast]);

  const handleReject = useCallback((requestId: string, displayName?: string) => {
    setConfirmDialog({
      title: ndRef.current?.confirmRejectTitle || 'Reject',
      desc: (ndRef.current?.confirmRejectDesc || 'Reject pairing request from {name}?').replace('{name}', displayName || requestId),
      onOk: () => {
        setConfirmDialog(null);
        gwApi.devicePairReject(requestId).then(() => {
          toast('success', ndRef.current.rejected);
          fetchDevices();
        }).catch((e: any) => { toast('error', String(e)); });
      },
    });
  }, [fetchDevices, toast]);

  const handleNodePairApprove = useCallback((requestId: string, displayName?: string) => {
    setConfirmDialog({
      title: ndRef.current?.confirmApproveTitle || 'Approve',
      desc: (ndRef.current?.confirmApproveDesc || 'Approve pairing request from {name}?').replace('{name}', displayName || requestId),
      variant: 'success',
      onOk: () => {
        setConfirmDialog(null);
        gwApi.nodePairApprove(requestId).then(() => {
          toast('success', ndRef.current.approved);
          setTimeout(() => fetchDevices(), 500);
        }).catch((e: any) => { toast('error', String(e)); });
      },
    });
  }, [fetchDevices, toast]);

  const handleNodePairReject = useCallback((requestId: string, displayName?: string) => {
    setConfirmDialog({
      title: ndRef.current?.confirmRejectTitle || 'Reject',
      desc: (ndRef.current?.confirmRejectDesc || 'Reject pairing request from {name}?').replace('{name}', displayName || requestId),
      onOk: () => {
        setConfirmDialog(null);
        gwApi.nodePairReject(requestId).then(() => {
          toast('success', ndRef.current.rejected);
          setTimeout(() => fetchDevices(), 500);
        }).catch((e: any) => { toast('error', String(e)); });
      },
    });
  }, [fetchDevices, toast]);

  // OpenClaw 2026.4.26+: remove a stale gateway-owned node pairing record.
  // Accepts node id, name, or IP — we pass the canonical nodeId.
  const handleNodePairRemove = useCallback((nodeId: string, displayName?: string) => {
    setConfirmDialog({
      title: ndRef.current?.confirmRemovePairTitle || ndRef.current?.confirmRemoveTitle || 'Remove Pairing',
      desc: (ndRef.current?.confirmRemovePairDesc || 'Remove pairing record for {name}? The node will need to re-pair.').replace('{name}', displayName || nodeId),
      onOk: () => {
        setConfirmDialog(null);
        gwApi.nodePairRemove({ node: nodeId }).then(() => {
          toast('success', ndRef.current?.pairRemoved || 'Pairing removed');
          setSelectedNode(null);
          setNodeDetail(null);
          setTimeout(() => { fetchNodes(); fetchDevices(); }, 300);
        }).catch((e: any) => { toast('error', String(e)); });
      },
    });
  }, [fetchNodes, fetchDevices, toast]);

  const handleRotate = useCallback(async (deviceId: string, role: string, scopes?: string[]) => {
    try {
      const res = await gwApi.deviceTokenRotate(deviceId, role, scopes) as any;
      if (res?.token) {
        await copyToClipboard(res.token);
        toast('success', ndRef.current.tokenRotated + ' - ' + ndRef.current.copied);
      }
      fetchDevices();
    } catch (e: any) {
      toast('error', String(e));
      setDevicesError(String(e));
    }
  }, [fetchDevices, toast]);

  const handleRevoke = useCallback((deviceId: string, role: string) => {
    setConfirmDialog({
      title: ndRef.current?.confirmRevokeTitle || 'Revoke',
      desc: ndRef.current?.confirmRevokeDesc || ndRef.current.confirmRevoke || 'Revoke this token?',
      onOk: () => {
        setConfirmDialog(null);
        gwApi.deviceTokenRevoke(deviceId, role).then(() => {
          toast('success', ndRef.current.revoked);
          fetchDevices();
        }).catch((e: any) => { toast('error', String(e)); });
      },
    });
  }, [fetchDevices, toast]);

  const handleRemoveDevice = useCallback((deviceId: string, displayName?: string) => {
    setConfirmDialog({
      title: ndRef.current?.confirmRemoveTitle || 'Remove Device',
      desc: (ndRef.current?.confirmRemoveDesc || 'Remove device {name}? All tokens will be revoked and the device will need to re-pair.').replace('{name}', displayName || deviceId),
      onOk: () => {
        setConfirmDialog(null);
        gwApi.devicePairRemove(deviceId).then(() => {
          toast('success', ndRef.current?.deviceRemoved || 'Device removed');
          fetchDevices();
        }).catch((e: any) => { toast('error', String(e)); });
      },
    });
  }, [fetchDevices, toast]);

  const clearEventLog = useCallback(() => setEventLog([]), []);
  const dismissAlert = useCallback((id: string) => setAlerts(a => a.filter(x => x.id !== id)), []);
  const dismissAllAlerts = useCallback(() => setAlerts([]), []);
  const clearFilters = useCallback(() => { setFilterPlatform(''); setFilterVersion(''); setFilterHealth(''); }, []);

  const agentsList = useMemo(() => {
    if (!config) return [];
    const list = (config as any)?.agents?.list;
    if (!Array.isArray(list)) return [];
    return list.map((a: any, i: number) => ({
      id: a.id || `agent-${i}`,
      name: a.name,
      index: i,
      isDefault: !!a.default,
      binding: a?.tools?.exec?.node || null,
    })) as BindingAgent[];
  }, [config]);

  const defaultBinding = useMemo(() => (config as any)?.tools?.exec?.node || '', [config]);

  const handleBindDefault = useCallback((nodeId: string) => {
    if (!config) return;
    const next = { ...config };
    if (!next.tools) next.tools = {};
    if (!next.tools.exec) next.tools.exec = {};
    next.tools.exec.node = nodeId || undefined;
    setConfig(next);
    setConfigDirty(true);
  }, [config]);

  const handleBindAgent = useCallback((agentIndex: number, nodeId: string) => {
    if (!config) return;
    const next = JSON.parse(JSON.stringify(config));
    const list = next?.agents?.list;
    if (!Array.isArray(list) || !list[agentIndex]) return;
    if (!list[agentIndex].tools) list[agentIndex].tools = {};
    if (!list[agentIndex].tools.exec) list[agentIndex].tools.exec = {};
    list[agentIndex].tools.exec.node = nodeId || undefined;
    setConfig(next);
    setConfigDirty(true);
  }, [config]);

  const handleSaveBindings = useCallback(async () => {
    if (!config) return;
    setConfigSaving(true);
    try {
      await gwApi.configSetAll(config);
      setConfigDirty(false);
    } catch (e: any) { setError(String(e)); }
    finally { setConfigSaving(false); }
  }, [config]);

  // === Devices: batch approve/reject ===
  const handleBatchApprove = useCallback(() => {
    if (selectedPendingIds.size === 0) return;
    setConfirmDialog({
      title: ndRef.current?.confirmApproveTitle || 'Approve',
      desc: (ndRef.current?.batchApproveConfirm || 'Approve {count} requests?').replace('{count}', String(selectedPendingIds.size)),
      variant: 'success',
      onOk: () => {
        setConfirmDialog(null);
        const ids = [...selectedPendingIds];
        (async () => {
          let ok = 0;
          for (const rid of ids) {
            try { await gwApi.devicePairApprove(rid); ok++; } catch { /* skip */ }
          }
          toast('success', (ndRef.current?.batchApproveOk || '').replace('{count}', String(ok)));
          setSelectedPendingIds(new Set());
          fetchDevices();
        })();
      },
    });
  }, [selectedPendingIds, toast, fetchDevices]);

  const handleBatchReject = useCallback(() => {
    if (selectedPendingIds.size === 0) return;
    setConfirmDialog({
      title: ndRef.current?.confirmRejectTitle || 'Reject',
      desc: (ndRef.current?.batchRejectConfirm || 'Reject {count} requests?').replace('{count}', String(selectedPendingIds.size)),
      onOk: () => {
        setConfirmDialog(null);
        const ids = [...selectedPendingIds];
        (async () => {
          let ok = 0;
          for (const rid of ids) {
            try { await gwApi.devicePairReject(rid); ok++; } catch { /* skip */ }
          }
          toast('success', (ndRef.current?.batchRejectOk || '').replace('{count}', String(ok)));
          setSelectedPendingIds(new Set());
          fetchDevices();
        })();
      },
    });
  }, [selectedPendingIds, toast, fetchDevices]);

  const togglePendingSelect = useCallback((rid: string) => {
    setSelectedPendingIds(prev => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid); else next.add(rid);
      return next;
    });
  }, []);

  // === Devices: enhanced confirm dialog wrappers ===
  const handleRevokeWithDialog = useCallback((deviceId: string, role: string) => {
    setConfirmDialog({
      title: ndRef.current?.confirmRevokeTitle || 'Revoke',
      desc: ndRef.current?.confirmRevokeDesc || '',
      onOk: () => {
        setConfirmDialog(null);
        gwApi.deviceTokenRevoke(deviceId, role).then(() => {
          toast('success', ndRef.current.revoked);
          setEventLog(prev => [`[${new Date().toLocaleTimeString()}] token.revoke → ${deviceId}:${role}`, ...prev.slice(0, 49)]);
          fetchDevices();
        }).catch((e: any) => { toast('error', String(e)); });
      },
    });
  }, [toast, fetchDevices]);

  const handleRotateWithDialog = useCallback((deviceId: string, role: string, scopes?: string[]) => {
    setConfirmDialog({
      title: ndRef.current?.confirmRotateTitle || 'Rotate',
      desc: ndRef.current?.confirmRotateDesc || '',
      onOk: () => {
        setConfirmDialog(null);
        gwApi.deviceTokenRotate(deviceId, role, scopes).then(async (res: any) => {
          if (res?.token) {
            await copyToClipboard(res.token);
            toast('success', ndRef.current.tokenRotated + ' - ' + ndRef.current.copied);
          }
          setEventLog(prev => [`[${new Date().toLocaleTimeString()}] token.rotate → ${deviceId}:${role}`, ...prev.slice(0, 49)]);
          fetchDevices();
        }).catch((e: any) => { toast('error', String(e)); });
      },
    });
  }, [toast, fetchDevices]);

  const handleRejectWithDialog = useCallback((requestId: string, deviceName?: string) => {
    setConfirmDialog({
      title: ndRef.current?.confirmRejectTitle || 'Reject',
      desc: ndRef.current?.confirmRejectDesc || '',
      onOk: () => {
        setConfirmDialog(null);
        gwApi.devicePairReject(requestId).then(() => {
          toast('success', ndRef.current.rejected);
          setEventLog(prev => [`[${new Date().toLocaleTimeString()}] pair.reject → ${deviceName || requestId}`, ...prev.slice(0, 49)]);
          fetchDevices();
        }).catch((e: any) => { toast('error', String(e)); });
      },
    });
  }, [toast, fetchDevices]);

  // === Devices: form validation ===
  const validatePairNodeId = useCallback((v: string) => {
    if (!v.trim()) { setPairNodeIdError(ndRef.current?.pairFieldRequired || ''); return false; }
    if (!/^[\w-]+$/.test(v.trim())) { setPairNodeIdError(ndRef.current?.pairNodeIdFormat || ''); return false; }
    setPairNodeIdError(''); return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateVerifyToken = useCallback((v: string) => {
    if (!v.trim()) { setVerifyTokenError(ndRef.current?.pairFieldRequired || ''); return false; }
    setVerifyTokenError(''); return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // === Devices: batch rotate ===
  const handleBatchRotate = useCallback(() => {
    if (paired.length === 0) return;
    setConfirmDialog({
      title: ndRef.current?.confirmRotateTitle || 'Rotate',
      desc: (ndRef.current?.batchRotateConfirm || 'Rotate {count} tokens?').replace('{count}', String(paired.length)),
      onOk: () => {
        setConfirmDialog(null);
        const items = [...paired];
        (async () => {
          let ok = 0;
          for (const d of items) {
            const tokens = Array.isArray(d.tokens) ? d.tokens : [];
            for (const tk of tokens) {
              if (!tk.revokedAtMs) {
                try { await gwApi.deviceTokenRotate(d.deviceId, tk.role, tk.scopes); ok++; } catch { /* skip */ }
              }
            }
          }
          toast('success', (ndRef.current?.batchRotateOk || '').replace('{count}', String(ok)));
          fetchDevices();
        })();
      },
    });
  }, [paired, toast, fetchDevices]);

  // === Devices: advanced filtering for paired devices ===
  const roleOptions = useMemo(() => {
    const roles = new Set<string>();
    for (const d of paired) {
      if (Array.isArray(d.roles)) d.roles.forEach(r => roles.add(r));
    }
    return Array.from(roles).sort();
  }, [paired]);

  const advancedFilteredPaired = useMemo(() => {
    let list = [...paired];
    if (deviceSearch) {
      const q = deviceSearch.toLowerCase();
      list = list.filter(d =>
        (d.deviceId || '').toLowerCase().includes(q) ||
        (d.displayName || '').toLowerCase().includes(q) ||
        (d.remoteIp || '').toLowerCase().includes(q)
      );
    }
    if (deviceFilterRole) {
      list = list.filter(d => Array.isArray(d.roles) && d.roles.includes(deviceFilterRole));
    }
    if (deviceFilterTokenStatus === 'active') {
      list = list.filter(d => Array.isArray(d.tokens) && d.tokens.some(t => !t.revokedAtMs));
    } else if (deviceFilterTokenStatus === 'revoked') {
      list = list.filter(d => Array.isArray(d.tokens) && d.tokens.every(t => !!t.revokedAtMs));
    }
    if (deviceFilterLastUsed) {
      const now = Date.now();
      const thresholds: Record<string, number> = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
      const ms = thresholds[deviceFilterLastUsed];
      if (ms && deviceFilterLastUsed !== 'inactive') {
        list = list.filter(d => {
          const tokens = Array.isArray(d.tokens) ? d.tokens : [];
          return tokens.some(t => t.lastUsedAtMs && (now - t.lastUsedAtMs) < ms);
        });
      } else if (deviceFilterLastUsed === 'inactive') {
        list = list.filter(d => {
          const tokens = Array.isArray(d.tokens) ? d.tokens : [];
          return !tokens.some(t => t.lastUsedAtMs && (now - t.lastUsedAtMs) < 2592000000);
        });
      }
    }
    return list;
  }, [paired, deviceSearch, deviceFilterRole, deviceFilterTokenStatus, deviceFilterLastUsed]);

  const deviceStatsData = useMemo(() => {
    const total = paired.length;
    const active = paired.filter(d => Array.isArray(d.tokens) && d.tokens.some(t => !t.revokedAtMs)).length;
    const revoked = total - active;
    return { total, active, revoked, pending: pending.length };
  }, [paired, pending]);

  const hasDeviceFilters = deviceFilterRole || deviceFilterTokenStatus || deviceFilterLastUsed;
  const clearDeviceFilters = useCallback(() => { setDeviceFilterRole(''); setDeviceFilterTokenStatus(''); setDeviceFilterLastUsed(''); }, []);

  // === Bindings: test connection ===
  const handleBindingTest = useCallback(async (nodeId: string, agentId: string) => {
    const key = agentId || '__default';
    setBindingTestResults(prev => ({ ...prev, [key]: { ok: false, loading: true } }));
    const start = Date.now();
    try {
      await gwApi.proxy('node.invoke', { nodeId, command: 'ping', timeoutMs: 5000 });
      setBindingTestResults(prev => ({ ...prev, [key]: { ok: true, ms: Date.now() - start } }));
    } catch (e: any) {
      setBindingTestResults(prev => ({ ...prev, [key]: { ok: false, error: e?.message || 'Failed' } }));
    }
  }, []);

  // === Bindings: save template ===
  const handleSaveTemplate = useCallback(() => {
    if (!templateName.trim() || !config) return;
    setBindingTemplates(prev => [...prev, { name: templateName.trim(), config: JSON.parse(JSON.stringify(config)) }]);
    toast('success', ndRef.current?.bindingTemplateSaved || '');
    setTemplateName('');
  }, [templateName, config, toast]);

  const handleApplyTemplate = useCallback((tmpl: { name: string; config: any }) => {
    setConfig(JSON.parse(JSON.stringify(tmpl.config)));
    setConfigDirty(true);
    toast('success', ndRef.current?.bindingTemplateApplied || '');
  }, [toast]);

  // === Bindings: save to history before saving ===
  const handleSaveBindingsEnhanced = useCallback(async () => {
    if (!config) return;
    setBindingHistory(prev => [{ ts: Date.now(), config: JSON.parse(JSON.stringify(config)) }, ...prev.slice(0, 19)]);
    setConfigSaving(true);
    try {
      await gwApi.configSetAll(config);
      setConfigDirty(false);
      setEventLog(prev => [`[${new Date().toLocaleTimeString()}] binding.save`, ...prev.slice(0, 49)]);
    } catch (e: any) { setError(String(e)); }
    finally { setConfigSaving(false); }
  }, [config]);

  const handleRollback = useCallback((entry: { ts: number; config: any }) => {
    setConfirmDialog({
      title: ndRef.current?.bindingRollbackTitle || 'Rollback',
      desc: ndRef.current?.bindingRollbackConfirm || 'Rollback to this configuration?',
      onOk: () => {
        setConfig(JSON.parse(JSON.stringify(entry.config)));
        setConfigDirty(true);
        toast('success', ndRef.current?.bindingRollbackOk || '');
        setConfirmDialog(null);
      },
    });
  }, [toast]);

  // === Bindings: drag-sort agents ===
  const handleDragStart = useCallback((idx: number) => setDragIndex(idx), []);
  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIndex == null || dragIndex === idx) return;
    const next = JSON.parse(JSON.stringify(config));
    const list = next?.agents?.list;
    if (!Array.isArray(list)) return;
    const [moved] = list.splice(dragIndex, 1);
    list.splice(idx, 0, moved);
    setConfig(next);
    setConfigDirty(true);
    setDragIndex(idx);
  }, [dragIndex, config]);
  const handleDragEnd = useCallback(() => setDragIndex(null), []);

  // === WebSocket: badge notification via health event ===
  const [newPairBadge, setNewPairBadge] = useState(0);
  useEffect(() => { if (tab === 'nodes') setNewPairBadge(0); }, [tab]);

  const tabs: { id: TabId; label: string; icon: string; count?: number; badge?: number }[] = [
    { id: 'nodes', label: nd.nodesSection, icon: 'hub', count: nodes.length, badge: newPairBadge },
    { id: 'devices', label: nd.devicesSection, icon: 'devices', count: pending.length + paired.length },
    { id: 'bindings', label: nd.bindingsSection, icon: 'link' },
  ];

  const nodeWizardCommand = useMemo(() => {
    const parts = ['openclaw', 'node', 'install'];
    const host = nodeWizardHost.trim() || '127.0.0.1';
    const port = nodeWizardPort.trim() || '18789';
    parts.push('--host', quoteCliArg(host), '--port', port);
    if (nodeWizardTls) parts.push('--tls');
    if (nodeWizardNodeId.trim()) parts.push('--node-id', quoteCliArg(nodeWizardNodeId.trim()));
    if (nodeWizardName.trim()) parts.push('--display-name', quoteCliArg(nodeWizardName.trim()));
    parts.push('--force');
    return parts.join(' ');
  }, [nodeWizardHost, nodeWizardName, nodeWizardNodeId, nodeWizardPort, nodeWizardTls]);

  const nodeWizardArgs = useMemo(() => {
    const args = ['node', 'install', '--host', nodeWizardHost.trim() || '127.0.0.1', '--port', nodeWizardPort.trim() || '18789'];
    if (nodeWizardTls) args.push('--tls');
    if (nodeWizardNodeId.trim()) args.push('--node-id', nodeWizardNodeId.trim());
    if (nodeWizardName.trim()) args.push('--display-name', nodeWizardName.trim());
    args.push('--force', '--json');
    return args;
  }, [nodeWizardHost, nodeWizardName, nodeWizardNodeId, nodeWizardPort, nodeWizardTls]);

  const handleCopyNodeWizardCommand = useCallback(() => {
    copyToClipboard(nodeWizardCommand)
      .then(() => toast('success', ndRef.current?.copied || 'Copied'))
      .catch(() => toast('error', 'Copy failed'));
  }, [nodeWizardCommand, toast]);

  // Match local node to its gateway-reported entry (for caps/commands display)
  const localNodeGatewayInfo = useMemo(() => {
    if (!nodeServiceStatus?.service?.command?.programArguments || nodes.length === 0) return null;
    const args: string[] = nodeServiceStatus.service.command.programArguments;
    const nidx = args.indexOf('--node-id');
    const didx = args.indexOf('--display-name');
    const hidx = args.indexOf('--host');
    const localNodeId = nidx >= 0 && nidx + 1 < args.length ? args[nidx + 1] : null;
    const displayName = didx >= 0 && didx + 1 < args.length ? args[didx + 1] : null;
    const gatewayHost = hidx >= 0 && hidx + 1 < args.length ? args[hidx + 1] : null;
    return nodes.find((n: NodeEntry) => n.nodeId === localNodeId) ||
      nodes.find((n: NodeEntry) => displayName && n.displayName === displayName) ||
      nodes.find((n: NodeEntry) => gatewayHost && n.remoteIp === gatewayHost) ||
      nodes.find((n: NodeEntry) => n.connected && n.platform === 'win32') ||
      null;
  }, [nodeServiceStatus, nodes]);

  const fetchNodeServiceStatus = useCallback(async () => {
    setNodeServiceLoading(true);
    try {
      const res = await llmApi.exec('openclaw', ['node', 'status', '--json'], 15000);
      if (res.exitCode === 0 && res.stdout) {
        try {
          const idx = res.stdout.indexOf('{');
          const json = idx >= 0 ? JSON.parse(res.stdout.slice(idx)) : null;
          setNodeServiceStatus(json);
        } catch { setNodeServiceStatus({ raw: res.stdout }); }
      } else {
        setNodeServiceStatus({ error: res.stderr || res.stdout || 'Unknown error', exitCode: res.exitCode });
      }
    } catch (e: any) { setNodeServiceStatus({ error: e?.message || 'Failed to query node status' }); }
    finally { setNodeServiceLoading(false); }
  }, []);

  const handleNodeServiceAction = useCallback(async (action: 'start' | 'restart' | 'stop' | 'uninstall') => {
    setNodeServiceLoading(true);
    try {
      await llmApi.exec('openclaw', ['node', action, '--json'], 30000);
      const msgMap: Record<string, string> = {
        start: ndRef.current?.nodeServiceStarted || 'Node service started',
        restart: ndRef.current?.nodeServiceRestarted || 'Node service restarted',
        stop: ndRef.current?.nodeServiceStopped || 'Node service stopped',
        uninstall: ndRef.current?.nodeServiceUninstalled || 'Node service uninstalled',
      };
      toast('success', msgMap[action] || action);
    } catch (e: any) {
      toast('error', e?.message || `Failed to ${action} node service`);
    }
    setTimeout(() => fetchNodeServiceStatus(), 1500);
  }, [fetchNodeServiceStatus, toast]);

  const handleNodeServiceStop = useCallback(() => {
    setConfirmDialog({
      title: ndRef.current?.localNodeStopTitle || 'Stop Node Service',
      desc: ndRef.current?.localNodeStopDesc || 'Stop the local node service? It will no longer respond to gateway commands.',
      variant: 'danger',
      onOk: () => { setConfirmDialog(null); handleNodeServiceAction('stop'); },
    });
  }, [handleNodeServiceAction]);

  const handleNodeServiceUninstall = useCallback(() => {
    setConfirmDialog({
      title: ndRef.current?.localNodeUninstallTitle || 'Uninstall Node Service',
      desc: ndRef.current?.localNodeUninstallDesc || 'Uninstall the local node service? The service definition will be removed. You can reinstall later via the Node Wizard.',
      variant: 'danger',
      onOk: () => { setConfirmDialog(null); handleNodeServiceAction('uninstall'); },
    });
  }, [handleNodeServiceAction]);

  // Auto-fetch local node status on mount
  useEffect(() => { fetchNodeServiceStatus(); }, [fetchNodeServiceStatus]);

  const handleTestNodeConnection = useCallback(async () => {
    const host = nodeWizardHost.trim() || '127.0.0.1';
    const port = parseInt(nodeWizardPort.trim() || '18789', 10);
    if (!host || port <= 0 || port > 65535) {
      toast('error', ndRef.current?.nodeWizardInvalidHost || 'Invalid host or port');
      return;
    }
    setNodeWizardTesting(true);
    setNodeWizardTestResult(null);
    try {
      const res = await gatewayProfileApi.testConnection({ host, port, token: nodeWizardToken.trim() });
      const pw = (res as any)?.protocolWarning as string | undefined;
      if (pw && pw.startsWith('protocol_mismatch:')) {
        // Parse "protocol_mismatch:local=4,remote=3"
        const m = pw.match(/local=(\d+),remote=(\d+)/);
        const local = m?.[1] || '?';
        const remote = m?.[2] || '?';
        const detail = (ndRef.current?.nodeWizardProtocolMismatch || 'Protocol version mismatch: local v{local}, remote v{remote}. Please upgrade the target gateway.')
          .replace('{local}', local).replace('{remote}', remote);
        setNodeWizardTestResult({ ok: false, http: !!(res as any)?.http, ws: !!(res as any)?.ws, detail });
        toast('error', ndRef.current?.nodeWizardProtocolMismatchShort || 'Protocol version mismatch — upgrade target gateway');
      } else {
        setNodeWizardTestResult({ ok: true, http: !!(res as any)?.http, ws: !!(res as any)?.ws });
        setNodeWizardStep(2);
        toast('success', ndRef.current?.nodeWizardTestOk || 'Connection successful');
      }
    } catch (err: any) {
      const detail = err?.message || err?.data?.message || 'Connection failed';
      setNodeWizardTestResult({ ok: false, http: false, ws: false, detail });
      toast('error', ndRef.current?.nodeWizardTestFail || 'Connection failed');
    } finally {
      setNodeWizardTesting(false);
    }
  }, [nodeWizardHost, nodeWizardPort, nodeWizardToken, toast]);

  const handleRunNodeWizard = useCallback(() => {
    setConfirmDialog({
      title: ndRef.current?.nodeWizardRunConfirmTitle || 'Start Node',
      desc: ndRef.current?.nodeWizardRunConfirmDesc || 'Run this OpenClaw node operation on this computer?',
      variant: 'success',
      onOk: async () => {
        setConfirmDialog(null);
        setNodeWizardRunning(true);
        setNodeWizardResult(null);
        try {
          const execEnv: Record<string, string> = {};
          if (nodeWizardToken.trim()) execEnv['OPENCLAW_GATEWAY_TOKEN'] = nodeWizardToken.trim();
          const res = await llmApi.exec('openclaw', nodeWizardArgs, 60000, Object.keys(execEnv).length > 0 ? execEnv : undefined);
          const startRes = res.exitCode === 0
            ? await llmApi.exec('openclaw', ['node', 'start', '--json'], 60000, Object.keys(execEnv).length > 0 ? execEnv : undefined)
            : res;
          const finalRes = startRes || res;
          const ok = res.exitCode === 0 && finalRes.exitCode === 0;
          setNodeWizardResult({
            ok,
            text: ok ? (ndRef.current?.nodeWizardRunOk || 'Node operation started') : (finalRes.stderr || finalRes.stdout || res.stderr || res.stdout || ndRef.current?.nodeWizardRunFailed || 'Node operation failed'),
          });
          if (ok) {
            setNodeWizardStep(3);
            setNodeWizardPanel('status');
            setTimeout(() => fetchNodeServiceStatus(), 2000);
          }
          setEventLog(prev => [`[${new Date().toLocaleTimeString()}] node.install → ${nodeWizardHost}:${nodeWizardPort}`, ...prev.slice(0, 49)]);
          setTimeout(() => { fetchDevices(); fetchNodes(); }, 800);
        } catch (err: any) {
          setNodeWizardResult({ ok: false, text: err?.message || ndRef.current?.nodeWizardRunFailed || 'Node operation failed' });
        } finally {
          setNodeWizardRunning(false);
        }
      },
    });
  }, [fetchDevices, fetchNodes, fetchNodeServiceStatus, nodeWizardArgs, nodeWizardHost, nodeWizardPort, nodeWizardToken]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#0f1115]">
      {/* 顶部 */}
      <div className="flex flex-col border-b border-slate-200 dark:border-white/5 theme-panel shrink-0">
        <div className="h-12 flex items-center justify-center px-4 border-b border-slate-200/50 dark:border-white/5">
          <div className="flex bg-slate-200 dark:bg-black/40 p-0.5 rounded-xl shadow-inner">
            {tabs.map(tb => (
              <button key={tb.id} onClick={() => setTab(tb.id)}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 ${tab === tb.id ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}>
                <span className="material-symbols-outlined text-[14px]">{tb.icon}</span>
                {tb.label}
                {tb.count !== undefined && <span className="text-[11px] opacity-60">{tb.count}</span>}
                {tb.badge && tb.badge > 0 ? <span className="w-4 h-4 rounded-full bg-mac-red text-white text-[9px] font-bold flex items-center justify-center -me-1">{tb.badge}</span> : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar neon-scrollbar">
        <div className="max-w-6xl mx-auto p-4 md:p-6">

          {/* ===== NODES TAB ===== */}
          {tab === 'nodes' && (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-bold text-slate-800 dark:text-white">{nd.nodesSection}</h2>
                  <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{nd.nodesHelp || nd.desc}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {/* Auto-refresh toggle */}
                  <button onClick={() => setAutoRefresh(v => !v)}
                    className={`h-8 px-2.5 flex items-center gap-1 border rounded-lg text-[11px] font-bold transition-all ${
                      autoRefresh
                        ? 'bg-mac-green/10 border-mac-green/30 text-mac-green'
                        : 'theme-field theme-text-secondary hover:bg-slate-200 dark:hover:bg-white/10'
                    }`} title={autoRefresh ? nd.autoRefreshOn : nd.autoRefreshOff}>
                    <span className="material-symbols-outlined text-[14px]">{autoRefresh ? 'sync' : 'sync_disabled'}</span>
                    <span className="hidden sm:inline">{nd.autoRefresh}</span>
                  </button>
                  {/* View mode toggle */}
                  <div className="flex theme-field rounded-lg overflow-hidden">
                    <button onClick={() => setViewMode('grid')}
                      className={`h-8 w-8 flex items-center justify-center transition-all ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white/60'}`}
                      title={nd.viewGrid}>
                      <span className="material-symbols-outlined text-[14px]">grid_view</span>
                    </button>
                    <button onClick={() => setViewMode('list')}
                      className={`h-8 w-8 flex items-center justify-center transition-all ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-slate-400 dark:text-white/40 hover:text-slate-600 dark:hover:text-white/60'}`}
                      title={nd.viewList}>
                      <span className="material-symbols-outlined text-[14px]">view_list</span>
                    </button>
                  </div>
                  {/* Node Wizard toggle */}
                  <button onClick={() => setShowNodeWizard(v => !v)}
                    className={`h-8 px-3 flex items-center gap-1.5 border rounded-lg text-[11px] font-bold transition-all ${showNodeWizard ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-200 dark:hover:bg-white/10'}`}>
                    <span className="material-symbols-outlined text-[14px]">route</span>
                    <span className="hidden sm:inline">{nd.nodeWizard || 'Node Wizard'}</span>
                  </button>
                  {/* Refresh button */}
                  <button onClick={() => { fetchNodes(); fetchPresence(); }} disabled={nodesLoading}
                    className="h-8 px-3 flex items-center gap-1.5 theme-field hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-[11px] font-bold theme-text-secondary disabled:opacity-50">
                    <span className={`material-symbols-outlined text-[14px] ${nodesLoading ? 'animate-spin' : ''}`}>{nodesLoading ? 'progress_activity' : 'refresh'}</span>
                    <span className="hidden sm:inline">{nd.refresh}</span>
                  </button>
                </div>
              </div>

              {/* Stats bar */}
              {nodes.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] font-bold theme-text-secondary">{(nd.nodeCount || '').replace('{count}', String(nodes.length))}</span>
                  <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
                  <span className="text-[11px] font-bold text-mac-green">{(nd.onlineCount || '').replace('{count}', String(onlineCount))}</span>
                  <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
                  <span className="text-[11px] font-bold text-slate-400 dark:text-white/40">{(nd.offlineCount || '').replace('{count}', String(offlineCount))}</span>
                  {autoRefresh && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
                      <span className="text-[11px] text-mac-green flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-mac-green animate-pulse" />
                        {nd.liveUpdatesOn}
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* Gateway Presence bar */}
              {presence.length > 0 && (
                <div className="rounded-xl bg-sky-50 dark:bg-sky-500/[0.04] border border-sky-200/50 dark:border-sky-500/10 p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-[14px] text-sky-500">dns</span>
                    <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400">{nd.gatewayPresence || 'Gateway Presence'} ({presence.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {presence.map((p, i) => (
                      <div key={`${p.host}-${p.ip}-${i}`}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/60 dark:bg-white/5 border border-sky-100 dark:border-white/5 text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-mac-green shrink-0" />
                        <span className="font-bold theme-text">{p.host || p.ip || '?'}</span>
                        {p.version && <span className="theme-text-secondary">v{p.version}</span>}
                        {p.mode && <span className="text-sky-500 dark:text-sky-400">{p.mode}</span>}
                        {p.platform && <span className="theme-text-muted">{p.platform}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Alerts bar */}
              {alerts.length > 0 && (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-500/[0.04] border border-amber-200/50 dark:border-amber-500/10 p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px]">notifications_active</span>
                      {nd.alertTitle} ({alerts.length})
                    </span>
                    <button onClick={dismissAllAlerts} className="text-[10px] text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 font-bold">{nd.dismissAll}</button>
                  </div>
                  {alerts.slice(0, 5).map(al => (
                    <div key={al.id} className="flex items-center gap-2 text-[11px]">
                      <span className={`material-symbols-outlined text-[12px] ${al.type === 'offline' ? 'text-mac-red' : 'text-mac-green'}`}>
                        {al.type === 'offline' ? 'cloud_off' : 'cloud_done'}
                      </span>
                      <span className="flex-1 theme-text-secondary">
                        {al.type === 'offline' ? (nd.alertNodeOffline || '').replace('{name}', al.nodeName) : (nd.alertNodeBack || '').replace('{name}', al.nodeName)}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-white/30">{fmtTs(al.ts)}</span>
                      <button onClick={() => dismissAlert(al.id)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white/60">
                        <span className="material-symbols-outlined text-[12px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Local Node Service Card */}
              {nodeServiceStatus?.service && (
                <div className="rounded-xl bg-cyan-50/50 dark:bg-cyan-500/[0.04] border border-cyan-200/50 dark:border-cyan-500/10 p-3 space-y-2">
                  {/* Summary row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setLocalNodeExpanded(v => !v)} className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
                      <span className="material-symbols-outlined text-[16px] text-cyan-500">deployed_code</span>
                      <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400">{nd.localNodeTitle || 'Local Node Service'}</span>
                      <span className="material-symbols-outlined text-[12px] theme-text-muted">{localNodeExpanded ? 'expand_less' : 'expand_more'}</span>
                    </button>
                    {/* Status badge */}
                    {nodeServiceStatus.service.runtime ? (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${nodeServiceStatus.service.runtime.status === 'running' ? 'bg-mac-green/10 text-mac-green' : 'bg-amber-500/10 text-amber-500'}`}>
                        {nodeServiceStatus.service.runtime.status === 'running' ? (nd.localNodeRunning || 'Running') : (nd.localNodeStopped || 'Stopped')}
                      </span>
                    ) : nodeServiceStatus.service.loaded ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200/50 dark:bg-white/10 theme-text-muted">{nd.localNodeRegistered || 'Registered'}</span>
                    ) : (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200/50 dark:bg-white/10 theme-text-muted">{nd.localNodeNotInstalled || 'Not installed'}</span>
                    )}
                    {/* PID */}
                    {nodeServiceStatus.service.runtime?.pid && (
                      <span className="text-[10px] font-mono theme-text-muted">PID {nodeServiceStatus.service.runtime.pid}</span>
                    )}
                    {/* Connection target */}
                    {nodeServiceStatus.service.command?.programArguments && (() => {
                      const args: string[] = nodeServiceStatus.service.command.programArguments;
                      const hi = args.indexOf('--host');
                      const pi = args.indexOf('--port');
                      const host = hi >= 0 && hi + 1 < args.length ? args[hi + 1] : null;
                      const port = pi >= 0 && pi + 1 < args.length ? args[pi + 1] : null;
                      if (!host) return null;
                      const hasTls = args.includes('--tls');
                      return (
                        <span className="text-[10px] font-mono theme-text-secondary flex items-center gap-1">
                          <span className="material-symbols-outlined text-[11px]">{hasTls ? 'lock' : 'link'}</span>
                          {hasTls ? 'wss' : 'ws'}://{host}:{port || '18789'}
                        </span>
                      );
                    })()}
                    <span className="flex-1" />
                    {/* Action buttons */}
                    {nodeServiceStatus.service.loaded && (
                      <div className="flex items-center gap-1">
                        {nodeServiceStatus.service.runtime?.status !== 'running' && (
                          <button onClick={() => handleNodeServiceAction('start')} disabled={nodeServiceLoading}
                            className="h-7 px-2.5 bg-mac-green/10 hover:bg-mac-green/20 text-mac-green border border-mac-green/20 rounded-lg text-[10px] font-bold flex items-center gap-1 disabled:opacity-50 transition-colors">
                            <span className="material-symbols-outlined text-[13px]">play_arrow</span>{nd.localNodeStart || 'Start'}
                          </button>
                        )}
                        {nodeServiceStatus.service.runtime?.status === 'running' && (
                          <button onClick={handleNodeServiceStop} disabled={nodeServiceLoading}
                            className="h-7 px-2.5 bg-mac-red/10 hover:bg-mac-red/20 text-mac-red border border-mac-red/20 rounded-lg text-[10px] font-bold flex items-center gap-1 disabled:opacity-50 transition-colors">
                            <span className="material-symbols-outlined text-[13px]">stop</span>{nd.localNodeStop || 'Stop'}
                          </button>
                        )}
                        <button onClick={() => handleNodeServiceAction('restart')} disabled={nodeServiceLoading}
                          className="h-7 px-2.5 theme-field hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-[10px] font-bold theme-text-secondary flex items-center gap-1 disabled:opacity-50 transition-colors">
                          <span className="material-symbols-outlined text-[13px]">restart_alt</span>{nd.localNodeRestart || 'Restart'}
                        </button>
                      </div>
                    )}
                    <button onClick={fetchNodeServiceStatus} disabled={nodeServiceLoading}
                      className="h-7 w-7 flex items-center justify-center theme-field hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg theme-text-secondary disabled:opacity-50 transition-colors">
                      <span className={`material-symbols-outlined text-[13px] ${nodeServiceLoading ? 'animate-spin' : ''}`}>{nodeServiceLoading ? 'progress_activity' : 'refresh'}</span>
                    </button>
                  </div>

                  {/* Error detail (always visible when present) */}
                  {nodeServiceStatus.error && (
                    <div className="rounded-lg bg-mac-red/5 border border-mac-red/20 p-2 flex items-start gap-2">
                      <span className="material-symbols-outlined text-[13px] text-mac-red mt-0.5">error</span>
                      <p className="text-[10px] text-mac-red break-all flex-1">{nodeServiceStatus.error}</p>
                    </div>
                  )}

                  {/* Runtime detail (e.g. stopped reason) */}
                  {nodeServiceStatus.service.runtime?.detail && nodeServiceStatus.service.runtime.status !== 'running' && (
                    <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-2 flex items-start gap-2">
                      <span className="material-symbols-outlined text-[13px] text-amber-500 mt-0.5">info</span>
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 break-all flex-1">{nodeServiceStatus.service.runtime.detail}</p>
                    </div>
                  )}

                  {/* Expanded detail section */}
                  {localNodeExpanded && (
                    <div className="space-y-2 pt-1 border-t border-cyan-200/30 dark:border-cyan-500/10">
                      {/* Service file path */}
                      {nodeServiceStatus.service.command?.sourcePath && (
                        <div className="flex items-start gap-2">
                          <span className="material-symbols-outlined text-[12px] theme-text-muted mt-0.5">description</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-bold theme-text-muted uppercase tracking-wider">{nd.localNodeServiceFile || 'Service file'}</p>
                            <p className="text-[10px] font-mono theme-text-secondary truncate select-all" title={nodeServiceStatus.service.command.sourcePath}>{nodeServiceStatus.service.command.sourcePath}</p>
                          </div>
                        </div>
                      )}

                      {/* Working directory */}
                      {nodeServiceStatus.service.command?.workingDirectory && (
                        <div className="flex items-start gap-2">
                          <span className="material-symbols-outlined text-[12px] theme-text-muted mt-0.5">folder</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-bold theme-text-muted uppercase tracking-wider">{nd.localNodeWorkDir || 'Working directory'}</p>
                            <p className="text-[10px] font-mono theme-text-secondary truncate select-all" title={nodeServiceStatus.service.command.workingDirectory}>{nodeServiceStatus.service.command.workingDirectory}</p>
                          </div>
                        </div>
                      )}

                      {/* Full command */}
                      {nodeServiceStatus.service.command?.programArguments?.length > 0 && (
                        <div className="flex items-start gap-2">
                          <span className="material-symbols-outlined text-[12px] theme-text-muted mt-0.5">terminal</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-bold theme-text-muted uppercase tracking-wider">{nd.localNodeCommand || 'Command'}</p>
                            <p className="text-[10px] font-mono theme-text-secondary break-all select-all">{nodeServiceStatus.service.command.programArguments.join(' ')}</p>
                          </div>
                        </div>
                      )}

                      {/* Environment variables */}
                      {nodeServiceStatus.service.command?.environment && (() => {
                        const entries = Object.entries(nodeServiceStatus.service.command.environment as Record<string, string>)
                          .filter(([k]) => k.startsWith('OPENCLAW_'));
                        if (entries.length === 0) return null;
                        return (
                          <div className="flex items-start gap-2">
                            <span className="material-symbols-outlined text-[12px] theme-text-muted mt-0.5">data_object</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[9px] font-bold theme-text-muted uppercase tracking-wider">{nd.localNodeEnv || 'Environment'}</p>
                              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] font-mono mt-0.5">
                                {entries.map(([k, v]) => (
                                  <React.Fragment key={k}>
                                    <span className="theme-text-muted truncate">{k}</span>
                                    <span className="theme-text-secondary truncate select-all">{k.includes('TOKEN') ? '••••••' : v}</span>
                                  </React.Fragment>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Service label */}
                      {nodeServiceStatus.service.label && (
                        <div className="flex items-start gap-2">
                          <span className="material-symbols-outlined text-[12px] theme-text-muted mt-0.5">label</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-bold theme-text-muted uppercase tracking-wider">{nd.localNodeServiceLabel || 'Service label'}</p>
                            <p className="text-[10px] font-mono theme-text-secondary select-all">{nodeServiceStatus.service.label}</p>
                          </div>
                        </div>
                      )}

                      {/* Capabilities & commands from gateway (if connected) */}
                      {localNodeGatewayInfo && (
                        <div className="flex items-start gap-2">
                          <span className="material-symbols-outlined text-[12px] theme-text-muted mt-0.5">neurology</span>
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <p className="text-[9px] font-bold theme-text-muted uppercase tracking-wider">{nd.capabilities || 'Capabilities'}</p>
                            {Array.isArray(localNodeGatewayInfo.caps) && localNodeGatewayInfo.caps.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {localNodeGatewayInfo.caps.map((c: string) => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-mac-green/10 text-mac-green font-bold">{c}</span>)}
                              </div>
                            ) : <p className="text-[10px] theme-text-muted">-</p>}
                            <p className="text-[9px] font-bold theme-text-muted uppercase tracking-wider mt-1">{nd.commands || 'Commands'}</p>
                            {Array.isArray(localNodeGatewayInfo.commands) && localNodeGatewayInfo.commands.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {localNodeGatewayInfo.commands.map((c: string) => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-bold font-mono">{c}</span>)}
                              </div>
                            ) : <p className="text-[10px] theme-text-muted">{nd.noCommands || '-'}</p>}
                          </div>
                        </div>
                      )}

                      {/* Config navigation links */}
                      <div className="flex items-center gap-3 flex-wrap pt-1">
                        <button onClick={() => dispatchOpenWindow({ id: 'agents', panel: 'tools' })}
                          className="text-[10px] text-primary font-bold hover:underline flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[12px]">security</span>
                          {nd.localNodeGoToolConfig || 'Agent tool config'}
                          <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                        </button>
                        <button onClick={() => dispatchOpenWindow({ id: 'editor', section: 'tools' })}
                          className="text-[10px] text-primary font-bold hover:underline flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[12px]">edit_note</span>
                          {nd.localNodeGoGlobalTools || 'Global tools config'}
                          <span className="material-symbols-outlined text-[10px]">open_in_new</span>
                        </button>
                      </div>

                      {/* Danger zone: uninstall */}
                      {nodeServiceStatus.service.loaded && (
                        <div className="flex items-center gap-2 pt-1">
                          <button onClick={handleNodeServiceUninstall} disabled={nodeServiceLoading}
                            className="h-7 px-2.5 bg-mac-red/5 hover:bg-mac-red/15 text-mac-red border border-mac-red/15 rounded-lg text-[10px] font-bold flex items-center gap-1 disabled:opacity-50 transition-colors">
                            <span className="material-symbols-outlined text-[13px]">delete_forever</span>{nd.localNodeUninstall || 'Uninstall'}
                          </button>
                          <span className="text-[9px] theme-text-muted">{nd.localNodeUninstallHint || 'Remove service definition — reinstall via Node Wizard'}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {showNodeWizard && (
                <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-sky-500/[0.04] dark:from-primary/[0.10] dark:to-sky-500/[0.06] p-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-primary text-[20px]">hub</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-slate-800 dark:text-white">{nd.nodeWizard || 'Node Wizard'}</h3>
                      <p className="text-[11px] text-slate-500 dark:text-white/45 mt-1">{nd.nodeWizardDesc || 'Install a local node service and connect it to a remote OpenClaw gateway. After installation, the target gateway admin needs to approve this node.'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-white/70 dark:bg-black/20 border border-white/60 dark:border-white/10 p-1">
                    {[
                      { value: 'connect' as NodeWizardPanel, icon: 'outgoing_mail', label: nd.nodeWizardConnectTab || 'Connect as node' },
                      { value: 'status' as NodeWizardPanel, icon: 'monitor_heart', label: nd.nodeWizardStatusTab || 'Node status' },
                      { value: 'approve' as NodeWizardPanel, icon: 'approval_delegation', label: nd.nodeWizardApproveTab || 'Approve node requests' },
                    ].map(item => (
                      <button key={item.value} onClick={() => setNodeWizardPanel(item.value)}
                        className={`h-9 px-3 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${nodeWizardPanel === item.value ? 'bg-primary text-white shadow-sm' : 'theme-text-secondary hover:bg-slate-100 dark:hover:bg-white/10'}`}>
                        <span className="material-symbols-outlined text-[14px]">{item.icon}</span>
                        {item.label}
                      </button>
                    ))}
                  </div>

                  {nodeWizardPanel === 'connect' && (
                    <>
                    {/* Step indicator */}
                    <div className="flex items-center gap-1">
                      {[
                        { step: 1 as const, icon: 'settings_ethernet', label: nd.nodeWizardStep1 || 'Configure' },
                        { step: 2 as const, icon: 'wifi_tethering', label: nd.nodeWizardTestConnect || 'Test' },
                        { step: 3 as const, icon: 'rocket_launch', label: nd.nodeWizardStep2Short || 'Install' },
                      ].map((s, i) => (
                        <React.Fragment key={s.step}>
                          {i > 0 && <div className={`flex-1 h-px ${nodeWizardStep > s.step - 1 ? 'bg-primary/60' : 'bg-slate-200 dark:bg-white/10'}`} />}
                          <button onClick={() => { if (s.step <= nodeWizardStep || (s.step === 2 && nodeWizardTestResult?.ok)) setNodeWizardStep(s.step); }}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${nodeWizardStep === s.step ? 'bg-primary/15 text-primary border border-primary/30' : nodeWizardStep > s.step ? 'text-mac-green bg-mac-green/5 border border-mac-green/20' : 'theme-text-muted border border-transparent'}`}>
                            <span className="material-symbols-outlined text-[14px]">{nodeWizardStep > s.step ? 'check_circle' : s.icon}</span>
                            <span className="hidden sm:inline">{s.label}</span>
                          </button>
                        </React.Fragment>
                      ))}
                    </div>

                      {nodeWizardStep === 1 && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-2 gap-y-2">
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold theme-text-muted uppercase tracking-wider">{nd.nodeWizardHost || 'Host'} *</label>
                              <input value={nodeWizardHost} onChange={e => { setNodeWizardHost(e.target.value); setNodeWizardTestResult(null); }}
                                placeholder="192.168.1.100"
                                className="w-full h-9 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white/80 outline-none focus:border-primary/50" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold theme-text-muted uppercase tracking-wider">{nd.nodeWizardGatewayPort || 'Gateway Port'} *</label>
                              <NumberStepper value={nodeWizardPort} onChange={v => { setNodeWizardPort(v.replace(/[^0-9]/g, '')); setNodeWizardTestResult(null); }} min={1} max={65535}
                                className="h-9 bg-white dark:bg-black/20" inputClassName="text-[12px]" />
                              <p className="text-[9px] theme-text-muted">{nd.nodeWizardPortHint || 'OpenClaw gateway port (default 18789), not the ClawDeckX port'}</p>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold theme-text-muted uppercase tracking-wider">{nd.nodeWizardGatewayToken || 'Gateway Token'} *</label>
                              <div className="relative">
                                <input value={nodeWizardToken} onChange={e => setNodeWizardToken(e.target.value)} placeholder={nd.nodeWizardGatewayTokenHint || 'Paste the target gateway token here'}
                                  type="password" autoComplete="off"
                                  className="w-full h-9 px-3 pe-8 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] font-mono text-slate-700 dark:text-white/80 outline-none focus:border-primary/50" />
                                <span className="material-symbols-outlined text-[14px] absolute end-2.5 top-1/2 -translate-y-1/2 text-amber-500 dark:text-amber-400">key</span>
                              </div>
                              <p className="text-[9px] theme-text-muted">{nd.nodeWizardGatewayTokenDesc || 'Required — copy from the target gateway\'s settings (gateway.auth.token)'}</p>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold theme-text-muted uppercase tracking-wider">{nd.nodeWizardNodeId || 'Node ID'}</label>
                              <input value={nodeWizardNodeId} onChange={e => setNodeWizardNodeId(e.target.value)} placeholder={nd.nodeWizardNodeIdHint || 'auto-generated if empty'}
                                className="w-full h-9 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] font-mono text-slate-700 dark:text-white/80 outline-none focus:border-primary/50" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold theme-text-muted uppercase tracking-wider">{nd.nodeWizardName || 'Display name'}</label>
                              <input value={nodeWizardName} onChange={e => setNodeWizardName(e.target.value)} placeholder={nd.nodeWizardNameHint || 'e.g. office-pc'}
                                className="w-full h-9 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white/80 outline-none focus:border-primary/50" />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setNodeWizardTls(v => !v)}
                              className={`h-8 px-3 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 transition-colors ${nodeWizardTls ? 'bg-sky-500/10 border-sky-500/30 text-sky-500' : 'bg-white dark:bg-black/20 border-slate-200 dark:border-white/10 theme-text-secondary'}`}>
                              <span className="material-symbols-outlined text-[14px]">{nodeWizardTls ? 'lock' : 'lock_open'}</span>
                              {nodeWizardTls ? (nd.nodeWizardTlsOn || 'TLS on') : (nd.nodeWizardTlsOff || 'TLS off')}
                            </button>
                            {!nodeWizardTls && nodeWizardHost.trim() && !['127.0.0.1', 'localhost', '::1'].includes(nodeWizardHost.trim().toLowerCase()) && (
                              <span className="text-[9px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                                <span className="material-symbols-outlined text-[12px]">warning</span>
                                {nd.nodeWizardInsecureHint || 'Plaintext ws:// to remote host — insecure private network mode will be enabled automatically'}
                              </span>
                            )}
                            <span className="flex-1" />
                            <button onClick={handleTestNodeConnection} disabled={nodeWizardTesting || !nodeWizardHost.trim()}
                              className="h-9 px-4 bg-primary text-white text-[11px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1.5 hover:bg-primary/90 transition-colors">
                              <span className={`material-symbols-outlined text-[14px] ${nodeWizardTesting ? 'animate-spin' : ''}`}>{nodeWizardTesting ? 'progress_activity' : 'wifi_tethering'}</span>
                              {nodeWizardTesting ? (nd.nodeWizardTesting || 'Testing...') : (nd.nodeWizardTestConnect || 'Test connection')}
                            </button>
                          </div>
                          {nodeWizardTestResult && (
                            <div className={`rounded-lg p-3 ${nodeWizardTestResult.ok ? 'bg-mac-green/5 border border-mac-green/20' : 'bg-mac-red/5 border border-mac-red/20'}`}>
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`material-symbols-outlined text-[16px] ${nodeWizardTestResult.ok ? 'text-mac-green' : 'text-mac-red'}`}>{nodeWizardTestResult.ok ? 'check_circle' : 'error'}</span>
                                <span className={`text-[12px] font-bold ${nodeWizardTestResult.ok ? 'text-mac-green' : 'text-mac-red'}`}>
                                  {nodeWizardTestResult.ok ? (nd.nodeWizardTestOk || 'Connection successful') : (nd.nodeWizardTestFail || 'Connection failed')}
                                </span>
                              </div>
                              {nodeWizardTestResult.ok ? (
                                <div className="flex gap-3 text-[11px]">
                                  <span className={`flex items-center gap-1 ${nodeWizardTestResult.http ? 'text-mac-green' : 'text-amber-500'}`}>
                                    <span className="material-symbols-outlined text-[12px]">{nodeWizardTestResult.http ? 'check' : 'remove'}</span>HTTP
                                  </span>
                                  <span className={`flex items-center gap-1 ${nodeWizardTestResult.ws ? 'text-mac-green' : 'text-amber-500'}`}>
                                    <span className="material-symbols-outlined text-[12px]">{nodeWizardTestResult.ws ? 'check' : 'remove'}</span>WebSocket
                                  </span>
                                </div>
                              ) : (
                                <p className="text-[11px] text-mac-red/80">{nodeWizardTestResult.detail}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Step 2: Install service */}
                      {nodeWizardStep === 2 && (
                        <div className="space-y-3">
                          <div className="rounded-lg bg-mac-green/5 border border-mac-green/20 p-3 flex items-center gap-2">
                            <span className="material-symbols-outlined text-mac-green text-[16px]">check_circle</span>
                            <span className="text-[12px] font-bold text-mac-green">{nd.nodeWizardTestPassed || 'Connection verified'}</span>
                            <span className="text-[11px] theme-text-muted ms-1">{nodeWizardHost}:{nodeWizardPort}</span>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button onClick={handleRunNodeWizard} disabled={nodeWizardRunning}
                              className="h-9 px-4 bg-primary text-white text-[11px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1.5 hover:bg-primary/90 transition-colors">
                              <span className={`material-symbols-outlined text-[14px] ${nodeWizardRunning ? 'animate-spin' : ''}`}>{nodeWizardRunning ? 'progress_activity' : 'rocket_launch'}</span>
                              {nodeWizardRunning ? (nd.nodeWizardRunning || 'Installing...') : (nd.nodeWizardStartLocal || 'Install local node service')}
                            </button>
                            <button onClick={() => setNodeWizardStep(1)}
                              className="h-9 px-3 theme-field theme-text-secondary hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-[11px] font-bold flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[14px]">arrow_back</span>{nd.nodeWizardBackConfig || 'Back'}
                            </button>
                          </div>

                          {nodeWizardResult && (
                            <div className={`px-3 py-2 rounded-lg text-[11px] ${nodeWizardResult.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-mac-red/10 text-mac-red'}`}>
                              {nodeWizardResult.text}
                            </div>
                          )}

                          {/* Collapsible command preview */}
                          <button onClick={() => setNodeWizardShowCmd(v => !v)}
                            className="flex items-center gap-1.5 text-[10px] theme-text-muted hover:theme-text-secondary transition-colors">
                            <span className="material-symbols-outlined text-[12px]">{nodeWizardShowCmd ? 'expand_less' : 'expand_more'}</span>
                            {nd.nodeWizardShowCommand || 'Show command'}
                          </button>
                          {nodeWizardShowCmd && (
                            <div className="space-y-2">
                              <div className="rounded-xl bg-slate-950 text-slate-100 p-3 font-mono text-[11px] break-all select-all">
                                {nodeWizardCommand}
                              </div>
                              <button onClick={handleCopyNodeWizardCommand}
                                className="h-8 px-3 theme-field theme-text-secondary hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-[11px] font-bold flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-[14px]">content_copy</span>{nd.copyCommand || 'Copy command'}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Step 3: Done — prompt to approve */}
                      {nodeWizardStep === 3 && (
                        <div className="space-y-3">
                          <div className="rounded-lg bg-mac-green/5 border border-mac-green/20 p-4 text-center">
                            <span className="material-symbols-outlined text-mac-green text-[28px]">task_alt</span>
                            <p className="text-[12px] font-bold text-mac-green mt-2">{nd.nodeWizardInstallDone || 'Node service installed'}</p>
                            <p className="text-[11px] theme-text-muted mt-1">{nd.nodeWizardApproveHint || 'Node request has been sent. The target gateway admin needs to approve this node.'}</p>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => { setNodeWizardStep(1); setNodeWizardTestResult(null); setNodeWizardResult(null); }}
                              className="h-9 px-3 theme-field theme-text-secondary hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-[11px] font-bold flex items-center gap-1.5">
                              <span className="material-symbols-outlined text-[14px]">restart_alt</span>{nd.nodeWizardRestart || 'Start over'}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {nodeWizardPanel === 'status' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-cyan-500">monitor_heart</span>
                        <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{nd.nodeWizardStatusTab || 'Node status'}</h3>
                        <span className="flex-1" />
                        <button onClick={fetchNodeServiceStatus} disabled={nodeServiceLoading}
                          className="h-8 px-3 theme-field theme-text-secondary hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-50">
                          <span className={`material-symbols-outlined text-[14px] ${nodeServiceLoading ? 'animate-spin' : ''}`}>{nodeServiceLoading ? 'progress_activity' : 'refresh'}</span>
                          {nd.refresh || 'Refresh'}
                        </button>
                      </div>
                      {!nodeServiceStatus && !nodeServiceLoading && (
                        <div className="rounded-xl bg-white/70 dark:bg-black/20 border border-white/60 dark:border-white/10 p-6 text-center">
                          <span className="material-symbols-outlined text-[28px] text-slate-300 dark:text-white/20">info</span>
                          <p className="text-[12px] font-bold theme-text mt-2">{nd.nodeWizardStatusEmpty || 'Click Refresh to query node service status'}</p>
                        </div>
                      )}
                      {nodeServiceLoading && !nodeServiceStatus && (
                        <div className="rounded-xl bg-white/70 dark:bg-black/20 border border-white/60 dark:border-white/10 p-6 text-center">
                          <span className="material-symbols-outlined text-[28px] text-primary animate-spin">progress_activity</span>
                          <p className="text-[12px] font-bold theme-text mt-2">{nd.nodeWizardTesting || 'Querying...'}</p>
                        </div>
                      )}
                      {nodeServiceStatus && (
                        <div className="space-y-2">
                          {nodeServiceStatus.error && (
                            <div className="rounded-lg bg-mac-red/5 border border-mac-red/20 p-3">
                              <p className="text-[11px] font-bold text-mac-red">{nd.nodeWizardStatusError || 'Error'}</p>
                              <p className="text-[10px] font-mono theme-text-muted mt-1 break-all">{nodeServiceStatus.error}</p>
                            </div>
                          )}
                          {nodeServiceStatus.service && (
                            <>
                              <div className="rounded-lg bg-white/70 dark:bg-black/20 border border-white/60 dark:border-white/10 p-3 space-y-2">
                                {/* Service installed? */}
                                <div className="flex items-center gap-2">
                                  <span className={`material-symbols-outlined text-[14px] ${nodeServiceStatus.service.loaded ? 'text-mac-green' : 'text-mac-red'}`}>
                                    {nodeServiceStatus.service.loaded ? 'check_circle' : 'cancel'}
                                  </span>
                                  <span className="text-[11px] font-bold theme-text">{nd.nodeWizardStatusInstalled || 'Service registered'}</span>
                                  <span className="text-[10px] theme-text-muted">{nodeServiceStatus.service.loadedText || '-'}</span>
                                </div>
                                {/* Runtime status */}
                                {nodeServiceStatus.service.runtime && (
                                  <div className="flex items-center gap-2">
                                    <span className={`material-symbols-outlined text-[14px] ${nodeServiceStatus.service.runtime.status === 'running' ? 'text-mac-green' : 'text-amber-500'}`}>
                                      {nodeServiceStatus.service.runtime.status === 'running' ? 'play_circle' : 'pause_circle'}
                                    </span>
                                    <span className="text-[11px] font-bold theme-text">{nd.nodeWizardStatusRuntime || 'Runtime'}</span>
                                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${nodeServiceStatus.service.runtime.status === 'running' ? 'bg-mac-green/10 text-mac-green' : 'bg-amber-500/10 text-amber-500'}`}>
                                      {nodeServiceStatus.service.runtime.status}
                                    </span>
                                    {nodeServiceStatus.service.runtime.pid && (
                                      <span className="text-[10px] theme-text-muted">PID: {nodeServiceStatus.service.runtime.pid}</span>
                                    )}
                                  </div>
                                )}
                                {nodeServiceStatus.service.runtime?.detail && (
                                  <p className="text-[10px] theme-text-muted ps-5 break-all">{nodeServiceStatus.service.runtime.detail}</p>
                                )}
                              </div>
                              {/* Connection target from command args */}
                              {nodeServiceStatus.service.command?.programArguments && (
                                <div className="rounded-lg bg-white/70 dark:bg-black/20 border border-white/60 dark:border-white/10 p-3">
                                  <p className="text-[10px] font-bold theme-text-muted uppercase tracking-wider mb-1">{nd.nodeWizardStatusTarget || 'Connection target'}</p>
                                  <p className="text-[11px] font-mono theme-text break-all">
                                    {(() => {
                                      const args: string[] = nodeServiceStatus.service.command.programArguments;
                                      const hi = args.indexOf('--host');
                                      const pi = args.indexOf('--port');
                                      const host = hi >= 0 && hi + 1 < args.length ? args[hi + 1] : '?';
                                      const port = pi >= 0 && pi + 1 < args.length ? args[pi + 1] : '?';
                                      const hasTls = args.includes('--tls');
                                      return `${hasTls ? 'wss' : 'ws'}://${host}:${port}`;
                                    })()}
                                  </p>
                                </div>
                              )}
                              {/* Env info */}
                              {nodeServiceStatus.service.command?.environment && (
                                <div className="rounded-lg bg-white/70 dark:bg-black/20 border border-white/60 dark:border-white/10 p-3">
                                  <p className="text-[10px] font-bold theme-text-muted uppercase tracking-wider mb-1">{nd.nodeWizardStatusEnv || 'Service environment'}</p>
                                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono">
                                    {Object.entries(nodeServiceStatus.service.command.environment as Record<string, string>)
                                      .filter(([k]) => k.startsWith('OPENCLAW_'))
                                      .map(([k, v]) => (
                                        <React.Fragment key={k}>
                                          <span className="theme-text-muted truncate">{k}</span>
                                          <span className="theme-text truncate">{v as string}</span>
                                        </React.Fragment>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {nodeWizardPanel === 'approve' && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[16px] text-purple-500">hub</span>
                        <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{nd.nodeWizardApproveTab || 'Approve node requests'}</h3>
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 font-bold">{nodePending.length}</span>
                        <span className="flex-1" />
                        <button onClick={() => { fetchDevices(); fetchNodes(); }}
                          className="h-8 px-3 theme-field theme-text-secondary hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-[11px] font-bold flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[14px]">refresh</span>{nd.nodeWizardRefreshPending || nd.refresh}
                        </button>
                      </div>
                      {nodePending.length === 0 ? (
                        <div className="rounded-xl bg-white/70 dark:bg-black/20 border border-white/60 dark:border-white/10 p-6 text-center">
                          <span className="material-symbols-outlined text-[28px] text-slate-300 dark:text-white/20">inbox</span>
                          <p className="text-[12px] font-bold theme-text mt-2">{nd.nodeWizardApproveEmpty || 'No pending node requests'}</p>
                          <p className="text-[10px] theme-text-muted mt-1">{nd.nodeWizardApproveDesc || 'Requests from other OpenClaw nodes will appear here for approval.'}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {nodePending.map((req: any) => (
                            <div key={req.nodeId || req.requestId} className="bg-purple-50 dark:bg-purple-500/[0.04] border border-purple-200/50 dark:border-purple-500/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-purple-500 text-[20px]">dns</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <h4 className="font-bold text-[12px] text-slate-800 dark:text-white truncate">{req.displayName || req.nodeId}</h4>
                                <p className="text-[10px] text-slate-400 dark:text-white/40 font-mono truncate">{req.nodeId}</p>
                                <div className="flex flex-wrap gap-2 mt-1 text-[11px] text-slate-400 dark:text-white/35">
                                  {req.platform && <span>{nd.platform}: {req.platform}</span>}
                                  {req.remoteIp && <span>{nd.ip}: {req.remoteIp}</span>}
                                  {req.ts && <span>{nd.requested} {fmtTs(req.ts)}</span>}
                                </div>
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <button onClick={() => handleNodePairApprove(req.requestId, req.displayName || req.nodeId)}
                                  className="h-8 px-4 bg-mac-green text-white text-[10px] font-bold rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[14px]">check</span>{nd.approve}
                                </button>
                                <button onClick={() => handleNodePairReject(req.requestId, req.displayName || req.nodeId)}
                                  className="h-8 px-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 text-[10px] font-bold rounded-lg hover:bg-mac-red/10 hover:text-mac-red transition-colors flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[14px]">close</span>{nd.reject}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Search, Filter, Sort, Group Bar */}
              {nodes.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30 absolute start-3 top-1/2 -translate-y-1/2">search</span>
                      <input type="text" value={nodeSearchInput} onChange={e => setNodeSearchInput(e.target.value)}
                        placeholder={nd.searchNodes}
                        className="w-full h-9 ps-9 pe-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white/80 placeholder:text-slate-400 dark:placeholder:text-white/30 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
                      {nodeSearchInput && (
                        <button onClick={() => setNodeSearchInput('')} className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white/60">
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      )}
                    </div>
                    <div className="flex theme-field rounded-lg p-0.5 shrink-0">
                      {(['all', 'online', 'offline'] as NodeFilter[]).map(f => (
                        <button key={f} onClick={() => setNodeFilter(f)}
                          className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${nodeFilter === f ? 'bg-white dark:bg-primary text-slate-800 dark:text-white shadow-sm' : 'text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/70'}`}>
                          {f === 'all' ? nd.all : f === 'online' ? nd.onlineOnly : nd.offlineOnly}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Advanced filters row */}
                  <div className="flex flex-wrap items-center gap-2">
                    {platformOptions.length > 0 && (
                      <CustomSelect value={filterPlatform} onChange={v => setFilterPlatform(v)}
                        options={[{ value: '', label: nd.filterPlatformAll }, ...platformOptions.map(p => ({ value: p, label: p }))]}
                        className="h-7 px-2 theme-field rounded-lg text-[10px] font-bold theme-text-secondary min-w-[100px]" />
                    )}
                    {versionOptions.length > 0 && (
                      <CustomSelect value={filterVersion} onChange={v => setFilterVersion(v)}
                        options={[{ value: '', label: nd.filterVersionAll }, ...versionOptions.map(v => ({ value: v, label: 'v' + v }))]}
                        className="h-7 px-2 theme-field rounded-lg text-[10px] font-bold theme-text-secondary min-w-[100px]" />
                    )}
                    <CustomSelect value={filterHealth} onChange={v => setFilterHealth(v)}
                      options={[{ value: '', label: nd.filterHealthAll }, { value: 'healthy', label: nd.healthy }, { value: 'warning', label: nd.warning }, { value: 'critical', label: nd.critical }]}
                      className="h-7 px-2 theme-field rounded-lg text-[10px] font-bold theme-text-secondary min-w-[100px]" />
                    <span className="w-px h-5 bg-slate-200 dark:bg-white/10" />
                    <CustomSelect value={sortKey} onChange={v => setSortKey(v as SortKey)}
                      options={[{ value: 'status', label: nd.sortByStatus }, { value: 'name', label: nd.sortByName }, { value: 'lastUsed', label: nd.sortByLastUsed }, { value: 'connectedAt', label: nd.sortByConnectedAt }]}
                      className="h-7 px-2 theme-field rounded-lg text-[10px] font-bold theme-text-secondary min-w-[100px]" />
                    <CustomSelect value={groupKey} onChange={v => setGroupKey(v as GroupKey)}
                      options={[{ value: 'none', label: nd.groupByNone }, { value: 'platform', label: nd.groupByPlatform }, { value: 'status', label: nd.groupByStatus }, { value: 'version', label: nd.groupByVersion }]}
                      className="h-7 px-2 theme-field rounded-lg text-[10px] font-bold theme-text-secondary min-w-[100px]" />
                    {hasActiveFilters && (
                      <button onClick={clearFilters} className="h-7 px-2 text-[10px] font-bold text-mac-red hover:bg-mac-red/10 rounded-lg transition-colors flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">filter_alt_off</span>{nd.clearFilters}
                      </button>
                    )}
                  </div>
                  {/* Batch selection bar */}
                  {selectedIds.size > 0 && (
                    <div className="flex items-center gap-2 p-2 bg-primary/5 border border-primary/20 rounded-lg">
                      <span className="text-[11px] font-bold text-primary">{selectedIds.size} {nd.selected}</span>
                      <button onClick={deselectAll} className="text-[10px] text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/70">{nd.deselectAll}</button>
                      <span className="flex-1" />
                      <input value={batchCmd} onChange={e => setBatchCmd(e.target.value)} placeholder={nd.invokeCommand}
                        className="h-7 px-2 bg-white dark:bg-black/20 border border-primary/20 rounded text-[10px] font-mono text-slate-700 dark:text-white/70 outline-none w-40" />
                      <button onClick={handleBatchInvoke} disabled={batching || !batchCmd.trim()}
                        className="h-7 px-3 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">{batching ? 'progress_activity' : 'play_arrow'}</span>
                        {nd.batchInvoke}
                      </button>
                    </div>
                  )}
                  {filteredNodes.length > 0 && selectedIds.size === 0 && (
                    <button onClick={selectAllVisible} className="text-[10px] text-slate-400 dark:text-white/30 hover:text-primary transition-colors flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">select_all</span>{nd.selectAll}
                    </button>
                  )}
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-3 bg-mac-red/10 border border-mac-red/20 rounded-xl text-[11px] text-mac-red font-bold">
                  <span className="material-symbols-outlined text-[14px]">error</span>{error}
                </div>
              )}

              {nodesLoading && nodes.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-white/40">
                  <span className="material-symbols-outlined text-4xl animate-spin mb-3">progress_activity</span>
                  <span className="text-xs">{nd.loading}</span>
                </div>
              )}

              {!nodesLoading && nodes.length === 0 && !error && (
                <EmptyState icon="hub" title={nd.noNodes} description={nd.noNodesHint} />
              )}

              {/* No results after filtering */}
              {!nodesLoading && nodes.length > 0 && filteredNodes.length === 0 && (
                <EmptyState icon="search_off" title={nd.noNodes} compact />
              )}

              {/* Grouped node list */}
              {groupedNodes.map((group, gi) => (
                <div key={group.label || gi}>
                  {group.label && (
                    <div className="flex items-center gap-2 mb-2 mt-3">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-white/50 uppercase tracking-wider">{group.label}</span>
                      <span className="text-[10px] text-slate-400 dark:text-white/30">({group.nodes.length})</span>
                      <div className="flex-1 h-px bg-slate-200/60 dark:bg-white/5" />
                    </div>
                  )}
                  <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-3' : 'space-y-2'}>
                    {group.nodes.slice(0, 120).map((node, i) => {
                      const isSelected = selectedNode?.nodeId === node.nodeId;
                      const online = isNodeOnline(node);
                      const health = getHealthStatus(node);
                      const hc = HEALTH_COLORS[health];
                      const checked = selectedIds.has(node.nodeId);

                      if (viewMode === 'list') {
                        return (
                          <div key={node.nodeId || i}
                            className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-primary ring-1 ring-primary/20 bg-primary/[0.02]' : 'border-slate-200 dark:border-white/10 hover:border-primary/40 bg-slate-50 dark:bg-white/[0.02]'}`}>
                            <input type="checkbox" checked={checked}
                              onChange={() => toggleSelect(node.nodeId)}
                              onClick={e => e.stopPropagation()}
                              className="w-3.5 h-3.5 rounded accent-primary shrink-0" />
                            <div className={`w-2 h-2 rounded-full shrink-0 ${hc.dot} ${online ? 'animate-pulse' : ''}`} title={nd[health] || health} />
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleSelectNode(node)}>
                              <span className="font-bold text-[12px] text-slate-800 dark:text-white truncate">{node.displayName || truncateId(node.nodeId, 20)}</span>
                            </div>
                            {node.platform && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 font-bold hidden sm:inline">{node.platform}</span>}
                            {node.version && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold hidden sm:inline">v{node.version}</span>}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${hc.bg} ${hc.text}`}>{nd[health] || health}</span>
                            {node.connected && node.connectedAtMs && (
                              <span className="text-[10px] text-slate-400 dark:text-white/30 hidden sm:inline">{fmtAge((Date.now() - node.connectedAtMs) / 1000)}</span>
                            )}
                            <button onClick={e => { e.stopPropagation(); copyToClipboard(node.nodeId); }} title={nd.copyId}
                              className="text-slate-400 hover:text-primary shrink-0">
                              <span className="material-symbols-outlined text-[14px]">content_copy</span>
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div key={node.nodeId || i}
                          className={`relative bg-slate-50 dark:bg-white/[0.02] border rounded-2xl p-3 sm:p-4 cursor-pointer transition-all group shadow-sm hover:shadow-md ${isSelected ? 'border-primary ring-1 ring-primary/20' : 'border-slate-200 dark:border-white/10 hover:border-primary/40'}`}>
                          {/* Batch checkbox */}
                          <div className="absolute top-3 start-3" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={checked} onChange={() => toggleSelect(node.nodeId)}
                              className="w-3.5 h-3.5 rounded accent-primary" />
                          </div>
                          {/* Health indicator */}
                          <div className="absolute top-3 end-3 flex items-center gap-1.5" title={nd[health] || health}>
                            <span className={`text-[9px] font-bold ${hc.text}`}>{nd[health] || health}</span>
                            <div className={`w-2.5 h-2.5 rounded-full ${hc.dot} ${online ? 'animate-pulse' : ''}`} />
                          </div>

                          <div className="flex items-center gap-3 mb-3 ps-5" onClick={() => handleSelectNode(node)}>
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/15 to-blue-600/15 flex items-center justify-center border border-sky-500/10">
                              <span className="material-symbols-outlined text-sky-500 text-[20px]">dns</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              {renameNodeId === node.nodeId ? (
                                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                  <input value={renameName} onChange={e => setRenameName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleRename(node.nodeId)}
                                    autoFocus placeholder={nd.newName}
                                    className="flex-1 h-6 px-2 bg-white dark:bg-black/20 border border-primary/40 rounded text-[11px] text-slate-700 dark:text-white/70 outline-none" />
                                  <button onClick={() => handleRename(node.nodeId)} disabled={renaming || !renameName.trim()}
                                    className="text-[10px] text-primary font-bold disabled:opacity-40">{renaming ? '...' : '✓'}</button>
                                  <button onClick={() => { setRenameNodeId(null); setRenameName(''); }}
                                    className="text-[10px] text-slate-400">✗</button>
                                </div>
                              ) : (
                                <h4 className="font-bold text-[13px] text-slate-800 dark:text-white truncate" onDoubleClick={e => { e.stopPropagation(); setRenameNodeId(node.nodeId); setRenameName(node.displayName || ''); }}>
                                  {node.displayName || truncateId(node.nodeId, 20)}
                                </h4>
                              )}
                              <p className="text-[10px] text-slate-400 dark:text-white/40 font-mono truncate flex items-center gap-1 group/id">
                                <span title={node.nodeId}>{truncateId(node.nodeId, 24)}</span>
                                <button onClick={e => { e.stopPropagation(); copyToClipboard(node.nodeId); }}
                                  className="opacity-0 group-hover/id:opacity-100 transition-opacity" title={nd.copyId}>
                                  <span className="material-symbols-outlined text-[12px] hover:text-primary">content_copy</span>
                                </button>
                              </p>
                            </div>
                          </div>

                          {/* Tags */}
                          <div className="flex flex-wrap gap-1 mb-2 ps-5">
                            {node.platform && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 font-bold">{node.platform}</span>}
                            {node.version && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold">v{node.version}</span>}
                            {node.paired && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-mac-green/10 text-mac-green font-bold">{nd?.paired || 'Paired'}</span>}
                            {Array.isArray(node.caps) && node.caps.length > 0 && node.caps.slice(0, 3).map(c => (
                              <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">{c}</span>
                            ))}
                          </div>

                          {/* Connection info */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] ps-5">
                            {node.remoteIp && (
                              <><span className="text-slate-400 dark:text-white/35">{nd.ip}</span><span className="text-slate-600 dark:text-white/60 font-mono">{node.remoteIp}</span></>
                            )}
                            <span className="text-slate-400 dark:text-white/35">{nd.status || 'Status'}</span>
                            <span className={`font-bold ${online ? 'text-mac-green' : 'text-slate-400 dark:text-white/30'}`}>
                              {online ? (nd?.online || 'Online') : (nd?.offline || 'Offline')}
                            </span>
                            {node.connectedAtMs && (
                              <><span className="text-slate-400 dark:text-white/35">{nd.connectedAt || 'Connected'}</span><span className="text-slate-600 dark:text-white/60">{fmtTs(node.connectedAtMs)}</span></>
                            )}
                            {node.deviceFamily && (
                              <><span className="text-slate-400 dark:text-white/35">{nd.device || 'Device'}</span><span className="text-slate-600 dark:text-white/60 truncate">{node.deviceFamily}</span></>
                            )}
                          </div>

                          {/* Expanded detail */}
                          {isSelected && (
                            <div className="mt-3 pt-3 border-t border-slate-200/50 dark:border-white/5 space-y-3">
                              {detailLoading && (
                                <div className="flex items-center gap-2 text-slate-400 text-[10px]">
                                  <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                  {nd.describeLoading}
                                </div>
                              )}

                              {nodeDetail && (
                                <>
                                  <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[10px]">
                                    {nodeDetail.displayName && (<><span className="text-slate-400 dark:text-white/35">{nd.displayName}</span><span className="text-slate-600 dark:text-white/60">{nodeDetail.displayName}</span></>)}
                                    {nodeDetail.coreVersion && (<><span className="text-slate-400 dark:text-white/35">{nd.coreVersion}</span><span className="text-slate-600 dark:text-white/60 font-mono">{nodeDetail.coreVersion}</span></>)}
                                    {nodeDetail.uiVersion && (<><span className="text-slate-400 dark:text-white/35">{nd.uiVersion}</span><span className="text-slate-600 dark:text-white/60 font-mono">{nodeDetail.uiVersion}</span></>)}
                                    {nodeDetail.deviceFamily && (<><span className="text-slate-400 dark:text-white/35">{nd.deviceFamily}</span><span className="text-slate-600 dark:text-white/60">{nodeDetail.deviceFamily}</span></>)}
                                    {nodeDetail.modelIdentifier && (<><span className="text-slate-400 dark:text-white/35">{nd.modelIdentifier}</span><span className="text-slate-600 dark:text-white/60 font-mono">{nodeDetail.modelIdentifier}</span></>)}
                                    {nodeDetail.remoteIp && (<><span className="text-slate-400 dark:text-white/35">{nd.remoteIp}</span><span className="text-slate-600 dark:text-white/60 font-mono">{nodeDetail.remoteIp}</span></>)}
                                    {nodeDetail.connectedAtMs && (<><span className="text-slate-400 dark:text-white/35">{nd.connectedAt}</span><span className="text-slate-600 dark:text-white/60">{fmtTs(nodeDetail.connectedAtMs)}</span></>)}
                                    <span className="text-slate-400 dark:text-white/35">{nd.paired}</span><span className={`font-bold ${nodeDetail.paired ? 'text-mac-green' : 'text-slate-400'}`}>{nodeDetail.paired ? '✓' : '✗'}</span>
                                    <span className="text-slate-400 dark:text-white/35">{nd.online}</span><span className={`font-bold ${nodeDetail.connected ? 'text-mac-green' : 'text-slate-400'}`}>{nodeDetail.connected ? '✓' : '✗'}</span>
                                  </div>

                                  {/* Security Policy Summary */}
                                  {config && (() => {
                                    const parsedCfg = (config as any) || {};
                                    const { policy } = resolveEffectivePolicy(parsedCfg?.tools || {}, parsedCfg?.agents?.defaults || {}, undefined);
                                    return (
                                      <div className="p-2.5 rounded-xl bg-primary/[0.02] dark:bg-primary/[0.04] border border-primary/10">
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                          <span className="material-symbols-outlined text-[11px] text-primary">security</span>
                                          <span className="text-[9px] font-bold text-primary uppercase">{nd.securityPolicy || 'Security Policy'}</span>
                                        </div>
                                        <SecurityPolicyBadges
                                          policy={policy}
                                          labels={{ ...es, ...chat, ...nd }}
                                          hideAskWhenOff
                                          hideSandboxWhenOff
                                          compact
                                        />
                                      </div>
                                    );
                                  })()}

                                  <div>
                                    <div className="text-[11px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-wider mb-1">{nd.capabilities}</div>
                                    {Array.isArray((nodeDetail.caps?.length ? nodeDetail.caps : node.caps)) && (nodeDetail.caps?.length ? nodeDetail.caps : node.caps)!.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {(nodeDetail.caps?.length ? nodeDetail.caps : node.caps)!.map(c => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-mac-green/10 text-mac-green font-bold">{c}</span>)}
                                      </div>
                                    ) : <p className="text-[10px] text-slate-400">-</p>}
                                  </div>

                                  <div>
                                    <div className="text-[11px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-wider mb-1">{nd.commands}</div>
                                    {Array.isArray((nodeDetail.commands?.length ? nodeDetail.commands : node.commands)) && (nodeDetail.commands?.length ? nodeDetail.commands : node.commands)!.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {(nodeDetail.commands?.length ? nodeDetail.commands : node.commands)!.map(c => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-bold font-mono">{c}</span>)}
                                      </div>
                                    ) : <p className="text-[10px] text-slate-400">{nd.noCommands}</p>}
                                  </div>

                                  {nodeDetail.connected && Array.isArray((nodeDetail.commands?.length ? nodeDetail.commands : node.commands)) && (nodeDetail.commands?.length ? nodeDetail.commands : node.commands)!.length > 0 && (
                                    <div className="p-3 rounded-xl bg-white dark:bg-black/20 border border-slate-200/60 dark:border-white/5 space-y-2">
                                      <div className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[12px] text-primary">terminal</span>
                                        {nd.invoke}
                                      </div>
                                      <div className="flex flex-col sm:flex-row gap-2">
                                        <CustomSelect value={invokeCmd} onChange={v => setInvokeCmd(v)}
                                          options={[{ value: '', label: `${nd.invokeCommand}...` }, ...(nodeDetail.commands?.length ? nodeDetail.commands : node.commands)!.map(c => ({ value: c, label: c }))]}
                                          className="flex-1 h-7 px-2 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-mono text-slate-700 dark:text-white/70" />
                                        <NumberStepper
                                          min={1}
                                          step={1}
                                          value={invokeTimeout}
                                          onChange={setInvokeTimeout}
                                          placeholder={nd.invokeTimeout}
                                          className="w-24 h-7"
                                          inputClassName="text-[10px] font-mono"
                                        />
                                      </div>
                                      <input value={invokeParams} onChange={e => setInvokeParams(e.target.value)}
                                        placeholder={nd.invokeParams}
                                        className="w-full h-7 px-2 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-mono text-slate-700 dark:text-white/70 outline-none" />
                                      <button onClick={handleInvoke} disabled={invoking || !invokeCmd.trim()}
                                        className="h-7 px-3 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1 transition-all">
                                        <span className="material-symbols-outlined text-[12px]">{invoking ? 'progress_activity' : 'play_arrow'}</span>
                                        {invoking ? nd.invoking : nd.invokeRun}
                                      </button>
                                      {invokeResult && (
                                        <div className={`p-2 rounded-lg text-[10px] ${invokeResult.ok ? 'bg-mac-green/10 border border-mac-green/20' : 'bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20'}`}>
                                          <div className={`font-bold mb-1 ${invokeResult.ok ? 'text-mac-green' : 'text-red-500'}`}>{invokeResult.text}</div>
                                          {invokeResult.payload != null && (
                                            <pre className="p-1.5 bg-black/5 dark:bg-black/30 rounded text-[11px] font-mono text-slate-500 dark:text-white/40 overflow-x-auto max-h-32 custom-scrollbar neon-scrollbar">
                                              {typeof invokeResult.payload === 'string' ? invokeResult.payload : JSON.stringify(invokeResult.payload, null, 2)}
                                            </pre>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </>
                              )}

                              {!detailLoading && !nodeDetail && (
                                <pre className="p-2 bg-black/5 dark:bg-black/30 rounded-lg text-[11px] font-mono text-slate-500 dark:text-white/40 overflow-x-auto max-h-40 custom-scrollbar neon-scrollbar">
                                  {JSON.stringify(node, null, 2)}
                                </pre>
                              )}

                              {/* Pairing actions: Remove Pair (OpenClaw 2026.4.26+) */}
                              {(nodeDetail?.paired || node.paired) && (
                                <div className="pt-2 border-t border-slate-200/40 dark:border-white/5 flex justify-end">
                                  <button
                                    onClick={e => { e.stopPropagation(); handleNodePairRemove(node.nodeId, node.displayName || nodeDetail?.displayName); }}
                                    className="h-7 px-3 flex items-center gap-1.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded-lg text-[11px] font-bold hover:bg-red-500/20 transition-colors"
                                    title={nd?.removePairHint || 'Remove this gateway-owned node pairing record'}
                                  >
                                    <span className="material-symbols-outlined text-[14px]">link_off</span>
                                    {nd?.removePair || 'Remove Pair'}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {group.nodes.length > 120 && (
                    <div className="text-center text-[10px] text-slate-400 dark:text-white/35 mt-1">+{group.nodes.length - 120}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ===== DEVICES TAB ===== */}
          {tab === 'devices' && (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-bold text-slate-800 dark:text-white">{nd.devicesSection}</h2>
                  <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{nd.devicesHelp || nd.desc}</p>
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap">
                  {paired.length > 0 && (
                    <button onClick={handleBatchRotate}
                      className="h-8 px-2.5 flex items-center gap-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-lg text-[11px] font-bold hover:bg-amber-500/20 transition-colors">
                      <span className="material-symbols-outlined text-[14px]">autorenew</span>
                      <span className="hidden sm:inline">{nd.batchRotate}</span>
                    </button>
                  )}
                  <button onClick={() => setShowPairFlow(!showPairFlow)}
                    className={`h-8 px-3 flex items-center gap-1.5 border rounded-lg text-[11px] font-bold transition-all ${showPairFlow ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-200 dark:hover:bg-white/10'}`}>
                    <span className="material-symbols-outlined text-[14px]">help_outline</span>
                    <span className="hidden sm:inline">{nd.pairFlow}</span>
                  </button>
                  <button onClick={fetchDevices} disabled={devicesLoading}
                    className="h-8 px-3 flex items-center gap-1.5 theme-field hover:bg-slate-200 dark:hover:bg-white/10 rounded-lg text-[11px] font-bold theme-text-secondary disabled:opacity-50">
                    <span className={`material-symbols-outlined text-[14px] ${devicesLoading ? 'animate-spin' : ''}`}>{devicesLoading ? 'progress_activity' : 'refresh'}</span>
                    <span className="hidden sm:inline">{nd.refresh}</span>
                  </button>
                </div>
              </div>

              {/* Local Device ID */}
              {localDeviceId && (
                <div className="bg-gradient-to-r from-primary/[0.06] to-sky-500/[0.04] border border-primary/20 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-primary text-[18px]">fingerprint</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-slate-400 dark:text-white/40 font-bold uppercase tracking-wider mb-0.5">{nd.myDeviceId || 'My Device ID'}</p>
                    <p className="text-[12px] text-slate-700 dark:text-white/80 font-mono truncate select-all" title={localDeviceId}>{localDeviceId}</p>
                  </div>
                  <button onClick={() => {
                    copyToClipboard(localDeviceId).then(() => toast('success', nd.copied)).catch(() => {});
                  }}
                    className="h-8 px-2.5 flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg text-[10px] font-bold hover:bg-primary/20 transition-colors shrink-0">
                    <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    <span className="hidden sm:inline">{nd.copy || 'Copy'}</span>
                  </button>
                </div>
              )}

              {/* Device stats bar */}
              {(paired.length > 0 || pending.length > 0) && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-white/60">{nd.totalDevices}: {deviceStatsData.total}</span>
                  <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
                  <span className="text-[11px] font-bold text-mac-green">{nd.activeDevices}: {deviceStatsData.active}</span>
                  <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
                  <span className="text-[11px] font-bold text-mac-red">{nd.revokedDevices}: {deviceStatsData.revoked}</span>
                  <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
                  <span className="text-[11px] font-bold text-amber-500">{nd.pendingRequests}: {deviceStatsData.pending}</span>
                </div>
              )}

              {/* Pairing Flow Guide */}
              {showPairFlow && (
                <div className="bg-gradient-to-r from-primary/5 to-sky-500/5 dark:from-primary/10 dark:to-sky-500/10 border border-primary/20 dark:border-primary/30 rounded-xl p-4">
                  <h3 className="text-[12px] font-bold text-primary dark:text-primary mb-3 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">route</span>
                    {nd.pairFlow}
                  </h3>
                  <div className="flex flex-col sm:flex-row gap-3">
                    {[
                      { step: 1, icon: 'devices', text: nd.pairStep1 },
                      { step: 2, icon: 'pending_actions', text: nd.pairStep2 },
                      { step: 3, icon: 'check_circle', text: nd.pairStep3 },
                    ].map((item, idx) => (
                      <div key={item.step} className="flex-1 flex items-start gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/20 dark:bg-primary/30 flex items-center justify-center shrink-0">
                          <span className="text-[11px] font-bold text-primary">{item.step}</span>
                        </div>
                        <div className="flex-1">
                          <p className="text-[11px] text-slate-600 dark:text-white/70">{item.text}</p>
                        </div>
                        {idx < 2 && <span className="material-symbols-outlined text-[16px] text-slate-300 dark:text-white/20 hidden sm:block self-center">arrow_forward</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Search Bar */}
              {(pending.length > 0 || paired.length > 0) && (
                <div className="relative">
                  <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30 absolute start-3 top-1/2 -translate-y-1/2">search</span>
                  <input
                    type="text"
                    value={deviceSearchInput}
                    onChange={e => setDeviceSearchInput(e.target.value)}
                    placeholder={nd.searchDevices}
                    className="w-full h-9 ps-9 pe-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white/80 placeholder:text-slate-400 dark:placeholder:text-white/30 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                  {deviceSearchInput && (
                    <button onClick={() => setDeviceSearchInput('')} className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white/60">
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  )}
                </div>
              )}

              {/* Advanced Pair Tools */}
              <div className="rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-white/70 dark:bg-white/[0.03] overflow-hidden">
                <button onClick={() => setShowAdvancedPairTools(v => !v)}
                  className="w-full px-3 py-2.5 flex items-center gap-2 text-start hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors">
                  <span className="material-symbols-outlined text-[15px] text-slate-400 dark:text-white/35">tune</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold theme-text">{nd.advancedPairTools || 'Advanced node pairing tools'}</p>
                    <p className="text-[10px] theme-text-muted truncate">{nd.advancedPairToolsDesc || 'Manual request and token verification tools for diagnostics.'}</p>
                  </div>
                  <span className={`material-symbols-outlined text-[16px] theme-text-muted transition-transform ${showAdvancedPairTools ? 'rotate-180' : ''}`}>expand_more</span>
                </button>
                {showAdvancedPairTools && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-slate-200/60 dark:border-white/[0.06] p-3">
                    <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3 space-y-2">
                      <h3 className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase flex items-center gap-1" title={nd.pairRequestHelp}>
                        <span className="material-symbols-outlined text-[12px]">add_link</span>{nd.pairRequest}
                        <span className="material-symbols-outlined text-[10px] text-slate-300 dark:text-white/20 ms-auto cursor-help">info</span>
                      </h3>
                      <div>
                        <input value={pairNodeId} onChange={e => { setPairNodeId(e.target.value); if (pairNodeIdError) validatePairNodeId(e.target.value); }} placeholder={nd.pairNodeId}
                          onBlur={e => validatePairNodeId(e.target.value)}
                          className={`w-full h-8 px-2.5 bg-slate-50 dark:bg-black/20 border rounded-lg text-[11px] font-mono text-slate-700 dark:text-white/70 outline-none focus:border-primary/50 ${pairNodeIdError ? 'border-mac-red/50' : 'border-slate-200 dark:border-white/10'}`} />
                        {pairNodeIdError && <p className="text-[10px] text-mac-red mt-0.5">{pairNodeIdError}</p>}
                      </div>
                      <input value={pairName} onChange={e => setPairName(e.target.value)} placeholder={nd.pairDisplayName}
                        className="w-full h-8 px-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] text-slate-700 dark:text-white/70 outline-none focus:border-primary/50" />
                      <button onClick={() => { if (validatePairNodeId(pairNodeId)) handlePairRequest(); }} disabled={pairing || !pairNodeId.trim()}
                        className="w-full h-8 bg-primary text-white text-[11px] font-bold rounded-lg disabled:opacity-40 flex items-center justify-center gap-1.5 hover:bg-primary/90 transition-colors">
                        <span className="material-symbols-outlined text-[14px]">{pairing ? 'progress_activity' : 'link'}</span>
                        {pairing ? nd.pairRequesting : nd.pairRequest}
                      </button>
                      {pairResult && (
                        <div className={`px-2.5 py-1.5 rounded-lg text-[11px] ${pairResult.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-red-50 dark:bg-red-500/5 text-red-500'}`}>{pairResult.text}</div>
                      )}
                    </div>
                    <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3 space-y-2">
                      <h3 className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase flex items-center gap-1" title={nd.pairVerifyHelp}>
                        <span className="material-symbols-outlined text-[12px]">verified</span>{nd.pairVerify}
                        <span className="material-symbols-outlined text-[10px] text-slate-300 dark:text-white/20 ms-auto cursor-help">info</span>
                      </h3>
                      <input value={verifyNodeId} onChange={e => setVerifyNodeId(e.target.value)} placeholder={nd.pairNodeId}
                        className="w-full h-8 px-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-mono text-slate-700 dark:text-white/70 outline-none focus:border-sky-500/50" />
                      <div>
                        <input value={verifyToken} onChange={e => { setVerifyToken(e.target.value); if (verifyTokenError) validateVerifyToken(e.target.value); }} placeholder={nd.pairToken}
                          onBlur={e => validateVerifyToken(e.target.value)}
                          className={`w-full h-8 px-2.5 bg-slate-50 dark:bg-black/20 border rounded-lg text-[11px] font-mono text-slate-700 dark:text-white/70 outline-none focus:border-sky-500/50 ${verifyTokenError ? 'border-mac-red/50' : 'border-slate-200 dark:border-white/10'}`} />
                        {verifyTokenError && <p className="text-[10px] text-mac-red mt-0.5">{verifyTokenError}</p>}
                      </div>
                      <button onClick={() => { if (validateVerifyToken(verifyToken)) handlePairVerify(); }} disabled={verifying || !verifyNodeId.trim() || !verifyToken.trim()}
                        className="w-full h-8 bg-sky-500 text-white text-[11px] font-bold rounded-lg disabled:opacity-40 flex items-center justify-center gap-1.5 hover:bg-sky-500/90 transition-colors">
                        <span className="material-symbols-outlined text-[14px]">{verifying ? 'progress_activity' : 'verified'}</span>
                        {verifying ? nd.pairVerifying : nd.pairVerify}
                      </button>
                      {verifyResult && (
                        <div className={`px-2.5 py-1.5 rounded-lg text-[11px] ${verifyResult.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-red-50 dark:bg-red-500/5 text-red-500'}`}>{verifyResult.text}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {devicesError && (
                <div className="flex items-center gap-2 p-3 bg-mac-red/10 border border-mac-red/20 rounded-xl text-[11px] text-mac-red font-bold">
                  <span className="material-symbols-outlined text-[14px]">error</span>{devicesError}
                </div>
              )}

              {devicesLoading && pending.length === 0 && paired.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <span className="material-symbols-outlined text-3xl animate-spin mb-3">progress_activity</span>
                  <span className="text-xs">{nd.loading}</span>
                </div>
              )}

              {/* 待审批设备 with batch selection */}
              {filteredPending.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-[16px] text-amber-500">pending_actions</span>
                    <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{nd.pending}</h3>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold">{filteredPending.length}</span>
                    <span className="flex-1" />
                    {selectedPendingIds.size > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-primary">{selectedPendingIds.size} {nd.selected}</span>
                        <button onClick={handleBatchApprove} className="h-7 px-2.5 bg-mac-green text-white text-[10px] font-bold rounded-lg flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">check</span>{nd.batchApprove}
                        </button>
                        <button onClick={handleBatchReject} className="h-7 px-2.5 bg-mac-red/10 text-mac-red text-[10px] font-bold rounded-lg flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">close</span>{nd.batchReject}
                        </button>
                        <button onClick={() => setSelectedPendingIds(new Set())} className="text-[10px] text-slate-400">{nd.deselectAll}</button>
                      </div>
                    )}
                    {selectedPendingIds.size === 0 && filteredPending.length > 1 && (
                      <button onClick={() => setSelectedPendingIds(new Set(filteredPending.map(r => r.requestId)))}
                        className="text-[10px] text-slate-400 hover:text-primary flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">select_all</span>{nd.selectAllPending}
                      </button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {renderedPending.map(req => (
                      <div key={req.requestId} className="bg-amber-50 dark:bg-amber-500/[0.04] border border-amber-200/50 dark:border-amber-500/10 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                        <input type="checkbox" checked={selectedPendingIds.has(req.requestId)} onChange={() => togglePendingSelect(req.requestId)}
                          className="w-3.5 h-3.5 rounded accent-primary shrink-0 hidden sm:block" />
                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-amber-500 text-[20px]">smartphone</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-[12px] text-slate-800 dark:text-white truncate">{req.displayName?.trim() || truncateId(req.deviceId, 20)}</h4>
                          <p className="text-[10px] text-slate-400 dark:text-white/40 font-mono truncate flex items-center gap-1 group/did">
                            <span title={req.deviceId}>{truncateId(req.deviceId, 24)}</span>
                            <button onClick={() => copyToClipboard(req.deviceId)} className="opacity-0 group-hover/did:opacity-100 transition-opacity" title={nd.copyId}>
                              <span className="material-symbols-outlined text-[12px] hover:text-primary">content_copy</span>
                            </button>
                          </p>
                          <div className="flex flex-wrap gap-2 mt-1 text-[10px] sm:text-[11px] text-slate-400 dark:text-white/35">
                            {req.role && <span>{nd.role}: {req.role}</span>}
                            {req.remoteIp && <span>{nd.ip}: {req.remoteIp}</span>}
                            {req.isRepair && <span className="text-amber-500 font-bold">{nd.repair}</span>}
                            {req.ts && <span>{nd.requested} {fmtTs(req.ts)}</span>}
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button onClick={() => handleApprove(req.requestId, req.displayName || req.deviceId)}
                            className="h-8 px-3 sm:px-4 bg-mac-green text-white text-[10px] sm:text-[11px] font-bold rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">check</span>
                            <span className="hidden sm:inline">{nd.approve}</span>
                          </button>
                          <button onClick={() => handleRejectWithDialog(req.requestId, req.displayName)}
                            className="h-8 px-3 sm:px-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 text-[10px] sm:text-[11px] font-bold rounded-lg hover:bg-mac-red/10 hover:text-mac-red transition-colors flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">close</span>
                            <span className="hidden sm:inline">{nd.reject}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {omittedPending > 0 && (
                    <div className="text-center text-[10px] text-slate-400 dark:text-white/35 mt-2">+{omittedPending}</div>
                  )}
                </div>
              )}

              {/* 已配对设备 with advanced filters, token masking, expandable details */}
              {paired.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-[16px] text-mac-green">verified</span>
                    <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{nd.paired}</h3>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-mac-green/15 text-mac-green font-bold">{advancedFilteredPaired.length}</span>
                  </div>
                  {/* Advanced filter row for paired devices */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    {roleOptions.length > 0 && (
                      <CustomSelect value={deviceFilterRole} onChange={v => setDeviceFilterRole(v)}
                        options={[{ value: '', label: nd.filterRoleAll }, ...roleOptions.map(r => ({ value: r, label: r }))]}
                        className="h-7 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 min-w-[100px]" />
                    )}
                    <CustomSelect value={deviceFilterTokenStatus} onChange={v => setDeviceFilterTokenStatus(v)}
                      options={[{ value: '', label: nd.filterTokenAll }, { value: 'active', label: nd.filterTokenActive }, { value: 'revoked', label: nd.filterTokenRevoked }]}
                      className="h-7 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 min-w-[100px]" />
                    <CustomSelect value={deviceFilterLastUsed} onChange={v => setDeviceFilterLastUsed(v)}
                      options={[{ value: '', label: nd.filterLastUsedAll }, { value: '24h', label: nd.filterLastUsed24h }, { value: '7d', label: nd.filterLastUsed7d }, { value: '30d', label: nd.filterLastUsed30d }, { value: 'inactive', label: nd.filterLastUsedInactive }]}
                      className="h-7 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 min-w-[100px]" />
                    {hasDeviceFilters && (
                      <button onClick={clearDeviceFilters} className="h-7 px-2 text-[10px] font-bold text-mac-red hover:bg-mac-red/10 rounded-lg transition-colors flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">filter_alt_off</span>{nd.clearFilters}
                      </button>
                    )}
                  </div>
                  <div className="space-y-3">
                    {advancedFilteredPaired.slice(0, 60).map(device => {
                      const tokens = Array.isArray(device.tokens) ? device.tokens : [];
                      const hasActiveToken = tokens.some(t => !t.revokedAtMs);
                      const isExpanded = expandedDeviceId === device.deviceId;
                      const lastUsed = tokens.reduce((max, t) => Math.max(max, t.lastUsedAtMs || 0), 0);
                      return (
                        <div key={device.deviceId} className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl p-3 sm:p-4">
                          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpandedDeviceId(isExpanded ? null : device.deviceId)}>
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${hasActiveToken ? 'bg-mac-green/10' : 'bg-slate-200/50 dark:bg-white/5'}`}>
                              <span className={`material-symbols-outlined text-[20px] ${hasActiveToken ? 'text-mac-green' : 'text-slate-400 dark:text-white/30'}`}>devices</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-[12px] text-slate-800 dark:text-white truncate">{device.displayName?.trim() || truncateId(device.deviceId, 20)}</h4>
                                <div className={`w-2 h-2 rounded-full shrink-0 ${hasActiveToken ? 'bg-mac-green' : 'bg-slate-300 dark:bg-white/20'}`} title={hasActiveToken ? nd.deviceActive : nd.deviceInactive} />
                              </div>
                              <p className="text-[10px] text-slate-400 dark:text-white/40 font-mono truncate flex items-center gap-1 group/pdid">
                                <span title={device.deviceId}>{truncateId(device.deviceId, 24)}</span>
                                <button onClick={e => { e.stopPropagation(); copyToClipboard(device.deviceId); }} className="opacity-0 group-hover/pdid:opacity-100 transition-opacity" title={nd.copyId}>
                                  <span className="material-symbols-outlined text-[12px] hover:text-primary">content_copy</span>
                                </button>
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {lastUsed > 0 && <span className="text-[10px] text-slate-400 dark:text-white/30 hidden sm:inline">{nd.deviceLastSeen}: {fmtTs(lastUsed)}</span>}
                              <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30 transition-transform" style={{ transform: isExpanded ? 'rotate(180deg)' : '' }}>expand_more</span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1 mt-2">
                            {Array.isArray(device.roles) && device.roles.map(r => (
                              <span key={r} className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">{r}</span>
                            ))}
                            {Array.isArray(device.scopes) && device.scopes.map(s => (
                              <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 font-bold">{s}</span>
                            ))}
                            {device.remoteIp && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 font-mono">{device.remoteIp}</span>
                            )}
                          </div>

                          {/* Expanded detail panel */}
                          {isExpanded && (
                            <div className="mt-3 pt-3 border-t border-slate-200/50 dark:border-white/5 space-y-3">
                              {/* Device details grid */}
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
                                {device.createdAtMs && (<><span className="text-slate-400 dark:text-white/35">{nd.devicePairTime}</span><span className="text-slate-600 dark:text-white/60">{fmtTs(device.createdAtMs)}</span></>)}
                                {device.approvedAtMs && (<><span className="text-slate-400 dark:text-white/35">{nd.approvedAt}</span><span className="text-slate-600 dark:text-white/60">{fmtTs(device.approvedAtMs)}</span></>)}
                                <span className="text-slate-400 dark:text-white/35">{nd.deviceTokenCount}</span><span className="text-slate-600 dark:text-white/60">{tokens.length}</span>
                                <span className="text-slate-400 dark:text-white/35">{nd.deviceRolesCount}</span><span className="text-slate-600 dark:text-white/60">{Array.isArray(device.roles) ? device.roles.length : 0}</span>
                              </div>

                              {/* Tokens with masking */}
                              {tokens.length > 0 && (
                                <div className="space-y-1.5">
                                  <div className="text-[11px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-wider">{nd.tokens}</div>
                                  {tokens.map((tk, ti) => {
                                    const isRevoked = !!tk.revokedAtMs;
                                    return (
                                      <div key={ti} className={`flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-lg ${isRevoked ? 'bg-slate-100/50 dark:bg-white/[0.01] opacity-50' : 'bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5'}`}>
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isRevoked ? 'bg-mac-red/10 text-mac-red' : 'bg-mac-green/10 text-mac-green'}`}>
                                              {isRevoked ? nd.revoked : nd.active}
                                            </span>
                                            <span className="text-[10px] font-bold text-slate-700 dark:text-white/70">{tk.role}</span>
                                            {Array.isArray(tk.scopes) && tk.scopes.length > 0 && (
                                              <span className="text-[10px] text-slate-400 dark:text-white/35 truncate">{nd.scopes}: {tk.scopes.join(', ')}</span>
                                            )}
                                          </div>
                                          <div className="flex gap-3 mt-1 text-[10px] text-slate-400 dark:text-white/20 flex-wrap">
                                            {tk.createdAtMs && <span>{nd.created} {fmtTs(tk.createdAtMs)}</span>}
                                            {tk.rotatedAtMs && <span>{nd.rotated} {fmtTs(tk.rotatedAtMs)}</span>}
                                            {tk.lastUsedAtMs && <span>{nd.lastUsed} {fmtTs(tk.lastUsedAtMs)}</span>}
                                          </div>
                                        </div>
                                        <div className="flex gap-1.5 shrink-0">
                                          <button onClick={() => handleRotateWithDialog(device.deviceId, tk.role, tk.scopes)}
                                            className="h-7 px-2.5 bg-primary/10 text-primary text-[10px] font-bold rounded-lg hover:bg-primary/20 transition-colors flex items-center gap-1">
                                            <span className="material-symbols-outlined text-[12px]">autorenew</span>{nd.rotate}
                                          </button>
                                          {!isRevoked && (
                                            <button onClick={() => handleRevokeWithDialog(device.deviceId, tk.role)}
                                              className="h-7 px-2.5 bg-mac-red/10 text-mac-red text-[10px] font-bold rounded-lg hover:bg-mac-red/20 transition-colors flex items-center gap-1">
                                              <span className="material-symbols-outlined text-[12px]">block</span>{nd.revoke}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Remove device button */}
                              <div className="pt-2 border-t border-slate-200/50 dark:border-white/5">
                                <button onClick={() => handleRemoveDevice(device.deviceId, device.displayName?.trim())}
                                  className="h-7 px-3 bg-mac-red/10 text-mac-red text-[10px] font-bold rounded-lg hover:bg-mac-red/20 transition-colors flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[12px]">person_remove</span>{nd.removeDevice || 'Remove Device'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {advancedFilteredPaired.length > 60 && (
                    <div className="text-center text-[10px] text-slate-400 dark:text-white/35 mt-2">+{advancedFilteredPaired.length - 60}</div>
                  )}
                </div>
              )}

              {!devicesLoading && pending.length === 0 && paired.length === 0 && !devicesError && (
                <EmptyState icon="devices" title={nd.noDevices} description={nd.noDevicesHint} />
              )}
            </div>
          )}

          {/* ===== BINDINGS TAB ===== */}
          {tab === 'bindings' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-800 dark:text-white">{nd.bindingsSection}</h2>
                  <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{nd.bindingsDesc}</p>
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap">
                  {config && (
                    <>
                      <button onClick={() => setShowBindingHistory(!showBindingHistory)}
                        className={`h-8 px-2.5 flex items-center gap-1 border rounded-lg text-[11px] font-bold transition-all ${showBindingHistory ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:bg-slate-200 dark:hover:bg-white/10'}`}>
                        <span className="material-symbols-outlined text-[14px]">history</span>
                        <span className="hidden sm:inline">{nd.bindingHistory}</span>
                      </button>
                      <button onClick={() => setShowTemplates(!showTemplates)}
                        className={`h-8 px-2.5 flex items-center gap-1 border rounded-lg text-[11px] font-bold transition-all ${showTemplates ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:bg-slate-200 dark:hover:bg-white/10'}`}>
                        <span className="material-symbols-outlined text-[14px]">bookmark</span>
                        <span className="hidden sm:inline">{nd.bindingTemplate}</span>
                      </button>
                      <button onClick={handleSaveBindingsEnhanced} disabled={configSaving || !configDirty}
                        className="h-8 px-4 bg-primary text-white text-[11px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[14px]">{configSaving ? 'progress_activity' : 'save'}</span>
                        {configSaving ? nd.saving : nd.save}
                      </button>
                    </>
                  )}
                  {!config && (
                    <button onClick={fetchConfig} disabled={configLoading}
                      className="h-8 px-3 flex items-center gap-1.5 bg-primary/10 text-primary text-[11px] font-bold rounded-lg disabled:opacity-50">
                      <span className={`material-symbols-outlined text-[14px] ${configLoading ? 'animate-spin' : ''}`}>{configLoading ? 'progress_activity' : 'download'}</span>
                      {nd.loadConfig}
                    </button>
                  )}
                </div>
              </div>

              {/* Binding history panel */}
              {showBindingHistory && (
                <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3 space-y-2">
                  <div className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">history</span>{nd.bindingHistory}
                  </div>
                  {bindingHistory.length === 0 ? (
                    <p className="text-[10px] text-slate-400 dark:text-white/30">{nd.bindingHistoryEmpty}</p>
                  ) : (
                    <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar neon-scrollbar">
                      {bindingHistory.map((entry, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-white/[0.02] text-[10px]">
                          <span className="text-slate-500 dark:text-white/50">{nd.bindingChangedAt} {fmtTs(entry.ts)}</span>
                          <button onClick={() => handleRollback(entry)}
                            className="text-[10px] text-primary font-bold hover:bg-primary/10 px-2 py-0.5 rounded">
                            {nd.bindingRollback}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Templates panel */}
              {showTemplates && (
                <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3 space-y-2">
                  <div className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">bookmark</span>{nd.bindingTemplate}
                  </div>
                  <div className="flex gap-2">
                    <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder={nd.bindingTemplateName}
                      className="flex-1 h-7 px-2 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] text-slate-700 dark:text-white/70 outline-none" />
                    <button onClick={handleSaveTemplate} disabled={!templateName.trim() || !config}
                      className="h-7 px-3 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">save</span>{nd.bindingTemplateSave}
                    </button>
                  </div>
                  {bindingTemplates.length === 0 ? (
                    <p className="text-[10px] text-slate-400 dark:text-white/30">{nd.bindingTemplateEmpty}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {bindingTemplates.map((tmpl, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-white/[0.02] text-[10px]">
                          <span className="font-bold text-slate-600 dark:text-white/60">{tmpl.name}</span>
                          <div className="flex gap-1.5">
                            <button onClick={() => handleApplyTemplate(tmpl)}
                              className="text-primary font-bold hover:bg-primary/10 px-2 py-0.5 rounded">{nd.bindingTemplateApply}</button>
                            <button onClick={() => setBindingTemplates(prev => prev.filter((_, j) => j !== i))}
                              className="text-mac-red font-bold hover:bg-mac-red/10 px-2 py-0.5 rounded">{nd.bindingTemplateDelete}</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!config && !configLoading && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <span className="material-symbols-outlined text-5xl mb-4 text-primary/20">link</span>
                  <span className="text-xs font-bold">{nd.loadConfig}</span>
                </div>
              )}

              {config && (
                <div className="space-y-3">
                  {/* Load balance strategy */}
                  <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl">
                    <span className="material-symbols-outlined text-[16px] text-sky-500">balance</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-white/70">{nd.loadBalanceStrategy}</span>
                      <p className="text-[10px] text-slate-400 dark:text-white/30">{nd.loadBalanceStrategyDesc}</p>
                    </div>
                    <CustomSelect value={loadBalanceStrategy} onChange={v => setLoadBalanceStrategy(v)}
                      options={[{ value: 'auto', label: nd.loadBalanceAuto }, { value: 'round-robin', label: nd.loadBalanceRoundRobin }, { value: 'least-load', label: nd.loadBalanceLeastLoad }, { value: 'fixed', label: nd.loadBalanceFixed }]}
                      className="h-7 px-2 bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 min-w-[120px]" />
                  </div>

                  {/* 默认绑定 with status and test */}
                  <div className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-sky-500 text-[20px]">settings_ethernet</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-[12px] text-slate-800 dark:text-white">{nd.defaultBinding}</h4>
                            {defaultBinding && (() => {
                              const boundNode = nodes.find(n => n.nodeId === defaultBinding);
                              const online = boundNode ? isNodeOnline(boundNode) : false;
                              return (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${online ? 'bg-mac-green/10 text-mac-green' : 'bg-mac-red/10 text-mac-red'}`}>
                                  {online ? nd.bindingOnline : nd.bindingOffline}
                                </span>
                              );
                            })()}
                          </div>
                          <p className="text-[10px] text-slate-400 dark:text-white/40">{nd.defaultBindingDesc}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <CustomSelect value={defaultBinding} onChange={v => handleBindDefault(v)}
                          disabled={nodes.length === 0}
                          options={[{ value: '', label: nd.anyNode }, ...nodes.map(n => ({ value: n.nodeId, label: `${n.displayName || n.nodeId} ${isNodeOnline(n) ? '●' : '○'}` }))]}
                          className="h-8 px-3 bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-bold text-slate-700 dark:text-white/70 min-w-[160px]" />
                        {defaultBinding && (
                          <button onClick={() => handleBindingTest(defaultBinding, '__default')}
                            disabled={bindingTestResults['__default']?.loading}
                            className="h-8 px-2.5 bg-sky-500/10 text-sky-500 text-[10px] font-bold rounded-lg hover:bg-sky-500/20 transition-colors flex items-center gap-1 disabled:opacity-40">
                            <span className={`material-symbols-outlined text-[14px] ${bindingTestResults['__default']?.loading ? 'animate-spin' : ''}`}>
                              {bindingTestResults['__default']?.loading ? 'progress_activity' : 'speed'}
                            </span>
                            {nd.bindingTest}
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Binding test result */}
                    {bindingTestResults['__default'] && !bindingTestResults['__default'].loading && (
                      <div className={`mt-2 text-[10px] font-bold flex items-center gap-1 ${bindingTestResults['__default'].ok ? 'text-mac-green' : 'text-mac-red'}`}>
                        <span className="material-symbols-outlined text-[12px]">{bindingTestResults['__default'].ok ? 'check_circle' : 'error'}</span>
                        {bindingTestResults['__default'].ok
                          ? (nd.bindingTestOk || '').replace('{ms}', String(bindingTestResults['__default'].ms || 0))
                          : (nd.bindingTestFailed || '').replace('{error}', bindingTestResults['__default'].error || '')}
                      </div>
                    )}
                    {defaultBinding && !isNodeOnline(nodes.find(n => n.nodeId === defaultBinding) || {} as NodeEntry) && (
                      <p className="text-[10px] text-mac-red mt-2 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">warning</span>{nd.bindingOfflineWarning}
                      </p>
                    )}
                    {nodes.length === 0 && (
                      <p className="text-[10px] text-amber-500 mt-2 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">warning</span>{nd.noNodesAvailable}
                      </p>
                    )}
                  </div>

                  {/* 代理绑定 with drag sort, status, test */}
                  {agentsList.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="text-[10px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-wider">{nd.agentBinding}</div>
                        <span className="text-[10px] text-slate-300 dark:text-white/20 flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[10px]">drag_indicator</span>{nd.bindingDragHint}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {agentsList.map((agent, idx) => {
                          const boundNode = agent.binding ? nodes.find(n => n.nodeId === agent.binding) : null;
                          const online = boundNode ? isNodeOnline(boundNode) : false;
                          const testKey = agent.id;
                          const testResult = bindingTestResults[testKey];
                          return (
                            <div key={agent.id}
                              draggable
                              onDragStart={() => handleDragStart(idx)}
                              onDragOver={e => handleDragOver(e, idx)}
                              onDragEnd={handleDragEnd}
                              className={`bg-white dark:bg-white/[0.02] border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3 transition-all cursor-grab active:cursor-grabbing ${
                                dragIndex === idx ? 'border-primary/40 ring-1 ring-primary/20 opacity-70' : 'border-slate-200/60 dark:border-white/5'
                              }`}>
                              <span className="material-symbols-outlined text-[14px] text-slate-300 dark:text-white/15 shrink-0 hidden sm:block">drag_indicator</span>
                              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                                  <span className="material-symbols-outlined text-indigo-500 text-[16px]">smart_toy</span>
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <h4 className="font-bold text-[11px] text-slate-800 dark:text-white truncate">
                                      {agent.name || agent.id}
                                    </h4>
                                    {agent.isDefault && <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-bold">default</span>}
                                    {agent.binding && (
                                      <span className={`w-2 h-2 rounded-full ${online ? 'bg-mac-green' : 'bg-mac-red'}`} title={online ? nd.bindingOnline : nd.bindingOffline} />
                                    )}
                                  </div>
                                  <p className="text-[10px] text-slate-400 dark:text-white/35 font-mono">{agent.id}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <CustomSelect value={agent.binding || ''} onChange={v => handleBindAgent(agent.index, v)}
                                  disabled={nodes.length === 0}
                                  options={[{ value: '', label: nd.anyNode }, ...nodes.map(n => ({ value: n.nodeId, label: `${n.displayName || n.nodeId} ${isNodeOnline(n) ? '●' : '○'}` }))]}
                                  className="h-7 px-2 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-700 dark:text-white/70 min-w-[140px]" />
                                {agent.binding && (
                                  <button onClick={() => handleBindingTest(agent.binding!, agent.id)}
                                    disabled={testResult?.loading}
                                    className="h-7 px-2 bg-sky-500/10 text-sky-500 text-[10px] font-bold rounded-lg hover:bg-sky-500/20 transition-colors flex items-center gap-1 disabled:opacity-40 shrink-0">
                                    <span className={`material-symbols-outlined text-[12px] ${testResult?.loading ? 'animate-spin' : ''}`}>
                                      {testResult?.loading ? 'progress_activity' : 'speed'}
                                    </span>
                                    <span className="hidden sm:inline">{nd.bindingTest}</span>
                                  </button>
                                )}
                              </div>
                              {/* Test result inline */}
                              {testResult && !testResult.loading && (
                                <div className={`text-[10px] font-bold flex items-center gap-1 ${testResult.ok ? 'text-mac-green' : 'text-mac-red'}`}>
                                  <span className="material-symbols-outlined text-[12px]">{testResult.ok ? 'check_circle' : 'error'}</span>
                                  {testResult.ok
                                    ? (nd.bindingTestOk || '').replace('{ms}', String(testResult.ms || 0))
                                    : (nd.bindingTestFailed || '').replace('{error}', testResult.error || '')}
                                </div>
                              )}
                              {/* Offline warning */}
                              {agent.binding && !online && (
                                <p className="text-[10px] text-mac-red flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[12px]">warning</span>{nd.bindingOfflineWarning}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {configDirty && (
                    <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-500/[0.04] border border-amber-200/50 dark:border-amber-500/10 rounded-lg text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                      <span className="material-symbols-outlined text-[12px]">edit_note</span>
                      {nd.unsavedChanges}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Event Log Toggle */}
          {eventLog.length > 0 && (
            <div className="mt-4">
              <button 
                onClick={() => setShowEventLog(!showEventLog)}
                className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase hover:text-slate-700 dark:hover:text-white/60 transition-colors"
              >
                <span className="material-symbols-outlined text-[12px]">{showEventLog ? 'expand_less' : 'expand_more'}</span>
                <span className="material-symbols-outlined text-[12px]">history</span>
                {showEventLog ? nd.hideEventLog : nd.showEventLog} ({eventLog.length})
              </button>
              
              {showEventLog && (
                <div className="mt-2 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase">{nd.eventLog}</span>
                    <button onClick={clearEventLog} className="text-[10px] text-slate-400 hover:text-mac-red transition-colors flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">delete</span>
                      {nd.clearEventLog}
                    </button>
                  </div>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto custom-scrollbar neon-scrollbar">
                    {eventLog.map((e, i) => (
                      <p key={i} className="text-[10px] sm:text-[11px] font-mono text-slate-400 dark:text-white/35 break-all">{e}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirm Dialog Overlay */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setConfirmDialog(null)}>
          <div className="bg-white dark:bg-[#1a1b20] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-[340px] max-w-[90vw] p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-2">{confirmDialog.title}</h3>
            <p className="text-[12px] text-slate-500 dark:text-white/50 mb-5 leading-relaxed">{confirmDialog.desc}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDialog(null)}
                className="h-8 px-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 text-[11px] font-bold rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 transition-colors">
                {nd.confirmDialogCancel}
              </button>
              <button onClick={confirmDialog.onOk}
                className={`h-8 px-4 text-white text-[11px] font-bold rounded-lg transition-colors ${confirmDialog.variant === 'success' ? 'bg-mac-green hover:bg-mac-green/90' : 'bg-mac-red hover:bg-mac-red/90'}`}>
                {nd.confirmDialogOk}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部状态栏 */}
      <footer className="h-8 px-4 border-t border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/20 flex items-center justify-between shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/20">
        <div className="flex items-center gap-3">
          <span>{nodes.length} {nd.nodesSection}</span>
          <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
          <span className="text-mac-green">{onlineCount} {nd.online}</span>
          <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
          <span>{offlineCount} {nd.offline}</span>
          <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
          <span>{pending.length} {nd.pending}</span>
          <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
          <span className="text-mac-green">{paired.length} {nd.paired}</span>
          {autoRefresh && (
            <>
              <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
              <span className="text-mac-green flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-mac-green animate-pulse" />
                {nd.autoRefresh}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[12px]">hub</span>
          <span>{nd.title}</span>
        </div>
      </footer>
    </div>
  );
};

export default Nodes;
