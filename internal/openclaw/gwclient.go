package openclaw

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
)

// ── 协议帧定义 ──────────────────────────────────────────

// RequestFrame 请求帧
type RequestFrame struct {
	Type   string      `json:"type"`   // "req"
	ID     string      `json:"id"`     // uuid
	Method string      `json:"method"` // 方法名
	Params interface{} `json:"params,omitempty"`
}

// ResponseFrame 响应帧
type ResponseFrame struct {
	ID      string          `json:"id"`
	OK      bool            `json:"ok"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// EventFrame 事件帧
type EventFrame struct {
	Event   string          `json:"event"`
	Seq     *int            `json:"seq,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// RPCError RPC 错误
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// ConnectParams 连接参数
type ConnectParams struct {
	MinProtocol int                    `json:"minProtocol"`
	MaxProtocol int                    `json:"maxProtocol"`
	Client      ConnectClient          `json:"client"`
	Auth        *ConnectAuth           `json:"auth,omitempty"`
	Device      *ConnectDevice         `json:"device,omitempty"`
	Role        string                 `json:"role"`
	Scopes      []string               `json:"scopes"`
	Caps        []string               `json:"caps"`
	Permissions map[string]interface{} `json:"permissions,omitempty"`
}

// ConnectDevice 设备身份信息
type ConnectDevice struct {
	ID        string `json:"id"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
	SignedAt  int64  `json:"signedAt"`
	Nonce     string `json:"nonce,omitempty"`
}

// ConnectClient 客户端标识
type ConnectClient struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName,omitempty"`
	Version     string `json:"version"`
	Platform    string `json:"platform"`
	Mode        string `json:"mode"`
}

// ConnectAuth 鉴权信息
type ConnectAuth struct {
	Token    string `json:"token,omitempty"`
	Password string `json:"password,omitempty"`
}

// ── 回调 & 配置 ─────────────────────────────────────────

// GWClientConfig Gateway WebSocket 客户端配置
type GWClientConfig struct {
	Host  string // Gateway 地址
	Port  int    // Gateway 端口
	Token string // 鉴权 Token
}

// GWEventHandler 事件回调
type GWEventHandler func(event string, payload json.RawMessage)

// ── 客户端实现 ──────────────────────────────────────────

// GWClient OpenClaw Gateway WebSocket 客户端
type GWClient struct {
	cfg       GWClientConfig
	conn      *websocket.Conn
	mu        sync.Mutex
	pending   map[string]chan *ResponseFrame
	connected bool
	closed    bool
	stopCh    chan struct{}
	onEvent   GWEventHandler

	// 重连
	reconnectCount int
	backoffMs      int

	// 心跳健康检查
	healthMu        sync.Mutex
	healthEnabled   bool          // 是否启用心跳自动重启
	healthInterval  time.Duration // 探测间隔（默认 30s）
	healthMaxFails  int           // 连续失败阈值（默认 3）
	healthFailCount int           // 当前连续失败次数
	healthLastOK    time.Time     // 上次成功时间
	healthStopCh    chan struct{}
	healthRunning   bool
	onRestart       func() error // 重启回调（由外部注入）
	onNotify        func(string) // 通知回调（由外部注入）
}

// NewGWClient 创建 Gateway WebSocket 客户端
func NewGWClient(cfg GWClientConfig) *GWClient {
	return &GWClient{
		cfg:            cfg,
		pending:        make(map[string]chan *ResponseFrame),
		stopCh:         make(chan struct{}),
		backoffMs:      1000,
		healthInterval: 30 * time.Second,
		healthMaxFails: 3,
	}
}

// SetEventHandler 设置事件回调
func (c *GWClient) SetEventHandler(h GWEventHandler) {
	c.onEvent = h
}

// SetRestartCallback 设置网关重启回调
func (c *GWClient) SetRestartCallback(fn func() error) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	c.onRestart = fn
}

// SetNotifyCallback 设置外部通知回调
func (c *GWClient) SetNotifyCallback(fn func(string)) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	c.onNotify = fn
}

