import { useEffect, useRef, useCallback } from 'react';

/**
 * Gateway 事件类型定义
 */
export interface GatewayShutdownPayload {
  reason?: string;
  code?: number;
}

export interface GatewayHealthPayload {
  status?: string;
  uptimeMs?: number;
  snapshot?: any;
}

export interface GatewayCronPayload {
  id?: string;
  name?: string;
  key?: string;
  status?: string;
  result?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface GatewayHeartbeatPayload {
  agentId?: string;
  sessionKey?: string;
  startedAt?: string;
  finishedAt?: string;
  status?: string;
}

export interface GatewayTalkModePayload {
  mode?: string;
  previous?: string;
}

export interface GatewayNodeInvokeRequestPayload {
  nodeId?: string;
  command?: string;
  requestId?: string;
}

export type GatewayEventMap = {
  'shutdown': GatewayShutdownPayload;
  'health': GatewayHealthPayload;
  'cron': GatewayCronPayload;
  'heartbeat': GatewayHeartbeatPayload;
  'talk.mode': GatewayTalkModePayload;
  'node.invoke.request': GatewayNodeInvokeRequestPayload;
};

export type GatewayEventHandlers = {
  [K in keyof GatewayEventMap]?: (payload: GatewayEventMap[K]) => void;
};

/**
 * useGatewayEvents — 订阅 Gateway 实时事件
 *
 * 通过 Manager 的 /api/v1/ws → gw_event 频道接收 Gateway 转发的事件。
 * 支持选择性监听：只传入需要的事件处理器即可。
 *
 * @example
 * useGatewayEvents({
 *   shutdown: (p) => setGwRunning(false),
 *   health: (p) => setHealthSnap(p),
 *   cron: (p) => setCronActivity(prev => [p, ...prev]),
 * });
 */
export function useGatewayEvents(handlers: GatewayEventHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const wsRef = useRef<WebSocket | null>(null);

  const onMessage = useCallback((evt: MessageEvent) => {
    try {
      const msg = JSON.parse(evt.data);
      const h = handlersRef.current;
      const type = msg.type as string;
      if (type && type in h) {
        (h as any)[type]?.(msg.data ?? {});
      }
    } catch { /* ignore parse errors */ }
  }, []);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/api/v1/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ action: 'subscribe', channels: ['gw_event'] }));
    };
    ws.onmessage = onMessage;

    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [onMessage]);
}
