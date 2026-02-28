package i18n

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"time"
)

// SelectLanguageWithTimeout prompts the user to select a language with a countdown timer.
// If no input is received within the timeout, the default language (detected from system) is used.
// Returns the selected language code ("en" or "zh").
func SelectLanguageWithTimeout(timeoutSeconds int) string {
	defaultLang := DetectSystemLanguage()
	defaultName := languageName(defaultLang)

	// Create a channel for user input
	inputCh := make(chan string, 1)

	// Start goroutine to read user input
	go func() {
		reader := bufio.NewReader(os.Stdin)
		input, _ := reader.ReadString('\n')
		inputCh <- strings.TrimSpace(input)
	}()

	// Display initial prompt (bilingual since we don't know the language yet)
	fmt.Printf("\nSelect language / 选择语言 [1=English, 2=中文] (default: %s in %ds): ", defaultName, timeoutSeconds)

	// Countdown loop
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	remaining := timeoutSeconds
	for {
		select {
		case input := <-inputCh:
			ticker.Stop()
			lang := parseLanguageInput(input, defaultLang)
			SetLanguage(lang)
			fmt.Printf("\n%s\n\n", T(MsgLangSelected, map[string]interface{}{"Language": languageName(lang)}))
			return lang

		case <-ticker.C:
			remaining--
			if remaining <= 0 {
				// Timeout - use default
				SetLanguage(defaultLang)
				fmt.Printf("\n%s\n\n", T(MsgLangAutoSelected, map[string]interface{}{"Language": defaultName}))
				return defaultLang
			}
			// Update countdown display
			fmt.Printf("\r\033[KSelect language / 选择语言 [1=English, 2=中文] (default: %s in %ds): ", defaultName, remaining)
		}
	}
}

// parseLanguageInput parses user input and returns the corresponding language code.
func parseLanguageInput(input string, defaultLang string) string {
	input = strings.ToLower(strings.TrimSpace(input))

	switch input {
	case "1", "en", "english", "e":
		return "en"
	case "2", "zh", "chinese", "中文", "c":
		return "zh"
	case "":
		return defaultLang
	default:
		return defaultLang
	}
}

// languageName returns the display name for a language code.
func languageName(lang string) string {
	switch lang {
	case "zh":
		return "中文"
	case "en":
		return "English"
	default:
		return lang
	}
}