// SetHealthCheckEnabled 启用/禁用心跳健康检查自动重启
func (c *GWClient) SetHealthCheckEnabled(enabled bool) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	c.healthEnabled = enabled
	if enabled && !c.healthRunning {
		c.healthRunning = true
		c.healthStopCh = make(chan struct{})
		go c.healthCheckLoop()
		logger.Gateway.Info().Msg(i18n.T(i18n.MsgLogHealthCheckEnabled))
	} else if !enabled && c.healthRunning {
		c.healthRunning = false
		close(c.healthStopCh)
		logger.Gateway.Info().Msg(i18n.T(i18n.MsgLogHealthCheckDisabled))
	}
}

// IsHealthCheckEnabled 返回心跳健康检查是否启用
func (c *GWClient) IsHealthCheckEnabled() bool {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	return c.healthEnabled
}

// HealthStatus 返回心跳健康检查状态
func (c *GWClient) HealthStatus() map[string]interface{} {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	lastOK := ""
	if !c.healthLastOK.IsZero() {
		lastOK = c.healthLastOK.Format(time.RFC3339)
	}
	return map[string]interface{}{
		"enabled":    c.healthEnabled,
		"fail_count": c.healthFailCount,
		"max_fails":  c.healthMaxFails,
		"last_ok":    lastOK,
	}
}

// healthCheckLoop 后台心跳健康检查循环
func (c *GWClient) healthCheckLoop() {
	ticker := time.NewTicker(c.healthInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.healthStopCh:
			return
		case <-c.stopCh:
			return
		case <-ticker.C:
			c.healthMu.Lock()
			enabled := c.healthEnabled
			c.healthMu.Unlock()
			if !enabled {
				continue
			}

			// 优先使用 WebSocket ping（最轻量，< 50ms）
			healthy := false
			c.mu.Lock()
			wsConnected := c.connected && c.conn != nil
			if wsConnected {
				// 发送 WebSocket ping，等待 pong
				err := c.conn.WriteControl(
					websocket.PingMessage,
					[]byte{},
					time.Now().Add(3*time.Second),
				)
				if err == nil {
					healthy = true
					logger.Gateway.Debug().Msg(i18n.T(i18n.MsgLogHeartbeatWsPingOk))
				} else {
					logger.Gateway.Debug().Err(err).Msg(i18n.T(i18n.MsgLogHeartbeatWsPingFail))
				}
			}
			c.mu.Unlock()

			// 回退：TCP 端口探测（WebSocket 未连接或 ping 失败时）
			if !healthy {
				tcpAddr := fmt.Sprintf("%s:%d", c.cfg.Host, c.cfg.Port)
				if conn, tcpErr := net.DialTimeout("tcp", tcpAddr, 3*time.Second); tcpErr == nil {
					conn.Close()
					healthy = true
					logger.Gateway.Debug().Msg(i18n.T(i18n.MsgLogHeartbeatTcpOk))
				} else {
					logger.Gateway.Debug().Err(tcpErr).Msg(i18n.T(i18n.MsgLogHeartbeatTcpFail))
				}
			}

			c.healthMu.Lock()
			if healthy {
				// 健康检查通过
				if c.healthFailCount > 0 {
					logger.Gateway.Info().
						Int("prev_fails", c.healthFailCount).
						Msg(i18n.T(i18n.MsgLogHeartbeatRecovered))
				}
				c.healthFailCount = 0
				c.healthLastOK = time.Now()
			} else {
				// 健康检查失败
				c.healthFailCount++
				logger.Gateway.Warn().
					Int("fail_count", c.healthFailCount).
					Int("max_fails", c.healthMaxFails).
					Msg(i18n.T(i18n.MsgLogHeartbeatFailed))

				if c.healthFailCount >= c.healthMaxFails && c.onRestart != nil {
					logger.Gateway.Warn().
						Int("consecutive_fails", c.healthFailCount).
						Msg(i18n.T(i18n.MsgLogHeartbeatThresholdRestart))
					c.healthFailCount = 0
					restartFn := c.onRestart
					notifyFn := c.onNotify
					c.healthMu.Unlock()

					if restartErr := restartFn(); restartErr != nil {
						logger.Gateway.Error().Err(restartErr).Msg(i18n.T(i18n.MsgLogHeartbeatRestartFailed))
						if notifyFn != nil {
							go notifyFn("\U0001f6a8 OpenClaw Gateway 心跳检测失败，自动重启也失败: " + restartErr.Error())
						}
					} else {
						logger.Gateway.Info().Msg(i18n.T(i18n.MsgLogHeartbeatRestartSuccess))
						if notifyFn != nil {
							go notifyFn("\u26a0\ufe0f OpenClaw Gateway 心跳检测失败，已自动重启成功")
						}
					}
					continue
				}
			}
			c.healthMu.Unlock()
		}
	}
}

