package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// GatewayHandler manages gateway lifecycle.
type GatewayHandler struct {
	svc       *openclaw.Service
	auditRepo *database.AuditLogRepo
	wsHub     *web.WSHub
	gwClient  *openclaw.GWClient
}

// SetGWClient injects the Gateway client reference.
func (h *GatewayHandler) SetGWClient(client *openclaw.GWClient) {
	h.gwClient = client
}

func NewGatewayHandler(svc *openclaw.Service, wsHub *web.WSHub) *GatewayHandler {
	return &GatewayHandler{
		svc:       svc,
		auditRepo: database.NewAuditLogRepo(),
		wsHub:     wsHub,
	}
}

// GatewayStatusResponse is the gateway status response.
type GatewayStatusResponse struct {
	Running bool   `json:"running"`
	Runtime string `json:"runtime"`
	Detail  string `json:"detail"`
	Host    string `json:"host,omitempty"`
	Port    int    `json:"port,omitempty"`
	Remote  bool   `json:"remote"`
}

// Status returns gateway running status.
func (h *GatewayHandler) Status(w http.ResponseWriter, r *http.Request) {
	st := h.svc.Status()
	web.OK(w, r, GatewayStatusResponse{
		Running: st.Running,
		Runtime: string(st.Runtime),
		Detail:  st.Detail,
		Host:    h.svc.GatewayHost,
		Port:    h.svc.GatewayPort,
		Remote:  h.svc.IsRemote(),
	})
}

// Start starts the gateway.
func (h *GatewayHandler) Start(w http.ResponseWriter, r *http.Request) {
	logger.Gateway.Info().
		Str("user", web.GetUsername(r)).
		Str("ip", r.RemoteAddr).
		Msg("user requested gateway start")

	if err := h.svc.Start(); err != nil {
		h.writeAudit(r, constants.ActionGatewayStart, "failed", err.Error())
		logger.Gateway.Error().Err(err).Msg("gateway start failed")
		web.FailErr(w, r, web.ErrGWStartFailed, err.Error())
		return
	}

	h.writeAudit(r, constants.ActionGatewayStart, "success", "")
	h.broadcastStatus()

	logger.Gateway.Info().Msg("gateway started")
	web.OK(w, r, map[string]string{"message": "ok"})
}

// Stop stops the gateway.
func (h *GatewayHandler) Stop(w http.ResponseWriter, r *http.Request) {
	logger.Gateway.Info().
		Str("user", web.GetUsername(r)).
		Str("ip", r.RemoteAddr).
		Msg("user requested gateway stop")

	if err := h.svc.Stop(); err != nil {
		h.writeAudit(r, constants.ActionGatewayStop, "failed", err.Error())
		logger.Gateway.Error().Err(err).Msg("gateway stop failed")
		web.FailErr(w, r, web.ErrGWStopFailed, err.Error())
		return
	}

	h.writeAudit(r, constants.ActionGatewayStop, "success", "")
	h.broadcastStatus()

	logger.Gateway.Info().Msg("gateway stopped")
	web.OK(w, r, map[string]string{"message": "ok"})
}

// Restart restarts the gateway.
func (h *GatewayHandler) Restart(w http.ResponseWriter, r *http.Request) {
	logger.Gateway.Info().
		Str("user", web.GetUsername(r)).
		Str("ip", r.RemoteAddr).
		Msg("user requested gateway restart")

	before := h.svc.Status()
	startedAt := time.Now().UTC()

	if err := h.svc.Restart(); err != nil {
		h.writeAudit(r, constants.ActionGatewayRestart, "failed", err.Error())
		logger.Gateway.Error().Err(err).Msg("gateway restart failed")
		web.FailErr(w, r, web.ErrGWRestartFailed, err.Error())
		return
	}

	after := h.svc.Status()
	h.writeAudit(r, constants.ActionGatewayRestart, "success", "")
	h.broadcastStatus()

	logger.Gateway.Info().Msg("gateway restarted")
	web.OK(w, r, map[string]interface{}{
		"message": "ok",
		"code":    "GW_RESTART_OK",
		"observability": map[string]interface{}{
			"requested_at": startedAt.Format(time.RFC3339),
			"duration_ms":  time.Since(startedAt).Milliseconds(),
			"before": map[string]interface{}{
				"running": before.Running,
				"runtime": string(before.Runtime),
				"detail":  before.Detail,
			},
			"after": map[string]interface{}{
				"running": after.Running,
				"runtime": string(after.Runtime),
				"detail":  after.Detail,
			},
		},
		"diagnosis": map[string]interface{}{
			"suggested": false,
			"hint":      "",
		},
	})
}

