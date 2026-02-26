package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// WizardHandler handles model/channel config wizard APIs.
type WizardHandler struct {
	auditRepo *database.AuditLogRepo
}

func NewWizardHandler() *WizardHandler {
	return &WizardHandler{
		auditRepo: database.NewAuditLogRepo(),
	}
}

// ---------- Model Wizard ----------

// ModelWizardRequest is the model wizard save request.
type ModelWizardRequest struct {
	Provider      string `json:"provider"`
	APIKey        string `json:"apiKey"`
	BaseURL       string `json:"baseUrl"`
	Model         string `json:"model"`
	APIType       string `json:"apiType"`
	FallbackModel string `json:"fallbackModel"`
	Streaming     bool   `json:"streaming"`
}

// TestModelRequest is the model connection test request.
type TestModelRequest struct {
	Provider string `json:"provider"`
	APIKey   string `json:"apiKey"`
	BaseURL  string `json:"baseUrl"`
	Model    string `json:"model"`
	APIType  string `json:"apiType"`
}

type DiscoverModelsRequest struct {
	Provider string `json:"provider"`
	APIKey   string `json:"apiKey"`
	BaseURL  string `json:"baseUrl"`
	APIType  string `json:"apiType"`
}

type DiscoveredModel struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

// TestModel tests model connection.
// POST /api/v1/setup/test-model
func (h *WizardHandler) TestModel(w http.ResponseWriter, r *http.Request) {
	var req TestModelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Provider == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	// non-local providers require an API key
	if req.Provider != "ollama" && req.APIKey == "" {
		web.Fail(w, r, "MODEL_NO_API_KEY", "API Key is required for "+req.Provider, http.StatusBadRequest)
		return
	}

	if req.Model == "" {
		web.Fail(w, r, "MODEL_NO_MODEL", "Model ID is required", http.StatusBadRequest)
		return
	}

	result, err := h.probeModel(req)
	if err != nil {
		web.FailErr(w, r, web.ErrGWModelTestFailed, err.Error())
		return
	}
	web.OK(w, r, result)
}

// DiscoverModels discovers model IDs from provider endpoints.
// POST /api/v1/setup/discover-models
func (h *WizardHandler) DiscoverModels(w http.ResponseWriter, r *http.Request) {
	var req DiscoverModelsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if strings.TrimSpace(req.Provider) == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	models, source, err := discoverModels(req)
	if err != nil {
		web.Fail(w, r, "MODEL_DISCOVER_FAILED", err.Error(), http.StatusBadGateway)
		return
	}
	web.OK(w, r, map[string]interface{}{
		"models": models,
		"count":  len(models),
		"source": source,
	})
}

// probeModel sends a minimal chat completion request to verify the API key and model.
func (h *WizardHandler) probeModel(req TestModelRequest) (map[string]interface{}, error) {
	endpoint, authHeader, body, err := buildProbeRequest(req)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	for k, v := range authHeader {
		httpReq.Header.Set(k, v)
	}

	start := time.Now()
	resp, err := http.DefaultClient.Do(httpReq)
	latencyMs := time.Since(start).Milliseconds()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("connection timed out after 15s")
		}
		return nil, fmt.Errorf("connection failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))

	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return nil, fmt.Errorf("authentication failed (HTTP %d): invalid API key", resp.StatusCode)
	}
	if resp.StatusCode == 404 {
		return nil, fmt.Errorf("model not found (HTTP %d): check model ID", resp.StatusCode)
	}
	if resp.StatusCode == 429 {
		return nil, fmt.Errorf("rate limited (HTTP %d): too many requests or billing issue", resp.StatusCode)
	}
	if resp.StatusCode >= 400 {
		detail := extractErrorDetail(respBody)
		return nil, fmt.Errorf("API error (HTTP %d): %s", resp.StatusCode, detail)
	}

	return map[string]interface{}{
		"status":    "ok",
		"message":   "Connection test passed",
		"latencyMs": latencyMs,
	}, nil
}

