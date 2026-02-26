
import React, { useState, useMemo, useEffect, useCallback } from 'react';
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

type TabId = 'nodes' | 'devices' | 'bindings';

// Relative time formatting with i18n support
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

// Truncate long IDs with ellipsis
function truncateId(id: string, maxLen = 16): string {
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen - 3) + '...';
}

// Check if node is online (last activity within 5 minutes)
function isNodeOnline(node: NodeEntry): boolean {
  return node.lastInputSeconds != null && node.lastInputSeconds < 300;
}

type NodeFilter = 'all' | 'online' | 'offline';

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
  // Node pair state
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
  const [pairOpen, setPairOpen] = useState(false);
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

  // Real-time: node.invoke.request events
  useGatewayEvents(useMemo(() => ({
    'node.invoke.request': (p) => {
      const cmd = p.command || p.requestId || '?';
      const node = p.nodeId || '?';
      setEventLog(prev => [`[${new Date().toLocaleTimeString()}] invoke.request → ${node}: ${cmd}`, ...prev.slice(0, 49)]);
    },
  }), []));

  const fetchNodes = useCallback(async () => {
    setNodesLoading(true); setError('');
    try {
      const res = await gwApi.nodeList() as any;
      const list = Array.isArray(res?.nodes) ? res.nodes : [];
      setNodes(list);
    } catch (e: any) { setError(String(e)); }
    finally { setNodesLoading(false); }
  }, []);

  // Filtered nodes based on search and filter
  const filteredNodes = useMemo(() => {
    let result = nodes;
    // Apply search filter
    if (nodeSearch.trim()) {
      const search = nodeSearch.toLowerCase();
      result = result.filter(n => 
        n.id.toLowerCase().includes(search) ||
        n.host?.toLowerCase().includes(search) ||
        n.ip?.toLowerCase().includes(search) ||
        n.platform?.toLowerCase().includes(search)
      );
    }
    // Apply online/offline filter
    if (nodeFilter === 'online') {
      result = result.filter(isNodeOnline);
    } else if (nodeFilter === 'offline') {
      result = result.filter(n => !isNodeOnline(n));
    }
    return result;
  }, [nodes, nodeSearch, nodeFilter]);

  // Filtered devices based on search
  const filteredPending = useMemo(() => {
    if (!deviceSearch.trim()) return pending;
    const search = deviceSearch.toLowerCase();
    return pending.filter(d => 
      d.deviceId.toLowerCase().includes(search) ||
      d.displayName?.toLowerCase().includes(search) ||
      d.remoteIp?.toLowerCase().includes(search)
    );
  }, [pending, deviceSearch]);

  const filteredPaired = useMemo(() => {
    if (!deviceSearch.trim()) return paired;
    const search = deviceSearch.toLowerCase();
    return paired.filter(d => 
      d.deviceId.toLowerCase().includes(search) ||
      d.displayName?.toLowerCase().includes(search) ||
      d.remoteIp?.toLowerCase().includes(search)
    );
  }, [paired, deviceSearch]);

  const renderedNodes = useMemo(() => filteredNodes.slice(0, 120), [filteredNodes]);
  const omittedNodes = Math.max(0, filteredNodes.length - renderedNodes.length);
  const renderedPending = useMemo(() => filteredPending.slice(0, 120), [filteredPending]);
  const omittedPending = Math.max(0, filteredPending.length - renderedPending.length);
  const renderedPaired = useMemo(() => filteredPaired.slice(0, 120), [filteredPaired]);
  const omittedPaired = Math.max(0, filteredPaired.length - renderedPaired.length);

  // Copy to clipboard helper
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
  }, []);

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

  // Pair request
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

  // Pair verify
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

  // Rename node
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
  }, [renameName, renaming, fetchNodes]);

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

  // Clear event log
  const clearEventLog = useCallback(() => {
    setEventLog([]);
  }, []);

  // Bindings
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

  const tabs: { id: TabId; label: string; icon: string; count?: number }[] = [
    { id: 'nodes', label: nd.nodesSection, icon: 'hub', count: nodes.length },
    { id: 'devices', label: nd.devicesSection, icon: 'devices', count: pending.length + paired.length },
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
              {/* Header with title and refresh */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-bold text-slate-800 dark:text-white">{nd.nodesSection}</h2>
                  <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{nd.nodesHelp || nd.desc}</p>
                </div>
                <button onClick={fetchNodes} disabled={nodesLoading}
                  className="h-8 px-3 flex items-center gap-1.5 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-bold text-slate-600 dark:text-white/70 disabled:opacity-50 shrink-0">
                  <span className={`material-symbols-outlined text-[14px] ${nodesLoading ? 'animate-spin' : ''}`}>{nodesLoading ? 'progress_activity' : 'refresh'}</span>
                  <span className="hidden sm:inline">{nd.refresh}</span>
                </button>
              </div>

              {/* Search and Filter Bar */}
              {nodes.length > 0 && (
                <div className="flex flex-col sm:flex-row gap-2">
                  {/* Search Input */}
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-white/30 absolute left-3 top-1/2 -translate-y-1/2">search</span>
                    <input
                      type="text"
                      value={nodeSearchInput}
                      onChange={e => setNodeSearchInput(e.target.value)}
                      placeholder={nd.searchNodes}
                      className="w-full h-9 pl-9 pr-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[12px] text-slate-700 dark:text-white/80 placeholder:text-slate-400 dark:placeholder:text-white/30 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                    {nodeSearchInput && (
                      <button onClick={() => setNodeSearchInput('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white/60">
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    )}
                  </div>
                  {/* Filter Buttons */}
                  <div className="flex bg-slate-100 dark:bg-white/5 rounded-lg p-0.5 shrink-0">
                    {(['all', 'online', 'offline'] as NodeFilter[]).map(f => (
                      <button
                        key={f}
                        onClick={() => setNodeFilter(f)}
                        className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${
                          nodeFilter === f
                            ? 'bg-white dark:bg-primary text-slate-800 dark:text-white shadow-sm'
                            : 'text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/70'
                        }`}
                      >
                        {f === 'all' ? nd.all : f === 'online' ? nd.onlineOnly : nd.offlineOnly}
                      </button>
                    ))}
                  </div>
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

              {/* 节点列表 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {renderedNodes.map((node, i) => {
                  const isSelected = selectedNode?.id === node.id;
                  const online = isNodeOnline(node);
                  return (
                    <div key={node.id || i} onClick={() => handleSelectNode(node)}
                      className={`relative bg-slate-50 dark:bg-white/[0.02] border rounded-2xl p-3 sm:p-4 cursor-pointer transition-all group shadow-sm hover:shadow-md ${isSelected ? 'border-primary ring-1 ring-primary/20' : 'border-slate-200 dark:border-white/10 hover:border-primary/40'
                        }`}>
                      {/* 在线指示灯 with tooltip */}
                      <div className="absolute top-3 right-3 group/status" title={online ? nd.online : nd.offline}>
                        <div className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-mac-green animate-pulse' : 'bg-slate-300 dark:bg-white/20'}`} />
                      </div>

                      <div className="flex items-center gap-3 mb-3">
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
                            <button 
                              onClick={e => { e.stopPropagation(); copyToClipboard(node.id); }}
                              className="opacity-0 group-hover/id:opacity-100 transition-opacity"
                              title={nd.copyId}
                            >
                              <span className="material-symbols-outlined text-[12px] hover:text-primary">content_copy</span>
                            </button>
                          </p>
                        </div>
                      </div>

                      {/* 属性标签 */}
                      <div className="flex flex-wrap gap-1 mb-2">
                        {node.platform && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40 font-bold">{node.platform}</span>
                        )}
                        {node.version && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-500 font-bold">v{node.version}</span>
                        )}
                        {node.mode && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">{node.mode}</span>
                        )}
                        {Array.isArray(node.roles) && node.roles.map(r => (
                          <span key={r} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold">{r}</span>
                        ))}
                      </div>

                      {/* 详情信息 */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                        {node.ip && (
                          <>
                            <span className="text-slate-400 dark:text-white/35">{nd.ip}</span>
                            <span className="text-slate-600 dark:text-white/60 font-mono">{node.ip}</span>
                          </>
                        )}
                        {node.lastInputSeconds != null && (
                          <>
                            <span className="text-slate-400 dark:text-white/35">{nd.lastUsed}</span>
                            <span className="text-slate-600 dark:text-white/60">{fmtAge(node.lastInputSeconds)} {nd.ago}</span>
                          </>
                        )}
                        {Array.isArray(node.scopes) && node.scopes.length > 0 && (
                          <>
                            <span className="text-slate-400 dark:text-white/35">{nd.scopes}</span>
                            <span className="text-slate-600 dark:text-white/60 truncate">{node.scopes.join(', ')}</span>
                          </>
                        )}
                      </div>

                      {/* 展开详情 */}
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
                              {/* Detail grid */}
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
                                {nodeDetail.displayName && (<><span className="text-slate-400 dark:text-white/35">{nd.displayName}</span><span className="text-slate-600 dark:text-white/60">{nodeDetail.displayName}</span></>)}
                                {nodeDetail.coreVersion && (<><span className="text-slate-400 dark:text-white/35">{nd.coreVersion}</span><span className="text-slate-600 dark:text-white/60 font-mono">{nodeDetail.coreVersion}</span></>)}
                                {nodeDetail.uiVersion && (<><span className="text-slate-400 dark:text-white/35">{nd.uiVersion}</span><span className="text-slate-600 dark:text-white/60 font-mono">{nodeDetail.uiVersion}</span></>)}
                                {nodeDetail.deviceFamily && (<><span className="text-slate-400 dark:text-white/35">{nd.deviceFamily}</span><span className="text-slate-600 dark:text-white/60">{nodeDetail.deviceFamily}</span></>)}
                                {nodeDetail.remoteIp && (<><span className="text-slate-400 dark:text-white/35">{nd.ip}</span><span className="text-slate-600 dark:text-white/60 font-mono">{nodeDetail.remoteIp}</span></>)}
                                {nodeDetail.connectedAtMs && (<><span className="text-slate-400 dark:text-white/35">{nd.connectedAt}</span><span className="text-slate-600 dark:text-white/60">{fmtTs(nodeDetail.connectedAtMs)}</span></>)}
                                <span className="text-slate-400 dark:text-white/35">{nd.paired}</span><span className={`font-bold ${nodeDetail.paired ? 'text-mac-green' : 'text-slate-400'}`}>{nodeDetail.paired ? '✓' : '✗'}</span>
                                <span className="text-slate-400 dark:text-white/35">{nd.online}</span><span className={`font-bold ${nodeDetail.connected ? 'text-mac-green' : 'text-slate-400'}`}>{nodeDetail.connected ? '✓' : '✗'}</span>
                              </div>

                              {/* Capabilities */}
                              <div>
                                <div className="text-[11px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-wider mb-1">{nd.capabilities}</div>
                                {Array.isArray(nodeDetail.caps) && nodeDetail.caps.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {nodeDetail.caps.map(c => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-mac-green/10 text-mac-green font-bold">{c}</span>)}
                                  </div>
                                ) : <p className="text-[10px] text-slate-400">-</p>}
                              </div>

                              {/* Commands */}
                              <div>
                                <div className="text-[11px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-wider mb-1">{nd.commands}</div>
                                {Array.isArray(nodeDetail.commands) && nodeDetail.commands.length > 0 ? (
                                  <div className="flex flex-wrap gap-1">
                                    {nodeDetail.commands.map(c => <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 font-bold font-mono">{c}</span>)}
                                  </div>
                                ) : <p className="text-[10px] text-slate-400">{nd.noCommands}</p>}
                              </div>

                              {/* Remote Invoke */}
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
              {omittedNodes > 0 && (
                <div className="text-center text-[10px] text-slate-400 dark:text-white/35">+{omittedNodes}</div>
              )}
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
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => setShowPairFlow(!showPairFlow)}
                    className={`h-8 px-3 flex items-center gap-1.5 border rounded-lg text-[11px] font-bold transition-all ${
                      showPairFlow 
                        ? 'bg-primary/10 border-primary/30 text-primary' 
                        : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-200 dark:hover:bg-white/10'
                    }`}>
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
                  <input value={pairNodeId} onChange={e => setPairNodeId(e.target.value)} placeholder={nd.pairNodeId}
                    className="w-full h-8 px-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-mono text-slate-700 dark:text-white/70 outline-none focus:border-primary/50" />
                  <input value={pairName} onChange={e => setPairName(e.target.value)} placeholder={nd.pairDisplayName}
                    className="w-full h-8 px-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] text-slate-700 dark:text-white/70 outline-none focus:border-primary/50" />
                  <button onClick={handlePairRequest} disabled={pairing || !pairNodeId.trim()}
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
                  <input value={verifyToken} onChange={e => setVerifyToken(e.target.value)} placeholder={nd.pairToken}
                    className="w-full h-8 px-2.5 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-mono text-slate-700 dark:text-white/70 outline-none focus:border-sky-500/50" />
                  <button onClick={handlePairVerify} disabled={verifying || !verifyNodeId.trim() || !verifyToken.trim()}
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

              {/* 待审批设备 */}
              {filteredPending.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-[16px] text-amber-500">pending_actions</span>
                    <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{nd.pending}</h3>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold">{filteredPending.length}</span>
                  </div>
                  <div className="space-y-2">
                    {renderedPending.map(req => (
                      <div key={req.requestId} className="bg-amber-50 dark:bg-amber-500/[0.04] border border-amber-200/50 dark:border-amber-500/10 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
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
                          <button onClick={() => handleReject(req.requestId)}
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

              {/* 已配对设备 */}
              {filteredPaired.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="material-symbols-outlined text-[16px] text-mac-green">verified</span>
                    <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase tracking-wider">{nd.paired}</h3>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-mac-green/15 text-mac-green font-bold">{filteredPaired.length}</span>
                  </div>
                  <div className="space-y-3">
                    {renderedPaired.map(device => {
                      const tokens = Array.isArray(device.tokens) ? device.tokens : [];
                      return (
                        <div key={device.deviceId} className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl p-3 sm:p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 rounded-xl bg-mac-green/10 flex items-center justify-center shrink-0">
                              <span className="material-symbols-outlined text-mac-green text-[20px]">devices</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-[12px] text-slate-800 dark:text-white truncate">{device.displayName?.trim() || truncateId(device.deviceId, 20)}</h4>
                              <p className="text-[10px] text-slate-400 dark:text-white/40 font-mono truncate flex items-center gap-1 group/pdid">
                                <span title={device.deviceId}>{truncateId(device.deviceId, 24)}</span>
                                <button onClick={() => copyToClipboard(device.deviceId)} className="opacity-0 group-hover/pdid:opacity-100 transition-opacity" title={nd.copyId}>
                                  <span className="material-symbols-outlined text-[12px] hover:text-primary">content_copy</span>
                                </button>
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1 mb-3">
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

                          {/* Tokens */}
                          {tokens.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-wider">{nd.tokens}</div>
                              {tokens.map((tk, ti) => {
                                const isRevoked = !!tk.revokedAtMs;
                                return (
                                  <div key={ti} className={`flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-lg ${isRevoked ? 'bg-slate-100/50 dark:bg-white/[0.01] opacity-50' : 'bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5'}`}>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isRevoked ? 'bg-mac-red/10 text-mac-red' : 'bg-mac-green/10 text-mac-green'}`}>
                                          {isRevoked ? nd.revoked : nd.active}
                                        </span>
                                        <span className="text-[10px] font-bold text-slate-700 dark:text-white/70">{tk.role}</span>
                                        {Array.isArray(tk.scopes) && tk.scopes.length > 0 && (
                                          <span className="text-[11px] text-slate-400 dark:text-white/35 truncate">{nd.scopes}: {tk.scopes.join(', ')}</span>
                                        )}
                                      </div>
                                      <div className="flex gap-3 mt-1 text-[11px] text-slate-400 dark:text-white/20">
                                        {tk.createdAtMs && <span>{nd.created} {fmtTs(tk.createdAtMs)}</span>}
                                        {tk.rotatedAtMs && <span>{nd.rotated} {fmtTs(tk.rotatedAtMs)}</span>}
                                        {tk.lastUsedAtMs && <span>{nd.lastUsed} {fmtTs(tk.lastUsedAtMs)}</span>}
                                      </div>
                                    </div>
                                    <div className="flex gap-1.5 shrink-0">
                                      <button onClick={() => handleRotate(device.deviceId, tk.role, tk.scopes)}
                                        className="h-7 px-2.5 bg-primary/10 text-primary text-[11px] font-bold rounded-lg hover:bg-primary/20 transition-colors flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[12px]">autorenew</span>{nd.rotate}
                                      </button>
                                      {!isRevoked && (
                                        <button onClick={() => handleRevoke(device.deviceId, tk.role)}
                                          className="h-7 px-2.5 bg-mac-red/10 text-mac-red text-[11px] font-bold rounded-lg hover:bg-mac-red/20 transition-colors flex items-center gap-1">
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
                      );
                    })}
                  </div>
                  {omittedPaired > 0 && (
                    <div className="text-center text-[10px] text-slate-400 dark:text-white/35 mt-2">+{omittedPaired}</div>
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
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-800 dark:text-white">{nd.bindingsSection}</h2>
                  <p className="text-[10px] text-slate-400 dark:text-white/40 mt-0.5">{nd.bindingsDesc}</p>
                </div>
                <div className="flex gap-2">
                  {!config && (
                    <button onClick={fetchConfig} disabled={configLoading}
                      className="h-8 px-3 flex items-center gap-1.5 bg-primary/10 text-primary text-[11px] font-bold rounded-lg disabled:opacity-50">
                      <span className={`material-symbols-outlined text-[14px] ${configLoading ? 'animate-spin' : ''}`}>{configLoading ? 'progress_activity' : 'download'}</span>
                      {nd.loadConfig}
                    </button>
                  )}
                  {config && (
                    <button onClick={handleSaveBindings} disabled={configSaving || !configDirty}
                      className="h-8 px-4 bg-primary text-white text-[11px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px]">{configSaving ? 'progress_activity' : 'save'}</span>
                      {configSaving ? nd.saving : nd.save}
                    </button>
                  )}
                </div>
              </div>

              {!config && !configLoading && (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                  <span className="material-symbols-outlined text-5xl mb-4 text-primary/20">link</span>
                  <span className="text-xs font-bold">{nd.loadConfig}</span>
                </div>
              )}

              {config && (
                <div className="space-y-3">
                  {/* 默认绑定 */}
                  <div className="bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-xl p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-sky-500 text-[20px]">settings_ethernet</span>
                        </div>
                        <div>
                          <h4 className="font-bold text-[12px] text-slate-800 dark:text-white">{nd.defaultBinding}</h4>
                          <p className="text-[10px] text-slate-400 dark:text-white/40">{nd.defaultBindingDesc}</p>
                        </div>
                      </div>
                      <CustomSelect value={defaultBinding} onChange={v => handleBindDefault(v)}
                        disabled={nodes.length === 0}
                        options={[{ value: '', label: nd.anyNode }, ...nodes.map(n => ({ value: n.id, label: n.host || n.id }))]}
                        className="h-8 px-3 bg-white dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-bold text-slate-700 dark:text-white/70 min-w-[160px]" />
                    </div>
                    {nodes.length === 0 && (
                      <p className="text-[10px] text-amber-500 mt-2 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">warning</span>{nd.noNodesAvailable}
                      </p>
                    )}
                  </div>

                  {/* 代理绑定 */}
                  {agentsList.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 dark:text-white/35 uppercase tracking-wider mb-2">{nd.agentBinding}</div>
                      <div className="space-y-2">
                        {agentsList.map(agent => (
                          <div key={agent.id} className="bg-white dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-indigo-500 text-[16px]">smart_toy</span>
                              </div>
                              <div className="min-w-0">
                                <h4 className="font-bold text-[11px] text-slate-800 dark:text-white truncate">
                                  {agent.name || agent.id}
                                  {agent.isDefault && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-bold">default</span>}
                                </h4>
                                <p className="text-[11px] text-slate-400 dark:text-white/35 font-mono">{agent.id}</p>
                              </div>
                            </div>
                            <CustomSelect value={agent.binding || ''} onChange={v => handleBindAgent(agent.index, v)}
                              disabled={nodes.length === 0}
                              options={[{ value: '', label: nd.anyNode }, ...nodes.map(n => ({ value: n.id, label: n.host || n.id }))]}
                              className="h-7 px-2 bg-slate-50 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-bold text-slate-700 dark:text-white/70 min-w-[140px]" />
                          </div>
                        ))}
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

      {/* 底部状态栏 */}
      <footer className="h-8 px-4 border-t border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/20 flex items-center justify-between shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-white/20">
        <div className="flex items-center gap-3">
          <span>{nodes.length} {nd.nodesSection}</span>
          <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
          <span>{pending.length} {nd.pending}</span>
          <span className="w-1 h-1 rounded-full bg-slate-200 dark:bg-white/10" />
          <span className="text-mac-green">{paired.length} {nd.paired}</span>
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
