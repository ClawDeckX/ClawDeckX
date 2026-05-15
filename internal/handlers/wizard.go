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
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// probeHTTPClient is a dedicated HTTP client for model/channel probe requests
// with a hard timeout to prevent hanging when DNS/TLS stalls.
var probeHTTPClient = &http.Client{
	Timeout: 20 * time.Second,
}

// WizardHandler handles model/channel config wizard APIs.
type WizardHandler struct {
	auditRepo *database.AuditLogRepo
	gwClient  *openclaw.GWClient
}

func NewWizardHandler() *WizardHandler {
	return &WizardHandler{
		auditRepo: database.NewAuditLogRepo(),
	}
}

// SetGWClient injects the Gateway WebSocket client.
func (h *WizardHandler) SetGWClient(client *openclaw.GWClient) {
	h.gwClient = client
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

// ProbeError wraps an upstream error with its HTTP status code so that the
// TestModel handler can forward it to the frontend instead of returning a
// blanket 502.
type ProbeError struct {
	UpstreamStatus int
	Msg            string
}

func (e *ProbeError) Error() string { return e.Msg }

// TestModel tests model connection.
// POST /api/v1/setup/test-model
func (h *WizardHandler) TestModel(w http.ResponseWriter, r *http.Request) {
	var req TestModelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	req.Provider = strings.TrimSpace(req.Provider)
	req.APIKey = strings.TrimSpace(req.APIKey)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	req.Model = strings.TrimSpace(req.Model)
	req.APIType = strings.TrimSpace(req.APIType)

	if req.Provider == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if resolvedFromRef := strings.TrimSpace(h.resolveAPIKeyReference(req.APIKey)); resolvedFromRef != req.APIKey {
		req.APIKey = resolvedFromRef
	}

	// For existing provider configs, apiKey may arrive as a redacted placeholder
	// or be empty (frontend hides stored secrets). Resolve the real key via
	// gateway config.get or local config.
	if req.Provider != "ollama" && (req.APIKey == "" || isRedactedAPIKey(req.APIKey)) {
		if realKey := h.resolveProviderAPIKeyViaGW(req.Provider); realKey != "" {
			req.APIKey = strings.TrimSpace(h.resolveAPIKeyReference(realKey))
		} else if localKey := h.resolveProviderAPIKeyViaLocalConfig(req.Provider); localKey != "" {
			req.APIKey = localKey
		} else if fallbackKey := h.resolveProviderAPIKeyViaEnv(req.Provider); fallbackKey != "" {
			req.APIKey = fallbackKey
		}
	}

	// If apiKey is still redacted or empty for a non-local provider, fall back
	// to verifying provider connectivity through the gateway's models.list RPC.
	if req.Provider != "ollama" && (req.APIKey == "" || isRedactedAPIKey(req.APIKey)) {
		if ok, msg := h.testProviderViaGW(req.Provider, req.Model); ok {
			web.OK(w, r, map[string]interface{}{
				"status":  "ok",
				"message": msg,
			})
			return
		}
		web.Fail(w, r, "MODEL_NO_API_KEY", "Please enter an API Key and try again.", http.StatusBadRequest)
		return
	}

	// non-local providers require an API key
	if req.Provider != "ollama" && req.APIKey == "" {
		web.Fail(w, r, "MODEL_NO_API_KEY", "Please enter an API Key and try again.", http.StatusBadRequest)
		return
	}

	if req.Model == "" {
		web.Fail(w, r, "MODEL_NO_MODEL", "Model ID is required", http.StatusBadRequest)
		return
	}

	result, err := h.probeModel(req)
	if err != nil {
		if pe, ok := err.(*ProbeError); ok {
			// For upstream instability (5xx/timeout), run a lightweight auth probe.
			if pe.UpstreamStatus >= 500 {
				if _, authErr := h.probeProviderAuth(req); authErr == nil {
					web.OK(w, r, map[string]interface{}{
						"status": "warning",
						"message": i18n.T(i18n.MsgModelTestWarningAuthOK, map[string]interface{}{
							"Reason": i18n.T(i18n.MsgModelTestUnstable, nil),
						}),
					})
					return
				}
			}

			web.Fail(w, r, "GW_MODEL_TEST_FAILED", modelTestFriendlyMessage(pe.UpstreamStatus, req.Model), http.StatusUnprocessableEntity)
			return
		}

		web.Fail(w, r, "GW_MODEL_TEST_FAILED", i18n.T(i18n.MsgModelTestUnstable, nil), http.StatusUnprocessableEntity)
		return
	}

	web.OK(w, r, result)
}

// SmartTestResult is the detailed result of a smart provider test.
type SmartTestResult struct {
	Status       string `json:"status"` // "ok", "warning", "fail"
	Message      string `json:"message"`
	LatencyMs    int64  `json:"latencyMs"`
	Model        string `json:"model"`
	APIType      string `json:"apiType"`
	AutoDetected bool   `json:"autoDetected"` // true if apiType was switched from original
	Error        string `json:"error,omitempty"`
}

// alternativeAPITypes returns API types to try (in order) when the configured type fails.
var alternativeAPITypes = []string{
	"openai-completions",
	"anthropic-messages",
	"google-generative-ai",
}

// TestProviderSmart tests a configured provider with smart API type auto-detection.
// POST /api/v1/setup/test-provider-smart
func (h *WizardHandler) TestProviderSmart(w http.ResponseWriter, r *http.Request) {
	var req TestModelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	req.Provider = strings.TrimSpace(req.Provider)
	req.APIKey = strings.TrimSpace(req.APIKey)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	req.Model = strings.TrimSpace(req.Model)
	req.APIType = strings.TrimSpace(req.APIType)

	if req.Provider == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if resolvedFromRef := strings.TrimSpace(h.resolveAPIKeyReference(req.APIKey)); resolvedFromRef != req.APIKey {
		req.APIKey = resolvedFromRef
	}

	if req.Provider != "ollama" && (req.APIKey == "" || isRedactedAPIKey(req.APIKey)) {
		if realKey := h.resolveProviderAPIKeyViaGW(req.Provider); realKey != "" {
			req.APIKey = strings.TrimSpace(h.resolveAPIKeyReference(realKey))
		} else if localKey := h.resolveProviderAPIKeyViaLocalConfig(req.Provider); localKey != "" {
			req.APIKey = localKey
		} else if fallbackKey := h.resolveProviderAPIKeyViaEnv(req.Provider); fallbackKey != "" {
			req.APIKey = fallbackKey
		}
	}

	// If apiKey is still redacted or empty for a non-local provider, fall back
	// to verifying provider connectivity through the gateway's models.list RPC.
	if req.Provider != "ollama" && (req.APIKey == "" || isRedactedAPIKey(req.APIKey)) {
		if ok, msg := h.testProviderViaGW(req.Provider, req.Model); ok {
			web.OK(w, r, SmartTestResult{
				Status:  "ok",
				Message: msg,
				Model:   req.Model,
				APIType: req.APIType,
			})
			return
		}
		web.Fail(w, r, "MODEL_NO_API_KEY", "Please enter an API Key and try again.", http.StatusBadRequest)
		return
	}

	if req.Provider != "ollama" && req.APIKey == "" {
		web.Fail(w, r, "MODEL_NO_API_KEY", "Please enter an API Key and try again.", http.StatusBadRequest)
		return
	}

	if req.Model == "" {
		web.Fail(w, r, "MODEL_NO_MODEL", "Model ID is required", http.StatusBadRequest)
		return
	}

	originalAPIType := req.APIType
	if originalAPIType == "" {
		originalAPIType = "openai-completions"
	}

	// Try configured API type first
	result, err := h.probeModel(req)
	if err == nil {
		latency, _ := result["latencyMs"].(int64)
		web.OK(w, r, SmartTestResult{
			Status:       "ok",
			Message:      "Connection test passed",
			LatencyMs:    latency,
			Model:        req.Model,
			APIType:      originalAPIType,
			AutoDetected: false,
		})
		return
	}

	// If auth failure, don't retry with other types — the key is wrong
	if pe, ok := err.(*ProbeError); ok {
		if pe.UpstreamStatus == 401 || pe.UpstreamStatus == 403 {
			web.OK(w, r, SmartTestResult{
				Status:  "fail",
				Message: modelTestFriendlyMessage(pe.UpstreamStatus, req.Model),
				Model:   req.Model,
				APIType: originalAPIType,
				Error:   pe.Msg,
			})
			return
		}
	}

	// Try alternative API types
	for _, altType := range alternativeAPITypes {
		if strings.EqualFold(altType, originalAPIType) {
			continue
		}
		altReq := req
		altReq.APIType = altType
		altResult, altErr := h.probeModel(altReq)
		if altErr == nil {
			latency, _ := altResult["latencyMs"].(int64)
			web.OK(w, r, SmartTestResult{
				Status:       "ok",
				Message:      fmt.Sprintf("Connected (auto-detected: %s)", altType),
				LatencyMs:    latency,
				Model:        req.Model,
				APIType:      altType,
				AutoDetected: true,
			})
			return
		}
	}

	// All attempts failed — return original error
	errMsg := "Connection test failed"
	if pe, ok := err.(*ProbeError); ok {
		errMsg = modelTestFriendlyMessage(pe.UpstreamStatus, req.Model)
	}
	web.OK(w, r, SmartTestResult{
		Status:  "fail",
		Message: errMsg,
		Model:   req.Model,
		APIType: originalAPIType,
		Error:   err.Error(),
	})
}

func modelTestFriendlyMessage(status int, modelID string) string {
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return i18n.T(i18n.MsgModelAuthFailed, nil)
	case http.StatusNotFound:
		return i18n.T(i18n.MsgModelNotFound, map[string]interface{}{"ModelID": modelID})
	case http.StatusTooManyRequests:
		return i18n.T(i18n.MsgModelRateLimited, nil)
	default:
		if status >= 500 {
			return i18n.T(i18n.MsgModelTestUnstable, nil)
		}
		return i18n.T(i18n.MsgModelTestFailed, map[string]interface{}{
			"Error": i18n.T(i18n.MsgModelTestUnstable, nil),
		})
	}
}

