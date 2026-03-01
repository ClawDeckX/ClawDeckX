
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi } from '../services/api';
import { useToast } from '../components/Toast';
import { useGatewayEvents } from '../hooks/useGatewayEvents';
import CustomSelect from '../components/CustomSelect';

interface NodesProps { language: Language; }

interface NodeEntry {
  id: string;
  host?: string;
  ip?: string;
  platform?: string;
  version?: string;
  capabilities?: string[];
  roles?: string[];
  scopes?: string[];
  mode?: string;
  lastInputSeconds?: number;
  ts?: number;
  [key: string]: unknown;
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
type SortKey = 'name' | 'status' | 'lastUsed' | 'connectedAt';
type GroupKey = 'none' | 'platform' | 'status' | 'version';
type ViewMode = 'grid' | 'list';

// --- Utility helpers ---
function fmtRelativeTime(seconds?: number | null, nd?: any): string {
  if (seconds == null || seconds < 0) return '-';
  if (seconds < 60) return nd?.justNow;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    return `${mins} ${nd?.minutesAgo}`;
  }
  if (seconds < 86400) {
    const hrs = Math.floor(seconds / 3600);
    return `${hrs} ${nd?.hoursAgo}`;
  }
  const days = Math.floor(seconds / 86400);
  return `${days} ${nd?.daysAgo}`;
}

function fmtAge(seconds?: number | null): string {
  if (seconds == null || seconds < 0) return '-';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function fmtTs(ms?: number | null): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString();
}

function truncateId(id: string, maxLen = 16): string {
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen - 3) + '...';
}

function isNodeOnline(node: NodeEntry): boolean {
  return node.lastInputSeconds != null && node.lastInputSeconds < 300;
}

function getHealthStatus(node: NodeEntry): 'healthy' | 'warning' | 'critical' | 'unknown' {
  if (node.lastInputSeconds == null) return 'unknown';
  if (node.lastInputSeconds < 120) return 'healthy';
  if (node.lastInputSeconds < 300) return 'warning';
  return 'critical';
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
      case 'name': return (a.host || a.id).localeCompare(b.host || b.id);
      case 'status': return (isNodeOnline(b) ? 1 : 0) - (isNodeOnline(a) ? 1 : 0);
      case 'lastUsed': return (a.lastInputSeconds ?? Infinity) - (b.lastInputSeconds ?? Infinity);
      case 'connectedAt': return (b.ts ?? 0) - (a.ts ?? 0);
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
      case 'status': gk = isNodeOnline(n) ? (nd?.online || 'Online') : (nd?.offline || 'Offline'); break;
      case 'version': gk = n.version || nd?.ungrouped || '-'; break;
      default: gk = '-';
    }
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk)!.push(n);
  }
  return Array.from(groups.entries()).map(([label, nodes]) => ({ label, nodes }));
}