// buildProbeRequest builds the HTTP request for probing a model provider.
func buildProbeRequest(req TestModelRequest) (endpoint string, headers map[string]string, body []byte, err error) {
	provider := strings.ToLower(req.Provider)
	apiType := strings.ToLower(strings.TrimSpace(req.APIType))
	baseURL := strings.TrimRight(req.BaseURL, "/")

	switch {
	case provider == "anthropic" || apiType == "anthropic-messages":
		if baseURL == "" {
			baseURL = "https://api.anthropic.com"
		}
		endpoint = baseURL + "/v1/messages"
		headers = map[string]string{
			"anthropic-version": "2023-06-01",
		}
		if req.APIKey != "" {
			headers["Authorization"] = "Bearer " + req.APIKey
			headers["x-api-key"] = req.APIKey
		}
		body, _ = json.Marshal(map[string]interface{}{
			"model":      req.Model,
			"max_tokens": 4,
			"messages":   []map[string]string{{"role": "user", "content": "Reply OK"}},
		})

	case provider == "google" || provider == "gemini" || apiType == "google-generative-ai":
		if baseURL == "" {
			baseURL = "https://generativelanguage.googleapis.com/v1beta"
		}
		endpoint = baseURL + "/models/" + req.Model + ":generateContent?key=" + req.APIKey
		headers = map[string]string{}
		body, _ = json.Marshal(map[string]interface{}{
			"contents": []map[string]interface{}{
				{"parts": []map[string]string{{"text": "Reply OK"}}},
			},
			"generationConfig": map[string]interface{}{"maxOutputTokens": 4},
		})

	default:
		// OpenAI-compatible (openai, deepseek, moonshot, openrouter, groq, ollama, custom, etc.)
		if baseURL == "" {
			baseURL = "https://api.openai.com/v1"
		}
		endpoint = baseURL + "/chat/completions"
		headers = map[string]string{}
		if req.APIKey != "" {
			headers["Authorization"] = "Bearer " + req.APIKey
		}
		body, _ = json.Marshal(map[string]interface{}{
			"model":      req.Model,
			"max_tokens": 4,
			"messages":   []map[string]string{{"role": "user", "content": "Reply OK"}},
		})
	}

	return endpoint, headers, body, nil
}

func discoverModels(req DiscoverModelsRequest) ([]DiscoveredModel, string, error) {
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	apiType := strings.ToLower(strings.TrimSpace(req.APIType))
	baseURL := strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")

	switch {
	case provider == "ollama":
		models, err := discoverOllamaModelsFromEndpoint(baseURL)
		return models, "ollama", err
	case provider == "gemini" || provider == "google" || provider == "google-gemini-cli":
		models, err := discoverGoogleModelsFromEndpoint(baseURL, req.APIKey)
		return models, "google", err
	case provider == "anthropic" || apiType == "anthropic-messages":
		models, err := discoverAnthropicModelsFromEndpoint(baseURL, req.APIKey)
		return models, "anthropic", err
	default:
		models, err := discoverOpenAICompatibleModelsFromEndpoint(baseURL, req.APIKey)
		return models, "openai-compatible", err
	}
}

func discoverOpenAICompatibleModelsFromEndpoint(baseURL, apiKey string) ([]DiscoveredModel, error) {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	endpoint := strings.TrimRight(baseURL, "/") + "/models"
	headers := map[string]string{}
	if strings.TrimSpace(apiKey) != "" {
		headers["Authorization"] = "Bearer " + strings.TrimSpace(apiKey)
	}
	resp, err := doJSONRequest("GET", endpoint, headers, nil)
	if err != nil {
		return nil, err
	}
	models := parseOpenAIModelsResponse(resp)
	if len(models) == 0 {
		return nil, fmt.Errorf("no models discovered from %s", endpoint)
	}
	return dedupeModels(models), nil
}

func discoverAnthropicModelsFromEndpoint(baseURL, apiKey string) ([]DiscoveredModel, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("API Key is required for anthropic model discovery")
	}
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}
	endpoint := strings.TrimRight(baseURL, "/") + "/v1/models"
	headers := map[string]string{
		"anthropic-version": "2023-06-01",
	}
	trimmedKey := strings.TrimSpace(apiKey)
	headers["x-api-key"] = trimmedKey
	// Compatibility: some Anthropic-compatible gateways accept Authorization only.
	headers["Authorization"] = "Bearer " + trimmedKey
	resp, err := doJSONRequest("GET", endpoint, headers, nil)
	if err != nil {
		return nil, err
	}
	models := parseOpenAIModelsResponse(resp)
	if len(models) == 0 {
		return nil, fmt.Errorf("no models discovered from %s", endpoint)
	}
	return dedupeModels(models), nil
}

