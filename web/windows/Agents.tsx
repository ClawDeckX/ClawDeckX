
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Language } from '../types';
import { getTranslation } from '../locales';
import { gwApi } from '../services/api';
import { getTemplatesForFile, resolveTemplate, WorkspaceTemplate } from '../data/templates';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import CustomSelect from '../components/CustomSelect';

interface AgentsProps { language: Language; }
type Panel = 'overview' | 'files' | 'tools' | 'skills' | 'channels' | 'cron' | 'run';


function fmtBytes(b?: number) {
  if (b == null) return '-';
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB']; let s = b / 1024, i = 0;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(s < 10 ? 1 : 0)} ${u[i]}`;
}

function extractRunText(content: unknown): string {
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

const Agents: React.FC<AgentsProps> = ({ language }) => {
  const t = useMemo(() => getTranslation(language), [language]);
  const a = (t as any).agt as any;
  const na = (t as any).na || '-';
  const { toast } = useToast();
  const { confirm } = useConfirm();

  // WS connection (Manager's /api/v1/ws for agent chat streaming events)
  const wsRef = useRef<WebSocket | null>(null);
  const [gwReady, setGwReady] = useState(false);
  const [wsConnecting, setWsConnecting] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const runSessionRef = useRef<string | null>(null);

  // Run panel state
  const [runInput, setRunInput] = useState('');
  const [runSending, setRunSending] = useState(false);
  const [runStream, setRunStream] = useState<string | null>(null);
  const [runMessages, setRunMessages] = useState<Array<{ role: string; text: string; ts: number }>>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const runEndRef = useRef<HTMLDivElement>(null);
  const runTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Heartbeat event state
  const [lastHeartbeat, setLastHeartbeat] = useState<{ ts: number; status?: string } | null>(null);

  const [agentsList, setAgentsList] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('overview');
  const [loading, setLoading] = useState(false);
  const [identity, setIdentity] = useState<Record<string, any>>({});
  const [config, setConfig] = useState<any>(null);
  const [filesList, setFilesList] = useState<any>(null);
  const [fileActive, setFileActive] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [fileDrafts, setFileDrafts] = useState<Record<string, string>>({});
  const [fileSaving, setFileSaving] = useState(false);
  const [tplDropdown, setTplDropdown] = useState(false);
  const [skillsReport, setSkillsReport] = useState<any>(null);
  const [channelsSnap, setChannelsSnap] = useState<any>(null);
  const [cronStatus, setCronStatus] = useState<any>(null);
  const [cronJobs, setCronJobs] = useState<any[]>([]);

  // Check GW proxy connectivity + connect Manager WS for agent chat streaming events
  useEffect(() => {
    setWsConnecting(true);

    // 1) Check GW proxy is reachable via REST
    gwApi.status().then((res: any) => {
      if (res?.connected) setGwReady(true);
    }).catch(() => { });

    // 2) Connect to Manager's /api/v1/ws for real-time chat streaming events
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/v1/ws`);

    const connectTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) setWsConnecting(false);
    }, 12000);

    ws.onopen = () => {
      clearTimeout(connectTimeout);
      setGwReady(true);
      setWsConnecting(false);
      ws.send(JSON.stringify({ action: 'subscribe', channels: ['gw_event'] }));
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'chat') {
          const payload = msg.data;
          if (!payload) return;
          if (payload.sessionKey && payload.sessionKey !== runSessionRef.current) return;

          if (payload.state === 'delta') {
            const m = payload.message as any;
            const text = extractRunText(m?.content ?? m);
            if (text) setRunStream(text);
          } else if (payload.state === 'final') {
            const m = payload.message as any;
            if (m) {
              const text = extractRunText(m?.content ?? m);
              if (text) {
                setRunMessages(prev => [...prev, { role: m.role || 'assistant', text, ts: Date.now() }]);
              }
            }
            setRunStream(null);
            runIdRef.current = null;
          } else if (payload.state === 'aborted') {
            setRunStream(prev => {
              if (prev) {
                setRunMessages(msgs => [...msgs, { role: 'assistant', text: prev, ts: Date.now() }]);
              }
              return null;
            });
            runIdRef.current = null;
          } else if (payload.state === 'error') {
            setRunStream(null);
            runIdRef.current = null;
            setRunError(payload.errorMessage || a.runFailed);
          }
        } else if (msg.type === 'heartbeat') {
          setLastHeartbeat({ ts: Date.now(), status: msg.data?.status || 'running' });
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      clearTimeout(connectTimeout);
      setWsConnecting(false);
    };

    wsRef.current = ws;
    return () => {
      clearTimeout(connectTimeout);
      ws.close();
      wsRef.current = null;
    };
  }, []);

  // Auto-scroll run panel
  useEffect(() => {
    runEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [runMessages, runStream]);

  const agents: any[] = agentsList?.agents || [];
  const defaultId = agentsList?.defaultId || null;
  const selected = agents.find((ag: any) => ag.id === selectedId) || null;

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gwApi.agents();
      const result = Array.isArray(data) ? { agents: data, defaultId: null } : data;
      setAgentsList(result);
      const list = result?.agents || [];
      if (!selectedId || !list.some((ag: any) => ag.id === selectedId)) {
        setSelectedId(result?.defaultId || list[0]?.id || null);
      }
      for (const ag of list) {
        gwApi.agentIdentity(ag.id).then((id: any) => {
          setIdentity(prev => ({ ...prev, [ag.id]: id }));
        }).catch(() => { });
      }
    } catch { }
    setLoading(false);
  }, [selectedId]);

  const loadConfig = useCallback(() => {
    gwApi.configGet().then(setConfig).catch(() => { });
  }, []);

  useEffect(() => { loadAgents(); loadConfig(); }, []);

  const selectAgent = useCallback((id: string) => {
    setSelectedId(id);
    setDrawerOpen(false);
    setFilesList(null); setFileActive(null); setFileContents({}); setFileDrafts({});
    setSkillsReport(null);
  }, []);

  const selectPanel = useCallback((p: Panel) => {
    setPanel(p);
    if (p === 'files' && selectedId) {
      gwApi.agentFilesList(selectedId).then(setFilesList).catch(() => { });
    }
    if (p === 'skills' && selectedId) {
      gwApi.agentSkills(selectedId).then(setSkillsReport).catch(() => { });
    }
    if (p === 'channels') {
      gwApi.channels().then(setChannelsSnap).catch(() => { });
    }
    if (p === 'cron') {
      gwApi.cronStatus().then(setCronStatus).catch(() => { });
      gwApi.cron().then((d: any) => setCronJobs(Array.isArray(d) ? d : d?.jobs || [])).catch(() => { });
    }
  }, [selectedId]);

  const loadFile = useCallback(async (name: string) => {
    if (!selectedId) return;
    setFileActive(name);
    if (fileContents[name] != null) return;
    try {
      const res = await gwApi.agentFileGet(selectedId, name);
      const content = (res as any)?.file?.content || '';
      setFileContents(prev => ({ ...prev, [name]: content }));
      setFileDrafts(prev => ({ ...prev, [name]: content }));
    } catch (err: any) { toast('error', err?.message || a.fileLoadFailed); }
  }, [selectedId, fileContents]);

  const saveFile = useCallback(async () => {
    if (!selectedId || !fileActive) return;
    const confirmed = await confirm({
      title: a.confirmSave,
      message: (a.confirmSaveMsg || '').replace('{file}', fileActive),
      confirmText: a.save,
      cancelText: a.cancel,
    });
    if (!confirmed) return;
    setFileSaving(true);
    try {
      await gwApi.agentFileSet(selectedId, fileActive, fileDrafts[fileActive] || '');
      setFileContents(prev => ({ ...prev, [fileActive!]: fileDrafts[fileActive!] || '' }));
    } catch (err: any) { toast('error', err?.message || a.fileSaveFailed); }
    setFileSaving(false);
  }, [selectedId, fileActive, fileDrafts, a]);

  // CRUD state
  const [crudMode, setCrudMode] = useState<'create' | 'edit' | null>(null);
  const [crudName, setCrudName] = useState('');
  const [crudWorkspace, setCrudWorkspace] = useState('');
  const [crudModel, setCrudModel] = useState('');
  const [crudEmoji, setCrudEmoji] = useState('');
  const [crudBusy, setCrudBusy] = useState(false);
  const [crudError, setCrudError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(true);

  // Wake state
  const [waking, setWaking] = useState(false);
  const [wakeResult, setWakeResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Browser request state
  const [browserUrl, setBrowserUrl] = useState('');
  const [browserMethod, setBrowserMethod] = useState('GET');
  const [browserSending, setBrowserSending] = useState(false);
  const [browserResult, setBrowserResult] = useState<{ ok: boolean; text: string } | null>(null);

  const handleWake = useCallback(async (mode: 'now' | 'next-heartbeat') => {
    setWaking(true);
    setWakeResult(null);
    try {
      await gwApi.proxy('wake', { mode, text: a.wakeText });
      setWakeResult({ ok: true, text: a.wakeOk });
      setTimeout(() => setWakeResult(null), 3000);
    } catch (err: any) {
      setWakeResult({ ok: false, text: `${a.wakeFailed}: ${err?.message || ''}` });
    }
    setWaking(false);
  }, [a]);

  const handleBrowserRequest = useCallback(async () => {
    if (!browserUrl.trim() || browserSending) return;
    setBrowserSending(true);
    setBrowserResult(null);
    try {
      const res = await gwApi.proxy('browser.request', { method: browserMethod, path: browserUrl.trim() }) as any;
      setBrowserResult({ ok: true, text: `${a.browserOk}${res?.status ? ` (${res.status})` : ''}` });
    } catch (err: any) {
      setBrowserResult({ ok: false, text: `${a.browserFailed}: ${err?.message || ''}` });
    }
    setBrowserSending(false);
  }, [browserUrl, browserMethod, browserSending, a]);

  const openCreate = useCallback(() => {
    setCrudMode('create');
    setCrudName(''); setCrudWorkspace(''); setCrudModel(''); setCrudEmoji('');
    setCrudError(null);
  }, []);

  const openEdit = useCallback(() => {
    if (!selected) return;
    setCrudMode('edit');
    const cfg = resolveAgentConfig(selected.id);
    setCrudName(resolveLabel(selected));
    setCrudWorkspace(cfg.workspace);
    setCrudModel(cfg.model.replace(/ \(\+\d+\)$/, ''));
    setCrudEmoji(resolveEmoji(selected));
    setCrudError(null);
  }, [selected]);

  const handleCreate = useCallback(async () => {
    if (!gwReady || crudBusy) return;
    if (!crudName.trim()) return;
    setCrudBusy(true); setCrudError(null);
    try {
      await gwApi.proxy('agents.create', {
        name: crudName.trim(),
        workspace: crudWorkspace.trim() || undefined,
        emoji: crudEmoji.trim() || undefined,
      });
      setCrudMode(null);
      loadAgents();
    } catch (err: any) {
      setCrudError(a.createFailed + ': ' + (err?.message || ''));
    }
    setCrudBusy(false);
  }, [gwReady, crudName, crudWorkspace, crudEmoji, crudBusy, loadAgents, a.createFailed]);

  const handleUpdate = useCallback(async () => {
    if (!gwReady || crudBusy || !selectedId) return;
    setCrudBusy(true); setCrudError(null);
    try {
      await gwApi.proxy('agents.update', {
        agentId: selectedId,
        name: crudName.trim() || undefined,
        workspace: crudWorkspace.trim() || undefined,
        model: crudModel.trim() || undefined,
        avatar: crudEmoji.trim() || undefined,
      });
      setCrudMode(null);
      loadAgents();
    } catch (err: any) {
      setCrudError(a.updateFailed + ': ' + (err?.message || ''));
    }
    setCrudBusy(false);
  }, [gwReady, selectedId, crudName, crudWorkspace, crudModel, crudEmoji, crudBusy, loadAgents, a.updateFailed]);

  const handleDelete = useCallback(async () => {
    if (!gwReady || crudBusy || !selectedId) return;
    setCrudBusy(true); setCrudError(null);
    try {
      await gwApi.proxy('agents.delete', { agentId: selectedId, deleteFiles });
      setDeleteConfirm(false);
      setSelectedId(null);
      loadAgents();
    } catch (err: any) {
      setCrudError(a.deleteFailed + ': ' + (err?.message || ''));
    }
    setCrudBusy(false);
  }, [gwReady, selectedId, deleteFiles, crudBusy, loadAgents, a.deleteFailed]);

  const resolveLabel = (ag: any) => {
    const id = identity[ag.id];
    return id?.name?.trim() || ag.identity?.name?.trim() || ag.name?.trim() || ag.id;
  };
  const resolveEmoji = (ag: any) => {
    const id = identity[ag.id];
    return id?.emoji?.trim() || ag.identity?.emoji?.trim() || id?.avatar?.trim() || ag.identity?.avatar?.trim() || '';
  };

  const resolveAgentConfig = (agentId: string) => {
    if (!config) return { model: na, workspace: a.workspaceDefault, skills: null, tools: null };
    const list = config?.agents?.list || [];
    const entry = list.find((e: any) => e?.id === agentId);
    const defaults = config?.agents?.defaults;
    const model = entry?.model || defaults?.model;
    const modelLabel = typeof model === 'string' ? model : (model?.primary || na);
    const fallbacks = typeof model === 'object' ? model?.fallbacks : null;
    return {
      model: modelLabel + (Array.isArray(fallbacks) && fallbacks.length > 0 ? ` (+${fallbacks.length})` : ''),
      workspace: entry?.workspace || defaults?.workspace || a.workspaceDefault,
      skills: entry?.skills || null,
      tools: entry?.tools || config?.tools || null,
    };
  };

  // Send message to agent via REST proxy (streaming events come via Manager WS)
  const sendToAgent = useCallback(async () => {
    if (!gwReady || runSending || !selectedId) return;
    const msg = runInput.trim();
    if (!msg) return;

    const sessionKey = `agent-run-${selectedId}-${Date.now()}`;
    runSessionRef.current = sessionKey;

    setRunMessages(prev => [...prev, { role: 'user', text: msg, ts: Date.now() }]);
    setRunInput('');
    setRunSending(true);
    setRunError(null);
    setRunStream('');

    try {
      const idempotencyKey = `${sessionKey}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await gwApi.proxy('agent', {
        message: msg,
        agentId: selectedId,
        sessionKey,
        idempotencyKey,
      }) as any;
      runIdRef.current = res?.runId || sessionKey;
    } catch (err: any) {
      setRunStream(null);
      setRunError(err?.message || a.runFailed);
    } finally {
      setRunSending(false);
    }
  }, [gwReady, runInput, runSending, selectedId, a.runFailed]);

  const handleRunAbort = useCallback(async () => {
    if (!gwReady) return;
    try {
      await gwApi.proxy('chat.abort', { sessionKey: runSessionRef.current, runId: runIdRef.current || undefined });
    } catch { /* ignore */ }
  }, [gwReady]);

  const handleRunKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendToAgent();
    }
  }, [sendToAgent]);

  const handleRunInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setRunInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  const isRunStreaming = runIdRef.current !== null || runStream !== null;

  const TABS: { id: Panel; icon: string; label: string }[] = [
    { id: 'overview', icon: 'dashboard', label: a.overview },
    { id: 'files', icon: 'description', label: a.files },
    { id: 'tools', icon: 'build', label: a.tools },
    { id: 'skills', icon: 'extension', label: a.skills },
    { id: 'channels', icon: 'forum', label: a.channels },
    { id: 'cron', icon: 'schedule', label: a.cron },
    { id: 'run', icon: 'play_arrow', label: a.run },
  ];

  const TOOL_SECTIONS = [
    { label: 'Files', tools: ['read', 'write', 'edit', 'apply_patch'] },
    { label: 'Runtime', tools: ['exec', 'process'] },
    { label: 'Web', tools: ['web_search', 'web_fetch'] },
    { label: 'Memory', tools: ['memory_search', 'memory_get'] },
    { label: 'Sessions', tools: ['sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn', 'session_status'] },
    { label: 'UI', tools: ['browser', 'canvas'] },
    { label: 'Messaging', tools: ['message'] },
    { label: 'Automation', tools: ['cron', 'gateway'] },
    { label: 'Agents', tools: ['agents_list'] },
    { label: 'Media', tools: ['image'] },
  ];

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-50/50 dark:bg-transparent">
      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="md:hidden fixed top-[32px] bottom-[72px] left-0 right-0 z-40 bg-black/40 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Sidebar — desktop: static, mobile: slide-out drawer */}
      <div className={`fixed md:static top-[32px] bottom-[72px] md:top-auto md:bottom-auto left-0 z-50 w-64 md:w-56 lg:w-64 shrink-0 border-r border-slate-200/60 dark:border-white/[0.06] bg-white dark:bg-[#1a1c22] md:dark:bg-white/[0.02] flex flex-col transform transition-transform duration-200 ease-out ${drawerOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-3 border-b border-slate-200/60 dark:border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-bold text-slate-700 dark:text-white/80">{a.title}</h2>
              <p className="text-[11px] text-slate-400 dark:text-white/35">{agents.length} {(t as any).menu?.agents}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={openCreate} disabled={!gwReady}
                className="p-1 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-30"
                title={a.createAgent}>
                <span className="material-symbols-outlined text-[16px]">add</span>
              </button>
              <button onClick={loadAgents} disabled={loading} className="p-1 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40">
                <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
          {agents.length === 0 ? (
            <p className="text-[10px] text-slate-400 dark:text-white/20 text-center py-8">{a.noAgents}</p>
          ) : agents.map((ag: any) => {
            const emoji = resolveEmoji(ag);
            const label = resolveLabel(ag);
            const isDefault = ag.id === defaultId;
            const isSelected = ag.id === selectedId;
            return (
              <button key={ag.id} onClick={() => selectAgent(ag.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${isSelected ? 'bg-primary/10 border border-primary/20' : 'hover:bg-slate-100 dark:hover:bg-white/[0.03] border border-transparent'}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${isSelected ? 'bg-primary/20 text-primary' : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/40'}`}>
                  {emoji || label.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] font-semibold truncate ${isSelected ? 'text-primary' : 'text-slate-700 dark:text-white/70'}`}>{label}</p>
                  <p className="text-[11px] text-slate-400 dark:text-white/35 font-mono truncate">{ag.id}</p>
                </div>
                {isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold shrink-0">default</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Mobile hamburger for empty state */}
            <div className="md:hidden flex items-center px-4 pt-3 pb-1 shrink-0">
              <button onClick={() => setDrawerOpen(true)} className="p-1.5 -ml-1 rounded-lg text-slate-500 dark:text-white/50 hover:text-primary hover:bg-primary/5 transition-all">
                <span className="material-symbols-outlined text-[20px]">menu</span>
              </button>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-slate-400 dark:text-white/20">
                <span className="material-symbols-outlined text-4xl mb-2">smart_toy</span>
                <p className="text-sm">{a.selectAgent}</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Agent Header */}
            <div className="shrink-0 px-4 md:px-5 pt-3 md:pt-4 pb-0">
              <div className="flex items-center gap-3">
                {/* Hamburger menu — mobile only */}
                <button onClick={() => setDrawerOpen(true)} className="md:hidden p-1.5 -ml-1 rounded-lg text-slate-500 dark:text-white/50 hover:text-primary hover:bg-primary/5 transition-all shrink-0">
                  <span className="material-symbols-outlined text-[20px]">menu</span>
                </button>
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-lg font-bold text-primary shrink-0">
                  {resolveEmoji(selected) || resolveLabel(selected).slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-bold text-slate-800 dark:text-white truncate">{resolveLabel(selected)}</h2>
                    {selected.id === defaultId && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold">{(t as any).default}</span>}
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-white/40 font-mono">{selected.id}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <div className="relative group/wake">
                    <button disabled={!gwReady || waking}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-500/5 transition-all disabled:opacity-30"
                      title={a.wake}>
                      <span className={`material-symbols-outlined text-[16px] ${waking ? 'animate-spin' : ''}`}>{waking ? 'progress_activity' : 'alarm'}</span>
                    </button>
                    <div className="absolute right-0 top-full mt-1 hidden group-hover/wake:block z-30">
                      <div className="bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 rounded-xl shadow-xl p-1 min-w-[140px]">
                        <button onClick={() => handleWake('now')}
                          className="w-full text-left px-3 py-1.5 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 hover:bg-amber-500/10 hover:text-amber-600 transition-colors">
                          {a.wakeNow}
                        </button>
                        <button onClick={() => handleWake('next-heartbeat')}
                          className="w-full text-left px-3 py-1.5 rounded-lg text-[10px] font-bold text-slate-600 dark:text-white/60 hover:bg-amber-500/10 hover:text-amber-600 transition-colors">
                          {a.wakeNext}
                        </button>
                      </div>
                    </div>
                  </div>
                  <button onClick={openEdit} disabled={!gwReady}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-30"
                    title={a.edit}>
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                  {selected.id !== defaultId && (
                    <button onClick={() => setDeleteConfirm(true)} disabled={!gwReady}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-mac-red hover:bg-mac-red/5 transition-all disabled:opacity-30"
                      title={a.delete}>
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  )}
                </div>
                {wakeResult && (
                  <div className={`absolute top-14 right-4 px-3 py-1.5 rounded-xl text-[10px] font-bold z-30 shadow-lg ${wakeResult.ok ? 'bg-mac-green/10 text-mac-green border border-mac-green/20' : 'bg-red-50 dark:bg-red-500/5 text-red-500 border border-red-200 dark:border-red-500/20'}`}>
                    {wakeResult.text}
                  </div>
                )}
              </div>

              {/* Tabs — horizontally scrollable on mobile */}
              <div className="flex gap-0.5 mt-3 border-b border-slate-200/60 dark:border-white/[0.06] overflow-x-auto no-scrollbar">
                {TABS.map(tab => (
                  <button key={tab.id} onClick={() => selectPanel(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2 transition-all whitespace-nowrap shrink-0 ${panel === tab.id ? 'border-primary text-primary' : 'border-transparent text-slate-500 dark:text-white/40 hover:text-slate-700 dark:hover:text-white/60'}`}>
                    <span className="material-symbols-outlined text-[14px]">{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Panel Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-5">
              {/* Overview Panel */}
              {panel === 'overview' && (() => {
                const cfg = resolveAgentConfig(selected.id);
                const ident = identity[selected.id];
                return (
                  <div className="space-y-4 max-w-3xl">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: a.workspace, value: cfg.workspace, icon: 'folder' },
                        { label: a.model, value: cfg.model, icon: 'smart_toy' },
                        { label: a.identity, value: ident?.name || selected.identity?.name || na, icon: 'person' },
                        { label: a.emoji, value: resolveEmoji(selected) || na, icon: 'mood' },
                        { label: a.isDefault, value: selected.id === defaultId ? a.yes : a.no, icon: 'star' },
                        { label: a.skills, value: cfg.skills ? `${cfg.skills.length} selected` : (t as any).menu?.all, icon: 'extension' },
                      ].map(kv => (
                        <div key={kv.label} className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="material-symbols-outlined text-[13px] text-slate-400 dark:text-white/40">{kv.icon}</span>
                            <span className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase">{kv.label}</span>
                          </div>
                          <p className="text-[11px] font-semibold text-slate-700 dark:text-white/70 font-mono truncate">{kv.value}</p>
                        </div>
                      ))}
                    </div>
                    {selected.identity?.theme && (
                      <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3">
                        <p className="text-[11px] font-bold text-slate-400 dark:text-white/40 uppercase mb-1">{a.theme}</p>
                        <p className="text-[11px] text-slate-600 dark:text-white/50">{selected.identity.theme}</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Files Panel */}
              {panel === 'files' && (
                <div className="flex gap-4 max-w-4xl" style={{ minHeight: 300 }}>
                  <div className="w-48 shrink-0 space-y-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase">{a.coreFiles}</span>
                      <button onClick={() => selectedId && gwApi.agentFilesList(selectedId).then(setFilesList).catch(() => { })} className="text-[10px] text-primary hover:underline">{a.refresh}</button>
                    </div>
                    {(filesList?.files || []).length === 0 ? (
                      <p className="text-[10px] text-slate-400 dark:text-white/20 py-4 text-center">{a.noFiles}</p>
                    ) : (filesList?.files || []).map((f: any) => (
                      <button key={f.name} onClick={() => loadFile(f.name)}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-[10px] transition-all ${fileActive === f.name ? 'bg-primary/10 text-primary border border-primary/20' : 'hover:bg-slate-100 dark:hover:bg-white/[0.03] border border-transparent'}`}>
                        <p className="font-mono font-semibold truncate">{f.name}</p>
                        <p className="text-[11px] text-slate-400 dark:text-white/35 mt-0.5">
                          {f.missing ? <span className="text-mac-yellow">{a.fileMissing}</span> : fmtBytes(f.size)}
                        </p>
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    {!fileActive ? (
                      <div className="flex items-center justify-center h-full text-slate-400 dark:text-white/20 text-[11px]">{a.selectFile}</div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-mono font-bold text-slate-600 dark:text-white/60">{fileActive}</span>
                          <div className="flex gap-2">
                            {/* Template insert dropdown */}
                            {fileActive && getTemplatesForFile(fileActive).length > 0 && (
                              <div className="relative">
                                <button onClick={() => setTplDropdown(!tplDropdown)}
                                  className="text-[10px] px-2 py-1 rounded-lg border border-primary/30 text-primary hover:bg-primary/5 font-bold transition-colors flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[12px]">auto_fix_high</span>
                                  {a.insertTemplate}
                                </button>
                                {tplDropdown && (
                                  <div className="absolute right-0 top-full mt-1 z-30 bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 rounded-xl shadow-xl p-1 min-w-[200px]">
                                    {getTemplatesForFile(fileActive).map((tpl: WorkspaceTemplate) => {
                                      const resolved = resolveTemplate(tpl, language);
                                      return (
                                        <button key={tpl.id} onClick={() => {
                                          setFileDrafts(prev => ({ ...prev, [fileActive!]: resolved.content }));
                                          setTplDropdown(false);
                                        }}
                                          className="w-full text-left px-3 py-2 rounded-lg text-[10px] hover:bg-primary/5 transition-colors flex items-center gap-2">
                                          <span className="material-symbols-outlined text-[14px] text-primary">{tpl.icon}</span>
                                          <div className="min-w-0">
                                            <p className="font-bold text-slate-700 dark:text-white/70">{resolved.name}</p>
                                            <p className="text-[11px] text-slate-400 dark:text-white/35 truncate">{resolved.desc}</p>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                            <button onClick={() => { if (fileActive) setFileDrafts(prev => ({ ...prev, [fileActive]: fileContents[fileActive] || '' })); }}
                              disabled={!fileActive || fileDrafts[fileActive] === fileContents[fileActive]}
                              className="text-[10px] px-2 py-1 rounded-lg bg-slate-100 dark:bg-white/5 text-slate-500 disabled:opacity-30">{a.reset}</button>
                            <button onClick={saveFile} disabled={fileSaving || !fileActive || fileDrafts[fileActive] === fileContents[fileActive]}
                              className="text-[10px] px-3 py-1 rounded-lg bg-primary text-white font-bold disabled:opacity-30">{fileSaving ? a.saving : a.save}</button>
                          </div>
                        </div>
                        <textarea
                          value={fileDrafts[fileActive] ?? fileContents[fileActive] ?? ''}
                          onChange={e => setFileDrafts(prev => ({ ...prev, [fileActive!]: e.target.value }))}
                          className="w-full h-80 p-3 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] text-[11px] font-mono text-slate-700 dark:text-white/70 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
                          spellCheck={false}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tools Panel */}
              {panel === 'tools' && (() => {
                const cfg = resolveAgentConfig(selected.id);
                const tools = cfg.tools || {};
                const profile = tools.profile || 'full';
                return (
                  <div className="space-y-4 max-w-3xl">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase">{a.toolAccess}</h3>
                        <p className="text-[11px] text-slate-400 dark:text-white/35 mt-0.5">{a.profile}: <span className="font-mono text-primary">{profile}</span></p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {TOOL_SECTIONS.map(section => (
                        <div key={section.label} className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-3">
                          <p className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase mb-2">{section.label}</p>
                          <div className="space-y-1">
                            {section.tools.map(tool => {
                              const denied = Array.isArray(tools.deny) && tools.deny.includes(tool);
                              const allowed = !denied;
                              return (
                                <div key={tool} className="flex items-center justify-between py-1">
                                  <span className="text-[10px] font-mono text-slate-600 dark:text-white/50">{tool}</span>
                                  <div className={`w-2 h-2 rounded-full ${allowed ? 'bg-mac-green' : 'bg-slate-300 dark:bg-white/10'}`} />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Skills Panel */}
              {panel === 'skills' && (() => {
                const skills: any[] = skillsReport?.skills || [];
                const groups: Record<string, any[]> = {};
                skills.forEach((sk: any) => {
                  const src = sk.bundled ? a.sourceBuiltIn : (sk.source || a.sourceOther);
                  if (!groups[src]) groups[src] = [];
                  groups[src].push(sk);
                });
                return (
                  <div className="space-y-4 max-w-3xl">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase">{a.skills}</h3>
                      <button onClick={() => selectedId && gwApi.agentSkills(selectedId).then(setSkillsReport).catch(() => { })}
                        className="text-[10px] text-primary hover:underline">{a.refresh}</button>
                    </div>
                    {skills.length === 0 ? (
                      <p className="text-[10px] text-slate-400 dark:text-white/20 py-8 text-center">{a.loading}</p>
                    ) : Object.entries(groups).map(([group, items]) => (
                      <div key={group}>
                        <p className="text-[11px] font-bold text-slate-400 dark:text-white/35 uppercase mb-2">{group} ({items.length})</p>
                        <div className="space-y-1">
                          {items.map((sk: any) => (
                            <div key={sk.name} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06]">
                              <div className={`w-2 h-2 rounded-full shrink-0 ${sk.eligible ? 'bg-mac-green' : 'bg-slate-300 dark:bg-white/10'}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-semibold text-slate-700 dark:text-white/60 truncate">{sk.name}</p>
                                {sk.description && <p className="text-[11px] text-slate-400 dark:text-white/35 truncate">{sk.description}</p>}
                              </div>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${sk.eligible ? 'bg-mac-green/10 text-mac-green' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                                {sk.eligible ? a.eligible : a.notEligible}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Channels Panel */}
              {panel === 'channels' && (() => {
                const raw = channelsSnap?.channels ?? channelsSnap?.list ?? channelsSnap;
                const channels: any[] = Array.isArray(raw) ? raw : [];
                return (
                  <div className="space-y-4 max-w-3xl">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase">{a.channels}</h3>
                      <button onClick={() => gwApi.channels().then(setChannelsSnap).catch(() => { })}
                        className="text-[10px] text-primary hover:underline">{a.refresh}</button>
                    </div>
                    {channels.length === 0 ? (
                      <p className="text-[10px] text-slate-400 dark:text-white/20 py-8 text-center">{a.loading}</p>
                    ) : (
                      <div className="space-y-2">
                        {channels.map((ch: any, i: number) => {
                          const id = ch.id || ch.name || `ch-${i}`;
                          const label = ch.label || ch.name || id;
                          const isConn = ch.connected || ch.running || ch.status === 'connected';
                          return (
                            <div key={id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06]">
                              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isConn ? 'bg-mac-green animate-pulse' : 'bg-slate-300 dark:bg-white/10'}`} />
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-semibold text-slate-700 dark:text-white/60">{label}</p>
                                <p className="text-[11px] text-slate-400 dark:text-white/35 font-mono">{id}</p>
                              </div>
                              <span className={`text-[11px] font-bold ${isConn ? 'text-mac-green' : 'text-slate-400'}`}>{isConn ? a.connected : a.disabled}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Run Panel */}
              {panel === 'run' && (
                <div className="flex flex-col max-w-3xl" style={{ minHeight: 400 }}>
                  {!gwReady ? (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-white/20">
                      <span className="material-symbols-outlined text-3xl mb-2">{wsConnecting ? 'progress_activity' : 'cloud_off'}</span>
                      <p className="text-[11px]">{wsConnecting ? a.wsConnecting : a.wsError}</p>
                      {!wsConnecting && <p className="text-[11px] mt-1">{a.configMissing}</p>}
                    </div>
                  ) : (
                    <>
                      {/* Messages */}
                      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 mb-4" style={{ maxHeight: 400 }}>
                        {runMessages.length === 0 && !runStream && (
                          <div className="flex flex-col items-center py-12 text-slate-400 dark:text-white/20">
                            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                              <span className="material-symbols-outlined text-[24px] text-primary">play_arrow</span>
                            </div>
                            <p className="text-[11px] font-medium text-slate-500 dark:text-white/40">{a.runAgent}</p>
                            <p className="text-[11px] mt-1">{a.runPrompt}</p>
                          </div>
                        )}

                        {runMessages.map((msg, idx) => {
                          const isUser = msg.role === 'user';
                          return (
                            <div key={idx} className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
                              <div className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center border mt-0.5 ${isUser
                                  ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-black border-slate-700 dark:border-slate-300'
                                  : 'bg-primary/10 border-primary/20 text-primary'
                                }`}>
                                <span className="material-symbols-outlined text-[14px]">
                                  {isUser ? 'person' : 'smart_toy'}
                                </span>
                              </div>
                              <div className={`max-w-[80%] ${isUser ? 'text-right' : ''}`}>
                                <div className={`p-3 rounded-2xl shadow-sm border ${isUser
                                    ? 'bg-primary text-white border-primary/30 rounded-tr-sm'
                                    : 'bg-white dark:bg-white/[0.03] text-slate-800 dark:text-slate-200 border-slate-200 dark:border-white/[0.06] rounded-tl-sm'
                                  }`}>
                                  <div className="text-[12px] leading-relaxed whitespace-pre-wrap break-words">{msg.text}</div>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Streaming */}
                        {runStream !== null && (
                          <div className="flex items-start gap-2.5">
                            <div className="w-7 h-7 shrink-0 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mt-0.5">
                              <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                            </div>
                            <div className="max-w-[80%]">
                              <div className="p-3 rounded-2xl rounded-tl-sm shadow-sm border bg-white dark:bg-white/[0.03] border-slate-200 dark:border-white/[0.06]">
                                {runStream ? (
                                  <div className="text-[12px] leading-relaxed whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">
                                    {runStream}
                                    <span className="inline-block w-0.5 h-4 bg-primary animate-pulse ml-0.5 align-text-bottom" />
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 text-slate-400">
                                    <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                    <span className="text-[10px]">{a.running}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {runError && (
                          <div className="flex justify-center">
                            <div className="px-3 py-2 rounded-xl bg-mac-red/10 border border-mac-red/20 text-[10px] text-mac-red font-medium flex items-center gap-2">
                              <span className="material-symbols-outlined text-[14px]">error</span>
                              {runError}
                            </div>
                          </div>
                        )}

                        <div ref={runEndRef} />
                      </div>

                      {/* Input */}
                      <div className="shrink-0 mt-auto">
                        <div className="relative flex items-end gap-1.5 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-2xl p-1.5 shadow-lg shadow-black/5 dark:shadow-black/20 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                          <textarea
                            ref={runTextareaRef}
                            rows={1}
                            className="flex-1 bg-transparent border-none text-[12px] text-slate-800 dark:text-white py-2 px-2 focus:ring-0 outline-none resize-none max-h-28 placeholder:text-slate-400 dark:placeholder:text-white/25"
                            placeholder={a.runPrompt}
                            value={runInput}
                            onChange={handleRunInputChange}
                            onKeyDown={handleRunKeyDown}
                            disabled={!gwReady}
                          />
                          {isRunStreaming ? (
                            <button onClick={handleRunAbort}
                              className="w-8 h-8 rounded-full bg-mac-red text-white flex items-center justify-center shrink-0 shadow-lg transition-all hover:bg-red-600 active:scale-95">
                              <span className="material-symbols-outlined text-[16px]">stop</span>
                            </button>
                          ) : (
                            <button onClick={sendToAgent}
                              disabled={!runInput.trim() || runSending || !gwReady}
                              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-95 ${runInput.trim() && !runSending && gwReady
                                  ? 'bg-primary text-white shadow-lg shadow-primary/30'
                                  : 'bg-slate-100 dark:bg-white/5 text-slate-400'
                                }`}>
                              <span className="material-symbols-outlined text-[16px]">
                                {runSending ? 'progress_activity' : 'arrow_upward'}
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Browser Request Panel */}
              {panel === 'tools' && (
                <div className="mt-6 max-w-3xl">
                  <div className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06] p-4 space-y-3">
                    <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[14px] text-primary">language</span>
                      {a.browserReq}
                    </h3>
                    <div className="flex gap-2">
                      <CustomSelect value={browserMethod} onChange={v => setBrowserMethod(v)}
                        options={['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].map(m => ({ value: m, label: m }))}
                        className="h-8 px-2 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-mono text-slate-700 dark:text-white/70" />
                      <input value={browserUrl} onChange={e => setBrowserUrl(e.target.value)}
                        placeholder={a.browserUrl || '/api/...'}
                        className="flex-1 h-8 px-3 bg-white dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg text-[10px] font-mono text-slate-700 dark:text-white/70 outline-none" />
                      <button onClick={handleBrowserRequest} disabled={browserSending || !browserUrl.trim() || !gwReady}
                        className="h-8 px-3 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">{browserSending ? 'progress_activity' : 'send'}</span>
                        {browserSending ? a.browserSending : a.browserSend}
                      </button>
                    </div>
                    {browserResult && (
                      <div className={`px-2 py-1.5 rounded-lg text-[10px] ${browserResult.ok ? 'bg-mac-green/10 text-mac-green' : 'bg-red-50 dark:bg-red-500/5 text-red-500'}`}>
                        {browserResult.text}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Cron Panel */}
              {panel === 'cron' && (() => {
                const jobs = cronJobs.filter((j: any) => j.agentId === selected.id || !j.agentId);
                return (
                  <div className="space-y-4 max-w-3xl">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-[11px] font-bold text-slate-600 dark:text-white/60 uppercase">{a.cron}</h3>
                        {cronStatus && (
                          <p className="text-[11px] text-slate-400 dark:text-white/35 mt-0.5">
                            {cronStatus.enabled ? a.enabled : a.disabled} · {cronStatus.jobs ?? 0} jobs
                          </p>
                        )}
                      </div>
                      <button onClick={() => { gwApi.cronStatus().then(setCronStatus).catch(() => { }); gwApi.cron().then((d: any) => setCronJobs(Array.isArray(d) ? d : d?.jobs || [])).catch(() => { }); }}
                        className="text-[10px] text-primary hover:underline">{a.refresh}</button>
                    </div>
                    {jobs.length === 0 ? (
                      <p className="text-[10px] text-slate-400 dark:text-white/20 py-8 text-center">{a.noJobs}</p>
                    ) : (
                      <div className="space-y-2">
                        {jobs.map((job: any, i: number) => (
                          <div key={job.name || i} className="px-3 py-2.5 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/60 dark:border-white/[0.06]">
                            <div className="flex items-center justify-between">
                              <p className="text-[11px] font-semibold text-slate-700 dark:text-white/60">{job.name}</p>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${job.enabled ? 'bg-mac-green/10 text-mac-green' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                                {job.enabled ? a.enabled : a.disabled}
                              </span>
                            </div>
                            {job.description && <p className="text-[11px] text-slate-400 dark:text-white/35 mt-0.5">{job.description}</p>}
                            <div className="flex gap-3 mt-1.5 text-[11px] text-slate-400 dark:text-white/35 font-mono">
                              {job.schedule && <span>{a.schedule}: {job.schedule}</span>}
                              {job.cronExpression && <span>{job.cronExpression}</span>}
                              {job.sessionTarget && <span>→ {job.sessionTarget}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {/* Create/Edit Modal */}
      {crudMode && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl p-5">
            <h3 className="text-sm font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">{crudMode === 'create' ? 'add_circle' : 'edit'}</span>
              {crudMode === 'create' ? a.createAgent : a.editAgent}
            </h3>

            {crudError && (
              <div className="mb-3 px-3 py-2 rounded-xl bg-mac-red/10 border border-mac-red/20 text-[10px] text-mac-red">{crudError}</div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">{a.agentName}</label>
                <input value={crudName} onChange={e => setCrudName(e.target.value)}
                  placeholder={a.agentNameHint}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] text-slate-800 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  disabled={crudBusy} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">{a.workspacePath}</label>
                <input value={crudWorkspace} onChange={e => setCrudWorkspace(e.target.value)}
                  placeholder={a.workspaceHint}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] font-mono text-slate-800 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  disabled={crudBusy} />
              </div>
              {crudMode === 'edit' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">{a.model}</label>
                  <input value={crudModel} onChange={e => setCrudModel(e.target.value)}
                    placeholder={a.modelHint}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] font-mono text-slate-800 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                    disabled={crudBusy} />
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-slate-500 dark:text-white/40 uppercase block mb-1">{a.emoji}</label>
                <input value={crudEmoji} onChange={e => setCrudEmoji(e.target.value)}
                  placeholder={a.emojiHint}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 text-[12px] text-slate-800 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  disabled={crudBusy} />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setCrudMode(null)} disabled={crudBusy}
                className="px-4 py-2 rounded-xl text-[11px] font-bold text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">{a.cancel}</button>
              <button onClick={crudMode === 'create' ? handleCreate : handleUpdate} disabled={crudBusy || !crudName.trim()}
                className="px-4 py-2 rounded-xl bg-primary text-white text-[11px] font-bold disabled:opacity-40 transition-all">
                {crudBusy ? (crudMode === 'create' ? a.creating : a.updating) : (crudMode === 'create' ? a.create : a.save)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 rounded-2xl bg-white dark:bg-[#1a1a2e] border border-slate-200 dark:border-white/10 shadow-2xl p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-mac-red/10 flex items-center justify-center">
                <span className="material-symbols-outlined text-[20px] text-mac-red">delete_forever</span>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-white">{a.deleteAgent}</h3>
                <p className="text-[10px] text-slate-400 dark:text-white/40 font-mono">{selectedId}</p>
              </div>
            </div>

            <p className="text-[11px] text-slate-600 dark:text-white/50 mb-3">{a.confirmDelete}</p>

            {crudError && (
              <div className="mb-3 px-3 py-2 rounded-xl bg-mac-red/10 border border-mac-red/20 text-[10px] text-mac-red">{crudError}</div>
            )}

            <label className="flex items-center gap-2 mb-4">
              <input type="checkbox" checked={deleteFiles} onChange={e => setDeleteFiles(e.target.checked)} className="accent-mac-red" />
              <span className="text-[10px] text-slate-500 dark:text-white/40">{a.deleteFiles}</span>
            </label>

            <div className="flex justify-end gap-2">
              <button onClick={() => { setDeleteConfirm(false); setCrudError(null); }} disabled={crudBusy}
                className="px-4 py-2 rounded-xl text-[11px] font-bold text-slate-500 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/5 transition-all">{a.cancel}</button>
              <button onClick={handleDelete} disabled={crudBusy}
                className="px-4 py-2 rounded-xl bg-mac-red text-white text-[11px] font-bold disabled:opacity-40 transition-all">
                {crudBusy ? a.deleting : a.delete}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Agents;