// DiscoverModels discovers model IDs from provider endpoints.
// POST /api/v1/setup/discover-models
func (h *WizardHandler) DiscoverModels(w http.ResponseWriter, r *http.Request) {
	var req DiscoverModelsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	req.Provider = strings.TrimSpace(req.Provider)
	req.APIKey = strings.TrimSpace(req.APIKey)
	req.BaseURL = strings.TrimSpace(req.BaseURL)
	req.APIType = strings.TrimSpace(req.APIType)

	if req.Provider == "" {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if resolvedFromRef := strings.TrimSpace(h.resolveAPIKeyReference(req.APIKey)); resolvedFromRef != req.APIKey {
		req.APIKey = resolvedFromRef
	}

	// For existing provider configs, apiKey may arrive as a redacted placeholder
	// or be empty (frontend hides stored secrets). Resolve the real key via
	// gateway config.get or local config.
	if req.Provider != "ollama" && (req.APIKey == "" || isRedactedAPIKey(req.APIKey)) {
		if realKey := h.resolveProviderAPIKeyViaGW(req.Provider); realKey != "" {
			req.APIKey = strings.TrimSpace(h.resolveAPIKeyReference(realKey))
		} else if localKey := h.resolveProviderAPIKeyViaLocalConfig(req.Provider); localKey != "" {
			req.APIKey = localKey
		} else if fallbackKey := h.resolveProviderAPIKeyViaEnv(req.Provider); fallbackKey != "" {
			req.APIKey = fallbackKey
		}
	}

	// If apiKey is still redacted or empty for a non-local provider, fall back
	// to discovering models through the gateway's models.list RPC. The gateway
	// holds the real credentials and can query provider catalogs directly.
	if req.Provider != "ollama" && (req.APIKey == "" || isRedactedAPIKey(req.APIKey)) {
		if models, err := h.discoverModelsViaGW(req.Provider); err == nil && len(models) > 0 {
			web.OK(w, r, map[string]interface{}{
				"models": models,
				"count":  len(models),
				"source": "gateway",
			})
			return
		}
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
	endpointDebug := safeEndpointForDebug(endpoint)

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
	resp, err := probeHTTPClient.Do(httpReq)
	latencyMs := time.Since(start).Milliseconds()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, &ProbeError{504, fmt.Sprintf("upstream timeout at %s (HTTP %d)", endpointDebug, 504)}
		}
		if ne, ok := err.(interface{ Timeout() bool }); ok && ne.Timeout() {
			return nil, &ProbeError{504, fmt.Sprintf("upstream timeout at %s (HTTP %d)", endpointDebug, 504)}
		}
		return nil, &ProbeError{502, fmt.Sprintf("upstream transport error at %s (HTTP %d): %v", endpointDebug, 502, err)}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))

	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return nil, &ProbeError{resp.StatusCode, fmt.Sprintf("authentication failed at %s (HTTP %d): invalid API key", endpointDebug, resp.StatusCode)}
	}
	if resp.StatusCode == 404 {
		return nil, &ProbeError{resp.StatusCode, fmt.Sprintf("model not found at %s (HTTP %d): check model ID", endpointDebug, resp.StatusCode)}
	}
	if resp.StatusCode == 429 {
		return nil, &ProbeError{resp.StatusCode, fmt.Sprintf("rate limited at %s (HTTP %d): too many requests or billing issue", endpointDebug, resp.StatusCode)}
	}
	if resp.StatusCode >= 500 {
		detail := extractErrorDetail(respBody)
		return nil, &ProbeError{resp.StatusCode, fmt.Sprintf("upstream service unavailable at %s (HTTP %d): %s", endpointDebug, resp.StatusCode, detail)}
	}
	if resp.StatusCode >= 400 {
		detail := extractErrorDetail(respBody)
		return nil, &ProbeError{resp.StatusCode, fmt.Sprintf("API error at %s (HTTP %d): %s", endpointDebug, resp.StatusCode, detail)}
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

	resp, err := probeHTTPClient.Do(req)
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

// probeProviderAuth runs a lightweight auth-only probe (usually model list) to
// distinguish key/auth issues from completion-path instability.
func (h *WizardHandler) probeProviderAuth(req TestModelRequest) (string, error) {
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	apiType := strings.ToLower(strings.TrimSpace(req.APIType))
	baseURL := strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
	apiKey := strings.TrimSpace(req.APIKey)

	headers := map[string]string{}
	endpoint := ""

	switch {
	case provider == "anthropic" || apiType == "anthropic-messages":
		if baseURL == "" {
			baseURL = "https://api.anthropic.com"
		}
		endpoint = baseURL + "/v1/models"
		if apiKey != "" {
			headers["x-api-key"] = apiKey
			headers["anthropic-version"] = "2023-06-01"
		}
	case provider == "google" || provider == "gemini" || apiType == "google-generative-ai":
		if baseURL == "" {
			baseURL = "https://generativelanguage.googleapis.com/v1beta"
		}
		q := url.Values{}
		q.Set("key", apiKey)
		endpoint = baseURL + "/models?" + q.Encode()
	default:
		if baseURL == "" {
			baseURL = "https://api.openai.com/v1"
		}
		endpoint = baseURL + "/models"
		if apiKey != "" {
			headers["Authorization"] = "Bearer " + apiKey
		}
	}

	if _, err := doJSONRequest("GET", endpoint, headers, nil); err != nil {
		return "", err
	}
	return "ok(" + safeEndpointForDebug(endpoint) + ")", nil
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

func isRedactedAPIKey(v string) bool {
	s := strings.TrimSpace(v)
	if s == "" {
		return false
	}
	if s == "***REDACTED***" {
		return true
	}
	if strings.Contains(strings.ToLower(s), "redacted") {
		return true
	}
	r := []rune(s)
	if len(r) > 0 {
		allMaskDots := true
		for _, ch := range r {
			if ch != '●' && ch != '•' && ch != '*' {
				allMaskDots = false
				break
			}
		}
		if allMaskDots {
			return true
		}
	}
	return false
}

func describeAPIKeyState(v string) string {
	s := strings.TrimSpace(v)
	if s == "" {
		return "empty"
	}
	if isRedactedAPIKey(s) {
		return "redacted"
	}
	if (strings.HasPrefix(s, "${") && strings.HasSuffix(s, "}")) || (strings.HasPrefix(s, "$") && len(s) > 1) {
		return "env-ref"
	}
	runes := []rune(s)
	n := len(runes)
	if n <= 8 {
		return fmt.Sprintf("raw(len=%d)", n)
	}
	head := string(runes[:4])
	tail := string(runes[n-4:])
	return fmt.Sprintf("raw(len=%d,%s...%s)", n, head, tail)
}

// resolveAPIKeyReference resolves env-style API key placeholders like
// ${OPENAI_API_KEY} or $OPENAI_API_KEY using process env and ~/.openclaw env files.
func (h *WizardHandler) resolveAPIKeyReference(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}

	envName := ""
	if strings.HasPrefix(s, "${") && strings.HasSuffix(s, "}") {
		envName = strings.TrimSpace(s[2 : len(s)-1])
	} else if strings.HasPrefix(s, "$") && len(s) > 1 {
		envName = strings.TrimSpace(s[1:])
	}

	if envName == "" {
		return s
	}

	if v := strings.TrimSpace(os.Getenv(envName)); v != "" {
		return v
	}
	if v := h.lookupEnvVarFromFiles(envName); v != "" {
		return v
	}
	return ""
}

func (h *WizardHandler) lookupEnvVarFromFiles(key string) string {
	stateDir := openclaw.ResolveStateDir()
	if stateDir == "" {
		return ""
	}
	paths := []string{
		filepath.Join(stateDir, ".env"),
		filepath.Join(stateDir, "env"),
	}
	for _, p := range paths {
		if v := readEnvFileValue(p, key); v != "" {
			return v
		}
	}
	return ""
}

func readEnvFileValue(path, key string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	prefix := key + "="
	for _, line := range splitLines(string(data)) {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(line, prefix))
		value = strings.Trim(value, "\"")
		value = strings.Trim(value, "'")
		return value
	}
	return ""
}

