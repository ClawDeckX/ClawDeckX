package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// GatewayProfileHandler manages multi-gateway profiles.
type GatewayProfileHandler struct {
	repo      *database.GatewayProfileRepo
	auditRepo *database.AuditLogRepo
	gwClient  *openclaw.GWClient
	gwService *openclaw.Service
}

func NewGatewayProfileHandler() *GatewayProfileHandler {
	return &GatewayProfileHandler{
		repo:      database.NewGatewayProfileRepo(),
		auditRepo: database.NewAuditLogRepo(),
	}
}

// SetGWClient injects the Gateway client reference.
func (h *GatewayProfileHandler) SetGWClient(client *openclaw.GWClient) {
	h.gwClient = client
}

// SetGWService injects the OpenClaw service reference.
func (h *GatewayProfileHandler) SetGWService(svc *openclaw.Service) {
	h.gwService = svc
}

// List returns all gateway profiles.
func (h *GatewayProfileHandler) List(w http.ResponseWriter, r *http.Request) {
	list, err := h.repo.List()
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery)
		return
	}
	web.OK(w, r, list)
}

// Create creates a gateway profile.
func (h *GatewayProfileHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name  string `json:"name"`
		Host  string `json:"host"`
		Port  int    `json:"port"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if req.Name == "" || req.Host == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}
	if req.Port <= 0 {
		req.Port = 18789
	}

	profile := &database.GatewayProfile{
		Name:  req.Name,
		Host:  req.Host,
		Port:  req.Port,
		Token: req.Token,
	}
	if err := h.repo.Create(profile); err != nil {
		web.FailErr(w, r, web.ErrGWProfileSaveFail)
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionSettingsUpdate,
		Detail:   "created gateway profile: " + req.Name + " (" + req.Host + ":" + strconv.Itoa(req.Port) + ")",
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	logger.Config.Info().Str("name", req.Name).Str("host", req.Host).Int("port", req.Port).Msg("gateway profile created")
	web.OK(w, r, profile)
}

// Update updates a gateway profile.
func (h *GatewayProfileHandler) Update(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	profile, err := h.repo.GetByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrGWProfileNotFound)
		return
	}

	var req struct {
		Name  string `json:"name"`
		Host  string `json:"host"`
		Port  int    `json:"port"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Name != "" {
		profile.Name = req.Name
	}
	if req.Host != "" {
		profile.Host = req.Host
	}
	if req.Port > 0 {
		profile.Port = req.Port
	}
	profile.Token = req.Token

	if err := h.repo.Update(profile); err != nil {
		web.FailErr(w, r, web.ErrGWProfileSaveFail)
		return
	}

	// if updating the active gateway, auto-reconnect
	if profile.IsActive && h.gwClient != nil {
		h.applyProfile(profile)
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionSettingsUpdate,
		Detail:   "updated gateway profile: " + profile.Name,
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	web.OK(w, r, profile)
}

// Delete removes a gateway profile.
func (h *GatewayProfileHandler) Delete(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	profile, err := h.repo.GetByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrGWProfileNotFound)
		return
	}

	if profile.IsActive {
		web.Fail(w, r, "GW_PROFILE_ACTIVE", "cannot delete active gateway profile", http.StatusBadRequest)
		return
	}

	if err := h.repo.Delete(uint(id)); err != nil {
		web.FailErr(w, r, web.ErrGWProfileDeleteFail)
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionSettingsUpdate,
		Detail:   "deleted gateway profile: " + profile.Name,
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	web.OK(w, r, map[string]string{"message": "ok"})
}

// Activate switches the active gateway and reconnects.
func (h *GatewayProfileHandler) Activate(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	profile, err := h.repo.GetByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrGWProfileNotFound)
		return
	}

	if err := h.repo.SetActive(uint(id)); err != nil {
		web.FailErr(w, r, web.ErrGWProfileSaveFail)
		return
	}

	h.applyProfile(profile)

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionSettingsUpdate,
		Detail:   "activated gateway: " + profile.Name + " (" + profile.Host + ":" + strconv.Itoa(profile.Port) + ")",
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	logger.Config.Info().
		Str("name", profile.Name).
		Str("host", profile.Host).
		Int("port", profile.Port).
		Msg("active gateway switched, reconnecting")

	web.OK(w, r, map[string]string{"message": "ok"})
}

// applyProfile applies the profile to GWClient and Service.
func (h *GatewayProfileHandler) applyProfile(p *database.GatewayProfile) {
	if h.gwService != nil {
		h.gwService.GatewayHost = p.Host
		h.gwService.GatewayPort = p.Port
		h.gwService.GatewayToken = p.Token
	}
	if h.gwClient != nil {
		h.gwClient.Reconnect(openclaw.GWClientConfig{
			Host:  p.Host,
			Port:  p.Port,
			Token: p.Token,
		})
	}
}