// Kill triggers the kill switch — force-stops the gateway.
func (h *GatewayHandler) Kill(w http.ResponseWriter, r *http.Request) {
	logger.Gateway.Warn().
		Str("user", web.GetUsername(r)).
		Str("ip", r.RemoteAddr).
		Msg("kill switch triggered")

	if err := h.svc.Stop(); err != nil {
		h.writeAudit(r, constants.ActionKillSwitch, "failed", err.Error())
		logger.Gateway.Error().Err(err).Msg("kill switch failed")
		web.FailErr(w, r, web.ErrGWStopFailed, err.Error())
		return
	}

	h.writeAudit(r, constants.ActionKillSwitch, "success", "kill switch")

	// broadcast kill switch event
	h.wsHub.Broadcast("alert", "kill_switch", map[string]interface{}{
		"triggered_by": web.GetUsername(r),
		"timestamp":    time.Now().UTC().Format(time.RFC3339),
	})
	h.broadcastStatus()

	logger.Gateway.Warn().Msg("kill switch executed, gateway stopped")
	web.OK(w, r, map[string]string{"message": "ok"})
}

// GetHealthCheck returns health check status.
func (h *GatewayHandler) GetHealthCheck(w http.ResponseWriter, r *http.Request) {
	if h.gwClient == nil {
		web.OK(w, r, map[string]interface{}{"enabled": false})
		return
	}
	web.OK(w, r, h.gwClient.HealthStatus())
}