// resolveProviderAPIKeyViaGW fetches the real API key from a remote gateway
// via the config.get RPC call. This covers the case where
// ClawDeckX is connected to a remote gateway and the local config file does
// not contain the provider credentials.
func (h *WizardHandler) resolveProviderAPIKeyViaGW(provider string) string {
	if h.gwClient == nil {
		return ""
	}
	// Request config to get real API keys
	raw, err := h.gwClient.Request("config.get", nil)
	if err != nil {
		return ""
	}
	var wrapper map[string]interface{}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return ""
	}

	cfg := wrapper
	if parsed, ok := wrapper["parsed"].(map[string]interface{}); ok {
		cfg = parsed
	} else if conf, ok := wrapper["config"].(map[string]interface{}); ok {
		cfg = conf
	}

	models, _ := cfg["models"].(map[string]interface{})
	if models == nil {
		return ""
	}
	providers, _ := models["providers"].(map[string]interface{})
	if providers == nil {
		return ""
	}
	providerCfg, _ := providers[provider].(map[string]interface{})
	if providerCfg == nil {
		target := strings.ToLower(provider)
		for k, v := range providers {
			if strings.ToLower(k) == target {
				providerCfg, _ = v.(map[string]interface{})
				break
			}
		}
	}
	if providerCfg == nil {
		return ""
	}
	key, _ := providerCfg["apiKey"].(string)
	key = strings.TrimSpace(key)
	if isRedactedAPIKey(key) {
		return ""
	}
	return h.resolveAPIKeyReference(key)
}

