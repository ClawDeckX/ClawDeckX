package openclaw

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"net"
	"net/url"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/safego"
	"ClawDeckX/internal/sentinel"
	"ClawDeckX/internal/webconfig"
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
	Code    int              `json:"code"`
	Message string           `json:"message"`
	Details *json.RawMessage `json:"details,omitempty"`
}

// extractPairingRequestID extracts the requestId from an RPCError's details
// field, as returned by the gateway when pairing is required.
func (e *RPCError) extractPairingRequestID() string {
	if e == nil || e.Details == nil {
		return ""
	}
	var d struct {
		RequestID string `json:"requestId"`
	}
	if json.Unmarshal(*e.Details, &d) == nil && d.RequestID != "" {
		return d.RequestID
	}
	return ""
}

// GatewayRPCError represents a business-logic error returned by the gateway
// (i.e. the gateway responded with ok:false). This is distinct from connectivity
// errors (not connected, send failed, timeout, etc.).
type GatewayRPCError struct {
	Msg string
}

func (e *GatewayRPCError) Error() string { return e.Msg }

// IsGatewayRPCError checks whether err is a business-logic error from the gateway.
func IsGatewayRPCError(err error) bool {
	var rpcErr *GatewayRPCError
	return errors.As(err, &rpcErr)
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

var defaultOperatorScopes = []string{
	"operator.admin",
	"operator.read",
	"operator.write",
	"operator.approvals",
	"operator.pairing",
	"operator.talk.secrets",
}

func cloneDefaultOperatorScopes() []string {
	scopes := make([]string, len(defaultOperatorScopes))
	copy(scopes, defaultOperatorScopes)
	return scopes
}

type ConnectDevice struct {
	ID        string `json:"id"`
	PublicKey string `json:"publicKey"`
	Signature string `json:"signature"`
	SignedAt  int64  `json:"signedAt"`
	Nonce     string `json:"nonce,omitempty"`
}

type ConnectClient struct {
	ID           string `json:"id"`
	DisplayName  string `json:"displayName,omitempty"`
	Version      string `json:"version"`
	Platform     string `json:"platform"`
	DeviceFamily string `json:"deviceFamily,omitempty"`
	Mode         string `json:"mode"`
}

type ConnectAuth struct {
	Token    string `json:"token,omitempty"`
	Password string `json:"password,omitempty"`
}

type GWClientConfig struct {
	Host  string // Gateway address
	Port  int    // Gateway port
	Path  string // WebSocket path
	Token string // auth token
}

type GWEventHandler func(event string, payload json.RawMessage)

// defaultRestartGracePeriod is the initial quiet period after a watchdog-triggered
// restart during which health checks are fully skipped.  After it expires,
// checks resume but failures do NOT count toward the restart threshold until
// the gateway has been healthy at least once (healthPostRestartPending).
// Configurable via SetRestartGracePeriod.
const defaultRestartGracePeriod = 120 * time.Second

type GWClient struct {
	cfg           GWClientConfig
	conn          *websocket.Conn
	mu            sync.Mutex
	pending       map[string]chan *ResponseFrame
	connected     bool
	closed        bool
	stopCh        chan struct{}
	onEvent       GWEventHandler
	lastError     string    // last connection/auth error for diagnostics
	gwVersion     string    // gateway version fetched after connect
	gwUptimeMs    int64     // gateway uptime from hello-ok snapshot
	gwConnectedAt time.Time // when we received hello-ok (for local elapsed calc)
	protoCaps     gwProtocolCaps
	lastRPCOKAt   time.Time

	reconnectCount int
	backoffMs      int
	backoffCapMs   int

	connectLoopRunning bool       // true while connectLoop goroutine is active
	connectLoopMu      sync.Mutex // guards connectLoopRunning

	pairingAutoApprove bool       // true while auto-approve is running
	pairingApprovingMu sync.Mutex // prevents concurrent approve attempts

	authRefreshPending bool          // true while auto token-refresh is in progress
	authRefreshMu      sync.Mutex    // prevents concurrent token-refresh attempts
	authRefreshAt      time.Time     // last time we attempted a token refresh (for cooldown)
	reconnectNowCh     chan struct{} // signals connectLoop to skip the backoff delay

	lastSeq      *int          // last received event seq for gap detection
	lastTick     time.Time     // last tick event time for silent disconnect detection
	tickInterval time.Duration // expected tick interval from gateway (default 30s)

	healthMu                    sync.Mutex
	healthEnabled               bool          // enable heartbeat auto-restart
	healthInterval              time.Duration // probe interval (default 30s)
	healthMaxFails              int           // consecutive failure threshold (default 3)
	healthFailCount             int           // current consecutive failure count
	healthLastOK                time.Time     // last success time
	healthLastCheck             time.Time     // last time a probe ran (success or fail)
	healthRestarting            bool          // true while a restart is in progress
	healthGraceUntil            time.Time     // skip health checks until this time (post-restart grace period)
	healthRestartGracePeriod    time.Duration // configurable grace period (default 120s)
	healthPostRestartPending    bool          // true after restart until first successful health check
	healthPostRestartDeadline   time.Time     // hard deadline: if gateway never healthy by this time, allow re-restart
	healthStopCh                chan struct{}
	healthRunning               bool
	onRestart                   func() error                           // restart callback (injected externally)
	onNotify                    func(eventType string, message string) // notify callback (injected externally)
	onLifecycle                 func(event string, detail string)      // lifecycle event callback
	onTokenRefreshed            func(newToken string)                  // called when autoRefreshToken updates the token
	pendingRestartSuccessNotify *time.Timer

	// Notification status tracking (for frontend banner)
	notifyChannels  []string  // active notification channel names
	notifyLastAt    time.Time // last time a notification was dispatched
	notifyLastEvent string    // last notification event type
	notifySending   bool      // true while a notification send is in progress

	// 探针缓存：避免每次 HealthStatus() 调用都触发完整的 TCP+HTTP 探测
	// （前端每秒轮询，一次 ProbeGateway 最长可能耗时 ~3s，且无 keep-alive，
	// 重启 grace 期内会因网关繁忙偶发超时，导致前端 /health /ready 状态闪烁）。
	probeMu      sync.Mutex
	probeCache   GatewayProbeSnapshot
	probeCacheAt time.Time

	// v0.4：命名事件 fan-out —— 允许多个子系统并行订阅 gateway 事件流，
	// 不占用 onEvent 单 owner 语义（gwcollector 仍然作为主消费方持有 onEvent）。
	// 使用命名 map + RWMutex，子系统 Add 时用唯一 name，Remove 幂等。
	// 注意：listener 回调与主 onEvent 同在 readLoop 调用路径上串行执行，
	// 任何实现 MUST 自行快返回 / 启 goroutine，避免卡阻事件流。
	listenersMu sync.RWMutex
	listeners   map[string]GWEventHandler
}

func NewGWClient(cfg GWClientConfig) *GWClient {
	return &GWClient{
		cfg:                      cfg,
		pending:                  make(map[string]chan *ResponseFrame),
		stopCh:                   make(chan struct{}),
		backoffMs:                1000,
		backoffCapMs:             30000,
		tickInterval:             30 * time.Second,
		healthInterval:           30 * time.Second,
		healthMaxFails:           3,
		healthRestartGracePeriod: defaultRestartGracePeriod,
		reconnectNowCh:           make(chan struct{}, 1),
	}
}

func (c *GWClient) SetEventHandler(h GWEventHandler) {
	c.onEvent = h
}

// AddEventListener 注册一个命名副听众，允许 gwcollector 之外的子系统
// （如 agentroom.Manager）并行接收所有 gateway 事件。同名重复 Add 覆盖旧值。
// 传入 nil 等价于 RemoveEventListener。
//
// 契约：回调 MUST 快速返回（推荐 go func(){...}()），否则会拖慢整条事件流。
func (c *GWClient) AddEventListener(name string, fn GWEventHandler) {
	if name == "" {
		return
	}
	c.listenersMu.Lock()
	defer c.listenersMu.Unlock()
	if fn == nil {
		delete(c.listeners, name)
		return
	}
	if c.listeners == nil {
		c.listeners = make(map[string]GWEventHandler)
	}
	c.listeners[name] = fn
}

// RemoveEventListener 撤销指定命名副听众。幂等：未注册时 no-op。
func (c *GWClient) RemoveEventListener(name string) {
	if name == "" {
		return
	}
	c.listenersMu.Lock()
	defer c.listenersMu.Unlock()
	delete(c.listeners, name)
}

// dispatchEvent 在 readLoop 内调用：先调主 onEvent，再串行广播所有副听众。
// 为降低锁持有时间，先拷贝 listener 快照再调用。
func (c *GWClient) dispatchEvent(event string, payload json.RawMessage) {
	if c.onEvent != nil {
		c.onEvent(event, payload)
	}
	c.listenersMu.RLock()
	if len(c.listeners) == 0 {
		c.listenersMu.RUnlock()
		return
	}
	snapshot := make([]GWEventHandler, 0, len(c.listeners))
	for _, fn := range c.listeners {
		snapshot = append(snapshot, fn)
	}
	c.listenersMu.RUnlock()
	for _, fn := range snapshot {
		fn(event, payload)
	}
}

func (c *GWClient) SetRestartCallback(fn func() error) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	c.onRestart = fn
}

