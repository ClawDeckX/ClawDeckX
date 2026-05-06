package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// GWProxyHandler proxies Gateway WebSocket methods as REST APIs.
type GWProxyHandler struct {
	client            *openclaw.GWClient
	refreshAuthOnFail func() bool
}

func NewGWProxyHandler(client *openclaw.GWClient) *GWProxyHandler {
	return &GWProxyHandler{client: client}
}

// SetAuthRefreshCallback sets an optional callback used to refresh the cached
// gateway auth state before retrying a history request after 401/403.
func (h *GWProxyHandler) SetAuthRefreshCallback(fn func() bool) {
	h.refreshAuthOnFail = fn
}

// Status returns Gateway WS client connection status and diagnostics.
func (h *GWProxyHandler) Status(w http.ResponseWriter, r *http.Request) {
	web.OK(w, r, h.client.ConnectionStatus())
}

// Reconnect triggers GWClient reconnect using current config.
func (h *GWProxyHandler) Reconnect(w http.ResponseWriter, r *http.Request) {
	cfg := h.client.GetConfig()
	h.client.Reconnect(cfg)
	web.OK(w, r, map[string]interface{}{
		"message": "reconnecting",
		"host":    cfg.Host,
		"port":    cfg.Port,
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
	data, err := h.client.Request("config.get", map[string]interface{}{})
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
		if n, err := strconv.Atoi(v); err == nil {
			p["limit"] = n
		}
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			p["limit"] = n
		}
	}
	if v := r.URL.Query().Get("cursor"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			p["cursor"] = n
		}
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
// Retries automatically on optimistic concurrency conflict (INVALID_REQUEST: config changed).
func (h *GWProxyHandler) ConfigSetRemote(w http.ResponseWriter, r *http.Request) {
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		web.Fail(w, r, "INVALID_PARAMS", "invalid request body", http.StatusBadRequest)
		return
	}

	const maxRetries = 3
	for attempt := 0; attempt < maxRetries; attempt++ {
		rpcParams := make(map[string]interface{})
		for k, v := range body {
			rpcParams[k] = v
		}

		// On retry, refresh baseHash from Gateway
		if attempt > 0 {
			freshHash := h.fetchFreshBaseHash()
			if freshHash != "" {
				rpcParams["baseHash"] = freshHash
			}
		}

		// If caller sent { config }, serialize to raw JSON string
		if _, hasRaw := rpcParams["raw"]; !hasRaw {
			if cfg, hasConfig := rpcParams["config"]; hasConfig {
				cfgJSON, jsonErr := json.Marshal(cfg)
				if jsonErr != nil {
					web.Fail(w, r, "CONFIG_SERIALIZE_FAILED", jsonErr.Error(), http.StatusInternalServerError)
					return
				}
				bh := rpcParams["baseHash"]
				rpcParams = map[string]interface{}{"raw": string(cfgJSON)}
				if bh != nil {
					rpcParams["baseHash"] = bh
				}
			}
		}

		data, err := h.client.RequestWithTimeout("config.set", rpcParams, 15*time.Second)
		if err != nil {
			if isConfigConflictError(err) && attempt < maxRetries-1 {
				logger.Config.Warn().Int("attempt", attempt+1).Msg("config.set conflict, retrying with fresh baseHash")
				time.Sleep(200 * time.Millisecond)
				continue
			}
			web.Fail(w, r, "GW_CONFIG_SET_FAILED", err.Error(), http.StatusBadGateway)
			return
		}
		web.OKRaw(w, r, data)
		return
	}
}