func (h *WizardHandler) resolveProviderAPIKeyViaEnv(provider string) string {
	envKey := providerEnvKey(provider)
	if envKey == "" {
		return ""
	}
	if v := strings.TrimSpace(os.Getenv(envKey)); v != "" {
		return v
	}
	return h.lookupEnvVarFromFiles(envKey)
}

func (h *WizardHandler) resolveProviderAPIKeyViaLocalConfig(provider string) string {
	cfgPath := openclaw.ResolveConfigPath()
	if cfgPath == "" {
		return ""
	}
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return ""
	}

	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return ""
	}

	models, _ := cfg["models"].(map[string]interface{})
	if models == nil {
		return ""
	}
	providers, _ := models["providers"].(map[string]interface{})
	if providers == nil {
		return ""
	}

	providerCfg, _ := providers[provider].(map[string]interface{})
	if providerCfg == nil {
		target := strings.ToLower(strings.TrimSpace(provider))
		for k, v := range providers {
			if strings.ToLower(strings.TrimSpace(k)) == target {
				providerCfg, _ = v.(map[string]interface{})
				break
			}
		}
	}
	if providerCfg == nil {
		return ""
	}

	key, _ := providerCfg["apiKey"].(string)
	key = strings.TrimSpace(key)
	if key == "" || isRedactedAPIKey(key) {
		return ""
	}
	return h.resolveAPIKeyReference(key)
}