func (c *GWClient) SetNotifyCallback(fn func(eventType string, message string)) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	if fn == nil {
		c.onNotify = nil
		return
	}
	// Wrap the callback to track notification sending status for the frontend banner.
	c.onNotify = func(eventType string, message string) {
		c.healthMu.Lock()
		c.notifySending = true
		c.notifyLastEvent = eventType
		c.healthMu.Unlock()

		fn(eventType, message)

		c.healthMu.Lock()
		c.notifySending = false
		c.notifyLastAt = time.Now()
		c.healthMu.Unlock()
	}
}

// SetNotifyChannels updates the list of active notification channel names for status reporting.
func (c *GWClient) SetNotifyChannels(channels []string) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	c.notifyChannels = channels
}

func (c *GWClient) SetTokenRefreshedCallback(fn func(newToken string)) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	c.onTokenRefreshed = fn
}

func (c *GWClient) SetLifecycleCallback(fn func(event string, detail string)) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	c.onLifecycle = fn
}

func (c *GWClient) SetHealthCheckEnabled(enabled bool) {
	c.healthMu.Lock()
	defer c.healthMu.Unlock()
	c.healthEnabled = enabled
	if enabled && !c.healthRunning {
		c.healthRunning = true
		c.healthStopCh = make(chan struct{})
		safego.GoLoopWithCooldown("gwclient/healthCheck", 5*time.Second, c.healthCheckLoop)
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
	lastOK := ""
	if !c.healthLastOK.IsZero() {
		lastOK = c.healthLastOK.Format(time.RFC3339)
	}
	lastCheck := ""
	if !c.healthLastCheck.IsZero() {
		lastCheck = c.healthLastCheck.Format(time.RFC3339)
	}
	enabled := c.healthEnabled
	failCount := c.healthFailCount
	maxFails := c.healthMaxFails
	intervalSec := int(c.healthInterval / time.Second)
	graceUntil := c.healthGraceUntil
	restarting := c.healthRestarting
	postRestartPending := c.healthPostRestartPending
	healthLastCheckTime := c.healthLastCheck
	healthInterval := c.healthInterval
	gracePeriodSec := int(c.healthRestartGracePeriod / time.Second)
	// Notification status snapshot
	nfyChannels := make([]string, len(c.notifyChannels))
	copy(nfyChannels, c.notifyChannels)
	nfySending := c.notifySending
	nfyLastEvent := c.notifyLastEvent
	nfyLastAt := c.notifyLastAt
	c.healthMu.Unlock()

	c.mu.Lock()
	backoffCapMs := c.backoffCapMs
	host := c.cfg.Host
	port := c.cfg.Port
	c.mu.Unlock()

	graceStr := ""
	graceRemainingSec := 0
	now := time.Now()
	if !graceUntil.IsZero() && now.Before(graceUntil) {
		graceStr = graceUntil.Format(time.RFC3339)
		graceRemainingSec = int(graceUntil.Sub(now).Seconds())
	}

	// Compute next check countdown (seconds until next probe fires)
	nextCheckInSec := 0
	if enabled && !healthLastCheckTime.IsZero() {
		elapsed := now.Sub(healthLastCheckTime)
		remaining := healthInterval - elapsed
		if remaining > 0 {
			nextCheckInSec = int(remaining.Seconds())
		}
	}

	// Compute a human-readable phase for the frontend.
	// Phases: "healthy" | "probing" | "degraded" | "starting" | "restarting" | "grace" | "disabled"
	phase := "disabled"
	if enabled {
		if restarting {
			phase = "restarting"
		} else if graceStr != "" {
			phase = "grace"
		} else if postRestartPending {
			phase = "starting"
		} else if failCount > 0 {
			phase = "degraded"
		} else if lastOK == "" {
			phase = "probing"
		} else {
			phase = "healthy"
		}
	}

	// Notification status for frontend banner
	nfyLastAtStr := ""
	nfyLastAgoSec := 0
	if !nfyLastAt.IsZero() {
		nfyLastAtStr = nfyLastAt.Format(time.RFC3339)
		nfyLastAgoSec = int(now.Sub(nfyLastAt).Seconds())
	}

	return map[string]interface{}{
		"enabled":                   enabled,
		"fail_count":                failCount,
		"max_fails":                 maxFails,
		"last_ok":                   lastOK,
		"last_check":                lastCheck,
		"interval_sec":              intervalSec,
		"reconnect_backoff_cap_sec": backoffCapMs / 1000,
		"reconnect_backoff_cap_ms":  backoffCapMs,
		"restart_grace_sec":         gracePeriodSec,
		"grace_until":               graceStr,
		"grace_remaining_sec":       graceRemainingSec,
		"restarting":                restarting,
		"post_restart_pending":      postRestartPending,
		"next_check_in_sec":         nextCheckInSec,
		"phase":                     phase,
		"probe":                     c.cachedProbe(host, port),
		// Notification status
		"notify_channels":     nfyChannels,
		"notify_sending":      nfySending,
		"notify_last_event":   nfyLastEvent,
		"notify_last_at":      nfyLastAtStr,
		"notify_last_ago_sec": nfyLastAgoSec,
	}
}

// cachedProbe 返回带 ~3s TTL 缓存的 ProbeGateway 快照。
// 当 host/port 变更或缓存过期时重新探测。
// 这样前端每秒轮询观测状态时，不会都触发一次完整的 TCP+HTTP 探测，
// 也避免重启 grace 期内偶发探针超时引起的 /health /ready 状态闪烁。
func (c *GWClient) cachedProbe(host string, port int) GatewayProbeSnapshot {
	const probeCacheTTL = 3 * time.Second
	c.probeMu.Lock()
	if !c.probeCacheAt.IsZero() &&
		time.Since(c.probeCacheAt) < probeCacheTTL &&
		c.probeCache.Host == host &&
		c.probeCache.Port == port {
		snap := c.probeCache
		c.probeMu.Unlock()
		return snap
	}
	c.probeMu.Unlock()

	snap := ProbeGateway(host, port)

	c.probeMu.Lock()
	c.probeCache = snap
	c.probeCacheAt = time.Now()
	c.probeMu.Unlock()
	return snap
}

func (c *GWClient) clearPendingRestartSuccessNotifyLocked() {
	if c.pendingRestartSuccessNotify != nil {
		c.pendingRestartSuccessNotify.Stop()
		c.pendingRestartSuccessNotify = nil
	}
}

func (c *GWClient) scheduleRestartSuccessNotify(msg string) {
	c.healthMu.Lock()
	c.clearPendingRestartSuccessNotifyLocked()
	var timer *time.Timer
	timer = time.AfterFunc(20*time.Second, func() {
		c.healthMu.Lock()
		if c.pendingRestartSuccessNotify != timer {
			c.healthMu.Unlock()
			return
		}
		c.pendingRestartSuccessNotify = nil
		notifyFn := c.onNotify
		c.healthMu.Unlock()
		if notifyFn != nil {
			go notifyFn("heartbeat_restart", msg)
		}
	})
	c.pendingRestartSuccessNotify = timer
	c.healthMu.Unlock()
}

func (c *GWClient) healthCheckLoop() {
	ticker := time.NewTicker(c.healthInterval)
	defer ticker.Stop()
	first := time.NewTimer(0)
	defer first.Stop()
	firstC := first.C

	for {
		select {
		case <-c.healthStopCh:
			return
		case <-c.stopCh:
			return
		case <-firstC:
			firstC = nil
		case <-ticker.C:
		}

		c.healthMu.Lock()
		enabled := c.healthEnabled
		graceUntil := c.healthGraceUntil
		c.healthMu.Unlock()
		if !enabled {
			continue
		}
		// Skip health checks during post-restart grace period to allow gateway startup
		if !graceUntil.IsZero() && time.Now().Before(graceUntil) {
			logger.Gateway.Debug().Time("grace_until", graceUntil).Msg("skipping health check during post-restart grace period")
			continue
		}

		healthy := false
		c.mu.Lock()
		wsConnected := c.connected && c.conn != nil
		allowTCPFallback := wsConnected
		// Tick stall detection: if connected but no tick received for 3× tick interval,
		// the connection is likely silently dead (NAT timeout, proxy drop, etc.)
		if wsConnected && !c.lastTick.IsZero() {
			tickStallThreshold := c.tickInterval * 3
			if tickStallThreshold < 60*time.Second {
				tickStallThreshold = 60 * time.Second
			}
			if time.Since(c.lastTick) > tickStallThreshold {
				logger.Gateway.Warn().
					Dur("since_last_tick", time.Since(c.lastTick)).
					Dur("threshold", tickStallThreshold).
					Msg("tick stall detected, forcing reconnect")
				staleConn := c.conn
				c.mu.Unlock()
				staleConn.Close()
				continue
			}
		}
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

		if !healthy && allowTCPFallback {
			tcpAddr := net.JoinHostPort(c.cfg.Host, fmt.Sprintf("%d", c.cfg.Port))
			if conn, tcpErr := net.DialTimeout("tcp", tcpAddr, 3*time.Second); tcpErr == nil {
				_ = conn.Close()
				healthy = true
				logger.Gateway.Debug().Msg(i18n.T(i18n.MsgLogHeartbeatTcpOk))
			} else {
				logger.Gateway.Debug().Err(tcpErr).Msg(i18n.T(i18n.MsgLogHeartbeatTcpFail))
			}
		} else if !healthy && !wsConnected {
			logger.Gateway.Debug().Msg("watchdog detected websocket disconnected; skipping TCP-only healthy fallback")
		}

		c.healthMu.Lock()
		c.healthLastCheck = time.Now()
		if healthy {
			if c.healthFailCount > 0 {
				logger.Gateway.Info().
					Int("prev_fails", c.healthFailCount).
					Msg(i18n.T(i18n.MsgLogHeartbeatRecovered))
			}
			c.healthFailCount = 0
			c.healthLastOK = time.Now()
			// Clear post-restart pending on first successful check
			if c.healthPostRestartPending {
				logger.Gateway.Info().Msg("gateway healthy after restart, clearing post-restart pending")
				c.healthPostRestartPending = false
				c.healthPostRestartDeadline = time.Time{}
			}
		} else {
			c.healthFailCount++
			logger.Gateway.Warn().
				Int("fail_count", c.healthFailCount).
				Int("max_fails", c.healthMaxFails).
				Msg(i18n.T(i18n.MsgLogHeartbeatFailed))

			// During post-restart pending: suppress restart unless hard deadline exceeded
			if c.healthPostRestartPending {
				if !c.healthPostRestartDeadline.IsZero() && time.Now().After(c.healthPostRestartDeadline) {
					logger.Gateway.Warn().Msg("post-restart hard deadline exceeded, gateway never became healthy")
					c.healthPostRestartPending = false
					c.healthPostRestartDeadline = time.Time{}
					// Fall through to normal restart logic below
				} else {
					// Still within tolerance window — do not count toward restart
					c.healthFailCount = 0
					c.healthMu.Unlock()
					continue
				}
			}

			if c.healthFailCount >= c.healthMaxFails && c.onRestart != nil {
				gracePeriod := c.healthRestartGracePeriod
				logger.Gateway.Warn().
					Int("consecutive_fails", c.healthFailCount).
					Msg(i18n.T(i18n.MsgLogHeartbeatThresholdRestart))
				c.healthFailCount = 0
				c.healthGraceUntil = time.Now().Add(gracePeriod)
				c.healthRestarting = true
				restartFn := c.onRestart
				notifyFn := c.onNotify
				c.healthMu.Unlock()

				// Write restart sentinel for heartbeat-triggered restart
				_ = sentinel.Write(webconfig.DataDir(), "heartbeat_restart", "watchdog", map[string]interface{}{
					"consecutive_fails": c.healthMaxFails,
				})

				if restartErr := restartFn(); restartErr != nil {
					logger.Gateway.Error().Err(restartErr).Msg(i18n.T(i18n.MsgLogHeartbeatRestartFailed))
					if notifyFn != nil {
						go notifyFn("heartbeat_restart", i18n.T(i18n.MsgNotifyHeartbeatRestartFailed)+restartErr.Error())
					}
				} else {
					logger.Gateway.Info().Msg(i18n.T(i18n.MsgLogHeartbeatRestartSuccess))
					if notifyFn != nil {
						c.scheduleRestartSuccessNotify(i18n.T(i18n.MsgNotifyHeartbeatRestartSuccess))
					}
				}
				c.healthMu.Lock()
				c.healthRestarting = false
				// Reset grace period AFTER restart completes so the full
				// duration starts from now, not from before the (blocking)
				// restart call which may have consumed most of the window.
				c.healthGraceUntil = time.Now().Add(gracePeriod)
				// Activate post-restart pending: failures won't trigger another
				// restart until the gateway is healthy or the hard deadline passes.
				c.healthPostRestartPending = true
				c.healthPostRestartDeadline = time.Now().Add(gracePeriod * 3)
				logger.Gateway.Info().
					Dur("grace_period", gracePeriod).
					Time("hard_deadline", c.healthPostRestartDeadline).
					Msg("post-restart grace + pending activated")
				c.healthMu.Unlock()
				continue
			}
		}
		c.healthMu.Unlock()
	}
}

func (c *GWClient) SetHealthCheckIntervalSeconds(seconds int) {
	if seconds < 5 {
		seconds = 5
	}
	if seconds > 300 {
		seconds = 300
	}

	c.healthMu.Lock()
	c.healthInterval = time.Duration(seconds) * time.Second
	enabled := c.healthEnabled
	running := c.healthRunning
	if running {
		c.healthRunning = false
		close(c.healthStopCh)
	}
	if enabled {
		c.healthRunning = true
		c.healthStopCh = make(chan struct{})
		safego.GoLoopWithCooldown("gwclient/healthCheck", 5*time.Second, c.healthCheckLoop)
	}
	c.healthMu.Unlock()
}

func (c *GWClient) SetHealthCheckMaxFails(maxFails int) {
	if maxFails < 1 {
		maxFails = 1
	}
	if maxFails > 20 {
		maxFails = 20
	}

	c.healthMu.Lock()
	c.healthMaxFails = maxFails
	c.healthMu.Unlock()
}

func (c *GWClient) SetReconnectBackoffCapMs(capMs int) {
	if capMs < 1000 {
		capMs = 1000
	}
	if capMs > 6000000 {
		capMs = 6000000
	}

	c.mu.Lock()
	c.backoffCapMs = capMs
	if c.backoffMs > c.backoffCapMs {
		c.backoffMs = c.backoffCapMs
	}
	c.mu.Unlock()
}

func (c *GWClient) SetRestartGracePeriod(seconds int) {
	if seconds < 10 {
		seconds = 10
	}
	if seconds > 600 {
		seconds = 600
	}

	c.healthMu.Lock()
	c.healthRestartGracePeriod = time.Duration(seconds) * time.Second
	c.healthMu.Unlock()
}

func (c *GWClient) GetHealthCheckConfig() (intervalSec int, maxFails int, backoffCapMs int, graceSec int) {
	c.healthMu.Lock()
	intervalSec = int(c.healthInterval / time.Second)
	maxFails = c.healthMaxFails
	graceSec = int(c.healthRestartGracePeriod / time.Second)
	c.healthMu.Unlock()

	c.mu.Lock()
	backoffCapMs = c.backoffCapMs
	c.mu.Unlock()

	return
}

func (c *GWClient) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

// LastError returns the last connection/auth error for diagnostics.
func (c *GWClient) LastError() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastError
}