// IsConnected 是否已连接
func (c *GWClient) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

// Start 启动客户端（后台运行）
func (c *GWClient) Start() {
	go c.connectLoop()
}

// Stop 停止客户端
func (c *GWClient) Stop() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	close(c.stopCh)
	if c.conn != nil {
		c.conn.Close()
	}
	c.mu.Unlock()
}

// Reconnect 使用新配置重新连接 Gateway
func (c *GWClient) Reconnect(newCfg GWClientConfig) {
	logger.Log.Info().
		Str("host", newCfg.Host).
		Int("port", newCfg.Port).
		Msg(i18n.T(i18n.MsgLogGatewayConfigUpdated))

	// 先断开旧连接
	c.mu.Lock()
	if c.conn != nil {
		c.conn.Close()
	}
	c.connected = false
	// 清理 pending 请求
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
	// 如果之前已 Stop，需要重置
	if c.closed {
		c.closed = false
		c.stopCh = make(chan struct{})
	}
	c.cfg = newCfg
	c.reconnectCount = 0
	c.backoffMs = 1000
	c.mu.Unlock()

	// 启动新的连接循环
	go c.connectLoop()
}

// GetConfig 获取当前配置
func (c *GWClient) GetConfig() GWClientConfig {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cfg
}

// Request 发送 RPC 请求并等待响应
func (c *GWClient) Request(method string, params interface{}) (json.RawMessage, error) {
	return c.RequestWithTimeout(method, params, 15*time.Second)
}

// RequestWithTimeout 带超时的 RPC 请求
func (c *GWClient) RequestWithTimeout(method string, params interface{}, timeout time.Duration) (json.RawMessage, error) {
	c.mu.Lock()
	if !c.connected || c.conn == nil {
		c.mu.Unlock()
		return nil, errors.New("gateway 未连接")
	}

	id := uuid.New().String()
	ch := make(chan *ResponseFrame, 1)
	c.pending[id] = ch

	frame := RequestFrame{
		Type:   "req",
		ID:     id,
		Method: method,
		Params: params,
	}
	data, err := json.Marshal(frame)
	if err != nil {
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("序列化请求失败: %w", err)
	}

	err = c.conn.WriteMessage(websocket.TextMessage, data)
	c.mu.Unlock()

	if err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("发送请求失败: %w", err)
	}

	// 等待响应
	select {
	case resp := <-ch:
		if resp == nil {
			return nil, errors.New("连接已关闭")
		}
		if !resp.OK {
			msg := "未知错误"
			if resp.Error != nil {
				msg = resp.Error.Message
			}
			return nil, fmt.Errorf("gateway 错误: %s", msg)
		}
		return resp.Payload, nil
	case <-time.After(timeout):
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf("请求超时: %s", method)
	case <-c.stopCh:
		return nil, errors.New("客户端已停止")
	}
}

// ── 内部实现 ────────────────────────────────────────────

func (c *GWClient) connectLoop() {
	for {
		select {
		case <-c.stopCh:
			return
		default:
		}

		err := c.dial()
		if err != nil {
			logger.Log.Debug().Err(err).
				Str("host", c.cfg.Host).
				Int("port", c.cfg.Port).
				Msg(i18n.T(i18n.MsgLogGatewayWsConnectFailed))
		}

		// 等待重连
		select {
		case <-c.stopCh:
			return
		case <-time.After(time.Duration(c.backoffMs) * time.Millisecond):
		}

		c.backoffMs = min(c.backoffMs*2, 30000)
		c.reconnectCount++
	}
}