// SetHealthCheck toggles the health check.
func (h *GatewayHandler) SetHealthCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled               bool `json:"enabled"`
		IntervalSec           *int `json:"interval_sec,omitempty"`
		MaxFails              *int `json:"max_fails,omitempty"`
		ReconnectBackoffCapMs *int `json:"reconnect_backoff_cap_ms,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.IntervalSec != nil && (*req.IntervalSec < 5 || *req.IntervalSec > 300) {
		web.Fail(w, r, "INVALID_PARAM", "interval_sec must be between 5 and 300", http.StatusBadRequest)
		return
	}
	if req.MaxFails != nil && (*req.MaxFails < 1 || *req.MaxFails > 20) {
		web.Fail(w, r, "INVALID_PARAM", "max_fails must be between 1 and 20", http.StatusBadRequest)
		return
	}
	if req.ReconnectBackoffCapMs != nil && (*req.ReconnectBackoffCapMs < 1000 || *req.ReconnectBackoffCapMs > 120000) {
		web.Fail(w, r, "INVALID_PARAM", "reconnect_backoff_cap_ms must be between 1000 and 120000", http.StatusBadRequest)
		return
	}

	intervalSec := 30
	maxFails := 3
	backoffCapMs := 30000
	if req.IntervalSec != nil {
		intervalSec = *req.IntervalSec
	}
	if req.MaxFails != nil {
		maxFails = *req.MaxFails
	}
	if req.ReconnectBackoffCapMs != nil {
		backoffCapMs = *req.ReconnectBackoffCapMs
	}
	if h.gwClient != nil {
		h.gwClient.SetHealthCheckEnabled(req.Enabled)
		h.gwClient.SetHealthCheckIntervalSeconds(intervalSec)
		h.gwClient.SetHealthCheckMaxFails(maxFails)
		h.gwClient.SetReconnectBackoffCapMs(backoffCapMs)
		intervalSec, maxFails, backoffCapMs = h.gwClient.GetHealthCheckConfig()
	}

	// persist to settings table
	settingRepo := database.NewSettingRepo()
	val := "false"
	if req.Enabled {
		val = "true"
	}
	settingRepo.SetBatch(map[string]string{
		"gateway_health_check_enabled":      val,
		"gateway_health_check_interval_sec": strconv.Itoa(intervalSec),
		"gateway_health_check_max_fails":    strconv.Itoa(maxFails),
		"gateway_reconnect_backoff_cap_ms":  strconv.Itoa(backoffCapMs),
	})

	h.writeAudit(r, constants.ActionSettingsUpdate, "success",
		"watchdog auto-restart: "+val)

	logger.Gateway.Info().
		Bool("enabled", req.Enabled).
		Int("interval_sec", intervalSec).
		Int("max_fails", maxFails).
		Int("reconnect_backoff_cap_ms", backoffCapMs).
		Msg("watchdog setting updated")
	web.OK(w, r, map[string]interface{}{
		"enabled":                  req.Enabled,
		"interval_sec":             intervalSec,
		"max_fails":                maxFails,
		"reconnect_backoff_cap_ms": backoffCapMs,
	})
}

// writeAudit writes an audit log entry.
func (h *GatewayHandler) writeAudit(r *http.Request, action, result, detail string) {
	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   action,
		Result:   result,
		Detail:   detail,
		IP:       r.RemoteAddr,
	})
}

// broadcastStatus broadcasts gateway status via WebSocket.
func (h *GatewayHandler) broadcastStatus() {
	st := h.svc.Status()
	h.wsHub.Broadcast("gateway_status", "gateway_status", GatewayStatusResponse{
		Running: st.Running,
		Runtime: string(st.Runtime),
		Detail:  st.Detail,
	})
}

// DaemonStatus returns the OS-level service registration state.
func (h *GatewayHandler) DaemonStatus(w http.ResponseWriter, r *http.Request) {
	result := h.svc.DaemonStatus()
	web.OK(w, r, result)
}

// DaemonInstall registers the gateway as an OS-level service.
func (h *GatewayHandler) DaemonInstall(w http.ResponseWriter, r *http.Request) {
	logger.Gateway.Info().
		Str("user", web.GetUsername(r)).
		Str("ip", r.RemoteAddr).
		Msg("user requested daemon install")

	if err := h.svc.DaemonInstall(); err != nil {
		h.writeAudit(r, constants.ActionGatewayStart, "failed", "daemon install: "+err.Error())
		logger.Gateway.Error().Err(err).Msg("daemon install failed")
		web.FailErr(w, r, web.ErrDaemonInstallFailed, err.Error())
		return
	}

	h.writeAudit(r, constants.ActionGatewayStart, "success", "daemon installed")
	logger.Gateway.Info().Msg("daemon installed")
	web.OK(w, r, h.svc.DaemonStatus())
}

// DaemonUninstall removes the OS-level service registration.
func (h *GatewayHandler) DaemonUninstall(w http.ResponseWriter, r *http.Request) {
	logger.Gateway.Info().
		Str("user", web.GetUsername(r)).
		Str("ip", r.RemoteAddr).
		Msg("user requested daemon uninstall")

	if err := h.svc.DaemonUninstall(); err != nil {
		h.writeAudit(r, constants.ActionGatewayStop, "failed", "daemon uninstall: "+err.Error())
		logger.Gateway.Error().Err(err).Msg("daemon uninstall failed")
		web.FailErr(w, r, web.ErrDaemonUninstallFailed, err.Error())
		return
	}

	h.writeAudit(r, constants.ActionGatewayStop, "success", "daemon uninstalled")
	logger.Gateway.Info().Msg("daemon uninstalled")
	web.OK(w, r, h.svc.DaemonStatus())
}
