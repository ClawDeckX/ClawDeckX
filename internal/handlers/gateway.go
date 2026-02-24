package handlers

import (
	"encoding/json"
	"net/http"
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

	if err := h.svc.Restart(); err != nil {
		h.writeAudit(r, constants.ActionGatewayRestart, "failed", err.Error())
		logger.Gateway.Error().Err(err).Msg("gateway restart failed")
		web.FailErr(w, r, web.ErrGWStartFailed, err.Error())
		return
	}

	h.writeAudit(r, constants.ActionGatewayRestart, "success", "")
	h.broadcastStatus()

	logger.Gateway.Info().Msg("gateway restarted")
	web.OK(w, r, map[string]string{"message": "ok"})
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
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if h.gwClient != nil {
		h.gwClient.SetHealthCheckEnabled(req.Enabled)
	}

	// persist to settings table
	settingRepo := database.NewSettingRepo()
	val := "false"
	if req.Enabled {
		val = "true"
	}
	settingRepo.SetBatch(map[string]string{
		"gateway_health_check_enabled": val,
	})

	h.writeAudit(r, constants.ActionSettingsUpdate, "success",
		"health check auto-restart: "+val)

	logger.Gateway.Info().Bool("enabled", req.Enabled).Msg("health check setting updated")
	web.OK(w, r, map[string]interface{}{"enabled": req.Enabled})
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
