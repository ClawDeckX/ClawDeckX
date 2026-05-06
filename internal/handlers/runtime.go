package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/runtime"
	"ClawDeckX/internal/updater"
	"ClawDeckX/internal/web"
)

// CollectorPauser can pause and resume a monitor collector.
type CollectorPauser interface {
	Pause()
	Resume()
}

// GatewayRestarter can restart the OpenClaw gateway process.
type GatewayRestarter interface {
	Restart() error
}

// RuntimeHandler handles Docker runtime overlay API endpoints.
type RuntimeHandler struct {
	mgr       *runtime.Manager
	auditRepo *database.AuditLogRepo
	collector CollectorPauser
	gwSvc     GatewayRestarter
}

// NewRuntimeHandler creates a RuntimeHandler with the given runtime manager.
func NewRuntimeHandler(mgr *runtime.Manager) *RuntimeHandler {
	return &RuntimeHandler{
		mgr:       mgr,
		auditRepo: database.NewAuditLogRepo(),
	}
}

// SetCollector injects the GWCollector so it can be paused during upgrades.
func (h *RuntimeHandler) SetCollector(c CollectorPauser) {
	h.collector = c
}

// SetGatewayService injects the gateway service for restarting after upgrades.
func (h *RuntimeHandler) SetGatewayService(svc GatewayRestarter) {
	h.gwSvc = svc
}

// Status returns the runtime overlay status for both components.
// GET /api/v1/runtime/status
func (h *RuntimeHandler) Status(w http.ResponseWriter, r *http.Request) {
	if h.mgr == nil {
		web.Fail(w, r, "RUNTIME_NOT_AVAILABLE", "runtime manager not initialized", http.StatusServiceUnavailable)
		return
	}
	web.OK(w, r, h.mgr.GetAllStatus())
}

// UpdateClawDeckX downloads and installs a ClawDeckX binary to the runtime overlay.
// POST /api/v1/runtime/clawdeckx/update  { "downloadUrl": "..." }
func (h *RuntimeHandler) UpdateClawDeckX(w http.ResponseWriter, r *http.Request) {
	if h.mgr == nil {
		web.Fail(w, r, "RUNTIME_NOT_AVAILABLE", "runtime manager not initialized", http.StatusServiceUnavailable)
		return
	}

	var body struct {
		DownloadURL string `json:"downloadUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.DownloadURL == "" {
		web.Fail(w, r, "INVALID_PARAMS", "downloadUrl is required", http.StatusBadRequest)
		return
	}

	// SSE streaming
	flusher, ok := w.(http.Flusher)
	if !ok {
		web.Fail(w, r, "SSE_UNSUPPORTED", "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	sendSSE := func(p updater.ApplyProgress) {
		data, _ := json.Marshal(p)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	// Pause the GWCollector during self-update to reduce CPU contention.
	if h.collector != nil {
		h.collector.Pause()
		defer h.collector.Resume()
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()

	err := h.mgr.InstallClawDeckX(ctx, body.DownloadURL, sendSSE)
	if err != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID: web.GetUserID(r), Username: web.GetUsername(r),
			Action: constants.ActionRuntimeUpdate, Result: "failed",
			Detail: "clawdeckx: " + err.Error(), IP: r.RemoteAddr,
		})
		sendSSE(updater.ApplyProgress{Stage: "error", Error: err.Error()})
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID: web.GetUserID(r), Username: web.GetUsername(r),
		Action: constants.ActionRuntimeUpdate, Result: "success",
		Detail: "clawdeckx runtime overlay updated", IP: r.RemoteAddr,
	})

	logger.Log.Info().
		Str("user", web.GetUsername(r)).
		Msg("ClawDeckX runtime overlay updated via API, scheduling restart")

	// Read the overlay binary path from the manifest and restart with it.
	// restartSelf() would re-exec os.Executable() (the old image binary),
	// so we must use the overlay path explicitly.
	overlayBin := ""
	if mf, err := h.mgr.ReadManifest(runtime.ComponentClawDeckX); err == nil && mf != nil {
		overlayBin = mf.BinaryPath
	}

	go func() {
		time.Sleep(2 * time.Second)
		if overlayBin != "" {
			restartWithBinary(overlayBin)
		} else {
			restartSelf()
		}
	}()
}

// UpdateOpenClaw installs OpenClaw@latest into the runtime overlay via npm.
// POST /api/v1/runtime/openclaw/update
func (h *RuntimeHandler) UpdateOpenClaw(w http.ResponseWriter, r *http.Request) {
	if h.mgr == nil {
		web.Fail(w, r, "RUNTIME_NOT_AVAILABLE", "runtime manager not initialized", http.StatusServiceUnavailable)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		web.Fail(w, r, "SSE_UNSUPPORTED", "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	sendSSE := func(p updater.ApplyProgress) {
		data, _ := json.Marshal(p)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	// Pause the GWCollector during upgrade to avoid wasted CPU on RPC calls
	// that will fail while npm is running and the gateway is restarting.
	if h.collector != nil {
		h.collector.Pause()
		defer h.collector.Resume()
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()

	tag := ""
	if r.Body != nil {
		var body struct {
			Tag string `json:"tag"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err == nil {
			tag = body.Tag
		}
	}

	err := h.mgr.InstallOpenClaw(ctx, tag, sendSSE)
	if err != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID: web.GetUserID(r), Username: web.GetUsername(r),
			Action: constants.ActionRuntimeUpdate, Result: "failed",
			Detail: "openclaw: " + err.Error(), IP: r.RemoteAddr,
		})
		sendSSE(updater.ApplyProgress{Stage: "error", Error: err.Error()})
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID: web.GetUserID(r), Username: web.GetUsername(r),
		Action: constants.ActionRuntimeUpdate, Result: "success",
		Detail: "openclaw runtime overlay updated", IP: r.RemoteAddr,
	})

	logger.Log.Info().
		Str("user", web.GetUsername(r)).
		Msg("OpenClaw runtime overlay updated via API")

	// Auto-restart the gateway so the new version takes effect immediately.
	if h.gwSvc != nil {
		sendSSE(updater.ApplyProgress{Stage: "restarting_gateway", Percent: 95})
		if err := h.gwSvc.Restart(); err != nil {
			logger.Log.Warn().Err(err).Msg("gateway restart after OpenClaw upgrade failed")
			sendSSE(updater.ApplyProgress{Stage: "gateway_restart_failed", Error: err.Error()})
		} else {
			logger.Log.Info().Msg("gateway restarted after OpenClaw upgrade")
		}
	}
}

