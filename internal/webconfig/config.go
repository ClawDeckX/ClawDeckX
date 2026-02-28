package webconfig

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type ServerConfig struct {
	Port        int      `json:"port"`
	Bind        string   `json:"bind"`
	CORSOrigins []string `json:"cors_origins"`
}

type AuthConfig struct {
	JWTSecret string `json:"jwt_secret"`
	JWTExpire string `json:"jwt_expire"`
}

type DatabaseConfig struct {
	Driver      string `json:"driver"`
	SQLitePath  string `json:"sqlite_path"`
	PostgresDSN string `json:"postgres_dsn"`
}

type LogConfig struct {
	Level      string `json:"level"`
	Mode       string `json:"mode"`
	FilePath   string `json:"file_path"`
	MaxSizeMB  int    `json:"max_size_mb"`
	MaxBackups int    `json:"max_backups"`
	MaxAgeDays int    `json:"max_age_days"`
	Compress   bool   `json:"compress"`
}

type OpenClawConfig struct {
	ConfigPath   string `json:"config_path"`
	GatewayHost  string `json:"gateway_host"`
	GatewayPort  int    `json:"gateway_port"`
	GatewayToken string `json:"gateway_token"`
}

type MonitorConfig struct {
	IntervalSeconds int  `json:"interval_seconds"`
	AutoRestart     bool `json:"auto_restart"`
	MaxRestartCount int  `json:"max_restart_count"`
}

type AlertConfig struct {
	Enabled    bool     `json:"enabled"`
	WebhookURL string   `json:"webhook_url"`
	Channels   []string `json:"channels"`
}

type Config struct {
	Server   ServerConfig   `json:"server"`
	Auth     AuthConfig     `json:"auth"`
	Database DatabaseConfig `json:"database"`
	Log      LogConfig      `json:"log"`
	OpenClaw OpenClawConfig `json:"openclaw"`
	Monitor  MonitorConfig  `json:"monitor"`
	Alert    AlertConfig    `json:"alert"`
}

func defaultDataDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "./data"
	}
	exeDir := filepath.Dir(exe)
	return filepath.Join(exeDir, "data")
}

func defaultOpenClawConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".openclaw")
}

func Default() Config {
	dataDir := defaultDataDir()
	return Config{
		Server: ServerConfig{
			Port:        18791,
			Bind:        "0.0.0.0",
			CORSOrigins: []string{},
		},
		Auth: AuthConfig{
			JWTSecret: "",
			JWTExpire: "24h",
		},
		Database: DatabaseConfig{
			Driver:     "sqlite",
			SQLitePath: filepath.Join(dataDir, "ClawDeckX.db"),
		},
		Log: LogConfig{
			Level:      "info",
			Mode:       "production",
			FilePath:   filepath.Join(dataDir, "ClawDeckX.log"),
			MaxSizeMB:  10,
			MaxBackups: 3,
			MaxAgeDays: 30,
			Compress:   true,
		},
		OpenClaw: OpenClawConfig{
			ConfigPath:   defaultOpenClawConfigDir(),
			GatewayHost:  "127.0.0.1",
			GatewayPort:  18789,
			GatewayToken: "",
		},
		Monitor: MonitorConfig{
			IntervalSeconds: 30,
			AutoRestart:     true,
			MaxRestartCount: 3,
		},
		Alert: AlertConfig{
			Enabled:  false,
			Channels: []string{},
		},
	}
}

func ConfigPath() string {
	if custom := strings.TrimSpace(os.Getenv("OCD_CONFIG")); custom != "" {
		return custom
	}
	return filepath.Join(defaultDataDir(), "ClawDeckX.json")
}

func Load() (Config, error) {
	cfg := Default()

	// Layer 1: config file
	path := ConfigPath()
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return cfg, err
	}
	if err == nil && len(strings.TrimSpace(string(data))) > 0 {
		if err := json.Unmarshal(data, &cfg); err != nil {
			return Default(), err
		}
	}

	// Layer 2: environment variables override
	applyEnvOverrides(&cfg)

	// Layer 3: generate JWT secret if empty and persist it
	if cfg.Auth.JWTSecret == "" {
		secret, err := generateSecret(32)
		if err != nil {
			return cfg, err
		}
		cfg.Auth.JWTSecret = secret
		// Persist so the secret survives restarts
		_ = Save(cfg)
	}

	return cfg, nil
}

func Save(cfg Config) error {
	path := ConfigPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func (c *Config) ListenAddr() string {
	return c.Server.Bind + ":" + strconv.Itoa(c.Server.Port)
}

func (c *Config) JWTExpireDuration() time.Duration {
	d, err := time.ParseDuration(c.Auth.JWTExpire)
	if err != nil {
		return 24 * time.Hour
	}
	return d
}

func (c *Config) IsDebug() bool {
	return strings.EqualFold(c.Log.Mode, "debug")
}

func applyEnvOverrides(cfg *Config) {
	if v := os.Getenv("OCD_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.Server.Port = p
		}
	}
	if v := os.Getenv("OCD_BIND"); v != "" {
		cfg.Server.Bind = v
	}
	if v := os.Getenv("OCD_DB_DRIVER"); v != "" {
		cfg.Database.Driver = v
	}
	if v := os.Getenv("OCD_DB_SQLITE_PATH"); v != "" {
		cfg.Database.SQLitePath = v
	}
	if v := os.Getenv("OCD_DB_DSN"); v != "" {
		cfg.Database.PostgresDSN = v
	}
	if v := os.Getenv("OCD_JWT_SECRET"); v != "" {
		cfg.Auth.JWTSecret = v
	}
	if v := os.Getenv("OCD_JWT_EXPIRE"); v != "" {
		cfg.Auth.JWTExpire = v
	}
	if v := os.Getenv("OCD_LOG_LEVEL"); v != "" {
		cfg.Log.Level = v
	}
	if v := os.Getenv("OCD_LOG_MODE"); v != "" {
		cfg.Log.Mode = v
	}
	if v := os.Getenv("OCD_LOG_FILE"); v != "" {
		cfg.Log.FilePath = v
	}
	if v := os.Getenv("OCD_OPENCLAW_CONFIG_PATH"); v != "" {
		cfg.OpenClaw.ConfigPath = v
	}
	if v := os.Getenv("OCD_OPENCLAW_GATEWAY_HOST"); v != "" {
		cfg.OpenClaw.GatewayHost = v
	}
	if v := os.Getenv("OCD_OPENCLAW_GATEWAY_PORT"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.OpenClaw.GatewayPort = p
		}
	}
	if v := os.Getenv("OCD_OPENCLAW_GATEWAY_TOKEN"); v != "" {
		cfg.OpenClaw.GatewayToken = v
	}
	if v := os.Getenv("OCD_MONITOR_INTERVAL"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.Monitor.IntervalSeconds = p
		}
	}
	if v := os.Getenv("OCD_MONITOR_AUTO_RESTART"); v != "" {
		cfg.Monitor.AutoRestart = strings.EqualFold(v, "true")
	}
	if v := os.Getenv("OCD_MONITOR_MAX_RESTART"); v != "" {
		if p, err := strconv.Atoi(v); err == nil {
			cfg.Monitor.MaxRestartCount = p
		}
	}
	if v := os.Getenv("OCD_ALERT_ENABLED"); v != "" {
		cfg.Alert.Enabled = strings.EqualFold(v, "true")
	}
	if v := os.Getenv("OCD_ALERT_WEBHOOK_URL"); v != "" {
		cfg.Alert.WebhookURL = v
	}
}

func generateSecret(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
