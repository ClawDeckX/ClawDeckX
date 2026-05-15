package translate

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
	"sync"
	"time"

	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/openclaw"
)

// LLMConfig holds the configuration for using an LLM model as the translation engine.
type LLMConfig struct {
	BaseURL  string // e.g. "https://api.openai.com/v1"
	APIKey   string
	Model    string // e.g. "gpt-4o-mini"
	APIType  string // "openai-completions", "anthropic-messages", "google-generative-ai"
	Provider string // provider id for logging
}

// ConfigResolver is a callback that resolves provider configuration from an
// external source (e.g. remote gateway via GWClient). Returns the raw providers
// map from the openclaw config, or nil if unavailable.
type ConfigResolver func() map[string]interface{}

// ModelPreference is a callback that returns the user's preferred translation
// model in "provider/model" format (e.g. "deepseek/deepseek-chat"), or "" if
// no preference is set.
type ModelPreference func() string

// Translator provides text translation with multi-engine fallback:
// Free APIs first (Lingva → DeepLX → LibreTranslate → MyMemory → Google) → LLM (last resort).
type Translator struct {
	client              *http.Client
	mu                  sync.Mutex
	lastReq             time.Time
	minGap              time.Duration
	sem                 chan struct{}          // concurrency limiter
	llmConfig           *LLMConfig             // active LLM engine config (highest priority)
	llmAutoConfig       *LLMConfig             // auto-resolved config (cached)
	providersResolved   bool                   // whether providers have been successfully resolved
	providersResolvedAt time.Time              // when providers were last resolved
	allProviders        map[string]interface{} // cached provider configs
	lastPref            string                 // last seen model preference (change detection)
	configResolver      ConfigResolver         // optional: resolve providers from remote gateway
	modelPreference     ModelPreference        // optional: user's preferred model from settings
}

// New creates a Translator with sensible defaults.
// Limits concurrent translations to 2 and enforces 1.5s gap between requests.
// LLM config is auto-resolved from user's openclaw.json on first use.
func New() *Translator {
	return &Translator{
		client: &http.Client{Timeout: 20 * time.Second},
		minGap: 1500 * time.Millisecond, // 1.5s gap to protect API limits
		sem:    make(chan struct{}, 2),  // max 2 concurrent translations
	}
}

// SetLLMConfig explicitly sets the LLM translation engine config.
func (t *Translator) SetLLMConfig(cfg *LLMConfig) {
	t.llmConfig = cfg
}

// SetConfigResolver sets a callback to resolve provider configuration from
// an external source (e.g. remote gateway). This is called before falling
// back to local config file.
func (t *Translator) SetConfigResolver(resolver ConfigResolver) {
	t.configResolver = resolver
}

// SetModelPreference sets a callback that returns the user's preferred
// translation model in "provider/model" format from the settings DB.
func (t *Translator) SetModelPreference(pref ModelPreference) {
	t.modelPreference = pref
}

// resolveLLMConfig resolves the active LLM config.
// Provider configs are cached and re-resolved when stale or previously failed.
// User model preference is checked every call so that settings changes take
// effect immediately.
func (t *Translator) resolveLLMConfig() {
	// Step 1: resolve provider configs (retry if previously failed, refresh periodically)
	needResolve := false
	if !t.providersResolved {
		// Never resolved successfully, or first attempt returned nil — retry
		needResolve = true
	} else if time.Since(t.providersResolvedAt) > 5*time.Minute {
		// Refresh periodically so config changes (new providers, keys) are picked up
		needResolve = true
	}

	if needResolve {
		var providers map[string]interface{}
		if t.configResolver != nil {
			providers = t.configResolver()
		}
		if providers == nil {
			providers = loadLocalProviders()
		}
		if providers != nil {
			t.allProviders = providers
			t.llmAutoConfig = pickLLMFromProviders(providers, "auto")
			t.providersResolved = true
			t.providersResolvedAt = time.Now()
			// Reset lastPref to force re-evaluation with new providers
			t.lastPref = "\x00"
		}
	}

	if t.allProviders == nil {
		return
	}

	// Step 2: check user preference (dynamic, every call)
	if t.modelPreference != nil {
		pref := t.modelPreference()
		if pref != t.lastPref {
			// Preference changed — re-resolve
			t.lastPref = pref
			if pref != "" {
				if cfg := resolvePreferredModel(pref, t.allProviders); cfg != nil {
					logger.Log.Info().Str("provider", cfg.Provider).Str("model", cfg.Model).Msg("using user-preferred translation model")
					t.llmConfig = cfg
					return
				}
				logger.Log.Debug().Str("preference", pref).Msg("preferred translation model not available, falling back to auto")
			}
			// No preference or failed — use auto
			t.llmConfig = t.llmAutoConfig
		}
		return
	}

	// No preference callback — use auto config
	if t.llmConfig == nil {
		t.llmConfig = t.llmAutoConfig
	}
}