// Restart exits the process so Docker's restart policy brings the container back
// with the entrypoint re-executing, picking up any updated overlay binaries.
// POST /api/v1/runtime/restart
func (h *RuntimeHandler) Restart(w http.ResponseWriter, r *http.Request) {
	if h.mgr == nil {
		web.Fail(w, r, "RUNTIME_NOT_AVAILABLE", "runtime manager not initialized", http.StatusServiceUnavailable)
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID: web.GetUserID(r), Username: web.GetUsername(r),
		Action: constants.ActionRuntimeRestart, Result: "success",
		Detail: "Docker container restart requested", IP: r.RemoteAddr,
	})

	logger.Log.Info().
		Str("user", web.GetUsername(r)).
		Msg("Docker container restart requested via API")

	web.OK(w, r, map[string]interface{}{
		"message": "restarting",
	})

	// Exit after a short delay so the HTTP response is flushed.
	// Docker's restart policy (unless-stopped / always / on-failure) will bring the container back.
	go func() {
		time.Sleep(2 * time.Second)
		logger.Log.Info().Msg("Terminating container init process for Docker container restart")
		if terminateContainerInit() {
			return
		}
		os.Exit(1)
	}()
}

// Rollback removes the runtime overlay for a component, reverting to image version.
// POST /api/v1/runtime/{component}/rollback
func (h *RuntimeHandler) Rollback(w http.ResponseWriter, r *http.Request) {
	if h.mgr == nil {
		web.Fail(w, r, "RUNTIME_NOT_AVAILABLE", "runtime manager not initialized", http.StatusServiceUnavailable)
		return
	}

	var body struct {
		Component string `json:"component"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		web.Fail(w, r, "INVALID_PARAMS", "component is required", http.StatusBadRequest)
		return
	}

	var comp runtime.Component
	switch body.Component {
	case "clawdeckx":
		comp = runtime.ComponentClawDeckX
	case "openclaw":
		comp = runtime.ComponentOpenClaw
	default:
		web.Fail(w, r, "INVALID_PARAMS", "component must be 'clawdeckx' or 'openclaw'", http.StatusBadRequest)
		return
	}

	if err := h.mgr.Rollback(comp); err != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID: web.GetUserID(r), Username: web.GetUsername(r),
			Action: constants.ActionRuntimeRollback, Result: "failed",
			Detail: body.Component + ": " + err.Error(), IP: r.RemoteAddr,
		})
		web.Fail(w, r, "ROLLBACK_FAILED", err.Error(), http.StatusInternalServerError)
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID: web.GetUserID(r), Username: web.GetUsername(r),
		Action: constants.ActionRuntimeRollback, Result: "success",
		Detail: body.Component + " rolled back to image version", IP: r.RemoteAddr,
	})

	if comp == runtime.ComponentOpenClaw && h.gwSvc != nil {
		if err := h.gwSvc.Restart(); err != nil {
			logger.Log.Warn().Err(err).Msg("gateway restart after OpenClaw rollback failed")
		} else {
			logger.Log.Info().Msg("gateway restarted after OpenClaw rollback")
		}
	}

	web.OK(w, r, map[string]interface{}{
		"message": body.Component + " rolled back to image version",
		"status":  h.mgr.GetStatus(comp),
	})
}
