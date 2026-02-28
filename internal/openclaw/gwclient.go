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

type RequestFrame struct {
	Type   string      `json:"type"`   // "req"
	ID     string      `json:"id"`     // uuid
	Method string      `json:"method"` // method name
	Params interface{} `json:"params,omitempty"`
}

type ResponseFrame struct {
	ID      string          `json:"id"`
	OK      bool            `json:"ok"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

type EventFrame struct {
	Event   string          `json:"event"`
	Seq     *int            `json:"seq,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

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

type ConnectDevice struct {
	ID        string `json:"id"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
	SignedAt  int64  `json:"signedAt"`
	Nonce     string `json:"nonce,omitempty"`
}

type ConnectClient struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName,omitempty"`
	Version     string `json:"version"`
	Platform    string `json:"platform"`
	Mode        string `json:"mode"`
}

type ConnectAuth struct {
	Token    string `json:"token,omitempty"`
	Password string `json:"password,omitempty"`
}

type GWClientConfig struct {
	Host  string // Gateway address
	Port  int    // Gateway port
	Token string // auth token
}

type GWEventHandler func(event string, payload json.RawMessage)

type GWClient struct {
	cfg       GWClientConfig
	conn      *websocket.Conn
	mu        sync.Mutex
	pending   map[string]chan *ResponseFrame
	connected bool
	closed    bool
	stopCh    chan struct{}
	onEvent   GWEventHandler

	reconnectCount int
	backoffMs      int

	healthMu        sync.Mutex
	healthEnabled   bool          // enable heartbeat auto-restart
	healthInterval  time.Duration // probe interval (default 30s)
	healthMaxFails  int           // consecutive failure threshold (default 3)
	healthFailCount int           // current consecutive failure count
	healthLastOK    time.Time     // last success time
	healthStopCh    chan struct{}
	healthRunning   bool
	onRestart       func() error // restart callback (injected externally)
	onNotify        func(string) // notify callback (injected externally)
}

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

func (c *GWClient) SetEventHandler(h GWEventHandler) {
	c.onEvent = h
}

func (c *GWClient) SetRestartCallback(fn func() error) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	c.onRestart = fn
}

func (c *GWClient) SetNotifyCallback(fn func(string)) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	c.onNotify = fn
}

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

func (c *GWClient) IsHealthCheckEnabled() bool {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	return c.healthEnabled
}

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

			healthy := false
			c.mu.Lock()
			wsConnected := c.connected && c.conn != nil
			if wsConnected {
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
				if c.healthFailCount > 0 {
					logger.Gateway.Info().
						Int("prev_fails", c.healthFailCount).
						Msg(i18n.T(i18n.MsgLogHeartbeatRecovered))
				}
				c.healthFailCount = 0
				c.healthLastOK = time.Now()
			} else {
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
							go notifyFn(i18n.T(i18n.MsgNotifyHeartbeatRestartFailed) + restartErr.Error())
						}
					} else {
						logger.Gateway.Info().Msg(i18n.T(i18n.MsgLogHeartbeatRestartSuccess))
						if notifyFn != nil {
							go notifyFn(i18n.T(i18n.MsgNotifyHeartbeatRestartSuccess))
						}
					}
					continue
				}
			}
			c.healthMu.Unlock()
		}
	}
}

func (c *GWClient) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

func (c *GWClient) Start() {
	go c.connectLoop()
}

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

func (c *GWClient) Reconnect(newCfg GWClientConfig) {
	logger.Log.Info().
		Str("host", newCfg.Host).
		Int("port", newCfg.Port).
		Msg(i18n.T(i18n.MsgLogGatewayConfigUpdated))

	c.mu.Lock()
	if c.conn != nil {
		c.conn.Close()
	}
	c.connected = false
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
	if c.closed {
		c.closed = false
		c.stopCh = make(chan struct{})
	}
	c.cfg = newCfg
	c.reconnectCount = 0
	c.backoffMs = 1000
	c.mu.Unlock()

	go c.connectLoop()
}

func (c *GWClient) GetConfig() GWClientConfig {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cfg
}

func (c *GWClient) Request(method string, params interface{}) (json.RawMessage, error) {
	return c.RequestWithTimeout(method, params, 15*time.Second)
}

func (c *GWClient) RequestWithTimeout(method string, params interface{}, timeout time.Duration) (json.RawMessage, error) {
	c.mu.Lock()
	if !c.connected || c.conn == nil {
		c.mu.Unlock()
		return nil, errors.New(i18n.T(i18n.MsgErrGatewayNotConnected))
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
		return nil, fmt.Errorf(i18n.T(i18n.MsgErrSerializeRequestFailed), err)
	}

	err = c.conn.WriteMessage(websocket.TextMessage, data)
	c.mu.Unlock()

	if err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf(i18n.T(i18n.MsgErrSendRequestFailed), err)
	}

	select {
	case resp := <-ch:
		if resp == nil {
			return nil, errors.New(i18n.T(i18n.MsgErrConnectionClosed))
		}
		if !resp.OK {
			msg := i18n.T(i18n.MsgGwclientUnknownError)
			if resp.Error != nil {
				msg = resp.Error.Message
			}
			return nil, fmt.Errorf(i18n.T(i18n.MsgErrGatewayError), msg)
		}
		return resp.Payload, nil
	case <-time.After(timeout):
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return nil, fmt.Errorf(i18n.T(i18n.MsgErrRequestTimeout), method)
	case <-c.stopCh:
		return nil, errors.New(i18n.T(i18n.MsgErrClientStopped))
	}
}

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
		return fmt.Errorf(i18n.T(i18n.MsgErrWebsocketDialFailed), err)
	}

	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	return c.readLoop(conn)
}

func (c *GWClient) readLoop(conn *websocket.Conn) error {
	defer func() {
		c.mu.Lock()
		c.connected = false
		if c.conn == conn {
			c.conn = nil
		}
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
			return fmt.Errorf(i18n.T(i18n.MsgErrReadMessageFailed), err)
		}

		var raw map[string]json.RawMessage
		if err := json.Unmarshal(message, &raw); err != nil {
			continue
		}

		if _, hasEvent := raw["event"]; hasEvent {
			var evt EventFrame
			if err := json.Unmarshal(message, &evt); err != nil {
				continue
			}

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

			if evt.Event == "tick" {
				continue
			}

			if c.onEvent != nil {
				c.onEvent(evt.Event, evt.Payload)
			}
			continue
		}

		if _, hasID := raw["id"]; hasID {
			var resp ResponseFrame
			if err := json.Unmarshal(message, &resp); err != nil {
				continue
			}

			if resp.OK && resp.Payload != nil {
				var ack struct {
					Status string `json:"status"`
				}
				if json.Unmarshal(resp.Payload, &ack) == nil && ack.Status == "accepted" {
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

	identity, err := LoadOrCreateDeviceIdentity("")
	if err != nil {
		logger.Log.Error().Err(err).Msg(i18n.T(i18n.MsgLogDeviceIdentityLoadFail))
	} else {
		signedAt := time.Now().UnixMilli()
		scopesStr := ""
		if len(params.Scopes) > 0 {
			scopesStr = strings.Join(params.Scopes, ",")
		}

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

		signature, err := SignDevicePayload(identity.PrivateKeyPem, payload)
		if err != nil {
			logger.Log.Error().Err(err).Msg(i18n.T(i18n.MsgLogDevicePayloadSignFail))
		} else {
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
			msg := i18n.T(i18n.MsgGwclientUnknownError)
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
