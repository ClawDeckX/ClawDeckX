package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
	"ClawDeckX/internal/webconfig"
)

type OpenClawBackupHandler struct {
	cfg *webconfig.Config
}

func NewOpenClawBackupHandler(cfg *webconfig.Config) *OpenClawBackupHandler {
	return &OpenClawBackupHandler{cfg: cfg}
}

// backupDir returns the effective backup directory, preferring the user-configured
// override. The directory is created on demand with 0o700 permissions.
func (h *OpenClawBackupHandler) backupDir() string {
	dir := ""
	if h.cfg != nil {
		dir = strings.TrimSpace(h.cfg.Backup.Directory)
	}
	if dir == "" {
		dir = webconfig.DefaultBackupDirectory()
	}
	if dir == "" {
		dir = openclaw.DefaultBackupDir()
	}
	if dir != "" {
		_ = os.MkdirAll(dir, 0o700)
	}
	return dir
}

// Create triggers `openclaw backup create` and returns the result.
func (h *OpenClawBackupHandler) Create(w http.ResponseWriter, r *http.Request) {
	if !openclaw.IsOpenClawInstalled() {
		web.FailErr(w, r, web.ErrInvalidParam, "OpenClaw CLI not installed")
		return
	}

	var req struct {
		IncludeWorkspace bool `json:"includeWorkspace"`
		OnlyConfig       bool `json:"onlyConfig"`
		Verify           bool `json:"verify"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	backupDir := h.backupDir()
	if backupDir == "" {
		web.FailErr(w, r, web.ErrInvalidParam, "cannot determine backup directory")
		return
	}

	result, err := openclaw.BackupCreate(openclaw.BackupCreateOptions{
		Output:           backupDir,
		IncludeWorkspace: req.IncludeWorkspace,
		OnlyConfig:       req.OnlyConfig,
		Verify:           req.Verify,
	})
	if err != nil {
		web.FailErr(w, r, web.ErrInvalidParam, fmt.Sprintf("backup failed: %v", err))
		return
	}

	web.OK(w, r, result)
}

// List returns all .tar.gz backup archives in the default backup directory.
func (h *OpenClawBackupHandler) List(w http.ResponseWriter, r *http.Request) {
	backupDir := h.backupDir()
	if backupDir == "" {
		web.OK(w, r, map[string]any{"backupDir": "", "archives": []any{}, "installed": openclaw.IsOpenClawInstalled()})
		return
	}

	archives, err := openclaw.BackupListArchives(backupDir)
	if err != nil {
		archives = nil
	}

	// Sort by modTime desc (newest first)
	sort.Slice(archives, func(i, j int) bool { return archives[i].ModTime > archives[j].ModTime })

	web.OK(w, r, map[string]any{
		"backupDir": backupDir,
		"archives":  archives,
		"installed": openclaw.IsOpenClawInstalled(),
	})
}

// Download streams a backup archive file for download.
func (h *OpenClawBackupHandler) Download(w http.ResponseWriter, r *http.Request) {
	// Support both GET (query param) and POST (JSON body) for backward compatibility.
	var archivePath string
	if r.Method == http.MethodGet {
		archivePath = r.URL.Query().Get("path")
	} else {
		var req struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			web.FailErr(w, r, web.ErrInvalidBody)
			return
		}
		archivePath = req.Path
	}

	if archivePath == "" {
		web.FailErr(w, r, web.ErrInvalidParam, "missing path")
		return
	}

	backupDir := h.backupDir()
	if !h.isValidArchivePath(backupDir, archivePath) {
		web.FailErr(w, r, web.ErrInvalidParam, "invalid archive path")
		return
	}

	f, err := os.Open(archivePath)
	if err != nil {
		web.FailErr(w, r, web.ErrInvalidParam, fmt.Sprintf("cannot read file: %v", err))
		return
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		web.FailErr(w, r, web.ErrInvalidParam, fmt.Sprintf("cannot stat file: %v", err))
		return
	}

	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(archivePath)))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", stat.Size()))
	w.Header().Set("X-No-Gzip", "1")
	io.Copy(w, f)
}

// Delete removes a backup archive file.
func (h *OpenClawBackupHandler) Delete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	backupDir := h.backupDir()
	if !h.isValidArchivePath(backupDir, req.Path) {
		web.FailErr(w, r, web.ErrInvalidParam, "invalid archive path")
		return
	}

	if err := os.Remove(req.Path); err != nil {
		web.FailErr(w, r, web.ErrInvalidParam, fmt.Sprintf("cannot delete: %v", err))
		return
	}

	web.OK(w, r, map[string]any{"deleted": true})
}

func (h *OpenClawBackupHandler) isValidArchivePath(backupDir, archivePath string) bool {
	if backupDir == "" {
		return false
	}
	// Must be in the backup directory
	if filepath.Dir(archivePath) != backupDir {
		return false
	}
	// Must be a .tar.gz file
	name := filepath.Base(archivePath)
	if !strings.HasSuffix(name, ".tar.gz") {
		return false
	}
	// Must exist
	if _, err := os.Stat(archivePath); err != nil {
		return false
	}
	return true
}