// ConfigReload triggers remote config hot-reload.
// Note: config.reload is not a valid gateway RPC method. config.set/config.apply
// already trigger automatic reload, so this is a no-op that returns success.
func (h *GWProxyHandler) ConfigReload(w http.ResponseWriter, r *http.Request) {
	web.OK(w, r, map[string]interface{}{"ok": true})
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
	rpcParams := map[string]interface{}{
		"sessionKey": key,
	}
	if v := r.URL.Query().Get("maxChars"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			rpcParams["maxChars"] = n
		}
	}
	data, err := h.client.RequestWithTimeout("chat.history", rpcParams, 30*time.Second)
	if err != nil {
		web.Fail(w, r, "GW_SESSIONS_HISTORY_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OKRaw(w, r, data)
}

type sessionHistoryPage struct {
	SessionKey string            `json:"sessionKey"`
	Messages   []json.RawMessage `json:"messages"`
	Items      []json.RawMessage `json:"items"`
	HasMore    bool              `json:"hasMore"`
	NextCursor string            `json:"nextCursor,omitempty"`
}

func loadPaginatedHistoryFromRPC(h *GWProxyHandler, key, cursor string, limit int, maxChars int) (sessionHistoryPage, error) {
	rpcParams := map[string]interface{}{
		"sessionKey": key,
		"limit":      1000,
	}
	if maxChars > 0 {
		rpcParams["maxChars"] = maxChars
	}
	data, err := h.client.RequestWithTimeout("chat.history", rpcParams, 30*time.Second)
	if err != nil {
		return sessionHistoryPage{}, err
	}

	var history sessionHistoryPage
	if err := json.Unmarshal(data, &history); err != nil {
		return sessionHistoryPage{}, err
	}

	messages := history.Messages
	if len(messages) == 0 && len(history.Items) > 0 {
		messages = history.Items
	}
	page, hasMore, nextCursor := paginateHistoryMessages(messages, limit, cursor)
	result := sessionHistoryPage{
		SessionKey: strings.TrimSpace(history.SessionKey),
		Messages:   page,
		Items:      page,
	}
	if result.SessionKey == "" {
		result.SessionKey = key
	}
	result.HasMore = hasMore
	result.NextCursor = nextCursor
	return result, nil
}

func parseHistoryCursor(cursor string) int {
	trimmed := strings.TrimSpace(cursor)
	if trimmed == "" {
		return 0
	}
	trimmed = strings.TrimPrefix(trimmed, "seq:")
	n, err := strconv.Atoi(trimmed)
	if err != nil || n < 1 {
		return 0
	}
	return n
}

func paginateHistoryMessages(messages []json.RawMessage, limit int, cursor string) ([]json.RawMessage, bool, string) {
	total := len(messages)
	if total == 0 {
		return []json.RawMessage{}, false, ""
	}

	endExclusive := total
	if cursorSeq := parseHistoryCursor(cursor); cursorSeq > 0 {
		endExclusive = cursorSeq - 1
		if endExclusive < 0 {
			endExclusive = 0
		}
		if endExclusive > total {
			endExclusive = total
		}
	}

	if limit <= 0 || limit > endExclusive {
		limit = endExclusive
	}
	start := endExclusive - limit
	if start < 0 {
		start = 0
	}
	page := messages[start:endExclusive]
	hasMore := start > 0
	nextCursor := ""
	if hasMore && len(page) > 0 {
		nextCursor = strconv.Itoa(start + 1)
	}
	return page, hasMore, nextCursor
}

func buildHistoryPageRequest(req *http.Request, cfg openclaw.GWClientConfig, key string, limit int, cursor string, maxChars int) (*http.Request, error) {
	gwURL := fmt.Sprintf("http://%s:%d/sessions/%s/history", cfg.Host, cfg.Port, url.PathEscape(key))
	q := url.Values{}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	if maxChars > 0 {
		q.Set("maxChars", strconv.Itoa(maxChars))
	}
	if qs := q.Encode(); qs != "" {
		gwURL += "?" + qs
	}

	req, err := http.NewRequestWithContext(req.Context(), http.MethodGet, gwURL, nil)
	if err != nil {
		return nil, err
	}
	if cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}
	req.Header.Set("Accept", "application/json")
	return req, nil
}

func fetchHistoryPageViaHTTP(req *http.Request, cfg openclaw.GWClientConfig, key string, limit int, cursor string, maxChars int) (int, []byte, error) {
	httpReq, err := buildHistoryPageRequest(req, cfg, key, limit, cursor, maxChars)
	if err != nil {
		return 0, nil, err
	}
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(httpReq)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return resp.StatusCode, nil, readErr
	}
	return resp.StatusCode, body, nil
}