func discoverGoogleModelsFromEndpoint(baseURL, apiKey string) ([]DiscoveredModel, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("API Key is required for google model discovery")
	}
	if baseURL == "" {
		baseURL = "https://generativelanguage.googleapis.com/v1beta"
	}
	q := url.Values{}
	q.Set("key", strings.TrimSpace(apiKey))
	endpoint := strings.TrimRight(baseURL, "/") + "/models?" + q.Encode()
	resp, err := doJSONRequest("GET", endpoint, nil, nil)
	if err != nil {
		return nil, err
	}

	raw, _ := resp["models"].([]interface{})
	out := make([]DiscoveredModel, 0, len(raw))
	for _, it := range raw {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		name := strings.TrimSpace(anyString(m["name"]))
		display := strings.TrimSpace(anyString(m["displayName"]))
		id := strings.TrimPrefix(name, "models/")
		if id == "" {
			continue
		}
		out = append(out, DiscoveredModel{ID: id, Name: display})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no models discovered from %s", endpoint)
	}
	return dedupeModels(out), nil
}

func discoverOllamaModelsFromEndpoint(baseURL string) ([]DiscoveredModel, error) {
	base := strings.TrimSpace(baseURL)
	if base == "" {
		base = "http://localhost:11434"
	}
	base = strings.TrimRight(base, "/")
	base = strings.TrimSuffix(base, "/v1")
	base = strings.TrimSuffix(base, "/v1/")
	endpoint := base + "/api/tags"
	resp, err := doJSONRequest("GET", endpoint, nil, nil)
	if err != nil {
		return nil, err
	}
	raw, _ := resp["models"].([]interface{})
	out := make([]DiscoveredModel, 0, len(raw))
	for _, it := range raw {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		id := strings.TrimSpace(anyString(m["model"]))
		name := strings.TrimSpace(anyString(m["name"]))
		if id == "" {
			id = name
		}
		if id == "" {
			continue
		}
		out = append(out, DiscoveredModel{ID: id, Name: name})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no models discovered from %s", endpoint)
	}
	return dedupeModels(out), nil
}

func doJSONRequest(method, endpoint string, headers map[string]string, body []byte) (map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("request timeout: %s", endpoint)
		}
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("endpoint error (HTTP %d): %s", resp.StatusCode, extractErrorDetail(data))
	}

	var obj map[string]interface{}
	if err := json.Unmarshal(data, &obj); err != nil {
		return nil, fmt.Errorf("invalid response json: %w", err)
	}
	return obj, nil
}

func parseOpenAIModelsResponse(resp map[string]interface{}) []DiscoveredModel {
	raw, _ := resp["data"].([]interface{})
	out := make([]DiscoveredModel, 0, len(raw))
	for _, it := range raw {
		m, ok := it.(map[string]interface{})
		if !ok {
			continue
		}
		id := strings.TrimSpace(anyString(m["id"]))
		if id == "" {
			continue
		}
		name := strings.TrimSpace(anyString(m["name"]))
		out = append(out, DiscoveredModel{ID: id, Name: name})
	}
	return out
}

func dedupeModels(in []DiscoveredModel) []DiscoveredModel {
	seen := make(map[string]struct{}, len(in))
	out := make([]DiscoveredModel, 0, len(in))
	for _, m := range in {
		id := strings.TrimSpace(m.ID)
		if id == "" {
			continue
		}
		key := strings.ToLower(id)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, DiscoveredModel{ID: id, Name: strings.TrimSpace(m.Name)})
	}
	return out
}

func anyString(v interface{}) string {
	s, _ := v.(string)
	return s
}

