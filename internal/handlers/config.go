package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// ConfigHandler manages OpenClaw config read/write.
type ConfigHandler struct {
	auditRepo *database.AuditLogRepo
}

func NewConfigHandler() *ConfigHandler {
	return &ConfigHandler{
		auditRepo: database.NewAuditLogRepo(),
	}
}

// configPath returns the OpenClaw config file path.
func configPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".openclaw", "openclaw.json")
}

// Get reads the OpenClaw config.
func (h *ConfigHandler) Get(w http.ResponseWriter, r *http.Request) {
	path := configPath()
	if path == "" {
		web.FailErr(w, r, web.ErrConfigPathError)
		return
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			web.FailErr(w, r, web.ErrConfigNotFound)
			return
		}
		web.FailErr(w, r, web.ErrConfigReadFailed)
		return
	}

	// parse as JSON object
	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		// return raw text
		web.OK(w, r, map[string]interface{}{
			"raw":    string(data),
			"parsed": false,
		})
		return
	}

	web.OK(w, r, map[string]interface{}{
		"config": cfg,
		"path":   path,
		"parsed": true,
	})
}

// Update updates the OpenClaw config (via openclaw config set for safe writes).
func (h *ConfigHandler) Update(w http.ResponseWriter, r *http.Request) {
	path := configPath()
	if path == "" {
		web.FailErr(w, r, web.ErrConfigPathError)
		return
	}

	var req struct {
		Config map[string]interface{} `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Config == nil {
		web.FailErr(w, r, web.ErrConfigEmpty)
		return
	}

	// prefer openclaw CLI for safe writes
	if openclaw.IsOpenClawInstalled() {
		if err := openclaw.ConfigApplyFull(req.Config); err != nil {
			logger.Config.Warn().Err(err).Msg("openclaw config set failed, falling back to direct write")
			if writeErr := h.writeConfigDirect(path, req.Config); writeErr != nil {
				web.FailErr(w, r, web.ErrConfigWriteFailed, writeErr.Error())
				return
			}
		}
	} else {
		// openclaw not installed, write directly
		if err := h.writeConfigDirect(path, req.Config); err != nil {
			web.FailErr(w, r, web.ErrConfigWriteFailed, err.Error())
			return
		}
	}

	// audit log
	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionConfigUpdate,
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	logger.Config.Info().Str("user", web.GetUsername(r)).Str("path", path).Msg("OpenClaw config updated")
	web.OK(w, r, map[string]string{"message": "ok"})
}

// writeConfigDirect writes config file directly (fallback).
func (h *ConfigHandler) writeConfigDirect(path string, config map[string]interface{}) error {
	// read existing config and merge
	existing := make(map[string]interface{})
	if data, err := os.ReadFile(path); err == nil {
		json.Unmarshal(data, &existing)
	}

	// merge new config into existing
	for k, v := range config {
		existing[k] = v
	}

	// atomic write: write temp file then rename
	data, err := json.MarshalIndent(existing, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}

	tmpFile := path + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0o600); err != nil {
		return err
	}

	if err := os.Rename(tmpFile, path); err != nil {
		// Windows fallback: copy
		os.WriteFile(path, data, 0o600)
		os.Remove(tmpFile)
	}

	return nil
}

// SetKey sets a single config key.
// POST /api/v1/config/set-key
func (h *ConfigHandler) SetKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
		JSON  bool   `json:"json"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Key == "" || req.Value == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if !openclaw.IsOpenClawInstalled() {
		web.FailErr(w, r, web.ErrOpenClawNotInstalled)
		return
	}

	var err error
	if req.JSON {
		err = openclaw.ConfigSet(req.Key, req.Value)
	} else {
		err = openclaw.ConfigSetString(req.Key, req.Value)
	}

	if err != nil {
		web.FailErr(w, r, web.ErrConfigWriteFailed, err.Error())
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionConfigUpdate,
		Result:   "success",
		Detail:   "config set " + req.Key,
		IP:       r.RemoteAddr,
	})

	logger.Config.Info().Str("user", web.GetUsername(r)).Str("key", req.Key).Msg("config key updated")
	web.OK(w, r, map[string]string{"message": "ok", "key": req.Key})
}

// UnsetKey removes a single config key.
// POST /api/v1/config/unset-key
func (h *ConfigHandler) UnsetKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Key == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if !openclaw.IsOpenClawInstalled() {
		web.FailErr(w, r, web.ErrOpenClawNotInstalled)
		return
	}

	if err := openclaw.ConfigUnset(req.Key); err != nil {
		web.FailErr(w, r, web.ErrConfigWriteFailed, err.Error())
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionConfigUpdate,
		Result:   "success",
		Detail:   "config unset " + req.Key,
		IP:       r.RemoteAddr,
	})

	logger.Config.Info().Str("user", web.GetUsername(r)).Str("key", req.Key).Msg("config key removed")
	web.OK(w, r, map[string]string{"message": "ok", "key": req.Key})
}

// GetKey reads a single config key.
// GET /api/v1/config/get-key
func (h *ConfigHandler) GetKey(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if !openclaw.IsOpenClawInstalled() {
		web.FailErr(w, r, web.ErrOpenClawNotInstalled)
		return
	}

	value, err := openclaw.ConfigGet(key)
	if err != nil {
		web.FailErr(w, r, web.ErrConfigReadFailed, err.Error())
		return
	}

	web.OK(w, r, map[string]interface{}{"key": key, "value": json.RawMessage(value)})
}

// GenerateDefault generates a default config file via openclaw CLI.
// POST /api/v1/config/generate-default
func (h *ConfigHandler) GenerateDefault(w http.ResponseWriter, r *http.Request) {
	path := configPath()
	if path == "" {
		web.FailErr(w, r, web.ErrConfigPathError)
		return
	}

	// do not overwrite existing config
	if _, err := os.Stat(path); err == nil {
		web.Fail(w, r, "CONFIG_EXISTS", "config file already exists", http.StatusConflict)
		return
	}

	if !openclaw.IsOpenClawInstalled() {
		web.FailErr(w, r, web.ErrOpenClawNotInstalled)
		return
	}

	output, err := openclaw.InitDefaultConfig()
	if err != nil {
		web.FailErr(w, r, web.ErrConfigWriteFailed, err.Error())
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionConfigUpdate,
		Result:   "success",
		Detail:   "generated default config via openclaw CLI",
		IP:       r.RemoteAddr,
	})

	logger.Config.Info().Str("user", web.GetUsername(r)).Str("path", path).Str("output", output).Msg("default config generated via CLI")
	web.OK(w, r, map[string]string{"message": "ok", "path": path})
}