// hasRedactedTokens returns true if any token value in the map is a redacted
// placeholder from config.get.
func hasRedactedTokens(tokens map[string]string) bool {
	for _, v := range tokens {
		if isRedactedAPIKey(v) {
			return true
		}
	}
	return false
}

// testChannelViaGW tests a channel connection through the gateway's
// channels.status RPC with probe=true. The gateway uses the real (unredacted)
// credentials from its on-disk config, so this works even when ClawDeckX
// cannot resolve the tokens locally (e.g. remote gateway).
func (h *WizardHandler) testChannelViaGW(channel string) (bool, map[string]interface{}) {
	if h.gwClient == nil || !h.gwClient.IsConnected() {
		return false, nil
	}
	raw, err := h.gwClient.RequestWithTimeout("channels.status", map[string]interface{}{
		"channel": channel,
		"probe":   true,
	}, 25*time.Second)
	if err != nil {
		logger.Doctor.Warn().Err(err).Str("channel", channel).Msg("testChannelViaGW: channels.status RPC failed")
		return false, nil
	}

	var resp struct {
		Channels map[string]interface{} `json:"channels"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return false, nil
	}

	chData, ok := resp.Channels[channel]
	if !ok {
		return false, nil
	}
	chMap, ok := chData.(map[string]interface{})
	if !ok {
		return false, nil
	}

	// Check if any account has a successful probe
	accounts, _ := chMap["accounts"].(map[string]interface{})
	if accounts == nil {
		// Try root-level status fields
		if lastErr, _ := chMap["lastError"].(string); lastErr != "" {
			return true, map[string]interface{}{
				"status":  "fail",
				"message": fmt.Sprintf("Channel %s probe failed via gateway: %s", channel, lastErr),
			}
		}
		return true, map[string]interface{}{
			"status":  "ok",
			"message": fmt.Sprintf("Channel %s is configured on the gateway", channel),
		}
	}

	for acctID, acctData := range accounts {
		acctMap, ok := acctData.(map[string]interface{})
		if !ok {
			continue
		}
		if lastErr, _ := acctMap["lastError"].(string); lastErr != "" {
			return true, map[string]interface{}{
				"status":  "fail",
				"message": fmt.Sprintf("Channel %s/%s probe failed: %s", channel, acctID, lastErr),
			}
		}
		// No error means probe passed
		return true, map[string]interface{}{
			"status":  "ok",
			"message": fmt.Sprintf("Channel %s is reachable via gateway (account: %s)", channel, acctID),
		}
	}

	return true, map[string]interface{}{
		"status":  "ok",
		"message": fmt.Sprintf("Channel %s is configured on the gateway", channel),
	}
}

// discoverModelsViaGW discovers available models for a provider by querying
// the gateway's models.list RPC with view=all. The gateway uses the real
// (unredacted) API keys from its on-disk config, so this works even when
// ClawDeckX cannot resolve the key locally (e.g. remote gateway).
func (h *WizardHandler) discoverModelsViaGW(provider string) ([]DiscoveredModel, error) {
	if h.gwClient == nil || !h.gwClient.IsConnected() {
		return nil, fmt.Errorf("gateway not connected")
	}
	raw, err := h.gwClient.RequestWithTimeout("models.list", map[string]interface{}{
		"view": "all",
	}, 25*time.Second)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Models []struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Provider string `json:"provider"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, err
	}
	target := strings.ToLower(strings.TrimSpace(provider))
	var out []DiscoveredModel
	for _, m := range resp.Models {
		mp := strings.ToLower(strings.TrimSpace(m.Provider))
		if mp == target {
			id := strings.TrimSpace(m.ID)
			if id == "" {
				continue
			}
			// Strip "provider/" prefix if present since config uses bare model IDs.
			if strings.HasPrefix(id, provider+"/") {
				id = id[len(provider)+1:]
			}
			name := strings.TrimSpace(m.Name)
			out = append(out, DiscoveredModel{ID: id, Name: name})
		}
	}
	return dedupeModels(out), nil
}