// SessionsHistoryPaginated prefers the gateway's HTTP cursor-paginated history
// endpoint and only falls back to RPC/local pagination when HTTP auth fails.
// Query params: key (required), limit (optional), cursor (optional).
func (h *GWProxyHandler) SessionsHistoryPaginated(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	if key == "" {
		web.Fail(w, r, "INVALID_PARAMS", "key is required", http.StatusBadRequest)
		return
	}
	limit := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	maxChars := 0
	if v := r.URL.Query().Get("maxChars"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxChars = n
		}
	}
	cursor := r.URL.Query().Get("cursor")

	cfg := h.client.GetConfig()
	if cfg.Host != "" && cfg.Port != 0 && cfg.Token != "" {
		status, body, err := fetchHistoryPageViaHTTP(r, cfg, key, limit, cursor, maxChars)
		if err == nil {
			switch status {
			case http.StatusOK:
				web.OKRaw(w, r, json.RawMessage(body))
				return
			case http.StatusNotFound:
				web.OKRaw(w, r, json.RawMessage(`{"sessionKey":"","messages":[],"items":[],"hasMore":false}`))
				return
			case http.StatusUnauthorized, http.StatusForbidden:
				if h.refreshAuthOnFail != nil && h.refreshAuthOnFail() {
					cfg = h.client.GetConfig()
					status, body, err = fetchHistoryPageViaHTTP(r, cfg, key, limit, cursor, maxChars)
					if err == nil {
						switch status {
						case http.StatusOK:
							web.OKRaw(w, r, json.RawMessage(body))
							return
						case http.StatusNotFound:
							web.OKRaw(w, r, json.RawMessage(`{"sessionKey":"","messages":[],"items":[],"hasMore":false}`))
							return
						}
					}
				}
			}
			if status != http.StatusUnauthorized && status != http.StatusForbidden {
				web.Fail(w, r, "GW_SESSIONS_HISTORY_PAGINATED_FAILED", strings.TrimSpace(string(body)), http.StatusBadGateway)
				return
			}
		}
	}

	history, err := loadPaginatedHistoryFromRPC(h, key, cursor, limit, maxChars)
	if err != nil {
		if openclaw.IsGatewayRPCError(err) {
			// Business logic error (e.g. session deleted / not found) — return empty history
			web.OK(w, r, sessionHistoryPage{SessionKey: key, Messages: []json.RawMessage{}, Items: []json.RawMessage{}})
		} else {
			web.Fail(w, r, "GW_SESSIONS_HISTORY_PAGINATED_FAILED", err.Error(), http.StatusBadGateway)
		}
		return
	}
	web.OK(w, r, history)
}

// SkillsConfigure configures a skill (enable/disable/env vars etc.).
// Retries the full get→modify→set cycle on optimistic concurrency conflicts.
func (h *GWProxyHandler) SkillsConfigure(w http.ResponseWriter, r *http.Request) {
	// parse request body first (can only read r.Body once)
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

	const maxRetries = 3
	for attempt := 0; attempt < maxRetries; attempt++ {
		// get current config (fresh on each attempt)
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

		var baseHash string
		if h, ok := wrapper["hash"].(string); ok {
			baseHash = h
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

		// apply skill changes to config
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

		// save config with baseHash for optimistic concurrency
		cfgJSON, jsonErr := json.Marshal(currentCfg)
		if jsonErr != nil {
			web.Fail(w, r, "CONFIG_SERIALIZE_FAILED", jsonErr.Error(), http.StatusInternalServerError)
			return
		}
		setParams := map[string]interface{}{
			"raw": string(cfgJSON),
		}
		if baseHash != "" {
			setParams["baseHash"] = baseHash
		}
		saveData, err := h.client.RequestWithTimeout("config.set", setParams, 15*time.Second)
		if err != nil {
			if isConfigConflictError(err) && attempt < maxRetries-1 {
				logger.Config.Warn().Int("attempt", attempt+1).Str("skillKey", params.SkillKey).Msg("skills.configure config.set conflict, retrying")
				time.Sleep(200 * time.Millisecond)
				continue
			}
			web.Fail(w, r, "GW_CONFIG_SET_FAILED", err.Error(), http.StatusBadGateway)
			return
		}

		web.OKRaw(w, r, saveData)
		return
	}
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

// isConfigConflictError checks if the error is an optimistic concurrency conflict
// from the Gateway ("config changed since last load", "invalid config", etc.).
func isConfigConflictError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "config changed since last load") ||
		strings.Contains(msg, "invalid config") ||
		strings.Contains(msg, "fix before patching") ||
		strings.Contains(msg, "INVALID_REQUEST")
}

func configRateLimitDelay(err error) (time.Duration, bool) {
	if err == nil {
		return 0, false
	}
	msg := err.Error()
	if !strings.Contains(msg, "rate limit exceeded") || !strings.Contains(msg, "retry after ") {
		return 0, false
	}
	after := msg[strings.Index(msg, "retry after ")+len("retry after "):]
	fields := strings.Fields(after)
	if len(fields) == 0 {
		return 10 * time.Second, true
	}
	value := strings.TrimSuffix(fields[0], "s")
	seconds, convErr := strconv.Atoi(value)
	if convErr != nil || seconds <= 0 {
		return 10 * time.Second, true
	}
	if seconds > 65 {
		seconds = 65
	}
	return time.Duration(seconds)*time.Second + 250*time.Millisecond, true
}

// fetchFreshBaseHash fetches a fresh config snapshot from Gateway and returns its hash.
func (h *GWProxyHandler) fetchFreshBaseHash() string {
	data, err := h.client.RequestWithTimeout("config.get", map[string]interface{}{}, 10*time.Second)
	if err != nil {
		return ""
	}
	var result map[string]interface{}
	if json.Unmarshal(data, &result) == nil {
		if h, ok := result["hash"].(string); ok {
			return h
		}
	}
	return ""
}

