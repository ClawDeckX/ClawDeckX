package database

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/webconfig"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

var DB *gorm.DB

func Init(cfg webconfig.DatabaseConfig, debug bool) error {
	var dialector gorm.Dialector

	switch cfg.Driver {
	case "sqlite":
		if err := os.MkdirAll(filepath.Dir(cfg.SQLitePath), 0o755); err != nil {
			return fmt.Errorf("failed to create database directory: %w", err)
		}
		dialector = sqlite.Open(cfg.SQLitePath)
		logger.DB.Info().Str("driver", "sqlite").Str("path", cfg.SQLitePath).Msg(i18n.T(i18n.MsgLogDbInit))
	case "postgres":
		if cfg.PostgresDSN == "" {
			return fmt.Errorf("postgres_dsn is required when driver is postgres")
		}
		dialector = postgres.Open(cfg.PostgresDSN)
		logger.DB.Info().Str("driver", "postgres").Msg(i18n.T(i18n.MsgLogDbInit))
	default:
		return fmt.Errorf("unsupported database driver: %s", cfg.Driver)
	}

	logLevel := gormlogger.Silent
	if debug {
		logLevel = gormlogger.Info
	}

	var err error
	DB, err = gorm.Open(dialector, &gorm.Config{
		Logger: gormlogger.Default.LogMode(logLevel),
	})
	if err != nil {
		return fmt.Errorf("failed to connect database: %w", err)
	}

	// Configure connection pool
	sqlDB, err := DB.DB()
	if err != nil {
		return fmt.Errorf("failed to get underlying sql.DB: %w", err)
	}
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(5 * time.Minute)

	if err := autoMigrate(); err != nil {
		return fmt.Errorf("failed to migrate database: %w", err)
	}

	logger.DB.Info().Msg(i18n.T(i18n.MsgLogDbInitComplete))
	return nil
}

func autoMigrate() error {
	return DB.AutoMigrate(
		&User{},
		&Activity{},
		&Alert{},
		&AuditLog{},
		&MonitorState{},
		&BackupRecord{},
		&Setting{},
		&CredentialScan{},
		&ConnectionLog{},
		&SkillHash{},
		&GatewayProfile{},
		&Template{},
		&SkillTranslation{},
	)
}

func Close() error {
	if DB == nil {
		return nil
	}
	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
