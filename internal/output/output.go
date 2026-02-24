package output

import (
	"fmt"
	"os"
	"strings"
)

var debugMode bool
var colorEnabled = detectColorSupport()

func SetDebug(enabled bool) {
	debugMode = enabled
}

func IsDebug() bool {
	return debugMode
}

func Printf(format string, args ...any) {
	fmt.Printf(format, args...)
}

func Println(msg string) {
	fmt.Println(msg)
}

func Debugf(format string, args ...any) {
	if !debugMode {
		return
	}
	fmt.Printf("[调试] "+format, args...)
}

func SetColor(enabled bool) {
	colorEnabled = enabled
}

func ColorEnabled() bool {
	return colorEnabled
}

func Colorize(role, text string) string {
	if !colorEnabled {
		return text
	}
	code := ""
	switch role {
	case "title":
		code = "1;36"
	case "success":
		code = "1;32"
	case "warning":
		code = "1;33"
	case "danger":
		code = "1;31"
	case "dim":
		code = "2"
	case "accent":
		code = "1;34"
	default:
		return text
	}
	return "\x1b[" + code + "m" + text + "\x1b[0m"
}

func detectColorSupport() bool {
	if v := strings.TrimSpace(os.Getenv("FORCE_COLOR")); v != "" && v != "0" {
		return true
	}
	if strings.TrimSpace(os.Getenv("NO_COLOR")) != "" {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("TERM")), "dumb") {
		return false
	}
	if strings.TrimSpace(os.Getenv("CLICOLOR")) == "0" {
		return false
	}
	info, err := os.Stdout.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}
