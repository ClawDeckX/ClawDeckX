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

func ResolveStateDir() string {
	if dir := strings.TrimSpace(os.Getenv("OPENCLAW_STATE_DIR")); dir != "" {
		return dir
	}
	if dir := strings.TrimSpace(os.Getenv("CLAWDBOT_STATE_DIR")); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".openclaw")
}

func ResolveConfigPath() string {
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