// ConnectionStatus returns a snapshot of the WS connection state for diagnostics.
func (c *GWClient) ConnectionStatus() map[string]interface{} {
	c.mu.Lock()
	connected := c.connected
	host := c.cfg.Host
	port := c.cfg.Port
	reconnects := c.reconnectCount
	backoff := c.backoffMs
	lastErr := c.lastError
	pairingAutoApprove := c.pairingAutoApprove
	authRefreshPending := c.authRefreshPending
	// Compute live gateway uptime: base from hello-ok + local elapsed time
	gwUptimeMs := int64(0)
	if c.gwUptimeMs > 0 && !c.gwConnectedAt.IsZero() {
		gwUptimeMs = c.gwUptimeMs + time.Since(c.gwConnectedAt).Milliseconds()
	}
	// Seq/tick diagnostic fields
	var lastSeq *int
	if c.lastSeq != nil {
		v := *c.lastSeq
		lastSeq = &v
	}
	lastTickAge := ""
	if !c.lastTick.IsZero() {
		lastTickAge = time.Since(c.lastTick).Round(time.Second).String()
	}
	lastRPCOKAt := ""
	if !c.lastRPCOKAt.IsZero() {
		lastRPCOKAt = c.lastRPCOKAt.Format(time.RFC3339)
	}
	tickIntervalMs := c.tickInterval.Milliseconds()
	c.mu.Unlock()

	c.healthMu.Lock()
	failCount := c.healthFailCount
	maxFails := c.healthMaxFails
	intervalSec := int(c.healthInterval / time.Second)
	healthEnabled := c.healthEnabled
	lastOK := ""
	if !c.healthLastOK.IsZero() {
		lastOK = c.healthLastOK.Format(time.RFC3339)
	}
	graceStr := ""
	if !c.healthGraceUntil.IsZero() && time.Now().Before(c.healthGraceUntil) {
		graceStr = c.healthGraceUntil.Format(time.RFC3339)
	}
	c.healthMu.Unlock()

	// Compute a human-readable phase for the frontend process indicator.
	// Phases: "connected" | "pairing" | "auth_refresh" | "reconnecting" | "disconnected"
	phase := "disconnected"
	if connected {
		phase = "connected"
	} else if pairingAutoApprove {
		phase = "pairing"
	} else if authRefreshPending {
		phase = "auth_refresh"
	} else if reconnects > 0 || backoff > 1000 {
		phase = "reconnecting"
	}

	return map[string]interface{}{
		"connected":            connected,
		"host":                 host,
		"port":                 port,
		"reconnect_count":      reconnects,
		"backoff_ms":           backoff,
		"last_error":           lastErr,
		"pairing_auto_approve": pairingAutoApprove,
		"auth_refresh_pending": authRefreshPending,
		"phase":                phase,
		"health_enabled":       healthEnabled,
		"fail_count":           failCount,
		"max_fails":            maxFails,
		"interval_sec":         intervalSec,
		"last_ok":              lastOK,
		"grace_until":          graceStr,
		"version":              c.gwVersion,
		"protocol_caps": map[string]interface{}{
			"detected":    c.protoCaps.Detected,
			"useKeyParam": c.protoCaps.UseKeyParam,
		},
		"gateway_uptime_ms": gwUptimeMs,
		"last_seq":          lastSeq,
		"last_tick_age":     lastTickAge,
		"tick_interval_ms":  tickIntervalMs,
		"last_rpc_ok_at":    lastRPCOKAt,
	}
}

