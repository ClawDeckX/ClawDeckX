/**
 * GatewayWSClient — 前端直连 OpenClaw Gateway WebSocket
 *
 * 协议：OpenClaw Gateway JSON-RPC over WebSocket
 * - 发送请求: { type: "req", id, method, params }
 * - 接收响应: { type: "res", id, ok, payload?, error? }
 * - 接收事件: { type: "event", event, payload?, seq? }
 * - 连接握手: connect 方法 + connect.challenge nonce
 */

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type GatewayEventFrame = {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
};

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: unknown;
  errorMessage?: string;
  usage?: unknown;
  stopReason?: string;
};

export type GatewayWSClientOptions = {
  url: string;
  token?: string;
  onConnected?: (hello: any) => void;
  onDisconnected?: (code: number, reason: string) => void;
  onEvent?: (evt: GatewayEventFrame) => void;
  onError?: (err: string) => void;
  requestTimeoutMs?: number;
};

let _idCounter = 0;
function nextId(): string {
  return `req_${Date.now()}_${++_idCounter}`;
}

export class GatewayWSClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private backoffMs = 800;
  private connectNonce: string | null = null;
  private connectSent = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private opts: GatewayWSClientOptions;

  constructor(opts: GatewayWSClientOptions) {
    this.opts = opts;
  }

  get connected(): boolean {
    return this._connected && this.ws?.readyState === WebSocket.OPEN;
  }

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    this._connected = false;
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.flushPending(new Error('client stopped'));
  }

  private connect() {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.addEventListener('open', () => this.queueConnect());
    this.ws.addEventListener('message', (ev) => this.handleMessage(String(ev.data ?? '')));
    this.ws.addEventListener('close', (ev) => {
      this.ws = null;
      this._connected = false;
      this.flushPending(new Error(`closed (${ev.code}): ${ev.reason}`));
      this.opts.onDisconnected?.(ev.code, ev.reason || '');
      this.scheduleReconnect();
    });
    this.ws.addEventListener('error', () => {
      // close handler will fire
    });
  }

  private scheduleReconnect() {
    if (this.closed) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15000);
    setTimeout(() => this.connect(), delay);
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  private queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
    }
    this.connectTimer = setTimeout(() => {
      void this.sendConnect();
    }, 300);
  }

  private async sendConnect() {
    if (this.connectSent) return;
    this.connectSent = true;
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    const params: any = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'webchat-ui',
        version: 'dev',
        platform: navigator.platform ?? 'web',
        mode: 'webchat',
      },
      role: 'operator',
      scopes: ['operator.admin'],
      caps: [],
      auth: this.opts.token ? { token: this.opts.token } : undefined,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };

    try {
      const hello = await this.request<any>('connect', params);
      this.backoffMs = 800;
      this._connected = true;
      this.opts.onConnected?.(hello);
    } catch {
      this.ws?.close(4008, 'connect failed');
    }
  }

  private handleMessage(raw: string) {
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (parsed.type === 'event') {
      const evt = parsed as GatewayEventFrame;
      // Handle connect challenge
      if (evt.event === 'connect.challenge') {
        const nonce = (evt.payload as any)?.nonce;
        if (typeof nonce === 'string') {
          this.connectNonce = nonce;
          this.connectSent = false;
          void this.sendConnect();
        }
        return;
      }
      try {
        this.opts.onEvent?.(evt);
      } catch (err) {
        console.error('[gateway-ws] event handler error:', err);
      }
      return;
    }

    if (parsed.type === 'res') {
      const pending = this.pending.get(parsed.id);
      if (!pending) return;
      this.pending.delete(parsed.id);
      clearTimeout(pending.timer);
      if (parsed.ok) {
        pending.resolve(parsed.payload);
      } else {
        pending.reject(new Error(parsed.error?.message ?? 'request failed'));
      }
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('not connected'));
    }
    const id = nextId();
    const timeoutMs = this.opts.requestTimeoutMs ?? 30000;
    const frame = { type: 'req', id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      this.ws!.send(JSON.stringify(frame));
    });
  }
}

/**
 * 从网关配置构建 WebSocket URL
 * http -> ws, https -> wss
 */
export function buildGatewayWsUrl(host: string, port: number): string {
  const isSecure = window.location.protocol === 'https:';
  const scheme = isSecure ? 'wss' : 'ws';
  const h = host === '0.0.0.0' ? '127.0.0.1' : host;
  return `${scheme}://${h}:${port}`;
}
