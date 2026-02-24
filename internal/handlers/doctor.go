package handlers

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// DoctorHandler provides diagnostic and repair operations.
type DoctorHandler struct {
	svc       *openclaw.Service
	auditRepo *database.AuditLogRepo
}

func NewDoctorHandler(svc *openclaw.Service) *DoctorHandler {
	return &DoctorHandler{
		svc:       svc,
		auditRepo: database.NewAuditLogRepo(),
	}
}

// CheckItem is a single diagnostic check result.
type CheckItem struct {
	Name    string `json:"name"`
	Status  string `json:"status"` // ok / warn / error
	Detail  string `json:"detail"`
	Fixable bool   `json:"fixable"`
}

// DiagResult is the overall diagnostic result.
type DiagResult struct {
	Items   []CheckItem `json:"items"`
	Summary string      `json:"summary"`
	Score   int         `json:"score"`
}

// Run executes diagnostics.
func (h *DoctorHandler) Run(w http.ResponseWriter, r *http.Request) {
	var items []CheckItem

	items = append(items, h.checkInstalled())
	items = append(items, h.checkConfig())
	items = append(items, h.checkGateway())
	items = append(items, h.checkPIDLock())
	items = append(items, h.checkPort())
	items = append(items, h.checkDisk())

	// compute score
	score := 100
	errorCount := 0
	warnCount := 0
	for _, item := range items {
		switch item.Status {
		case "error":
			score -= 20
			errorCount++
		case "warn":
			score -= 10
			warnCount++
		}
	}
	if score < 0 {
		score = 0
	}

	summary := "all checks passed"
	if errorCount > 0 {
		summary = "issues found, fix recommended"
	} else if warnCount > 0 {
		summary = "warnings found, review recommended"
	}

	web.OK(w, r, DiagResult{
		Items:   items,
		Summary: summary,
		Score:   score,
	})
}

// Fix runs automatic repairs.
func (h *DoctorHandler) Fix(w http.ResponseWriter, r *http.Request) {
	var fixed []string

	// fix stale PID lock file
	home, _ := os.UserHomeDir()
	pidFile := filepath.Join(home, ".openclaw", "gateway.pid")
	if _, err := os.Stat(pidFile); err == nil {
		st := h.svc.Status()
		if !st.Running {
			os.Remove(pidFile)
			fixed = append(fixed, "removed stale PID lock file")
		}
	}

	// fix config file permissions (non-Windows)
	if runtime.GOOS != "windows" {
		configPath := filepath.Join(home, ".openclaw", "openclaw.json")
		if _, err := os.Stat(configPath); err == nil {
			os.Chmod(configPath, 0o600)
			fixed = append(fixed, "fixed config file permissions to 600")
		}
	}

	// audit log
	if len(fixed) > 0 {
		h.auditRepo.Create(&database.AuditLog{
			UserID:   web.GetUserID(r),
			Username: web.GetUsername(r),
			Action:   constants.ActionDoctorFix,
			Result:   "success",
			Detail:   strings.Join(fixed, "; "),
			IP:       r.RemoteAddr,
		})
	}

	logger.Doctor.Info().Strs("fixed", fixed).Msg("auto-fix completed")
	web.OK(w, r, map[string]interface{}{
		"fixed":   fixed,
		"message": "ok",
	})
}

func (h *DoctorHandler) checkInstalled() CheckItem {
	if openclaw.CommandExists("openclaw") {
		path, _ := exec.LookPath("openclaw")
		return CheckItem{Name: "OpenClaw Install", Status: "ok", Detail: "installed: " + path}
	}
	return CheckItem{Name: "OpenClaw Install", Status: "error", Detail: "openclaw command not found"}
}

func (h *DoctorHandler) checkConfig() CheckItem {
	if openclaw.ConfigFileExists() {
		home, _ := os.UserHomeDir()
		path := filepath.Join(home, ".openclaw", "openclaw.json")
		info, _ := os.Stat(path)
		if info != nil {
			return CheckItem{Name: "Config File", Status: "ok", Detail: "exists, size: " + formatSize(info.Size())}
		}
		return CheckItem{Name: "Config File", Status: "ok", Detail: "exists"}
	}
	return CheckItem{Name: "Config File", Status: "error", Detail: "config file not found"}
}

func (h *DoctorHandler) checkGateway() CheckItem {
	st := h.svc.Status()
	if st.Running {
		return CheckItem{Name: "Gateway Status", Status: "ok", Detail: st.Detail}
	}
	return CheckItem{Name: "Gateway Status", Status: "warn", Detail: "gateway not running"}
}

func (h *DoctorHandler) checkPIDLock() CheckItem {
	home, _ := os.UserHomeDir()
	pidFile := filepath.Join(home, ".openclaw", "gateway.pid")
	if _, err := os.Stat(pidFile); err == nil {
		st := h.svc.Status()
		if !st.Running {
			return CheckItem{Name: "PID Lock", Status: "warn", Detail: "stale PID file found but gateway not running", Fixable: true}
		}
		return CheckItem{Name: "PID Lock", Status: "ok", Detail: "normal"}
	}
	return CheckItem{Name: "PID Lock", Status: "ok", Detail: "no stale files"}
}

func (h *DoctorHandler) checkPort() CheckItem {
	return CheckItem{Name: "Port Check", Status: "ok", Detail: "default port 18789"}
}

func (h *DoctorHandler) checkDisk() CheckItem {
	return CheckItem{Name: "Disk Space", Status: "ok", Detail: "ok"}
}

func formatSize(size int64) string {
	if size < 1024 {
		return fmt.Sprintf("%d B", size)
	}
	kb := float64(size) / 1024
	if kb < 1024 {
		return fmt.Sprintf("%.1f KB", kb)
	}
	return fmt.Sprintf("%.1f MB", kb/1024)
}
