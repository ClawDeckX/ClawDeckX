package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// SettingsHandler manages system settings.
type SettingsHandler struct {
	settingRepo *database.SettingRepo
	auditRepo   *database.AuditLogRepo
	gwClient    *openclaw.GWClient
	gwService   *openclaw.Service
}

func NewSettingsHandler() *SettingsHandler {
	return &SettingsHandler{
		settingRepo: database.NewSettingRepo(),
		auditRepo:   database.NewAuditLogRepo(),
	}
}

// SetGWClient injects the Gateway client reference.
func (h *SettingsHandler) SetGWClient(client *openclaw.GWClient) {
	h.gwClient = client
}

// SetGWService injects the OpenClaw service reference.
func (h *SettingsHandler) SetGWService(svc *openclaw.Service) {
	h.gwService = svc
}

// GetAll returns all system settings.
func (h *SettingsHandler) GetAll(w http.ResponseWriter, r *http.Request) {
	settings, err := h.settingRepo.GetAll()
	if err != nil {
		web.FailErr(w, r, web.ErrSettingsQueryFail)
		return
	}
	web.OK(w, r, settings)
}

// Update batch-updates system settings.
func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	var items map[string]string
	if err := json.NewDecoder(r.Body).Decode(&items); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if len(items) == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if err := h.settingRepo.SetBatch(items); err != nil {
		web.FailErr(w, r, web.ErrSettingsUpdateFail)
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionSettingsUpdate,
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	logger.Config.Info().Str("user", web.GetUsername(r)).Msg("settings updated")
	web.OK(w, r, map[string]string{"message": "ok"})
}

// GetGatewayConfig returns the Gateway connection config.
func (h *SettingsHandler) GetGatewayConfig(w http.ResponseWriter, r *http.Request) {
	cfg := h.gwClient.GetConfig()
	web.OK(w, r, map[string]interface{}{
		"host":      cfg.Host,
		"port":      cfg.Port,
		"token":     cfg.Token,
		"connected": h.gwClient.IsConnected(),
	})
}

// UpdateGatewayConfig updates Gateway connection config and reconnects.
func (h *SettingsHandler) UpdateGatewayConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Host  string `json:"host"`
		Port  int    `json:"port"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Host == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	if req.Port <= 0 {
		req.Port = 18789
	}

	// persist to settings table
	h.settingRepo.SetBatch(map[string]string{
		"gateway_host":  req.Host,
		"gateway_port":  strconv.Itoa(req.Port),
		"gateway_token": req.Token,
	})

	// sync to OpenClaw Service
	if h.gwService != nil {
		h.gwService.GatewayHost = req.Host
		h.gwService.GatewayPort = req.Port
		h.gwService.GatewayToken = req.Token
	}

	// reconnect GWClient
	newCfg := openclaw.GWClientConfig{
		Host:  req.Host,
		Port:  req.Port,
		Token: req.Token,
	}
	h.gwClient.Reconnect(newCfg)

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionSettingsUpdate,
		Detail:   "gateway config updated: " + req.Host + ":" + strconv.Itoa(req.Port),
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	logger.Config.Info().
		Str("user", web.GetUsername(r)).
		Str("host", req.Host).
		Int("port", req.Port).
		Msg("gateway config updated, reconnecting")

	web.OK(w, r, map[string]string{"message": "ok"})
}

// SetLanguage sets the backend language based on frontend selection.
func (h *SettingsHandler) SetLanguage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Language string `json:"language"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	lang := req.Language
	if lang != "en" && lang != "zh" {
		lang = "en"
	}

	i18n.SetLanguage(lang)

	logger.Log.Info().
		Str("user", web.GetUsername(r)).
		Str("language", lang).
		Msg("backend language updated")

	web.OK(w, r, map[string]string{"language": lang})
}

// GetLanguage returns the current backend language.
func (h *SettingsHandler) GetLanguage(w http.ResponseWriter, r *http.Request) {
	web.OK(w, r, map[string]string{"language": i18n.GetLanguage()})
}
