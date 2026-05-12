package openclaw

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func CommandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func resolveOpenClawHome() string {
	if dir := strings.TrimSpace(os.Getenv("OPENCLAW_HOME")); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

func ResolveStateDir() string {
	if dir := strings.TrimSpace(os.Getenv("OPENCLAW_STATE_DIR")); dir != "" {
		return dir
	}
	if dir := strings.TrimSpace(os.Getenv("CLAWDBOT_STATE_DIR")); dir != "" {
		return dir
	}
	home := resolveOpenClawHome()
	if home == "" {
		return ""
	}
	return filepath.Join(home, ".openclaw")
}

func ResolveConfigPath() string {
	if path := strings.TrimSpace(os.Getenv("OPENCLAW_CONFIG_PATH")); path != "" {
		return path
	}
	if path := strings.TrimSpace(os.Getenv("CLAWDBOT_CONFIG_PATH")); path != "" {
		return path
	}
	stateDir := ResolveStateDir()
	if stateDir == "" {
		return ""
	}
	return filepath.Join(stateDir, "openclaw.json")
}

func ConfigFileExists() bool {
	path := ResolveConfigPath()
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

func ModelConfigured() bool {
	cfg := readOpenClawConfig()
	if cfg == nil {
		return false
	}
	models, ok := cfg["models"]
	if !ok {
		return false
	}
	switch v := models.(type) {
	case map[string]interface{}:
		return len(v) > 0
	case []interface{}:
		return len(v) > 0
	}
	return false
}

func NotifyConfigured() bool {
	cfg := readOpenClawConfig()
	if cfg == nil {
		return false
	}
	for _, key := range []string{"channels", "notify", "telegram"} {
		if v, ok := cfg[key]; ok && v != nil {
			switch val := v.(type) {
			case map[string]interface{}:
				if len(val) > 0 {
					return true
				}
			case []interface{}:
				if len(val) > 0 {
					return true
				}
			case string:
				if val != "" {
					return true
				}
			}
		}
	}
	return false
}

// GatewayConfigFromFile represents gateway configuration read from openclaw.json.
type GatewayConfigFromFile struct {
	Port  int    // gateway.port
	Bind  string // gateway.bind ("loopback", "0.0.0.0", etc.)
	Mode  string // gateway.mode ("local", "remote", etc.)
	Token string // gateway.auth.token
}

// ReadGatewayConfig reads gateway configuration from the openclaw.json config file.
// Returns nil if the config file does not exist or cannot be parsed.
func ReadGatewayConfig() *GatewayConfigFromFile {
	cfg := readOpenClawConfig()
	if cfg == nil {
		return nil
	}
	gw, ok := cfg["gateway"].(map[string]interface{})
	if !ok {
		return nil
	}
	result := &GatewayConfigFromFile{}
	switch v := gw["port"].(type) {
	case float64:
		if v > 0 && v <= 65535 {
			result.Port = int(v)
		}
	}
	if bind, ok := gw["bind"].(string); ok {
		result.Bind = bind
	}
	if mode, ok := gw["mode"].(string); ok {
		result.Mode = mode
	}
	if auth, ok := gw["auth"].(map[string]interface{}); ok {
		if token, ok := auth["token"].(string); ok {
			result.Token = token
		}
	}
	return result
}

func readOpenClawConfig() map[string]interface{} {
	path := ResolveConfigPath()
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil
	}
	return cfg
}