// extractErrorDetail extracts a human-readable error from an API response body.
func extractErrorDetail(body []byte) string {
	var parsed map[string]interface{}
	if json.Unmarshal(body, &parsed) == nil {
		if errObj, ok := parsed["error"].(map[string]interface{}); ok {
			if msg, ok := errObj["message"].(string); ok && msg != "" {
				return msg
			}
		}
		if msg, ok := parsed["message"].(string); ok && msg != "" {
			return msg
		}
		if detail, ok := parsed["detail"].(string); ok && detail != "" {
			return detail
		}
	}
	s := strings.TrimSpace(string(body))
	if len(s) > 200 {
		s = s[:200] + "..."
	}
	if s == "" {
		return "unknown error"
	}
	return s
}

// SaveModel saves model configuration.
// POST /api/v1/config/model-wizard
func (h *WizardHandler) SaveModel(w http.ResponseWriter, r *http.Request) {
	var req ModelWizardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Provider == "" || req.Model == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	config := h.buildModelConfig(req)

	// write config
	if err := h.mergeConfig(config); err != nil {
		web.FailErr(w, r, web.ErrConfigWriteFailed, err.Error())
		return
	}

	// write API key to .env file if provided
	if req.APIKey != "" {
		envKey := providerEnvKey(req.Provider)
		if envKey != "" {
			h.writeEnvKey(envKey, req.APIKey)
		}
	}

	// audit log
	if h.auditRepo != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID:   web.GetUserID(r),
			Username: web.GetUsername(r),
			Action:   constants.ActionConfigUpdate,
			Result:   "success",
			Detail:   fmt.Sprintf("model-wizard: %s/%s", req.Provider, req.Model),
			IP:       r.RemoteAddr,
		})
	}

	logger.Config.Info().
		Str("user", web.GetUsername(r)).
		Str("provider", req.Provider).
		Str("model", req.Model).
		Msg("model wizard config saved")

	web.OK(w, r, map[string]string{"message": "ok"})
}

// buildModelConfig builds config object from wizard request.
func (h *WizardHandler) buildModelConfig(req ModelWizardRequest) map[string]interface{} {
	config := make(map[string]interface{})

	// agents.defaults.model
	modelConfig := map[string]interface{}{
		"primary": req.Provider + "/" + req.Model,
	}
	if req.FallbackModel != "" {
		modelConfig["fallbacks"] = []string{req.FallbackModel}
	}
	config["agents"] = map[string]interface{}{
		"defaults": map[string]interface{}{
			"model": modelConfig,
		},
	}

	// custom providers need models.providers config
	if needsProviderConfig(req.Provider) {
		providerCfg := map[string]interface{}{
			"api": req.APIType,
		}
		if req.BaseURL != "" {
			providerCfg["baseUrl"] = req.BaseURL
		}
		if req.APIKey != "" {
			envKey := providerEnvKey(req.Provider)
			if envKey != "" {
				providerCfg["apiKey"] = "${" + envKey + "}"
			}
		}
		providerCfg["models"] = []map[string]interface{}{
			{"id": req.Model, "name": req.Model},
		}

		config["models"] = map[string]interface{}{
			"mode": "merge",
			"providers": map[string]interface{}{
				req.Provider: providerCfg,
			},
		}
	}

	return config
}

// ---------- Channel Wizard ----------

// ChannelWizardRequest is the channel wizard save request.
type ChannelWizardRequest struct {
	Channel        string            `json:"channel"`
	Tokens         map[string]string `json:"tokens"`
	DmPolicy       string            `json:"dmPolicy"`
	AllowFrom      []string          `json:"allowFrom"`
	RequireMention bool              `json:"requireMention"`
}

// TestChannelRequest is the channel connection test request.
type TestChannelRequest struct {
	Channel string            `json:"channel"`
	Tokens  map[string]string `json:"tokens"`
}

