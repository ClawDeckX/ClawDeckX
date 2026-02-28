// Package i18n provides internationalization support for ClawDeckX.
// It supports multiple languages with embedded locale files and provides
// a simple T() function for translating messages.
package i18n

import (
	"embed"
	"encoding/json"
	"strings"
	"sync"
)

//go:embed locales/*.json
var localeFS embed.FS

var (
	messages    map[string]map[string]string // lang -> key -> message
	mu          sync.RWMutex
	currentLang = "en"
	initialized = false
)

// Init initializes the i18n package by loading all locale files.
// Should be called once at application startup.
func Init() error {
	mu.Lock()
	defer mu.Unlock()

	if initialized {
		return nil
	}

	messages = make(map[string]map[string]string)

	// Load all locale files
	files := []string{"en.json", "zh.json"}
	for _, f := range files {
		data, err := localeFS.ReadFile("locales/" + f)
		if err != nil {
			return err
		}

		var msgs map[string]string
		if err := json.Unmarshal(data, &msgs); err != nil {
			return err
		}

		lang := strings.TrimSuffix(f, ".json")
		messages[lang] = msgs
	}

	initialized = true
	return nil
}

// SetLanguage sets the current language for translations.
// Supported: "en", "zh"
func SetLanguage(lang string) {
	mu.Lock()
	defer mu.Unlock()

	lang = normalizeLanguage(lang)
	if _, ok := messages[lang]; ok {
		currentLang = lang
	}
}

// GetLanguage returns the current language.
func GetLanguage() string {
	mu.RLock()
	defer mu.RUnlock()
	return currentLang
}

// T translates a message key using the current language.
// If the key is not found, returns the key itself.
// Optional data map can be used for template substitution.
func T(key string, data ...map[string]interface{}) string {
	mu.RLock()
	lang := currentLang
	msgs := messages[lang]
	mu.RUnlock()

	return translate(msgs, key, data...)
}

// TLang translates a message key using the specified language.
func TLang(lang, key string, data ...map[string]interface{}) string {
	mu.RLock()
	lang = normalizeLanguage(lang)
	msgs, ok := messages[lang]
	if !ok {
		msgs = messages["en"]
	}
	mu.RUnlock()

	return translate(msgs, key, data...)
}

// translate performs the actual translation with template substitution.
func translate(msgs map[string]string, key string, data ...map[string]interface{}) string {
	if msgs == nil {
		return key
	}

	msg, ok := msgs[key]
	if !ok {
		return key
	}

	// Template substitution: {{.Field}} -> value
	if len(data) > 0 && data[0] != nil {
		for k, v := range data[0] {
			placeholder := "{{." + k + "}}"
			if str, ok := v.(string); ok {
				msg = strings.ReplaceAll(msg, placeholder, str)
			}
		}
	}

	return msg
}

// normalizeLanguage normalizes language codes.
func normalizeLanguage(lang string) string {
	lang = strings.ToLower(strings.TrimSpace(lang))

	// Handle common variants
	switch {
	case strings.HasPrefix(lang, "zh"):
		return "zh"
	case strings.HasPrefix(lang, "en"):
		return "en"
	case lang == "":
		return "en"
	default:
		// Check if we have this language
		mu.RLock()
		_, ok := messages[lang]
		mu.RUnlock()
		if ok {
			return lang
		}
		return "en"
	}
}

// SupportedLanguages returns a list of supported language codes.
func SupportedLanguages() []string {
	mu.RLock()
	defer mu.RUnlock()

	langs := make([]string, 0, len(messages))
	for lang := range messages {
		langs = append(langs, lang)
	}
	return langs
}
