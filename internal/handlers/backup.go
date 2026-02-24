package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/web"
)

// sensitiveKeys lists substrings that mark a JSON key as sensitive.
var sensitiveKeys = []string{"token", "secret", "apikey", "api_key", "password", "dsn", "bottoken", "bot_token"}

// redactSensitiveFields recursively walks a JSON structure and replaces
// string values whose key (lowercased) contains any sensitiveKeys substring
// with "***REDACTED***". Non-empty strings only.
func redactSensitiveFields(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		for k, child := range val {
			low := strings.ToLower(strings.ReplaceAll(k, "-", ""))
			isSensitive := false
			for _, sk := range sensitiveKeys {
				if strings.Contains(low, sk) {
					isSensitive = true
					break
				}
			}
			if isSensitive {
				if s, ok := child.(string); ok && s != "" {
					val[k] = "***REDACTED***"
				}
			} else {
				val[k] = redactSensitiveFields(child)
			}
		}
		return val
	case []interface{}:
		for i, item := range val {
			val[i] = redactSensitiveFields(item)
		}
		return val
	default:
		return v
	}
}

// BackupHandler manages backup operations.
type BackupHandler struct {
	backupRepo *database.BackupRepo
	auditRepo  *database.AuditLogRepo
	backupDir  string
}

func NewBackupHandler() *BackupHandler {
	home, _ := os.UserHomeDir()
	backupDir := filepath.Join(home, ".openclaw", "backups")
	os.MkdirAll(backupDir, 0o755)
	return &BackupHandler{
		backupRepo: database.NewBackupRepo(),
		auditRepo:  database.NewAuditLogRepo(),
		backupDir:  backupDir,
	}
}

// List returns all backup records.
func (h *BackupHandler) List(w http.ResponseWriter, r *http.Request) {
	records, err := h.backupRepo.List()
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery)
		return
	}
	web.OK(w, r, records)
}

// Create creates a new backup.
func (h *BackupHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Note    string `json:"note"`
		Trigger string `json:"trigger"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Trigger = "manual"
	}
	if req.Trigger == "" {
		req.Trigger = "manual"
	}

	// backup OpenClaw config file
	home, _ := os.UserHomeDir()
	srcPath := filepath.Join(home, ".openclaw", "openclaw.json")

	srcData, err := os.ReadFile(srcPath)
	if err != nil {
		web.FailErr(w, r, web.ErrBackupFailed, err.Error())
		return
	}

	// redact sensitive fields before saving
	var parsed interface{}
	if err := json.Unmarshal(srcData, &parsed); err == nil {
		redacted := redactSensitiveFields(parsed)
		if out, err := json.MarshalIndent(redacted, "", "  "); err == nil {
			srcData = out
		}
	}

	// generate backup filename
	ts := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("openclaw_backup_%s.json", ts)
	destPath := filepath.Join(h.backupDir, filename)

	if err := os.WriteFile(destPath, srcData, 0o600); err != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID: web.GetUserID(r), Username: web.GetUsername(r),
			Action: constants.ActionBackupCreate, Result: "failed", Detail: err.Error(), IP: r.RemoteAddr,
		})
		web.FailErr(w, r, web.ErrBackupFailed, err.Error())
		return
	}

	// save to database
	record := &database.BackupRecord{
		Filename: filename,
		FilePath: destPath,
		FileSize: int64(len(srcData)),
		Trigger:  req.Trigger,
		Note:     req.Note,
	}
	if err := h.backupRepo.Create(record); err != nil {
		web.FailErr(w, r, web.ErrBackupFailed)
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionBackupCreate,
		Result:   "success",
		Detail:   filename,
		IP:       r.RemoteAddr,
	})

	logger.Backup.Info().Str("file", filename).Str("trigger", req.Trigger).Msg("backup created")
	web.OK(w, r, record)
}

// Restore restores a backup.
func (h *BackupHandler) Restore(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/v1/backups/")
	idStr = strings.TrimSuffix(idStr, "/restore")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	record, err := h.backupRepo.FindByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrBackupNotFound)
		return
	}

	backupData, err := os.ReadFile(record.FilePath)
	if err != nil {
		web.FailErr(w, r, web.ErrBackupFailed, err.Error())
		return
	}

	// auto-backup current config before restore
	home, _ := os.UserHomeDir()
	destPath := filepath.Join(home, ".openclaw", "openclaw.json")

	if currentData, err := os.ReadFile(destPath); err == nil {
		// redact sensitive fields in pre-restore backup too
		redactedData := currentData
		var parsed interface{}
		if err := json.Unmarshal(currentData, &parsed); err == nil {
			redacted := redactSensitiveFields(parsed)
			if out, err := json.MarshalIndent(redacted, "", "  "); err == nil {
				redactedData = out
			}
		}
		preRestoreFile := fmt.Sprintf("openclaw_pre_restore_%s.json", time.Now().Format("20060102_150405"))
		preRestorePath := filepath.Join(h.backupDir, preRestoreFile)
		os.WriteFile(preRestorePath, redactedData, 0o600)
		h.backupRepo.Create(&database.BackupRecord{
			Filename: preRestoreFile,
			FilePath: preRestorePath,
			FileSize: int64(len(redactedData)),
			Trigger:  "pre_restore",
			Note:     "auto backup before restore",
		})
	}

	// check if backup contains redacted fields
	hasRedacted := strings.Contains(string(backupData), "***REDACTED***")

	if err := os.WriteFile(destPath, backupData, 0o600); err != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID: web.GetUserID(r), Username: web.GetUsername(r),
			Action: constants.ActionBackupRestore, Result: "failed", Detail: err.Error(), IP: r.RemoteAddr,
		})
		web.FailErr(w, r, web.ErrBackupRestoreFail, err.Error())
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionBackupRestore,
		Result:   "success",
		Detail:   record.Filename,
		IP:       r.RemoteAddr,
	})

	logger.Backup.Info().Str("file", record.Filename).Msg("backup restored")
	web.OK(w, r, map[string]interface{}{
		"message":      "ok",
		"has_redacted": hasRedacted,
	})
}

// Delete removes a backup.
func (h *BackupHandler) Delete(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/v1/backups/")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	record, err := h.backupRepo.FindByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrBackupNotFound)
		return
	}

	os.Remove(record.FilePath)

	if err := h.backupRepo.Delete(uint(id)); err != nil {
		web.FailErr(w, r, web.ErrBackupDeleteFail)
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID: web.GetUserID(r), Username: web.GetUsername(r),
		Action: constants.ActionBackupDelete, Result: "success", Detail: record.Filename, IP: r.RemoteAddr,
	})

	logger.Backup.Info().Str("file", record.Filename).Msg("backup deleted")
	web.OK(w, r, map[string]string{"message": "ok"})
}

// Download serves a backup file for download.
func (h *BackupHandler) Download(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/v1/backups/")
	idStr = strings.TrimSuffix(idStr, "/download")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	record, err := h.backupRepo.FindByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrBackupNotFound)
		return
	}

	f, err := os.Open(record.FilePath)
	if err != nil {
		web.FailErr(w, r, web.ErrBackupFailed)
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename="+record.Filename)
	io.Copy(w, f)
}
