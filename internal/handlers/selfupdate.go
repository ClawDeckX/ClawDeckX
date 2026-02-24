package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/updater"
	"ClawDeckX/internal/version"
	"ClawDeckX/internal/web"
)

// SelfUpdateHandler handles self-update API endpoints.
type SelfUpdateHandler struct {
	auditRepo *database.AuditLogRepo
}

func NewSelfUpdateHandler() *SelfUpdateHandler {
	return &SelfUpdateHandler{
		auditRepo: database.NewAuditLogRepo(),
	}
}

// Check queries GitHub for a newer release.
func (h *SelfUpdateHandler) Check(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	result, err := updater.CheckForUpdate(ctx)
	if err != nil {
		web.Fail(w, r, "UPDATE_CHECK_FAILED", err.Error(), http.StatusInternalServerError)
		return
	}

	web.OK(w, r, result)
}

// Apply downloads and applies the update, streaming progress via SSE.
func (h *SelfUpdateHandler) Apply(w http.ResponseWriter, r *http.Request) {
	// Parse request body for download URL
	var body struct {
		DownloadURL string `json:"downloadUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.DownloadURL == "" {
		web.Fail(w, r, "UPDATE_BAD_REQUEST", "downloadUrl is required", http.StatusBadRequest)
		return
	}

	// Set up SSE
	flusher, ok := w.(http.Flusher)
	if !ok {
		web.Fail(w, r, "UPDATE_SSE_UNSUPPORTED", "streaming not supported", http.StatusInternalServerError)
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

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()

	err := updater.ApplyUpdate(ctx, body.DownloadURL, func(p updater.ApplyProgress) {
		sendSSE(p)
	})

	if err != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID: web.GetUserID(r), Username: web.GetUsername(r),
			Action: constants.ActionSelfUpdate, Result: "failed", Detail: err.Error(), IP: r.RemoteAddr,
		})
		sendSSE(updater.ApplyProgress{Stage: "error", Error: err.Error()})
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID: web.GetUserID(r), Username: web.GetUsername(r),
		Action: constants.ActionSelfUpdate, Result: "success", Detail: "update applied", IP: r.RemoteAddr,
	})

	// Send final success
	sendSSE(updater.ApplyProgress{Stage: "done", Percent: 100, Done: true})

	// Schedule restart after a short delay
	go func() {
		time.Sleep(2 * time.Second)
		restartSelf()
	}()
}

// Info returns current version and build info.
func (h *SelfUpdateHandler) Info(w http.ResponseWriter, r *http.Request) {
	web.OK(w, r, map[string]interface{}{
		"version":  version.Version,
		"build":    version.Build,
		"os":       runtime.GOOS,
		"arch":     runtime.GOARCH,
		"platform": platformName(),
	})
}

func platformName() string {
	switch runtime.GOOS {
	case "darwin":
		return "macOS"
	case "linux":
		return "Linux"
	case "windows":
		return "Windows"
	default:
		return runtime.GOOS
	}
}

// restartSelf restarts the current process.
func restartSelf() {
	exe, err := os.Executable()
	if err != nil {
		return
	}

	if runtime.GOOS == "windows" {
		// On Windows, start a new process and exit
		cmd := exec.Command(exe, os.Args[1:]...)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Start()
		os.Exit(0)
	} else {
		// On Unix, exec replaces the current process
		execErr := execSyscall(exe, os.Args, os.Environ())
		if execErr != nil {
			// Fallback: start new process
			cmd := exec.Command(exe, os.Args[1:]...)
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			cmd.Start()
			os.Exit(0)
		}
	}
}
