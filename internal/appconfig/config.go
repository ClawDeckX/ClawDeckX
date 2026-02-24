package appconfig

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const (
	ModeProduction = "production"
	ModeDebug      = "debug"
)

type Config struct {
	Mode string `json:"mode"`
}

func Default() Config {
	return Config{Mode: ModeProduction}
}

func (c Config) IsDebug() bool {
	return strings.EqualFold(strings.TrimSpace(c.Mode), ModeDebug)
}

func (c Config) Normalize() Config {
	mode := strings.ToLower(strings.TrimSpace(c.Mode))
	if mode != ModeDebug {
		mode = ModeProduction
	}
	c.Mode = mode
	return c
}

func ConfigPath() string {
	if custom := strings.TrimSpace(os.Getenv("OCD_CONFIG")); custom != "" {
		return custom
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".ClawDeckX.json"
	}
	return filepath.Join(home, ".openclaw", "ClawDeckX.json")
}

func Load(path string) (Config, error) {
	cfg := Default()
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, nil
		}
		return cfg, err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return cfg, nil
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Default(), err
	}
	return cfg.Normalize(), nil
}

func Save(path string, cfg Config) error {
	cfg = cfg.Normalize()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}