func (c *GWClient) Start() {
	c.connectLoopMu.Lock()
	if c.connectLoopRunning {
		c.connectLoopMu.Unlock()
		return
	}
	c.connectLoopRunning = true
	c.connectLoopMu.Unlock()
	safego.GoLoopWithCooldown("gwclient/connectLoop", 3*time.Second, c.connectLoop)
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
	// Drain pending requests so callers get an immediate error instead of hanging
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
	c.mu.Unlock()
}

func (c *GWClient) Reconnect(newCfg GWClientConfig) {
	var callerInfo string
	if pc, file, line, ok := runtime.Caller(1); ok {
		fn := runtime.FuncForPC(pc)
		name := ""
		if fn != nil {
			name = fn.Name()
		}
		callerInfo = fmt.Sprintf("%s:%d (%s)", file, line, name)
	}
	logger.Gateway.Info().
		Str("host", newCfg.Host).
		Int("port", newCfg.Port).
		Str("caller", callerInfo).
		Msg("Reconnect() called")
	logger.Log.Info().
		Str("host", newCfg.Host).
		Int("port", newCfg.Port).
		Msg(i18n.T(i18n.MsgLogGatewayConfigUpdated))

	c.mu.Lock()
	// Close old connection so the current readLoop unblocks and connectLoop
	// proceeds to the next dial attempt. We do NOT replace stopCh or start a
	// new connectLoop goroutine — the existing one will pick up the new config.
	if c.conn != nil {
		c.conn.Close()
	}
	c.connected = false
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
	c.cfg = newCfg
	c.reconnectCount = 0
	c.backoffMs = 1000
	c.lastError = ""
	c.mu.Unlock()

	// Signal connectLoop to skip the current backoff sleep and reconnect immediately.
	select {
	case c.reconnectNowCh <- struct{}{}:
	default:
	}

	// If no connectLoop is running (e.g. it was never started or the client was
	// stopped and restarted), start one now.
	c.connectLoopMu.Lock()
	needStart := !c.connectLoopRunning
	if needStart {
		// Ensure the client is not in a stopped state so the new loop can run.
		c.mu.Lock()
		if c.closed {
			c.closed = false
			c.stopCh = make(chan struct{})
		}
		c.mu.Unlock()
		c.connectLoopRunning = true
	}
	c.connectLoopMu.Unlock()

	if needStart {
		safego.GoLoopWithCooldown("gwclient/connectLoop", 3*time.Second, c.connectLoop)
	}
}