const Nodes: React.FC<NodesProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const nd = (t as any).nd;
  const { toast } = useToast();

  const [tab, setTab] = useState<TabId>('nodes');
  const [nodes, setNodes] = useState<NodeEntry[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
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
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState('');
  const [nodePending, setNodePending] = useState<any[]>([]);
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
  const [showTokenMap, setShowTokenMap] = useState<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; desc: string; onOk: () => void } | null>(null);
  const [pairNodeIdError, setPairNodeIdError] = useState('');
  const [verifyTokenError, setVerifyTokenError] = useState('');

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

  // Real-time: node.invoke.request events + node status tracking
  useGatewayEvents(useMemo(() => ({
    'node.invoke.request': (p) => {
      const cmd = p.command || p.requestId || '?';
      const node = p.nodeId || '?';
      setEventLog(prev => [`[${new Date().toLocaleTimeString()}] invoke.request → ${node}: ${cmd}`, ...prev.slice(0, 49)]);
    },
    'health': () => {
      if (autoRefresh) fetchNodesQuiet();
    },
  }), [autoRefresh, fetchNodesQuiet]));

  // Alert generation: detect node status changes
  useEffect(() => {
    const prev = prevNodesRef.current;
    if (prev.length === 0) { prevNodesRef.current = nodes; return; }
    const prevMap = new Map(prev.map(n => [n.id, n]));
    const newAlerts: NodeAlert[] = [];
    for (const n of nodes) {
      const p = prevMap.get(n.id);
      if (p && isNodeOnline(p) && !isNodeOnline(n)) {
        newAlerts.push({ id: `${n.id}-${Date.now()}`, type: 'offline', nodeName: n.host || n.id, nodeId: n.id, ts: Date.now() });
      }
      if (p && !isNodeOnline(p) && isNodeOnline(n)) {
        newAlerts.push({ id: `${n.id}-${Date.now()}`, type: 'back', nodeName: n.host || n.id, nodeId: n.id, ts: Date.now() });
      }
    }
    if (newAlerts.length > 0) {
      setAlerts(a => [...newAlerts, ...a].slice(0, 50));
      for (const al of newAlerts) {
        const msg = al.type === 'offline'
          ? (nd?.alertNodeOffline || '').replace('{name}', al.nodeName)
          : (nd?.alertNodeBack || '').replace('{name}', al.nodeName);
        toast(al.type === 'offline' ? 'error' : 'success', msg);
      }
    }
    prevNodesRef.current = nodes;
  }, [nodes, nd, toast]);

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
        n.id.toLowerCase().includes(s) ||
        n.host?.toLowerCase().includes(s) ||
        n.ip?.toLowerCase().includes(s) ||
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
    const allIds = sortedNodes.map(n => n.id);
    setSelectedIds(new Set(allIds));
  }, [sortedNodes]);
  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  // Batch invoke
  const handleBatchInvoke = useCallback(async () => {
    if (selectedIds.size === 0 || !batchCmd.trim() || batching) return;
    const cmd = batchCmd.trim();
    if (!confirm((nd?.batchInvokeConfirm || '').replace('{count}', String(selectedIds.size)).replace('{cmd}', cmd))) return;
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
      (nd?.batchInvokeOk || '').replace('{count}', String(ok)) + (fail > 0 ? ` (${fail} failed)` : ''));
    setBatching(false);
    setSelectedIds(new Set());
  }, [selectedIds, batchCmd, batchParams, batching, nd, toast]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast('success', nd.copied);
  }, [toast, nd]);

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
    } catch (err: any) { toast('error', err?.message || nd.invokeFailed); }
    finally { setDetailLoading(false); }
  }, [toast, nd]);

  const handleSelectNode = useCallback((node: NodeEntry) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
      setNodeDetail(null);
      setInvokeResult(null);
    } else {
      setSelectedNode(node);
      fetchNodeDetail(node.id);
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
        nodeId: selectedNode.id,
        command: invokeCmd.trim(),
        params,
        timeoutMs: invokeTimeout ? Number(invokeTimeout) : undefined,
        idempotencyKey: `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      }) as any;
      setInvokeResult({ ok: true, text: nd.invokeOk, payload: res?.payload ?? res?.payloadJSON ?? null });
    } catch (err: any) {
      setInvokeResult({ ok: false, text: nd.invokeFailed + ': ' + (err?.message || '') });
    }
    setInvoking(false);
  }, [selectedNode, invokeCmd, invokeParams, invokeTimeout, invoking, nd]);

  const handlePairRequest = useCallback(async () => {
    if (!pairNodeId.trim() || pairing) return;
    setPairing(true);
    setPairResult(null);
    try {
      await gwApi.proxy('node.pair.request', { nodeId: pairNodeId.trim(), displayName: pairName.trim() || undefined, platform: pairPlatform.trim() || undefined });
      setPairResult({ ok: true, text: nd.pairOk });
      setEventLog(prev => [`[${new Date().toLocaleTimeString()}] pair.request → ${pairNodeId.trim()}`, ...prev.slice(0, 49)]);
      setPairNodeId(''); setPairName(''); setPairPlatform('');
      fetchDevices();
    } catch (err: any) {
      setPairResult({ ok: false, text: nd.pairFailed + ': ' + (err?.message || '') });
    }
    setPairing(false);
  }, [pairNodeId, pairName, pairPlatform, pairing, nd, fetchDevices]);

  const handlePairVerify = useCallback(async () => {
    if (!verifyNodeId.trim() || !verifyToken.trim() || verifying) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await gwApi.proxy('node.pair.verify', { nodeId: verifyNodeId.trim(), token: verifyToken.trim() }) as any;
      setVerifyResult({ ok: true, text: nd.pairVerifyOk + (res?.valid === false ? ` (${nd.invalid})` : '') });
    } catch (err: any) {
      setVerifyResult({ ok: false, text: nd.pairVerifyFailed + ': ' + (err?.message || '') });
    }
    setVerifying(false);
  }, [verifyNodeId, verifyToken, verifying, nd]);

  const handleRename = useCallback(async (nodeId: string) => {
    if (!renameName.trim() || renaming) return;
    setRenaming(true);
    try {
      await gwApi.proxy('node.rename', { nodeId, displayName: renameName.trim() });
      setRenameNodeId(null);
      setRenameName('');
      fetchNodes();
    } catch (err: any) { toast('error', err?.message || nd?.renameFailed); }
    setRenaming(false);
  }, [renameName, renaming, fetchNodes, toast, nd]);

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
    const raf = requestAnimationFrame(() => { fetchNodes(); });
    return () => cancelAnimationFrame(raf);
  }, [fetchNodes]);
  useEffect(() => { if (tab === 'devices') fetchDevices(); }, [tab, fetchDevices]);
  useEffect(() => { if (tab === 'bindings' && !config) fetchConfig(); }, [tab, config, fetchConfig]);

  const handleApprove = useCallback(async (requestId: string) => {
    try { 
      await gwApi.devicePairApprove(requestId); 
      toast('success', nd.approved);
      fetchDevices(); 
    } catch (e: any) { 
      toast('error', String(e));
      setDevicesError(String(e)); 
    }
  }, [fetchDevices, toast, nd]);

  const handleReject = useCallback(async (requestId: string) => {
    if (!confirm(nd.confirmReject)) return;
    try { 
      await gwApi.devicePairReject(requestId); 
      toast('success', nd.rejected);
      fetchDevices(); 
    } catch (e: any) { 
      toast('error', String(e));
      setDevicesError(String(e)); 
    }
  }, [fetchDevices, nd, toast]);

  const handleNodePairApprove = useCallback(async (nodeId: string) => {
    try { 
      await gwApi.nodePairApprove(nodeId); 
      toast('success', nd.approved);
      fetchDevices(); 
    } catch (e: any) { 
      toast('error', String(e));
      setDevicesError(String(e)); 
    }
  }, [fetchDevices, toast, nd]);

  const handleNodePairReject = useCallback(async (nodeId: string) => {
    if (!confirm(nd.confirmReject)) return;
    try { 
      await gwApi.nodePairReject(nodeId); 
      toast('success', nd.rejected);
      fetchDevices(); 
    } catch (e: any) { 
      toast('error', String(e));
      setDevicesError(String(e)); 
    }
  }, [fetchDevices, nd, toast]);

  const handleRotate = useCallback(async (deviceId: string, role: string, scopes?: string[]) => {
    try {
      const res = await gwApi.deviceTokenRotate(deviceId, role, scopes) as any;
      if (res?.token) {
        await navigator.clipboard.writeText(res.token);
        toast('success', nd.tokenRotated + ' - ' + nd.copied);
      }
      fetchDevices();
    } catch (e: any) { 
      toast('error', String(e));
      setDevicesError(String(e)); 
    }
  }, [fetchDevices, toast, nd]);

  const handleRevoke = useCallback(async (deviceId: string, role: string) => {
    if (!confirm(nd.confirmRevoke)) return;
    try { 
      await gwApi.deviceTokenRevoke(deviceId, role); 
      toast('success', nd.revoked);
      fetchDevices(); 
    } catch (e: any) { 
      toast('error', String(e));
      setDevicesError(String(e)); 
    }
  }, [fetchDevices, nd, toast]);

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
  const handleBatchApprove = useCallback(async () => {
    if (selectedPendingIds.size === 0) return;
    if (!confirm((nd?.batchApproveConfirm || '').replace('{count}', String(selectedPendingIds.size)))) return;
    let ok = 0;
    for (const rid of selectedPendingIds) {
      try { await gwApi.devicePairApprove(rid); ok++; } catch { /* skip */ }
    }
    toast('success', (nd?.batchApproveOk || '').replace('{count}', String(ok)));
    setSelectedPendingIds(new Set());
    fetchDevices();
  }, [selectedPendingIds, nd, toast, fetchDevices]);

  const handleBatchReject = useCallback(async () => {
    if (selectedPendingIds.size === 0) return;
    if (!confirm((nd?.batchRejectConfirm || '').replace('{count}', String(selectedPendingIds.size)))) return;
    let ok = 0;
    for (const rid of selectedPendingIds) {
      try { await gwApi.devicePairReject(rid); ok++; } catch { /* skip */ }
    }
    toast('success', (nd?.batchRejectOk || '').replace('{count}', String(ok)));
    setSelectedPendingIds(new Set());
    fetchDevices();
  }, [selectedPendingIds, nd, toast, fetchDevices]);

  const togglePendingSelect = useCallback((rid: string) => {
    setSelectedPendingIds(prev => {
      const next = new Set(prev);
      if (next.has(rid)) next.delete(rid); else next.add(rid);
      return next;
    });
  }, []);

  const toggleShowToken = useCallback((key: string) => {
    setShowTokenMap(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // === Devices: enhanced confirm dialog wrappers ===
  const handleRevokeWithDialog = useCallback((deviceId: string, role: string) => {
    setConfirmDialog({
      title: nd?.confirmRevokeTitle || 'Revoke',
      desc: nd?.confirmRevokeDesc || '',
      onOk: async () => {
        try {
          await gwApi.deviceTokenRevoke(deviceId, role);
          toast('success', nd.revoked);
          setEventLog(prev => [`[${new Date().toLocaleTimeString()}] token.revoke → ${deviceId}:${role}`, ...prev.slice(0, 49)]);
          fetchDevices();
        } catch (e: any) { toast('error', String(e)); }
        setConfirmDialog(null);
      },
    });
  }, [nd, toast, fetchDevices]);

  const handleRotateWithDialog = useCallback((deviceId: string, role: string, scopes?: string[]) => {
    setConfirmDialog({
      title: nd?.confirmRotateTitle || 'Rotate',
      desc: nd?.confirmRotateDesc || '',
      onOk: async () => {
        try {
          const res = await gwApi.deviceTokenRotate(deviceId, role, scopes) as any;
          if (res?.token) {
            await navigator.clipboard.writeText(res.token);
            toast('success', nd.tokenRotated + ' - ' + nd.copied);
          }
          setEventLog(prev => [`[${new Date().toLocaleTimeString()}] token.rotate → ${deviceId}:${role}`, ...prev.slice(0, 49)]);
          fetchDevices();
        } catch (e: any) { toast('error', String(e)); }
        setConfirmDialog(null);
      },
    });
  }, [nd, toast, fetchDevices]);

  const handleRejectWithDialog = useCallback((requestId: string, deviceName?: string) => {
    setConfirmDialog({
      title: nd?.confirmRejectTitle || 'Reject',
      desc: nd?.confirmRejectDesc || '',
      onOk: async () => {
        try {
          await gwApi.devicePairReject(requestId);
          toast('success', nd.rejected);
          setEventLog(prev => [`[${new Date().toLocaleTimeString()}] pair.reject → ${deviceName || requestId}`, ...prev.slice(0, 49)]);
          fetchDevices();
        } catch (e: any) { toast('error', String(e)); }
        setConfirmDialog(null);
      },
    });
  }, [nd, toast, fetchDevices]);

  // === Devices: form validation ===
  const validatePairNodeId = useCallback((v: string) => {
    if (!v.trim()) { setPairNodeIdError(nd?.pairFieldRequired || ''); return false; }
    if (!/^[\w-]+$/.test(v.trim())) { setPairNodeIdError(nd?.pairNodeIdFormat || ''); return false; }
    setPairNodeIdError(''); return true;
  }, [nd]);

  const validateVerifyToken = useCallback((v: string) => {
    if (!v.trim()) { setVerifyTokenError(nd?.pairFieldRequired || ''); return false; }
    setVerifyTokenError(''); return true;
  }, [nd]);

  // === Devices: batch rotate ===
  const handleBatchRotate = useCallback(async () => {
    if (paired.length === 0) return;
    if (!confirm((nd?.batchRotateConfirm || '').replace('{count}', String(paired.length)))) return;
    let ok = 0;
    for (const d of paired) {
      const tokens = Array.isArray(d.tokens) ? d.tokens : [];
      for (const tk of tokens) {
        if (!tk.revokedAtMs) {
          try { await gwApi.deviceTokenRotate(d.deviceId, tk.role, tk.scopes); ok++; } catch { /* skip */ }
        }
      }
    }
    toast('success', (nd?.batchRotateOk || '').replace('{count}', String(ok)));
    fetchDevices();
  }, [paired, nd, toast, fetchDevices]);

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
    toast('success', nd?.bindingTemplateSaved || '');
    setTemplateName('');
  }, [templateName, config, toast, nd]);

  const handleApplyTemplate = useCallback((tmpl: { name: string; config: any }) => {
    setConfig(JSON.parse(JSON.stringify(tmpl.config)));
    setConfigDirty(true);
    toast('success', nd?.bindingTemplateApplied || '');
  }, [toast, nd]);

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
    if (!confirm(nd?.bindingRollbackConfirm || '')) return;
    setConfig(JSON.parse(JSON.stringify(entry.config)));
    setConfigDirty(true);
    toast('success', nd?.bindingRollbackOk || '');
  }, [nd, toast]);

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
  useEffect(() => { if (tab === 'devices') setNewPairBadge(0); }, [tab]);

  const tabs: { id: TabId; label: string; icon: string; count?: number; badge?: number }[] = [
    { id: 'nodes', label: nd.nodesSection, icon: 'hub', count: nodes.length },
    { id: 'devices', label: nd.devicesSection, icon: 'devices', count: pending.length + paired.length, badge: newPairBadge },
    { id: 'bindings', label: nd.bindingsSection, icon: 'link' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#0f1115]">
      {/* 顶部 */}
      <div className="flex flex-col border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/20 shrink-0">
        <div className="h-12 flex items-center justify-center px-4 border-b border-slate-200/50 dark:border-white/5">
          <div className="flex bg-slate-200 dark:bg-black/40 p-0.5 rounded-xl shadow-inner">
            {tabs.map(tb => (
              <button key={tb.id} onClick={() => setTab(tb.id)}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-bold transition-all flex items-center gap-1.5 ${tab === tb.id ? 'bg-white dark:bg-primary shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}>
                <span className="material-symbols-outlined text-[14px]">{tb.icon}</span>
                {tb.label}
                {tb.count !== undefined && <span className="text-[11px] opacity-60">{tb.count}</span>}
                {tb.badge && tb.badge > 0 ? <span className="w-4 h-4 rounded-full bg-mac-red text-white text-[9px] font-bold flex items-center justify-center -mr-1">{tb.badge}</span> : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-5xl mx-auto p-4 md:p-6">

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
                        : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-white/50 hover:bg-slate-200 dark:hover:bg-white/10'
                    }`} title={autoRefresh ? nd.autoRefreshOn : nd.autoRefreshOff}>
                    <span className="material-symbols-outlined text-[14px]">{autoRefresh ? 'sync' : 'sync_disabled'}</span>
                    <span className="hidden sm:inline">{nd.autoRefresh}</span>
                  </button>
                  {/* View mode toggle */}
                  <div className="flex bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
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
                  {/* Refresh button */}
                  <button onClick={fetchNodes} disabled={nodesLoading}
                    className="h-8 px-3 flex items-center gap-1.5 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-bold text-slate-600 dark:text-white/70 disabled:opacity-50">
                    <span className={`material-symbols-outlined text-[14px] ${nodesLoading ? 'animate-spin' : ''}`}>{nodesLoading ? 'progress_activity' : 'refresh'}</span>
                    <span className="hidden sm:inline">{nd.refresh}</span>
                  </button>
                </div>
              </div>

              {/* Stats bar */}
              {nodes.length > 0 && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-white/60">{(nd.nodeCount || '').replace('{count}', String(nodes.length))}</span>
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
                      <span className="flex-1 text-slate-600 dark:text-white/60">
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

              {/* Search, Filter, Sort, Group Bar */}
              {nodes.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30 absolute left-3 top-1/2 -translate-y-1/2">search</span>
                      <input type="text" value={nodeSearchInput} onChange={e => setNodeSearchInput(e.target.value)}
                        placeholder={nd.searchNodes}
                        className="w-full h-9 pl-9 pr-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white/80 placeholder:text-slate-400 dark:placeholder:text-white/30 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all" />
                      {nodeSearchInput && (
                        <button onClick={() => setNodeSearchInput('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white/60">
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      )}
                    </div>
                    <div className="flex bg-slate-100 dark:bg-white/5 rounded-lg p-0.5 shrink-0">
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
                        className="h-7 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 min-w-[100px]" />
                    )}
                    {versionOptions.length > 0 && (
                      <CustomSelect value={filterVersion} onChange={v => setFilterVersion(v)}
                        options={[{ value: '', label: nd.filterVersionAll }, ...versionOptions.map(v => ({ value: v, label: 'v' + v }))]}
                        className="h-7 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 min-w-[100px]" />
                    )}
                    <CustomSelect value={filterHealth} onChange={v => setFilterHealth(v)}
                      options={[{ value: '', label: nd.filterHealthAll }, { value: 'healthy', label: nd.healthy }, { value: 'warning', label: nd.warning }, { value: 'critical', label: nd.critical }]}
                      className="h-7 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 min-w-[100px]" />
                    <span className="w-px h-5 bg-slate-200 dark:bg-white/10" />
                    <CustomSelect value={sortKey} onChange={v => setSortKey(v as SortKey)}
                      options={[{ value: 'status', label: nd.sortByStatus }, { value: 'name', label: nd.sortByName }, { value: 'lastUsed', label: nd.sortByLastUsed }, { value: 'connectedAt', label: nd.sortByConnectedAt }]}
                      className="h-7 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 min-w-[100px]" />
                    <CustomSelect value={groupKey} onChange={v => setGroupKey(v as GroupKey)}
                      options={[{ value: 'none', label: nd.groupByNone }, { value: 'platform', label: nd.groupByPlatform }, { value: 'status', label: nd.groupByStatus }, { value: 'version', label: nd.groupByVersion }]}
                      className="h-7 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 min-w-[100px]" />
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
                <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-white/40">
                  <span className="material-symbols-outlined text-5xl mb-4 text-primary/20">hub</span>
                  <span className="text-sm font-bold mb-2">{nd.noNodes}</span>
                  <span className="text-[11px] text-center max-w-xs">{nd.noNodesHint}</span>
                </div>
              )}

              {/* No results after filtering */}
              {!nodesLoading && nodes.length > 0 && filteredNodes.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-white/40">
                  <span className="material-symbols-outlined text-4xl mb-3 text-slate-300 dark:text-white/20">search_off</span>
                  <span className="text-xs">{nd.noNodes}</span>
                </div>
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
                      const isSelected = selectedNode?.id === node.id;
                      const online = isNodeOnline(node);
                      const health = getHealthStatus(node);
                      const hc = HEALTH_COLORS[health];
                      const checked = selectedIds.has(node.id);

                      if (viewMode === 'list') {
                        return (
                          <div key={node.id || i}
                            className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all ${isSelected ? 'border-primary ring-1 ring-primary/20 bg-primary/[0.02]' : 'border-slate-200 dark:border-white/10 hover:border-primary/40 bg-slate-50 dark:bg-white/[0.02]'}`}>
                            <input type="checkbox" checked={checked}
                              onChange={() => toggleSelect(node.id)}
                              onClick={e => e.stopPropagation()}
                              className="w-3.5 h-3.5 rounded accent-primary shrink-0" />
                            <div className={`w-2 h-2 rounded-full shrink-0 ${hc.dot} ${online ? 'animate-pulse' : ''}`} title={nd[health] || health} />
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleSelectNode(node)}>
                              <span className="font-bold text-[12px] text-slate-800 dark:text-white truncate">{node.host || truncateId(node.id, 20)}</span>
                            </div>
                            {node.platform && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 font-bold hidden sm:inline">{node.platform}</span>}
                            {node.version && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold hidden sm:inline">v{node.version}</span>}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${hc.bg} ${hc.text}`}>{nd[health] || health}</span>
                            {node.lastInputSeconds != null && (
                              <span className="text-[10px] text-slate-400 dark:text-white/30 hidden sm:inline">{fmtAge(node.lastInputSeconds)}</span>
                            )}
                            <button onClick={e => { e.stopPropagation(); copyToClipboard(node.id); }} title={nd.copyId}
                              className="text-slate-400 hover:text-primary shrink-0">
                              <span className="material-symbols-outlined text-[14px]">content_copy</span>
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div key={node.id || i}
                          className={`relative bg-slate-50 dark:bg-white/[0.02] border rounded-2xl p-3 sm:p-4 cursor-pointer transition-all group shadow-sm hover:shadow-md ${isSelected ? 'border-primary ring-1 ring-primary/20' : 'border-slate-200 dark:border-white/10 hover:border-primary/40'}`}>
                          {/* Batch checkbox */}
                          <div className="absolute top-3 left-3" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={checked} onChange={() => toggleSelect(node.id)}
                              className="w-3.5 h-3.5 rounded accent-primary" />
                          </div>
                          {/* Health indicator */}
                          <div className="absolute top-3 right-3 flex items-center gap-1.5" title={nd[health] || health}>
                            <span className={`text-[9px] font-bold ${hc.text}`}>{nd[health] || health}</span>
                            <div className={`w-2.5 h-2.5 rounded-full ${hc.dot} ${online ? 'animate-pulse' : ''}`} />
                          </div>

                          <div className="flex items-center gap-3 mb-3 pl-5" onClick={() => handleSelectNode(node)}>
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/15 to-blue-600/15 flex items-center justify-center border border-sky-500/10">
                              <span className="material-symbols-outlined text-sky-500 text-[20px]">dns</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              {renameNodeId === node.id ? (
                                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                  <input value={renameName} onChange={e => setRenameName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleRename(node.id)}
                                    autoFocus placeholder={nd.newName}
                                    className="flex-1 h-6 px-2 bg-white dark:bg-black/20 border border-primary/40 rounded text-[11px] text-slate-700 dark:text-white/70 outline-none" />
                                  <button onClick={() => handleRename(node.id)} disabled={renaming || !renameName.trim()}
                                    className="text-[10px] text-primary font-bold disabled:opacity-40">{renaming ? '...' : '✓'}</button>
                                  <button onClick={() => { setRenameNodeId(null); setRenameName(''); }}
                                    className="text-[10px] text-slate-400">✗</button>
                                </div>
                              ) : (
                                <h4 className="font-bold text-[13px] text-slate-800 dark:text-white truncate" onDoubleClick={e => { e.stopPropagation(); setRenameNodeId(node.id); setRenameName(node.host || ''); }}>
                                  {node.host || truncateId(node.id, 20)}
                                </h4>
                              )}
                              <p className="text-[10px] text-slate-400 dark:text-white/40 font-mono truncate flex items-center gap-1 group/id">
                                <span title={node.id}>{truncateId(node.id, 24)}</span>
                                <button onClick={e => { e.stopPropagation(); copyToClipboard(node.id); }}
                                  className="opacity-0 group-hover/id:opacity-100 transition-opacity" title={nd.copyId}>
                                  <span className="material-symbols-outlined text-[12px] hover:text-primary">content_copy</span>
                                </button>
                              </p>
                            </div>
                          </div>

                          {/* Tags */}
                          <div className="flex flex-wrap gap-1 mb-2 pl-5">
                            {node.platform && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 font-bold">{node.platform}</span>}
                            {node.version && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold">v{node.version}</span>}
                            {node.mode && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">{node.mode}</span>}
                            {Array.isArray(node.roles) && node.roles.map(r => (
                              <span key={r} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">{r}</span>
                            ))}
                          </div>

                          {/* Heartbeat & last used */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] pl-5">
                            {node.ip && (
                              <><span className="text-slate-400 dark:text-white/35">{nd.ip}</span><span className="text-slate-600 dark:text-white/60 font-mono">{node.ip}</span></>
                            )}
                            <span className="text-slate-400 dark:text-white/35">{nd.heartbeat}</span>
                            <span className={`font-bold ${online ? 'text-mac-green' : 'text-slate-400 dark:text-white/30'}`}>
                              {node.lastInputSeconds != null ? fmtRelativeTime(node.lastInputSeconds, nd) : nd.heartbeatNever}
                            </span>
                            {node.lastInputSeconds != null && (
                              <><span className="text-slate-400 dark:text-white/35">{nd.lastUsed}</span><span className="text-slate-600 dark:text-white/60">{fmtAge(node.lastInputSeconds)} {nd.ago}</span></>
                            )}
                            {Array.isArray(node.scopes) && node.scopes.length > 0 && (
                              <><span className="text-slate-400 dark:text-white/35">{nd.scopes}</span><span className="text-slate-600 dark:text-white/60 truncate">{node.scopes.join(', ')}</span></>
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
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
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

                                  <div>
                                    <div className="text-[11px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-wider mb-1">{nd.capabilities}</div>
                                    {Array.isArray(nodeDetail.caps) && nodeDetail.caps.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {nodeDetail.caps.map(c => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-mac-green/10 text-mac-green font-bold">{c}</span>)}
                                      </div>
                                    ) : <p className="text-[10px] text-slate-400">-</p>}
                                  </div>

                                  <div>
                                    <div className="text-[11px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-wider mb-1">{nd.commands}</div>
                                    {Array.isArray(nodeDetail.commands) && nodeDetail.commands.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {nodeDetail.commands.map(c => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-bold font-mono">{c}</span>)}
                                      </div>
                                    ) : <p className="text-[10px] text-slate-400">{nd.noCommands}</p>}
                                  </div>

                                  {nodeDetail.connected && Array.isArray(nodeDetail.commands) && nodeDetail.commands.length > 0 && (
                                    <div className="p-3 rounded-xl bg-white dark:bg-black/20 border border-slate-200/60 dark:border-white/5 space-y-2">
                                      <div className="text-[11px] font-bold text-slate-500 dark:text-white/40 uppercase tracking-wider flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[12px] text-primary">terminal</span>
                                        {nd.invoke}
                                      </div>
                                      <div className="flex flex-col sm:flex-row gap-2">
                                        <CustomSelect value={invokeCmd} onChange={v => setInvokeCmd(v)}
                                          options={[{ value: '', label: `${nd.invokeCommand}...` }, ...nodeDetail.commands.map(c => ({ value: c, label: c }))]}
                                          className="flex-1 h-7 px-2 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-mono text-slate-700 dark:text-white/70" />
                                        <input value={invokeTimeout} onChange={e => setInvokeTimeout(e.target.value)}
                                          placeholder={nd.invokeTimeout} type="number"
                                          className="w-24 h-7 px-2 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-mono text-slate-700 dark:text-white/70 outline-none" />
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
                                            <pre className="p-1.5 bg-black/5 dark:bg-black/30 rounded text-[11px] font-mono text-slate-500 dark:text-white/40 overflow-x-auto max-h-32 custom-scrollbar">
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
                                <pre className="p-2 bg-black/5 dark:bg-black/30 rounded-lg text-[11px] font-mono text-slate-500 dark:text-white/40 overflow-x-auto max-h-40 custom-scrollbar">
                                  {JSON.stringify(node, null, 2)}
                                </pre>
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
                    className="h-8 px-3 flex items-center gap-1.5 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-bold text-slate-600 dark:text-white/70 disabled:opacity-50">
                    <span className={`material-symbols-outlined text-[14px] ${devicesLoading ? 'animate-spin' : ''}`}>{devicesLoading ? 'progress_activity' : 'refresh'}</span>
                    <span className="hidden sm:inline">{nd.refresh}</span>
                  </button>
                </div>
              </div>

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
                  <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30 absolute left-3 top-1/2 -translate-y-1/2">search</span>
                  <input
                    type="text"
                    value={deviceSearchInput}
                    onChange={e => setDeviceSearchInput(e.target.value)}
                    placeholder={nd.searchDevices}
                    className="w-full h-9 pl-9 pr-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white/80 placeholder:text-slate-400 dark:placeholder:text-white/30 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                  />
                  {deviceSearchInput && (
                    <button onClick={() => setDeviceSearchInput('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white/60">
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  )}
                </div>
              )}

              {/* Pair Request + Verify */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3 space-y-2">
                  <h3 className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase flex items-center gap-1" title={nd.pairRequestHelp}>
                    <span className="material-symbols-outlined text-[12px]">add_link</span>{nd.pairRequest}
                    <span className="material-symbols-outlined text-[10px] text-slate-300 dark:text-white/20 ml-auto cursor-help">info</span>
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
                    <span className="material-symbols-outlined text-[10px] text-slate-300 dark:text-white/20 ml-auto cursor-help">info</span>
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

              {/* 待审批节点配对 */}
              {nodePending.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-[16px] text-purple-500">hub</span>
                    <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{nd.pending} ({nd.nodesSection})</h3>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-400 font-bold">{nodePending.length}</span>
                  </div>
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
                          <button onClick={() => handleNodePairApprove(req.nodeId)}
                            className="h-8 px-4 bg-mac-green text-white text-[10px] font-bold rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">check</span>{nd.approve}
                          </button>
                          <button onClick={() => handleNodePairReject(req.nodeId)}
                            className="h-8 px-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 text-[10px] font-bold rounded-lg hover:bg-mac-red/10 hover:text-mac-red transition-colors flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">close</span>{nd.reject}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
                          <button onClick={() => handleApprove(req.requestId)}
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
                                    const tokenKey = `${device.deviceId}_${ti}`;
                                    const isTokenVisible = showTokenMap.has(tokenKey);
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
                                            <button onClick={() => toggleShowToken(tokenKey)} className="text-[10px] text-slate-400 hover:text-primary flex items-center gap-0.5">
                                              <span className="material-symbols-outlined text-[12px]">{isTokenVisible ? 'visibility_off' : 'visibility'}</span>
                                              {isTokenVisible ? nd.tokenHide : nd.tokenShow}
                                            </button>
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
                <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-white/40">
                  <span className="material-symbols-outlined text-5xl mb-4 text-primary/20">devices</span>
                  <span className="text-sm font-bold mb-2">{nd.noDevices}</span>
                  <span className="text-[11px] text-center max-w-xs">{nd.noDevicesHint}</span>
                </div>
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
                    <div className="space-y-1.5 max-h-32 overflow-y-auto custom-scrollbar">
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
                              const boundNode = nodes.find(n => n.id === defaultBinding);
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
                          options={[{ value: '', label: nd.anyNode }, ...nodes.map(n => ({ value: n.id, label: `${n.host || n.id} ${isNodeOnline(n) ? '●' : '○'}` }))]}
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
                    {defaultBinding && !isNodeOnline(nodes.find(n => n.id === defaultBinding) || {} as NodeEntry) && (
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
                          const boundNode = agent.binding ? nodes.find(n => n.id === agent.binding) : null;
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
                                  options={[{ value: '', label: nd.anyNode }, ...nodes.map(n => ({ value: n.id, label: `${n.host || n.id} ${isNodeOnline(n) ? '●' : '○'}` }))]}
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
                  <div className="space-y-0.5 max-h-32 overflow-y-auto custom-scrollbar">
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
                className="h-8 px-4 bg-mac-red text-white text-[11px] font-bold rounded-lg hover:bg-mac-red/90 transition-colors">
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