// pickLLMFromProviders selects the best LLM provider from a providers map.
func pickLLMFromProviders(providers map[string]interface{}, source string) *LLMConfig {
	preferred := []string{"deepseek", "openai", "openrouter", "moonshot", "anthropic", "google", "gemini"}
	tried := map[string]bool{}
	for _, pid := range preferred {
		tried[pid] = true
		if c := extractProviderConfig(pid, providers); c != nil {
			logger.Log.Info().Str("provider", c.Provider).Str("model", c.Model).Str("source", source).Msg("auto-resolved LLM translation engine")
			return c
		}
	}
	for pid := range providers {
		if tried[pid] || pid == "ollama" {
			continue
		}
		if c := extractProviderConfig(pid, providers); c != nil {
			logger.Log.Info().Str("provider", c.Provider).Str("model", c.Model).Str("source", source).Msg("auto-resolved LLM translation engine")
			return c
		}
	}
	return nil
}

// resolvePreferredModel resolves a user preference like "deepseek/deepseek-chat"
// into an LLMConfig by looking up the provider in the available providers map.
func resolvePreferredModel(pref string, providers map[string]interface{}) *LLMConfig {
	parts := strings.SplitN(pref, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil
	}
	pid, modelID := parts[0], parts[1]

	pCfg, _ := providers[pid].(map[string]interface{})
	if pCfg == nil {
		// Try case-insensitive match
		target := strings.ToLower(pid)
		for k, v := range providers {
			if strings.ToLower(k) == target {
				pCfg, _ = v.(map[string]interface{})
				pid = k
				break
			}
		}
	}
	if pCfg == nil {
		return nil
	}

	apiKey, _ := pCfg["apiKey"].(string)
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" || isRedactedValue(apiKey) {
		return nil
	}
	// Resolve env var references
	if strings.HasPrefix(apiKey, "${") && strings.HasSuffix(apiKey, "}") {
		envName := strings.TrimSpace(apiKey[2 : len(apiKey)-1])
		if v := os.Getenv(envName); v != "" {
			apiKey = v
		} else if v := resolveEnvFromFile(envName); v != "" {
			apiKey = v
		} else {
			return nil
		}
	} else if strings.HasPrefix(apiKey, "$") {
		envName := strings.TrimSpace(apiKey[1:])
		if v := os.Getenv(envName); v != "" {
			apiKey = v
		} else if v := resolveEnvFromFile(envName); v != "" {
			apiKey = v
		} else {
			return nil
		}
	}

	baseURL, _ := pCfg["baseUrl"].(string)
	apiType, _ := pCfg["api"].(string)
	if apiType == "" {
		apiType = "openai-completions"
	}

	return &LLMConfig{
		BaseURL:  strings.TrimRight(baseURL, "/"),
		APIKey:   apiKey,
		Model:    modelID,
		APIType:  apiType,
		Provider: pid,
	}
}

// loadLocalProviders reads the providers map from openclaw.json.
func loadLocalProviders() map[string]interface{} {
	cfgPath := openclaw.ResolveConfigPath()
	if cfgPath == "" {
		return nil
	}
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		return nil
	}
	var cfg map[string]interface{}
	if json.Unmarshal(data, &cfg) != nil {
		return nil
	}
	models, _ := cfg["models"].(map[string]interface{})
	if models == nil {
		return nil
	}
	providers, _ := models["providers"].(map[string]interface{})
	return providers
}