func (c *GWClient) GetConfig() GWClientConfig {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cfg
}

// GetVersion returns the cached gateway version string (e.g. "2026.4.25").
func (c *GWClient) GetVersion() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gwVersion
}

// RefreshTokenFromConfig reloads the gateway auth token from the OpenClaw config
// path and updates the cached config if the token changed.  It does NOT call
// Reconnect() because the WS connection already authenticated during sendConnect;
// only the HTTP history path needs the refreshed token in cfg.
func (c *GWClient) RefreshTokenFromConfig() bool {
	token := readGatewayTokenFromConfig()
	if token == "" {
		return false
	}

	c.mu.Lock()
	if c.cfg.Token == token {
		c.mu.Unlock()
		return false
	}
	c.cfg.Token = token
	c.mu.Unlock()

	logger.Log.Info().Int("tokenLen", len(token)).Msg("gateway token refreshed from config (in-place)")
	return true
}

// UpdateToken updates the cached auth token without reconnecting the WebSocket.
// Use this when only the token changed but host:port remain the same — avoids
// killing pending WS requests (which Reconnect would do).
func (c *GWClient) UpdateToken(token string) {
	c.mu.Lock()
	c.cfg.Token = token
	c.mu.Unlock()
	logger.Log.Info().Int("tokenLen", len(token)).Msg("gateway token updated in-place")
}

