import React from 'react';
import { fmtAgoCompact } from '../../utils/time';

export interface ChannelsPanelProps {
  gw: any;
  channelsList: any[];
  channelsLoading: boolean;
  channelLogoutLoading: string | null;
  channelStopLoading: string | null;
  fetchChannels: (force?: boolean) => void;
  handleChannelLogout: (channel: string) => void;
  handleChannelStop: (channel: string) => void;
}

const fmtAgo = (ts: number | null | undefined, gw: any): string | null => fmtAgoCompact(ts, gw);

const ChannelsPanel: React.FC<ChannelsPanelProps> = ({
  gw, channelsList, channelsLoading, channelLogoutLoading, channelStopLoading,
  fetchChannels, handleChannelLogout, handleChannelStop,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-5 custom-scrollbar neon-scrollbar">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[12px] font-bold text-slate-500 dark:text-white/60 uppercase tracking-wider flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-primary">cell_tower</span>
          {gw.channels || 'Channels'}
        </h3>
        <button onClick={() => fetchChannels(true)} disabled={channelsLoading}
          className="px-2 py-1 rounded text-[10px] font-bold bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-white/60 hover:text-slate-700 dark:hover:text-white disabled:opacity-40 flex items-center gap-1">
          <span className={`material-symbols-outlined text-[12px] ${channelsLoading ? 'animate-spin' : ''}`}>{channelsLoading ? 'progress_activity' : 'refresh'}</span>
          {gw.refresh}
        </button>
      </div>
      {channelsLoading && channelsList.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-slate-400 dark:text-white/30 text-[11px]">
          <span className="material-symbols-outlined text-[18px] animate-spin me-2">progress_activity</span>
          {gw.loading}
        </div>
      ) : channelsList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-300 dark:text-white/20">
          <span className="material-symbols-outlined text-[36px] mb-3">signal_disconnected</span>
          <p className="text-[12px]">{gw.noChannels || 'No channels configured'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Stuck / unhealthy channels summary banner */}
          {(() => {
            const now = Date.now();
            const stuckCount = channelsList.filter((c: any) => {
              const busy = c.busy === true || (typeof c.activeRuns === 'number' && c.activeRuns > 0);
              const lra = typeof c.lastRunActivityAt === 'number' ? c.lastRunActivityAt : null;
              return busy && lra != null && (now - lra) > 25 * 60_000;
            }).length;
            const disconnectedCount = channelsList.filter((c: any) => c.enabled !== false && (c.lastError || c.connected === false) && c.running !== true).length;
            if (stuckCount === 0 && disconnectedCount === 0) return null;
            return (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 flex items-center gap-3 mb-1">
                <span className="material-symbols-outlined text-[18px] text-red-400">warning</span>
                <div className="text-[11px] text-red-500 dark:text-red-300 space-x-3">
                  {stuckCount > 0 && <span className="font-bold">{stuckCount} {gw.chStuckCount || 'channel(s) stuck'}</span>}
                  {disconnectedCount > 0 && <span className="font-bold">{disconnectedCount} {gw.chDisconnectedCount || 'channel(s) disconnected'}</span>}
                </div>
              </div>
            );
          })()}
          {channelsList.map((ch: any) => {
            const name = ch.name || ch.channel || ch.id || 'unknown';
            const rawStatus = String(ch.status || ch.state || '').toLowerCase();
            const isConnected = ch.connected === true || rawStatus === 'connected' || rawStatus === 'open' || (ch.running === true && ch.connected !== false);
            const isDisconnected = ch.lastError || rawStatus === 'disconnected' || rawStatus === 'closed' || rawStatus === 'error' || rawStatus === 'failed';
            const isIdle = (!isConnected && !isDisconnected && ch.running === true) || rawStatus === 'idle' || rawStatus === 'waiting';
            const isDisabled = ch.enabled === false || rawStatus === 'disabled' || rawStatus === 'off';
            const isBusy = ch.busy === true || (typeof ch.activeRuns === 'number' && ch.activeRuns > 0);
            // Stuck detection: busy but last run activity was >25 min ago (mirrors openclaw channel-health-policy)
            const STUCK_THRESHOLD_MS = 25 * 60_000;
            const lastRunAt = typeof ch.lastRunActivityAt === 'number' ? ch.lastRunActivityAt : null;
            const isStuck = isBusy && lastRunAt != null && (Date.now() - lastRunAt) > STUCK_THRESHOLD_MS;

            const statusColor = isStuck ? 'bg-red-500' : isConnected ? 'bg-emerald-500' : isDisconnected ? 'bg-red-500' : isIdle ? 'bg-amber-500' : isDisabled ? 'bg-slate-600' : 'bg-slate-500';
            const statusText = isConnected ? (gw.channelConnected || 'Connected')
              : isDisconnected ? (gw.channelDisconnected || 'Disconnected')
              : isIdle ? (gw.channelIdle || 'Idle')
              : isDisabled ? (gw.channelDisabled || 'Disabled')
              : (gw.channelUnknown || 'Unknown');
            const statusTextColor = isConnected ? 'text-emerald-400' : isDisconnected ? 'text-red-400' : isIdle ? 'text-amber-400' : 'text-slate-400 dark:text-white/30';

            const lastEvent = ch.lastEventAt || ch.lastEvent || ch.last_event || ch.lastActivity || ch.last_activity;
            const lastEventStr = lastEvent ? new Date(lastEvent).toLocaleString() : null;
            const lastInAgo = fmtAgo(ch.lastInboundAt, gw);
            const lastOutAgo = fmtAgo(ch.lastOutboundAt, gw);

            return (
              <div key={`${ch.channel || name}-${ch.accountId || ''}`} className="rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/[0.02] p-4 hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className={`w-3 h-3 rounded-full ${statusColor} shadow-lg`} />
                    {isConnected && <div className={`absolute inset-0 w-3 h-3 rounded-full ${statusColor} animate-ping opacity-40`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-bold text-slate-700 dark:text-white/80 truncate">{ch.displayLabel || name}</span>
                      {ch.displayLabel && ch.displayLabel !== name && (
                        <span className="text-[10px] font-mono text-slate-400 dark:text-white/30">{name}</span>
                      )}
                      {ch.accountId && ch.accountId !== 'default' && (
                        <span className="text-[9px] font-mono text-slate-400 dark:text-white/25 bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 rounded">{ch.accountId}</span>
                      )}
                      <span className={`text-[10px] font-bold uppercase ${statusTextColor}`}>{statusText}</span>
                      {isBusy && (
                        <span className="text-[9px] font-bold uppercase text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[10px]">pending</span>
                          {gw.chBusy || 'Busy'}{typeof ch.activeRuns === 'number' ? ` (${ch.activeRuns})` : ''}
                        </span>
                      )}
                      {isStuck && (
                        <span className="text-[9px] font-bold uppercase text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded flex items-center gap-0.5 animate-pulse">
                          <span className="material-symbols-outlined text-[10px]">error</span>
                          {gw.chStuck || 'Stuck'}
                        </span>
                      )}
                      {ch.restartPending && (
                        <span className="text-[9px] font-bold uppercase text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                          <span className="material-symbols-outlined text-[10px]">restart_alt</span>
                          {gw.chRestarting || 'Restarting'}
                        </span>
                      )}
                    </div>
                    {lastEventStr && (
                      <p className="text-[10px] text-slate-400 dark:text-white/30 mt-0.5">
                        {gw.channelLastEvent || 'Last Activity'}: {lastEventStr}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => handleChannelStop(ch.channel || name)} disabled={channelStopLoading === (ch.channel || name) || isDisabled || !isConnected}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 disabled:opacity-30 transition-all flex items-center gap-1"
                      title={gw.channelStopTip || 'Gracefully stop this channel'}>
                      <span className="material-symbols-outlined text-[12px]">
                        {channelStopLoading === (ch.channel || name) ? 'progress_activity' : 'stop_circle'}
                      </span>
                      {gw.channelStop || 'Stop'}
                    </button>
                    <button onClick={() => handleChannelLogout(ch.channel || name)} disabled={channelLogoutLoading === (ch.channel || name) || isDisabled}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-30 transition-all flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">
                        {channelLogoutLoading === (ch.channel || name) ? 'progress_activity' : 'logout'}
                      </span>
                      {gw.channelLogout || 'Logout'}
                    </button>
                  </div>
                </div>

                {/* Detail row: reconnects, inbound/outbound, error */}
                {(ch.reconnectAttempts > 0 || lastInAgo || lastOutAgo || ch.lastError) && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400 dark:text-white/30 ps-7">
                    {typeof ch.reconnectAttempts === 'number' && ch.reconnectAttempts > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[11px] text-orange-400">sync</span>
                        {gw.chReconnects || 'Reconnects'}: <span className="text-orange-400 font-bold">{ch.reconnectAttempts}</span>
                      </span>
                    )}
                    {lastInAgo && (
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[11px]">call_received</span>
                        {gw.chLastIn || 'In'}: {lastInAgo}
                      </span>
                    )}
                    {lastOutAgo && (
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[11px]">call_made</span>
                        {gw.chLastOut || 'Out'}: {lastOutAgo}
                      </span>
                    )}
                  </div>
                )}

                {/* Error row */}
                {ch.lastError && (
                  <div className="mt-1.5 ps-7">
                    <p className="text-[10px] font-mono text-red-400/70 bg-red-500/5 border border-red-500/10 rounded px-2 py-1 break-all line-clamp-2">
                      {ch.lastError}
                    </p>
                  </div>
                )}

                {/* Disconnect info */}
                {ch.lastDisconnect && typeof ch.lastDisconnect === 'object' && ch.lastDisconnect.error && !ch.lastError && (
                  <div className="mt-1.5 ps-7">
                    <p className="text-[10px] font-mono text-amber-400/60 bg-amber-500/5 border border-amber-500/10 rounded px-2 py-1 break-all line-clamp-2">
                      {ch.lastDisconnect.error}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ChannelsPanel;