// extractProviderConfig reads a provider's config from the providers map.
func extractProviderConfig(pid string, providers map[string]interface{}) *LLMConfig {
	pCfg, _ := providers[pid].(map[string]interface{})
	if pCfg == nil {
		return nil
	}
	apiKey, _ := pCfg["apiKey"].(string)
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" || isRedactedValue(apiKey) {
		return nil
	}
	// Resolve env var references like ${OPENAI_API_KEY}
	if strings.HasPrefix(apiKey, "${") && strings.HasSuffix(apiKey, "}") {
		envName := strings.TrimSpace(apiKey[2 : len(apiKey)-1])
		if v := os.Getenv(envName); v != "" {
			apiKey = v
		} else if v := resolveEnvFromFile(envName); v != "" {
			apiKey = v
		} else {
			return nil
		}
	} else if strings.HasPrefix(apiKey, "$") {
		envName := strings.TrimSpace(apiKey[1:])
		if v := os.Getenv(envName); v != "" {
			apiKey = v
		} else if v := resolveEnvFromFile(envName); v != "" {
			apiKey = v
		} else {
			return nil
		}
	}

	baseURL, _ := pCfg["baseUrl"].(string)
	apiType, _ := pCfg["api"].(string)
	if apiType == "" {
		apiType = "openai-completions"
	}

	// Pick a model: prefer the first configured model
	model := ""
	if modelsList, ok := pCfg["models"].([]interface{}); ok && len(modelsList) > 0 {
		if m, ok := modelsList[0].(map[string]interface{}); ok {
			model, _ = m["id"].(string)
		}
	}
	if model == "" {
		model = llmDefaultModel(pid)
	}
	if model == "" {
		return nil
	}

	return &LLMConfig{
		BaseURL:  strings.TrimRight(baseURL, "/"),
		APIKey:   apiKey,
		Model:    model,
		APIType:  apiType,
		Provider: pid,
	}
}

// isRedactedValue returns true if the value is a redacted placeholder from
// OpenClaw's config.get RPC (e.g. __OPENCLAW_REDACTED__, ***REDACTED***).
func isRedactedValue(v string) bool {
	s := strings.TrimSpace(v)
	if s == "" {
		return false
	}
	if s == "***REDACTED***" {
		return true
	}
	return strings.Contains(strings.ToLower(s), "redacted")
}

func resolveEnvFromFile(key string) string {
	stateDir := openclaw.ResolveStateDir()
	if stateDir == "" {
		return ""
	}
	for _, p := range []string{
		filepath.Join(stateDir, ".env"),
		filepath.Join(stateDir, "env"),
	} {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		prefix := key + "="
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			if strings.HasPrefix(line, "export ") {
				line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
			}
			if strings.HasPrefix(line, prefix) {
				v := strings.TrimSpace(strings.TrimPrefix(line, prefix))
				v = strings.Trim(v, "\"'")
				if v != "" {
					return v
				}
			}
		}
	}
	return ""
}

func llmDefaultModel(provider string) string {
	switch strings.ToLower(provider) {
	case "openai":
		return "gpt-4o-mini"
	case "deepseek":
		return "deepseek-chat"
	case "anthropic":
		return "claude-3-haiku-20240307"
	case "google", "gemini":
		return "gemini-2.0-flash"
	case "moonshot":
		return "moonshot-v1-8k"
	default:
		return ""
	}
}