// IsLocalGateway returns true if the gateway is running on localhost/loopback.
func (c *GWClient) IsLocalGateway() bool {
	c.mu.Lock()
	host := c.cfg.Host
	c.mu.Unlock()
	if host == "" {
		return true
	}
	return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0.0.0.0"
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
			return nil, &GatewayRPCError{Msg: fmt.Sprintf(i18n.T(i18n.MsgErrGatewayError), msg)}
		}
		c.mu.Lock()
		c.lastRPCOKAt = time.Now()
		c.mu.Unlock()
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
			c.mu.Lock()
			// Don't overwrite lastError while auto-approve is showing progress
			if !c.pairingAutoApprove {
				c.lastError = err.Error()
			}
			errMsg := err.Error()
			// Auth errors: slow down immediately so the loop doesn't storm the
			// gateway while autoRefreshToken (launched from sendConnect) runs.
			// This also covers the case where the connect frame race delivers the
			// auth rejection as a dial error rather than via sendConnect.
			if isAuthError(errMsg) && c.backoffMs < 60000 {
				c.backoffMs = 60000
			}
			// Pairing required: slow down to avoid rapid retries while
			// autoApprovePairing runs asynchronously (~1-2s).
			isPairingErr := strings.Contains(errMsg, "pairing required")
			if isPairingErr && c.backoffMs < 10000 {
				c.backoffMs = 10000
			}
			c.mu.Unlock()
			logger.Log.Warn().Err(err).
				Str("host", c.cfg.Host).
				Int("port", c.cfg.Port).
				Msg(i18n.T(i18n.MsgLogGatewayWsConnectFailed))
			// Close 1008 "pairing required" lands here when the server sends it
			// before the JSON response can be delivered (close frame race).
			// No requestId available from the close frame, so pass empty hint.
			if isPairingErr && c.IsLocalGateway() {
				go c.autoApprovePairing("")
			} else if isAuthError(errMsg) {
				// Close 1008 "unauthorized: gateway token mismatch" lands here
				// when OpenClaw was reinstalled and the new auth token in
				// ~/.openclaw/openclaw.json no longer matches the stale token
				// cached in the DB gateway profile. autoRefreshToken reads the
				// new token, persists it via onTokenRefreshed, and triggers an
				// immediate reconnect. Safe to call concurrently — it has its
				// own mutex and 2-minute cooldown.
				go c.autoRefreshToken()
			}
		}

		// Add ±20% jitter to prevent reconnect storms across instances
		jitter := 0.8 + rand.Float64()*0.4 // [0.8, 1.2)
		delay := time.Duration(float64(c.backoffMs)*jitter) * time.Millisecond
		logger.Log.Debug().Dur("delay", delay).Int("backoff_ms", c.backoffMs).Msg("gateway reconnect backoff")
		select {
		case <-c.stopCh:
			return
		case <-c.reconnectNowCh:
			logger.Log.Debug().Msg("reconnect-now signal received, skipping backoff")
		case <-time.After(delay):
		}

		c.mu.Lock()
		nextBackoff := min(c.backoffMs*2, c.backoffCapMs)
		c.backoffMs = nextBackoff
		c.reconnectCount++
		c.mu.Unlock()
	}
}

func (c *GWClient) dial() error {
	wsPath := c.cfg.Path
	if wsPath == "" {
		wsPath = "/"
	}
	if !strings.HasPrefix(wsPath, "/") {
		wsPath = "/" + wsPath
	}
	u := url.URL{
		Scheme: "ws",
		Host:   fmt.Sprintf("%s:%d", c.cfg.Host, c.cfg.Port),
		Path:   wsPath,
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
		logger.Gateway.Debug().Msg("readLoop: defer cleanup starting")
		c.mu.Lock()
		wasConnected := c.connected
		c.connected = false
		c.gwVersion = ""
		c.gwUptimeMs = 0
		c.gwConnectedAt = time.Time{}
		c.protoCaps = gwProtocolCaps{}
		c.lastSeq = nil
		c.lastTick = time.Time{}
		if c.conn == conn {
			c.conn = nil
		}
		for id, ch := range c.pending {
			close(ch)
			delete(c.pending, id)
		}
		lastErr := c.lastError
		c.mu.Unlock()
		conn.Close()
		// Fire lifecycle callback for unexpected disconnection
		if wasConnected {
			c.healthMu.Lock()
			lcFn := c.onLifecycle
			c.healthMu.Unlock()
			if lcFn != nil {
				go lcFn("disconnected", lastErr)
			}
		}
	}()

	connectNonce := ""
	connectSent := false

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			logger.Gateway.Warn().Err(err).Msg("readLoop: ReadMessage error, exiting")
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

			// Track event sequence numbers for gap detection
			if evt.Seq != nil {
				c.mu.Lock()
				if c.lastSeq != nil && *evt.Seq > *c.lastSeq+1 {
					logger.Gateway.Warn().
						Int("expected", *c.lastSeq+1).
						Int("received", *evt.Seq).
						Msg("event sequence gap detected, events may have been lost")
				}
				c.lastSeq = evt.Seq
				c.mu.Unlock()
			}

			if evt.Event == "tick" {
				c.mu.Lock()
				c.lastTick = time.Now()
				c.mu.Unlock()
				continue
			}

			c.dispatchEvent(evt.Event, evt.Payload)
			continue
		}

		if _, hasID := raw["id"]; hasID {
			var resp ResponseFrame
			if err := json.Unmarshal(message, &resp); err != nil {
				continue
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
			Platform:    runtime.GOOS,
			Mode:        "backend",
		},
		Role:   "operator",
		Scopes: cloneDefaultOperatorScopes(),
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

		// v3 payload includes platform and deviceFamily for metadata pinning
		platform := strings.ToLower(strings.TrimSpace(params.Client.Platform))
		deviceFamily := strings.ToLower(strings.TrimSpace(params.Client.DeviceFamily))
		payloadParts := []string{
			"v3",
			identity.DeviceID,
			params.Client.ID,
			params.Client.Mode,
			params.Role,
			scopesStr,
			fmt.Sprintf("%d", signedAt),
			token,
			nonce,
			platform,
			deviceFamily,
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
			c.lastError = ""
			c.lastTick = time.Now()
			// Parse snapshot.uptimeMs and policy.tickIntervalMs from hello-ok payload
			if resp.Payload != nil {
				var helloOk struct {
					Snapshot struct {
						UptimeMs int64 `json:"uptimeMs"`
					} `json:"snapshot"`
					Policy struct {
						TickIntervalMs int64 `json:"tickIntervalMs"`
					} `json:"policy"`
				}
				if json.Unmarshal(resp.Payload, &helloOk) == nil {
					if helloOk.Snapshot.UptimeMs > 0 {
						c.gwUptimeMs = helloOk.Snapshot.UptimeMs
						c.gwConnectedAt = time.Now()
					}
					if helloOk.Policy.TickIntervalMs > 0 {
						c.tickInterval = time.Duration(helloOk.Policy.TickIntervalMs) * time.Millisecond
					}
				}
			}
			reconnects := c.reconnectCount
			c.mu.Unlock()
			logEvt := logger.Log.Info().
				Str("host", c.cfg.Host).
				Int("port", c.cfg.Port)
			if reconnects > 0 {
				logEvt = logEvt.Int("reconnects", reconnects)
			}
			logEvt.Msg(i18n.T(i18n.MsgLogGatewayWsConnected))
			// Fetch gateway version after connect
			go c.fetchGatewayVersion()
			// Brief grace period after reconnect to avoid false health-check failures.
			// Never shorten an existing restart grace window (restartGracePeriod is longer).
			c.healthMu.Lock()
			if reconnects > 0 {
				reconnectGrace := time.Now().Add(10 * time.Second)
				if reconnectGrace.After(c.healthGraceUntil) {
					c.healthGraceUntil = reconnectGrace
				}
			}
			c.healthFailCount = 0
			c.clearPendingRestartSuccessNotifyLocked()
			// Fire lifecycle callback — distinguish initial connect from reconnect
			lcFn := c.onLifecycle
			c.healthMu.Unlock()
			if lcFn != nil {
				c.mu.Lock()
				isReconnect := c.reconnectCount > 0
				c.mu.Unlock()
				if isReconnect {
					go lcFn("reconnected", "")
				} else {
					go lcFn("connected", "")
				}
			}
		} else {
			msg := i18n.T(i18n.MsgGwclientUnknownError)
			var pairingRequestID string
			if resp != nil && resp.Error != nil {
				msg = resp.Error.Message
				pairingRequestID = resp.Error.extractPairingRequestID()
			} else if resp == nil {
				// Channel closed — usually means the server closed the connection
				// right after sending an error (e.g. "pairing required").
				msg = "connection closed by server (check gateway logs for pairing/auth errors)"
			}
			c.mu.Lock()
			c.lastError = msg
			// Pairing required: slow down to avoid rapid retries while
			// autoApprovePairing runs asynchronously.
			isPairing := strings.Contains(msg, "pairing required")
			if isPairing && c.backoffMs < 10000 {
				c.backoffMs = 10000
			}
			c.mu.Unlock()
			logger.Log.Error().Str("error", msg).Msg(i18n.T(i18n.MsgLogGatewayWsAuthFail))
			conn.Close()
			if isPairing && c.IsLocalGateway() {
				go c.autoApprovePairing(pairingRequestID)
			} else if isAuthError(msg) {
				go c.autoRefreshToken()
			}
		}
	case <-time.After(10 * time.Second):
		c.mu.Lock()
		c.lastError = "connect handshake timeout (10s)"
		c.mu.Unlock()
		logger.Log.Error().Msg(i18n.T(i18n.MsgLogGatewayWsConnectTimeout))
		conn.Close()
	case <-c.stopCh:
		return
	}
}

