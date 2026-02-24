package openclaw

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// CommandExists 检测命令是否存在
func CommandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// ResolveStateDir 解析 OpenClaw 状态目录
// 优先级: OPENCLAW_STATE_DIR → CLAWDBOT_STATE_DIR → ~/.openclaw
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

// ResolveConfigPath 解析 OpenClaw 配置文件路径
func ResolveConfigPath() string {
	stateDir := ResolveStateDir()
	if stateDir == "" {
		return ""
	}
	return filepath.Join(stateDir, "openclaw.json")
}

// ConfigFileExists 检测 OpenClaw 配置文件是否存在
func ConfigFileExists() bool {
	path := ResolveConfigPath()
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

// ModelConfigured 检测模型是否已配置
func ModelConfigured() bool {
	cfg := readOpenClawConfig()
	if cfg == nil {
		return false
	}
	// 检测 models 字段是否存在且非空
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

// NotifyConfigured 检测通知渠道是否已配置
func NotifyConfigured() bool {
	cfg := readOpenClawConfig()
	if cfg == nil {
		return false
	}
	// 检测 channels 或 notify 字段
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

// readOpenClawConfig 读取 OpenClaw 配置文件
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