// slowMethods are RPC methods that need longer timeouts (install/update etc.).
var slowMethods = map[string]bool{
	"skills.install": true,
	"skills.update":  true,
	"update.run":     true,
}

func proxyTimeoutForMethod(method string) time.Duration {
	if slowMethods[method] {
		return 5 * time.Minute
	}
	// Chat/session methods are latency-sensitive and may include larger payloads.
	switch method {
	case "chat.history", "sessions.preview", "sessions.usage.logs":
		return 60 * time.Second
	case "chat.send", "chat.abort", "sessions.list":
		return 45 * time.Second
	default:
		return 30 * time.Second
	}
}

// isConfigMutatingMethod returns true for config methods that support baseHash
// and may need automatic retry on conflict.
func isConfigMutatingMethod(method string) bool {
	return method == "config.patch" || method == "config.apply" || method == "config.set"
}

// GenericProxy forwards any method to the Gateway.
// For config-mutating methods (config.patch, config.apply), it auto-retries on
// conflict errors by refreshing the baseHash from the gateway.
func (h *GWProxyHandler) GenericProxy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Method string      `json:"method"`
		Params interface{} `json:"params,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Method == "" {
		web.Fail(w, r, "INVALID_PARAMS", "method is required", http.StatusBadRequest)
		return
	}
	timeout := proxyTimeoutForMethod(req.Method)

	if isConfigMutatingMethod(req.Method) {
		h.proxyConfigMutating(w, r, req.Method, req.Params, timeout)
		return
	}

	if req.Method == "sessions.send" || req.Method == "sessions.abort" {
		req.Params = h.rewriteSessionKeyParam(req.Params)
	}

	data, err := h.client.RequestWithTimeout(req.Method, req.Params, timeout)
	if err != nil {
		if openclaw.IsGatewayRPCError(err) {
			web.Fail(w, r, "GW_RPC_ERROR", err.Error(), http.StatusUnprocessableEntity)
		} else {
			web.Fail(w, r, "GW_PROXY_FAILED", err.Error(), http.StatusBadGateway)
		}
		return
	}
	web.OKRaw(w, r, data)
}

// proxyConfigMutating handles config.patch / config.apply with automatic retry
// on optimistic concurrency conflict.
func (h *GWProxyHandler) proxyConfigMutating(w http.ResponseWriter, r *http.Request, method string, params interface{}, timeout time.Duration) {
	const maxRetries = 6
	for attempt := 0; attempt < maxRetries; attempt++ {
		rpcParams := toMapParams(params)

		freshHash := h.fetchFreshBaseHash()
		if freshHash != "" {
			rpcParams["baseHash"] = freshHash
		}

		data, err := h.client.RequestWithTimeout(method, rpcParams, timeout)
		if err != nil {
			if delay, ok := configRateLimitDelay(err); ok && attempt < maxRetries-1 {
				logger.Config.Warn().Str("method", method).Int("attempt", attempt+1).Dur("delay", delay).Msg("config write rate-limited, retrying after gateway delay")
				time.Sleep(delay)
				continue
			}
			if isConfigConflictError(err) && attempt < maxRetries-1 {
				logger.Config.Warn().Str("method", method).Int("attempt", attempt+1).Msg("config conflict, retrying with fresh baseHash")
				time.Sleep(200 * time.Millisecond)
				continue
			}
			if openclaw.IsGatewayRPCError(err) {
				web.Fail(w, r, "GW_RPC_ERROR", err.Error(), http.StatusUnprocessableEntity)
			} else {
				web.Fail(w, r, "GW_PROXY_FAILED", err.Error(), http.StatusBadGateway)
			}
			return
		}
		web.OKRaw(w, r, data)
		return
	}
}

func (h *GWProxyHandler) rewriteSessionKeyParam(params interface{}) interface{} {
	m := toMapParams(params)
	if h.client.UseSessionKeyParam() {
		if sk, ok := m["sessionKey"]; ok {
			if _, hasKey := m["key"]; !hasKey {
				m["key"] = sk
			}
			delete(m, "sessionKey")
		}
	} else {
		if k, ok := m["key"]; ok {
			if _, hasSK := m["sessionKey"]; !hasSK {
				m["sessionKey"] = k
			}
			delete(m, "key")
		}
	}
	return m
}

// toMapParams safely converts interface{} params to a mutable map.
func toMapParams(params interface{}) map[string]interface{} {
	result := make(map[string]interface{})
	if params == nil {
		return result
	}
	if m, ok := params.(map[string]interface{}); ok {
		for k, v := range m {
			result[k] = v
		}
		return result
	}
	// Fallback: marshal/unmarshal to convert struct or other types
	data, err := json.Marshal(params)
	if err != nil {
		return result
	}
	json.Unmarshal(data, &result)
	return result
}