// llmTranslate uses a user-configured LLM model to translate text.
func (t *Translator) llmTranslate(ctx context.Context, text, source, target string) (string, error) {
	cfg := t.llmConfig
	if cfg == nil {
		return "", fmt.Errorf("no LLM config")
	}

	langName := llmLangName(target)
	prompt := fmt.Sprintf("Translate the following text from %s to %s. Output ONLY the translated text, nothing else.\n\n%s", llmLangName(source), langName, text)

	apiType := strings.ToLower(cfg.APIType)
	switch {
	case apiType == "anthropic-messages" || cfg.Provider == "anthropic":
		return t.llmTranslateAnthropic(ctx, cfg, prompt)
	case apiType == "google-generative-ai" || cfg.Provider == "google" || cfg.Provider == "gemini":
		return t.llmTranslateGoogle(ctx, cfg, prompt)
	default:
		return t.llmTranslateOpenAI(ctx, cfg, prompt)
	}
}

func (t *Translator) llmTranslateOpenAI(ctx context.Context, cfg *LLMConfig, prompt string) (string, error) {
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	endpoint := baseURL + "/chat/completions"

	body, _ := json.Marshal(map[string]interface{}{
		"model":       cfg.Model,
		"max_tokens":  2048,
		"temperature": 0.1,
		"messages":    []map[string]string{{"role": "user", "content": prompt}},
	})

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build llm request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("llm http: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("llm status %d: %s", resp.StatusCode, truncate(string(respBody), 200))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse llm json: %w", err)
	}
	if len(result.Choices) == 0 || strings.TrimSpace(result.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("llm empty response")
	}
	return strings.TrimSpace(result.Choices[0].Message.Content), nil
}

func (t *Translator) llmTranslateAnthropic(ctx context.Context, cfg *LLMConfig, prompt string) (string, error) {
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}
	endpoint := baseURL + "/v1/messages"

	body, _ := json.Marshal(map[string]interface{}{
		"model":      cfg.Model,
		"max_tokens": 2048,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build anthropic request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("anthropic-version", "2023-06-01")
	if cfg.APIKey != "" {
		req.Header.Set("x-api-key", cfg.APIKey)
	}

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("anthropic http: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("anthropic status %d: %s", resp.StatusCode, truncate(string(respBody), 200))
	}

	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse anthropic json: %w", err)
	}
	if len(result.Content) == 0 || strings.TrimSpace(result.Content[0].Text) == "" {
		return "", fmt.Errorf("anthropic empty response")
	}
	return strings.TrimSpace(result.Content[0].Text), nil
}

func (t *Translator) llmTranslateGoogle(ctx context.Context, cfg *LLMConfig, prompt string) (string, error) {
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = "https://generativelanguage.googleapis.com/v1beta"
	}
	endpoint := baseURL + "/models/" + cfg.Model + ":generateContent?key=" + cfg.APIKey

	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": []map[string]string{{"text": prompt}}},
		},
		"generationConfig": map[string]interface{}{"maxOutputTokens": 2048, "temperature": 0.1},
	})

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build google request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("google llm http: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("google llm status %d: %s", resp.StatusCode, truncate(string(respBody), 200))
	}

	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse google llm json: %w", err)
	}
	if len(result.Candidates) == 0 || len(result.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("google llm empty response")
	}
	text := strings.TrimSpace(result.Candidates[0].Content.Parts[0].Text)
	if text == "" {
		return "", fmt.Errorf("google llm empty text")
	}
	return text, nil
}

func llmLangName(code string) string {
	names := map[string]string{
		"en": "English", "zh": "Simplified Chinese", "zh-CN": "Simplified Chinese",
		"zh-TW": "Traditional Chinese", "ja": "Japanese", "ko": "Korean",
		"fr": "French", "de": "German", "es": "Spanish", "pt": "Portuguese",
		"ru": "Russian", "ar": "Arabic", "it": "Italian", "nl": "Dutch",
		"pl": "Polish", "tr": "Turkish", "pt-BR": "Brazilian Portuguese",
	}
	if n, ok := names[code]; ok {
		return n
	}
	return code
}

// langMap maps our short language codes to MyMemory langpair codes.
var langMap = map[string]string{
	"zh": "zh-CN", "zh-CN": "zh-CN", "zh-TW": "zh-TW",
	"ja": "ja", "ko": "ko", "fr": "fr", "de": "de",
	"es": "es", "pt": "pt", "ru": "ru", "ar": "ar",
	"it": "it", "nl": "nl", "pl": "pl", "tr": "tr",
}