// TestChannel tests channel connection.
// POST /api/v1/setup/test-channel
func (h *WizardHandler) TestChannel(w http.ResponseWriter, r *http.Request) {
	var req TestChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Channel == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	// basic token format validation
	if err := h.validateChannelTokens(req.Channel, req.Tokens); err != nil {
		web.Fail(w, r, "TOKEN_INVALID", err.Error(), http.StatusBadRequest)
		return
	}

	// Try real API validation for supported channels
	switch req.Channel {
	case "discord":
		result, err := h.testDiscordToken(req.Tokens["token"])
		if err != nil {
			web.OK(w, r, map[string]interface{}{
				"status":  "fail",
				"message": err.Error(),
			})
			return
		}
		web.OK(w, r, result)
		return
	case "telegram":
		result, err := h.testTelegramToken(req.Tokens["botToken"])
		if err != nil {
			web.OK(w, r, map[string]interface{}{
				"status":  "fail",
				"message": err.Error(),
			})
			return
		}
		web.OK(w, r, result)
		return
	}

	// For other channels, try CLI if available
	if openclaw.IsOpenClawInstalled() {
		result, err := h.testChannelViaCLI(req)
		if err != nil {
			web.OK(w, r, map[string]interface{}{
				"status":  "fail",
				"message": err.Error(),
			})
			return
		}
		web.OK(w, r, result)
		return
	}

	// Fallback: token format valid but no real test
	web.OK(w, r, map[string]interface{}{
		"status":  "ok",
		"message": "token format valid (real connection test not available for this channel)",
	})
}

// validateChannelTokens validates channel token format.
func (h *WizardHandler) validateChannelTokens(channel string, tokens map[string]string) error {
	switch channel {
	case "telegram":
		token := tokens["botToken"]
		if token == "" {
			return fmt.Errorf("Telegram Bot Token is required")
		}
		if len(token) < 10 {
			return fmt.Errorf("Telegram Bot Token format invalid (too short)")
		}
	case "discord":
		token := tokens["token"]
		if token == "" {
			return fmt.Errorf("Discord Bot Token is required")
		}
		if len(token) < 20 {
			return fmt.Errorf("Discord Bot Token format invalid (too short)")
		}
	case "slack":
		appToken := tokens["appToken"]
		botToken := tokens["botToken"]
		if appToken == "" {
			return fmt.Errorf("Slack App Token is required")
		}
		if botToken == "" {
			return fmt.Errorf("Slack Bot Token is required")
		}
		if len(appToken) > 4 && appToken[:4] != "xapp" {
			return fmt.Errorf("Slack App Token should start with xapp-")
		}
		if len(botToken) > 4 && botToken[:4] != "xoxb" {
			return fmt.Errorf("Slack Bot Token should start with xoxb-")
		}
	case "signal":
		account := tokens["account"]
		if account == "" {
			return fmt.Errorf("Signal account is required")
		}
		if len(account) < 2 || account[0] != '+' {
			return fmt.Errorf("Signal account must be in E.164 format (starts with +)")
		}
	case "whatsapp":
		// WhatsApp requires no token
	case "feishu":
		if tokens["appId"] == "" {
			return fmt.Errorf("Feishu App ID is required")
		}
		if tokens["appSecret"] == "" {
			return fmt.Errorf("Feishu App Secret is required")
		}
	case "wecom", "wecom_kf":
		if tokens["corpId"] == "" {
			return fmt.Errorf("WeCom Corp ID is required")
		}
		if tokens["secret"] == "" {
			return fmt.Errorf("WeCom Secret is required")
		}
	case "dingtalk":
		if tokens["appKey"] == "" {
			return fmt.Errorf("DingTalk App Key is required")
		}
		if tokens["appSecret"] == "" {
			return fmt.Errorf("DingTalk App Secret is required")
		}
	case "msteams":
		if tokens["appId"] == "" {
			return fmt.Errorf("MS Teams App ID is required")
		}
		if tokens["appPassword"] == "" {
			return fmt.Errorf("MS Teams App Password is required")
		}
	case "matrix":
		if tokens["homeserver"] == "" {
			return fmt.Errorf("Matrix Homeserver is required")
		}
		if tokens["accessToken"] == "" {
			return fmt.Errorf("Matrix Access Token is required")
		}
	case "mattermost":
		if tokens["botToken"] == "" {
			return fmt.Errorf("Mattermost Bot Token is required")
		}
		if tokens["baseUrl"] == "" {
			return fmt.Errorf("Mattermost Base URL is required")
		}
	case "wechat":
		if tokens["appId"] == "" {
			return fmt.Errorf("WeChat App ID is required")
		}
		if tokens["appSecret"] == "" {
			return fmt.Errorf("WeChat App Secret is required")
		}
	case "qq":
		if tokens["appId"] == "" {
			return fmt.Errorf("QQ App ID is required")
		}
		if tokens["appSecret"] == "" {
			return fmt.Errorf("QQ App Secret is required")
		}
	case "doubao":
		if tokens["appId"] == "" {
			return fmt.Errorf("Doubao App ID is required")
		}
		if tokens["appSecret"] == "" {
			return fmt.Errorf("Doubao App Secret is required")
		}
	case "zalo":
		if tokens["botToken"] == "" {
			return fmt.Errorf("Zalo Bot Token is required")
		}
	case "imessage", "bluebubbles", "googlechat", "voicecall":
		// these channels have special validation, basic pass only
	default:
		// unknown channel types also pass basic validation
	}
	return nil
}

