import { useState, useEffect, useCallback, useRef } from 'react';
import { badgeApi } from '../services/api';
import { WindowID } from '../types';
import { subscribeManagerWS } from '../services/manager-ws';

const POLL_INTERVAL = 15_000; // 15s

export function useBadgeCounts(enabled = true): Record<WindowID, number> {
  const [badges, setBadges] = useState<Record<string, number>>({});
  const fetchRef = useRef<() => void>(() => {});

  const fetchBadges = useCallback(() => {
    if (!enabled) return;
    badgeApi.counts().then((data: any) => {
      if (data && typeof data === 'object') setBadges(data);
    }).catch(() => {});
  }, [enabled]);
  fetchRef.current = fetchBadges;

  // Initial fetch + polling with visibility detection
  useEffect(() => {
    if (!enabled) return;
    fetchBadges();
    let timer: ReturnType<typeof setInterval> | null = setInterval(fetchBadges, POLL_INTERVAL);
    const onVisibility = () => {
      if (document.hidden) {
        if (timer) { clearInterval(timer); timer = null; }
      } else {
        if (!timer) {
          timer = setInterval(fetchBadges, POLL_INTERVAL);
          fetchBadges();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, fetchBadges]);

  // WS real-time updates: subscribe to alert + gw_event channels
  useEffect(() => {
    if (!enabled) return;
    return subscribeManagerWS((msg: any) => {
      try {
        if (msg.type === 'alert') {
          setTimeout(() => fetchRef.current(), 2000);
        }
        if (msg.type === 'exec.approval.requested') {
          setBadges(prev => ({ ...prev, alerts: (prev.alerts || 0) + 1 }));
        }
        if (msg.type === 'exec.approval.resolved') {
          setBadges(prev => ({ ...prev, alerts: Math.max(0, (prev.alerts || 0) - 1) }));
        }
        if (msg.type === 'shutdown') {
          setTimeout(() => fetchRef.current(), 2000);
        }
      } catch { /* ignore */ }
    });
  }, [enabled]);

  return badges as Record<WindowID, number>;
}
