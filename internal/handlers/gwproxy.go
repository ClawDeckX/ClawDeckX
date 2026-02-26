package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// GWProxyHandler proxies Gateway WebSocket methods as REST APIs.
type GWProxyHandler struct {
	client *openclaw.GWClient
}

func NewGWProxyHandler(client *openclaw.GWClient) *GWProxyHandler {
	return &GWProxyHandler{client: client}
}

// Status returns Gateway WS client connection status.
func (h *GWProxyHandler) Status(w http.ResponseWriter, r *http.Request) {
	web.OK(w, r, map[string]interface{}{
		"connected": h.client.IsConnected(),
	})
}

// Health returns Gateway health info.
func (h *GWProxyHandler) Health(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("health", map[string]interface{}{"probe": false})
	if err != nil {
		web.Fail(w, r, "GW_HEALTH_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// GWStatus returns Gateway status info.
func (h *GWProxyHandler) GWStatus(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("status", nil)
	if err != nil {
		web.Fail(w, r, "GW_STATUS_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// SessionsList returns session list.
func (h *GWProxyHandler) SessionsList(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("sessions.list", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GW_SESSIONS_LIST_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// SessionsPreview returns session previews.
func (h *GWProxyHandler) SessionsPreview(w http.ResponseWriter, r *http.Request) {
	var params struct {
		Keys     []string `json:"keys"`
		Limit    int      `json:"limit,omitempty"`
		MaxChars int      `json:"maxChars,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
		web.Fail(w, r, "INVALID_PARAMS", "invalid request body", http.StatusBadRequest)
		return
	}
	if params.Limit == 0 {
		params.Limit = 12
	}
	if params.MaxChars == 0 {
		params.MaxChars = 240
	}
	data, err := h.client.Request("sessions.preview", params)
	if err != nil {
		web.Fail(w, r, "GW_SESSIONS_PREVIEW_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// SessionsReset resets a session.
func (h *GWProxyHandler) SessionsReset(w http.ResponseWriter, r *http.Request) {
	var params struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil || params.Key == "" {
		web.Fail(w, r, "INVALID_PARAMS", "key is required", http.StatusBadRequest)
		return
	}
	data, err := h.client.Request("sessions.reset", params)
	if err != nil {
		web.Fail(w, r, "GW_SESSIONS_RESET_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// SessionsDelete deletes a session.
func (h *GWProxyHandler) SessionsDelete(w http.ResponseWriter, r *http.Request) {
	var params struct {
		Key              string `json:"key"`
		DeleteTranscript bool   `json:"deleteTranscript"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil || params.Key == "" {
		web.Fail(w, r, "INVALID_PARAMS", "key is required", http.StatusBadRequest)
		return
	}
	data, err := h.client.Request("sessions.delete", params)
	if err != nil {
		web.Fail(w, r, "GW_SESSIONS_DELETE_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// ModelsList returns model list.
func (h *GWProxyHandler) ModelsList(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("models.list", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GW_MODELS_LIST_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// UsageStatus returns usage status.
func (h *GWProxyHandler) UsageStatus(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("usage.status", nil)
	if err != nil {
		web.Fail(w, r, "GW_USAGE_STATUS_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// UsageCost returns usage cost.
func (h *GWProxyHandler) UsageCost(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	params := map[string]interface{}{}
	if v := q.Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			params["days"] = n
		}
	}
	if v := q.Get("startDate"); v != "" {
		params["startDate"] = v
	}
	if v := q.Get("endDate"); v != "" {
		params["endDate"] = v
	}
	data, err := h.client.RequestWithTimeout("usage.cost", params, 30*time.Second)
	if err != nil {
		web.Fail(w, r, "GW_USAGE_COST_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// SessionsUsage returns session usage details.
func (h *GWProxyHandler) SessionsUsage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	params := map[string]interface{}{}
	if v := q.Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			params["days"] = n
		}
	}
	if v := q.Get("startDate"); v != "" {
		params["startDate"] = v
	}
	if v := q.Get("endDate"); v != "" {
		params["endDate"] = v
	}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			params["limit"] = n
		}
	}
	if v := q.Get("key"); v != "" {
		params["key"] = v
	}
	params["includeContextWeight"] = true
	data, err := h.client.RequestWithTimeout("sessions.usage", params, 30*time.Second)
	if err != nil {
		web.Fail(w, r, "GW_SESSIONS_USAGE_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// SkillsStatus returns skills status.
func (h *GWProxyHandler) SkillsStatus(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("skills.status", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GW_SKILLS_STATUS_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// ConfigGet returns OpenClaw config.
func (h *GWProxyHandler) ConfigGet(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("config.get", map[string]interface{}{
		"redact": true,
	})
	if err != nil {
		web.Fail(w, r, "GW_CONFIG_GET_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// AgentsList returns agent list.
func (h *GWProxyHandler) AgentsList(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("agents.list", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GW_AGENTS_LIST_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// CronList returns cron job list.
func (h *GWProxyHandler) CronList(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("cron.list", map[string]interface{}{
		"includeDisabled": true,
	})
	if err != nil {
		web.Fail(w, r, "GW_CRON_LIST_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// CronStatus returns cron job status.
func (h *GWProxyHandler) CronStatus(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("cron.status", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GW_CRON_STATUS_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// ChannelsStatus returns channel status.
func (h *GWProxyHandler) ChannelsStatus(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("channels.status", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GW_CHANNELS_STATUS_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// LogsTail returns remote OpenClaw runtime logs.
func (h *GWProxyHandler) LogsTail(w http.ResponseWriter, r *http.Request) {
	var params interface{}
	p := map[string]interface{}{}
	if v := r.URL.Query().Get("lines"); v != "" {
		p["lines"] = v
	}
	if v := r.URL.Query().Get("cursor"); v != "" {
		p["cursor"] = v
	}
	if len(p) > 0 {
		params = p
	}
	data, err := h.client.RequestWithTimeout("logs.tail", params, 30*time.Second)
	if err != nil {
		web.Fail(w, r, "GW_LOGS_TAIL_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// ConfigGetRemote returns remote OpenClaw config via Gateway WS.
func (h *GWProxyHandler) ConfigGetRemote(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.Request("config.get", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GW_CONFIG_GET_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// ConfigSetRemote updates remote OpenClaw config.
func (h *GWProxyHandler) ConfigSetRemote(w http.ResponseWriter, r *http.Request) {
	var params struct {
		Config interface{} `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
		web.Fail(w, r, "INVALID_PARAMS", "invalid request body", http.StatusBadRequest)
		return
	}
	data, err := h.client.RequestWithTimeout("config.set", params, 15*time.Second)
	if err != nil {
		web.Fail(w, r, "GW_CONFIG_SET_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// ConfigReload triggers remote config hot-reload.
func (h *GWProxyHandler) ConfigReload(w http.ResponseWriter, r *http.Request) {
	data, err := h.client.RequestWithTimeout("config.reload", map[string]interface{}{}, 15*time.Second)
	if err != nil {
		web.Fail(w, r, "GW_CONFIG_RELOAD_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// SessionsPreviewMessages returns session message previews.
func (h *GWProxyHandler) SessionsPreviewMessages(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		web.Fail(w, r, "INVALID_PARAMS", "key is required", http.StatusBadRequest)
		return
	}
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := json.Number(v).Int64(); err == nil && n > 0 {
			limit = int(n)
		}
	}
	data, err := h.client.RequestWithTimeout("sessions.preview", map[string]interface{}{
		"keys":     []string{key},
		"limit":    limit,
		"maxChars": 500,
	}, 15*time.Second)
	if err != nil {
		web.Fail(w, r, "GW_SESSIONS_PREVIEW_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// SessionsHistory returns full session history.
func (h *GWProxyHandler) SessionsHistory(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		web.Fail(w, r, "INVALID_PARAMS", "key is required", http.StatusBadRequest)
		return
	}
	data, err := h.client.RequestWithTimeout("chat.history", map[string]interface{}{
		"sessionKey": key,
	}, 30*time.Second)
	if err != nil {
		web.Fail(w, r, "GW_SESSIONS_HISTORY_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

// SkillsConfigure configures a skill (enable/disable/env vars etc.).
func (h *GWProxyHandler) SkillsConfigure(w http.ResponseWriter, r *http.Request) {
	// get current config
	raw, err := h.client.Request("config.get", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GW_CONFIG_GET_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

	var wrapper map[string]interface{}
	if json.Unmarshal(raw, &wrapper) != nil {
		web.Fail(w, r, "GW_CONFIG_PARSE_FAILED", "failed to parse config response", http.StatusBadGateway)
		return
	}

	var currentCfg map[string]interface{}
	if parsed, ok := wrapper["parsed"]; ok {
		if m, ok := parsed.(map[string]interface{}); ok {
			currentCfg = m
		}
	} else if config, ok := wrapper["config"]; ok {
		if m, ok := config.(map[string]interface{}); ok {
			currentCfg = m
		}
	}
	if currentCfg == nil {
		web.Fail(w, r, "GW_CONFIG_PARSE_FAILED", "failed to parse current config", http.StatusBadGateway)
		return
	}

	// parse request
	var params struct {
		SkillKey string                 `json:"skillKey"`
		Enabled  *bool                  `json:"enabled,omitempty"`
		ApiKey   *string                `json:"apiKey,omitempty"`
		Env      map[string]string      `json:"env,omitempty"`
		Config   map[string]interface{} `json:"config,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil || params.SkillKey == "" {
		web.Fail(w, r, "INVALID_PARAMS", "skillKey is required", http.StatusBadRequest)
		return
	}

	// update skills.entries
	skills, _ := currentCfg["skills"].(map[string]interface{})
	if skills == nil {
		skills = map[string]interface{}{}
		currentCfg["skills"] = skills
	}
	entries, _ := skills["entries"].(map[string]interface{})
	if entries == nil {
		entries = map[string]interface{}{}
		skills["entries"] = entries
	}
	entry, _ := entries[params.SkillKey].(map[string]interface{})
	if entry == nil {
		entry = map[string]interface{}{}
	}

	if params.Enabled != nil {
		entry["enabled"] = *params.Enabled
	}
	if params.ApiKey != nil {
		if *params.ApiKey == "" {
			delete(entry, "apiKey")
		} else {
			entry["apiKey"] = *params.ApiKey
		}
	}
	if params.Env != nil {
		if len(params.Env) == 0 {
			delete(entry, "env")
		} else {
			entry["env"] = params.Env
		}
	}
	if params.Config != nil {
		if len(params.Config) == 0 {
			delete(entry, "config")
		} else {
			entry["config"] = params.Config
		}
	}
	entries[params.SkillKey] = entry

	// save config
	saveData, err := h.client.RequestWithTimeout("config.set", map[string]interface{}{
		"config": currentCfg,
	}, 15*time.Second)
	if err != nil {
		web.Fail(w, r, "GW_CONFIG_SET_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

	// hot-reload
	h.client.RequestWithTimeout("config.reload", map[string]interface{}{}, 10*time.Second)

	web.OKRaw(w, r, saveData)
}

// SkillsConfigGet returns skill config (skills.entries).
func (h *GWProxyHandler) SkillsConfigGet(w http.ResponseWriter, r *http.Request) {
	raw, err := h.client.Request("config.get", map[string]interface{}{})
	if err != nil {
		web.Fail(w, r, "GW_CONFIG_GET_FAILED", err.Error(), http.StatusBadGateway)
		return
	}

	var wrapper map[string]interface{}
	if json.Unmarshal(raw, &wrapper) != nil {
		web.Fail(w, r, "GW_CONFIG_PARSE_FAILED", "failed to parse config response", http.StatusBadGateway)
		return
	}

	// extract skills.entries
	var entries interface{}
	if parsed, ok := wrapper["parsed"]; ok {
		if m, ok := parsed.(map[string]interface{}); ok {
			if skills, ok := m["skills"].(map[string]interface{}); ok {
				entries = skills["entries"]
			}
		}
	} else if config, ok := wrapper["config"]; ok {
		if m, ok := config.(map[string]interface{}); ok {
			if skills, ok := m["skills"].(map[string]interface{}); ok {
				entries = skills["entries"]
			}
		}
	}
	if entries == nil {
		entries = map[string]interface{}{}
	}

	web.OK(w, r, map[string]interface{}{
		"entries": entries,
	})
}

// slowMethods are RPC methods that need longer timeouts (install/update etc.).
var slowMethods = map[string]bool{
	"skills.install": true,
	"skills.update":  true,
	"update.run":     true,
}

// GenericProxy forwards any method to the Gateway.
func (h *GWProxyHandler) GenericProxy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Method string      `json:"method"`
		Params interface{} `json:"params,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Method == "" {
		web.Fail(w, r, "INVALID_PARAMS", "method is required", http.StatusBadRequest)
		return
	}
	timeout := 30 * time.Second
	if slowMethods[req.Method] {
		timeout = 5 * time.Minute
	}
	data, err := h.client.RequestWithTimeout(req.Method, req.Params, timeout)
	if err != nil {
		web.Fail(w, r, "GW_PROXY_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}
