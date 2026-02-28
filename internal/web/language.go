package web

import (
	"context"
	"net/http"
	"strings"

	"ClawDeckX/internal/i18n"
)

const languageKey contextKey = "language"

// LanguageMiddleware extracts the language from request headers and stores it in context.
// Priority: X-Language header > Accept-Language header > default "en"
func LanguageMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lang := extractLanguage(r)
		ctx := context.WithValue(r.Context(), languageKey, lang)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// extractLanguage extracts the preferred language from request headers.
func extractLanguage(r *http.Request) string {
	// 1. Check X-Language header (explicit override)
	if lang := r.Header.Get("X-Language"); lang != "" {
		return normalizeLanguage(lang)
	}

	// 2. Check Accept-Language header
	if acceptLang := r.Header.Get("Accept-Language"); acceptLang != "" {
		return i18n.ParseAcceptLanguage(acceptLang)
	}

	// 3. Default to English
	return "en"
}

// normalizeLanguage normalizes language codes to supported values.
func normalizeLanguage(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))

	switch {
	case strings.HasPrefix(lang, "zh"):
		return "zh"
	case strings.HasPrefix(lang, "en"):
		return "en"
	default:
		return "en"
	}
}

// GetLanguage returns the language from request context.
// Returns "en" if not set.
func GetLanguage(r *http.Request) string {
	if lang, ok := r.Context().Value(languageKey).(string); ok {
		return lang
	}
	return "en"
}

// SetLanguage sets the language in request context.
func SetLanguage(r *http.Request, lang string) *http.Request {
	ctx := context.WithValue(r.Context(), languageKey, normalizeLanguage(lang))
	return r.WithContext(ctx)
}

// T translates a message key using the request's language.
// Convenience wrapper for i18n.TLang.
func T(r *http.Request, key string, data ...map[string]interface{}) string {
	lang := GetLanguage(r)
	return i18n.TLang(lang, key, data...)
}