// lingvaInstances are public Lingva Translate instances (Google Translate proxy).
// Multiple instances for fallback; works in China and worldwide without API key.
var lingvaInstances = []string{
	"https://lingva.ml",
	"https://translate.plausibility.cloud",
	"https://lingva.lunar.icu",
}

// libreTranslateInstances are public LibreTranslate instances.
// Open-source, self-hostable; public instances have rate limits but are globally accessible.
var libreTranslateInstances = []string{
	"https://libretranslate.com",
	"https://translate.terraprint.co",
	"https://trans.zillyhuhn.com",
}

// libreTranslateLangMap maps our short codes to LibreTranslate language codes.
var libreTranslateLangMap = map[string]string{
	"zh": "zh", "zh-CN": "zh", "zh-TW": "zt",
	"ja": "ja", "ko": "ko", "fr": "fr", "de": "de",
	"es": "es", "pt": "pt", "ru": "ru", "ar": "ar",
	"it": "it", "nl": "nl", "pl": "pl", "tr": "tr",
}

// deeplxInstances are public DeepLX instances (DeepL free proxy).
// High translation quality; public instances may have rate limits.
var deeplxInstances = []string{
	"https://deeplx.missuo.ru",
	"https://api.deeplx.org",
}

// lingvaLangMap maps our short codes to Lingva language codes.
var lingvaLangMap = map[string]string{
	"zh": "zh", "zh-CN": "zh", "zh-TW": "zh_HANT",
	"ja": "ja", "ko": "ko", "fr": "fr", "de": "de",
	"es": "es", "pt": "pt", "ru": "ru", "ar": "ar",
	"it": "it", "nl": "nl", "pl": "pl", "tr": "tr",
}

func resolveLingvaLang(lang string) string {
	if mapped, ok := lingvaLangMap[lang]; ok {
		return mapped
	}
	return lang
}

func resolveMyMemoryLang(lang string) string {
	if mapped, ok := langMap[lang]; ok {
		return mapped
	}
	return lang
}

// Engine constants returned by TranslateWithEngine.
const (
	EngineLLM  = "llm"
	EngineFree = "free"
)

// Translate translates text from source language to target language.
// Backward-compatible wrapper around TranslateWithEngine (discards engine info).
func (t *Translator) Translate(ctx context.Context, text, source, target string) (string, error) {
	result, _, err := t.TranslateWithEngine(ctx, text, source, target)
	return result, err
}

// TranslateForced translates text using the preferred engine. If preferEngine
// is "free", LLM is skipped entirely. If "llm", LLM is tried first and falls
// back to free APIs on failure. Empty string or "auto" uses the default order.
func (t *Translator) TranslateForced(ctx context.Context, text, source, target, preferEngine string) (string, string, error) {
	if preferEngine == "free" {
		return t.translateFreeOnly(ctx, text, source, target)
	}
	// "llm", "auto", or "" — use the default LLM-first pipeline
	return t.TranslateWithEngine(ctx, text, source, target)
}

