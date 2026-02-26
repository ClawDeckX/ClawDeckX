import { useEffect, useRef, useCallback } from 'react';
import { subscribeManagerWS } from '../services/manager-ws';

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
 * useGatewayEvents - subscribe to real-time gateway events via shared Manager WS.
 */
export function useGatewayEvents(handlers: GatewayEventHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const onMessage = useCallback((msg: any) => {
    try {
      const h = handlersRef.current;
      const type = msg.type as string;
      if (type && type in h) {
        (h as any)[type]?.(msg.data ?? {});
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => subscribeManagerWS(onMessage), [onMessage]);
}
