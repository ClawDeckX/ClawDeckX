import React from 'react';
import CustomSelect from '../../components/CustomSelect';

const RPC_PRESETS = [
  'system-presence', 'sessions.list', 'sessions.preview', 'sessions.describe', 'sessions.cleanup',
  'config.get', 'config.channels', 'health', 'status', 'channels.status', 'channels.stop',
  'tasks.list', 'tasks.get', 'cron.get', 'gateway.restart.preflight',
];

export interface DebugPanelProps {
  gw: any;
  rpcMethod: string;
  setRpcMethod: (v: string) => void;
  rpcParams: string;
  setRpcParams: (v: string) => void;
  rpcResult: string | null;
  rpcError: string | null;
  rpcLoading: boolean;
  rpcHistory: string[];
  handleRpcCall: () => void;
  sysEventText: string;
  setSysEventText: (v: string) => void;
  sysEventSending: boolean;
  sysEventResult: { ok: boolean; text: string } | null;
  handleSendSystemEvent: () => void;
  debugStatus: any;
  debugHealth: any;
  debugLoading: boolean;
  fetchDebugData: () => void;
}

const DebugPanel: React.FC<DebugPanelProps> = ({
  gw,
  rpcMethod, setRpcMethod, rpcParams, setRpcParams,
  rpcResult, rpcError, rpcLoading, rpcHistory, handleRpcCall,
  sysEventText, setSysEventText, sysEventSending, sysEventResult, handleSendSystemEvent,
  debugStatus, debugHealth, debugLoading, fetchDebugData,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-5 custom-scrollbar neon-scrollbar space-y-4">
      {/* System Event */}
      <div className="rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-white/5 flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-indigo-400">campaign</span>
          <h3 className="text-[11px] font-bold text-slate-700 dark:text-white/80 uppercase tracking-wider">{gw.systemEvent}</h3>
        </div>
        <div className="p-4 space-y-2">
          <p className="text-[10px] text-slate-400 dark:text-white/30">{gw.systemEventDesc}</p>
          <div className="flex gap-2">
            <input value={sysEventText} onChange={e => setSysEventText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSendSystemEvent(); }}
              placeholder={gw.systemEventPlaceholder}
              className="flex-1 h-8 px-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-lg text-[11px] text-slate-700 dark:text-white/80 placeholder:text-slate-300 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary/50 outline-none" />
            <button onClick={handleSendSystemEvent} disabled={sysEventSending || !sysEventText.trim()}
              className="h-8 px-3 bg-primary text-white text-[10px] font-bold rounded-lg disabled:opacity-40 flex items-center gap-1.5 transition-all">
              <span className="material-symbols-outlined text-[14px]">{sysEventSending ? 'progress_activity' : 'send'}</span>
              {sysEventSending ? '...' : gw.systemEventSend}
            </button>
          </div>
          {sysEventResult && (
            <div className={`px-2 py-1.5 rounded-lg text-[10px] font-bold ${sysEventResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {sysEventResult.text}
            </div>
          )}
        </div>
      </div>

      {/* Manual RPC */}
      <div className="rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-white/5 flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-primary">code</span>
          <h3 className="text-[11px] font-bold text-slate-700 dark:text-white/80 uppercase tracking-wider">{gw.rpc}</h3>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[11px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-wider mb-1 block">{gw.rpcMethod}</label>
            <div className="flex gap-2">
              <input value={rpcMethod} onChange={e => setRpcMethod(e.target.value)} placeholder="system-presence"
                className="flex-1 h-8 px-3 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-lg text-[11px] font-mono text-slate-700 dark:text-white/80 placeholder:text-slate-300 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary/50 outline-none"
                onKeyDown={e => e.key === 'Enter' && handleRpcCall()} />
              <CustomSelect value="" onChange={v => { if (v) setRpcMethod(v); }}
                options={[
                  { value: '', label: gw.rpcPresets || 'Presets \u25be' },
                  ...RPC_PRESETS.map(m => ({ value: m, label: m })),
                  ...(rpcHistory.length > 0 ? [{ value: '---', label: `\u2500\u2500 ${gw.rpcRecent || 'Recent'} \u2500\u2500` }] : []),
                  ...rpcHistory.filter(h => !RPC_PRESETS.includes(h)).map(m => ({ value: m, label: `\u21ba ${m}` })),
                ]}
                className="h-8 px-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-lg text-[10px] text-slate-500 dark:text-white/50" />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-wider mb-1 block">{gw.rpcParams}</label>
            <textarea value={rpcParams} onChange={e => setRpcParams(e.target.value)} rows={4}
              className="w-full px-3 py-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 rounded-lg text-[11px] font-mono text-slate-700 dark:text-white/80 placeholder:text-slate-300 dark:placeholder:text-white/20 focus:ring-1 focus:ring-primary/50 outline-none resize-none" />
          </div>
          <button onClick={handleRpcCall} disabled={rpcLoading || !rpcMethod.trim()}
            className="px-4 py-1.5 bg-primary text-white text-[11px] font-bold rounded-lg disabled:opacity-40 transition-all">
            {rpcLoading ? <span className="material-symbols-outlined text-[14px] animate-spin align-middle">progress_activity</span> : gw.rpcCall}
          </button>
          {rpcError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-[10px] font-bold text-red-400 mb-1">{gw.rpcError}</p>
              <pre className="text-[10px] text-red-300/80 font-mono whitespace-pre-wrap break-all">{rpcError}</pre>
            </div>
          )}
          {rpcResult && (
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
              <p className="text-[11px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-wider mb-1">{gw.rpcResult}</p>
              <pre className="text-[10px] text-emerald-400/80 font-mono whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto custom-scrollbar neon-scrollbar">{rpcResult}</pre>
            </div>
          )}
        </div>
      </div>

      {/* Snapshots */}
      <div className="rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-amber-400">monitoring</span>
            <h3 className="text-[11px] font-bold text-slate-700 dark:text-white/80 uppercase tracking-wider">{gw.snapshots}</h3>
          </div>
          <button onClick={fetchDebugData} disabled={debugLoading}
            className="text-slate-400 dark:text-white/30 hover:text-slate-700 dark:hover:text-white text-[10px] font-bold flex items-center gap-1 transition-colors">
            <span className={`material-symbols-outlined text-[14px] ${debugLoading ? 'animate-spin' : ''}`}>{debugLoading ? 'progress_activity' : 'refresh'}</span>
          </button>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-wider mb-1.5">{gw.status}</p>
            <pre className="text-[10px] text-slate-500 dark:text-white/50 font-mono whitespace-pre-wrap break-all bg-white dark:bg-white/[0.02] rounded-lg p-3 max-h-[200px] overflow-y-auto custom-scrollbar neon-scrollbar border border-slate-200 dark:border-white/5">
              {debugStatus ? JSON.stringify(debugStatus, null, 2) : '{}'}
            </pre>
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 dark:text-white/30 uppercase tracking-wider mb-1.5">{gw.gwHealth}</p>
            <pre className="text-[10px] text-slate-500 dark:text-white/50 font-mono whitespace-pre-wrap break-all bg-white dark:bg-white/[0.02] rounded-lg p-3 max-h-[200px] overflow-y-auto custom-scrollbar neon-scrollbar border border-slate-200 dark:border-white/5">
              {debugHealth ? JSON.stringify(debugHealth, null, 2) : '{}'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DebugPanel;