// translateFreeOnly runs only the free translation engines (Lingva → DeepLX → LibreTranslate → MyMemory → Google).
func (t *Translator) translateFreeOnly(ctx context.Context, text, source, target string) (string, string, error) {
	if text == "" || target == "" {
		return text, "", nil
	}
	if source == "" {
		source = "en"
	}
	if target == "en" && (source == "en" || source == "auto") {
		return text, "", nil
	}

	// Acquire semaphore (concurrency limit for free APIs)
	select {
	case t.sem <- struct{}{}:
		defer func() { <-t.sem }()
	case <-ctx.Done():
		return text, "", ctx.Err()
	}

	// Rate-limit
	t.mu.Lock()
	elapsed := time.Since(t.lastReq)
	if elapsed < t.minGap {
		t.mu.Unlock()
		select {
		case <-time.After(t.minGap - elapsed):
		case <-ctx.Done():
			return text, "", ctx.Err()
		}
		t.mu.Lock()
	}
	t.lastReq = time.Now()
	t.mu.Unlock()

	var result string
	var err error

	for _, instance := range lingvaInstances {
		result, err = t.lingvaTranslate(ctx, instance, text, source, target)
		if err == nil && result != "" {
			return result, EngineFree, nil
		}
	}
	for _, instance := range deeplxInstances {
		result, err = t.deeplxTranslate(ctx, instance, text, source, target)
		if err == nil && result != "" {
			return result, EngineFree, nil
		}
	}
	for _, instance := range libreTranslateInstances {
		result, err = t.libreTranslate(ctx, instance, text, source, target)
		if err == nil && result != "" {
			return result, EngineFree, nil
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(time.Duration(1<<attempt) * time.Second):
			case <-ctx.Done():
				return text, "", ctx.Err()
			}
		}
		result, err = t.myMemoryTranslate(ctx, text, source, target)
		if err == nil && result != "" {
			return result, EngineFree, nil
		}
		if err != nil && strings.Contains(err.Error(), "status 429") {
			break
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-time.After(time.Duration(1<<attempt) * time.Second):
			case <-ctx.Done():
				return text, "", ctx.Err()
			}
		}
		result, err = t.googleTranslate(ctx, text, source, target)
		if err == nil && result != "" {
			return result, EngineFree, nil
		}
	}

	return text, "", err
}

// TranslateWithEngine translates text and returns the engine used ("llm" or "free").
// Uses LLM (best quality) first, falls back to free APIs on failure.
// Enforces concurrency limit and rate limiting to protect free API quotas.
func (t *Translator) TranslateWithEngine(ctx context.Context, text, source, target string) (string, string, error) {
	if text == "" || target == "" {
		return text, "", nil
	}
	if source == "" {
		source = "en"
	}
	if target == "en" && (source == "en" || source == "auto") {
		return text, "", nil
	}

	// Acquire semaphore (concurrency limit for free APIs)
	select {
	case t.sem <- struct{}{}:
		defer func() { <-t.sem }()
	case <-ctx.Done():
		return text, "", ctx.Err()
	}

	// Rate-limit (enforce minimum gap between free API requests)
	t.mu.Lock()
	elapsed := time.Since(t.lastReq)
	if elapsed < t.minGap {
		t.mu.Unlock()
		select {
		case <-time.After(t.minGap - elapsed):
		case <-ctx.Done():
			return text, "", ctx.Err()
		}
		t.mu.Lock()
	}
	t.lastReq = time.Now()
	t.mu.Unlock()

	var result string
	var err error

	// Engine 1: Lingva Translate (Google proxy, works in China & worldwide)
	for _, instance := range lingvaInstances {
		result, err = t.lingvaTranslate(ctx, instance, text, source, target)
		if err == nil && result != "" {
			return result, EngineFree, nil
		}
		logger.Log.Debug().Err(err).Str("engine", "lingva").Str("instance", instance).Msg("lingva attempt failed")
	}

	// Engine 2: DeepLX (DeepL free proxy, high quality)
	for _, instance := range deeplxInstances {
		result, err = t.deeplxTranslate(ctx, instance, text, source, target)
		if err == nil && result != "" {
			return result, EngineFree, nil
		}
		logger.Log.Debug().Err(err).Str("engine", "deeplx").Str("instance", instance).Msg("deeplx attempt failed")
	}

	// Engine 3: LibreTranslate (open-source, globally accessible)
	for _, instance := range libreTranslateInstances {
		result, err = t.libreTranslate(ctx, instance, text, source, target)
		if err == nil && result != "" {
			return result, EngineFree, nil
		}
		logger.Log.Debug().Err(err).Str("engine", "libretranslate").Str("instance", instance).Msg("libretranslate attempt failed")
	}

	// Engine 4: MyMemory with retry (skip on 429 quota exceeded)
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(1<<attempt) * time.Second
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return text, "", ctx.Err()
			}
		}
		result, err = t.myMemoryTranslate(ctx, text, source, target)
		if err == nil && result != "" {
			return result, EngineFree, nil
		}
		if err != nil && strings.Contains(err.Error(), "status 429") {
			logger.Log.Debug().Str("engine", "mymemory").Msg("quota exceeded, skipping retries")
			break
		}
		logger.Log.Debug().Err(err).Int("attempt", attempt+1).Str("engine", "mymemory").Msg("translation attempt failed")
	}

	// Engine 5: Google Translate direct (blocked in China)
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(1<<attempt) * time.Second
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return text, "", ctx.Err()
			}
		}
		result, err = t.googleTranslate(ctx, text, source, target)
		if err == nil && result != "" {
			return result, EngineFree, nil
		}
		logger.Log.Debug().Err(err).Int("attempt", attempt+1).Str("engine", "google").Msg("google attempt failed")
	}

	// Engine 6: LLM (last resort, uses user's configured API key)
	t.resolveLLMConfig()
	if t.llmConfig != nil {
		logger.Log.Debug().Str("engine", "llm").Str("provider", t.llmConfig.Provider).Msg("all free engines failed, trying LLM as last resort")
		result, err := t.llmTranslate(ctx, text, source, target)
		if err == nil && result != "" {
			return result, EngineLLM, nil
		}
		logger.Log.Debug().Err(err).Str("engine", "llm").Msg("LLM translation also failed")
	}

	logger.Log.Warn().Err(err).Str("target", target).Str("text", truncate(text, 60)).Msg("all translation engines failed after retries")
	return text, "", err
}