func (c *GWClient) dial() error {
	u := url.URL{
		Scheme: "ws",
		Host:   fmt.Sprintf("%s:%d", c.cfg.Host, c.cfg.Port),
		Path:   "/",
	}

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
	}

	conn, _, err := dialer.Dial(u.String(), nil)
	if err != nil {
		return fmt.Errorf("WebSocket 拨号失败: %w", err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	// 读取消息循环
	return c.readLoop(conn)
}

func (c *GWClient) readLoop(conn *websocket.Conn) error {
	defer func() {
		c.mu.Lock()
		c.connected = false
		if c.conn == conn {
			c.conn = nil
		}
		// 清空所有 pending
		for id, ch := range c.pending {
			close(ch)
			delete(c.pending, id)
		}
		c.mu.Unlock()
		conn.Close()
	}()

	connectNonce := ""
	connectSent := false

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			return fmt.Errorf("读取消息失败: %w", err)
		}

		var raw map[string]json.RawMessage
		if err := json.Unmarshal(message, &raw); err != nil {
			continue
		}

		// 判断帧类型
		if _, hasEvent := raw["event"]; hasEvent {
			// 事件帧
			var evt EventFrame
			if err := json.Unmarshal(message, &evt); err != nil {
				continue
			}

			// connect.challenge → 发送 connect
			if evt.Event == "connect.challenge" {
				var payload struct {
					Nonce string `json:"nonce"`
				}
				if err := json.Unmarshal(evt.Payload, &payload); err == nil && payload.Nonce != "" {
					connectNonce = payload.Nonce
					if !connectSent {
						connectSent = true
						go c.sendConnect(conn, connectNonce)
					}
				}
				continue
			}

			// tick 事件 → 心跳
			if evt.Event == "tick" {
				continue
			}

			// 其他事件 → 回调
			if c.onEvent != nil {
				c.onEvent(evt.Event, evt.Payload)
			}
			continue
		}

		// 响应帧
		if _, hasID := raw["id"]; hasID {
			var resp ResponseFrame
			if err := json.Unmarshal(message, &resp); err != nil {
				continue
			}

			// 检查是否是 connect 的 ack（status: accepted）
			if resp.OK && resp.Payload != nil {
				var ack struct {
					Status string `json:"status"`
				}
				if json.Unmarshal(resp.Payload, &ack) == nil && ack.Status == "accepted" {
					// 等待最终响应
					continue
				}
			}

			c.mu.Lock()
			ch, ok := c.pending[resp.ID]
			if ok {
				delete(c.pending, resp.ID)
			}
			c.mu.Unlock()

			if ok {
				ch <- &resp
			}
			continue
		}
	}
}