// testProviderViaGW verifies that a provider is reachable by checking whether
// the gateway's models.list RPC returns models for that provider. If the
// optional targetModel is non-empty, it also checks whether that specific model
// is in the catalog.
func (h *WizardHandler) testProviderViaGW(provider string, targetModel string) (bool, string) {
	models, err := h.discoverModelsViaGW(provider)
	if err != nil {
		logger.Doctor.Warn().Err(err).Str("provider", provider).Msg("testProviderViaGW: models.list RPC failed")
		return false, ""
	}
	if len(models) == 0 {
		return false, ""
	}
	if targetModel != "" {
		target := strings.ToLower(strings.TrimSpace(targetModel))
		for _, m := range models {
			if strings.ToLower(strings.TrimSpace(m.ID)) == target {
				return true, fmt.Sprintf("Provider %s is reachable via gateway (model %s confirmed, %d models available)", provider, targetModel, len(models))
			}
		}
		// Model not found but provider has other models — still a pass
		return true, fmt.Sprintf("Provider %s is reachable via gateway (%d models available, model %s not in catalog)", provider, len(models), targetModel)
	}
	return true, fmt.Sprintf("Provider %s is reachable via gateway (%d models available)", provider, len(models))
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

func safeEndpointForDebug(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	q := u.Query()
	for _, k := range []string{"key", "api_key", "token", "access_token"} {
		if q.Has(k) {
			q.Set(k, "***")
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
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
			{"id": req.Model, "name": req.Model, "input": []string{"text", "image"}},
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

	// If any token value is redacted (loaded from config.get which always
	// redacts secrets), fall back to the gateway's channels.status RPC with
	// probe=true. The gateway holds the real credentials.
	if hasRedactedTokens(req.Tokens) {
		if ok, result := h.testChannelViaGW(req.Channel); ok {
			web.OK(w, r, result)
			return
		}
		// Gateway probe failed or unavailable — continue with validation
		// which will likely fail on the redacted values.
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
	case "yuanbao":
		result, err := h.testYuanbaoChannel(req)
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
	case "wecom":
		// Long connection mode: botId + botSecret
		// Webhook mode: corpId + secret + token + encodingAESKey
		if tokens["botId"] == "" && tokens["corpId"] == "" {
			return fmt.Errorf("WeCom Bot ID (long connection) or Corp ID (webhook) is required")
		}
		if tokens["botId"] != "" && tokens["botSecret"] == "" {
			return fmt.Errorf("WeCom Bot Secret is required when using Bot ID")
		}
		if tokens["corpId"] != "" && tokens["secret"] == "" {
			return fmt.Errorf("WeCom Secret is required when using Corp ID")
		}
	case "wecom_kf":
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
	case "qqbot", "qq":
		if tokens["appId"] == "" {
			return fmt.Errorf("QQ App ID is required")
		}
		if tokens["appSecret"] == "" {
			return fmt.Errorf("QQ App Secret is required")
		}
	case "yuanbao":
		if tokens["appKey"] == "" {
			return fmt.Errorf("Yuanbao App Key is required")
		}
		if tokens["appSecret"] == "" {
			return fmt.Errorf("Yuanbao App Secret is required")
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

	resp, err := probeHTTPClient.Do(req)
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

	resp, err := probeHTTPClient.Do(req)
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

func (h *WizardHandler) testYuanbaoChannel(req TestChannelRequest) (map[string]interface{}, error) {
	validationConfig := h.buildYuanbaoValidationConfig(req)
	if openclaw.IsOpenClawInstalled() {
		validateRes, err := openclaw.ConfigValidate(validationConfig)
		if err != nil {
			return nil, fmt.Errorf("yuanbao config validation failed: %v", err)
		}
		if validateRes != nil && !validateRes.OK {
			msg := validateRes.Summary
			if len(validateRes.Issues) > 0 {
				msg = validateRes.Issues[0].Message
			}
			return nil, fmt.Errorf("yuanbao config validation failed: %s", msg)
		}

		probeRes, err := h.testChannelViaCLI(req)
		if err != nil {
			return nil, fmt.Errorf("yuanbao probe failed: %v", err)
		}
		return map[string]interface{}{
			"status":  "ok",
			"message": "yuanbao config validation passed and channel probe completed",
			"output":  probeRes["output"],
		}, nil
	}

	return map[string]interface{}{
		"status":  "ok",
		"message": "yuanbao token format valid (OpenClaw CLI not available for deeper validation)",
	}, nil
}

func (h *WizardHandler) buildYuanbaoValidationConfig(req TestChannelRequest) map[string]interface{} {
	config := map[string]interface{}{}

	if h.gwClient != nil {
		if raw, err := h.gwClient.Request("config.get", nil); err == nil {
			var doc map[string]interface{}
			if err := json.Unmarshal(raw, &doc); err == nil {
				if cfg, ok := doc["config"].(map[string]interface{}); ok {
					config = cfg
				} else {
					config = doc
				}
			}
		}
	}

	channels, _ := config["channels"].(map[string]interface{})
	if channels == nil {
		channels = map[string]interface{}{}
	}
	channels["yuanbao"] = map[string]interface{}{
		"enabled":   true,
		"appKey":    req.Tokens["appKey"],
		"appSecret": req.Tokens["appSecret"],
	}
	config["channels"] = channels

	return config
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

	case "yuanbao":
		ch["appKey"] = req.Tokens["appKey"]
		ch["appSecret"] = req.Tokens["appSecret"]
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

// mergeConfig merges config into openclaw.json via openclaw CLI only.
func (h *WizardHandler) mergeConfig(config map[string]interface{}) error {
	if !openclaw.IsOpenClawInstalled() {
		return fmt.Errorf("openclaw CLI is required for config updates")
	}

	if err := openclaw.ConfigApplyFull(config); err != nil {
		logger.Config.Error().Err(err).Msg("openclaw config set failed")
		return fmt.Errorf("config update failed: %w", err)
	}

	return nil
}

// writeEnvKey writes an API key to <stateDir>/.env.
func (h *WizardHandler) writeEnvKey(key, value string) {
	stateDir := openclaw.ResolveStateDir()
	if stateDir == "" {
		return
	}
	envPath := filepath.Join(stateDir, ".env")

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

// providerEnvKey returns the env var name for a provider.
func providerEnvKey(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
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
	case "nvidia", "nim":
		return "NVIDIA_API_KEY"
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
