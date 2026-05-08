package handlers

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"

	"github.com/gorilla/websocket"
)

// GatewayProfileHandler manages multi-gateway profiles.
type GatewayProfileHandler struct {
	repo            *database.GatewayProfileRepo
	auditRepo       *database.AuditLogRepo
	gwClient        *openclaw.GWClient
	gwService       *openclaw.Service
	onProfileSwitch func(host string, port int, name string, isRemote bool)
}

// SetProfileSwitchCallback sets a callback invoked after a profile is activated/switched.
func (h *GatewayProfileHandler) SetProfileSwitchCallback(fn func(host string, port int, name string, isRemote bool)) {
	h.onProfileSwitch = fn
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

// parseGatewayAddress parses a gateway address that may be a full URL
// (ws://host:port/path or http://host:port/path) or a plain host.
// It returns the normalized host, port (0 if not specified), and path.
func parseGatewayAddress(raw string, defaultPort int) (host string, port int, path string) {
	h := strings.TrimSpace(raw)
	port = defaultPort
	path = "/"

	// If it looks like a URL (has scheme), parse it properly
	if strings.Contains(h, "://") {
		// Normalize scheme for url.Parse
		normalized := h
		normalized = strings.Replace(normalized, "wss://", "https://", 1)
		normalized = strings.Replace(normalized, "ws://", "http://", 1)
		if !strings.HasPrefix(normalized, "http://") && !strings.HasPrefix(normalized, "https://") {
			normalized = "http://" + normalized
		}
		if u, err := url.Parse(normalized); err == nil && u.Host != "" {
			host = u.Hostname()
			if pStr := u.Port(); pStr != "" {
				if pInt, err := strconv.Atoi(pStr); err == nil && pInt > 0 {
					port = pInt
				}
			}
			if u.Path != "" && u.Path != "/" {
				path = u.Path
			}
			return
		}
	}

	// Strip leftover scheme prefixes for plain host inputs
	h = strings.TrimPrefix(h, "https://")
	h = strings.TrimPrefix(h, "http://")
	h = strings.TrimPrefix(h, "wss://")
	h = strings.TrimPrefix(h, "ws://")
	h = strings.TrimRight(h, "/")
	host = h
	return
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
		Path  string `json:"path"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	defaultPort := req.Port
	if defaultPort <= 0 {
		defaultPort = 18789
	}
	parsedHost, parsedPort, parsedPath := parseGatewayAddress(req.Host, defaultPort)
	if req.Path != "" {
		parsedPath = req.Path
	}
	req.Host = parsedHost
	req.Port = parsedPort
	if req.Name == "" || req.Host == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	profile := &database.GatewayProfile{
		Name:  req.Name,
		Host:  req.Host,
		Port:  req.Port,
		Path:  parsedPath,
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
		Path  string `json:"path"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Host != "" {
		defaultPort := req.Port
		if defaultPort <= 0 {
			defaultPort = profile.Port
		}
		parsedHost, parsedPort, parsedPath := parseGatewayAddress(req.Host, defaultPort)
		profile.Host = parsedHost
		profile.Port = parsedPort
		if req.Path != "" {
			profile.Path = req.Path
		} else if parsedPath != "/" {
			profile.Path = parsedPath
		}
	} else {
		if req.Port > 0 {
			profile.Port = req.Port
		}
		if req.Path != "" {
			profile.Path = req.Path
		}
	}
	if req.Name != "" {
		profile.Name = req.Name
	}
	if req.Token != "" {
		profile.Token = req.Token
	}

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

	wasActive := profile.IsActive

	if err := h.repo.Delete(uint(id)); err != nil {
		web.FailErr(w, r, web.ErrGWProfileDeleteFail)
		return
	}

	// If we deleted the active gateway, fall back to another profile or local default
	if wasActive {
		remaining, _ := h.repo.List()
		if len(remaining) > 0 {
			// Activate the first remaining profile
			_ = h.repo.SetActive(remaining[0].ID)
			h.applyProfile(&remaining[0])
		} else {
			// No profiles left — reset to local default
			if h.gwService != nil {
				h.gwService.GatewayHost = "127.0.0.1"
				h.gwService.GatewayPort = 18789
				h.gwService.GatewayToken = ""
			}
			if h.gwClient != nil {
				h.gwClient.Reconnect(openclaw.GWClientConfig{
					Host: "127.0.0.1",
					Port: 18789,
				})
			}
			if h.onProfileSwitch != nil {
				h.onProfileSwitch("127.0.0.1", 18789, "Local Gateway", false)
			}
		}
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

// TestConnection tests connectivity to a gateway from the server side (avoids browser CORS).
func (h *GatewayProfileHandler) TestConnection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Host  string `json:"host"`
		Port  int    `json:"port"`
		Path  string `json:"path"`
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	defaultPort := req.Port
	if defaultPort <= 0 {
		defaultPort = 18789
	}
	parsedHost, parsedPort, parsedPath := parseGatewayAddress(req.Host, defaultPort)
	if req.Path != "" {
		parsedPath = req.Path
	}
	if parsedHost == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	// Step 1: TCP reachability
	addr := fmt.Sprintf("%s:%d", parsedHost, parsedPort)
	tcpConn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		logger.Config.Warn().Err(err).Str("addr", addr).Msg("gateway test: TCP unreachable")
		web.Fail(w, r, "GW_TEST_FAIL", "TCP unreachable: "+err.Error(), http.StatusBadGateway)
		return
	}
	tcpConn.Close()

	// Step 2: HTTP /health endpoint (use path prefix if specified)
	healthPath := "/health"
	if parsedPath != "/" {
		healthPath = strings.TrimRight(parsedPath, "/") + "/health"
	}
	testURL := fmt.Sprintf("http://%s%s", addr, healthPath)
	client := &http.Client{Timeout: 6 * time.Second}
	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodGet, testURL, nil)
	if err != nil {
		web.Fail(w, r, "GW_TEST_FAIL", err.Error(), http.StatusBadGateway)
		return
	}
	if req.Token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+req.Token)
	}

	httpOk := false
	resp, err := client.Do(httpReq)
	if err != nil {
		logger.Config.Warn().Err(err).Str("url", testURL).Msg("gateway test: HTTP /health failed")
	} else {
		resp.Body.Close()
		httpOk = resp.StatusCode >= 200 && resp.StatusCode < 400
	}

	// Step 3: WebSocket connectivity test (use path if specified)
	wsOk := false
	wsPath := "/"
	if parsedPath != "/" {
		wsPath = parsedPath
	}
	wsURL := fmt.Sprintf("ws://%s%s", addr, wsPath)
	wsDialer := websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	wsConn, _, wsErr := wsDialer.Dial(wsURL, nil)
	if wsErr == nil {
		wsOk = true
		wsConn.Close()
	} else {
		logger.Config.Debug().Err(wsErr).Str("url", wsURL).Msg("gateway test: WebSocket dial failed")
	}

	if httpOk || wsOk {
		web.OK(w, r, map[string]any{"ok": true, "http": httpOk, "ws": wsOk})
	} else {
		detail := "TCP reachable but HTTP and WebSocket both failed"
		if err != nil {
			detail = "HTTP: " + err.Error()
		}
		if wsErr != nil {
			detail += "; WS: " + wsErr.Error()
		}
		web.Fail(w, r, "GW_TEST_FAIL", detail, http.StatusBadGateway)
	}
}

// applyProfile applies the profile to GWClient and Service, and notifies lifecycle recorder.
func (h *GatewayProfileHandler) applyProfile(p *database.GatewayProfile) {
	isRemote := !isLocalHost(p.Host)
	if h.gwService != nil {
		h.gwService.GatewayHost = p.Host
		h.gwService.GatewayPort = p.Port
		h.gwService.GatewayToken = p.Token
	}
	if h.gwClient != nil {
		h.gwClient.Reconnect(openclaw.GWClientConfig{
			Host:  p.Host,
			Port:  p.Port,
			Path:  p.Path,
			Token: p.Token,
		})
	}
	if h.onProfileSwitch != nil {
		h.onProfileSwitch(p.Host, p.Port, p.Name, isRemote)
	}
}

func isLocalHost(host string) bool {
	h := strings.TrimSpace(host)
	return h == "" || h == "127.0.0.1" || h == "localhost" || h == "::1"
}