// autoApprovePairing approves a pending device pairing request for the local
// gateway. If hintRequestID is non-empty (extracted from the connect error
// details), it is used directly. Otherwise the function falls back to
// `openclaw devices approve --latest --json` to discover the request ID,
// then runs `openclaw devices approve <requestId>` to complete approval.
// This two-step flow is required since OpenClaw ≥2026.4.8 changed --latest
// to preview-only mode (exits 1 without approving).
// It is safe to call concurrently — only one run proceeds at a time.
func (c *GWClient) autoApprovePairing(hintRequestID string) {
	if !c.pairingApprovingMu.TryLock() {
		return
	}
	defer c.pairingApprovingMu.Unlock()

	c.mu.Lock()
	c.pairingAutoApprove = true
	c.lastError = "pairing required: auto-approving device..."
	c.mu.Unlock()

	logger.Log.Info().Str("hintRequestID", hintRequestID).
		Msg("local gateway requires device pairing — running auto-approve")

	// Brief wait to let the WS close frame complete before we write the approval file
	time.Sleep(600 * time.Millisecond)

	requestID := hintRequestID

	// If we don't have a requestId from the connect error details, discover it
	// via `openclaw devices approve --latest --json`.
	if requestID == "" {
		out, err := RunCLIWithTimeout("devices", "approve", "--latest", "--json")
		if err != nil {
			// --latest --json outputs JSON with the selected request info then exits 1.
			// Parse the output even on error to extract the requestId.
			requestID = extractRequestIDFromApproveLatest(out)
			if requestID == "" {
				// Also try listing pending devices as a final fallback
				listOut, listErr := RunCLIWithTimeout("devices", "list", "--json")
				if listErr == nil {
					requestID = extractLatestPendingRequestID(listOut)
				}
			}
		} else {
			// Older OpenClaw: --latest succeeded directly (pre-4.8 behavior)
			c.mu.Lock()
			c.pairingAutoApprove = false
			c.lastError = ""
			c.backoffMs = 1000
			c.mu.Unlock()
			logger.Log.Info().Msg("device pairing approved (legacy --latest) — triggering immediate reconnect")
			select {
			case c.reconnectNowCh <- struct{}{}:
			default:
			}
			return
		}
	}

	if requestID == "" {
		c.mu.Lock()
		c.pairingAutoApprove = false
		c.lastError = "pairing auto-approve failed: could not resolve request ID"
		c.mu.Unlock()
		logger.Log.Error().Msg("device pairing auto-approve failed: no requestId found")
		return
	}

	logger.Log.Info().Str("requestId", requestID).Msg("approving device pairing request")

	c.mu.Lock()
	c.lastError = fmt.Sprintf("pairing required: approving request %s...", requestID)
	c.mu.Unlock()

	_, err := RunCLIWithTimeout("devices", "approve", requestID)

	c.mu.Lock()
	c.pairingAutoApprove = false
	if err != nil {
		logger.Log.Error().Err(err).Str("requestId", requestID).Msg("device pairing auto-approve failed")
		c.lastError = fmt.Sprintf("pairing auto-approve failed: %v", err)
	} else {
		logger.Log.Info().Str("requestId", requestID).Msg("device pairing approved — triggering immediate reconnect")
		c.lastError = ""
		c.backoffMs = 1000
	}
	c.mu.Unlock()

	if err == nil {
		// Signal connectLoop to skip the current backoff sleep
		select {
		case c.reconnectNowCh <- struct{}{}:
		default:
		}
	}
}

