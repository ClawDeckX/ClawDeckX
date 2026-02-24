package translate

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"ClawDeckX/internal/logger"
)

// Translator provides text translation with dual-engine fallback:
// MyMemory (primary, fast, China-friendly) → Google Translate (fallback).
type Translator struct {
	client  *http.Client
	mu      sync.Mutex
	lastReq time.Time
	minGap  time.Duration
	sem     chan struct{} // concurrency limiter
}

// New creates a Translator with sensible defaults.
// Limits concurrent translations to 2 and enforces 1.5s gap between requests.
func New() *Translator {
	return &Translator{
		client: &http.Client{Timeout: 20 * time.Second},
		minGap: 1500 * time.Millisecond, // 1.5s gap to protect API limits
		sem:    make(chan struct{}, 2),  // max 2 concurrent translations
	}
}

// langMap maps our short language codes to MyMemory langpair codes.
var langMap = map[string]string{
	"zh": "zh-CN", "zh-CN": "zh-CN", "zh-TW": "zh-TW",
	"ja": "ja", "ko": "ko", "fr": "fr", "de": "de",
	"es": "es", "pt": "pt", "ru": "ru", "ar": "ar",
	"it": "it", "nl": "nl", "pl": "pl", "tr": "tr",
}

func resolveMyMemoryLang(lang string) string {
	if mapped, ok := langMap[lang]; ok {
		return mapped
	}
	return lang
}

// Translate translates text from source language to target language.
// Uses MyMemory first, falls back to Google Translate on failure.
// Enforces concurrency limit and rate limiting to protect API quotas.
func (t *Translator) Translate(ctx context.Context, text, source, target string) (string, error) {
	if text == "" || target == "" {
		return text, nil
	}
	if source == "" {
		source = "en"
	}
	if target == "en" && (source == "en" || source == "auto") {
		return text, nil
	}

	// Acquire semaphore (concurrency limit)
	select {
	case t.sem <- struct{}{}:
		defer func() { <-t.sem }()
	case <-ctx.Done():
		return text, ctx.Err()
	}

	// Rate-limit (enforce minimum gap between requests)
	t.mu.Lock()
	elapsed := time.Since(t.lastReq)
	if elapsed < t.minGap {
		t.mu.Unlock()
		select {
		case <-time.After(t.minGap - elapsed):
		case <-ctx.Done():
			return text, ctx.Err()
		}
		t.mu.Lock()
	}
	t.lastReq = time.Now()
	t.mu.Unlock()

	// Engine 1: MyMemory with exponential backoff retry
	var result string
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			// Exponential backoff: 1s, 2s, 4s
			backoff := time.Duration(1<<attempt) * time.Second
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return text, ctx.Err()
			}
		}
		result, err = t.myMemoryTranslate(ctx, text, source, target)
		if err == nil && result != "" {
			return result, nil
		}
		logger.Log.Debug().Err(err).Int("attempt", attempt+1).Str("engine", "mymemory").Msg("translation attempt failed")
	}

	// Engine 2: Google Translate fallback with retry
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(1<<attempt) * time.Second
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return text, ctx.Err()
			}
		}
		result, err = t.googleTranslate(ctx, text, source, target)
		if err == nil && result != "" {
			return result, nil
		}
		logger.Log.Debug().Err(err).Int("attempt", attempt+1).Str("engine", "google").Msg("fallback attempt failed")
	}

	logger.Log.Warn().Err(err).Str("target", target).Str("text", truncate(text, 60)).Msg("all translation engines failed after retries")
	return text, err
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

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