// myMemoryTranslate calls the MyMemory free translation API.
// Docs: https://mymemory.translated.net/doc/spec.php
// Limit: 5000 chars/day without key (sufficient for skill descriptions).
func (t *Translator) myMemoryTranslate(ctx context.Context, text, source, target string) (string, error) {
	tgtLang := resolveMyMemoryLang(target)
	srcLang := resolveMyMemoryLang(source)
	u := fmt.Sprintf(
		"https://api.mymemory.translated.net/get?q=%s&langpair=%s|%s",
		url.QueryEscape(text),
		url.QueryEscape(srcLang),
		url.QueryEscape(tgtLang),
	)

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, u, nil)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("mymemory http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("mymemory status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("mymemory read: %w", err)
	}

	return parseMyMemoryResponse(body)
}

// parseMyMemoryResponse extracts translated text from MyMemory JSON.
// Response: {"responseData":{"translatedText":"...","match":0.95},...}
func parseMyMemoryResponse(body []byte) (string, error) {
	var resp struct {
		ResponseData struct {
			TranslatedText string  `json:"translatedText"`
			Match          float64 `json:"match"`
		} `json:"responseData"`
		ResponseStatus int `json:"responseStatus"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("parse mymemory json: %w", err)
	}
	if resp.ResponseStatus != 200 {
		return "", fmt.Errorf("mymemory response status: %d", resp.ResponseStatus)
	}
	text := strings.TrimSpace(resp.ResponseData.TranslatedText)
	if text == "" {
		return "", fmt.Errorf("mymemory empty translation")
	}
	return text, nil
}

// googleTranslate calls Google Translate free endpoint (fallback).
func (t *Translator) googleTranslate(ctx context.Context, text, source, target string) (string, error) {
	u := fmt.Sprintf(
		"https://translate.googleapis.com/translate_a/single?client=gtx&sl=%s&tl=%s&dt=t&q=%s",
		url.QueryEscape(source),
		url.QueryEscape(target),
		url.QueryEscape(text),
	)

	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, u, nil)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("google http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("google status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("google read: %w", err)
	}

	return parseGoogleResponse(body)
}

// parseGoogleResponse extracts translated text from Google's JSON array response.
func parseGoogleResponse(body []byte) (string, error) {
	var raw []interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", fmt.Errorf("parse google json: %w", err)
	}
	if len(raw) == 0 {
		return "", fmt.Errorf("empty response")
	}

	sentences, ok := raw[0].([]interface{})
	if !ok {
		return "", fmt.Errorf("unexpected response format")
	}

	var sb strings.Builder
	for _, s := range sentences {
		parts, ok := s.([]interface{})
		if !ok || len(parts) == 0 {
			continue
		}
		translated, ok := parts[0].(string)
		if ok {
			sb.WriteString(translated)
		}
	}

	result := sb.String()
	if result == "" {
		return "", fmt.Errorf("no translated text in response")
	}
	return result, nil
}

// lingvaTranslate calls a Lingva Translate instance (open-source Google Translate proxy).
// API: GET /api/v1/:source/:target/:text
func (t *Translator) lingvaTranslate(ctx context.Context, instance, text, source, target string) (string, error) {
	srcLang := resolveLingvaLang(source)
	tgtLang := resolveLingvaLang(target)
	u := fmt.Sprintf("%s/api/v1/%s/%s/%s", instance, url.PathEscape(srcLang), url.PathEscape(tgtLang), url.PathEscape(text))

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, u, nil)
	if err != nil {
		return "", fmt.Errorf("build lingva request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("lingva http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("lingva status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("lingva read: %w", err)
	}

	var result struct {
		Translation string `json:"translation"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse lingva json: %w", err)
	}
	if result.Translation == "" {
		return "", fmt.Errorf("lingva empty translation")
	}
	return result.Translation, nil
}

