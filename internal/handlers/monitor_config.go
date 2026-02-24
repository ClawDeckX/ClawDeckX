package handlers

import (
	"encoding/json"
	"net/http"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/monitor"
	"ClawDeckX/internal/web"
	"ClawDeckX/internal/webconfig"
)

// MonitorConfigHandler manages monitor configuration.
type MonitorConfigHandler struct {
	auditRepo *database.AuditLogRepo
	monSvc    *monitor.Service
	cfg       *webconfig.Config
}

func NewMonitorConfigHandler(monSvc *monitor.Service, cfg *webconfig.Config) *MonitorConfigHandler {
	return &MonitorConfigHandler{
		auditRepo: database.NewAuditLogRepo(),
		monSvc:    monSvc,
		cfg:       cfg,
	}
}

// GetConfig returns monitor configuration.
func (h *MonitorConfigHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	web.OK(w, r, map[string]interface{}{
		"interval_seconds":  h.cfg.Monitor.IntervalSeconds,
		"auto_restart":      h.cfg.Monitor.AutoRestart,
		"max_restart_count": h.cfg.Monitor.MaxRestartCount,
		"config_path":       h.cfg.OpenClaw.ConfigPath,
		"running":           h.monSvc.IsRunning(),
	})
}

// UpdateConfig updates monitor configuration.
func (h *MonitorConfigHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IntervalSeconds *int    `json:"interval_seconds,omitempty"`
		AutoRestart     *bool   `json:"auto_restart,omitempty"`
		MaxRestartCount *int    `json:"max_restart_count,omitempty"`
		ConfigPath      *string `json:"config_path,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	changed := false
	if req.IntervalSeconds != nil && *req.IntervalSeconds >= 5 {
		h.cfg.Monitor.IntervalSeconds = *req.IntervalSeconds
		changed = true
	}
	if req.AutoRestart != nil {
		h.cfg.Monitor.AutoRestart = *req.AutoRestart
		changed = true
	}
	if req.MaxRestartCount != nil {
		h.cfg.Monitor.MaxRestartCount = *req.MaxRestartCount
		changed = true
	}
	if req.ConfigPath != nil && *req.ConfigPath != "" {
		h.cfg.OpenClaw.ConfigPath = *req.ConfigPath
		changed = true
	}

	if !changed {
		web.FailErr(w, r, web.ErrConfigEmpty)
		return
	}

	if err := webconfig.Save(*h.cfg); err != nil {
		logger.Log.Error().Err(err).Msg("failed to save monitor config")
		web.FailErr(w, r, web.ErrConfigWriteFailed, err.Error())
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   "monitor.config.update",
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	logger.Log.Info().Str("user", web.GetUsername(r)).Msg("monitor config updated")
	web.OK(w, r, map[string]string{"message": "ok"})
}

// StartMonitor starts the monitor service.
func (h *MonitorConfigHandler) StartMonitor(w http.ResponseWriter, r *http.Request) {
	if h.monSvc.IsRunning() {
		web.Fail(w, r, "ALREADY_RUNNING", "monitor service already running", http.StatusConflict)
		return
	}
	go h.monSvc.Start()

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   "monitor.start",
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	web.OK(w, r, map[string]string{"message": "ok"})
}

// StopMonitor stops the monitor service.
func (h *MonitorConfigHandler) StopMonitor(w http.ResponseWriter, r *http.Request) {
	if !h.monSvc.IsRunning() {
		web.FailErr(w, r, web.ErrMonitorNotRunning)
		return
	}
	h.monSvc.Stop()

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   "monitor.stop",
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	web.OK(w, r, map[string]string{"message": "ok"})
}