// extractRequestIDFromApproveLatest parses the JSON output from
// `openclaw devices approve --latest --json` which returns:
// {"selected":{"requestId":"..."},"approveCommand":"..."}
func extractRequestIDFromApproveLatest(output string) string {
	output = strings.TrimSpace(output)
	if output == "" {
		return ""
	}
	// The CLI may prefix error text before the JSON; find the first '{'.
	idx := strings.Index(output, "{")
	if idx < 0 {
		return ""
	}
	output = output[idx:]
	var parsed struct {
		Selected struct {
			RequestID string `json:"requestId"`
		} `json:"selected"`
	}
	if json.Unmarshal([]byte(output), &parsed) == nil && parsed.Selected.RequestID != "" {
		return parsed.Selected.RequestID
	}
	return ""
}

// extractLatestPendingRequestID parses the JSON output from
// `openclaw devices list --json` and returns the most recent pending requestId.
func extractLatestPendingRequestID(output string) string {
	output = strings.TrimSpace(output)
	if output == "" {
		return ""
	}
	idx := strings.Index(output, "{")
	if idx < 0 {
		return ""
	}
	output = output[idx:]
	var parsed struct {
		Pending []struct {
			RequestID string `json:"requestId"`
			Ts        int64  `json:"ts"`
		} `json:"pending"`
	}
	if json.Unmarshal([]byte(output), &parsed) != nil || len(parsed.Pending) == 0 {
		return ""
	}
	latest := parsed.Pending[0]
	for _, p := range parsed.Pending[1:] {
		if p.Ts > latest.Ts {
			latest = p
		}
	}
	return latest.RequestID
}

// isAuthError returns true if the connect rejection message indicates a token/auth problem.
// It excludes protocol-level errors like "first request must be connect" which are caused
// by connectLoop races, not by invalid credentials.
func isAuthError(msg string) bool {
	// "first request must be connect" is a protocol race, not an auth problem.
	if strings.Contains(msg, "first request must be connect") {
		return false
	}
	return strings.Contains(msg, "invalid-handshake") ||
		strings.Contains(msg, "invalid handshake") ||
		strings.Contains(msg, "unauthorized") ||
		strings.Contains(msg, "invalid token") ||
		strings.Contains(msg, "token expired") ||
		strings.Contains(msg, "authentication failed")
}

// autoRefreshToken attempts to reload the gateway auth token from the OpenClaw
// config file and trigger an immediate reconnect. Called when a connect response
// returns an auth error (e.g. "invalid-handshake"). A 2-minute cooldown prevents
// repeated refresh storms when the token is genuinely invalid.
func (c *GWClient) autoRefreshToken() {
	if !c.authRefreshMu.TryLock() {
		return
	}
	defer c.authRefreshMu.Unlock()

	// Cooldown: don't attempt more than once every 2 minutes.
	c.mu.Lock()
	if !c.authRefreshAt.IsZero() && time.Since(c.authRefreshAt) < 2*time.Minute {
		c.mu.Unlock()
		return
	}
	c.authRefreshPending = true
	c.authRefreshAt = time.Now()
	c.mu.Unlock()

	defer func() {
		c.mu.Lock()
		c.authRefreshPending = false
		c.mu.Unlock()
	}()

	logger.Log.Info().Msg("gateway auth rejected (invalid-handshake) — attempting token refresh from config")

	// Brief wait to let the WS close frame propagate.
	time.Sleep(500 * time.Millisecond)

	newToken := readGatewayTokenFromConfig()

	c.mu.Lock()
	oldToken := c.cfg.Token
	tokenChanged := newToken != "" && newToken != oldToken
	logger.Log.Debug().
		Int("oldTokenLen", len(oldToken)).
		Int("newTokenLen", len(newToken)).
		Bool("tokenChanged", tokenChanged).
		Msg("autoRefreshToken: token comparison")
	if tokenChanged {
		c.cfg.Token = newToken
		c.backoffMs = 1000 // reset backoff so reconnect happens quickly
		c.lastError = ""
	} else {
		// Token unchanged or unavailable — slow down connectLoop to avoid storm.
		// Set backoff to 60s so the loop won't hammer the gateway every second.
		if c.backoffMs < 60000 {
			c.backoffMs = 60000
		}
	}
	notifyFn := c.onNotify
	c.mu.Unlock()

	if tokenChanged {
		logger.Log.Info().Msg("gateway token updated from config — triggering immediate reconnect")
		// Notify caller (e.g. serve.go) so it can persist the new token to DB.
		c.healthMu.Lock()
		refreshedFn := c.onTokenRefreshed
		c.healthMu.Unlock()
		if refreshedFn != nil {
			go refreshedFn(newToken)
		}
		// Skip current backoff sleep so the reconnect happens right away.
		select {
		case c.reconnectNowCh <- struct{}{}:
		default:
		}
	} else {
		// Token unchanged or unavailable — cannot auto-fix; notify the user.
		logger.Log.Warn().
			Int("configTokenLen", len(newToken)).
			Int("currentTokenLen", len(oldToken)).
			Msg("gateway auth rejected: token in config matches current token or is empty — manual reconnect required")
		if notifyFn != nil {
			go notifyFn("pairing_required", "Gateway authentication failed (invalid-handshake). Please update the gateway token in Settings → Gateway.")
		}
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

// fetchGatewayVersion calls the "status" RPC to retrieve the gateway version and caches it.
func (c *GWClient) fetchGatewayVersion() {
	data, err := c.Request("status", nil)
	if err != nil {
		return
	}
	var status struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data, &status); err == nil && status.Version != "" {
		caps := resolveProtocolCaps(status.Version)
		c.mu.Lock()
		c.gwVersion = status.Version
		c.protoCaps = caps
		c.mu.Unlock()
	}
}

func (c *GWClient) UseSessionKeyParam() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.protoCaps.UseKeyParam
}

func (c *GWClient) SessionSendParams(sessionKey, message string) map[string]interface{} {
	p := map[string]interface{}{
		"message": message,
	}
	if c.UseSessionKeyParam() {
		p["key"] = sessionKey
	} else {
		p["sessionKey"] = sessionKey
	}
	return p
}

func (c *GWClient) SessionAbortParams(sessionKey string, runID string) map[string]interface{} {
	p := map[string]interface{}{}
	if c.UseSessionKeyParam() {
		p["key"] = sessionKey
	} else {
		p["sessionKey"] = sessionKey
	}
	if runID != "" {
		p["runId"] = runID
	}
	return p
}

func (c *GWClient) ProtocolCapsInfo() map[string]interface{} {
	c.mu.Lock()
	defer c.mu.Unlock()
	return map[string]interface{}{
		"detected":    c.protoCaps.Detected,
		"useKeyParam": c.protoCaps.UseKeyParam,
		"version":     c.protoCaps.Version,
	}
}
