package logger

import (
	"io"
	"os"
	"path/filepath"

	"ClawDeckX/internal/webconfig"

	"github.com/rs/zerolog"
	"gopkg.in/natefinch/lumberjack.v2"
)

var Log zerolog.Logger

// Module sub-loggers
var (
	Auth     zerolog.Logger
	Gateway  zerolog.Logger
	Monitor  zerolog.Logger
	Security zerolog.Logger
	Doctor   zerolog.Logger
	Config   zerolog.Logger
	Backup   zerolog.Logger
	Alert    zerolog.Logger
	Audit    zerolog.Logger
	WS       zerolog.Logger
	DB       zerolog.Logger
)

func Init(cfg webconfig.LogConfig) {
	level := parseLevel(cfg.Level)
	zerolog.SetGlobalLevel(level)

	var writer io.Writer

	if cfg.Mode == "debug" {
		writer = zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: "15:04:05"}
	} else {
		if err := os.MkdirAll(filepath.Dir(cfg.FilePath), 0o755); err != nil {
			writer = os.Stderr
		} else {
			lj := &lumberjack.Logger{
				Filename:   cfg.FilePath,
				MaxSize:    cfg.MaxSizeMB,
				MaxBackups: cfg.MaxBackups,
				MaxAge:     cfg.MaxAgeDays,
				Compress:   cfg.Compress,
			}
			writer = lj
		}
	}

	Log = zerolog.New(writer).With().Timestamp().Caller().Logger()

	Auth = Log.With().Str("module", "auth").Logger()
	Gateway = Log.With().Str("module", "gateway").Logger()
	Monitor = Log.With().Str("module", "monitor").Logger()
	Security = Log.With().Str("module", "security").Logger()
	Doctor = Log.With().Str("module", "doctor").Logger()
	Config = Log.With().Str("module", "config").Logger()
	Backup = Log.With().Str("module", "backup").Logger()
	Alert = Log.With().Str("module", "alert").Logger()
	Audit = Log.With().Str("module", "audit").Logger()
	WS = Log.With().Str("module", "websocket").Logger()
	DB = Log.With().Str("module", "database").Logger()
}

func parseLevel(s string) zerolog.Level {
	switch s {
	case "trace":
		return zerolog.TraceLevel
	case "debug":
		return zerolog.DebugLevel
	case "info":
		return zerolog.InfoLevel
	case "warn":
		return zerolog.WarnLevel
	case "error":
		return zerolog.ErrorLevel
	case "fatal":
		return zerolog.FatalLevel
	default:
		return zerolog.InfoLevel
	}
}