// libreTranslate calls a LibreTranslate instance.
// API: POST /translate with JSON body {q, source, target, format: "text"}
func (t *Translator) libreTranslate(ctx context.Context, instance, text, source, target string) (string, error) {
	srcLang := resolveLibreTranslateLang(source)
	tgtLang := resolveLibreTranslateLang(target)

	body, _ := json.Marshal(map[string]string{
		"q":      text,
		"source": srcLang,
		"target": tgtLang,
		"format": "text",
	})

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, instance+"/translate", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build libretranslate request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("libretranslate http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("libretranslate status %d: %s", resp.StatusCode, string(respBody))
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("libretranslate read: %w", err)
	}

	var result struct {
		TranslatedText string `json:"translatedText"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse libretranslate json: %w", err)
	}
	if result.TranslatedText == "" {
		return "", fmt.Errorf("libretranslate empty translation")
	}
	return result.TranslatedText, nil
}

func resolveLibreTranslateLang(lang string) string {
	if mapped, ok := libreTranslateLangMap[lang]; ok {
		return mapped
	}
	return lang
}

// deeplxTranslate calls a DeepLX instance (DeepL free proxy).
// API: POST /translate with JSON body {text, source_lang, target_lang}
func (t *Translator) deeplxTranslate(ctx context.Context, instance, text, source, target string) (string, error) {
	srcLang := resolveDeepLXLang(source)
	tgtLang := resolveDeepLXLang(target)

	body, _ := json.Marshal(map[string]string{
		"text":        text,
		"source_lang": srcLang,
		"target_lang": tgtLang,
	})

	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, instance+"/translate", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("build deeplx request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("deeplx http: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("deeplx status %d: %s", resp.StatusCode, string(respBody))
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("deeplx read: %w", err)
	}

	var result struct {
		Code int    `json:"code"`
		Data string `json:"data"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("parse deeplx json: %w", err)
	}
	if result.Code != 200 || strings.TrimSpace(result.Data) == "" {
		return "", fmt.Errorf("deeplx error code %d or empty", result.Code)
	}
	return strings.TrimSpace(result.Data), nil
}

// resolveDeepLXLang maps our language codes to DeepL language codes.
func resolveDeepLXLang(lang string) string {
	m := map[string]string{
		"zh": "ZH", "zh-CN": "ZH", "zh-TW": "ZH",
		"ja": "JA", "ko": "KO", "fr": "FR", "de": "DE",
		"es": "ES", "pt": "PT", "pt-BR": "PT-BR", "ru": "RU",
		"ar": "AR", "it": "IT", "nl": "NL", "pl": "PL", "tr": "TR",
		"en": "EN",
	}
	if mapped, ok := m[lang]; ok {
		return mapped
	}
	return strings.ToUpper(lang)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