// testDiscordToken validates Discord bot token by calling Discord API.
func (h *WizardHandler) testDiscordToken(token string) (map[string]interface{}, error) {
	if token == "" {
		return nil, fmt.Errorf("Discord Bot Token is required")
	}

	// Normalize token (remove "Bot " prefix if present)
	normalizedToken := strings.TrimSpace(token)
	if strings.HasPrefix(strings.ToLower(normalizedToken), "bot ") {
		normalizedToken = strings.TrimSpace(normalizedToken[4:])
	}

	// Call Discord API to validate token
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", "https://discord.com/api/v10/users/@me", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}
	req.Header.Set("Authorization", "Bot "+normalizedToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Discord API request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		return nil, fmt.Errorf("Invalid Discord Bot Token (401 Unauthorized)")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Discord API returned status %d", resp.StatusCode)
	}

	// Parse response to get bot info
	var botInfo struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&botInfo); err != nil {
		return nil, fmt.Errorf("failed to parse Discord response: %v", err)
	}

	return map[string]interface{}{
		"status":  "ok",
		"message": fmt.Sprintf("Connected to Discord bot: %s (ID: %s)", botInfo.Username, botInfo.ID),
		"bot": map[string]string{
			"id":       botInfo.ID,
			"username": botInfo.Username,
		},
	}, nil
}

