package i18n

import (
	"os"
	"strings"
)

// DetectSystemLanguage detects the system language from environment variables.
// Returns "zh" for Chinese, "en" for English (default).
func DetectSystemLanguage() string {
	// Check environment variables in order of priority
	envVars := []string{
		"CLAWDECKX_LANG", // App-specific override
		"LANG",
		"LC_ALL",
		"LC_MESSAGES",
		"LANGUAGE",
	}

	for _, env := range envVars {
		if val := os.Getenv(env); val != "" {
			return parseLocale(val)
		}
	}

	return "en"
}

// parseLocale extracts the language code from a locale string.
// Examples: "zh_CN.UTF-8" -> "zh", "en_US" -> "en"
func parseLocale(locale string) string {
	// Remove encoding suffix (e.g., ".UTF-8")
	if idx := strings.Index(locale, "."); idx != -1 {
		locale = locale[:idx]
	}

	// Get language part (before "_" or "-")
	locale = strings.ToLower(locale)
	if idx := strings.IndexAny(locale, "_-"); idx != -1 {
		locale = locale[:idx]
	}

	// Map to supported languages
	switch locale {
	case "zh", "cn", "chinese":
		return "zh"
	case "en", "english":
		return "en"
	default:
		// Check if we support this language
		mu.RLock()
		_, ok := messages[locale]
		mu.RUnlock()
		if ok {
			return locale
		}
		return "en"
	}
}

// ParseAcceptLanguage parses the Accept-Language header and returns the best match.
// Example: "zh-CN,zh;q=0.9,en;q=0.8" -> "zh"
func ParseAcceptLanguage(header string) string {
	if header == "" {
		return "en"
	}

	// Split by comma and find the first supported language
	parts := strings.Split(header, ",")
	for _, part := range parts {
		// Remove quality value (e.g., ";q=0.9")
		if idx := strings.Index(part, ";"); idx != -1 {
			part = part[:idx]
		}
		part = strings.TrimSpace(part)

		lang := parseLocale(part)
		mu.RLock()
		_, ok := messages[lang]
		mu.RUnlock()
		if ok {
			return lang
		}
	}

	return "en"
}
