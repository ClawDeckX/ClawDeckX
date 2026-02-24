import { useState, useEffect, useCallback, useRef } from 'react';
import { badgeApi } from '../services/api';
import { WindowID } from '../types';

const POLL_INTERVAL = 15_000; // 15s

export function useBadgeCounts(enabled = true): Record<WindowID, number> {
  const [badges, setBadges] = useState<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const fetchBadges = useCallback(() => {
    if (!enabled) return;
    badgeApi.counts().then((data: any) => {
      if (data && typeof data === 'object') setBadges(data);
    }).catch(() => {});
  }, [enabled]);

  // Initial fetch + polling
  useEffect(() => {
    if (!enabled) return;
    fetchBadges();
    const timer = setInterval(fetchBadges, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [enabled, fetchBadges]);

  // WS real-time updates: subscribe to alert + gw_event channels
  useEffect(() => {
    if (!enabled) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/v1/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'subscribe', channels: ['alert', 'gw_event'] }));
    };
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'alert') {
          setTimeout(fetchBadges, 2000);
        }
        if (msg.type === 'exec.approval.requested') {
          setBadges(prev => ({ ...prev, alerts: (prev.alerts || 0) + 1 }));
        }
        if (msg.type === 'exec.approval.resolved') {
          setBadges(prev => ({ ...prev, alerts: Math.max(0, (prev.alerts || 0) - 1) }));
        }
        if (msg.type === 'shutdown') {
          setTimeout(fetchBadges, 2000);
        }
      } catch { /* ignore */ }
    };
    wsRef.current = ws;
    return () => { ws.close(); wsRef.current = null; };
  }, [fetchBadges]);

  return badges as Record<WindowID, number>;
}