// testTelegramToken validates Telegram bot token by calling Telegram API.
func (h *WizardHandler) testTelegramToken(token string) (map[string]interface{}, error) {
	if token == "" {
		return nil, fmt.Errorf("Telegram Bot Token is required")
	}

	// Call Telegram API to validate token
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	url := fmt.Sprintf("https://api.telegram.org/bot%s/getMe", token)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Telegram API request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 {
		return nil, fmt.Errorf("Invalid Telegram Bot Token (401 Unauthorized)")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Telegram API returned status %d", resp.StatusCode)
	}

	// Parse response
	var telegramResp struct {
		OK     bool `json:"ok"`
		Result struct {
			ID        int64  `json:"id"`
			FirstName string `json:"first_name"`
			Username  string `json:"username"`
		} `json:"result"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&telegramResp); err != nil {
		return nil, fmt.Errorf("failed to parse Telegram response: %v", err)
	}

	if !telegramResp.OK {
		return nil, fmt.Errorf("Telegram API error: %s", telegramResp.Description)
	}

	return map[string]interface{}{
		"status":  "ok",
		"message": fmt.Sprintf("Connected to Telegram bot: @%s (%s)", telegramResp.Result.Username, telegramResp.Result.FirstName),
		"bot": map[string]interface{}{
			"id":       telegramResp.Result.ID,
			"username": telegramResp.Result.Username,
			"name":     telegramResp.Result.FirstName,
		},
	}, nil
}

// testChannelViaCLI tests channel via openclaw CLI.
func (h *WizardHandler) testChannelViaCLI(req TestChannelRequest) (map[string]interface{}, error) {
	output, err := openclaw.RunCLIWithTimeout("channels", "status", "--probe")
	if err != nil {
		return nil, fmt.Errorf("channel status check failed: %s", output)
	}
	return map[string]interface{}{
		"status":  "ok",
		"message": "channel connection test passed",
		"output":  output,
	}, nil
}

// SaveChannel saves channel configuration.
// POST /api/v1/config/channel-wizard
func (h *WizardHandler) SaveChannel(w http.ResponseWriter, r *http.Request) {
	var req ChannelWizardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Channel == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	config := h.buildChannelConfig(req)

	if err := h.mergeConfig(config); err != nil {
		web.FailErr(w, r, web.ErrConfigWriteFailed, err.Error())
		return
	}

	// audit log
	if h.auditRepo != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID:   web.GetUserID(r),
			Username: web.GetUsername(r),
			Action:   constants.ActionConfigUpdate,
			Result:   "success",
			Detail:   fmt.Sprintf("channel-wizard: %s (dmPolicy=%s)", req.Channel, req.DmPolicy),
			IP:       r.RemoteAddr,
		})
	}

	logger.Config.Info().
		Str("user", web.GetUsername(r)).
		Str("channel", req.Channel).
		Str("dmPolicy", req.DmPolicy).
		Msg("channel wizard config saved")

	web.OK(w, r, map[string]string{"message": "ok"})
}

// buildChannelConfig builds channel config object from wizard request.
func (h *WizardHandler) buildChannelConfig(req ChannelWizardRequest) map[string]interface{} {
	ch := map[string]interface{}{
		"enabled": true,
	}

	switch req.Channel {
	case "telegram":
		ch["botToken"] = req.Tokens["botToken"]
		ch["dmPolicy"] = req.DmPolicy
		if len(req.AllowFrom) > 0 {
			ch["allowFrom"] = req.AllowFrom
		}
		ch["groups"] = map[string]interface{}{
			"*": map[string]interface{}{
				"requireMention": req.RequireMention,
			},
		}

	case "discord":
		ch["token"] = req.Tokens["token"]
		dm := map[string]interface{}{
			"enabled": true,
			"policy":  req.DmPolicy,
		}
		if len(req.AllowFrom) > 0 {
			dm["allowFrom"] = req.AllowFrom
		}
		ch["dm"] = dm
		ch["guilds"] = map[string]interface{}{
			"*": map[string]interface{}{
				"requireMention": req.RequireMention,
			},
		}

	case "slack":
		ch["appToken"] = req.Tokens["appToken"]
		ch["botToken"] = req.Tokens["botToken"]
		if userToken, ok := req.Tokens["userToken"]; ok && userToken != "" {
			ch["userToken"] = userToken
		}

	case "whatsapp":
		ch["dmPolicy"] = req.DmPolicy
		if len(req.AllowFrom) > 0 {
			ch["allowFrom"] = req.AllowFrom
		}

	case "signal":
		ch["account"] = req.Tokens["account"]
		if cliPath, ok := req.Tokens["cliPath"]; ok && cliPath != "" {
			ch["cliPath"] = cliPath
		}
		ch["dmPolicy"] = req.DmPolicy
		if len(req.AllowFrom) > 0 {
			ch["allowFrom"] = req.AllowFrom
		}
	}

	return map[string]interface{}{
		"channels": map[string]interface{}{
			req.Channel: ch,
		},
	}
}

// ---------- Shared Helpers ----------

// mergeConfig merges config into openclaw.json.
func (h *WizardHandler) mergeConfig(config map[string]interface{}) error {
	// prefer openclaw CLI for safe writes
	if openclaw.IsOpenClawInstalled() {
		if err := openclaw.ConfigApplyFull(config); err != nil {
			logger.Config.Warn().Err(err).Msg("openclaw config set failed, falling back to direct write")
			return h.writeConfigDirect(config)
		}
		return nil
	}
	return h.writeConfigDirect(config)
}

// writeConfigDirect writes config file directly (fallback).
func (h *WizardHandler) writeConfigDirect(config map[string]interface{}) error {
	path := configPath()
	if path == "" {
		return fmt.Errorf("cannot determine config file path")
	}

	// read existing config
	existing := make(map[string]interface{})
	if data, err := os.ReadFile(path); err == nil {
		json.Unmarshal(data, &existing)
	}

	// deep merge
	deepMerge(existing, config)

	// atomic write
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
		os.WriteFile(path, data, 0o600)
		os.Remove(tmpFile)
	}

	return nil
}

// writeEnvKey writes an API key to ~/.openclaw/.env.
func (h *WizardHandler) writeEnvKey(key, value string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	envPath := filepath.Join(home, ".openclaw", ".env")

	// read existing content
	existing := ""
	if data, err := os.ReadFile(envPath); err == nil {
		existing = string(data)
	}

	// check if key already exists
	lines := splitLines(existing)
	found := false
	for i, line := range lines {
		if len(line) > len(key)+1 && line[:len(key)+1] == key+"=" {
			lines[i] = key + "=" + value
			found = true
			break
		}
	}
	if !found {
		lines = append(lines, key+"="+value)
	}

	content := joinLines(lines)

	dir := filepath.Dir(envPath)
	os.MkdirAll(dir, 0o700)
	os.WriteFile(envPath, []byte(content), 0o600)
}

// deepMerge deep-merges src into dst.
func deepMerge(dst, src map[string]interface{}) {
	for key, srcVal := range src {
		dstVal, exists := dst[key]
		if !exists {
			dst[key] = srcVal
			continue
		}
		srcMap, srcOk := srcVal.(map[string]interface{})
		dstMap, dstOk := dstVal.(map[string]interface{})
		if srcOk && dstOk {
			deepMerge(dstMap, srcMap)
		} else {
			dst[key] = srcVal
		}
	}
}

// providerEnvKey returns the env var name for a provider.
func providerEnvKey(provider string) string {
	switch provider {
	case "anthropic":
		return "ANTHROPIC_API_KEY"
	case "openai":
		return "OPENAI_API_KEY"
	case "google":
		return "GEMINI_API_KEY"
	case "moonshot":
		return "MOONSHOT_API_KEY"
	case "deepseek":
		return "DEEPSEEK_API_KEY"
	case "openrouter":
		return "OPENROUTER_API_KEY"
	case "opencode":
		return "OPENCODE_API_KEY"
	case "synthetic":
		return "SYNTHETIC_API_KEY"
	case "minimax":
		return "MINIMAX_API_KEY"
	default:
		return ""
	}
}

// needsProviderConfig checks if models.providers config is needed.
func needsProviderConfig(provider string) bool {
	switch provider {
	case "moonshot", "deepseek", "ollama", "custom", "minimax", "synthetic":
		return true
	default:
		return false
	}
}

// splitLines splits a string by newlines.
func splitLines(s string) []string {
	if s == "" {
		return []string{}
	}
	lines := []string{}
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}

// joinLines joins lines into a string.
func joinLines(lines []string) string {
	result := ""
	for i, line := range lines {
		if line == "" {
			continue
		}
		if i > 0 {
			result += "\n"
		}
		result += line
	}
	if result != "" {
		result += "\n"
	}
	return result
}

// ---------- Pairing Management ----------

// ListPairingRequests lists pending pairing requests for a channel.
// GET /api/v1/pairing/list?channel=telegram
func (h *WizardHandler) ListPairingRequests(w http.ResponseWriter, r *http.Request) {
	channel := r.URL.Query().Get("channel")
	if channel == "" {
		web.Fail(w, r, "INVALID_PARAM", "channel is required", http.StatusBadRequest)
		return
	}

	if !openclaw.IsOpenClawInstalled() {
		web.Fail(w, r, "OPENCLAW_NOT_INSTALLED", "OpenClaw is not installed", http.StatusServiceUnavailable)
		return
	}

	result, err := openclaw.PairingList(channel)
	if err != nil {
		web.OK(w, r, map[string]interface{}{
			"channel":  channel,
			"requests": []interface{}{},
			"error":    err.Error(),
		})
		return
	}

	web.OK(w, r, result)
}

// ApprovePairingRequest approves a pairing code.
// POST /api/v1/pairing/approve
func (h *WizardHandler) ApprovePairingRequest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Channel string `json:"channel"`
		Code    string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Channel == "" || req.Code == "" {
		web.Fail(w, r, "INVALID_PARAM", "channel and code are required", http.StatusBadRequest)
		return
	}

	if !openclaw.IsOpenClawInstalled() {
		web.Fail(w, r, "OPENCLAW_NOT_INSTALLED", "OpenClaw is not installed", http.StatusServiceUnavailable)
		return
	}

	output, err := openclaw.PairingApprove(req.Channel, req.Code)
	if err != nil {
		web.Fail(w, r, "PAIRING_APPROVE_FAILED", err.Error(), http.StatusBadRequest)
		return
	}

	web.OK(w, r, map[string]string{
		"message": output,
		"status":  "approved",
	})
}