func (c *GWClient) sendConnect(conn *websocket.Conn, nonce string) {
	params := ConnectParams{
		MinProtocol: 3,
		MaxProtocol: 3,
		Client: ConnectClient{
			ID:          "gateway-client",
			DisplayName: "ClawDeckX",
			Version:     "0.2.0",
			Platform:    "go",
			Mode:        "backend",
		},
		Role:   "operator",
		Scopes: []string{"operator.admin"},
		Caps:   []string{},
	}

	// 如果 token 为空，尝试从 openclaw.json 自动读取
	token := c.cfg.Token
	if token == "" {
		configPath := ResolveConfigPath()
		logger.Log.Debug().Str("configPath", configPath).Msg(i18n.T(i18n.MsgLogGwclientTokenEmpty))
		if t := readGatewayTokenFromConfig(); t != "" {
			token = t
			c.mu.Lock()
			c.cfg.Token = token
			c.mu.Unlock()
			logger.Log.Info().Msg(i18n.T(i18n.MsgLogGwclientTokenRead))
		} else {
			logger.Log.Warn().Str("configPath", configPath).Msg(i18n.T(i18n.MsgLogGwclientTokenReadFail))
		}
	}
	if token != "" {
		params.Auth = &ConnectAuth{
			Token: token,
		}
	} else {
		logger.Log.Warn().Msg(i18n.T(i18n.MsgLogGwclientNoAuth))
	}

	// 加载或生成 device identity
	identity, err := LoadOrCreateDeviceIdentity("")
	if err != nil {
		logger.Log.Error().Err(err).Msg(i18n.T(i18n.MsgLogDeviceIdentityLoadFail))
	} else {
		// 构建 device auth payload
		signedAt := time.Now().UnixMilli()
		scopesStr := ""
		if len(params.Scopes) > 0 {
			scopesStr = strings.Join(params.Scopes, ",")
		}

		// 构建 payload: version|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
		payloadParts := []string{
			"v2",
			identity.DeviceID,
			params.Client.ID,
			params.Client.Mode,
			params.Role,
			scopesStr,
			fmt.Sprintf("%d", signedAt),
			token,
			nonce,
		}
		payload := strings.Join(payloadParts, "|")

		// 签名
		signature, err := SignDevicePayload(identity.PrivateKeyPem, payload)
		if err != nil {
			logger.Log.Error().Err(err).Msg(i18n.T(i18n.MsgLogDevicePayloadSignFail))
		} else {
			// 获取公钥的 base64url 编码
			publicKeyBase64URL, err := PublicKeyRawBase64URLFromPem(identity.PublicKeyPem)
			if err != nil {
				logger.Log.Error().Err(err).Msg(i18n.T(i18n.MsgLogPublicKeyEncodeFail))
			} else {
				params.Device = &ConnectDevice{
					ID:        identity.DeviceID,
					PublicKey: publicKeyBase64URL,
					Signature: signature,
					SignedAt:  signedAt,
					Nonce:     nonce,
				}
				logger.Log.Debug().
					Str("deviceId", identity.DeviceID).
					Msg(i18n.T(i18n.MsgLogDeviceIdentityAdded))
			}
		}
	}

	logger.Log.Debug().
		Bool("hasToken", token != "").
		Bool("hasDevice", params.Device != nil).
		Str("clientId", params.Client.ID).
		Str("role", params.Role).
		Msg(i18n.T(i18n.MsgLogSendConnectParams))

	id := uuid.New().String()
	ch := make(chan *ResponseFrame, 1)

	c.mu.Lock()
	c.pending[id] = ch
	c.mu.Unlock()

	frame := RequestFrame{
		Type:   "req",
		ID:     id,
		Method: "connect",
		Params: params,
	}
	data, err := json.Marshal(frame)
	if err != nil {
		logger.Log.Error().Err(err).Msg(i18n.T(i18n.MsgLogConnectSerializeFail))
		return
	}

	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		logger.Log.Error().Err(err).Msg(i18n.T(i18n.MsgLogConnectSendFail))
		return
	}

	// 等待 connect 响应
	select {
	case resp := <-ch:
		if resp != nil && resp.OK {
			c.mu.Lock()
			c.connected = true
			c.backoffMs = 1000
			c.mu.Unlock()
			logger.Log.Info().
				Str("host", c.cfg.Host).
				Int("port", c.cfg.Port).
				Msg(i18n.T(i18n.MsgLogGatewayWsConnected))
		} else {
			msg := "未知错误"
			if resp != nil && resp.Error != nil {
				msg = resp.Error.Message
			}
			logger.Log.Error().Str("error", msg).Msg(i18n.T(i18n.MsgLogGatewayWsAuthFail))
			conn.Close()
		}
	case <-time.After(10 * time.Second):
		logger.Log.Error().Msg(i18n.T(i18n.MsgLogGatewayWsConnectTimeout))
		conn.Close()
	case <-c.stopCh:
		return
	}
}

// readGatewayTokenFromConfig 从 openclaw.json 读取 gateway.auth.token
func readGatewayTokenFromConfig() string {
	configPath := ResolveConfigPath()
	if configPath == "" {
		return ""
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		return ""
	}
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return ""
	}
	gw, ok := raw["gateway"].(map[string]interface{})
	if !ok {
		return ""
	}
	auth, ok := gw["auth"].(map[string]interface{})
	if !ok {
		return ""
	}
	token, _ := auth["token"].(string)
	return token
}
